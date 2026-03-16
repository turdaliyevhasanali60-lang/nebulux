# accounts/views.py
"""
Auth endpoints
──────────────────────────────────────────────────────────────────
POST  /api/auth/register/         validate + store pending → send OTP
POST  /api/auth/verify-otp/       verify OTP → CREATE USER → JWT
POST  /api/auth/resend-otp/       resend OTP (rate-limited)
POST  /api/auth/login/            email + password → JWT
POST  /api/auth/google/           Google id_token → JWT
GET   /api/auth/google/callback/  OAuth redirect callback
POST  /api/auth/refresh/          refresh token → new access token
POST  /api/auth/logout/           blacklist refresh token
GET   /api/auth/me/               current user profile
PUT   /api/auth/me/               update display name
POST  /api/auth/change-password/  change password (authenticated)
POST  /api/auth/forgot-password/  send password reset link
POST  /api/auth/reset-password/   set new password via reset token
──────────────────────────────────────────────────────────────────

REGISTRATION FLOW
─────────────────
Step 1 — POST /register/
  • Validate email + password (serializer)
  • Reject if a VERIFIED account already exists for this email
  • Hash the password
  • Store {hashed_password, name} in Redis (pending_reg:{email}, TTL 10 min)
  • Generate OTP, store in Redis, fire email via Celery
  • Return 200  ← NO database write at this point

Step 2 — POST /verify-otp/
  • Validate OTP against Redis
  • Load pending registration from Redis
  • If found → create User in the database, mark is_email_verified=True
  • If NOT found → the user already exists (re-verification after prior
    successful registration) → just mark is_email_verified=True
  • Delete pending registration + OTP keys from Redis
  • Issue JWT and return

This guarantees: if the user never receives / enters the OTP, zero rows
are written to accounts_user.
──────────────────────────────────────────────────────────────────
"""
import logging
import urllib.parse

import requests as http_requests
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.shortcuts import redirect
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from .backends import verify_google_token
from .serializers import (
    ChangePasswordSerializer,
    ForgotPasswordSerializer,
    GoogleAuthSerializer,
    LoginSerializer,
    OnboardingSerializer,
    RegisterSerializer,
    ResendOTPSerializer,
    ResetPasswordSerializer,
    UpdateProfileSerializer,
    UserSerializer,
    VerifyOTPSerializer,
)
from .tasks import send_otp_email, send_password_reset_email
from .throttling import AuthForgotPasswordThrottle, AuthLoginThrottle, AuthRegisterThrottle
from .utils import (
    can_send_otp,
    can_send_reset,
    clear_login_failures,
    consume_reset_token,
    delete_pending_registration,
    generate_otp,
    generate_reset_token,
    get_pending_registration,
    is_login_locked,
    record_login_failure,
    record_otp_send,
    store_otp,
    store_pending_registration,
    verify_otp,
    verify_reset_token,
)

User   = get_user_model()
logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────
#  Internal helpers
# ─────────────────────────────────────────────

def _jwt_response(user) -> dict:
    """Issue a fresh access + refresh token pair for *user*."""
    refresh = RefreshToken.for_user(user)
    return {
        "access":  str(refresh.access_token),
        "refresh": str(refresh),
        "user":    UserSerializer(user).data,
    }


def _dispatch_otp(email: str, name: str) -> None:
    """Generate, store, and fire-and-forget an OTP email."""
    otp = generate_otp()
    store_otp(email, otp)
    record_otp_send(email)
    send_otp_email.delay(email, otp, name)


