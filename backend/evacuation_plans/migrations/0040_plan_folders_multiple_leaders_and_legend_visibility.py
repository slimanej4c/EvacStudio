from django.db import migrations, models
import django.db.models.deletion


def copy_legacy_leader_points(apps, schema_editor):
    PlanIcon = apps.get_model('evacuation_plans', 'PlanIcon')
    for icon in PlanIcon.objects.filter(
        anchor_x__isnull=False,
        anchor_y__isnull=False,
    ).iterator():
        icon.leader_points = [{
            'id': f'legacy-{icon.pk}',
            'x': icon.anchor_x,
            'y': icon.anchor_y,
        }]
        icon.save(update_fields=['leader_points'])


class Migration(migrations.Migration):

    dependencies = [
        ('evacuation_plans', '0039_evacuationplan_plan_legend_layout'),
    ]

    operations = [
        migrations.CreateModel(
            name='PlanFolder',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='plan_folders', to='auth.user')),
            ],
            options={
                'ordering': ['name', 'id'],
            },
        ),
        migrations.AddConstraint(
            model_name='planfolder',
            constraint=models.UniqueConstraint(fields=('user', 'name'), name='unique_plan_folder_name_per_user'),
        ),
        migrations.AddField(
            model_name='evacuationplan',
            name='folder',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='plans', to='evacuation_plans.planfolder'),
        ),
        migrations.AddField(
            model_name='evacuationplan',
            name='legend_hidden_icon_types',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='planicon',
            name='leader_points',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(copy_legacy_leader_points, migrations.RunPython.noop),
    ]
