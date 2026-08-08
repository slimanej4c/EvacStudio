import base64
import hashlib
import hmac
import secrets

from django.conf import settings
from django.contrib.auth.models import User
from django.db import models


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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def is_offset(self):
        return self.anchor_x is not None and self.anchor_y is not None

    def __str__(self):
        return f"{self.icon_type} on {self.plan.title}"


class PlanShape(models.Model):
    """Free-hand annotation drawn on the plan: a line, a rectangle or a circle."""

    SHAPE_LINE = 'line'
    SHAPE_RECT = 'rect'
    SHAPE_CIRCLE = 'circle'
    SHAPE_ZONE = 'zone'
    SHAPE_POLYGON_ZONE = 'polygon_zone'
    SHAPE_FREE_POLYGON_ZONE = 'free_polygon_zone'
    SHAPE_CURVE_POLYGON_ZONE = 'curve_polygon_zone'

    SHAPE_CHOICES = [
        (SHAPE_LINE, 'Line'),
        (SHAPE_RECT, 'Rectangle'),
        (SHAPE_CIRCLE, 'Circle'),
        (SHAPE_ZONE, 'Zone'),
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
    # Absolute plan coordinates for polygon_zone shapes: [{x, y}, ...]
    points = models.JSONField(null=True, blank=True, default=None)
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
    METHOD_MANUAL_EDIT = 'manual_edit'

    METHOD_CHOICES = [
        (METHOD_LOCAL, 'Local cleanup'),
        (METHOD_LOCAL_WALLS, 'Local walls cleanup'),
        (METHOD_GROK, 'Grok empty-base cleanup'),
        (METHOD_GROK_AUTOCAD, 'Grok AutoCAD cleanup'),
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
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=STATUS_PENDING)
    preset = models.CharField(max_length=32, default='evacuation')
    error_code = models.CharField(max_length=64, blank=True)
    error_message = models.TextField(blank=True)
    diagnostic = models.CharField(max_length=255, blank=True)
    before_image_data = models.TextField(blank=True)
    after_image_data = models.TextField(blank=True)
    analysis = models.JSONField(default=dict, blank=True)
    generation_prompt = models.TextField(blank=True)
    model_used = models.CharField(max_length=64, blank=True)
    target_background_color = models.CharField(max_length=32, default='#FFFFFF')
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
