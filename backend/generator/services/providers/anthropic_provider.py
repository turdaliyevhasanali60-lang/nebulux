# generator/services/providers/anthropic_provider.py
"""
Anthropic provider — handles all Claude models.

Key differences from OpenAI:
  - System prompt is a separate `system` parameter, not a message in the list
  - Image content blocks use a different schema
  - Streaming uses event-based iteration
  - Token counting uses input_tokens + output_tokens (no total_tokens)

Install: pip install anthropic
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Generator, List

from ..model_registry import ModelConfig
from . import AIResponse, AIStreamChunk, BaseProvider

logger = logging.getLogger(__name__)

# Client cache: api_key_setting → Anthropic instance
_clients: Dict[str, Any] = {}


def _get_client(config: ModelConfig):
    """Get or create an Anthropic client."""
    if config.api_key_setting not in _clients:
        try:
            from anthropic import Anthropic
        except ImportError:
            raise ImportError(
                "Anthropic SDK not installed. Run: pip install anthropic"
            )

        _clients[config.api_key_setting] = Anthropic(
            api_key=config.api_key,
            timeout=float(config.timeout),
        )
        logger.info("Created Anthropic client (key_setting=%s)", config.api_key_setting)

    return _clients[config.api_key_setting]


def _convert_messages(messages: List[Dict[str, Any]]) -> tuple:
    """
    Convert OpenAI-format messages to Anthropic format.

    OpenAI format:
      [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}]

    Anthropic format:
      system = "..."
      messages = [{"role": "user", "content": "..."}]

    Also converts OpenAI image_url content blocks to Anthropic image blocks.
    """
    system_parts = []
    converted = []

    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")

        # Extract system messages into the separate system param
        if role == "system":
            if isinstance(content, str):
                system_parts.append(content)
            continue

        # Convert content format
        if isinstance(content, list):
            # Multi-modal content — convert image blocks
            anthropic_content = []
            for block in content:
                if block.get("type") == "text":
                    anthropic_content.append({
                        "type": "text",
                        "text": block["text"],
                    })
                elif block.get("type") == "image_url":
                    # OpenAI: {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
                    # Anthropic: {"type": "image", "source": {"type": "base64", "media_type": "...", "data": "..."}}
                    url = block.get("image_url", {}).get("url", "")
                    if url.startswith("data:"):
                        # Parse data URL: data:image/png;base64,<data>
                        header, _, b64data = url.partition(",")
                        media_type = header.split(":")[1].split(";")[0] if ":" in header else "image/png"
                        anthropic_content.append({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": b64data,
                            },
                        })
                    # Skip non-data-URL images (Anthropic doesn't support URL fetch)
            content = anthropic_content
        else:
            # Plain text — wrap it for consistency
            content = content

        converted.append({"role": role, "content": content})

    system = "\n\n".join(system_parts) if system_parts else ""
    return system, converted


class AnthropicProvider(BaseProvider):
    """Provider for Anthropic Claude models."""

    def call(
        self,
        config: ModelConfig,
        messages: List[Dict[str, Any]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AIResponse:
        client = _get_client(config)
        system, converted_messages = _convert_messages(messages)

        out = max_tokens if max_tokens is not None else config.max_output_tokens
        temp = temperature if temperature is not None else config.default_temperature

        kwargs: Dict[str, Any] = {
            "model": config.model_id,
            "max_tokens": int(out),
            "messages": converted_messages,
        }
        if system:
            kwargs["system"] = system
        if config.supports_temperature and temp is not None:
            kwargs["temperature"] = float(temp)

        try:
            response = client.messages.create(**kwargs)
        except Exception as exc:
            logger.error("[%s] API error: %s", config.name, exc)
            raise

        # Extract text content from response
        content = ""
        for block in response.content:
            if hasattr(block, "text"):
                content += block.text

        tokens = (
            getattr(response.usage, "input_tokens", 0)
            + getattr(response.usage, "output_tokens", 0)
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
        client = _get_client(config)
        system, converted_messages = _convert_messages(messages)

        out = max_tokens if max_tokens is not None else config.max_output_tokens
        temp = temperature if temperature is not None else config.default_temperature

        kwargs: Dict[str, Any] = {
            "model": config.model_id,
            "max_tokens": int(out),
            "messages": converted_messages,
        }
        if system:
            kwargs["system"] = system
        if config.supports_temperature and temp is not None:
            kwargs["temperature"] = float(temp)

        try:
            stream = client.messages.stream(**kwargs)
        except Exception as exc:
            logger.error("[%s] Stream API error: %s", config.name, exc)
            raise

        full_parts = []
        tokens_used = 0

        with stream as s:
            for event in s:
                # Text delta events
                if hasattr(event, "type"):
                    if event.type == "content_block_delta":
                        delta_text = getattr(event.delta, "text", "")
                        if delta_text:
                            full_parts.append(delta_text)
                            yield AIStreamChunk(delta=delta_text)

                    elif event.type == "message_delta":
                        # Final usage info
                        usage = getattr(event, "usage", None)
                        if usage:
                            tokens_used += getattr(usage, "output_tokens", 0)

                    elif event.type == "message_start":
                        msg = getattr(event, "message", None)
                        if msg and hasattr(msg, "usage"):
                            tokens_used += getattr(msg.usage, "input_tokens", 0)

        # Final chunk
        yield AIStreamChunk(
            delta="",
            done=True,
            tokens_used=tokens_used,
            full_content="".join(full_parts),
        )

    def validate_key(self, config: ModelConfig) -> bool:
        return bool(config.api_key)