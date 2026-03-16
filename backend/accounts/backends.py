# accounts/backends.py
"""
Google ID token verification.

The frontend uses Google Identity Services (GSI) to obtain an id_token,
then POSTs it to /api/auth/google/.  We verify it server-side using
Google's public keys — no round-trip to Google's OAuth server needed.

Package required: google-auth (pip install google-auth)
"""
import logging
from typing import Optional

from django.conf import settings
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

logger = logging.getLogger(__name__)


def verify_google_token(token: str) -> Optional[dict]:
    """
    Verify a Google ID token and return a normalised payload dict on success.

    Returns None if the token is invalid, expired, or issued for a different client.

    Returned dict keys:
        google_id       — Google user sub (stable across token refreshes)
        email           — verified email address
        name            — display name (may be empty)
        avatar_url      — profile picture URL (may be empty)
        email_verified  — always True (we reject unverified accounts below)
    """
    client_id = getattr(settings, "GOOGLE_CLIENT_ID", "")
    if not client_id:
        logger.error("GOOGLE_CLIENT_ID is not configured — Google login is disabled.")
        return None

    try:
        id_info = google_id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            client_id,
        )
    except ValueError as exc:
        logger.warning("Google token verification failed: %s", exc)
        return None
    except Exception as exc:
        logger.error("Unexpected error verifying Google token: %s", exc)
        return None

    # Extra safety: confirm the token was issued for our app
    audience = id_info.get("aud")
    if audience != client_id:
        logger.warning(
            "Google token audience mismatch — expected %s, got %s",
            client_id, audience,
        )
        return None

    # Reject unverified Google accounts (very rare but possible)
    if not id_info.get("email_verified", False):
        logger.warning(
            "Google account email not verified for sub=%s", id_info.get("sub")
        )
        return None

    return {
        "google_id":     id_info["sub"],
        "email":         id_info["email"].lower().strip(),
        "name":          id_info.get("name", ""),
        "avatar_url":    id_info.get("picture", ""),
        "email_verified": True,
    }
