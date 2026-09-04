from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("evacuation_plans", "0029_consolidate_pictogram_catalogues"),
    ]

    operations = [
        migrations.AddField(
            model_name="planicon",
            name="lock_aspect_ratio",
            field=models.BooleanField(default=True),
        ),
    ]
