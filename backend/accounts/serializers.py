# accounts/serializers.py
import re

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.validators import EmailValidator
from rest_framework import serializers

User = get_user_model()

# Minimum password requirements (on top of Django's built-in validators)
_PASSWORD_RE = re.compile(r'^(?=.*[a-zA-Z])(?=.*\d).{8,}$')


def _validate_strong_password(value: str) -> str:
    """Must be ≥8 chars and contain at least one letter and one digit."""
    if not _PASSWORD_RE.match(value):
        raise serializers.ValidationError(
            "Password must be at least 8 characters and contain a letter and a number."
        )
    return value


# ── Inbound ────────────────────────────────────────────────────────────────

class RegisterSerializer(serializers.Serializer):
    email    = serializers.EmailField(validators=[EmailValidator()])
    password = serializers.CharField(min_length=8, max_length=128, write_only=True)
    name     = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")

    def validate_email(self, value: str) -> str:
        email = value.lower().strip()
        if User.objects.filter(email=email, is_email_verified=True).exists():
            raise serializers.ValidationError(
                "An account with this email already exists. Please sign in."
            )
        return email

    def validate_password(self, value: str) -> str:
        return _validate_strong_password(value)


class VerifyOTPSerializer(serializers.Serializer):
    email = serializers.EmailField()
    otp   = serializers.CharField(min_length=6, max_length=6)

    def validate_otp(self, value: str) -> str:
        if not value.isdigit():
            raise serializers.ValidationError("OTP must be a 6-digit number.")
        return value

    def validate_email(self, value: str) -> str:
        return value.lower().strip()


class ResendOTPSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def validate_email(self, value: str) -> str:
        return value.lower().strip()


class LoginSerializer(serializers.Serializer):
    email    = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate_email(self, value: str) -> str:
        return value.lower().strip()


class GoogleAuthSerializer(serializers.Serializer):
    id_token = serializers.CharField(min_length=10)


class ForgotPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def validate_email(self, value: str) -> str:
        return value.lower().strip()


class ResetPasswordSerializer(serializers.Serializer):
    token    = serializers.CharField(min_length=64, max_length=64)
    password = serializers.CharField(min_length=8, max_length=128, write_only=True)

    def validate_password(self, value: str) -> str:
        return _validate_strong_password(value)


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password     = serializers.CharField(min_length=8, max_length=128, write_only=True)

    def validate_new_password(self, value: str) -> str:
        return _validate_strong_password(value)


class UpdateProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model  = User
        fields = ["name"]

    def validate_name(self, value: str) -> str:
        return value.strip()


# ── Outbound ───────────────────────────────────────────────────────────────

class UserSerializer(serializers.ModelSerializer):
    display_name         = serializers.ReadOnlyField()
    monthly_credit_limit = serializers.ReadOnlyField()

    class Meta:
        model  = User
        fields = [
            "id", "email", "name", "display_name", "avatar_url",
            "plan", "credits", "monthly_credit_limit",
            "is_email_verified", "has_onboarded", "created_at",
        ]
        read_only_fields = fields


class OnboardingSerializer(serializers.Serializer):
    heard_from = serializers.CharField(max_length=100)
    role       = serializers.CharField(max_length=100)
    use_case   = serializers.CharField(max_length=100)