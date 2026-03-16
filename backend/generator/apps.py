# generator/apps.py
from django.apps import AppConfig


class GeneratorConfig(AppConfig):
    """Configuration for the generator app."""
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'generator'
    verbose_name = 'Website Generator'
