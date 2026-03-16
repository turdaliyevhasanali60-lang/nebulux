# generator/utils.py
from django.conf import settings
from django.http import HttpRequest


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