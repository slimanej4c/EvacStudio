from django.db import migrations, models


def remember_current_templates(apps, schema_editor):
    EvacuationPlan = apps.get_model("evacuation_plans", "EvacuationPlan")
    for plan in EvacuationPlan.objects.exclude(active_sheet_template_key="none").iterator():
        plan.last_sheet_template_key = plan.active_sheet_template_key
        plan.last_sheet_template_version_id = plan.active_sheet_template_version_id
        plan.last_sheet_template_name = plan.active_sheet_template_name
        plan.save(update_fields=[
            "last_sheet_template_key",
            "last_sheet_template_version_id",
            "last_sheet_template_name",
        ])


class Migration(migrations.Migration):

    dependencies = [
        ("evacuation_plans", "0035_scale_calibration"),
    ]

    operations = [
        migrations.AddField(
            model_name="evacuationplan",
            name="last_sheet_template_key",
            field=models.CharField(
                default="none",
                max_length=64,
                verbose_name="Dernier template choisi",
            ),
        ),
        migrations.AddField(
            model_name="evacuationplan",
            name="last_sheet_template_version_id",
            field=models.CharField(
                blank=True,
                default="",
                max_length=160,
                verbose_name="Version du dernier template choisi",
            ),
        ),
        migrations.AddField(
            model_name="evacuationplan",
            name="last_sheet_template_name",
            field=models.CharField(
                blank=True,
                default="",
                max_length=255,
                verbose_name="Nom du dernier template choisi",
            ),
        ),
        migrations.RunPython(remember_current_templates, migrations.RunPython.noop),
    ]
