# generator/views.py
"""
Every generation and retrieval is scoped to the authenticated user.
Credits are deducted atomically on each generation.

File support:
    Endpoints accept an optional `files` field in the JSON body:
    [{"name": "screenshot.png", "type": "image/png", "data": "<base64>"},
     {"name": "copy.txt",       "type": "text/plain", "data": "<base64>"}]
    Files are passed through to the AI service for multi-modal processing.
"""
from __future__ import annotations  # FIX: enables str|None union syntax on Python 3.8/3.9

import json
import logging
from django.core.cache import cache
from rest_framework.decorators import api_view, permission_classes
from rest_framework.decorators import parser_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.response import Response
from django.db.models import F, Sum
from django.http import StreamingHttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, throttle_classes, permission_classes
from rest_framework.permissions import IsAdminUser, IsAuthenticated, AllowAny
from rest_framework.response import Response

from .models import APIUsageLog, GenerationPage, WebsiteGeneration, WebsiteSnapshot
from .serializers import (
    APIUsageStatsSerializer,
    CompleteSpecRequestSerializer,
    ExtractSpecRequestSerializer,
    GenerateWebsiteRequestSerializer,
    GenerationDetailSerializer,
    GenerationListSerializer,
    GenerationResponseSerializer,
    SpecResponseSerializer,
)
from .services.ai_service import (
    AIServiceError, classify_intent, chat_reply, complete_spec, edit_website,
    edit_website_stream, extract_spec, generate_website, generate_website_stream,
    validate_api_key,
)
from .services.full_app_service import (
    extract_backend_contract, generate_hono_worker, inject_supabase_client,
    create_full_app_zip, create_supabase_tables,
)
from .throttling import GenerateFreeThrottle, SpecThrottle
from .tasks import generate_preview, process_inline_images
from .utils import get_client_ip, inline_images_to_r2, paginate_queryset

# Backward-compat alias so any call sites we haven't updated yet still work
_inline_images_to_r2 = inline_images_to_r2

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────
#  Token Unit (TU) billing helpers
#  1 TU = 1,000 API tokens.  We reserve 50 TU upfront (≈ worst-case
#  cost) and reconcile to the actual usage once the call completes.
# ─────────────────────────────────────────────────────────────────
# BE-1: Per-endpoint reservations tuned to actual operation cost.
# 1 TU = 1,000 tokens.  We reserve upfront and reconcile to actual usage.
TU_RESERVATION_GENERATE = 50   # full generation: 20–40 TU typical
TU_RESERVATION_EDIT     = 10   # single-page edit:  5–8 TU typical
TU_RESERVATION = TU_RESERVATION_GENERATE  # legacy alias — do not use in new code

