from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('evacuation_plans', '0017_add_open_polyline_shape'),
    ]

    operations = [
        migrations.AddField(
            model_name='evacuationplan',
            name='main_plan_visible',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='evacuationplan',
            name='main_plan_z_index',
            field=models.IntegerField(default=0),
        ),
        migrations.AddField(
            model_name='planoverlay',
            name='visible',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='planoverlay',
            name='z_index',
            field=models.IntegerField(default=100),
        ),
        migrations.AddField(
            model_name='planshape',
            name='visible',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='planshape',
            name='z_index',
            field=models.IntegerField(default=200),
        ),
        migrations.AddField(
            model_name='planicon',
            name='visible',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='planicon',
            name='z_index',
            field=models.IntegerField(default=300),
        ),
        migrations.AddField(
            model_name='plantext',
            name='visible',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='plantext',
            name='z_index',
            field=models.IntegerField(default=400),
        ),
    ]
