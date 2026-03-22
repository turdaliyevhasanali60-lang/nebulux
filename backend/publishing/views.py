import re
import logging
from django.http import HttpResponse, Http404
from django.views.decorators.clickjacking import xframe_options_exempt
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import PublishedSite, RESERVED_SLUGS, _slug_valid
from generator.models import WebsiteGeneration

logger = logging.getLogger(__name__)


def _slug_error(slug):
    if not slug:
        return "Subdomain is required."
    if not _slug_valid(slug):
        return "Use 3-50 lowercase letters, numbers, or hyphens. Must start and end with a letter or number."
    if slug in RESERVED_SLUGS:
        return f"'{slug}' is reserved. Please choose another."
    return None


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def check_subdomain(request):
    slug = request.GET.get("subdomain", "").strip().lower()
    err = _slug_error(slug)
    if err:
        return Response({"available": False, "error": err})
    taken = PublishedSite.objects.filter(subdomain=slug).exclude(user=request.user).exists()
    if taken:
        return Response({"available": False, "error": "This subdomain is already taken."})
    return Response({"available": True})



def _extract_pages(generation):
    raw = generation.pages_json or {}
    pages = {}
    for key, val in raw.items():
        if key.startswith('_'):
            continue
        if isinstance(val, str) and val.strip().startswith('<!'):
            pages[key] = val
        elif isinstance(val, dict) and 'code' in val:
            code = val['code']
            if isinstance(code, str) and code.strip():
                pages[key] = code
    if not pages and generation.generated_code:
        pages = {"index": generation.generated_code}
    return pages


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def publish_site(request):
    generation_id = request.data.get("generation_id")
    subdomain = request.data.get("subdomain", "").strip().lower()

    err = _slug_error(subdomain)
    if err:
        return Response({"error": err}, status=status.HTTP_400_BAD_REQUEST)

    try:
        generation = WebsiteGeneration.objects.get(id=generation_id, user=request.user)
    except WebsiteGeneration.DoesNotExist:
        return Response({"error": "Generation not found."}, status=status.HTTP_404_NOT_FOUND)

    # Check subdomain not taken by another user
    conflict = PublishedSite.objects.filter(subdomain=subdomain).exclude(user=request.user).first()
    if conflict:
        return Response({"error": "This subdomain is already taken."}, status=status.HTTP_409_CONFLICT)

    pages = _extract_pages(generation)

    # Create or update
    site, created = PublishedSite.objects.update_or_create(
        generation=generation,
        defaults={
            "user": request.user,
            "subdomain": subdomain,
            "pages_json": pages,
            "is_active": True,
            "has_unpublished_changes": False,
        },
    )

    logger.info("Site published: %s.nebulux.one by %s", subdomain, request.user.email)
    return Response({
        "url": site.url,
        "subdomain": site.subdomain,
        "created": created,
    }, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def republish_site(request):
    generation_id = request.data.get("generation_id")
    try:
        generation = WebsiteGeneration.objects.get(id=generation_id, user=request.user)
        site = generation.published_site
    except (WebsiteGeneration.DoesNotExist, PublishedSite.DoesNotExist):
        return Response({"error": "Published site not found."}, status=status.HTTP_404_NOT_FOUND)

    pages = _extract_pages(generation)

    site.pages_json = pages
    site.has_unpublished_changes = False
    site.save(update_fields=["pages_json", "has_unpublished_changes", "updated_at"])

    logger.info("Site republished: %s.nebulux.one by %s", site.subdomain, request.user.email)
    return Response({"url": site.url, "subdomain": site.subdomain})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def publish_status(request, generation_id):
    try:
        generation = WebsiteGeneration.objects.get(id=generation_id, user=request.user)
        site = generation.published_site
        if not site.is_active:
            raise PublishedSite.DoesNotExist
        return Response({
            "is_published": True,
            "subdomain": site.subdomain,
            "url": site.url,
            "has_unpublished_changes": site.has_unpublished_changes,
            "published_at": site.published_at,
        })
    except WebsiteGeneration.DoesNotExist:
        return Response({"error": "Not found."}, status=404)
    except PublishedSite.DoesNotExist:
        return Response({"is_published": False})


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def unpublish_site(request, generation_id):
    try:
        generation = WebsiteGeneration.objects.get(id=generation_id, user=request.user)
        site = generation.published_site
        subdomain = site.subdomain
        site.is_active = False
        site.save(update_fields=["is_active", "updated_at"])
        logger.info("Site unpublished: %s by %s", subdomain, request.user.email)
        return Response({"message": "Site unpublished."})
    except (WebsiteGeneration.DoesNotExist, PublishedSite.DoesNotExist):
        return Response({"error": "Not found."}, status=404)


@xframe_options_exempt
def serve_published_site(request, subdomain, page_slug="index"):
    try:
        site = PublishedSite.objects.get(subdomain=subdomain, is_active=True)
    except PublishedSite.DoesNotExist:
        raise Http404

    pages = site.pages_json or {}
    html = pages.get(page_slug) or pages.get("index") or ""
    if not html:
        raise Http404

    return HttpResponse(html, content_type="text/html; charset=utf-8")
