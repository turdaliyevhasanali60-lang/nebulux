# generator/authentication.py
"""
JWT Bearer token authentication for the generator API.

This replaces the old APIKeyAuthentication stub.
Clients send:  Authorization: Bearer <access_token>

The access token is issued by /api/auth/login/, /api/auth/google/,
or /api/auth/verify-otp/ and refreshed via /api/auth/refresh/.
"""
from rest_framework_simplejwt.authentication import JWTAuthentication


class BearerAuthentication(JWTAuthentication):
    """
    Standard JWT authentication via the Authorization: Bearer header.

    Inheriting from JWTAuthentication gives us:
      - Token validation against Django's signing key
      - Automatic user lookup from the token's user_id claim
      - Token blacklist support (for logout)
    """
    pass
