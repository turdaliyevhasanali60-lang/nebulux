# accounts/admin.py
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

User = get_user_model()


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = (
        "email", "name", "plan", "credits",
        "has_onboarded", "ob_heard_from", "ob_role", "ob_use_case",
        "is_email_verified", "created_at",
    )
    list_filter = ("plan", "has_onboarded", "is_email_verified", "is_staff", "created_at")
    search_fields = ("email", "name")
    ordering = ("-created_at",)
    readonly_fields = ("id", "created_at", "updated_at", "onboarding_data")

    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Profile", {"fields": ("name", "avatar_url")}),
        ("Plan & Credits", {"fields": ("plan", "credits")}),
        ("Onboarding", {"fields": ("has_onboarded", "onboarding_data")}),
        ("Auth", {"fields": ("is_active", "is_staff", "is_superuser", "is_email_verified", "google_id")}),
        ("Timestamps", {"fields": ("created_at", "updated_at")}),
    )

    add_fieldsets = (
        (None, {
            "classes": ("wide",),
            "fields": ("email", "password1", "password2", "name"),
        }),
    )

    # ── Onboarding data columns ──
    @admin.display(description="Heard from")
    def ob_heard_from(self, obj):
        return obj.onboarding_data.get("heard_from", "—")

    @admin.display(description="Role")
    def ob_role(self, obj):
        return obj.onboarding_data.get("role", "—")

    @admin.display(description="Use case")
    def ob_use_case(self, obj):
        return obj.onboarding_data.get("use_case", "—")