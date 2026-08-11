from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('evacuation_plans', '0009_planoverlay'),
    ]

    operations = [
        migrations.AddField(
            model_name='evacuationplan',
            name='main_plan_height',
            field=models.FloatField(default=0.0),
        ),
        migrations.AddField(
            model_name='evacuationplan',
            name='main_plan_locked',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='evacuationplan',
            name='main_plan_width',
            field=models.FloatField(default=0.0),
        ),
        migrations.AddField(
            model_name='evacuationplan',
            name='main_plan_x',
            field=models.FloatField(default=0.0),
        ),
        migrations.AddField(
            model_name='evacuationplan',
            name='main_plan_y',
            field=models.FloatField(default=0.0),
        ),
        migrations.AddField(
            model_name='evacuationplan',
            name='watermark_config',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='planicon',
            name='locked',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='planoverlay',
            name='locked',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='planshape',
            name='locked',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='plantext',
            name='locked',
            field=models.BooleanField(default=False),
        ),
    ]
