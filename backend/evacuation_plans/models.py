import base64
import hashlib
import hmac
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import User
from django.db import models
from django.utils import timezone


def _derive_xai_settings_keys():
    key_material = hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()
    encryption_key = hashlib.sha256(key_material + b":xai-settings:enc").digest()
    authentication_key = hashlib.sha256(key_material + b":xai-settings:auth").digest()
    return encryption_key, authentication_key


def _build_keystream(key, nonce, length):
    chunks = []
    counter = 0
    while sum(len(chunk) for chunk in chunks) < length:
        counter_bytes = counter.to_bytes(8, "big")
        chunks.append(hashlib.sha256(key + nonce + counter_bytes).digest())
        counter += 1
    return b"".join(chunks)[:length]


def encrypt_xai_api_key(api_key):
    encryption_key, authentication_key = _derive_xai_settings_keys()
    nonce = secrets.token_bytes(16)
    plaintext = api_key.encode("utf-8")
    keystream = _build_keystream(encryption_key, nonce, len(plaintext))
    ciphertext = bytes(byte ^ keystream[index] for index, byte in enumerate(plaintext))
    tag = hmac.new(authentication_key, nonce + ciphertext, hashlib.sha256).digest()
    payload = base64.urlsafe_b64encode(nonce + tag + ciphertext).decode("ascii")
    return f"v1:{payload}"


def decrypt_xai_api_key(encrypted_api_key):
    if not encrypted_api_key.startswith("v1:"):
        raise ValueError("Unsupported encrypted API key format")

    encryption_key, authentication_key = _derive_xai_settings_keys()
    payload = base64.urlsafe_b64decode(encrypted_api_key[3:].encode("ascii"))
    nonce = payload[:16]
    tag = payload[16:48]
    ciphertext = payload[48:]
    expected_tag = hmac.new(authentication_key, nonce + ciphertext, hashlib.sha256).digest()
    if not hmac.compare_digest(tag, expected_tag):
        raise ValueError("Invalid encrypted API key signature")

    keystream = _build_keystream(encryption_key, nonce, len(ciphertext))
    plaintext = bytes(byte ^ keystream[index] for index, byte in enumerate(ciphertext))
    return plaintext.decode("utf-8")


class EvacuationPlan(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='evacuation_plans')
    title = models.CharField(max_length=255)
    building_name = models.CharField(max_length=255)
    floor_name = models.CharField(max_length=255)
    background_file = models.FileField(upload_to='backgrounds/')
    background_type = models.CharField(max_length=50) # 'image' or 'pdf'
    cleaned_background_file = models.FileField(upload_to='backgrounds_cleaned/', null=True, blank=True)
    use_cleaned_background = models.BooleanField(default=False)
    # Placement of the main drawing in the shared editor coordinate system.
    # A zero width/height means "use the natural image size" for older plans.
    main_plan_x = models.FloatField(default=0.0)
    main_plan_y = models.FloatField(default=0.0)
    main_plan_width = models.FloatField(default=0.0)
    main_plan_height = models.FloatField(default=0.0)
    main_plan_locked = models.BooleanField(default=False)
    main_plan_visible = models.BooleanField(default=True)
    main_plan_z_index = models.IntegerField(default=0)
    # Optional explicit association between the main plan and the annotations
    # that must follow it. Older projects keep the historical "carry all"
    # behaviour until the user deliberately groups or ungroups the plan.
    main_plan_group_id = models.CharField(max_length=64, blank=True, default='')
    main_plan_grouping_enabled = models.BooleanField(default=False)
    # Flexible, versioned presentation settings for the approval watermark/BAT.
    # Keeping the visual options together lets the canvas remain the only renderer.
    watermark_config = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.title} - {self.building_name} ({self.floor_name})"

