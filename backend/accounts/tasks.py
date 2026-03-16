# accounts/tasks.py
"""
Celery tasks for the accounts app.

All email tasks:
  - retry up to 3× with exponential back-off (5 s → 25 s → 125 s)
  - are fire-and-forget (ignore_result=True)
  - log every send attempt for observability

NOTE ON LOGO:
  Gmail strips base64 data URIs — the only reliable cross-client method
  is CID (Content-ID) inline attachment. The logo is attached to the email
  as a MIME part and referenced in HTML as <img src="cid:nebulux_logo">.
  This works in Gmail, Outlook, Apple Mail, and all major clients.

  Logo file: frontend/static/img/logo_email.png
  (transparent-background PNG, ~72px tall — included in outputs/)
"""
import logging
import os
from email.mime.image import MIMEImage

from celery import shared_task
from django.conf import settings
from django.core.mail import EmailMultiAlternatives

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
#  Logo path
# ─────────────────────────────────────────────

def _logo_path() -> str:
    # 1. Explicit override in settings takes priority — set EMAIL_LOGO_PATH
    #    to the absolute path of logo_email.png in your Django settings to
    #    guarantee Celery workers always find it regardless of environment.
    explicit = getattr(settings, "EMAIL_LOGO_PATH", None)
    if explicit:
        logger.debug("Logo path (from settings.EMAIL_LOGO_PATH): %s", explicit)
        return explicit

    # 2. Fallback: derive from settings.BASE_DIR (same logic as original)
    computed = os.path.normpath(
        os.path.join(settings.BASE_DIR, "..", "frontend", "static", "img", "logo_email.png")
    )
    logger.debug("Logo path (computed from BASE_DIR): %s", computed)
    return computed


# ─────────────────────────────────────────────
#  Shared email sender  (with CID logo attachment)
# ─────────────────────────────────────────────

def _send_html_email(subject: str, text_body: str, html_body: str, to: str) -> None:
    msg = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[to],
    )
    msg.attach_alternative(html_body, "text/html")

    # Attach logo as inline CID image — the only method Gmail supports
    logo_path = _logo_path()
    if os.path.exists(logo_path):
        with open(logo_path, "rb") as f:
            logo = MIMEImage(f.read(), _subtype="png")
        logo.add_header("Content-ID", "<nebulux_logo>")
        logo.add_header("Content-Disposition", "inline", filename="logo.png")
        msg.attach(logo)
    else:
        logger.warning("Logo not found at %s — email will show text fallback. "
                       "Set EMAIL_LOGO_PATH in Django settings to the absolute path of logo_email.png.", logo_path)

    msg.send(fail_silently=False)


# ─────────────────────────────────────────────
#  Shared HTML wrapper
# ─────────────────────────────────────────────

