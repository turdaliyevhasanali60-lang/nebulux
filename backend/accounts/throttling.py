# accounts/throttling.py
"""
Rate-limiting classes for the accounts (auth) API.

All auth endpoints are public-facing (no JWT required) so we throttle
by IP address — using Django REST Framework's AnonRateThrottle as the
base, which already implements get_cache_key() using the client IP.

The rates themselves live in settings.DEFAULT_THROTTLE_RATES:
    "auth_register": "5/hour"
    "auth_login":    "20/minute"
    "auth_forgot":   "5/hour"

──────────────────────────────────────────────────────────────────
BUG FIX vs the original file:
  The original classes extended SimpleRateThrottle directly without
  overriding get_cache_key(), which raises NotImplementedError at
  runtime on the very first throttled request.

  Fix: extend AnonRateThrottle, which provides a correct IP-based
  get_cache_key() implementation out of the box.
──────────────────────────────────────────────────────────────────
"""
from rest_framework.throttling import AnonRateThrottle


class AuthLoginThrottle(AnonRateThrottle):
    """
    Throttles login attempts by client IP.
    Complements the Redis-based brute-force lockout in accounts/utils.py
    — two independent gates means an attacker bypassing DRF throttling
    (e.g. from multiple IPs) still hits the per-email Redis lockout.
    """
    scope = "auth_login"


class AuthRegisterThrottle(AnonRateThrottle):
    """
    Throttles registration attempts by client IP.
    Prevents mass account creation / email-flooding attacks.
    """
    scope = "auth_register"


class AuthForgotPasswordThrottle(AnonRateThrottle):
    """
    Throttles forgot-password requests by client IP.
    Complements the per-email Redis send counter in accounts/utils.py.
    """
    scope = "auth_forgot"