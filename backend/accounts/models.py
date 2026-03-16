# accounts/models.py
"""
Custom User model for Nebulux — production-ready for 10 000 + users.

Design:
  - Email is the login credential (no username)
  - UUID primary key — no sequential IDs in URLs
  - Plan + credits stored directly for O(1) reads without joins
  - Google OAuth via google_id field
  - is_email_verified gate — account unusable until confirmed
  - deduct_credit() is atomic via a conditional UPDATE (no lost updates under concurrency)

DEPLOYMENT NOTE (v2 — Paid-Only Launch):
  - Default credits changed from 30 → 0
  - Free plan users get ZERO credits — must upgrade to Standard to generate
  - Credits are granted only via Stripe purchase (webhook adds them atomically)
"""
import uuid
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone


# ─────────────────────────────────────────────
#  Manager
# ─────────────────────────────────────────────
class UserManager(BaseUserManager):

    def create_user(self, email: str, password: str | None = None, **extra_fields):
        if not email:
            raise ValueError("An email address is required.")
        email = self.normalize_email(email).lower().strip()
        extra_fields.setdefault("is_active", True)
        user = self.model(email=email, **extra_fields)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_superuser(self, email: str, password: str, **extra_fields):
        extra_fields.setdefault("is_staff",          True)
        extra_fields.setdefault("is_superuser",      True)
        extra_fields.setdefault("is_email_verified", True)
        if not extra_fields["is_staff"]:
            raise ValueError("Superuser must have is_staff=True.")
        if not extra_fields["is_superuser"]:
            raise ValueError("Superuser must have is_superuser=True.")
        return self.create_user(email, password, **extra_fields)


# ─────────────────────────────────────────────
#  User
# ─────────────────────────────────────────────
class User(AbstractBaseUser, PermissionsMixin):
    PLAN_FREE     = "free"
    PLAN_STANDARD = "standard"
    PLAN_PRO      = "pro"
    PLAN_CHOICES  = [
        (PLAN_FREE,     "Free"),
        (PLAN_STANDARD, "Standard"),
        (PLAN_PRO,      "Pro"),
    ]

    # ── Identity
    id         = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email      = models.EmailField(unique=True, db_index=True)
    name       = models.CharField(max_length=255, blank=True)
    avatar_url = models.URLField(max_length=500, blank=True)

    # ── Auth flags
    is_active         = models.BooleanField(default=True)
    is_staff          = models.BooleanField(default=False)
    is_email_verified = models.BooleanField(default=False, db_index=True)

    # ── OAuth
    google_id = models.CharField(
        max_length=128, unique=True, null=True, blank=True, db_index=True
    )

    # ── Subscription
    plan    = models.CharField(
        max_length=20, choices=PLAN_CHOICES, default=PLAN_FREE, db_index=True
    )
    # ── PAID-ONLY LAUNCH: new users start with 0 credits ──
    credits = models.PositiveIntegerField(default=0)

    # ── Onboarding
    has_onboarded   = models.BooleanField(default=False)
    onboarding_data = models.JSONField(default=dict, blank=True)

    # ── Timestamps
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD  = "email"
    REQUIRED_FIELDS = []

    objects = UserManager()

    class Meta:
        db_table            = "accounts_user"
        verbose_name        = "User"
        verbose_name_plural = "Users"
        ordering            = ["-created_at"]
        indexes = [
            models.Index(fields=["email", "is_email_verified"]),
            models.Index(fields=["plan", "-created_at"]),
            models.Index(fields=["google_id"]),
        ]

    def __str__(self) -> str:
        return self.email

    # ── Convenience props

    @property
    def display_name(self) -> str:
        return self.name.strip() or self.email.split("@")[0]

    @property
    def monthly_credit_limit(self) -> int:
        # Credits are now TOKEN UNITS (1 TU = 1,000 API tokens).
        # Standard plan: 1,000 TU ≈ 15 complete websites/month.
        return {
            self.PLAN_FREE:     0,
            self.PLAN_STANDARD: 1_000,
            self.PLAN_PRO:      5_000,
        }.get(self.plan, 0)

    def deduct_credit(self, amount: int = 1) -> bool:
        """
        Atomic token-unit deduction — safe under high concurrency.
        amount = tokens_used // 1000  (1 TU = 1,000 API tokens, minimum 1).
        Uses a conditional UPDATE so two simultaneous requests can't both
        succeed when credits run out.
        Returns True on success, False when insufficient credits.
        """
        updated = (
            User.objects.filter(pk=self.pk, credits__gte=amount)
            .update(credits=models.F("credits") - amount)
        )
        if updated:
            self.credits -= amount  # keep in-memory value in sync
            return True
        return False