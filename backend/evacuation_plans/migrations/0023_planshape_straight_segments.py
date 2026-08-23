from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('evacuation_plans', '0022_planshape_closed'),
    ]

    operations = [
        migrations.AddField(
            model_name='planshape',
            name='straight_segments',
            field=models.JSONField(blank=True, default=list),
        ),
    ]
