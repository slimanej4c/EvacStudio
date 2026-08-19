from django import forms
from django.contrib import admin
from django.utils import timezone

from .models import (
    EvacuationPlan,
    PlanIcon,
    SheetTemplateVersion,
    WorkspaceInvitation,
    WorkspaceMembership,
)


class WorkspaceMembershipForm(forms.ModelForm):
    class Meta:
        model = WorkspaceMembership
        fields = ['owner', 'member', 'role']

    def clean(self):
        cleaned = super().clean()
        owner = cleaned.get('owner')
        member = cleaned.get('member')
        if owner and member and owner == member:
            # Harmless but confusing: the owner already sees their own plans,
            # and the row would show up as an access they cannot revoke.
            raise forms.ValidationError(
                "Le propriétaire et le collaborateur ne peuvent pas être la même personne."
            )
        return cleaned


@admin.register(WorkspaceMembership)
class WorkspaceMembershipAdmin(admin.ModelAdmin):
    """Grants and revokes access to a plan list.

    Adding a row here gives `member` access to every plan owned by `owner`,
    immediately — it is the same access an accepted invitation produces, so
    there is no need to send a code when the administrator can grant it
    directly. Deleting the row takes the access back just as immediately.
    """

    form = WorkspaceMembershipForm
    list_display = ('owner', 'member', 'role', 'created_at')
    list_filter = ('role', 'created_at')
    search_fields = ('owner__username', 'owner__email', 'member__username', 'member__email')
    autocomplete_fields = ('owner', 'member')
    ordering = ('-created_at',)


@admin.register(WorkspaceInvitation)
class WorkspaceInvitationAdmin(admin.ModelAdmin):
    """Invitations sent from the application.

    Read-only on purpose: an invitation is only usable through its raw token,
    which is never stored — only its hash is. Editing a row here could not
    produce a working invitation, so the only useful action is to revoke one.
    """

    list_display = ('email', 'owner', 'role', 'state', 'created_at', 'expires_at')
    list_filter = ('role', 'created_at')
    search_fields = ('email', 'owner__username')
    ordering = ('-created_at',)
    actions = ['revoke_selected']

    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in self.model._meta.fields]

    def has_add_permission(self, request):
        return False

    @admin.display(description="État")
    def state(self, invitation):
        if invitation.accepted_at:
            return "Acceptée"
        if invitation.revoked_at:
            return "Révoquée"
        if not invitation.is_pending:
            return "Expirée"
        return "En attente"

    @admin.action(description="Révoquer les invitations sélectionnées")
    def revoke_selected(self, request, queryset):
        revoked = queryset.filter(accepted_at__isnull=True, revoked_at__isnull=True).update(
            revoked_at=timezone.now()
        )
        self.message_user(request, f"{revoked} invitation(s) révoquée(s).")


class PlanIconInline(admin.TabularInline):
    model = PlanIcon
    extra = 0
    fields = ('icon_type', 'x', 'y', 'width', 'height', 'color', 'locked')
    show_change_link = False


@admin.register(EvacuationPlan)
class EvacuationPlanAdmin(admin.ModelAdmin):
    """Every plan, with its owner — the field that decides who can reach it."""

    list_display = ('title', 'user', 'building_name', 'floor_name', 'created_at')
    list_filter = ('background_type', 'created_at')
    search_fields = ('title', 'building_name', 'floor_name', 'user__username')
    autocomplete_fields = ('user',)
    ordering = ('-created_at',)
    inlines = [PlanIconInline]


@admin.register(SheetTemplateVersion)
class SheetTemplateVersionAdmin(admin.ModelAdmin):
    list_display = ('name', 'user', 'template_key', 'source_updated_at')
    list_filter = ('template_key', 'source_updated_at')
    search_fields = ('name', 'version_id', 'user__username', 'user__email')
    autocomplete_fields = ('user',)
    ordering = ('-source_updated_at',)
