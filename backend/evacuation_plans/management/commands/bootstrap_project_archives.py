from django.core.management.base import BaseCommand, CommandError

from evacuation_plans.project_archives import bootstrap_missing_project_archives


class Command(BaseCommand):
    help = "Fige les ressources des anciens plans dans leur dossier projet autonome."

    def handle(self, *args, **options):
        result = bootstrap_missing_project_archives()
        self.stdout.write(self.style.SUCCESS(
            f"{result['captured']} projet(s) initialisé(s)."
        ))
        if result['failed']:
            details = ', '.join(
                f"plan {item['plan_id']}: {item['error']}" for item in result['failed']
            )
            raise CommandError(f"Certaines sauvegardes ont échoué : {details}")