class PlanIcon(models.Model):
    plan = models.ForeignKey(EvacuationPlan, on_delete=models.CASCADE, related_name='icons')
    icon_type = models.CharField(max_length=100) # extincteur, ria, etc.
    x = models.FloatField()
    y = models.FloatField()
    width = models.FloatField()
    height = models.FloatField()
    rotation = models.FloatField(default=0.0)
    label = models.CharField(max_length=255, blank=True, null=True)
    # Leader-line anchor: the equipment's true position when the pictogram had to
    # be moved aside to stay legible. Null means the pictogram sits on the spot.
    anchor_x = models.FloatField(null=True, blank=True)
    anchor_y = models.FloatField(null=True, blank=True)
    # Stroke width of the leader line (defaults to 2). Editable per icon.
    leader_width = models.FloatField(default=2.0)
    # When True, the pictogram artwork is drawn inside a square frame (useful for
    #方形 highlighting or normalising pictograms of different shapes).
    framed = models.BooleanField(default=False)
    flip_x = models.BooleanField(default=False)
    flip_y = models.BooleanField(default=False)
    locked = models.BooleanField(default=False)
    visible = models.BooleanField(default=True)
    z_index = models.IntegerField(default=300)
    group_id = models.CharField(max_length=64, blank=True, default='')
    object_group_id = models.CharField(max_length=64, blank=True, default='')
    # Overrides the pictogram's own colour, as '#rrggbb'. Blank keeps the
    # artwork exactly as drawn — which is what NF X08-070 expects, so this is
    # meant for the plan's own annotations rather than regulated pictograms.
    color = models.CharField(max_length=7, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def is_offset(self):
        return self.anchor_x is not None and self.anchor_y is not None

    def __str__(self):
        return f"{self.icon_type} on {self.plan.title}"


class PlanOverlay(models.Model):
    """A secondary plan image dropped onto the canvas next to the main plan.

    A site is rarely one drawing: a floor plan often has to sit beside a site
    map or a second level. Each overlay keeps its own image and its own place
    on the canvas, in the same coordinate space as the icons and the shapes.
    """

    plan = models.ForeignKey(EvacuationPlan, on_delete=models.CASCADE, related_name='overlays')
    image_file = models.FileField(upload_to='plan_overlays/')
    original_image_file = models.FileField(upload_to='plan_overlays_original/', null=True, blank=True)
    is_original = models.BooleanField(default=True)
    x = models.FloatField(default=0.0)
    y = models.FloatField(default=0.0)
    width = models.FloatField()
    height = models.FloatField()
    rotation = models.FloatField(default=0.0)
    label = models.CharField(max_length=255, blank=True, default='')
    locked = models.BooleanField(default=False)
    visible = models.BooleanField(default=True)
    z_index = models.IntegerField(default=100)
    group_id = models.CharField(max_length=64, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['id']

    def __str__(self):
        return f"Overlay {self.label or self.pk} on {self.plan.title}"


class PlanShape(models.Model):
    """Free-hand annotation drawn on the plan: a line, a rectangle or a circle."""

    SHAPE_LINE = 'line'
    SHAPE_RECT = 'rect'
    SHAPE_CIRCLE = 'circle'
    SHAPE_ZONE = 'zone'
    SHAPE_POLYLINE = 'polyline'
    SHAPE_POLYGON_ZONE = 'polygon_zone'
    SHAPE_FREE_POLYGON_ZONE = 'free_polygon_zone'
    SHAPE_CURVE_POLYGON_ZONE = 'curve_polygon_zone'

    SHAPE_CHOICES = [
        (SHAPE_LINE, 'Line'),
        (SHAPE_RECT, 'Rectangle'),
        (SHAPE_CIRCLE, 'Circle'),
        (SHAPE_ZONE, 'Zone'),
        (SHAPE_POLYLINE, 'Open polyline'),
        (SHAPE_POLYGON_ZONE, 'Polygon zone'),
        (SHAPE_FREE_POLYGON_ZONE, 'Free polygon zone'),
        (SHAPE_CURVE_POLYGON_ZONE, 'Curve polygon zone'),
    ]

    plan = models.ForeignKey(EvacuationPlan, on_delete=models.CASCADE, related_name='shapes')
    shape_type = models.CharField(max_length=32, choices=SHAPE_CHOICES)
    x = models.FloatField()
    y = models.FloatField()
    width = models.FloatField()
    height = models.FloatField()
    rotation = models.FloatField(default=0.0)
    stroke_width = models.FloatField(default=3.0)
    color = models.CharField(max_length=32, default='#000000')
    fill_color = models.CharField(max_length=32, null=True, blank=True, default=None)
    fill_opacity = models.FloatField(null=True, blank=True, default=None)
    tension = models.FloatField(null=True, blank=True, default=None)
    control_points = models.JSONField(null=True, blank=True, default=dict)
    # Absolute plan coordinates for polylines and polygon-zone shapes: [{x, y}, ...]
    points = models.JSONField(null=True, blank=True, default=None)
    locked = models.BooleanField(default=False)
    visible = models.BooleanField(default=True)
    z_index = models.IntegerField(default=200)
    group_id = models.CharField(max_length=64, blank=True, default='')
    object_group_id = models.CharField(max_length=64, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['id']

    def __str__(self):
        return f"{self.shape_type} on {self.plan.title}"


class PlanText(models.Model):
    """Free text label placed on the plan, with full typographic control."""

    plan = models.ForeignKey(EvacuationPlan, on_delete=models.CASCADE, related_name='texts')
    text = models.TextField(blank=True, default='')
    x = models.FloatField()
    y = models.FloatField()
    font_size = models.FloatField(default=24.0)
    font_family = models.CharField(max_length=64, default='Arial')
    color = models.CharField(max_length=16, default='#000000')
    bold = models.BooleanField(default=False)
    italic = models.BooleanField(default=False)
    # Optional colored background behind the text. Null/blank means no background.
    background_color = models.CharField(max_length=16, null=True, blank=True)
    rotation = models.FloatField(default=0.0)
    locked = models.BooleanField(default=False)
    visible = models.BooleanField(default=True)
    z_index = models.IntegerField(default=400)
    group_id = models.CharField(max_length=64, blank=True, default='')
    object_group_id = models.CharField(max_length=64, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['id']

    def __str__(self):
        snippet = (self.text or '')[:20]
        return f'"{snippet}" on {self.plan.title}'


class PlanCleaningHistory(models.Model):
    METHOD_LOCAL = 'local'
    METHOD_LOCAL_WALLS = 'local_walls'
    METHOD_GROK = 'grok'
    METHOD_GROK_AUTOCAD = 'grok_autocad'
    METHOD_GROK_SKETCH = 'grok_sketch'
    METHOD_MANUAL_EDIT = 'manual_edit'

    METHOD_CHOICES = [
        (METHOD_LOCAL, 'Local cleanup'),
        (METHOD_LOCAL_WALLS, 'Local walls cleanup'),
        (METHOD_GROK, 'Grok empty-base cleanup'),
        (METHOD_GROK_AUTOCAD, 'Grok AutoCAD cleanup'),
        (METHOD_GROK_SKETCH, 'Grok hand-drawn sketch conversion'),
        (METHOD_MANUAL_EDIT, 'Manual eraser edit'),
    ]

    plan = models.ForeignKey(EvacuationPlan, on_delete=models.CASCADE, related_name='cleaning_history')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='plan_cleaning_history')
    cleaning_method = models.CharField(max_length=64, choices=METHOD_CHOICES)
    title = models.CharField(max_length=255)
    image_file = models.FileField(upload_to='backgrounds_cleaned/history/')
    options = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.title} for {self.plan.title}"


class UserXaiSettings(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='xai_settings')
    encrypted_api_key = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def set_api_key(self, api_key):
        self.encrypted_api_key = encrypt_xai_api_key(api_key)

    def get_api_key(self):
        return decrypt_xai_api_key(self.encrypted_api_key)

    def __str__(self):
        return f"xAI settings for {self.user.username}"


class SheetTemplateVersion(models.Model):
    """A user's reusable sheet layout, mirrored by the browser local cache.

    Template versions are account preferences rather than plan data: the same
    layout can be reused on every plan and survives application deployments.
    The source timestamps come from the browser copy and let a newer offline
    edit win when local and server copies are merged again.
    """

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sheet_template_versions')
    version_id = models.CharField(max_length=128)
    template_key = models.CharField(max_length=64)
    name = models.CharField(max_length=255)
    blocks = models.JSONField(default=list)
    plan_placement = models.JSONField(default=dict)
    source_created_at = models.DateTimeField()
    source_updated_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['template_key', '-source_updated_at', 'version_id']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'version_id'],
                name='unique_sheet_template_version_per_user',
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.template_key}) for {self.user}"


