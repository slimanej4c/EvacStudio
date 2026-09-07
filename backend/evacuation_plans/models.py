import base64
import hashlib
import hmac
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import User
from django.db import models
from django.core.exceptions import ValidationError
from django.utils import timezone
from .media_access import media_path_aliases
from .pictogram_catalogs import is_registered_catalogue_svg_path
from .plan_compliance import DOCUMENT_TYPE_CHOICES, PAPER_FORMAT_CHOICES


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


class PlanFolder(models.Model):
    """A user-owned folder used to organise plans from the same site."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='plan_folders')
    name = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name', 'id']
        constraints = [
            models.UniqueConstraint(fields=['user', 'name'], name='unique_plan_folder_name_per_user'),
        ]

    def __str__(self):
        return f"{self.name} ({self.user})"


class EvacuationPlan(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='evacuation_plans')
    project_uuid = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    folder = models.ForeignKey(
        PlanFolder,
        on_delete=models.SET_NULL,
        related_name='plans',
        null=True,
        blank=True,
    )
    title = models.CharField(max_length=255)
    # Identification and revision metadata completed in the studio when a
    # printed sheet template is associated with the plan. Defaults keep the
    # original quick-import workflow and historical projects readable.
    establishment_name = models.CharField(max_length=255, blank=True, default='')
    building_name = models.CharField(max_length=255)
    floor_name = models.CharField(max_length=255)
    plan_number = models.CharField(max_length=100, blank=True, default='')
    design_date = models.DateField(null=True, blank=True)
    designer = models.CharField(max_length=255, blank=True, default='')
    revision_index = models.CharField(max_length=50, blank=True, default='A')
    last_verification_date = models.DateField(null=True, blank=True)
    next_verification_date = models.DateField(null=True, blank=True)
    # Per-plan display choices. A missing key means visible, which keeps older
    # plans and newly added information fields forward-compatible.
    plan_information_visibility = models.JSONField(default=dict, blank=True)
    # Geometry of the movable information card, keyed by sheet template. This
    # stays on the plan because it is client-specific and must never be written
    # into a reusable template definition.
    plan_information_layout = models.JSONField(default=dict, blank=True)
    # Per-plan legend geometry and visibility, keyed by sheet template. The
    # reusable template keeps its original legend position.
    plan_legend_layout = models.JSONField(default=dict, blank=True)
    # Icon types hidden from this plan's generated legend. The pictograms stay
    # untouched on the drawing and can be restored to the legend at any time.
    legend_hidden_icon_types = models.JSONField(default=list, blank=True)
    # Exact, plan-owned copy of the last sheet composition. The reusable
    # template may later be renamed or removed without changing this project.
    template_snapshot = models.JSONField(default=dict, blank=True)
    # Plan-specific inset shown on the printed sheet. Its editable blocks stay
    # separate from reusable template definitions, while the optional raster or
    # sanitised SVG background is stored as an independently protected file.
    plan_situation_config = models.JSONField(default=dict, blank=True)
    plan_situation_background_file = models.FileField(
        upload_to='situation_backgrounds/',
        null=True,
        blank=True,
    )
    # Explicit export metadata used by the studio now and by the automatic
    # compliance auditor later. It must not be inferred from raster pixels.
    document_type = models.CharField(
        max_length=32,
        choices=DOCUMENT_TYPE_CHOICES,
        blank=True,
        default='',
    )
    export_paper_format = models.CharField(
        max_length=2,
        choices=PAPER_FORMAT_CHOICES,
        default='a3',
    )
    print_scale_denominator = models.PositiveIntegerField(default=250)
    # Calculated from a two-point calibration on the main plan. This is kept
    # separate from the declared scale so an audit can distinguish intent from
    # an actual geometric measurement on the final sheet.
    measured_scale_denominator = models.FloatField(null=True, blank=True)
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
    # Per-plan crop of the source drawing inside the selected template window.
    # This must not modify the reusable/default template itself.
    sheet_plan_placement = models.JSONField(default=dict, blank=True)
    # The sheet currently displayed for this specific plan. Template
    # definitions remain reusable account data; the separate ``last_*`` fields
    # below keep the latest real template even while the studio is saved in
    # bare-plan mode.
    active_sheet_template_key = models.CharField(
        max_length=64,
        default='none',
        verbose_name="Template actif",
    )
    active_sheet_template_version_id = models.CharField(
        max_length=160,
        blank=True,
        default='',
        verbose_name="Version du template actif",
    )
    active_sheet_template_name = models.CharField(
        max_length=255,
        default='Plan seul',
        verbose_name="Nom du template actif",
    )
    last_sheet_template_key = models.CharField(
        max_length=64,
        default='none',
        verbose_name="Dernier template choisi",
    )
    last_sheet_template_version_id = models.CharField(
        max_length=160,
        blank=True,
        default='',
        verbose_name="Version du dernier template choisi",
    )
    last_sheet_template_name = models.CharField(
        max_length=255,
        blank=True,
        default='',
        verbose_name="Nom du dernier template choisi",
    )
    archived_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.title} - {self.building_name} ({self.floor_name})"


def project_asset_upload_to(instance, filename):
    extension = (str(filename or '').rsplit('.', 1)[-1] if '.' in str(filename or '') else 'bin')
    extension = ''.join(character for character in extension.lower() if character.isalnum())[:10] or 'bin'
    return f"projects/{instance.plan.project_uuid}/assets/{instance.sha256}.{extension}"


class PlanProjectAsset(models.Model):
    """Immutable, content-addressed bytes owned by one autonomous project."""

    plan = models.ForeignKey(EvacuationPlan, on_delete=models.CASCADE, related_name='project_assets')
    sha256 = models.CharField(max_length=64)
    file = models.FileField(upload_to=project_asset_upload_to, max_length=500)
    original_name = models.CharField(max_length=255)
    media_type = models.CharField(max_length=100, default='application/octet-stream')
    size = models.PositiveBigIntegerField(default=0)
    kind = models.CharField(max_length=32, default='other')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['sha256']
        constraints = [
            models.UniqueConstraint(fields=['plan', 'sha256'], name='unique_project_asset_hash'),
        ]

    def save(self, *args, **kwargs):
        if self.pk:
            previous = type(self).objects.filter(pk=self.pk).values(
                'plan_id', 'sha256', 'file', 'original_name', 'size', 'media_type', 'kind'
            ).first()
            current = {
                'plan_id': self.plan_id,
                'sha256': self.sha256,
                'file': self.file.name,
                'original_name': self.original_name,
                'size': self.size,
                'media_type': self.media_type,
                'kind': self.kind,
            }
            if previous and previous != current:
                raise ValidationError("Une ressource de projet figée ne peut pas être modifiée.")
        return super().save(*args, **kwargs)


class PlanProjectResource(models.Model):
    """Current logical binding (pictogram, background, logo…) to immutable bytes."""

    plan = models.ForeignKey(EvacuationPlan, on_delete=models.CASCADE, related_name='project_resources')
    asset = models.ForeignKey(PlanProjectAsset, on_delete=models.PROTECT, related_name='resource_bindings')
    role = models.CharField(max_length=40)
    key = models.CharField(max_length=255)
    metadata = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['role', 'key']
        constraints = [
            models.UniqueConstraint(fields=['plan', 'role', 'key'], name='unique_project_resource_key'),
        ]


class PlanProjectRevision(models.Model):
    """Append-only manifest describing one complete recoverable plan state."""

    REASON_SAVE = 'save'
    REASON_IMPORT = 'import'
    REASON_DUPLICATE = 'duplicate'
    REASON_RESTORE = 'restore'
    REASON_ARCHIVE = 'archive'
    REASON_BOOTSTRAP = 'bootstrap'

    plan = models.ForeignKey(EvacuationPlan, on_delete=models.CASCADE, related_name='project_revisions')
    revision_number = models.PositiveIntegerField()
    schema_version = models.PositiveIntegerField(default=1)
    reason = models.CharField(max_length=24, default=REASON_SAVE)
    manifest = models.JSONField()
    manifest_sha256 = models.CharField(max_length=64)
    previous_manifest_sha256 = models.CharField(max_length=64, blank=True, default='')
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name='created_plan_project_revisions',
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-revision_number']
        constraints = [
            models.UniqueConstraint(fields=['plan', 'revision_number'], name='unique_project_revision_number'),
        ]

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValidationError("Une révision de projet est immuable.")
        return super().save(*args, **kwargs)

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
    # A pictogram may point to several real positions. ``anchor_x/y`` are kept
    # for backwards compatibility with saved plans predating this collection.
    leader_points = models.JSONField(default=list, blank=True)
    # Stroke width of the leader line (defaults to 2). Editable per icon.
    leader_width = models.FloatField(default=2.0)
    # Radius / size of the anchor dot at the start of the leader line (defaults to 1.0 px). Editable per icon.
    leader_dot_size = models.FloatField(default=1.0)
    # Manual color override for the leader line, as '#rrggbb'. Blank defaults
    # to the icon's own color (either explicit color or regulatory/definition color).
    leader_color = models.CharField(max_length=7, blank=True, default='')
    # When True, the pictogram artwork is drawn inside a square frame (useful for
    #方形 highlighting or normalising pictograms of different shapes).
    framed = models.BooleanField(default=False)
    flip_x = models.BooleanField(default=False)
    flip_y = models.BooleanField(default=False)
    # Pictograms keep their original proportions unless the editor explicitly
    # unlocks width/height deformation for this instance.
    lock_aspect_ratio = models.BooleanField(default=True)
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
        return bool(self.leader_points) or (
            self.anchor_x is not None and self.anchor_y is not None
        )

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
    # Point-by-point paths may deliberately stay open (notably curve zones).
    closed = models.BooleanField(default=True)
    # Segment start indexes intentionally kept straight while the rest is curved.
    straight_segments = models.JSONField(blank=True, default=list)
    locked = models.BooleanField(default=False)
    visible = models.BooleanField(default=True)
    z_index = models.IntegerField(default=200)
    group_id = models.CharField(max_length=64, blank=True, default='')
    object_group_id = models.CharField(max_length=64, blank=True, default='')
    # A calibration is stored as a hidden, locked line so its endpoints follow
    # every move/resize of the main plan exactly like the other plan geometry.
    is_scale_calibration = models.BooleanField(default=False)
    calibration_real_distance_m = models.FloatField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['id']
        constraints = [
            models.UniqueConstraint(
                fields=['plan'],
                condition=models.Q(is_scale_calibration=True),
                name='one_scale_calibration_per_plan',
            ),
        ]

    def __str__(self):
        return f"{self.shape_type} on {self.plan.title}"


class PlanText(models.Model):
    """Free text label placed on the plan, with full typographic control."""

    ALIGN_CHOICES = (
        ('left', 'Left'),
        ('center', 'Center'),
        ('right', 'Right'),
    )

    plan = models.ForeignKey(EvacuationPlan, on_delete=models.CASCADE, related_name='texts')
    text = models.TextField(blank=True, default='')
    x = models.FloatField()
    y = models.FloatField()
    font_size = models.FloatField(default=24.0)
    font_family = models.CharField(max_length=64, default='Arial')
    align = models.CharField(max_length=10, choices=ALIGN_CHOICES, default='left')
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


class SheetTemplateAsset(models.Model):
    """Raster page used as the locked background of a personal template."""

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='sheet_template_assets',
    )
    asset_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    name = models.CharField(max_length=255)
    image_file = models.FileField(upload_to='sheet_template_assets/')
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.name} for {self.user}"


class DefaultTemplateEditPermission(models.Model):
    """Explicit admin grant for changing the studio's built-in sheet layouts.

    Personal templates never need this grant.  Keeping the exception in its
    own row makes the secure default unambiguous: no row means no permission.
    """

    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name='default_template_edit_permission',
        verbose_name="Utilisateur",
    )
    can_edit_default_templates = models.BooleanField(
        default=False,
        verbose_name="Peut modifier les templates par défaut",
    )
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Dernière modification")

    class Meta:
        verbose_name = "autorisation de modification des templates par défaut"
        verbose_name_plural = "autorisations de modification des templates par défaut"

    def __str__(self):
        state = "autorisée" if self.can_edit_default_templates else "bloquée"
        return f"Modification des templates par défaut {state} pour {self.user}"


def user_can_edit_default_templates(user):
    """Return the server-authoritative built-in-template editing permission."""

    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    try:
        return bool(user.default_template_edit_permission.can_edit_default_templates)
    except DefaultTemplateEditPermission.DoesNotExist:
        return False


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
    """Return the plan owners that ``user`` is allowed to reach.

    A user always owns their own workspace. Access to somebody else's workspace
    exists only through an accepted invitation, represented by a
    :class:`WorkspaceMembership`. Pending and revoked invitations therefore
    grant nothing, and deleting a membership removes access immediately.
    """
    if not user or not user.is_authenticated or not user.is_active:
        return set()

    memberships = WorkspaceMembership.objects.filter(member=user)
    if editable_only:
        memberships = memberships.filter(role=WorkspaceMembership.ROLE_EDITOR)
    return {user.id, *memberships.values_list('owner_id', flat=True)}


def accessible_library_owner_ids(user):
    """Return users whose reusable library is visible in this workspace.

    Plan access is directional: accepting an invitation lets the member see the
    owner's plans. Reusable editor resources are collaborative, so templates,
    template assets and imported SVGs are visible both ways between connected
    workspace accounts.
    """
    owner_ids = accessible_plan_owner_ids(user)
    if not owner_ids:
        return set()

    invited_member_ids = WorkspaceMembership.objects.filter(
        owner=user,
        member__is_active=True,
    ).values_list('member_id', flat=True)
    return {*owner_ids, *invited_member_ids}


def restrict_plans_to(queryset, user, editable_only=False):
    """Applies :func:`accessible_plan_owner_ids` to a plan queryset."""
    owner_ids = accessible_plan_owner_ids(user, editable_only=editable_only)
    return queryset.filter(user_id__in=owner_ids)


def user_can_edit_plan(user, plan):
    owner_ids = accessible_plan_owner_ids(user, editable_only=True)
    return plan.user_id in owner_ids


def user_can_access_media_path(user, relative_path):
    """Check ownership of an unsigned file request from ``MEDIA_ROOT``.

    The database is the authority: merely knowing or guessing a stored filename
    never grants access. Files attached to a plan follow that plan's owner and
    personal template assets follow their own owner. Browser image elements
    are authenticated separately by the HttpOnly media-session cookie.
    """
    owner_ids = accessible_plan_owner_ids(user)
    library_owner_ids = accessible_library_owner_ids(user)
    if not owner_ids or not relative_path:
        return False

    # The official pictogram library is application-wide. User-imported
    # pictograms live under user_pictograms/<owner_id>/ and follow workspace
    # sharing, like plans and template assets.
    top_level_directory = relative_path.split('/', 1)[0]
    if top_level_directory == 'plan_picto':
        return True
    if is_registered_catalogue_svg_path(relative_path):
        return True
    if relative_path.startswith('user_pictograms/'):
        parts = relative_path.split('/', 2)
        if len(parts) == 3:
            try:
                pictogram_owner_id = int(parts[1])
            except (TypeError, ValueError):
                pictogram_owner_id = None
            if pictogram_owner_id in library_owner_ids:
                return True
    path_aliases = media_path_aliases(relative_path)
    if not path_aliases:
        return False

    plan_file = EvacuationPlan.objects.filter(user_id__in=owner_ids).filter(
        models.Q(background_file__in=path_aliases)
        | models.Q(cleaned_background_file__in=path_aliases)
        | models.Q(plan_situation_background_file__in=path_aliases)
    ).exists()
    if plan_file:
        return True

    overlay_file = PlanOverlay.objects.filter(plan__user_id__in=owner_ids).filter(
        models.Q(image_file__in=path_aliases)
        | models.Q(original_image_file__in=path_aliases)
    ).exists()
    if overlay_file:
        return True

    if PlanCleaningHistory.objects.filter(
        plan__user_id__in=owner_ids,
        image_file__in=path_aliases,
    ).exists():
        return True

    if PlanProjectAsset.objects.filter(
        plan__user_id__in=owner_ids,
        file__in=path_aliases,
    ).exists():
        return True

    return SheetTemplateAsset.objects.filter(
        user_id__in=library_owner_ids,
        image_file__in=path_aliases,
    ).exists()