# ─────────────────────────────────────────────
#  Register  (Step 1 — NO DB write)
# ─────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthRegisterThrottle])
def register_view(request):
    """
    Validate credentials and send an OTP.
    A user account is NOT created here — only after the OTP is verified.
    """
    ser = RegisterSerializer(data=request.data)
    if not ser.is_valid():
        return Response({"error": ser.errors}, status=status.HTTP_400_BAD_REQUEST)

    email    = ser.validated_data["email"]
    password = ser.validated_data["password"]
    name     = ser.validated_data.get("name", "").strip()

    # Check OTP send rate before doing anything
    if not can_send_otp(email):
        return Response(
            {"error": "Too many verification emails sent. Please wait before trying again."},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    # Hash the password now — we never store the raw password anywhere
    hashed_password = make_password(password)

    # Store registration data in Redis only (no DB write)
    store_pending_registration(email, hashed_password, name)

    # Send OTP
    _dispatch_otp(email, name)

    logger.info("Pending registration created for %s — OTP dispatched", email)
    return Response(
        {"message": "Verification code sent — please check your inbox."},
        status=status.HTTP_200_OK,
    )


# ─────────────────────────────────────────────
#  Verify OTP  (Step 2 — DB write happens HERE)
# ─────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([AllowAny])
def verify_otp_view(request):
    """
    Verify the OTP and, on success, create the user account.

    Two scenarios handled:
      A) Normal new registration  → pending data in Redis → create user
      B) Re-verification          → user exists but is_email_verified=False
         (e.g. user registered before, OTP expired, re-sent code)
         → just flip the verified flag
    """
    ser = VerifyOTPSerializer(data=request.data)
    if not ser.is_valid():
        return Response({"error": ser.errors}, status=status.HTTP_400_BAD_REQUEST)

    email     = ser.validated_data["email"]
    submitted = ser.validated_data["otp"]

    # ── 1. Validate OTP ───────────────────────────────────────────
    ok, reason = verify_otp(email, submitted)
    if not ok:
        return Response({"error": reason}, status=status.HTTP_400_BAD_REQUEST)

    # ── 2. Retrieve pending registration data from Redis ──────────
    pending = get_pending_registration(email)

    # ── 3a. New registration — create the user now ────────────────
    if pending is not None:
        # Guard: another request may have already created the user
        # (e.g. double-submit). If so, fall through to scenario B.
        if not User.objects.filter(email=email).exists():
            user = User(
                email             = email,
                name              = pending.get("name", ""),
                is_email_verified = True,
                is_active         = True,
                plan              = User.PLAN_FREE,
                credits           = 0,      # Paid-only launch: no free credits
            )
            # Assign the pre-hashed password directly
            user.password = pending["hashed_password"]
            user.save()
            logger.info("User account created for %s after OTP verification", email)

            # Clean up Redis
            delete_pending_registration(email)

            return Response(_jwt_response(user), status=status.HTTP_201_CREATED)

        # Double-submit / race condition — user exists, fall through
        delete_pending_registration(email)

    # ── 3b. Re-verification — user already in DB ──────────────────
    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        # OTP was valid but no pending data and no user — this should
        # not happen in normal flow; surface a clear error.
        logger.warning(
            "OTP verified for %s but no pending registration and no existing user", email
        )
        return Response(
            {"error": "Registration data has expired. Please start the sign-up process again."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not user.is_active:
        return Response(
            {"error": "This account has been disabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    if not user.is_email_verified:
        user.is_email_verified = True
        user.save(update_fields=["is_email_verified", "updated_at"])
        logger.info("Email re-verified for existing user %s", email)

    return Response(_jwt_response(user), status=status.HTTP_200_OK)


# ─────────────────────────────────────────────
#  Resend OTP
# ─────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([AllowAny])
def resend_otp_view(request):
    ser = ResendOTPSerializer(data=request.data)
    if not ser.is_valid():
        return Response({"error": ser.errors}, status=status.HTTP_400_BAD_REQUEST)

    email = ser.validated_data["email"]

    if not can_send_otp(email):
        return Response(
            {"error": "Rate limit reached. Please wait before requesting another code."},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    # Determine the name to use in the email
    pending = get_pending_registration(email)
    if pending is not None:
        # Still in the new-registration flow — pending data exists
        name = pending.get("name", "")
    else:
        # Re-verification flow — check if the user exists in the DB
        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            # Don't reveal whether the email is registered
            return Response({"message": "If that address is registered, a new code was sent."})

        if user.is_email_verified:
            return Response(
                {"error": "This email is already verified."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        name = user.name

    _dispatch_otp(email, name)
    return Response({"message": "A new verification code has been sent."})


# ─────────────────────────────────────────────
#  Login
# ─────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthLoginThrottle])
def login_view(request):
    ser = LoginSerializer(data=request.data)
    if not ser.is_valid():
        return Response({"error": ser.errors}, status=status.HTTP_400_BAD_REQUEST)

    email    = ser.validated_data["email"]
    password = ser.validated_data["password"]

    if is_login_locked(email):
        return Response(
            {"error": "Too many failed attempts. Please wait 15 minutes before trying again."},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        record_login_failure(email)
        return Response({"error": "Invalid email or password."}, status=status.HTTP_401_UNAUTHORIZED)

    if not user.check_password(password):
        record_login_failure(email)
        return Response({"error": "Invalid email or password."}, status=status.HTTP_401_UNAUTHORIZED)

    if not user.is_active:
        return Response({"error": "This account has been disabled."}, status=status.HTTP_403_FORBIDDEN)

    if not user.is_email_verified:
        # Proactively resend OTP so the user can complete verification
        if can_send_otp(email):
            _dispatch_otp(email, user.name)
        return Response(
            {
                "error":                 "Please verify your email before signing in.",
                "requires_verification": True,
                "email":                 email,
            },
            status=status.HTTP_403_FORBIDDEN,
        )

    clear_login_failures(email)
    logger.info("Login: %s", email)
    return Response(_jwt_response(user), status=status.HTTP_200_OK)


# ─────────────────────────────────────────────
#  Google OAuth (ID token flow)
# ─────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([AllowAny])
def google_auth_view(request):
    ser = GoogleAuthSerializer(data=request.data)
    if not ser.is_valid():
        return Response({"error": ser.errors}, status=status.HTTP_400_BAD_REQUEST)

    payload = verify_google_token(ser.validated_data["id_token"])
    if not payload:
        return Response(
            {"error": "Invalid or expired Google token. Please try signing in again."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    email      = payload["email"]
    google_id  = payload["google_id"]
    name       = payload.get("name", "")
    avatar_url = payload.get("avatar_url", "")

    user = (
        User.objects.filter(google_id=google_id).first()
        or User.objects.filter(email=email).first()
    )

    if user is None:
        user = User.objects.create(
            email             = email,
            name              = name,
            avatar_url        = avatar_url,
            google_id         = google_id,
            is_email_verified = True,
            plan              = User.PLAN_FREE,
            credits           = 0,      # Paid-only launch: no free credits
        )
        logger.info("New user via Google: %s", email)
    else:
        dirty_fields = []
        if not user.google_id:
            user.google_id = google_id
            dirty_fields.append("google_id")
        if not user.is_email_verified:
            user.is_email_verified = True
            dirty_fields.append("is_email_verified")
        if not user.avatar_url and avatar_url:
            user.avatar_url = avatar_url
            dirty_fields.append("avatar_url")
        if not user.name and name:
            user.name = name
            dirty_fields.append("name")
        if dirty_fields:
            dirty_fields.append("updated_at")
            user.save(update_fields=dirty_fields)
        logger.info("Returning user via Google: %s", email)

    if not user.is_active:
        return Response({"error": "This account has been disabled."}, status=status.HTTP_403_FORBIDDEN)

    return Response(_jwt_response(user), status=status.HTTP_200_OK)


# ─────────────────────────────────────────────
#  Token refresh
# ─────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([AllowAny])
def refresh_view(request):
    refresh_token = request.data.get("refresh", "").strip()
    if not refresh_token:
        return Response({"error": "refresh token is required."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        refresh = RefreshToken(refresh_token)
        data    = {"access": str(refresh.access_token)}
        if getattr(settings, "SIMPLE_JWT", {}).get("ROTATE_REFRESH_TOKENS", False):
            if getattr(settings, "SIMPLE_JWT", {}).get("BLACKLIST_AFTER_ROTATION", False):
                try:
                    refresh.blacklist()
                except Exception:
                    pass
            refresh.set_jti()
            refresh.set_exp()
            data["refresh"] = str(refresh)
        return Response(data)
    except TokenError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_401_UNAUTHORIZED)


# ─────────────────────────────────────────────
#  Logout
# ─────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout_view(request):
    refresh_token = request.data.get("refresh", "").strip()
    if refresh_token:
        try:
            RefreshToken(refresh_token).blacklist()
        except TokenError:
            pass
    return Response({"message": "Signed out successfully."}, status=status.HTTP_200_OK)


# ─────────────────────────────────────────────
#  Profile
# ─────────────────────────────────────────────

@api_view(["GET", "PUT", "DELETE"])
@permission_classes([IsAuthenticated])
def profile_view(request):
    if request.method == "GET":
        data = UserSerializer(request.user).data
        data["has_usable_password"] = request.user.has_usable_password()
        return Response(data)

    if request.method == "DELETE":
        user = request.user
        logger.info("Account deletion for %s", user.email)
        user.delete()
        return Response({"message": "Account deleted."}, status=status.HTTP_200_OK)

    ser = UpdateProfileSerializer(request.user, data=request.data, partial=True)
    if not ser.is_valid():
        return Response({"error": ser.errors}, status=status.HTTP_400_BAD_REQUEST)
    ser.save()
    return Response(UserSerializer(request.user).data)


# ─────────────────────────────────────────────
#  Onboarding
# ─────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def onboarding_view(request):
    """Save onboarding answers and mark the user as onboarded."""
    ser = OnboardingSerializer(data=request.data)
    if not ser.is_valid():
        return Response({"error": ser.errors}, status=status.HTTP_400_BAD_REQUEST)

    user = request.user
    user.onboarding_data = ser.validated_data
    user.has_onboarded = True
    user.save(update_fields=["onboarding_data", "has_onboarded", "updated_at"])

    logger.info("Onboarding completed for %s", user.email)
    return Response(UserSerializer(user).data)


# ─────────────────────────────────────────────
#  Change password
# ─────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_password_view(request):
    ser = ChangePasswordSerializer(data=request.data)
    if not ser.is_valid():
        return Response({"error": ser.errors}, status=status.HTTP_400_BAD_REQUEST)

    user = request.user
    if not user.check_password(ser.validated_data["current_password"]):
        return Response(
            {"error": "Current password is incorrect."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user.set_password(ser.validated_data["new_password"])
    user.save(update_fields=["password", "updated_at"])

    refresh_token = request.data.get("refresh", "").strip()
    if refresh_token:
        try:
            RefreshToken(refresh_token).blacklist()
        except TokenError:
            pass

    logger.info("Password changed for %s", user.email)
    return Response({"message": "Password updated. Please sign in again."})


# ─────────────────────────────────────────────
#  Forgot password
# ─────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthForgotPasswordThrottle])
def forgot_password_view(request):
    ser = ForgotPasswordSerializer(data=request.data)
    if not ser.is_valid():
        return Response({"error": ser.errors}, status=status.HTTP_400_BAD_REQUEST)

    email      = ser.validated_data["email"]
    _GENERIC_OK = {"message": "If that email is registered, a reset link has been sent."}

    if not can_send_reset(email):
        return Response(_GENERIC_OK)

    try:
        user = User.objects.get(email=email, is_email_verified=True)
    except User.DoesNotExist:
        return Response(_GENERIC_OK)

    if not user.is_active:
        return Response(_GENERIC_OK)

    token     = generate_reset_token(email)
    frontend  = getattr(settings, "FRONTEND_URL", "http://localhost:8000")
    reset_url = f"{frontend}/reset-password/?token={token}"

    send_password_reset_email.delay(email, reset_url, user.name)
    logger.info("Password reset link dispatched to %s", email)
    return Response(_GENERIC_OK)


# ─────────────────────────────────────────────
#  Reset password
# ─────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([AllowAny])
def reset_password_view(request):
    ser = ResetPasswordSerializer(data=request.data)
    if not ser.is_valid():
        return Response({"error": ser.errors}, status=status.HTTP_400_BAD_REQUEST)

    token    = ser.validated_data["token"]
    password = ser.validated_data["password"]

    email = verify_reset_token(token)
    if not email:
        return Response(
            {"error": "Reset link is invalid or has expired. Please request a new one."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        return Response({"error": "User not found."}, status=status.HTTP_404_NOT_FOUND)

    user.set_password(password)
    user.save(update_fields=["password", "updated_at"])
    consume_reset_token(token)

    logger.info("Password reset completed for %s", email)
    return Response({"message": "Password reset successfully. You can now sign in."})


# ─────────────────────────────────────────────
#  Google OAuth — redirect / callback flow
# ─────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([AllowAny])
def google_callback_view(request):
    frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:8000")

    error = request.GET.get("error")
    if error:
        logger.warning("Google OAuth error: %s", error)
        return redirect(f"{frontend_url}/?google_error={urllib.parse.quote(error)}")

    code = request.GET.get("code")
    if not code:
        return redirect(f"{frontend_url}/?google_error=no_code")

    redirect_uri = f"{request.scheme}://{request.get_host()}/api/auth/google/callback/"

    try:
        token_resp = http_requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code":          code,
                "client_id":     settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri":  redirect_uri,
                "grant_type":    "authorization_code",
            },
            timeout=10,
        )
        token_data = token_resp.json()
    except Exception as exc:
        logger.error("Google token exchange failed: %s", exc)
        return redirect(f"{frontend_url}/?google_error=token_exchange_failed")

    if "error" in token_data:
        logger.error("Google token error: %s", token_data["error"])
        return redirect(f"{frontend_url}/?google_error={urllib.parse.quote(token_data['error'])}")

    try:
        user_info = http_requests.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {token_data['access_token']}"},
            timeout=10,
        ).json()
    except Exception as exc:
        logger.error("Google userinfo fetch failed: %s", exc)
        return redirect(f"{frontend_url}/?google_error=userinfo_failed")

    email = user_info.get("email")
    if not email:
        return redirect(f"{frontend_url}/?google_error=no_email")

    user = (
        User.objects.filter(google_id=user_info.get("id", "")).first()
        or User.objects.filter(email=email).first()
    )

    if user is None:
        user = User.objects.create(
            email             = email,
            name              = user_info.get("name", ""),
            avatar_url        = user_info.get("picture", ""),
            google_id         = user_info.get("id", ""),
            is_email_verified = True,
            plan              = User.PLAN_FREE,
            credits           = 0,      # Paid-only launch: no free credits
        )
        logger.info("New user via Google OAuth: %s", email)
    else:
        dirty = []
        if not user.google_id and user_info.get("id"):
            user.google_id = user_info["id"]; dirty.append("google_id")
        if not user.is_email_verified:
            user.is_email_verified = True; dirty.append("is_email_verified")
        if not user.avatar_url and user_info.get("picture"):
            user.avatar_url = user_info["picture"]; dirty.append("avatar_url")
        if not user.name and user_info.get("name"):
            user.name = user_info["name"]; dirty.append("name")
        if dirty:
            dirty.append("updated_at"); user.save(update_fields=dirty)
        logger.info("Returning user via Google OAuth: %s", email)

    if not user.is_active:
        return redirect(f"{frontend_url}/?google_error=account_disabled")

    tokens = _jwt_response(user)
    params = urllib.parse.urlencode({
        "g_access":  tokens["access"],
        "g_refresh": tokens["refresh"],
    })
    return redirect(f"{frontend_url}/?{params}")