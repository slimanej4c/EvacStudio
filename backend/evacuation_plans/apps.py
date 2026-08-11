from django.apps import AppConfig


class EvacuationPlansConfig(AppConfig):
    name = 'evacuation_plans'

    def ready(self):
        # Registers storage cleanup for secondary plans deleted directly or by
        # cascading deletion of their parent project.
        from . import signals  # noqa: F401
