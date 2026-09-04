from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("evacuation_plans", "0032_evacuationplan_plan_information_visibility"),
    ]

    operations = [
        migrations.AddField(
            model_name="evacuationplan",
            name="plan_information_layout",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
