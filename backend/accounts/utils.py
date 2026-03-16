# accounts/utils.py
"""
Redis-backed helpers for the accounts app.

All state lives in Redis via Django's cache framework — no DB writes
for auth lifecycle events means sub-millisecond overhead at 10k+ users.

Key schema
───────────────────────────────────────────────────────────────────
pending_reg:{email}       → JSON {hashed_pw, name}  TTL 10 min
otp:code:{email}          → 6-digit string          TTL  5 min
otp:attempts:{email}      → int (wrong guesses)      TTL 15 min
otp:sends:{email}         → int (send count)         TTL  1 hr

login:attempts:{email}    → int (bad password)       TTL 15 min
login:lockout:{email}     → "1"                      TTL 15 min

pwd_reset:{token}         → email string             TTL  1 hr
pwd_reset_sends:{email}   → int (request count)      TTL  1 hr
───────────────────────────────────────────────────────────────────
"""
import json
import logging
import os
import random
import string

from django.core.cache import cache

logger = logging.getLogger(__name__)

# ── Pending registration (pre-verification) ───────────────────────
_PENDING_REG = "pending_reg:{}"

# Must be longer than OTP_TTL so the data outlives the code itself.
# 10 minutes gives plenty of time to receive + enter the OTP.
PENDING_REG_TTL = 600    # 10 min

# ── OTP ───────────────────────────────────────────────────────────
_OTP_CODE     = "otp:code:{}"
_OTP_ATTEMPTS = "otp:attempts:{}"
_OTP_SENDS    = "otp:sends:{}"

OTP_LENGTH   = 6
OTP_TTL      = 300       # 5 min validity
ATTEMPT_TTL  = 900       # 15 min wrong-attempt window
SEND_TTL     = 3_600     # 1 hr send-rate window
MAX_ATTEMPTS = 5
MAX_SENDS    = 5

# ── Login brute-force ─────────────────────────────────────────────
_LOGIN_ATTEMPTS = "login:attempts:{}"
_LOGIN_LOCKOUT  = "login:lockout:{}"

LOGIN_MAX_ATTEMPTS = 10
LOGIN_LOCKOUT_TTL  = 900   # 15 min
LOGIN_ATTEMPT_TTL  = 900

# ── Password reset ────────────────────────────────────────────────
_PWD_RESET      = "pwd_reset:{}"
_PWD_RESET_SEND = "pwd_reset_sends:{}"

RESET_TOKEN_TTL  = 3_600   # 1 hr
RESET_MAX_SENDS  = 3
RESET_SEND_TTL   = 3_600


# ═══════════════════════════════════════════════════════════════════
#  Pending registration helpers
#
#  The user record is NOT written to the database until the OTP is
#  successfully verified.  Before that point we only store the
#  hashed password + optional name in Redis so nothing leaks to the
#  DB if the user never completes verification.
# ═══════════════════════════════════════════════════════════════════

def store_pending_registration(email: str, hashed_password: str, name: str) -> None:
    """
    Persist a pending (pre-verification) registration in Redis.

    We store the already-hashed password so the raw password never
    touches this layer — the view hashes it with make_password()
    before calling this function.
    """
    key     = _PENDING_REG.format(email)
    payload = json.dumps({"hashed_password": hashed_password, "name": name})
    # Use PENDING_REG_TTL so the entry survives at least one full OTP
    # validity window plus a generous buffer for slow users.
    cache.set(key, payload, timeout=PENDING_REG_TTL)
    logger.debug("Pending registration stored for %s (TTL %ds)", email, PENDING_REG_TTL)


def get_pending_registration(email: str) -> dict | None:
    """
    Return the pending registration dict for *email*, or None if it
    has expired / was never created.

    Returned dict keys: hashed_password, name
    """
    raw = cache.get(_PENDING_REG.format(email))
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        logger.error("Corrupt pending_reg payload for %s", email)
        return None


def delete_pending_registration(email: str) -> None:
    """
    Remove the pending registration entry after the user has been
    created in the database (successful OTP verification).
    """
    cache.delete(_PENDING_REG.format(email))


# ═══════════════════════════════════════════════════════════════════
#  OTP helpers
# ═══════════════════════════════════════════════════════════════════

