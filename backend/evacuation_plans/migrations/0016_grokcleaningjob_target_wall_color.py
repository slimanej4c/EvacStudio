from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('evacuation_plans', '0015_secondary_plan_original_and_grok_target'),
    ]

    operations = [
        migrations.AddField(
            model_name='grokcleaningjob',
            name='target_wall_color',
            field=models.CharField(default='#000000', max_length=16),
        ),
    ]
