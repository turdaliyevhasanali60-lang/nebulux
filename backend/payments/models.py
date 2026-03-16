# payments/models.py
"""
Payment records for Nebulux.

Two payment types:
  1. Subscription — recurring monthly (Standard plan via Lemon Squeezy subscription)
  2. Credit Pack  — one-time purchase (Starter / Builder / Agency via Lemon Squeezy order)

All Lemon Squeezy events are idempotent-safe via the unique ls_order_id field.
"""
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class Payment(models.Model):
    """Records every successful Lemon Squeezy payment (subscription invoice or one-time order)."""

    TYPE_SUBSCRIPTION = "subscription"
    TYPE_CREDIT_PACK  = "credit_pack"
    TYPE_CHOICES = [
        (TYPE_SUBSCRIPTION, "Subscription"),
        (TYPE_CREDIT_PACK,  "Credit Pack"),
    ]

    STATUS_PENDING   = "pending"
    STATUS_COMPLETED = "completed"
    STATUS_FAILED    = "failed"
    STATUS_REFUNDED  = "refunded"
    STATUS_CHOICES = [
        (STATUS_PENDING,   "Pending"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_FAILED,    "Failed"),
        (STATUS_REFUNDED,  "Refunded"),
    ]

    id              = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user            = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="payments",
        db_index=True,
    )
    payment_type    = models.CharField(max_length=20, choices=TYPE_CHOICES, db_index=True)
    status          = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    amount_cents    = models.PositiveIntegerField(help_text="Amount in cents (e.g. 1499 = $14.99)")
    currency        = models.CharField(max_length=3, default="usd")
    credits_granted = models.PositiveIntegerField(default=0)
    ls_order_id     = models.CharField(
        max_length=255, unique=True, db_index=True,
        help_text="Lemon Squeezy Order ID — ensures idempotency",
    )
    ls_variant_id   = models.CharField(max_length=255, blank=True, default="")
    description     = models.CharField(max_length=500, blank=True, default="")
    created_at      = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table            = "payments_payment"
        ordering            = ["-created_at"]
        verbose_name        = "Payment"
        verbose_name_plural = "Payments"

    def __str__(self):
        return f"{self.user.email} — {self.payment_type} — ${self.amount_cents / 100:.2f}"


class Subscription(models.Model):
    """Tracks active Lemon Squeezy subscriptions (one per user max)."""

    STATUS_ACTIVE   = "active"
    STATUS_CANCELED = "canceled"
    STATUS_PAST_DUE = "past_due"
    STATUS_CHOICES = [
        (STATUS_ACTIVE,   "Active"),
        (STATUS_CANCELED, "Canceled"),
        (STATUS_PAST_DUE, "Past Due"),
    ]

    id                  = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user                = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="subscription",
    )
    ls_customer_id      = models.CharField(max_length=255, unique=True, db_index=True)
    ls_subscription_id  = models.CharField(max_length=255, unique=True, db_index=True)
    ls_variant_id       = models.CharField(max_length=255, blank=True, default="")
    status              = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    current_period_start = models.DateTimeField(null=True, blank=True)
    current_period_end   = models.DateTimeField(null=True, blank=True)
    created_at          = models.DateTimeField(default=timezone.now)
    updated_at          = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "payments_subscription"

    def __str__(self):
        return f"{self.user.email} — {self.status}"