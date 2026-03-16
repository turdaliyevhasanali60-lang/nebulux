# accounts/migrations/0002_user_onboarding.py
from django.db import migrations, models


def mark_existing_users_onboarded(apps, schema_editor):
    """Existing users should not see the onboarding questionnaire."""
    User = apps.get_model("accounts", "User")
    User.objects.all().update(has_onboarded=True)


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="has_onboarded",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="user",
            name="onboarding_data",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.RunPython(mark_existing_users_onboarded, migrations.RunPython.noop),
    ]