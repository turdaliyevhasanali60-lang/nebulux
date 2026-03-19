from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("generator", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="PublishedSite",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True)),
                ("subdomain", models.SlugField(max_length=50, unique=True)),
                ("pages_json", models.JSONField(default=dict)),
                ("is_active", models.BooleanField(default=True)),
                ("has_unpublished_changes", models.BooleanField(default=False)),
                ("published_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="published_sites", to=settings.AUTH_USER_MODEL)),
                ("generation", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="published_site", to="generator.websitegeneration")),
            ],
            options={"db_table": "publishing_publishedsite"},
        ),
    ]
