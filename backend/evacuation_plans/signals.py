import logging

from django.contrib.auth.models import User
from django.contrib.auth.signals import user_logged_in, user_logged_out, user_login_failed
from django.db import transaction
from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from .models import (
    EvacuationPlan,
    PlanOverlay,
    UserXaiSettings,
    WorkspaceMembership,
)


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


# ── Traçabilité des actions sensibles ───────────────────────────────────────
#
# Journalise QUI a fait QUOI sur QUELLE ressource, et avec quel résultat.
# Passer par les signaux plutôt que par chaque vue a un avantage décisif : une
# suppression faite depuis l'admin Django est tracée exactement comme une
# suppression faite par l'API, sans code dupliqué et sans oubli possible.
#
# Ce qui n'est JAMAIS écrit ici : mot de passe, jeton, clé API, en-tête
# Authorization, SECRET_KEY, ni le contenu des plans. Seulement des
# identifiants, des noms d'action et des résultats.

audit = logging.getLogger('evacstudio.audit')


@receiver(user_logged_in)
def log_login(sender, request, user, **kwargs):
    audit.info("auth.login.success user_id=%s username=%s", user.id, user.username)


@receiver(user_logged_out)
def log_logout(sender, request, user, **kwargs):
    if user is not None:
        audit.info("auth.logout user_id=%s", user.id)


@receiver(user_login_failed)
def log_login_failure(sender, credentials, **kwargs):
    # `credentials` contient le mot de passe : seul le nom d'utilisateur est
    # extrait, et jamais le dictionnaire entier.
    audit.warning("auth.login.failed username=%s", credentials.get('username', '?'))


@receiver(pre_save, sender=User)
def log_user_privilege_changes(sender, instance, **kwargs):
    """Création de compte, changement de rôle, activation/désactivation."""
    if not instance.pk:
        audit.info("user.created username=%s", instance.username)
        return

    previous = User.objects.filter(pk=instance.pk).only(
        'is_active', 'is_staff', 'is_superuser', 'password'
    ).first()
    if previous is None:
        return

    if previous.is_active != instance.is_active:
        audit.warning(
            "user.%s user_id=%s",
            "activated" if instance.is_active else "deactivated",
            instance.pk,
        )
    if previous.is_staff != instance.is_staff:
        audit.warning(
            "user.role_changed user_id=%s is_staff=%s", instance.pk, instance.is_staff
        )
    if previous.is_superuser != instance.is_superuser:
        audit.warning(
            "user.role_changed user_id=%s is_superuser=%s", instance.pk, instance.is_superuser
        )
    if previous.password != instance.password:
        # L'empreinte elle-même n'est pas journalisée, seulement le fait.
        audit.info("user.password_changed user_id=%s", instance.pk)


@receiver(post_delete, sender=User)
def log_user_deletion(sender, instance, **kwargs):
    audit.warning("user.deleted user_id=%s username=%s", instance.pk, instance.username)


@receiver(post_delete, sender=EvacuationPlan)
def log_plan_deletion(sender, instance, **kwargs):
    # Le titre identifie la ressource ; le contenu du plan n'est pas journalisé.
    audit.warning(
        "plan.deleted plan_id=%s owner_id=%s title=%s",
        instance.pk, instance.user_id, instance.title,
    )


@receiver(post_save, sender=WorkspaceMembership)
def log_membership_granted(sender, instance, created, **kwargs):
    if created:
        audit.warning(
            "workspace.access_granted owner_id=%s member_id=%s role=%s",
            instance.owner_id, instance.member_id, instance.role,
        )


@receiver(post_delete, sender=WorkspaceMembership)
def log_membership_revoked(sender, instance, **kwargs):
    audit.warning(
        "workspace.access_revoked owner_id=%s member_id=%s",
        instance.owner_id, instance.member_id,
    )


@receiver(post_save, sender=UserXaiSettings)
def log_api_key_change(sender, instance, created, **kwargs):
    # Le fait, jamais la valeur.
    audit.warning(
        "settings.api_key_%s user_id=%s",
        "created" if created else "updated",
        instance.user_id,
    )


@receiver(post_delete, sender=UserXaiSettings)
def log_api_key_deletion(sender, instance, **kwargs):
    audit.warning("settings.api_key_deleted user_id=%s", instance.user_id)
