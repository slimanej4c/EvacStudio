from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('evacuation_plans', '0010_editor_state_watermark_and_locks'),
    ]

    operations = [
        migrations.AddField(
            model_name='evacuationplan',
            name='main_plan_group_id',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
        migrations.AddField(
            model_name='evacuationplan',
            name='main_plan_grouping_enabled',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='planicon',
            name='group_id',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
        migrations.AddField(
            model_name='planoverlay',
            name='group_id',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
        migrations.AddField(
            model_name='planshape',
            name='group_id',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
        migrations.AddField(
            model_name='plantext',
            name='group_id',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
    ]
