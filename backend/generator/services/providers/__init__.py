# generator/services/providers/__init__.py
"""
Provider abstraction layer.

Each provider (OpenAI, Anthropic, Google) implements the same interface:
    call()        → AIResponse
    call_stream() → Generator[AIStreamChunk, ...]

The factory `get_provider(config)` returns the right provider for any ModelConfig.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Dict, Generator, List, Optional

from ..model_registry import (
    ModelConfig,
    PROVIDER_OPENAI,
    PROVIDER_ANTHROPIC,
    PROVIDER_GOOGLE,
)

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
#  Normalized response types  (every provider returns these)
# ──────────────────────────────────────────────────────────────────────────────
@dataclass
class AIResponse:
    """Normalized response from any provider."""
    content: str                # the model's text output
    tokens_used: int            # total tokens (input + output)
    model: str                  # model ID that was actually used
    raw: Any = None             # original provider response (for debugging)


@dataclass
class AIStreamChunk:
    """Single chunk from a streaming response."""
    delta: str                  # incremental text
    done: bool = False          # True on the final chunk
    tokens_used: int = 0        # populated on the final chunk
    full_content: str = ""      # populated on the final chunk


# ──────────────────────────────────────────────────────────────────────────────
#  Base provider interface
# ──────────────────────────────────────────────────────────────────────────────
class BaseProvider(ABC):
    """
    Abstract interface that every AI provider must implement.

    Providers are cached as singletons keyed by (provider_type, api_key, base_url).
    """

    @abstractmethod
    def call(
        self,
        config: ModelConfig,
        messages: List[Dict[str, Any]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AIResponse:
        """Make a synchronous completion call. Returns normalized AIResponse."""
        ...

    @abstractmethod
    def call_stream(
        self,
        config: ModelConfig,
        messages: List[Dict[str, Any]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> Generator[AIStreamChunk, None, None]:
        """Streaming completion. Yields AIStreamChunk; last chunk has done=True."""
        ...

    @abstractmethod
    def validate_key(self, config: ModelConfig) -> bool:
        """Quick check that the API key is configured."""
        ...


# ──────────────────────────────────────────────────────────────────────────────
#  Provider singleton cache
# ──────────────────────────────────────────────────────────────────────────────
_provider_cache: Dict[tuple, BaseProvider] = {}


def get_provider(config: ModelConfig) -> BaseProvider:
    """
    Factory: return the correct provider instance for a ModelConfig.

    Providers are cached so we don't create new SDK clients on every call.
    Cache key = (provider, api_key_setting, base_url) so different API keys
    or base URLs get different client instances.
    """
    cache_key = (config.provider, config.api_key_setting, config.base_url)

    if cache_key not in _provider_cache:
        if config.provider == PROVIDER_OPENAI:
            from .openai_provider import OpenAIProvider
            _provider_cache[cache_key] = OpenAIProvider()

        elif config.provider == PROVIDER_ANTHROPIC:
            from .anthropic_provider import AnthropicProvider
            _provider_cache[cache_key] = AnthropicProvider()

        elif config.provider == PROVIDER_GOOGLE:
            from .google_provider import GoogleProvider
            _provider_cache[cache_key] = GoogleProvider()

        else:
            raise ValueError(
                f"Unknown provider '{config.provider}'. "
                f"Supported: {PROVIDER_OPENAI}, {PROVIDER_ANTHROPIC}, {PROVIDER_GOOGLE}"
            )

        logger.info(
            "Initialized %s provider (key_setting=%s, base_url=%s)",
            config.provider, config.api_key_setting, config.base_url or "default",
        )

    return _provider_cache[cache_key]


def clear_provider_cache():
    """Clear all cached providers — useful for testing or key rotation."""
    _provider_cache.clear()