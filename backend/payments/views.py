# payments/views.py
import hashlib
import hmac
import json
import logging
import requests

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import F
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import Payment, Subscription

User = get_user_model()
logger = logging.getLogger("payments")
error_logger = logging.getLogger("payments.webhook.errors")

PRODUCT_VARIANT_MAP = {
    "standard_monthly": getattr(settings, "LS_VARIANT_STANDARD_MONTHLY", ""),
    "pro_monthly":      getattr(settings, "LS_VARIANT_PRO_MONTHLY", ""),
    "starter_pack":     getattr(settings, "LS_VARIANT_STARTER_PACK", ""),
    "builder_pack":     getattr(settings, "LS_VARIANT_BUILDER_PACK", ""),
    "agency_pack":      getattr(settings, "LS_VARIANT_AGENCY_PACK", ""),
}

SUBSCRIPTION_PRODUCTS = {"standard_monthly", "pro_monthly"}

PRODUCT_LABELS = {
    "standard_monthly": "Standard Plan (Monthly)",
    "pro_monthly":      "Pro Plan (Monthly)",
    "starter_pack":     "Starter Credit Pack",
    "builder_pack":     "Builder Credit Pack",
    "agency_pack":      "Agency Credit Pack",
}


def _ls_api(path=""):
    return f"https://api.lemonsqueezy.com/v1{path}"


def _ls_headers():
    return {
        "Authorization":  f"Bearer {settings.LEMON_SQUEEZY_API_KEY}",
        "Accept":         "application/vnd.api+json",
        "Content-Type":   "application/vnd.api+json",
    }


