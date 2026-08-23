from django.db import migrations, models


def preserve_legacy_zone_fills(apps, schema_editor):
    """Keep the colour that legacy zones previously received at render time."""
    PlanShape = apps.get_model('evacuation_plans', 'PlanShape')
    PlanShape.objects.filter(
        models.Q(fill_color__isnull=True) | models.Q(fill_color=''),
        shape_type='zone',
    ).update(fill_color=models.F('color'))


class Migration(migrations.Migration):

    dependencies = [
        ('evacuation_plans', '0024_plantext_align'),
    ]

    operations = [
        migrations.RunPython(preserve_legacy_zone_fills, migrations.RunPython.noop),
    ]
