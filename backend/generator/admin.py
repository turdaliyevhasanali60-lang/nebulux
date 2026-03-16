# generator/admin.py
from django.contrib import admin
from .models import WebsiteGeneration, APIUsageLog


@admin.register(WebsiteGeneration)
class WebsiteGenerationAdmin(admin.ModelAdmin):
    list_display   = ['id', 'prompt_preview', 'tokens_used', 'ip_address', 'created_at']
    list_filter    = ['created_at']
    search_fields  = ['prompt', 'ip_address']
    readonly_fields = ['created_at', 'tokens_used', 'spec_json']
    date_hierarchy = 'created_at'

    fieldsets = (
        ('Request', {
            'fields': ('prompt', 'ip_address', 'created_at')
        }),
        ('Spec', {
            'fields': ('spec_json',),
            'classes': ('collapse',)
        }),
        ('Output', {
            'fields': ('generated_code', 'tokens_used'),
            'classes': ('collapse',)
        }),
    )

    def prompt_preview(self, obj):
        return obj.prompt[:100] + '…' if len(obj.prompt) > 100 else obj.prompt
    prompt_preview.short_description = 'Prompt'


@admin.register(APIUsageLog)
class APIUsageLogAdmin(admin.ModelAdmin):
    list_display   = ['id', 'ip_address', 'endpoint', 'success', 'tokens_used', 'timestamp']
    list_filter    = ['success', 'endpoint', 'timestamp']
    search_fields  = ['ip_address', 'error_message']
    readonly_fields = ['timestamp']
    date_hierarchy = 'timestamp'

    def has_add_permission(self, request):
        return False  # Logs must be immutable

    def has_change_permission(self, request, obj=None):
        return False  # Logs must be immutable