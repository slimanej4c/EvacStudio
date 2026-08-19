from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('evacuation_plans', '0014_grok_job_secondary_plan_source'),
    ]

    operations = [
        migrations.AddField(
            model_name='planoverlay',
            name='is_original',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='planoverlay',
            name='original_image_file',
            field=models.FileField(blank=True, null=True, upload_to='plan_overlays_original/'),
        ),
        migrations.AddField(
            model_name='grokcleaningjob',
            name='target_overlay',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='grok_cleaning_jobs',
                to='evacuation_plans.planoverlay',
            ),
        ),
    ]
