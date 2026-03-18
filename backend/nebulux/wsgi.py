from gevent import monkey
monkey.patch_all()

# nebulux/wsgi.py
"""
WSGI config for Nebulux.

Production deployment:
    gunicorn nebulux.wsgi:application \
        --workers 4 \
        --worker-class sync \
        --bind 0.0.0.0:8000 \
        --timeout 120 \
        --keep-alive 5 \
        --log-level info \
        --access-logfile logs/gunicorn_access.log \
        --error-logfile  logs/gunicorn_error.log

Worker count rule of thumb: 2 * CPU_COUNT + 1
For a 2-core VPS: --workers 5
"""
import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "nebulux.settings")

application = get_wsgi_application()