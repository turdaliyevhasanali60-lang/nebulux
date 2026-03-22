# generator/tasks.py
"""
Background task: generate a WebP thumbnail preview for a WebsiteGeneration.

Called immediately after WebsiteGeneration.objects.create() in views.py.
Never blocks the HTTP response — the user gets their generation ID instantly
and the preview appears in the gallery once the task completes (~2–5 s).

Dependencies (add to requirements.txt):
    playwright          # pip install playwright && playwright install chromium
    Pillow              # pip install Pillow
"""
from __future__ import annotations

import io
import logging

from celery import shared_task
from django.core.files.base import ContentFile

logger = logging.getLogger(__name__)

# Thumbnail dimensions — matches the CSS .galaxy-card-preview height ratio
THUMB_W = 640
THUMB_H = 450


@shared_task(bind=True, max_retries=2, default_retry_delay=15, ignore_result=True)
def generate_preview(self, generation_id: int) -> None:
    """
    Render the saved HTML in a headless Chromium instance, take a screenshot,
    resize it to a compact WebP thumbnail, and save it to the model's
    preview_image field.

    Retries up to 2 times (with a 15 s delay) on transient errors.
    Silently skips if the generation has already been previewed.
    """
    from .models import WebsiteGeneration  # local import avoids circular imports at module load

    # ── 1. Fetch the generation ───────────────────────────────────────────
    try:
        gen = WebsiteGeneration.objects.get(pk=generation_id)
    except WebsiteGeneration.DoesNotExist:
        logger.warning('[preview] Generation %d not found — skipping', generation_id)
        return

    if gen.preview_image:
        logger.debug('[preview] Generation %d already has a preview — skipping', generation_id)
        return

    # ── 2. Pick the HTML to render ────────────────────────────────────────
    # For multi-page sites, render the index page.
    html = gen.generated_code
    if gen.pages_json and isinstance(gen.pages_json, dict) and gen.pages_json:
        html = (
            gen.pages_json.get('index')
            or next(iter(gen.pages_json.values()), html)
        )

    if not html or not html.strip():
        logger.warning('[preview] Generation %d has no HTML — skipping', generation_id)
        return

    # ── 3. Screenshot with Playwright ────────────────────────────────────
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.error(
            '[preview] Playwright is not installed. '
            'Run: pip install playwright && playwright install chromium'
        )
        return

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                headless=True,
                args=[
                    '--no-sandbox',
                    '--disable-gpu',
                    '--disable-dev-shm-usage',
                    '--disable-extensions',
                    '--disable-background-networking',
                    '--disable-sync',
                    '--metrics-recording-only',
                    '--mute-audio',
                ],
            )
            page = browser.new_page(viewport={'width': 1280, 'height': 900})

            # Use set_content (no network) — the HTML is self-contained
            page.set_content(html, wait_until='domcontentloaded', timeout=15_000)

            # Short pause so CSS transitions/fonts paint before capture
            page.wait_for_timeout(600)

            png_bytes = page.screenshot(
                type='png',
                clip={'x': 0, 'y': 0, 'width': 1280, 'height': 900},
                animations='disabled',   # freeze CSS animations
            )
            browser.close()

    except Exception as exc:
        logger.exception('[preview] Playwright error for generation %d: %s', generation_id, exc)
        raise self.retry(exc=exc)

    # ── 4. Resize to compact WebP with Pillow ────────────────────────────
    try:
        from PIL import Image
    except ImportError:
        logger.error('[preview] Pillow is not installed. Run: pip install Pillow')
        return

    try:
        img = Image.open(io.BytesIO(png_bytes)).convert('RGB')
        img.thumbnail((THUMB_W, THUMB_H), Image.LANCZOS)

        buf = io.BytesIO()
        img.save(buf, format='WEBP', quality=72, method=4)
        webp_bytes = buf.getvalue()

    except Exception as exc:
        logger.exception('[preview] Pillow resize error for generation %d: %s', generation_id, exc)
        raise self.retry(exc=exc)

    # ── 5. Save to model ──────────────────────────────────────────────────
    try:
        gen.preview_image.save(
            f'previews/{generation_id}.webp',
            ContentFile(webp_bytes),
            save=True,          # calls gen.save(update_fields=['preview_image'])
        )
        logger.info(
            '[preview] Saved %d-byte WebP thumbnail for generation %d',
            len(webp_bytes), generation_id,
        )
    except Exception as exc:
        logger.exception('[preview] Storage error for generation %d: %s', generation_id, exc)
        raise self.retry(exc=exc)


@shared_task(bind=True, max_retries=2, default_retry_delay=10, ignore_result=True)
def process_inline_images(self, generation_id: int) -> None:
    """
    DATA-4: Convert inline base64 images in a generation's HTML to WebP files
    stored in Cloudflare R2.  Runs asynchronously after the HTTP response has
    already been sent to the client so the streaming generation is not blocked.

    Retries up to 2 times on transient errors (S3 timeouts, etc.).
    """
    from .models import WebsiteGeneration
    from .utils import inline_images_to_r2

    try:
        gen = WebsiteGeneration.objects.get(pk=generation_id)
    except WebsiteGeneration.DoesNotExist:
        logger.warning('[images] Generation %d not found — skipping', generation_id)
        return

    if not gen.generated_code:
        return

    try:
        updated_html = inline_images_to_r2(gen.generated_code)
        if updated_html != gen.generated_code:
            gen.generated_code = updated_html
            gen.save(update_fields=['generated_code'])
            logger.info('[images] Inline images processed for generation %d', generation_id)
        else:
            logger.debug('[images] No inline images found for generation %d', generation_id)
    except Exception as exc:
        logger.exception('[images] Processing failed for generation %d', generation_id)
        raise self.retry(exc=exc)