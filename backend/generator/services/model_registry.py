# generator/services/model_registry.py
"""
Model Registry — single source of truth for every AI model Nebulux supports.

Supports multiple providers:
  • OpenAI          (gpt-4o, gpt-5, o3, o4-mini, …)
  • OpenAI-compat   (DeepSeek, Groq, Together, Mistral — same SDK, different base_url)
  • Anthropic       (Claude Sonnet, Opus, Haiku)
  • Google          (Gemini 2.5 Pro, Flash, …)

Adding a new model is ONE step:
  1. Add an entry to MODEL_REGISTRY below.

Usage:
    from generator.services.model_registry import get_model_config

    cfg = get_model_config("spec")       # → ModelConfig for the spec task
    cfg = get_model_config("generate")   # → ModelConfig for website generation
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from django.conf import settings

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
#  Supported providers
# ──────────────────────────────────────────────────────────────────────────────
PROVIDER_OPENAI    = "openai"       # native OpenAI
PROVIDER_ANTHROPIC = "anthropic"    # Anthropic Claude
PROVIDER_GOOGLE    = "google"       # Google Gemini


# ──────────────────────────────────────────────────────────────────────────────
#  Model configuration dataclass
# ──────────────────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class ModelConfig:
    """
    Everything the service layer needs to know about a model.

    Fields:
        name                  Friendly label (for logs / admin UI)
        model_id              The API model string (e.g. "gpt-5", "claude-sonnet-4-20250514")
        provider              Provider backend: "openai", "anthropic", or "google"
        api_key_setting       Name of the Django setting holding the API key
                              (e.g. "OPENAI_API_KEY", "ANTHROPIC_API_KEY")
        base_url              Custom API base URL — used for OpenAI-compatible providers
                              like DeepSeek. None = default provider URL.
        supports_temperature  Whether the model accepts `temperature`
        supports_top_p        Whether the model accepts `top_p`
        max_output_tokens     Default max output tokens
        timeout               Per-call timeout in seconds
        default_temperature   Fallback temperature when caller doesn't specify
        extra_kwargs          Any additional API kwargs
                              (e.g. {"reasoning_effort": "high"} for o-series)
        supports_vision       Whether the model can process images
    """
    name: str
    model_id: str
    provider: str = PROVIDER_OPENAI
    api_key_setting: str = "OPENAI_API_KEY"
    base_url: Optional[str] = None
    supports_temperature: bool = True
    supports_top_p: bool = True
    max_output_tokens: int = 4096
    timeout: int = 60
    default_temperature: float = 0.7
    extra_kwargs: Dict[str, Any] = field(default_factory=dict)
    supports_vision: bool = True

    @property
    def api_key(self) -> str:
        """Resolve the API key from Django settings."""
        return str(getattr(settings, self.api_key_setting, "") or "")


# ──────────────────────────────────────────────────────────────────────────────
#  Registry
#
#  To add a new model, just add an entry here. That's it.
# ──────────────────────────────────────────────────────────────────────────────
MODEL_REGISTRY: Dict[str, ModelConfig] = {

    # ╔══════════════════════════════════════════════════════════════════════╗
    # ║  OPENAI                                                            ║
    # ╚══════════════════════════════════════════════════════════════════════╝

    "gpt-4o-mini": ModelConfig(
        name="GPT-4o Mini",
        model_id="gpt-4o-mini",
        provider=PROVIDER_OPENAI,
        max_output_tokens=1500,
        timeout=60,
        default_temperature=0.2,
    ),

    "gpt-4o": ModelConfig(
        name="GPT-4o",
        model_id="gpt-4o",
        provider=PROVIDER_OPENAI,
        max_output_tokens=16000,
        timeout=120,
        default_temperature=0.7,
    ),

    "gpt-4.1": ModelConfig(
        name="GPT-4.1",
        model_id="gpt-4.1",
        provider=PROVIDER_OPENAI,
        max_output_tokens=16000,
        timeout=120,
        default_temperature=0.7,
    ),

    "gpt-4.1-mini": ModelConfig(
        name="GPT-4.1 Mini",
        model_id="gpt-4.1-mini",
        provider=PROVIDER_OPENAI,
        max_output_tokens=4000,
        timeout=60,
        default_temperature=0.2,
    ),

    "gpt-5": ModelConfig(
        name="GPT-5",
        model_id="gpt-5",
        provider=PROVIDER_OPENAI,
        supports_temperature=False,
        supports_top_p=False,
        max_output_tokens=16000,
        timeout=600,
    ),

    "gpt-5-mini": ModelConfig(
        name="GPT-5 Mini",
        model_id="gpt-5-mini",
        provider=PROVIDER_OPENAI,
        supports_temperature=False,
        supports_top_p=False,
        max_output_tokens=8000,
        timeout=120,
    ),

    "o3": ModelConfig(
        name="o3",
        model_id="o3",
        provider=PROVIDER_OPENAI,
        supports_temperature=False,
        supports_top_p=False,
        max_output_tokens=16000,
        timeout=240,
        extra_kwargs={"reasoning_effort": "high"},
    ),

    "o3-mini": ModelConfig(
        name="o3 Mini",
        model_id="o3-mini",
        provider=PROVIDER_OPENAI,
        supports_temperature=False,
        supports_top_p=False,
        max_output_tokens=8000,
        timeout=120,
        extra_kwargs={"reasoning_effort": "medium"},
    ),

    "o4-mini": ModelConfig(
        name="o4 Mini",
        model_id="o4-mini",
        provider=PROVIDER_OPENAI,
        supports_temperature=False,
        supports_top_p=False,
        max_output_tokens=8000,
        timeout=120,
        extra_kwargs={"reasoning_effort": "medium"},
    ),

    # ╔══════════════════════════════════════════════════════════════════════╗
    # ║  ANTHROPIC                                                         ║
    # ╚══════════════════════════════════════════════════════════════════════╝

    "claude-sonnet-4": ModelConfig(
        name="Claude Sonnet 4",
        model_id="claude-sonnet-4-20250514",
        provider=PROVIDER_ANTHROPIC,
        api_key_setting="ANTHROPIC_API_KEY",
        max_output_tokens=16000,
        timeout=120,
        default_temperature=0.7,
        supports_vision=True,
    ),

    "claude-opus-4": ModelConfig(
        name="Claude Opus 4",
        model_id="claude-opus-4-20250514",
        provider=PROVIDER_ANTHROPIC,
        api_key_setting="ANTHROPIC_API_KEY",
        max_output_tokens=16000,
        timeout=180,
        default_temperature=0.7,
        supports_vision=True,
    ),

    "claude-haiku-3.5": ModelConfig(
        name="Claude Haiku 3.5",
        model_id="claude-haiku-4-5-20251001",
        provider=PROVIDER_ANTHROPIC,
        api_key_setting="ANTHROPIC_API_KEY",
        max_output_tokens=4000,
        timeout=60,
        default_temperature=0.2,
        supports_vision=True,
    ),

    "claude-sonnet-4-6": ModelConfig(
        name="Claude Sonnet 4.6",
        model_id="claude-sonnet-4-6",
        provider=PROVIDER_ANTHROPIC,
        api_key_setting="ANTHROPIC_API_KEY",
        max_output_tokens=16000,
        timeout=120,
        default_temperature=0.7,
        supports_vision=True,
    ),

    # ╔══════════════════════════════════════════════════════════════════════╗
    # ║  GOOGLE  (Gemini)                                                  ║
    # ╚══════════════════════════════════════════════════════════════════════╝

    "gemini-2.5-pro": ModelConfig(
        name="Gemini 2.5 Pro",
        model_id="gemini-2.5-pro",
        provider=PROVIDER_GOOGLE,
        api_key_setting="GOOGLE_AI_API_KEY",
        max_output_tokens=32000,
        timeout=300,
        default_temperature=0.7,
        supports_vision=True,
    ),

    "gemini-2.5-flash": ModelConfig(
        name="Gemini 2.5 Flash",
	model_id="gemini-2.5-flash",
        provider=PROVIDER_GOOGLE,
        api_key_setting="GOOGLE_AI_API_KEY",
        max_output_tokens=32000,
        timeout=180,
        default_temperature=0.2,
        supports_vision=True,
    ),

    "gemini-2.0-flash": ModelConfig(
        name="Gemini 2.0 Flash",
        model_id="gemini-2.0-flash",
        provider=PROVIDER_GOOGLE,
        api_key_setting="GOOGLE_AI_API_KEY",
        max_output_tokens=8000,
        timeout=60,
        default_temperature=0.7,
        supports_vision=True,
    ),

    # ╔══════════════════════════════════════════════════════════════════════╗
    # ║  DEEPSEEK  (OpenAI-compatible — same SDK, different base_url)      ║
    # ╚══════════════════════════════════════════════════════════════════════╝

    "deepseek-v3": ModelConfig(
        name="DeepSeek V3",
        model_id="deepseek-chat",
        provider=PROVIDER_OPENAI,                         # uses OpenAI SDK
        api_key_setting="DEEPSEEK_API_KEY",
        base_url="https://api.deepseek.com",
        max_output_tokens=8000,
        timeout=120,
        default_temperature=0.7,
        supports_vision=False,
    ),

    "deepseek-r1": ModelConfig(
        name="DeepSeek R1",
        model_id="deepseek-reasoner",
        provider=PROVIDER_OPENAI,
        api_key_setting="DEEPSEEK_API_KEY",
        base_url="https://api.deepseek.com",
        supports_temperature=False,
        supports_top_p=False,
        max_output_tokens=16000,
        timeout=180,
        supports_vision=False,
    ),

    # ╔══════════════════════════════════════════════════════════════════════╗
    # ║  GROQ  (OpenAI-compatible)                                         ║
    # ╚══════════════════════════════════════════════════════════════════════╝

    "groq-llama-4-scout": ModelConfig(
        name="Llama 4 Scout (Groq)",
        model_id="meta-llama/llama-4-scout-17b-16e-instruct",
        provider=PROVIDER_OPENAI,
        api_key_setting="GROQ_API_KEY",
        base_url="https://api.groq.com/openai/v1",
        max_output_tokens=8000,
        timeout=60,
        default_temperature=0.7,
        supports_vision=True,
    ),

    # ╔══════════════════════════════════════════════════════════════════════╗
    # ║  MISTRAL  (OpenAI-compatible)                                      ║
    # ╚══════════════════════════════════════════════════════════════════════╝

    "mistral-large": ModelConfig(
        name="Mistral Large",
        model_id="mistral-large-latest",
        provider=PROVIDER_OPENAI,
        api_key_setting="MISTRAL_API_KEY",
        base_url="https://api.mistral.ai/v1",
        max_output_tokens=8000,
        timeout=120,
        default_temperature=0.7,
        supports_vision=True,
    ),

    # ╔══════════════════════════════════════════════════════════════════════╗
    # ║  MOONSHOT  (Kimi — OpenAI-compatible)                              ║
    # ╚══════════════════════════════════════════════════════════════════════╝

    "kimi-k2.5": ModelConfig(
        name="Kimi K2.5",
        model_id="kimi-k2.5",
        provider=PROVIDER_OPENAI,
        api_key_setting="MOONSHOT_API_KEY",
        base_url="https://api.moonshot.cn/v1",
        max_output_tokens=32000,
        timeout=180,
        default_temperature=0.7,
        supports_vision=True,
    ),
}


# ──────────────────────────────────────────────────────────────────────────────
#  Task → model mapping  (reads from settings.AI_MODELS)
# ──────────────────────────────────────────────────────────────────────────────
_DEFAULT_TASK_MAP = {
    "spec":     "claude-haiku-3.5",
    "generate": "kimi-k2.5",
    "edit":     "kimi-k2.5",
    "fast_edit": "claude-haiku-3.5",
}


def _get_task_map() -> Dict[str, str]:
    """Return the task→model-slug mapping from settings, with defaults."""
    return getattr(settings, "AI_MODELS", _DEFAULT_TASK_MAP)


def get_model_config(task: str) -> ModelConfig:
    """
    Get the ModelConfig for a given task ("spec", "generate", "edit").

    Raises KeyError if the task or model slug is not found.
    """
    task_map = _get_task_map()
    slug = task_map.get(task)
    if slug is None:
        raise KeyError(
            f"Unknown task '{task}'. "
            f"Define it in settings.AI_MODELS. Available: {list(task_map.keys())}"
        )

    config = MODEL_REGISTRY.get(slug)
    if config is None:
        raise KeyError(
            f"Model slug '{slug}' (task '{task}') not in MODEL_REGISTRY. "
            f"Available: {list(MODEL_REGISTRY.keys())}"
        )

    return config


def get_active_models() -> Dict[str, ModelConfig]:
    """Return {task: ModelConfig} for all active task assignments."""
    task_map = _get_task_map()
    result = {}
    for task, slug in task_map.items():
        config = MODEL_REGISTRY.get(slug)
        if config:
            result[task] = config
        else:
            logger.warning("Task '%s' → unknown slug '%s'", task, slug)
    return result


def list_available_models() -> Dict[str, ModelConfig]:
    """Return the full registry — useful for admin UI / model picker."""
    return dict(MODEL_REGISTRY)
