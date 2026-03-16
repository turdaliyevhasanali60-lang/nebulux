# accounts/migrations/0003_paid_only_launch.py
"""
Paid-Only Launch migration:
  1. Changes the model default for credits from 30 → 0
  2. Sets all existing free-plan users' credits to 0
  3. Updates monthly_credit_limit for free plan from 30 → 0

Run: python manage.py migrate accounts
"""
from django.db import migrations, models


def zero_out_free_credits(apps, schema_editor):
    """Set credits to 0 for all users on the free plan."""
    User = apps.get_model("accounts", "User")
    count = User.objects.filter(plan="free").update(credits=0)
    if count:
        print(f"\n  → Zeroed credits for {count} free-plan user(s)")


def restore_free_credits(apps, schema_editor):
    """Reverse: give free-plan users 30 credits back."""
    User = apps.get_model("accounts", "User")
    User.objects.filter(plan="free", credits=0).update(credits=30)


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0002_user_onboarding"),
    ]

    operations = [
        # Schema change: update model default
        migrations.AlterField(
            model_name="user",
            name="credits",
            field=models.PositiveIntegerField(default=0),
        ),
        # Data migration: zero out existing free users
        migrations.RunPython(zero_out_free_credits, restore_free_credits),
    ]