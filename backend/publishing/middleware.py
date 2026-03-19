import re
from django.http import HttpResponse

SUBDOMAIN_RE = re.compile(r'^([a-z0-9][a-z0-9\-]{1,48}[a-z0-9])\.nebulux\.one$', re.IGNORECASE)

# Rewrite href="about.html" → href="/about" and href="./contact.html" → href="/contact"
_HTML_LINK_RE = re.compile(r'href=["\']\.?/?([a-z0-9_\-]+)\.html["\']', re.IGNORECASE)


def _rewrite_links(html):
    """Rewrite relative .html links to clean paths for subdomain serving."""
    return _HTML_LINK_RE.sub(lambda m: f'href="/{m.group(1)}"', html)


class SubdomainMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        host = request.get_host().split(":")[0].lower()
        match = SUBDOMAIN_RE.match(host)

        if not match:
            return self.get_response(request)

        subdomain = match.group(1)

        from .models import PublishedSite
        try:
            site = PublishedSite.objects.get(subdomain=subdomain, is_active=True)
        except PublishedSite.DoesNotExist:
            return HttpResponse(
                "<!DOCTYPE html><html><head><title>Not Found</title></head><body>"
                "<h1>404 — Site not found</h1>"
                "<p>This site doesn't exist or has been unpublished.</p>"
                "</body></html>",
                status=404,
                content_type="text/html",
            )

        pages = site.pages_json or {}
        path = request.path.strip("/") or "index"

        # Also handle /about.html → about
        if path.endswith(".html"):
            path = path[:-5]

        html = pages.get(path) or pages.get("index") or ""

        if not html:
            # Try to serve index with a 404 message
            index_html = pages.get("index", "")
            if index_html:
                html = index_html
            else:
                return HttpResponse(
                    "<!DOCTYPE html><html><body><h1>Page not found</h1></body></html>",
                    status=404,
                    content_type="text/html",
                )

        html = _rewrite_links(html)

        response = HttpResponse(html, content_type="text/html; charset=utf-8")
        response["X-Frame-Options"] = "SAMEORIGIN"
        return response
