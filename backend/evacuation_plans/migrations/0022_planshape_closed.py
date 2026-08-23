from django.db import migrations, models


def mark_existing_polylines_open(apps, schema_editor):
    PlanShape = apps.get_model('evacuation_plans', 'PlanShape')
    PlanShape.objects.filter(shape_type='polyline').update(closed=False)


class Migration(migrations.Migration):

    dependencies = [
        ('evacuation_plans', '0021_sheettemplateversion'),
    ]

    operations = [
        migrations.AddField(
            model_name='planshape',
            name='closed',
            field=models.BooleanField(default=True),
        ),
        migrations.RunPython(mark_existing_polylines_open, migrations.RunPython.noop),
    ]
