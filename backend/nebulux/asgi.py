# nebulux/asgi.py
"""
ASGI config for Nebulux.

Currently configured for standard HTTP only (no WebSockets / channels).
If you add Django Channels later, update this file accordingly.

Production deployment with Uvicorn:
    uvicorn nebulux.asgi:application \
        --host 0.0.0.0 \
        --port 8000 \
        --workers 4 \
        --log-level info
"""
import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "nebulux.settings")

application = get_asgi_application()