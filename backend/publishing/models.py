from django.conf import settings
from django.db import models
import re


def _slug_valid(slug):
    return bool(re.match(r'^[a-z0-9][a-z0-9\-]{1,48}[a-z0-9]$', slug))


RESERVED_SLUGS = {
    'www', 'app', 'api', 'mail', 'smtp', 'ftp', 'cdn', 'static', 'media',
    'admin', 'nebulux', 'builder', 'pricing', 'settings', 'templates',
    'blog', 'help', 'support', 'status', 'dev', 'staging', 'test',
}


class PublishedSite(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="published_sites",
    )
    generation = models.OneToOneField(
        "generator.WebsiteGeneration",
        on_delete=models.CASCADE,
        related_name="published_site",
    )
    subdomain = models.SlugField(
        max_length=50, unique=True,
        help_text="e.g. 'mysite' → mysite.nebulux.one",
    )
    # Snapshot of pages at publish time
    pages_json = models.JSONField(default=dict)
    is_active = models.BooleanField(default=True)
    has_unpublished_changes = models.BooleanField(default=False)
    published_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "publishing_publishedsite"
        verbose_name = "Published Site"
        verbose_name_plural = "Published Sites"

    def __str__(self):
        return f"{self.subdomain}.nebulux.one ({self.user.email})"

    @property
    def url(self):
        return f"https://{self.subdomain}.nebulux.one"
