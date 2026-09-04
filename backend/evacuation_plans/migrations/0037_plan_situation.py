from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("evacuation_plans", "0036_evacuationplan_last_sheet_template"),
    ]

    operations = [
        migrations.AddField(
            model_name="evacuationplan",
            name="plan_situation_background_file",
            field=models.FileField(
                blank=True,
                null=True,
                upload_to="situation_backgrounds/",
            ),
        ),
        migrations.AddField(
            model_name="evacuationplan",
            name="plan_situation_config",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
