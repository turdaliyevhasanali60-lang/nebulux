from django.contrib import admin
from .models import PublishedSite

@admin.register(PublishedSite)
class PublishedSiteAdmin(admin.ModelAdmin):
    list_display = ["subdomain", "user", "is_active", "has_unpublished_changes", "published_at"]
    list_filter = ["is_active", "has_unpublished_changes"]
    search_fields = ["subdomain", "user__email"]
    readonly_fields = ["published_at", "updated_at"]
