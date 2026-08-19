from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('evacuation_plans', '0016_grokcleaningjob_target_wall_color'),
    ]

    operations = [
        migrations.AlterField(
            model_name='planshape',
            name='shape_type',
            field=models.CharField(
                choices=[
                    ('line', 'Line'),
                    ('rect', 'Rectangle'),
                    ('circle', 'Circle'),
                    ('zone', 'Zone'),
                    ('polyline', 'Open polyline'),
                    ('polygon_zone', 'Polygon zone'),
                    ('free_polygon_zone', 'Free polygon zone'),
                    ('curve_polygon_zone', 'Curve polygon zone'),
                ],
                max_length=32,
            ),
        ),
    ]
