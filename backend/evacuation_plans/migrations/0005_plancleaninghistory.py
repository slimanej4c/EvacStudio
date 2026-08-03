from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('evacuation_plans', '0004_openaiplancleaningjob'),
    ]

    operations = [
        migrations.CreateModel(
            name='PlanCleaningHistory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('cleaning_method', models.CharField(choices=[('local', 'Local cleanup'), ('local_walls', 'Local walls cleanup'), ('openai_sketch_to_plan', 'OpenAI sketch to plan'), ('openai_existing_plan', 'OpenAI existing plan cleanup'), ('openai_applied', 'OpenAI applied result')], max_length=64)),
                ('title', models.CharField(max_length=255)),
                ('image_file', models.FileField(upload_to='backgrounds_cleaned/history/')),
                ('options', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('openai_job', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='history_entries', to='evacuation_plans.openaiplancleaningjob')),
                ('plan', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='cleaning_history', to='evacuation_plans.evacuationplan')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='plan_cleaning_history', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
