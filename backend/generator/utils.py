# generator/utils.py
import logging

from django.conf import settings
from django.http import HttpRequest

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
#  DATA-4: Base64 → R2 extractor (moved here so tasks.py can import it
#  without creating a circular import through views.py)
# ─────────────────────────────────────────────────────────────────────────────
def inline_images_to_r2(html: str) -> str:
    """
    Find every src="data:image/..." in html, convert to WebP, upload to R2,
    return html with permanent URLs.  Falls back silently on any error.
    """
    import re, io, uuid, base64
    from django.conf import settings as _s

    if not getattr(_s, '_R2_CONFIGURED', False) or not getattr(_s, 'R2_PUBLIC_URL', ''):
        return html  # R2 not configured — leave as-is

    pattern = re.compile(
        r'src=(?:["\'])??(data:image/([a-zA-Z+]+);base64,([A-Za-z0-9+/=]+))(?:["\'])??',
        re.IGNORECASE,
    )
    matches = list(pattern.finditer(html))
    if not matches:
        return html

    try:
        import boto3
        from botocore.config import Config as BotoConfig
        from PIL import Image as PilImage

        s3 = boto3.client(
            "s3",
            endpoint_url=_s.AWS_S3_ENDPOINT_URL,
            aws_access_key_id=_s.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=_s.AWS_SECRET_ACCESS_KEY,
            config=BotoConfig(signature_version="s3v4"),
            region_name="auto",
        )
    except Exception as exc:
        logger.warning("inline_images_to_r2: could not init S3 client: %s", exc)
        return html

    replacements = {}
    for match in matches:
        full_src   = match.group(1)
        img_format = match.group(2)
        b64_data   = match.group(3)

        if full_src in replacements:
            continue
        if 'svg' in img_format.lower():
            continue

        try:
            raw = base64.b64decode(b64_data)
            img = PilImage.open(io.BytesIO(raw))
            img = img.convert("RGBA" if img.mode in ("RGBA", "LA", "P") else "RGB")

            MAX_DIM = 2000
            if max(img.width, img.height) > MAX_DIM:
                img.thumbnail((MAX_DIM, MAX_DIM), PilImage.LANCZOS)

            buf = io.BytesIO()
            img.save(buf, format="WEBP", quality=82, method=4)
            buf.seek(0)

            key = f"generated/{uuid.uuid4().hex}.webp"
            s3.put_object(
                Bucket=_s.R2_BUCKET_NAME,
                Key=key,
                Body=buf.read(),
                ContentType="image/webp",
            )
            public_url = _s.R2_PUBLIC_URL.rstrip("/") + "/" + key
            replacements[full_src] = public_url
            logger.info("inline_images_to_r2: uploaded %s → %s", key, public_url)

        except Exception as exc:
            logger.warning("inline_images_to_r2: skipping image (%s): %s", img_format, exc)

    for old_src, new_url in replacements.items():
        html = html.replace(old_src, new_url)

    logger.info("inline_images_to_r2: replaced %d base64 image(s)", len(replacements))
    return html


def get_client_ip(request: HttpRequest) -> str:
    """
    Extract the real client IP, respecting X-Forwarded-For from trusted proxies.
    Returns an empty string if IP cannot be determined.
    """
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', '')


def paginate_queryset(queryset, request, default_limit: int = 20, max_limit: int = 100):
    """
    Simple limit/offset pagination without requiring DRF pagination classes on a view.

    Query params:
      ?limit=N   (default 20, max 100)
      ?offset=N  (default 0)
    """
    try:
        limit = min(int(request.GET.get('limit', default_limit)), max_limit)
    except (TypeError, ValueError):
        limit = default_limit

    try:
        offset = max(int(request.GET.get('offset', 0)), 0)
    except (TypeError, ValueError):
        offset = 0

    return queryset[offset:offset + limit]