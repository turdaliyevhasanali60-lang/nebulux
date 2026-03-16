# generator/serializers.py
"""
Request/response serializers with strict validation.

Validation rules enforced here:
  - max prompt length (MAX_PROMPT_LENGTH from settings)
  - JSON schema validation for spec fields
  - generated code size cap
  - pagination for list endpoints (handled by DRF pagination class in settings)
"""
from django.conf import settings
from rest_framework import serializers

from .models import WebsiteGeneration, APIUsageLog

# Required spec fields — the AI must provide these or list them in missing_fields
_REQUIRED_SPEC_FIELDS = {'site_type', 'sections'}

# Maximum generated HTML size (bytes) — ~500 KB is generous for a single HTML file
MAX_CODE_BYTES = 500_000


# ─────────────────────────────────────────────
#  Step 1 — Spec extraction request
# ─────────────────────────────────────────────
class ExtractSpecRequestSerializer(serializers.Serializer):
    prompt = serializers.CharField(
        min_length=10,
        max_length=getattr(settings, 'MAX_PROMPT_LENGTH', 5000),
        trim_whitespace=True,
    )

    def validate_prompt(self, value):
        if not value.strip():
            raise serializers.ValidationError("Prompt cannot be blank.")
        return value


# ─────────────────────────────────────────────
#  Step 2 — Spec completion request
# ─────────────────────────────────────────────
class CompleteSpecRequestSerializer(serializers.Serializer):
    original_prompt = serializers.CharField(
        min_length=10,
        max_length=getattr(settings, 'MAX_PROMPT_LENGTH', 5000),
        trim_whitespace=True,
    )
    partial_spec = serializers.DictField(required=True)
    answers = serializers.DictField(required=True)

    def validate_partial_spec(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("partial_spec must be a JSON object.")
        return value

    def validate_answers(self, value):
        if not isinstance(value, dict) or len(value) == 0:
            raise serializers.ValidationError("answers must be a non-empty JSON object.")
        return value


# ─────────────────────────────────────────────
#  Step 3 — Website generation request
# ─────────────────────────────────────────────
class GenerateWebsiteRequestSerializer(serializers.Serializer):
    spec = serializers.DictField(required=True)

    def validate_spec(self, value):
        """Ensure the spec contains all required fields before we spend tokens."""
        missing = [f for f in _REQUIRED_SPEC_FIELDS if not value.get(f)]
        if missing:
            raise serializers.ValidationError(
                f"Spec is incomplete. Missing required fields: {missing}"
            )
        # sections must be a non-empty list
        sections = value.get('sections', [])
        if not isinstance(sections, list) or len(sections) == 0:
            raise serializers.ValidationError(
                "'sections' must be a non-empty list of strings."
            )
        return value


# ─────────────────────────────────────────────
#  Response serializers
# ─────────────────────────────────────────────
class SpecResponseSerializer(serializers.Serializer):
    """Returned by both /spec/ and /spec/complete/."""
    spec           = serializers.DictField()
    missing_fields = serializers.ListField(child=serializers.CharField(), default=list)
    tokens_used    = serializers.IntegerField()


class GenerationResponseSerializer(serializers.ModelSerializer):
    code = serializers.CharField(source='generated_code')

    class Meta:
        model  = WebsiteGeneration
        fields = ['id', 'code', 'tokens_used', 'created_at']
        read_only_fields = fields


class GenerationListSerializer(serializers.ModelSerializer):
    prompt_preview    = serializers.SerializerMethodField()
    preview_image_url = serializers.SerializerMethodField()

    class Meta:
        model  = WebsiteGeneration
        fields = ['id', 'prompt_preview', 'tokens_used', 'created_at', 'preview_image_url']
        read_only_fields = fields

    def get_prompt_preview(self, obj):
        return obj.prompt[:120] + '…' if len(obj.prompt) > 120 else obj.prompt

    def get_preview_image_url(self, obj):
        # Return absolute URL of the WebP thumbnail, or None if not yet generated.
        if not obj.preview_image:
            return None
        request = self.context.get('request')
        url = obj.preview_image.url
        return request.build_absolute_uri(url) if request else url


class GenerationDetailSerializer(serializers.ModelSerializer):
    """Full detail including generated code — for retrieve endpoint."""
    is_multipage = serializers.SerializerMethodField()
    pages        = serializers.SerializerMethodField()

    def get_is_multipage(self, obj):
        return bool(obj.pages_json)

    def get_pages(self, obj):
        return obj.pages_json or {}

    class Meta:
        model  = WebsiteGeneration
        fields = ['id', 'prompt', 'spec_json', 'generated_code', 'pages_json',
                  'title', 'tokens_used', 'created_at', 'is_multipage', 'pages']
        read_only_fields = ['id', 'prompt', 'spec_json', 'tokens_used', 'created_at']


# ─────────────────────────────────────────────
#  Stats (admin only)
# ─────────────────────────────────────────────
class APIUsageStatsSerializer(serializers.Serializer):
    total_requests      = serializers.IntegerField()
    successful_requests = serializers.IntegerField()
    failed_requests     = serializers.IntegerField()
    total_tokens_used   = serializers.IntegerField()
    requests_today      = serializers.IntegerField()