def _tokens_to_tu(tokens: int) -> int:
    """Convert raw token count → TU, rounding up, minimum 1."""
    return max(1, (tokens + 999) // 1000)

def _reconcile_credits(user, reserved: int, actual_tokens: int) -> None:
    """
    We pre-charged `reserved` TU.  Now that we know the real cost,
    refund the difference (or charge extra if actual > reserved).
    Uses atomic F() expressions — safe under concurrency.
    """
    actual_tu = _tokens_to_tu(actual_tokens)
    delta = reserved - actual_tu          # positive = refund, negative = extra charge
    if delta == 0:
        return
    if delta > 0:
        type(user).objects.filter(pk=user.pk).update(credits=F("credits") + delta)
    else:
        # actual cost exceeded reservation — deduct the difference
        type(user).objects.filter(pk=user.pk).update(
            credits=F("credits") - abs(delta)
        )


# ─────────────────────────────────────────────────────────────────
#  File validation
# ─────────────────────────────────────────────────────────────────
_MAX_FILES = 10               # max files per request
_MAX_FILE_SIZE_B64 = 10_000_000  # ~7.5 MB decoded (base64 is ~33% larger)
_ALLOWED_MIMES = {
    'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
    'text/plain', 'text/html', 'text/css', 'text/csv', 'text/javascript',
    'text/markdown', 'application/json', 'application/xml', 'application/pdf',
    'text/x-python', 'application/x-python',
}


def _extract_files(request_data) -> list:
    """
    Extract and validate the optional `files` array from request data.
    Returns a sanitized list of file dicts, or an empty list.
    """
    raw_files = request_data.get("files")
    if not raw_files or not isinstance(raw_files, list):
        return []

    validated = []
    for i, f in enumerate(raw_files[:_MAX_FILES]):
        if not isinstance(f, dict):
            continue

        name = str(f.get("name", f"file_{i}"))[:255]
        mime = str(f.get("type", "")).lower().strip()
        data = f.get("data", "")

        if not data or not isinstance(data, str):
            continue

        # Validate claimed MIME type against allowlist
        if mime and mime not in _ALLOWED_MIMES:
            logger.warning("Skipping file with disallowed MIME: %s (%s)", name, mime)
            continue

        # Validate size (base64 string length)
        if len(data) > _MAX_FILE_SIZE_B64:
            logger.warning("Skipping oversized file: %s (%d bytes)", name, len(data))
            continue

        # SEC-3: Server-side magic-byte validation — the client-supplied MIME
        # type is user-controlled and cannot be trusted.  Decode the first
        # 2 KB of the file and let libmagic identify the real type.
        try:
            import base64 as _b64
            import magic as _magic
            raw_head = _b64.b64decode(data[:2732])  # ~2 KB of base64
            detected = _magic.from_buffer(raw_head, mime=True)
            # Allow text/* wildcard match for text-family types
            def _mime_ok(detected_mime: str, claimed: str) -> bool:
                if detected_mime == claimed:
                    return True
                if detected_mime.startswith("text/") and claimed.startswith("text/"):
                    return True
                # PDFs sometimes detected as application/octet-stream on short reads
                if claimed == "application/pdf" and detected_mime in (
                    "application/pdf", "application/octet-stream"
                ):
                    return True
                return False
            if not _mime_ok(detected, mime or "application/octet-stream"):
                logger.warning(
                    "SEC-3: MIME mismatch for %s — claimed %s, detected %s. Skipping.",
                    name, mime, detected,
                )
                continue
        except ImportError:
            pass   # python-magic not installed — skip server-side check
        except Exception as _magic_err:
            logger.debug("SEC-3: magic check failed for %s: %s", name, _magic_err)

        validated.append({"name": name, "type": mime, "data": data})

    return validated



# DATA-4: _inline_images_to_r2 has been moved to utils.py and is imported
# above as `inline_images_to_r2` (alias `_inline_images_to_r2` for compat).
# Streaming paths now save raw HTML immediately and enqueue process_inline_images
# as a Celery task so base64 → R2 conversion never blocks the HTTP response.

# ─────────────────────────────────────────────────────────────────
#  Step 1 — Spec extraction
# ─────────────────────────────────────────────────────────────────
@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([SpecThrottle])
def extract_spec_view(request):
    serializer = ExtractSpecRequestSerializer(data=request.data)
    if not serializer.is_valid():
        return Response({"error": serializer.errors}, status=status.HTTP_400_BAD_REQUEST)

    ip = get_client_ip(request)
    files = _extract_files(request.data)

    try:
        spec, missing_fields, tokens = extract_spec(
            serializer.validated_data["prompt"],
            files=files,
        )
    except AIServiceError as exc:
        _log(ip, "extract_spec", 0, False, str(exc), request)
        return Response({"error": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
    except Exception as exc:
        logger.exception("Unexpected error in extract_spec_view")
        _log(ip, "extract_spec", 0, False, str(exc), request)
        return Response({"error": "Internal error during spec extraction."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    _log(ip, "extract_spec", tokens, True, None, request)
    return Response(
        SpecResponseSerializer({"spec": spec, "missing_fields": missing_fields, "tokens_used": tokens}).data
    )


# ─────────────────────────────────────────────────────────────────
#  Step 2 — Spec completion
# ─────────────────────────────────────────────────────────────────
@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([SpecThrottle])
def complete_spec_view(request):
    serializer = CompleteSpecRequestSerializer(data=request.data)
    if not serializer.is_valid():
        return Response({"error": serializer.errors}, status=status.HTTP_400_BAD_REQUEST)

    data = serializer.validated_data
    ip   = get_client_ip(request)
    files = _extract_files(request.data)   # FIX: was missing; attached design files were silently dropped
    try:
        spec, tokens = complete_spec(
            original_prompt=data["original_prompt"],
            answers=data["answers"],
            partial_spec=data["partial_spec"],
            files=files,                   # FIX: forward files so spec merge has full design context
        )
    except AIServiceError as exc:
        _log(ip, "complete_spec", 0, False, str(exc), request)
        return Response({"error": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
    except Exception as exc:
        logger.exception("Unexpected error in complete_spec_view")
        _log(ip, "complete_spec", 0, False, str(exc), request)
        return Response({"error": "Internal error during spec completion."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    _log(ip, "complete_spec", tokens, True, None, request)
    return Response(
        SpecResponseSerializer({"spec": spec, "missing_fields": [], "tokens_used": tokens}).data
    )


# ─────────────────────────────────────────────────────────────────
#  Step 3 — Website generation  (requires auth + credits)
# ─────────────────────────────────────────────────────────────────
@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([GenerateFreeThrottle])
def generate_website_view(request):
    """
    Generate a single-file HTML website from a completed spec.
    Streams NDJSON chunks back to the client as they arrive from OpenAI.
    Deducts 1 credit atomically before generation to prevent abuse.
    Saves the completed WebsiteGeneration after the stream finishes.
    """
    serializer = GenerateWebsiteRequestSerializer(data=request.data)
    if not serializer.is_valid():
        return Response({"error": serializer.errors}, status=status.HTTP_400_BAD_REQUEST)

    spec   = serializer.validated_data["spec"]
    ip     = get_client_ip(request)
    user   = request.user
    files  = _extract_files(request.data)

    prompt = (
        request.data.get("original_prompt")
        or spec.get("_original_prompt")
        or str(spec)
    )

    # Reserve TU upfront — prevents abuse and ensures credits exist before streaming
    if not user.deduct_credit(TU_RESERVATION):
        return Response(
            {
                "error": "Insufficient credits. Please purchase more credits or upgrade your plan.",
                "upgrade_required": True,
            },
            status=status.HTTP_402_PAYMENT_REQUIRED,
        )

    # Plan-based model switching: free → Gemini Flash, paid → Kimi K2.5
    _model_override = "gemini-2.5-flash" if user.plan == "free" else "kimi-k2.5"

    def _stream():
        """Generator that yields NDJSON lines and saves the generation at the end."""
        try:
            single_page = request.data.get("single_page") or None
            logger.info("generate_website_view: single_page=%r, request_data_keys=%r", single_page, list(request.data.keys()))
            for item in generate_website_stream(spec, original_prompt=prompt, files=files, single_page=single_page, model_override=_model_override):
                if item.get("done"):
                    # DATA-4: Save raw HTML immediately — base64→R2 conversion
                    # is deferred to a Celery task so it never blocks the stream.
                    html_code   = item["full_code"]
                    tokens_used = item["tokens_used"]
                    pages_data  = item.get("pages") or {}
                    nav_data    = item.get("navigation") or {}

                    generation = WebsiteGeneration.objects.create(
                        user=user,
                        prompt=prompt,
                        spec_json=spec,
                        generated_code=html_code,
                        # DATA-5: pages stored in GenerationPage rows below;
                        # keep pages_json empty for new records to avoid
                        # duplicating large HTML blobs in the parent row.
                        pages_json={},
                        title=(
                            spec.get("site_name")
                            or spec.get("title")
                            or spec.get("brand_name")
                            or "New Website"
                        ),
                        tokens_used=tokens_used,
                        ip_address=ip,
                    )

                    # DATA-5: Persist each page as an individual GenerationPage row.
                    if pages_data:
                        try:
                            GenerationPage.objects.bulk_create([
                                GenerationPage(
                                    generation=generation,
                                    slug=slug,
                                    html=html,
                                )
                                for slug, html in pages_data.items()
                            ], ignore_conflicts=True)
                        except Exception as _page_err:
                            logger.warning(
                                "generate_website_view: failed to persist GenerationPage "
                                "rows for generation %s: %s", generation.id, _page_err
                            )

                    # DATA-2: Save initial snapshot so the first version is always
                    # available for restore, even before the user makes any edits.
                    try:
                        WebsiteSnapshot.create_for(generation, label="Generated")
                    except Exception as _snap_err:
                        logger.warning("Snapshot creation failed after generate: %s", _snap_err)

                    # Enqueue thumbnail generation — runs in background, never blocks stream.
                    # BE-2: Guard against Celery/Redis not being available so a
                    # missing worker doesn't crash an otherwise successful generation.
                    try:
                        generate_preview.delay(generation.id)
                    except Exception as _celery_err:
                        logger.warning(
                            "generate_website_view: preview task could not be "
                            "enqueued (Celery unavailable?): %s", _celery_err
                        )

                    # DATA-4: Convert inline base64 images to R2 URLs asynchronously.
                    try:
                        process_inline_images.delay(generation.id)
                    except Exception as _img_err:
                        logger.warning(
                            "generate_website_view: process_inline_images task could not be "
                            "enqueued: %s", _img_err
                        )

                    # Reconcile: refund or charge difference vs reservation
                    _reconcile_credits(user, TU_RESERVATION, tokens_used)
                    _log(ip, "generate_website", tokens_used, True, None, request)

                    done_payload = {
                        "done":        True,
                        "id":          str(generation.id),
                        "tokens_used": tokens_used,
                    }
                    if pages_data:
                        done_payload["pages"]      = pages_data
                        done_payload["navigation"] = nav_data

                    yield json.dumps(done_payload) + "\n"
                else:
                    # Streaming thinking events — forwarded immediately so the
                    # frontend can update the thinking bubble in real time.
                    if "thinking_start" in item:
                        yield json.dumps({"thinking_start": True}) + "\n"
                    elif "thinking_chunk" in item:
                        yield json.dumps({"thinking_chunk": item["thinking_chunk"]}) + "\n"
                    elif "thinking_end" in item:
                        yield json.dumps({"thinking_end": True}) + "\n"
                    # Legacy / fallback event types
                    elif "thought" in item:
                        yield json.dumps({"thought": item["thought"]}) + "\n"
                    elif "narrative" in item:
                        yield json.dumps({"narrative": item["narrative"]}) + "\n"
                    elif "chunk" in item:
                        yield json.dumps({"chunk": item["chunk"]}) + "\n"

        except AIServiceError as exc:
            # Refund full reservation on failure
            type(user).objects.filter(pk=user.pk).update(credits=F("credits") + TU_RESERVATION)
            _log(ip, "generate_website", 0, False, str(exc), request)
            yield json.dumps({"error": str(exc)}) + "\n"

        except Exception as exc:
            type(user).objects.filter(pk=user.pk).update(credits=F("credits") + TU_RESERVATION)
            logger.exception("Unexpected error in generate_website_view stream")
            _log(ip, "generate_website", 0, False, str(exc), request)
            yield json.dumps({"error": "Internal error during website generation."}) + "\n"

    response = StreamingHttpResponse(_stream(), content_type="application/x-ndjson")
    response["X-Accel-Buffering"] = "no"   # disable nginx buffering
    response["Cache-Control"]     = "no-cache"
    return response


# ─────────────────────────────────────────────────────────────────
#  Modify  (requires auth + credits)
# ─────────────────────────────────────────────────────────────────
@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([GenerateFreeThrottle])
def modify_website_view(request):
    code        = request.data.get("code",        "").strip()
    instruction = request.data.get("instruction", "").strip()

    if not code:
        return Response({"error": "code is required."}, status=status.HTTP_400_BAD_REQUEST)
    if not instruction:
        return Response({"error": "instruction is required."}, status=status.HTTP_400_BAD_REQUEST)

    user  = request.user
    files = _extract_files(request.data)

    if not user.deduct_credit(TU_RESERVATION_EDIT):
        return Response(
            {
                "error": "Insufficient credits. Please purchase more credits or upgrade your plan.",
                "upgrade_required": True,
            },
            status=status.HTTP_402_PAYMENT_REQUIRED,
        )

    nbx_id       = request.data.get("nbx_id")       or None
    edit_mode    = request.data.get("edit_mode")    or None
    scope        = request.data.get("scope")        or None
    chat_history = request.data.get("chat_history") or []
    # AI-3: Cap to last 10 turns (5 user + 5 assistant) to prevent context
    # overflow and runaway token consumption on long-lived chat sessions.
    if len(chat_history) > 10:
        chat_history = chat_history[-10:]

    # BE-4: Per-generation advisory lock — prevents concurrent edits on the
    # same project from racing each other and double-charging credits.
    # Uses Django's cache.add() which is atomic across threads and processes.
    _lock_key = f"gen_edit_lock_{user.pk}_{nbx_id}" if nbx_id else None
    if _lock_key:
        acquired = cache.add(_lock_key, "1", timeout=300)
        if not acquired:
            # Refund the reservation we already deducted
            type(user).objects.filter(pk=user.pk).update(
                credits=F("credits") + TU_RESERVATION_EDIT
            )
            return Response(
                {"error": "Another edit is already in progress for this project. Please wait."},
                status=status.HTTP_409_CONFLICT,
            )

    ip = get_client_ip(request)
    # Plan-based model switching: free → Gemini Flash, paid → Claude Sonnet
    _edit_model_override = "gemini-2.5-flash" if user.plan == "free" else "claude-sonnet-4-6"

    def _stream_edit():
        try:
            for item in edit_website_stream(
                code, instruction,
                files=files,
                nbx_id=nbx_id,
                edit_mode=edit_mode,
                scope=scope,
                chat_history=chat_history,
                model_override=_edit_model_override,
            ):
                if item.get("done"):
                    # DATA-4: Use raw HTML — base64→R2 deferred to Celery task below.
                    html_code = item["full_code"] or code
                    tokens_used = item["tokens_used"]
                    _reconcile_credits(user, TU_RESERVATION_EDIT, tokens_used)
                    _log(ip, "modify_website", tokens_used, True, None, request)

                    # DATA-1 + DATA-2: Auto-persist the edited HTML to the DB and
                    # save a snapshot so the change is recoverable.
                    if nbx_id:
                        try:
                            gen_obj = WebsiteGeneration.objects.filter(
                                id=nbx_id, user=user
                            ).first()
                            if gen_obj:
                                try:
                                    WebsiteSnapshot.create_for(gen_obj, label="Edit")
                                except Exception as _snap_err:
                                    logger.warning(
                                        "modify_website_view: snapshot failed for "
                                        "generation %s: %s", nbx_id, _snap_err
                                    )
                                gen_obj.generated_code = html_code
                                gen_obj.save(update_fields=["generated_code"])
                                # DATA-4: Enqueue image processing async
                                try:
                                    process_inline_images.delay(gen_obj.id)
                                except Exception as _img_err:
                                    logger.warning(
                                        "modify_website_view: process_inline_images "
                                        "could not be enqueued: %s", _img_err
                                    )
                        except Exception as _save_err:
                            logger.warning(
                                "modify_website_view: failed to auto-persist "
                                "generation %s: %s", nbx_id, _save_err
                            )

                    # Send both 'code' and 'full_code' to satisfy all frontend variations
                    yield json.dumps({
                        "done": True,
                        "code": html_code,
                        "full_code": html_code,
                        "tokens_used": tokens_used
                    }) + "\n"
                else:
                    yield json.dumps(item) + "\n"
        except AIServiceError as exc:
            type(user).objects.filter(pk=user.pk).update(credits=F("credits") + TU_RESERVATION_EDIT)
            _log(ip, "modify_website", 0, False, str(exc), request)
            yield json.dumps({"error": str(exc)}) + "\n"
        except Exception as exc:
            type(user).objects.filter(pk=user.pk).update(credits=F("credits") + TU_RESERVATION_EDIT)
            logger.exception("Unexpected error in modify_website_view stream")
            _log(ip, "modify_website", 0, False, str(exc), request)
            yield json.dumps({"error": "Internal error during modification."}) + "\n"
        finally:
            # BE-4: Release the per-generation advisory lock so subsequent edits
            # can proceed.  The finally block runs whether the stream succeeded,
            # raised, or was aborted by the client.
            if _lock_key:
                cache.delete(_lock_key)

    response = StreamingHttpResponse(_stream_edit(), content_type="application/x-ndjson")
    response["X-Accel-Buffering"] = "no"
    response["Cache-Control"]     = "no-cache"
    return response


# ─────────────────────────────────────────────────────────────────
#  Retrieval  (scoped to authenticated user)
# ─────────────────────────────────────────────────────────────────

PAGE_SIZE_DEFAULT = 8
PAGE_SIZE_MAX     = 32   # safety cap — prevents abuse


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_generations(request):
    qs = (
        WebsiteGeneration.objects
        .filter(user=request.user, is_deleted=False)
        .only('id', 'prompt', 'tokens_used', 'created_at', 'preview_image')
        .order_by('-created_at')
    )

    paginator = LimitOffsetPagination()
    paginator.default_limit = PAGE_SIZE_DEFAULT
    paginator.max_limit     = PAGE_SIZE_MAX

    page = paginator.paginate_queryset(qs, request)
    # Pass request so serializer can build absolute preview_image URLs
    serializer = GenerationListSerializer(page, many=True, context={'request': request})
    return paginator.get_paginated_response(serializer.data)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def get_generation(request, generation_id):
    try:
        generation = WebsiteGeneration.objects.get(
            id=generation_id, user=request.user, is_deleted=False
        )
    except WebsiteGeneration.DoesNotExist:
        return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "PATCH":
        update_fields = []
        title = request.data.get("title", "").strip()
        if title:
            generation.title = title[:255]
            update_fields.append("title")
        code = request.data.get("generated_code")
        if code:
            # DATA-2: Snapshot the current state before overwriting so the
            # previous version is always recoverable via the history endpoint.
            if generation.generated_code:
                try:
                    WebsiteSnapshot.create_for(generation, label="Saved")
                except Exception as _snap_err:
                    logger.warning("Snapshot before PATCH failed: %s", _snap_err)
            # DATA-4: Save raw HTML now; enqueue R2 conversion async below.
            generation.generated_code = code
            update_fields.append("generated_code")
        pages = request.data.get("pages_json")
        if pages is not None and isinstance(pages, dict):
            # DATA-5: upsert into GenerationPage; keep pages_json in sync for
            # old callers that read it directly from the model.
            for slug, html in pages.items():
                GenerationPage.objects.update_or_create(
                    generation=generation,
                    slug=slug,
                    defaults={"html": html},
                )
            generation.pages_json = {}  # clear legacy field — data lives in GenerationPage now
            update_fields.append("pages_json")
        if update_fields:
            generation.save(update_fields=update_fields)
            # DATA-4: Enqueue image processing for any inline base64 images.
            try:
                process_inline_images.delay(generation.id)
            except Exception as _img_err:
                logger.warning("PATCH: process_inline_images could not be enqueued: %s", _img_err)
            # Flag published site as having unpublished changes
            try:
                from publishing.models import PublishedSite
                PublishedSite.objects.filter(generation=generation, is_active=True).update(
                    has_unpublished_changes=True
                )
            except Exception:
                pass
        return Response({"id": generation.id, "title": generation.title})

    # DATA-5: Load pages from GenerationPage rows; fall back to pages_json for
    # old records that were created before the GenerationPage table existed.
    db_pages = {p.slug: p.html for p in GenerationPage.objects.filter(generation=generation)}
    pages_ctx = db_pages if db_pages else (generation.pages_json or {})
    return Response(GenerationDetailSerializer(generation, context={'db_pages': pages_ctx}).data)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def delete_generation(request, generation_id):
    try:
        generation = WebsiteGeneration.objects.get(
            id=generation_id, user=request.user, is_deleted=False
        )
    except WebsiteGeneration.DoesNotExist:
        return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    # BE-5: Soft delete — set is_deleted flag rather than removing the row.
    # This is irreversible from the user's perspective but preserves data for recovery.
    generation.is_deleted = True
    generation.deleted_at = timezone.now()
    generation.save(update_fields=["is_deleted", "deleted_at"])
    return Response(status=status.HTTP_204_NO_CONTENT)


# ─────────────────────────────────────────────────────────────────
#  DATA-2: Version History — snapshot list + restore
# ─────────────────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_snapshots(request, generation_id):
    """Return the last 10 snapshots for a generation (newest first)."""
    try:
        generation = WebsiteGeneration.objects.get(
            id=generation_id, user=request.user, is_deleted=False
        )
    except WebsiteGeneration.DoesNotExist:
        return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    snapshots = WebsiteSnapshot.objects.filter(
        generation=generation
    ).order_by("-created_at")[:WebsiteSnapshot.MAX_SNAPSHOTS]

    return Response([
        {
            "id":         s.id,
            "label":      s.label,
            "created_at": s.created_at,
            "preview":    s.code[:200],  # first 200 chars for display
        }
        for s in snapshots
    ])


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def restore_snapshot(request, generation_id, snapshot_id):
    """Restore a generation's generated_code from a snapshot."""
    try:
        generation = WebsiteGeneration.objects.get(
            id=generation_id, user=request.user, is_deleted=False
        )
    except WebsiteGeneration.DoesNotExist:
        return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    try:
        snapshot = WebsiteSnapshot.objects.get(id=snapshot_id, generation=generation)
    except WebsiteSnapshot.DoesNotExist:
        return Response({"error": "Snapshot not found."}, status=status.HTTP_404_NOT_FOUND)

    # Snapshot the current state before restoring so the restore itself is undoable
    if generation.generated_code:
        try:
            WebsiteSnapshot.create_for(generation, label="Before restore")
        except Exception as _snap_err:
            logger.warning("Pre-restore snapshot failed: %s", _snap_err)

    generation.generated_code = snapshot.code
    generation.save(update_fields=["generated_code"])

    return Response({"id": generation.id, "restored_from": snapshot_id})


# ─────────────────────────────────────────────────────────────────
#  Health check + Stats
# ─────────────────────────────────────────────────────────────────
@api_view(["GET"])
@permission_classes([AllowAny])
def health_check(request):
    return Response({
        "status":        "ok",
        "api_key_valid": validate_api_key(),
        "timestamp":     timezone.now(),
    })


@api_view(["GET"])
@permission_classes([IsAdminUser])
def api_stats(request):
    logs  = APIUsageLog.objects.all()
    today = timezone.now().date()
    stats = {
        "total_requests":      logs.count(),
        "successful_requests": logs.filter(success=True).count(),
        "failed_requests":     logs.filter(success=False).count(),
        "total_tokens_used":   logs.aggregate(Sum("tokens_used"))["tokens_used__sum"] or 0,
        "requests_today":      logs.filter(timestamp__date=today).count(),
    }
    return Response(APIUsageStatsSerializer(stats).data)


# ─────────────────────────────────────────────────────────────────
#  Internal helper
# ─────────────────────────────────────────────────────────────────
def _log(ip: str, endpoint: str, tokens: int, success: bool, error: str | None, request) -> None:
    user = request.user if request.user.is_authenticated else None
    APIUsageLog.objects.create(
        user          = user,
        ip_address    = ip,
        endpoint      = endpoint,
        tokens_used   = tokens,
        success       = success,
        error_message = (error or "")[:2000],
    )

# ─────────────────────────────────────────────────────────────────
#  Intent classification — lightweight, no credit deduction
# ─────────────────────────────────────────────────────────────────
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def intent_view(request):
    """
    Classify a user chat message into a structured intent.
    Accepts: {message, pages (list), active_page, project_name}
    Returns: {intent, ...fields}
    No credit deduction — this is infrastructure, not generation.
    """
    message      = (request.data.get("message") or "").strip()
    pages        = request.data.get("pages") or []
    active_page  = (request.data.get("active_page") or "index").strip()
    project_name = (request.data.get("project_name") or "").strip()
    chat_history = request.data.get("chat_history") or []

    if not message:
        return Response({"error": "message is required."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        result = classify_intent(message, pages, active_page, project_name, chat_history=chat_history)
        return Response(result)
    except AIServiceError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
    except Exception as exc:
        logger.exception("intent_view error")
        return Response({"intent": "modify", "instruction": message})


# ─────────────────────────────────────────────────────────────────
#  Conversational chat — short replies about the site
# ─────────────────────────────────────────────────────────────────
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def chat_view(request):
    """
    Generate a short conversational reply.
    Accepts: {message, page_context (optional HTML snippet)}
    Returns: {reply}
    No credit deduction.
    """
    message      = (request.data.get("message") or "").strip()
    page_context = (request.data.get("page_context") or "").strip()
    chat_history = request.data.get("chat_history") or []
    files        = _extract_files(request.data)

    if not message:
        return Response({"error": "message is required."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        reply = chat_reply(message, page_context, chat_history=chat_history, files=files)
        return Response({"reply": reply})
    except AIServiceError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
    except Exception:
        return Response({"reply": "How can I help with your site?"})

@api_view(["POST"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def upload_image(request):
    """
    Accept any image, convert to WebP, upload to Cloudflare R2,
    return a permanent public URL.  Falls back to local media if R2
    is not configured (dev / staging).
    """
    import uuid, io
    from PIL import Image as PilImage
    from django.conf import settings as django_settings

    file = request.FILES.get("image")
    if not file:
        return Response({"error": "No image provided."}, status=400)

    allowed_types = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"}
    if file.content_type not in allowed_types:
        return Response({"error": "Invalid file type."}, status=400)

    if file.size > 10 * 1024 * 1024:
        return Response({"error": "File too large (max 10MB)."}, status=400)

    try:
        img = PilImage.open(file)
        # Preserve transparency for PNG/WebP; flatten for JPEG sources
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
        else:
            img = img.convert("RGB")

        # Cap dimensions to 2000px on longest side
        MAX_DIM = 2000
        if max(img.width, img.height) > MAX_DIM:
            img.thumbnail((MAX_DIM, MAX_DIM), PilImage.LANCZOS)

        buf = io.BytesIO()
        img.save(buf, format="WEBP", quality=82, method=4)
        buf.seek(0)
        webp_bytes = buf.read()
    except Exception as exc:
        logger.warning("Image conversion failed: %s", exc)
        return Response({"error": "Could not process image."}, status=400)

    filename = f"user_uploads/{request.user.id}/{uuid.uuid4().hex}.webp"

    # ── R2 upload ──────────────────────────────────────────────────────────
    r2_public_url = getattr(django_settings, "R2_PUBLIC_URL", "")
    if getattr(django_settings, "_R2_CONFIGURED", False) and r2_public_url:
        try:
            import boto3
            from botocore.config import Config as BotoConfig

            s3 = boto3.client(
                "s3",
                endpoint_url=django_settings.AWS_S3_ENDPOINT_URL,
                aws_access_key_id=django_settings.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=django_settings.AWS_SECRET_ACCESS_KEY,
                config=BotoConfig(signature_version="s3v4"),
                region_name="auto",
            )
            s3.put_object(
                Bucket=django_settings.R2_BUCKET_NAME,
                Key=filename,
                Body=webp_bytes,
                ContentType="image/webp",
            )
            public_url = r2_public_url.rstrip("/") + "/" + filename
            return Response({"url": public_url})
        except Exception as exc:
            logger.error("R2 upload failed: %s", exc)
            return Response({"error": "Image upload failed."}, status=502)

    # ── Local fallback (dev / staging — R2 not configured) ─────────────────
    from django.core.files.storage import default_storage
    from django.core.files.base import ContentFile
    default_storage.save(filename, ContentFile(webp_bytes))
    url = request.build_absolute_uri(settings.MEDIA_URL + filename)
    return Response({"url": url})


def pexels_image(request):
    import requests as http_requests
    from django.core.cache import cache
    from django.conf import settings
    from django.http import HttpResponse

    query = request.GET.get('q', 'abstract')
    w = request.GET.get('w', '800')
    h = request.GET.get('h', '600')
    orientation = request.GET.get('o', 'landscape')

    # Cache the actual image bytes so iframe can load without redirect
    cache_key = f"pexels_img_{query}_{orientation}_{w}_{h}".replace(" ", "_")
    cached = cache.get(cache_key)
    if cached:
        return HttpResponse(cached, content_type="image/jpeg")

    img_url = None
    try:
        resp = http_requests.get(
            'https://api.pexels.com/v1/search',
            headers={'Authorization': settings.PEXELS_API_KEY},
            params={'query': query, 'per_page': 5, 'orientation': orientation},
            timeout=5,
        )
        photos = resp.json().get('photos', [])
        if photos:
            img_url = photos[0]['src'].get('large') or photos[0]['src'].get('large2x')
    except Exception as e:
        logger.warning(f"Pexels API error: {e}")

    if not img_url:
        img_url = f'https://picsum.photos/{w}/{h}'

    try:
        img_resp = http_requests.get(img_url, timeout=10)
        if img_resp.status_code == 200:
            content_type = img_resp.headers.get('Content-Type', 'image/jpeg')
            cache.set(cache_key, img_resp.content, 60 * 60 * 24)
            return HttpResponse(img_resp.content, content_type=content_type)
    except Exception as e:
        logger.warning(f"Image fetch error: {e}")

    from django.shortcuts import redirect
    return redirect(img_url)
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def publish_full_app_view(request):
    """
    PUBLISH MODE 2: FULL APP
    Analyzes existing frontend code, generates a Hono/D1 backend, 
    patches the frontend, and returns a deployable ZIP bundle.
    """
    nbx_id = request.data.get("nbx_id")
    subdomain_input = request.data.get("subdomain")
    
    if not nbx_id:
        return Response({"error": "nbx_id is required"}, status=status.HTTP_400_BAD_REQUEST)
    if not subdomain_input:
        return Response({"error": "subdomain is required. Please choose a subdomain first."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        # 1. Fetch the project
        gen = WebsiteGeneration.objects.get(id=nbx_id, user=request.user)
        pages_raw = gen.pages_json or {"index": gen.generated_code}
        
        # Normalize pages_raw to Dict[str, str]
        pages = {}
        if isinstance(pages_raw, list):
            for i, p in enumerate(pages_raw):
                name = p.get("name", f"page_{i}")
                pages[name] = p.get("code", "")
        elif isinstance(pages_raw, dict):
            for k, v in pages_raw.items():
                if isinstance(v, dict):
                    pages[k] = v.get("code", "")
                else:
                    pages[k] = str(v)
        
        # 2. Extract Backend Contract
        contract = extract_backend_contract(pages)
        if "error" in contract:
             return Response({"error": f"Analysis failed: {contract['error']}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # 3. Generate Hono Backend Code
        backend_files = generate_hono_worker(contract)

        # 4. Read user-provided Supabase credentials (optional)
        supabase_url = request.data.get("supabase_url", "").strip()
        supabase_anon_key = request.data.get("supabase_anon_key", "").strip()
        supabase_service_key = request.data.get("supabase_service_key", "").strip()

        has_supabase = bool(supabase_url and supabase_anon_key)

        deploy_res = {
            "api_url": supabase_url if has_supabase else None,
            "anon_key": supabase_anon_key if has_supabase else None,
            "error": None,
        }
        deploy_res["service_key"] = supabase_service_key

        # 4b. Auto-create Supabase tables from contract (best effort)
        if has_supabase:
            table_result = create_supabase_tables(
                supabase_url=deploy_res["api_url"],
                supabase_anon_key=deploy_res["anon_key"],
                contract=contract,
            )
            if table_result["tables_created"]:
                logger.info("[FullApp] Tables created in Supabase: %s", table_result["tables_created"])
            if table_result["errors"]:
                logger.warning("[FullApp] Table creation errors (non-fatal): %s", table_result["errors"])

        # 5. Inject Supabase client into frontend pages (only if credentials provided)
        if has_supabase:
            patched_pages = inject_supabase_client(pages, deploy_res["api_url"], deploy_res["anon_key"], contract)
        else:
            patched_pages = pages

        # 6. Create ZIP Bundle
        if has_supabase:
            zip_buffer = create_full_app_zip(patched_pages, deploy_res["api_url"], deploy_res["anon_key"])
        else:
            zip_buffer = create_full_app_zip(patched_pages, "", "")

        from django.http import HttpResponse
        response = HttpResponse(zip_buffer.getvalue(), content_type='application/zip')
        response['Content-Disposition'] = f'attachment; filename="{subdomain_input}_full_app.zip"'
        response['Access-Control-Expose-Headers'] = 'Content-Disposition'

        return response

    except WebsiteGeneration.DoesNotExist:
        return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.exception("Publish Full App failed")
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
