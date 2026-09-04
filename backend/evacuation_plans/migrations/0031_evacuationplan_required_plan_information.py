from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("evacuation_plans", "0030_planicon_lock_aspect_ratio"),
    ]

    operations = [
        migrations.AddField(
            model_name="evacuationplan",
            name="design_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="evacuationplan",
            name="designer",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="evacuationplan",
            name="establishment_name",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="evacuationplan",
            name="last_verification_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="evacuationplan",
            name="next_verification_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="evacuationplan",
            name="plan_number",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
        migrations.AddField(
            model_name="evacuationplan",
            name="revision_index",
            field=models.CharField(blank=True, default="", max_length=50),
        ),
    ]
