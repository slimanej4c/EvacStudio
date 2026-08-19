from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('evacuation_plans', '0012_object_groups'),
    ]

    operations = [
        migrations.AlterField(
            model_name='plancleaninghistory',
            name='cleaning_method',
            field=models.CharField(
                choices=[
                    ('local', 'Local cleanup'),
                    ('local_walls', 'Local walls cleanup'),
                    ('grok', 'Grok empty-base cleanup'),
                    ('grok_autocad', 'Grok AutoCAD cleanup'),
                    ('grok_sketch', 'Grok hand-drawn sketch conversion'),
                    ('manual_edit', 'Manual eraser edit'),
                ],
                max_length=64,
            ),
        ),
    ]