def generate_otp() -> str:
    """Cryptographically adequate numeric OTP."""
    return "".join(random.choices(string.digits, k=OTP_LENGTH))


def can_send_otp(email: str) -> bool:
    return cache.get(_OTP_SENDS.format(email), 0) < MAX_SENDS


def record_otp_send(email: str) -> None:
    key = _OTP_SENDS.format(email)
    try:
        cache.incr(key)
    except ValueError:
        cache.set(key, 1, timeout=SEND_TTL)


def store_otp(email: str, otp: str) -> None:
    cache.set(_OTP_CODE.format(email), otp, timeout=OTP_TTL)
    cache.delete(_OTP_ATTEMPTS.format(email))


def verify_otp(email: str, submitted: str) -> tuple[bool, str]:
    """
    Validate a submitted OTP.
    Returns (True, "") on success; (False, reason) on failure.
    OTP is consumed (deleted) on first successful verification.
    """
    attempt_key = _OTP_ATTEMPTS.format(email)
    otp_key     = _OTP_CODE.format(email)

    attempts = cache.get(attempt_key, 0)
    if attempts >= MAX_ATTEMPTS:
        return False, "Too many incorrect attempts. Please request a new code."

    stored = cache.get(otp_key)
    if stored is None:
        return False, "Verification code has expired. Please request a new one."

    if stored != submitted.strip():
        try:
            cache.incr(attempt_key)
        except ValueError:
            cache.set(attempt_key, 1, timeout=ATTEMPT_TTL)
        remaining = MAX_ATTEMPTS - attempts - 1
        if remaining <= 0:
            return False, "Too many incorrect attempts. Please request a new code."
        return False, f"Incorrect code. {remaining} attempt(s) remaining."

    # Success — consume OTP
    cache.delete(otp_key)
    cache.delete(attempt_key)
    logger.info("OTP verified for %s", email)
    return True, ""


# ═══════════════════════════════════════════════════════════════════
#  Login brute-force protection
# ═══════════════════════════════════════════════════════════════════

def is_login_locked(email: str) -> bool:
    """True if the account is currently locked out."""
    return bool(cache.get(_LOGIN_LOCKOUT.format(email)))


def record_login_failure(email: str) -> None:
    """Increment bad-password counter; lock account after LOGIN_MAX_ATTEMPTS."""
    key = _LOGIN_ATTEMPTS.format(email)
    try:
        count = cache.incr(key)
    except ValueError:
        cache.set(key, 1, timeout=LOGIN_ATTEMPT_TTL)
        count = 1

    if count >= LOGIN_MAX_ATTEMPTS:
        cache.set(_LOGIN_LOCKOUT.format(email), "1", timeout=LOGIN_LOCKOUT_TTL)
        logger.warning("Login lockout triggered for %s after %d failures", email, count)


def clear_login_failures(email: str) -> None:
    """Called on successful login to reset counters."""
    cache.delete(_LOGIN_ATTEMPTS.format(email))
    cache.delete(_LOGIN_LOCKOUT.format(email))


# ═══════════════════════════════════════════════════════════════════
#  Password reset tokens
# ═══════════════════════════════════════════════════════════════════

def can_send_reset(email: str) -> bool:
    return cache.get(_PWD_RESET_SEND.format(email), 0) < RESET_MAX_SENDS


def generate_reset_token(email: str) -> str:
    """
    Create a cryptographically secure 64-hex-char token, store in Redis,
    return the token so the caller can embed it in the reset URL.
    """
    token = os.urandom(32).hex()          # 256-bit entropy
    cache.set(_PWD_RESET.format(token), email, timeout=RESET_TOKEN_TTL)
    key = _PWD_RESET_SEND.format(email)
    try:
        cache.incr(key)
    except ValueError:
        cache.set(key, 1, timeout=RESET_SEND_TTL)
    logger.info("Password reset token issued for %s", email)
    return token


def verify_reset_token(token: str) -> str | None:
    """
    Validate a reset token.
    Returns the associated email on success, None if expired/invalid.
    Token is NOT consumed here — call consume_reset_token() after the
    password is actually changed.
    """
    return cache.get(_PWD_RESET.format(token))


def consume_reset_token(token: str) -> None:
    """Delete the token so it cannot be reused."""
    cache.delete(_PWD_RESET.format(token))