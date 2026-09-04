import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import evacuation_plans.models


def populate_project_uuids(apps, schema_editor):
    EvacuationPlan = apps.get_model('evacuation_plans', 'EvacuationPlan')
    for plan in EvacuationPlan.objects.filter(project_uuid__isnull=True).iterator():
        plan.project_uuid = uuid.uuid4()
        plan.save(update_fields=['project_uuid'])


class Migration(migrations.Migration):

    dependencies = [
        ('evacuation_plans', '0040_plan_folders_multiple_leaders_and_legend_visibility'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='evacuationplan',
            name='archived_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='evacuationplan',
            name='project_uuid',
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.RunPython(populate_project_uuids, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='evacuationplan',
            name='project_uuid',
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
        migrations.AddField(
            model_name='evacuationplan',
            name='template_snapshot',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.CreateModel(
            name='PlanProjectAsset',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('sha256', models.CharField(max_length=64)),
                ('file', models.FileField(max_length=500, upload_to=evacuation_plans.models.project_asset_upload_to)),
                ('original_name', models.CharField(max_length=255)),
                ('media_type', models.CharField(default='application/octet-stream', max_length=100)),
                ('size', models.PositiveBigIntegerField(default=0)),
                ('kind', models.CharField(default='other', max_length=32)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('plan', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='project_assets', to='evacuation_plans.evacuationplan')),
            ],
            options={'ordering': ['sha256']},
        ),
        migrations.CreateModel(
            name='PlanProjectResource',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('role', models.CharField(max_length=40)),
                ('key', models.CharField(max_length=255)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('asset', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='resource_bindings', to='evacuation_plans.planprojectasset')),
                ('plan', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='project_resources', to='evacuation_plans.evacuationplan')),
            ],
            options={'ordering': ['role', 'key']},
        ),
        migrations.CreateModel(
            name='PlanProjectRevision',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('revision_number', models.PositiveIntegerField()),
                ('schema_version', models.PositiveIntegerField(default=1)),
                ('reason', models.CharField(default='save', max_length=24)),
                ('manifest', models.JSONField()),
                ('manifest_sha256', models.CharField(max_length=64)),
                ('previous_manifest_sha256', models.CharField(blank=True, default='', max_length=64)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_plan_project_revisions', to=settings.AUTH_USER_MODEL)),
                ('plan', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='project_revisions', to='evacuation_plans.evacuationplan')),
            ],
            options={'ordering': ['-revision_number']},
        ),
        migrations.AddConstraint(
            model_name='planprojectasset',
            constraint=models.UniqueConstraint(fields=('plan', 'sha256'), name='unique_project_asset_hash'),
        ),
        migrations.AddConstraint(
            model_name='planprojectresource',
            constraint=models.UniqueConstraint(fields=('plan', 'role', 'key'), name='unique_project_resource_key'),
        ),
        migrations.AddConstraint(
            model_name='planprojectrevision',
            constraint=models.UniqueConstraint(fields=('plan', 'revision_number'), name='unique_project_revision_number'),
        ),
    ]
