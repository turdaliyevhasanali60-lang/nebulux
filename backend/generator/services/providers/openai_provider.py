# generator/services/providers/openai_provider.py
"""
OpenAI provider — handles native OpenAI AND all OpenAI-compatible APIs.

OpenAI-compatible APIs (DeepSeek, Groq, Together, Mistral, etc.) use the
same SDK with a different base_url and API key. The ModelConfig.base_url
field controls which endpoint the client connects to.

Client instances are cached per (api_key_setting, base_url) pair.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Generator, List

from openai import OpenAI, OpenAIError

from ..model_registry import ModelConfig
from . import AIResponse, AIStreamChunk, BaseProvider

logger = logging.getLogger(__name__)

# Client cache: (api_key_setting, base_url) → OpenAI instance
_clients: Dict[tuple, OpenAI] = {}


def _get_client(config: ModelConfig) -> OpenAI:
    """Get or create an OpenAI client for the given config."""
    key = (config.api_key_setting, config.base_url)
    if key not in _clients:
        client_kwargs: Dict[str, Any] = {
            "api_key": config.api_key,
            "timeout": config.timeout,
        }
        if config.base_url:
            client_kwargs["base_url"] = config.base_url

        _clients[key] = OpenAI(**client_kwargs)
        logger.info(
            "Created OpenAI client: key_setting=%s, base_url=%s",
            config.api_key_setting,
            config.base_url or "https://api.openai.com/v1",
        )

    return _clients[key]


def _build_kwargs(
    config: ModelConfig,
    *,
    temperature: float | None,
    max_tokens: int | None,
) -> Dict[str, Any]:
    """Build model-compatible kwargs for chat.completions.create()."""
    out = max_tokens if max_tokens is not None else config.max_output_tokens

    kwargs: Dict[str, Any] = {
        "model": config.model_id,
        "max_completion_tokens": int(out),
    }

    # Temperature — skip if model doesn't support it
    temp = temperature if temperature is not None else config.default_temperature
    if config.supports_temperature and temp is not None:
        kwargs["temperature"] = float(temp)

    # Extra model-specific kwargs (e.g. reasoning_effort for o-series)
    if config.extra_kwargs:
        kwargs.update(config.extra_kwargs)

    return kwargs


class OpenAIProvider(BaseProvider):
    """
    Provider for OpenAI and all OpenAI-compatible APIs.

    This single provider covers:
      - OpenAI (gpt-4o, gpt-5, o3, o4-mini, …)
      - DeepSeek (base_url = https://api.deepseek.com)
      - Groq (base_url = https://api.groq.com/openai/v1)
      - Mistral (base_url = https://api.mistral.ai/v1)
      - Together, Fireworks, etc.
    """

    def call(
        self,
        config: ModelConfig,
        messages: List[Dict[str, Any]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AIResponse:
        client = _get_client(config)
        kwargs = _build_kwargs(config, temperature=temperature, max_tokens=max_tokens)

        try:
            response = client.chat.completions.create(
                **kwargs,
                timeout=config.timeout,
                messages=messages,
            )
        except OpenAIError as exc:
            logger.error("[%s] API error: %s", config.name, exc)
            raise

        content = response.choices[0].message.content or ""
        tokens = int(getattr(response.usage, "total_tokens", 0) or 0)

        return AIResponse(
            content=content,
            tokens_used=tokens,
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
        kwargs = _build_kwargs(config, temperature=temperature, max_tokens=max_tokens)

        try:
            stream = client.chat.completions.create(
                **kwargs,
                timeout=config.timeout,
                stream=True,
                stream_options={"include_usage": True},
                messages=messages,
            )
        except OpenAIError as exc:
            logger.error("[%s] Stream API error: %s", config.name, exc)
            raise

        full_parts = []
        tokens_used = 0

        for chunk in stream:
            if hasattr(chunk, "usage") and chunk.usage:
                tokens_used = int(getattr(chunk.usage, "total_tokens", 0) or 0)

            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                full_parts.append(delta)
                yield AIStreamChunk(delta=delta)

        # Final chunk
        yield AIStreamChunk(
            delta="",
            done=True,
            tokens_used=tokens_used,
            full_content="".join(full_parts),
        )

    def validate_key(self, config: ModelConfig) -> bool:
        return bool(config.api_key)