def _wrap_html(inner: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{{box-sizing:border-box;margin:0;padding:0}}
    body{{background:#000000;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#ffffff;-webkit-font-smoothing:antialiased}}
    .outer{{padding:48px 24px 64px}}
    .card{{max-width:480px;margin:0 auto;background:#111111;border:1px solid #222222;border-radius:4px;overflow:hidden}}
    .header{{padding:28px 40px;border-bottom:1px solid #222222;display:flex;align-items:center;justify-content:center}}
    .logo-img{{height:36px;width:auto;display:block}}
    .header-logo{{flex-shrink:0;margin-right:20px}}.header-name{{font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.03em;text-align:center}}.header-name{{font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.03em;text-align:center}}
    .rule{{height:1px;background:#F7941D;margin:0}}
    .content{{padding:48px 40px 40px}}
    .greeting{{font-size:13px;color:#dddddd;letter-spacing:0.02em;margin-bottom:16px}}
    .message{{font-size:15px;color:#ffffff;line-height:1.7;margin-bottom:40px}}
    .otp-label{{font-size:10px;font-weight:600;color:#aaaaaa;text-transform:uppercase;letter-spacing:0.2em;margin-bottom:16px}}
    .otp-code{{font-size:56px;font-weight:300;letter-spacing:0.18em;color:#ffffff;font-family:'Courier New',Courier,monospace;line-height:1}}
    .otp-expiry{{margin-top:14px;font-size:12px;color:#bbbbbb;letter-spacing:0.04em}}
    .divider{{height:1px;background:#222222;margin:40px 0}}
    .btn{{display:inline-block;padding:13px 32px;background:#ffffff;color:#000000;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;border-radius:2px}}
    .link-expiry{{margin-top:18px;font-size:12px;color:#bbbbbb;letter-spacing:0.04em}}
    .footnote{{font-size:12px;color:#aaaaaa;line-height:1.6}}
    .footer{{padding:22px 40px;border-top:1px solid #222222}}
    .footer-text{{font-size:11px;color:#666666;letter-spacing:0.03em}}
  </style>
</head>
<body>
  <div class="outer">
    <div class="card">
      <div class="header">
        <div class="header-logo"><img src="cid:nebulux_logo" alt="Nebulux" class="logo-img"></div>
        <div class="header-name">Nebulux</div>
      </div>
      <div class="rule"></div>
      <div class="content">{inner}</div>
      <div class="footer">
        <p class="footer-text">© 2026 Nebulux &nbsp;·&nbsp; All rights reserved</p>
      </div>
    </div>
  </div>
</body>
</html>"""


# ─────────────────────────────────────────────
#  Task: OTP email
# ─────────────────────────────────────────────

@shared_task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=5,
    retry_backoff_max=300,
    retry_kwargs={"max_retries": 3},
    name="accounts.send_otp_email",
    ignore_result=True,
)
def send_otp_email(self, email: str, otp: str, name: str = "") -> None:
    """Send a 6-digit OTP verification email asynchronously."""
    greeting = f"Hi {name.strip()}," if name.strip() else "Hi there,"

    inner = f"""
      <p class="greeting">{greeting}</p>
      <p class="message">Your one-time verification code for Nebulux.</p>
      <p class="otp-label">Verification Code</p>
      <p class="otp-code">{otp}</p>
      <p class="otp-expiry">Expires in 5 minutes</p>
      <div class="divider"></div>
      <p class="footnote">If you didn't request this, you can safely ignore this email.</p>
    """
    text = (
        f"{greeting}\n\nYour Nebulux verification code is: {otp}\n\n"
        f"This code expires in 5 minutes.\n"
        f"If you didn't request this, you can safely ignore this email.\n\n"
        f"— Nebulux"
    )
    try:
        _send_html_email("Your verification code", text, _wrap_html(inner), email)
        logger.info("OTP email sent → %s", email)
    except Exception as exc:
        logger.error("OTP email failed for %s: %s", email, exc)
        raise


# ─────────────────────────────────────────────
#  Task: Password reset email
# ─────────────────────────────────────────────

@shared_task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=5,
    retry_backoff_max=300,
    retry_kwargs={"max_retries": 3},
    name="accounts.send_password_reset_email",
    ignore_result=True,
)
def send_password_reset_email(self, email: str, reset_url: str, name: str = "") -> None:
    """Send a password reset link email asynchronously."""
    greeting = f"Hi {name.strip()}," if name.strip() else "Hi there,"

    inner = f"""
      <p class="greeting">{greeting}</p>
      <p class="message">We received a request to reset your Nebulux password.<br>Use the link below to set a new one.</p>
      <a href="{reset_url}" class="btn">Reset Password</a>
      <p class="link-expiry">This link expires in 1 hour</p>
      <div class="divider"></div>
      <p class="footnote">If you didn't request a password reset, you can safely ignore this email. Your password will not change.</p>
    """
    text = (
        f"{greeting}\n\nReset your Nebulux password:\n{reset_url}\n\n"
        f"This link expires in 1 hour.\n"
        f"If you didn't request this, ignore this email.\n\n"
        f"— Nebulux"
    )
    try:
        _send_html_email("Reset your password", text, _wrap_html(inner), email)
        logger.info("Password reset email sent → %s", email)
    except Exception as exc:
        logger.error("Password reset email failed for %s: %s", email, exc)
        raise


# ─────────────────────────────────────────────
#  Task: Monthly credit reset  (scheduled via Celery Beat)
# ─────────────────────────────────────────────

@shared_task(
    name="accounts.reset_monthly_credits",
    ignore_result=True,
)
def reset_monthly_credits() -> None:
    """
    Reset every active user's credits to their plan's monthly allowance.
    Scheduled to run at 00:00 UTC on the 1st of every month via Celery Beat.
    """
    from django.contrib.auth import get_user_model
    User = get_user_model()

    plan_credits = {
        # Token units (1 TU = 1,000 API tokens). Standard = 1,000 TU ≈ 15 websites/month.
        User.PLAN_FREE:     0,
        User.PLAN_STANDARD: 1_000,
        User.PLAN_PRO:      5_000,
    }

    total = 0
    for plan, credits in plan_credits.items():
        updated = (
            User.objects
            .filter(is_active=True, plan=plan)
            .update(credits=credits)
        )
        total += updated
        logger.info("Credit reset: %d %s user(s) → %d credits", updated, plan, credits)

    logger.info("Monthly credit reset complete — %d user(s) updated", total)