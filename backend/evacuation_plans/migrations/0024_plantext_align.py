from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('evacuation_plans', '0023_planshape_straight_segments'),
    ]

    operations = [
        migrations.AddField(
            model_name='plantext',
            name='align',
            field=models.CharField(
                choices=[('left', 'Left'), ('center', 'Center'), ('right', 'Right')],
                default='left',
                max_length=10,
            ),
        ),
    ]
