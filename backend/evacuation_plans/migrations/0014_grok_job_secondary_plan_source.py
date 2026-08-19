from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('evacuation_plans', '0013_add_grok_sketch_history_method'),
    ]

    operations = [
        migrations.AddField(
            model_name='grokcleaningjob',
            name='source_image_data',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='grokcleaningjob',
            name='target_kind',
            field=models.CharField(default='main', max_length=16),
        ),
    ]
