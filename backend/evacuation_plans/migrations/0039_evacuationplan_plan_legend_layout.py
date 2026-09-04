from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('evacuation_plans', '0038_evacuationplan_sheet_plan_placement'),
    ]

    operations = [
        migrations.AddField(
            model_name='evacuationplan',
            name='plan_legend_layout',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
