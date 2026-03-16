# nebulux/celery.py
"""
Celery application entry point.

Workers are started with:
    celery -A nebulux worker -l info -c 4

For production, use a process supervisor (systemd/supervisor) to manage workers.
Redis is used as both broker and result backend — already required by Django caching.
"""
import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "nebulux.settings")

app = Celery("nebulux")

# Pull configuration from Django settings, namespaced under CELERY_*
app.config_from_object("django.conf:settings", namespace="CELERY")

# Auto-discover tasks in any installed app's tasks.py
app.autodiscover_tasks()


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    print(f"Request: {self.request!r}")
