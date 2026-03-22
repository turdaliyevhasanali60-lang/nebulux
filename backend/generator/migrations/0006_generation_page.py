# generator/migrations/0006_generation_page.py
"""
DATA-5: Create GenerationPage table to store multi-page HTML outside the
pages_json JSONField.  Old records retain pages_json for backward compat;
new records write to GenerationPage and fall back to pages_json only when
no rows exist for a generation.
"""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("generator", "0005_website_snapshot"),
    ]

    operations = [
        migrations.CreateModel(
            name="GenerationPage",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "slug",
                    models.CharField(
                        help_text="URL slug, e.g. 'index', 'about'",
                        max_length=100,
                    ),
                ),
                (
                    "html",
                    models.TextField(help_text="Full page HTML"),
                ),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "generation",
                    models.ForeignKey(
                        db_index=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="pages",
                        to="generator.websitegeneration",
                    ),
                ),
            ],
            options={
                "ordering": ["slug"],
            },
        ),
        migrations.AddConstraint(
            model_name="generationpage",
            constraint=models.UniqueConstraint(
                fields=["generation", "slug"],
                name="unique_generation_page_slug",
            ),
        ),
    ]