class GrokCleaningJob(models.Model):
    """Asynchronous Grok cleaning job (analyse + image generation).

    Lifecycle: ``pending`` → ``analyzing`` → ``generating`` → ``completed``
    (or ``failed``). The before/after images are stored as base64 data URLs so
    the UI can show the preview and let the user confirm before applying.
    """

    STATUS_PENDING = 'pending'
    STATUS_ANALYZING = 'analyzing'
    STATUS_GENERATING = 'generating'
    STATUS_COMPLETED = 'completed'
    STATUS_FAILED = 'failed'

    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_ANALYZING, 'Analyzing'),
        (STATUS_GENERATING, 'Generating'),
        (STATUS_COMPLETED, 'Completed'),
        (STATUS_FAILED, 'Failed'),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='grok_cleaning_jobs')
    plan = models.ForeignKey(EvacuationPlan, on_delete=models.CASCADE, related_name='grok_cleaning_jobs')
    target_overlay = models.ForeignKey(
        PlanOverlay,
        on_delete=models.SET_NULL,
        related_name='grok_cleaning_jobs',
        null=True,
        blank=True,
    )
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=STATUS_PENDING)
    preset = models.CharField(max_length=32, default='evacuation')
    target_kind = models.CharField(max_length=16, default='main')
    source_image_data = models.TextField(blank=True)
    error_code = models.CharField(max_length=64, blank=True)
    error_message = models.TextField(blank=True)
    diagnostic = models.CharField(max_length=255, blank=True)
    before_image_data = models.TextField(blank=True)
    after_image_data = models.TextField(blank=True)
    analysis = models.JSONField(default=dict, blank=True)
    generation_prompt = models.TextField(blank=True)
    model_used = models.CharField(max_length=64, blank=True)
    target_background_color = models.CharField(max_length=32, default='#FFFFFF')
    target_wall_color = models.CharField(max_length=16, default='#000000')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def mark_status(self, status_value):
        if self.status == self.STATUS_FAILED:
            return
        if self.status == self.STATUS_COMPLETED and status_value != self.STATUS_COMPLETED:
            return
        self.status = status_value
        self.save(update_fields=['status', 'updated_at'])

    def mark_failed(self, error_code, error_message, diagnostic=''):
        self.status = self.STATUS_FAILED
        self.error_code = error_code or 'GROK_FAILED'
        self.error_message = error_message or 'Erreur pendant le nettoyage avec l\'IA.'
        self.diagnostic = diagnostic or ''
        self.save(update_fields=['status', 'error_code', 'error_message', 'diagnostic', 'updated_at'])

    def __str__(self):
        return f"Grok cleaning job {self.id} for plan {self.plan_id}"


