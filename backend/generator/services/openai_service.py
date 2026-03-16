# generator/services/openai_service.py
"""
Backwards-compatibility shim.

views.py imports from this module:
    from .services.openai_service import (
        AIServiceError, complete_spec, edit_website,
        extract_spec, generate_website, generate_website_stream, validate_api_key,
    )

All functions are now in ai_service.py. This file re-exports them so
existing imports continue to work with zero changes.

You can update views.py to import from ai_service.py directly whenever
you're ready — this shim is just for a smooth migration.
"""
from .ai_service import (  # noqa: F401
    AIServiceError,
    complete_spec,
    edit_website,
    extract_spec,
    generate_website,
    generate_website_stream,
    validate_api_key,
)