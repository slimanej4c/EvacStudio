from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('evacuation_plans', '0020_workspaceinvitation_workspacemembership'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='SheetTemplateVersion',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('version_id', models.CharField(max_length=128)),
                ('template_key', models.CharField(max_length=64)),
                ('name', models.CharField(max_length=255)),
                ('blocks', models.JSONField(default=list)),
                ('plan_placement', models.JSONField(default=dict)),
                ('source_created_at', models.DateTimeField()),
                ('source_updated_at', models.DateTimeField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='sheet_template_versions', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['template_key', '-source_updated_at', 'version_id'],
            },
        ),
        migrations.AddConstraint(
            model_name='sheettemplateversion',
            constraint=models.UniqueConstraint(fields=('user', 'version_id'), name='unique_sheet_template_version_per_user'),
        ),
    ]