# ─────────────────────────────────────────────────────────
#  Checkout
# ─────────────────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_checkout_view(request):
    product_key = request.data.get("product", "").strip()
    if product_key not in PRODUCT_VARIANT_MAP:
        return Response({"error": f"Unknown product: {product_key}"}, status=status.HTTP_400_BAD_REQUEST)

    variant_id = PRODUCT_VARIANT_MAP[product_key]
    if not variant_id:
        return Response({"error": "Product not configured."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:8000")
        payload = {
            "data": {
                "type": "checkouts",
                "attributes": {
                    "checkout_options": [],
                    "product_options": {
                        "redirect_url": f"{frontend_url}/pricing/?payment=success",
                    },
                    "checkout_data": {
                        "email": request.user.email,
                        "custom": {
                            "user_id":     str(request.user.id),
                            "product_key": product_key,
                        },
                    },
                },
                "relationships": {
                    "store": {
                        "data": {"type": "stores", "id": str(settings.LEMON_SQUEEZY_STORE_ID)},
                    },
                    "variant": {
                        "data": {"type": "variants", "id": str(variant_id)},
                    },
                },
            }
        }
        response = requests.post(_ls_api("/checkouts"), headers=_ls_headers(), json=payload)
        response.raise_for_status()
        checkout_url = response.json()["data"]["attributes"]["url"]
        return Response({"checkout_url": checkout_url})
    except Exception as e:
        logger.error("Lemon Squeezy checkout creation failed: %s", str(e))
        return Response({"error": "Could not create checkout session."}, status=status.HTTP_502_BAD_GATEWAY)


# ─────────────────────────────────────────────────────────
#  Billing Info
# ─────────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def billing_info_view(request):
    user = request.user

    subscription_data = None
    try:
        sub = Subscription.objects.get(user=user)
        subscription_data = {
            "status":               sub.status,
            "ls_subscription_id":   sub.ls_subscription_id,
            "ls_customer_id":       sub.ls_customer_id,
            "current_period_start": sub.current_period_start.isoformat() if sub.current_period_start else None,
            "current_period_end":   sub.current_period_end.isoformat() if sub.current_period_end else None,
            "created_at":           sub.created_at.isoformat(),
        }
    except Subscription.DoesNotExist:
        pass

    payments = Payment.objects.filter(user=user).order_by("-created_at")[:20]
    return Response({
        "plan":                 user.plan,
        "credits":              user.credits,
        "monthly_credit_limit": user.monthly_credit_limit,
        "subscription":         subscription_data,
        "payments": [
            {
                "id":              str(p.id),
                "type":            p.payment_type,
                "status":          p.status,
                "amount_cents":    p.amount_cents,
                "currency":        p.currency,
                "credits_granted": p.credits_granted,
                "description":     p.description,
                "created_at":      p.created_at.isoformat(),
            }
            for p in payments
        ],
    })


# ─────────────────────────────────────────────────────────
#  Cancel Subscription
# ─────────────────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def cancel_subscription_view(request):
    try:
        sub = Subscription.objects.get(user=request.user)
    except Subscription.DoesNotExist:
        return Response({"error": "No active subscription found."}, status=status.HTTP_404_NOT_FOUND)

    if sub.status != Subscription.STATUS_ACTIVE:
        return Response({"error": "Subscription is not active."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        # Lemon Squeezy: DELETE cancels at period end by default
        response = requests.delete(
            _ls_api(f"/subscriptions/{sub.ls_subscription_id}"),
            headers=_ls_headers(),
        )
        response.raise_for_status()
        sub.status = Subscription.STATUS_CANCELED
        sub.save(update_fields=["status", "updated_at"])
        logger.info("Subscription canceled for %s", request.user.email)
        return Response({
            "message":      "Subscription canceled. Access continues until end of billing period.",
            "active_until": sub.current_period_end.isoformat() if sub.current_period_end else None,
        })
    except requests.HTTPError as e:
        logger.error("LS cancel failed: %s", str(e))
        return Response({"error": "Could not cancel. Please try again or contact support."}, status=status.HTTP_502_BAD_GATEWAY)
    except Exception as e:
        logger.error("Cancel error: %s", str(e))
        return Response({"error": "An unexpected error occurred."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ─────────────────────────────────────────────────────────
#  Update Payment Method
# ─────────────────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def update_payment_method_view(request):
    try:
        sub = Subscription.objects.get(user=request.user)
    except Subscription.DoesNotExist:
        return Response({"error": "No subscription found."}, status=status.HTTP_404_NOT_FOUND)

    try:
        response = requests.get(
            _ls_api(f"/subscriptions/{sub.ls_subscription_id}"),
            headers=_ls_headers(),
        )
        response.raise_for_status()
        url = response.json().get("data", {}).get("attributes", {}).get("urls", {}).get("update_payment_method")
        if url:
            return Response({"update_url": url})
        return Response({"error": "Could not generate link."}, status=status.HTTP_502_BAD_GATEWAY)
    except Exception as e:
        logger.error("PM update failed: %s", str(e))
        return Response({"error": "Could not generate link."}, status=status.HTTP_502_BAD_GATEWAY)


# ─────────────────────────────────────────────────────────
#  Webhook
# ─────────────────────────────────────────────────────────

@csrf_exempt
@require_POST
def lemonsqueezy_webhook_view(request):
    # ── Signature verification ────────────────────────────
    secret = getattr(settings, "LEMON_SQUEEZY_WEBHOOK_SECRET", "")
    if secret:
        sig_header = request.headers.get("X-Signature", "")
        expected = hmac.new(
            secret.encode("utf-8"),
            request.body,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, sig_header):
            error_logger.error("Webhook signature verification failed")
            return HttpResponse("Invalid signature", status=403)

    try:
        event = json.loads(request.body)
    except json.JSONDecodeError:
        return HttpResponse("Invalid payload", status=400)

    event_type = event.get("meta", {}).get("event_name", "")
    logger.info("Lemon Squeezy webhook received: %s", event_type)

    if event_type == "order_created":
        _handle_order_created(event)
    elif event_type == "subscription_created":
        _handle_subscription_created(event)
    elif event_type == "subscription_payment_success":
        _handle_subscription_renewal(event)
    elif event_type == "subscription_cancelled":
        _handle_subscription_cancelled(event)
    elif event_type == "subscription_updated":
        _handle_subscription_updated(event)
    else:
        logger.info("Unhandled webhook event: %s", event_type)

    return HttpResponse("OK", status=200)


# ─────────────────────────────────────────────────────────
#  Webhook handlers
# ─────────────────────────────────────────────────────────

def _handle_order_created(event):
    """Handles one-time credit pack purchases."""
    data       = event.get("data", {})
    attrs      = data.get("attributes", {})
    custom     = event.get("meta", {}).get("custom_data", {})
    user_id    = custom.get("user_id")
    product_key = custom.get("product_key")
    order_id   = str(data.get("id", ""))

    # Only process fully paid orders
    if attrs.get("status") != "paid":
        return

    # Skip subscription orders — handled by subscription_created
    if product_key in SUBSCRIPTION_PRODUCTS:
        return

    if not user_id:
        error_logger.error("ORDER RECEIVED BUT NO USER ID FOUND! order_id=%s", order_id)
        return

    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        error_logger.error("USER NOT FOUND: %s", user_id)
        return

    credits_to_add = getattr(settings, "LS_CREDIT_MAP", {}).get(product_key, 0)
    if credits_to_add <= 0:
        error_logger.error("Could not determine credits for product %s", product_key)
        return

    _persist_payment_and_grant_credits(
        user=user,
        order_id=order_id,
        product_key=product_key,
        attrs=attrs,
        credits_to_add=credits_to_add,
    )


def _handle_subscription_created(event):
    """Handles the first payment of a new subscription."""
    data        = event.get("data", {})
    attrs       = data.get("attributes", {})
    custom      = event.get("meta", {}).get("custom_data", {})
    user_id     = custom.get("user_id")
    product_key = custom.get("product_key", "standard_monthly")
    # LS subscription_created doesn't have an order_id directly;
    # use the subscription id prefixed so it stays unique.
    sub_id      = str(data.get("id", ""))
    order_id    = f"sub_created_{sub_id}"

    if not user_id:
        error_logger.error("SUBSCRIPTION RECEIVED BUT NO USER ID FOUND! sub_id=%s", sub_id)
        return

    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        error_logger.error("USER NOT FOUND: %s", user_id)
        return

    credits_to_add = getattr(settings, "LS_CREDIT_MAP", {}).get(product_key, 0)
    if credits_to_add <= 0:
        error_logger.error("Could not determine credits for product %s", product_key)
        return

    try:
        with transaction.atomic():
            payment, created = Payment.objects.get_or_create(
                ls_order_id=order_id,
                defaults={
                    "user":            user,
                    "payment_type":    Payment.TYPE_SUBSCRIPTION,
                    "status":          Payment.STATUS_COMPLETED,
                    "amount_cents":    _extract_amount(attrs),
                    "currency":        (attrs.get("currency") or "usd").lower(),
                    "credits_granted": credits_to_add,
                    "ls_variant_id":   str(attrs.get("variant_id", "")),
                    "description":     PRODUCT_LABELS.get(product_key, product_key),
                },
            )
            if not created:
                logger.info("Duplicate subscription event %s — skipping", order_id)
                return

            new_plan = User.PLAN_PRO if product_key == "pro_monthly" else User.PLAN_STANDARD
            User.objects.filter(pk=user.pk).update(
                credits=F("credits") + credits_to_add,
                plan=new_plan,
            )
            _upsert_subscription(user, data, attrs)
            logger.info("✅ SUBSCRIPTION CREDITS: %d → %s (sub: %s, plan: %s)", credits_to_add, user.email, sub_id, new_plan)
    except Exception as exc:
        error_logger.error("SUBSCRIPTION WEBHOOK ERROR: %s", str(exc))


def _handle_subscription_renewal(event):
    """Handles monthly subscription renewals — adds credits on each billing cycle."""
    data        = event.get("data", {})
    attrs       = data.get("attributes", {})
    custom      = event.get("meta", {}).get("custom_data", {})
    user_id     = custom.get("user_id")
    sub_id      = str(attrs.get("subscription_id", data.get("id", "")))

    if not user_id:
        # Try to find user via subscription record
        try:
            sub = Subscription.objects.get(ls_subscription_id=sub_id)
            user = sub.user
        except Subscription.DoesNotExist:
            error_logger.error("RENEWAL: no user_id and no subscription found sub_id=%s", sub_id)
            return
    else:
        try:
            user = User.objects.get(pk=user_id)
        except User.DoesNotExist:
            error_logger.error("RENEWAL: user not found user_id=%s", user_id)
            return

    # Determine plan from subscription record
    try:
        sub = Subscription.objects.get(user=user)
        product_key = "pro_monthly" if user.plan == User.PLAN_PRO else "standard_monthly"
    except Subscription.DoesNotExist:
        product_key = "standard_monthly"

    credits_to_add = getattr(settings, "LS_CREDIT_MAP", {}).get(product_key, 0)
    if credits_to_add <= 0:
        error_logger.error("RENEWAL: could not determine credits for %s", product_key)
        return

    order_id = f"renewal_{sub_id}_{attrs.get('created_at', '')}"
    _persist_payment_and_grant_credits(
        user=user,
        order_id=order_id,
        product_key=product_key,
        attrs=attrs,
        credits_to_add=credits_to_add,
    )
    logger.info("✅ RENEWAL CREDITS: %d → %s", credits_to_add, user.email)


def _handle_subscription_cancelled(event):
    data  = event.get("data", {})
    sub_id = str(data.get("id", ""))
    try:
        sub = Subscription.objects.get(ls_subscription_id=sub_id)
        sub.status = Subscription.STATUS_CANCELED
        sub.save(update_fields=["status", "updated_at"])
        User.objects.filter(pk=sub.user_id).update(plan=User.PLAN_FREE)
        logger.info("Sub canceled (webhook): %s", sub.user.email)
    except Subscription.DoesNotExist:
        logger.warning("Cancel for unknown sub: %s", sub_id)


def _handle_subscription_updated(event):
    data   = event.get("data", {})
    attrs  = data.get("attributes", {})
    sub_id = str(data.get("id", ""))
    try:
        sub = Subscription.objects.get(ls_subscription_id=sub_id)
        ls_status = attrs.get("status", "")
        if ls_status == "active":
            sub.status = Subscription.STATUS_ACTIVE
        elif ls_status == "past_due":
            sub.status = Subscription.STATUS_PAST_DUE
        elif ls_status in ("cancelled", "canceled", "expired"):
            sub.status = Subscription.STATUS_CANCELED

        if attrs.get("renews_at"):
            sub.current_period_end = attrs["renews_at"]

        sub.save(update_fields=["status", "current_period_end", "updated_at"])
        logger.info("Sub updated (webhook): %s → %s", sub.user.email, sub.status)
    except Subscription.DoesNotExist:
        logger.warning("Update for unknown sub: %s", sub_id)


# ─────────────────────────────────────────────────────────
#  Shared helpers
# ─────────────────────────────────────────────────────────

def _persist_payment_and_grant_credits(*, user, order_id, product_key, attrs, credits_to_add):
    try:
        with transaction.atomic():
            payment, created = Payment.objects.get_or_create(
                ls_order_id=order_id,
                defaults={
                    "user":            user,
                    "payment_type":    Payment.TYPE_CREDIT_PACK,
                    "status":          Payment.STATUS_COMPLETED,
                    "amount_cents":    _extract_amount(attrs),
                    "currency":        (attrs.get("currency") or "usd").lower(),
                    "credits_granted": credits_to_add,
                    "ls_variant_id":   str(attrs.get("first_order_item", {}).get("variant_id", "")),
                    "description":     PRODUCT_LABELS.get(product_key, product_key),
                },
            )
            if not created:
                logger.info("Duplicate order %s — skipping", order_id)
                return

            rows = User.objects.filter(pk=user.pk).update(credits=F("credits") + credits_to_add)
            if rows != 1:
                error_logger.error("DB update failed for %s", user.email)
                return

            logger.info("✅ CREDITS: %d → %s (order: %s)", credits_to_add, user.email, order_id)
    except Exception as exc:
        error_logger.error("WEBHOOK ERROR: %s", str(exc))


def _upsert_subscription(user, data, attrs):
    sub_id      = str(data.get("id", ""))
    customer_id = str(attrs.get("customer_id", ""))
    variant_id  = str(attrs.get("variant_id", ""))

    Subscription.objects.update_or_create(
        user=user,
        defaults={
            "ls_customer_id":     customer_id,
            "ls_subscription_id": sub_id,
            "ls_variant_id":      variant_id,
            "status":             Subscription.STATUS_ACTIVE,
            "current_period_end": attrs.get("renews_at"),
        },
    )


def _extract_amount(attrs):
    """Extract total in cents from a LS order or subscription attributes dict."""
    # Order: attrs.total (already in cents as integer string e.g. "1499")
    try:
        return int(attrs.get("total", 0))
    except (ValueError, TypeError):
        return 0