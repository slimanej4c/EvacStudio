import base64

from django.core.files.base import ContentFile
from django.db import migrations


def backfill_openai_cleaning_history(apps, schema_editor):
    OpenAIPlanCleaningJob = apps.get_model('evacuation_plans', 'OpenAIPlanCleaningJob')
    PlanCleaningHistory = apps.get_model('evacuation_plans', 'PlanCleaningHistory')

    jobs = OpenAIPlanCleaningJob.objects.filter(status='completed').exclude(after_image_data='')
    for job in jobs.select_related('plan', 'user'):
        if PlanCleaningHistory.objects.filter(openai_job=job).exists():
            continue
        if ';base64,' not in job.after_image_data:
            continue

        _, encoded_image = job.after_image_data.split(';base64,', 1)
        try:
            image_bytes = base64.b64decode(encoded_image, validate=True)
        except ValueError:
            continue

        cleaning_mode = (job.options or {}).get('cleaning_mode', 'sketch_to_plan')
        if cleaning_mode == 'existing_plan_cleanup':
            cleaning_method = 'openai_existing_plan'
            title = "Nettoyage OpenAI d'un plan existant"
        else:
            cleaning_method = 'openai_sketch_to_plan'
            title = 'Croquis vers plan propre avec OpenAI'

        history = PlanCleaningHistory(
            plan=job.plan,
            user=job.user,
            openai_job=job,
            cleaning_method=cleaning_method,
            title=title,
            options=job.options or {},
        )
        history.image_file.save(f'openai_job_{job.id}.png', ContentFile(image_bytes), save=True)


class Migration(migrations.Migration):

    dependencies = [
        ('evacuation_plans', '0005_plancleaninghistory'),
    ]

    operations = [
        migrations.RunPython(backfill_openai_cleaning_history, migrations.RunPython.noop),
    ]
