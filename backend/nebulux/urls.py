# nebulux/urls.py
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from .views import react_app, templates_coming_soon

urlpatterns = [
    path("admin/", admin.site.urls),

    # ── Auth API
    path("api/auth/", include("accounts.urls")),

    # ── Generator API
    path("api/", include("generator.urls")),

    # ── Payments / Stripe API
    path("api/payments/", include("payments.urls")),
    path("api/publishing/", include("publishing.urls")),

    # ── Templates page — DISABLED (Coming Soon) ──────────────────────────
    path("templates/", templates_coming_soon, name="templates"),

    # ── React SPA — all frontend routes serve the same index.html
    path("",               react_app, name="index"),
    path("builder/",       react_app, name="builder"),
    path("pricing/",       react_app, name="pricing"),
    path("settings/",      react_app, name="settings"),
    path("reset-password/", react_app, name="reset-password"),
    path("privacy/",       react_app, name="privacy"),
    path("terms/",         react_app, name="terms"),
    path("contact/",       react_app, name="contact"),
    path("404/",           react_app, name="404-preview"),
]

# ── Serve media files in development (thumbnail previews, uploads, etc.)
# In production, your web server (nginx/caddy) handles /media/ directly —
# this block is skipped when DEBUG=False.
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

# ── Custom 404 handler ──────────────────────────────────────────────────
handler404 = "nebulux.views.custom_404"
