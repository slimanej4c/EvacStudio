from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('evacuation_plans', '0011_element_grouping'),
    ]

    operations = [
        migrations.AddField(
            model_name='planicon',
            name='object_group_id',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
        migrations.AddField(
            model_name='planshape',
            name='object_group_id',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
        migrations.AddField(
            model_name='plantext',
            name='object_group_id',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
    ]
