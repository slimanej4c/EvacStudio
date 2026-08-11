from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('evacuation_plans', '0008_evacuationplan_secondary_background_file'),
    ]

    operations = [
        # A single secondary background could not hold the several plans the
        # canvas now supports: the overlays below replace it.
        migrations.RemoveField(
            model_name='evacuationplan',
            name='secondary_background_file',
        ),
        migrations.CreateModel(
            name='PlanOverlay',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('image_file', models.FileField(upload_to='plan_overlays/')),
                ('x', models.FloatField(default=0.0)),
                ('y', models.FloatField(default=0.0)),
                ('width', models.FloatField()),
                ('height', models.FloatField()),
                ('rotation', models.FloatField(default=0.0)),
                ('label', models.CharField(blank=True, default='', max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('plan', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='overlays', to='evacuation_plans.evacuationplan')),
            ],
            options={
                'ordering': ['id'],
            },
        ),
    ]
