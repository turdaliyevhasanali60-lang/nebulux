# nebulux/__init__.py
"""
Make Celery's app available as the package-level `celery_app` attribute.

This import ensures that the Celery application is initialised whenever
Django starts — which is required for @shared_task decorators in accounts/tasks.py
and any other app to bind correctly at import time.

Without this file the tasks defined with @shared_task will not be discovered
automatically and the monthly credit-reset Beat job will never fire.
"""
from .celery import app as celery_app  # noqa: F401

__all__ = ("celery_app",)