# generator/services/providers/google_provider.py
"""
Google Gemini provider — handles all Gemini models.

Key differences from OpenAI:
  - Uses google-genai SDK (unified SDK) or google-generativeai
  - System instruction is a separate parameter
  - Content parts use a different schema (text, inline_data)
  - Streaming yields GenerateContentResponse chunks
  - Token counting via usage_metadata

Install: pip install google-genai
  (or the older: pip install google-generativeai)
"""
from __future__ import annotations

import base64
import logging
from typing import Any, Dict, Generator, List

from ..model_registry import ModelConfig
from . import AIResponse, AIStreamChunk, BaseProvider

logger = logging.getLogger(__name__)

# Client cache
_clients: Dict[str, Any] = {}


def _get_client(config: ModelConfig):
    """Get or create a Google GenAI client."""
    if config.api_key_setting not in _clients:
        try:
            from google import genai
        except ImportError:
            raise ImportError(
                "Google GenAI SDK not installed. Run: pip install google-genai"
            )

        _clients[config.api_key_setting] = genai.Client(
            api_key=config.api_key,
        )
        logger.info("Created Google GenAI client (key_setting=%s)", config.api_key_setting)

    return _clients[config.api_key_setting]


def _convert_messages(messages: List[Dict[str, Any]]) -> tuple:
    """
    Convert OpenAI-format messages to Google Gemini format.

    Returns:
        system_instruction (str)   — extracted from system messages
        contents (list)            — Gemini-format content parts
    """
    from google.genai import types

    system_parts = []
    contents = []

    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")

        if role == "system":
            if isinstance(content, str):
                system_parts.append(content)
            continue

        # Map OpenAI roles to Gemini roles
        gemini_role = "user" if role == "user" else "model"

        if isinstance(content, list):
            # Multi-modal content
            parts = []
            for block in content:
                if block.get("type") == "text":
                    parts.append(types.Part.from_text(text=block["text"]))
                elif block.get("type") == "image_url":
                    url = block.get("image_url", {}).get("url", "")
                    if url.startswith("data:"):
                        header, _, b64data = url.partition(",")
                        mime = header.split(":")[1].split(";")[0] if ":" in header else "image/png"
                        raw_bytes = base64.b64decode(b64data)
                        parts.append(types.Part.from_bytes(
                            data=raw_bytes,
                            mime_type=mime,
                        ))
            contents.append(types.Content(role=gemini_role, parts=parts))
        else:
            contents.append(types.Content(
                role=gemini_role,
                parts=[types.Part.from_text(text=str(content))],
            ))

    system = "\n\n".join(system_parts) if system_parts else None
    return system, contents


class GoogleProvider(BaseProvider):
    """Provider for Google Gemini models."""

    def call(
        self,
        config: ModelConfig,
        messages: List[Dict[str, Any]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AIResponse:
        from google.genai import types

        client = _get_client(config)
        system, contents = _convert_messages(messages)

        out = max_tokens if max_tokens is not None else config.max_output_tokens
        temp = temperature if temperature is not None else config.default_temperature

        gen_config = types.GenerateContentConfig(
            max_output_tokens=int(out),
        )
        if config.supports_temperature and temp is not None:
            gen_config.temperature = float(temp)
        if system:
            gen_config.system_instruction = system

        try:
            response = client.models.generate_content(
                model=config.model_id,
                contents=contents,
                config=gen_config,
            )
        except Exception as exc:
            logger.error("[%s] API error: %s", config.name, exc)
            raise

        content = response.text or ""
        tokens = 0
        if hasattr(response, "usage_metadata") and response.usage_metadata:
            tokens = (
                getattr(response.usage_metadata, "prompt_token_count", 0)
                + getattr(response.usage_metadata, "candidates_token_count", 0)
            )

        return AIResponse(
            content=content,
            tokens_used=int(tokens),
            model=config.model_id,
            raw=response,
        )

    def call_stream(
        self,
        config: ModelConfig,
        messages: List[Dict[str, Any]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> Generator[AIStreamChunk, None, None]:
        from google.genai import types

        client = _get_client(config)
        system, contents = _convert_messages(messages)

        out = max_tokens if max_tokens is not None else config.max_output_tokens
        temp = temperature if temperature is not None else config.default_temperature

        gen_config = types.GenerateContentConfig(
            max_output_tokens=int(out),
        )
        if config.supports_temperature and temp is not None:
            gen_config.temperature = float(temp)
        if system:
            gen_config.system_instruction = system

        try:
            stream = client.models.generate_content_stream(
                model=config.model_id,
                contents=contents,
                config=gen_config,
            )
        except Exception as exc:
            logger.error("[%s] Stream API error: %s", config.name, exc)
            raise

        full_parts = []
        tokens_used = 0

        for chunk in stream:
            text = ""
            if hasattr(chunk, "text") and chunk.text:
                text = chunk.text
            elif hasattr(chunk, "candidates") and chunk.candidates:
                for candidate in chunk.candidates:
                    if hasattr(candidate, "content") and candidate.content:
                        for part in candidate.content.parts:
                            if hasattr(part, "text") and part.text:
                                text += part.text

            if text:
                full_parts.append(text)
                yield AIStreamChunk(delta=text)

            # Capture usage from final chunk
            if hasattr(chunk, "usage_metadata") and chunk.usage_metadata:
                tokens_used = (
                    getattr(chunk.usage_metadata, "prompt_token_count", 0)
                    + getattr(chunk.usage_metadata, "candidates_token_count", 0)
                )

        # Final chunk
        yield AIStreamChunk(
            delta="",
            done=True,
            tokens_used=tokens_used,
            full_content="".join(full_parts),
        )

    def validate_key(self, config: ModelConfig) -> bool:
        return bool(config.api_key)