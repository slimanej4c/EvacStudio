from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('evacuation_plans', '0006_backfill_openai_cleaning_history'),
    ]

    operations = [
        migrations.AddField(
            model_name='openaiplancleaningjob',
            name='actual_cost',
            field=models.DecimalField(blank=True, decimal_places=3, max_digits=8, null=True),
        ),
        migrations.AddField(
            model_name='openaiplancleaningjob',
            name='actual_cost_available',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='openaiplancleaningjob',
            name='estimated_cost_max',
            field=models.DecimalField(blank=True, decimal_places=3, max_digits=8, null=True),
        ),
        migrations.AddField(
            model_name='openaiplancleaningjob',
            name='estimated_cost_min',
            field=models.DecimalField(blank=True, decimal_places=3, max_digits=8, null=True),
        ),
        migrations.AddField(
            model_name='openaiplancleaningjob',
            name='generation_attempts',
            field=models.PositiveIntegerField(default=1),
        ),
        migrations.AddField(
            model_name='openaiplancleaningjob',
            name='pricing_currency',
            field=models.CharField(default='USD', max_length=8),
        ),
        migrations.AddField(
            model_name='openaiplancleaningjob',
            name='quality',
            field=models.CharField(default='medium', max_length=16),
        ),
        migrations.AddField(
            model_name='openaiplancleaningjob',
            name='verification_enabled',
            field=models.BooleanField(default=False),
        ),
    ]
