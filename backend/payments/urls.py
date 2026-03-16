# payments/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path("create-checkout/",        views.create_checkout_view,        name="create-checkout"),
    path("webhook/",                views.lemonsqueezy_webhook_view,   name="lemonsqueezy-webhook"),
    path("billing/",                views.billing_info_view,           name="billing-info"),
    path("cancel-subscription/",    views.cancel_subscription_view,    name="cancel-subscription"),
    path("update-payment-method/",  views.update_payment_method_view,  name="update-payment-method"),
]