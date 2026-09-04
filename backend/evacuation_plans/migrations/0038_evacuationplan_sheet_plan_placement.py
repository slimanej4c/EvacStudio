from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('evacuation_plans', '0037_plan_situation'),
    ]

    operations = [
        migrations.AddField(
            model_name='evacuationplan',
            name='sheet_plan_placement',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
