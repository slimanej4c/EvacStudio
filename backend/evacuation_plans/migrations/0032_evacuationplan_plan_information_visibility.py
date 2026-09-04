from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("evacuation_plans", "0031_evacuationplan_required_plan_information"),
    ]

    operations = [
        migrations.AddField(
            model_name="evacuationplan",
            name="plan_information_visibility",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
