from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("evacuation_plans", "0034_plan_export_compliance_and_automatic_number"),
    ]

    operations = [
        migrations.AddField(
            model_name="evacuationplan",
            name="measured_scale_denominator",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="planshape",
            name="calibration_real_distance_m",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="planshape",
            name="is_scale_calibration",
            field=models.BooleanField(default=False),
        ),
        migrations.AddConstraint(
            model_name="planshape",
            constraint=models.UniqueConstraint(
                condition=models.Q(is_scale_calibration=True),
                fields=("plan",),
                name="one_scale_calibration_per_plan",
            ),
        ),
    ]
