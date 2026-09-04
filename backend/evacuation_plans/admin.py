from django import forms
from django.contrib import admin
from django.utils import timezone

from .models import (
    EvacuationPlan,
    DefaultTemplateEditPermission,
    PlanFolder,
    PlanIcon,
    PlanProjectAsset,
    PlanProjectResource,
    PlanProjectRevision,
    SheetTemplateAsset,
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
    fields = ('icon_type', 'x', 'y', 'width', 'height', 'lock_aspect_ratio', 'color', 'locked')
    show_change_link = False


@admin.register(PlanFolder)
class PlanFolderAdmin(admin.ModelAdmin):
    list_display = ('name', 'user', 'created_at', 'updated_at')
    search_fields = ('name', 'user__username', 'user__email')
    autocomplete_fields = ('user',)
    ordering = ('user__username', 'name')


@admin.register(EvacuationPlan)
class EvacuationPlanAdmin(admin.ModelAdmin):
    """Every plan, with its owner — the field that decides who can reach it."""

    list_display = (
        'title', 'plan_number', 'user', 'establishment_name', 'building_name',
        'floor_name', 'revision_index', 'document_type', 'export_paper_format',
        'print_scale_denominator', 'measured_scale_denominator',
        'active_sheet_template_name', 'created_at',
        'archived_at',
    )
    list_filter = (
        'document_type', 'export_paper_format', 'background_type',
        'active_sheet_template_key', 'created_at',
        'archived_at',
    )
    search_fields = (
        'title', 'plan_number', 'establishment_name', 'building_name', 'floor_name',
        'designer', 'active_sheet_template_name', 'user__username',
    )
    autocomplete_fields = ('user', 'folder')
    ordering = ('-created_at',)
    inlines = [PlanIconInline]

    def has_delete_permission(self, request, obj=None):
        # Projects are archived/restored by the application; the admin must not
        # bypass the immutable revision history with an accidental hard delete.
        return False


class ImmutableProjectAdmin(admin.ModelAdmin):
    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in self.model._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return bool(obj is None and super().has_change_permission(request, obj))

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(PlanProjectAsset)
class PlanProjectAssetAdmin(ImmutableProjectAdmin):
    list_display = ('sha256', 'plan', 'kind', 'size', 'created_at')
    list_filter = ('kind', 'created_at')
    search_fields = ('sha256', 'original_name', 'plan__title')


@admin.register(PlanProjectResource)
class PlanProjectResourceAdmin(ImmutableProjectAdmin):
    list_display = ('plan', 'role', 'key', 'asset', 'updated_at')
    list_filter = ('role', 'updated_at')
    search_fields = ('plan__title', 'key', 'asset__sha256')


@admin.register(PlanProjectRevision)
class PlanProjectRevisionAdmin(ImmutableProjectAdmin):
    list_display = ('plan', 'revision_number', 'reason', 'manifest_sha256', 'created_at')
    list_filter = ('reason', 'schema_version', 'created_at')
    search_fields = ('plan__title', 'manifest_sha256')


@admin.register(SheetTemplateVersion)
class SheetTemplateVersionAdmin(admin.ModelAdmin):
    list_display = ('name', 'user', 'template_key', 'source_updated_at')
    list_filter = ('template_key', 'source_updated_at')
    search_fields = ('name', 'version_id', 'user__username', 'user__email')
    autocomplete_fields = ('user',)
    ordering = ('-source_updated_at',)


@admin.register(SheetTemplateAsset)
class SheetTemplateAssetAdmin(admin.ModelAdmin):
    list_display = ('name', 'user', 'width', 'height', 'created_at')
    search_fields = ('name', 'user__username', 'user__email')
    autocomplete_fields = ('user',)
    ordering = ('-created_at',)


@admin.register(DefaultTemplateEditPermission)
class DefaultTemplateEditPermissionAdmin(admin.ModelAdmin):
    """Lets an administrator grant the exceptional built-in edit capability."""

    list_display = ('user', 'can_edit_default_templates', 'updated_at')
    list_editable = ('can_edit_default_templates',)
    list_filter = ('can_edit_default_templates', 'updated_at')
    search_fields = ('user__username', 'user__email')
    autocomplete_fields = ('user',)
    ordering = ('user__username',)
