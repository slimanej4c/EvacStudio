from django.db import transaction
from django.db.models.signals import post_delete
from django.dispatch import receiver

from .models import PlanOverlay


@receiver(post_delete, sender=PlanOverlay)
def delete_unused_overlay_file_after_commit(sender, instance, **kwargs):
    """Remove an overlay file only after its database row is safely gone.

    The final reference check is important for the legacy sync endpoint, which
    may briefly reuse the same stored filename in a replacement row.
    """
    if not instance.image_file or not instance.image_file.name:
        return

    name = instance.image_file.name
    storage = instance.image_file.storage

    def cleanup():
        if PlanOverlay.objects.filter(image_file=name).exists():
            return
        if storage.exists(name):
            storage.delete(name)

    transaction.on_commit(cleanup)
