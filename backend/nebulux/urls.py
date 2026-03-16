# nebulux/urls.py
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from django.views.generic import TemplateView

from .views import templates_coming_soon

urlpatterns = [
    path("admin/", admin.site.urls),

    # ── Auth API
    path("api/auth/", include("accounts.urls")),

    # ── Generator API
    path("api/", include("generator.urls")),

    # ── Payments / Stripe API
    path("api/payments/", include("payments.urls")),

    # ── Frontend pages (Django serves them directly — no CORS needed in prod)
    path("",           TemplateView.as_view(template_name="index.html"),    name="index"),
    path("builder/",   TemplateView.as_view(template_name="builder.html"),  name="builder"),
    path("pricing/",   TemplateView.as_view(template_name="pricing.html"),  name="pricing"),
    path("settings/", TemplateView.as_view(template_name="settings.html"), name="settings"),

    # ── Templates page — DISABLED (Coming Soon) ──────────────────────────
    path("templates/", templates_coming_soon, name="templates"),

    path("reset-password/",  TemplateView.as_view(template_name="index.html"), name="reset-password"),
    path("404/", TemplateView.as_view(template_name="404.html"), name="404-preview"),
    path('privacy/', TemplateView.as_view(template_name='privacy.html'), name='privacy'),
    path('terms/',   TemplateView.as_view(template_name='terms.html'),   name='terms'),
    path('contact/', TemplateView.as_view(template_name='contact.html'), name='contact'),

]

# ── Serve media files in development (thumbnail previews, uploads, etc.)
# In production, your web server (nginx/caddy) handles /media/ directly —
# this block is skipped when DEBUG=False.
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

# ── Custom 404 handler ──────────────────────────────────────────────────
handler404 = "nebulux.views.custom_404"
