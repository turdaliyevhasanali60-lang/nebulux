# payments/admin.py
from django.contrib import admin
from .models import Payment, Subscription


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display    = ("user", "payment_type", "status", "amount_display", "credits_granted", "created_at")
    list_filter     = ("payment_type", "status", "created_at")
    search_fields   = ("user__email", "ls_order_id")
    readonly_fields = ("id", "ls_order_id", "ls_variant_id", "created_at")
    ordering        = ("-created_at",)

    def amount_display(self, obj):
        return f"${obj.amount_cents / 100:.2f}"
    amount_display.short_description = "Amount"


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display    = ("user", "status", "ls_subscription_id", "current_period_end", "updated_at")
    list_filter     = ("status",)
    search_fields   = ("user__email", "ls_customer_id", "ls_subscription_id")
    readonly_fields = ("id", "created_at", "updated_at")