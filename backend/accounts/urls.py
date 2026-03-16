# accounts/urls.py
from django.urls import path
from . import views

urlpatterns = [
    # ── Registration & OTP
    path("register/",         views.register_view,         name="auth-register"),
    path("verify-otp/",       views.verify_otp_view,       name="auth-verify-otp"),
    path("resend-otp/",       views.resend_otp_view,       name="auth-resend-otp"),

    # ── Session
    path("login/",            views.login_view,            name="auth-login"),
    path("google/",           views.google_auth_view,      name="auth-google"),
    path("google/callback/",  views.google_callback_view,  name="auth-google-callback"),
    path("refresh/",          views.refresh_view,          name="auth-refresh"),
    path("logout/",           views.logout_view,           name="auth-logout"),

    # ── Profile
    path("me/",               views.profile_view,          name="auth-profile"),
    path("onboarding/",       views.onboarding_view,       name="auth-onboarding"),
    path("change-password/",  views.change_password_view,  name="auth-change-password"),

    # ── Password reset
    path("forgot-password/",  views.forgot_password_view,  name="auth-forgot-password"),
    path("reset-password/",   views.reset_password_view,   name="auth-reset-password"),
]