class WorkspaceMembership(models.Model):
    """Gives one account access to another's plan list.

    Access is granted on the whole list rather than plan by plan: that is what
    a shared workspace means here, and it keeps a single place to widen — a
    per-plan grant would have to be re-checked at every endpoint.
    """

    ROLE_VIEWER = 'viewer'
    ROLE_EDITOR = 'editor'
    ROLE_CHOICES = (
        (ROLE_VIEWER, 'Lecture seule'),
        (ROLE_EDITOR, 'Édition'),
    )

    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name='workspace_members')
    member = models.ForeignKey(User, on_delete=models.CASCADE, related_name='workspace_memberships')
    role = models.CharField(max_length=16, choices=ROLE_CHOICES, default=ROLE_VIEWER)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('owner', 'member')

    def __str__(self):
        return f"{self.member} on {self.owner}'s workspace ({self.role})"


def hash_invitation_token(token):
    """Invitations are stored hashed, like passwords.

    The raw token is shown to the inviter once and never persisted, so a dump
    of this table cannot be replayed to join someone's workspace.
    """
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


class WorkspaceInvitation(models.Model):
    """A single-use, expiring invitation to join `owner`'s plan list."""

    VALIDITY_DAYS = 7

    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_invitations')
    email = models.EmailField()
    role = models.CharField(
        max_length=16,
        choices=WorkspaceMembership.ROLE_CHOICES,
        default=WorkspaceMembership.ROLE_VIEWER,
    )
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    accepted_at = models.DateTimeField(null=True, blank=True)
    accepted_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name='accepted_invitations'
    )
    revoked_at = models.DateTimeField(null=True, blank=True)

    @classmethod
    def issue(cls, owner, email, role):
        """Creates an invitation and returns it with its one-off raw token."""
        token = secrets.token_urlsafe(32)
        invitation = cls.objects.create(
            owner=owner,
            email=email,
            role=role,
            token_hash=hash_invitation_token(token),
            expires_at=timezone.now() + timedelta(days=cls.VALIDITY_DAYS),
        )
        return invitation, token

    @property
    def is_pending(self):
        return (
            self.accepted_at is None
            and self.revoked_at is None
            and self.expires_at > timezone.now()
        )

    def __str__(self):
        return f"Invitation to {self.email} for {self.owner}'s workspace"


def accessible_plan_owner_ids(user, editable_only=False):
    """Whose plan lists `user` may reach: their own, plus any shared with them.

    `editable_only` narrows it to the lists they may write to, so read access
    and write access are decided from one place instead of being re-derived —
    and forgotten — at each endpoint.
    """
    memberships = WorkspaceMembership.objects.filter(member=user)
    if editable_only:
        memberships = memberships.filter(role=WorkspaceMembership.ROLE_EDITOR)
    return {user.id, *memberships.values_list('owner_id', flat=True)}


def user_can_edit_plan(user, plan):
    return plan.user_id in accessible_plan_owner_ids(user, editable_only=True)
