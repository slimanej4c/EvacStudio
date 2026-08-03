import base64
import hashlib
import hmac
import secrets

from django.conf import settings
from django.contrib.auth.models import User
from django.db import models


def _derive_openai_settings_keys():
    key_material = hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()
    encryption_key = hashlib.sha256(key_material + b":openai-settings:enc").digest()
    authentication_key = hashlib.sha256(key_material + b":openai-settings:auth").digest()
    return encryption_key, authentication_key


def _build_keystream(key, nonce, length):
    chunks = []
    counter = 0
    while sum(len(chunk) for chunk in chunks) < length:
        counter_bytes = counter.to_bytes(8, "big")
        chunks.append(hashlib.sha256(key + nonce + counter_bytes).digest())
        counter += 1
    return b"".join(chunks)[:length]


def encrypt_openai_api_key(api_key):
    encryption_key, authentication_key = _derive_openai_settings_keys()
    nonce = secrets.token_bytes(16)
    plaintext = api_key.encode("utf-8")
    keystream = _build_keystream(encryption_key, nonce, len(plaintext))
    ciphertext = bytes(byte ^ keystream[index] for index, byte in enumerate(plaintext))
    tag = hmac.new(authentication_key, nonce + ciphertext, hashlib.sha256).digest()
    payload = base64.urlsafe_b64encode(nonce + tag + ciphertext).decode("ascii")
    return f"v1:{payload}"


def decrypt_openai_api_key(encrypted_api_key):
    if not encrypted_api_key.startswith("v1:"):
        raise ValueError("Unsupported encrypted API key format")

    encryption_key, authentication_key = _derive_openai_settings_keys()
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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.icon_type} on {self.plan.title}"


class PlanCleaningHistory(models.Model):
    METHOD_LOCAL = 'local'
    METHOD_LOCAL_WALLS = 'local_walls'
    METHOD_OPENAI_SKETCH = 'openai_sketch_to_plan'
    METHOD_OPENAI_EXISTING = 'openai_existing_plan'
    METHOD_OPENAI_APPLIED = 'openai_applied'
    METHOD_MANUAL_EDIT = 'manual_edit'

    METHOD_CHOICES = [
        (METHOD_LOCAL, 'Local cleanup'),
        (METHOD_LOCAL_WALLS, 'Local walls cleanup'),
        (METHOD_OPENAI_SKETCH, 'OpenAI sketch to plan'),
        (METHOD_OPENAI_EXISTING, 'OpenAI existing plan cleanup'),
        (METHOD_OPENAI_APPLIED, 'OpenAI applied result'),
        (METHOD_MANUAL_EDIT, 'Manual eraser edit'),
    ]

    plan = models.ForeignKey(EvacuationPlan, on_delete=models.CASCADE, related_name='cleaning_history')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='plan_cleaning_history')
    openai_job = models.ForeignKey(
        'OpenAIPlanCleaningJob',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='history_entries',
    )
    cleaning_method = models.CharField(max_length=64, choices=METHOD_CHOICES)
    title = models.CharField(max_length=255)
    image_file = models.FileField(upload_to='backgrounds_cleaned/history/')
    options = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.title} for {self.plan.title}"


class UserOpenAISettings(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='openai_settings')
    encrypted_api_key = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def set_api_key(self, api_key):
        self.encrypted_api_key = encrypt_openai_api_key(api_key)

    def get_api_key(self):
        return decrypt_openai_api_key(self.encrypted_api_key)

    def __str__(self):
        return f"OpenAI settings for {self.user.username}"


class OpenAIPlanCleaningJob(models.Model):
    STATUS_PENDING = 'pending'
    STATUS_LOADING_SOURCE = 'loading_source'
    STATUS_ANALYZING = 'analyzing'
    STATUS_PROMPT_READY = 'prompt_ready'
    STATUS_GENERATING = 'generating'
    STATUS_SAVING_RESULT = 'saving_result'
    STATUS_COMPLETED = 'completed'
    STATUS_FAILED = 'failed'

    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_LOADING_SOURCE, 'Loading source'),
        (STATUS_ANALYZING, 'Analyzing'),
        (STATUS_PROMPT_READY, 'Prompt ready'),
        (STATUS_GENERATING, 'Generating'),
        (STATUS_SAVING_RESULT, 'Saving result'),
        (STATUS_COMPLETED, 'Completed'),
        (STATUS_FAILED, 'Failed'),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='openai_cleaning_jobs')
    plan = models.ForeignKey(EvacuationPlan, on_delete=models.CASCADE, related_name='openai_cleaning_jobs')
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=STATUS_PENDING)
    error_code = models.CharField(max_length=64, blank=True)
    error_message = models.TextField(blank=True)
    diagnostic = models.CharField(max_length=255, blank=True)
    before_image_data = models.TextField(blank=True)
    after_image_data = models.TextField(blank=True)
    analysis = models.JSONField(default=dict, blank=True)
    generation_prompt = models.TextField(blank=True)
    models_used = models.JSONField(default=dict, blank=True)
    warnings = models.JSONField(default=list, blank=True)
    options = models.JSONField(default=dict, blank=True)
    estimated_cost_min = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    estimated_cost_max = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    pricing_currency = models.CharField(max_length=8, default='USD')
    quality = models.CharField(max_length=16, default='medium')
    generation_attempts = models.PositiveIntegerField(default=1)
    verification_enabled = models.BooleanField(default=False)
    actual_cost = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    actual_cost_available = models.BooleanField(default=False)
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
        self.error_code = error_code or 'OPENAI_PIPELINE_FAILED'
        self.error_message = error_message or 'Erreur pendant le nettoyage OpenAI.'
        self.diagnostic = diagnostic or ''
        self.save(update_fields=['status', 'error_code', 'error_message', 'diagnostic', 'updated_at'])

    def __str__(self):
        return f"OpenAI cleaning job {self.id} for plan {self.plan_id}"
