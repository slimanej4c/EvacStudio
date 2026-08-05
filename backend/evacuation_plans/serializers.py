from rest_framework import serializers
from django.contrib.auth.models import User
from .models import EvacuationPlan, PlanCleaningHistory, PlanIcon, PlanShape, PlanText, UserOpenAISettings

MAX_OPENAI_IMAGE_DATA_LENGTH = 20 * 1024 * 1024

class UserRegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)
    first_name = serializers.CharField(required=False, allow_blank=True)
    last_name = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = User
        fields = ['username', 'email', 'first_name', 'last_name', 'password']

    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data.get('email', ''),
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
            password=validated_data['password']
        )
        return user

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name']

class PlanIconSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlanIcon
        fields = ['id', 'plan', 'icon_type', 'x', 'y', 'width', 'height', 'rotation', 'label',
                  'anchor_x', 'anchor_y', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

class PlanShapeSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlanShape
        fields = ['id', 'plan', 'shape_type', 'x', 'y', 'width', 'height', 'rotation',
                  'stroke_width', 'color', 'created_at', 'updated_at']
        read_only_fields = ['id', 'plan', 'created_at', 'updated_at']


class PlanTextSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlanText
        fields = ['id', 'plan', 'text', 'x', 'y', 'font_size', 'font_family', 'color',
                  'bold', 'italic', 'background_color', 'rotation', 'created_at', 'updated_at']
        read_only_fields = ['id', 'plan', 'created_at', 'updated_at']


class EvacuationPlanSerializer(serializers.ModelSerializer):
    icons = PlanIconSerializer(many=True, read_only=True)
    shapes = PlanShapeSerializer(many=True, read_only=True)
    texts = PlanTextSerializer(many=True, read_only=True)
    user = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = EvacuationPlan
        fields = ['id', 'user', 'title', 'building_name', 'floor_name', 'background_file', 'background_type', 'cleaned_background_file', 'use_cleaned_background', 'icons', 'shapes', 'texts', 'created_at', 'updated_at']
        read_only_fields = ['id', 'user', 'cleaned_background_file', 'created_at', 'updated_at']


class PlanCleaningHistorySerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = PlanCleaningHistory
        fields = ['id', 'plan', 'cleaning_method', 'title', 'image_url', 'options', 'created_at']
        read_only_fields = ['id', 'plan', 'cleaning_method', 'title', 'image_url', 'options', 'created_at']

    def get_image_url(self, obj):
        request = self.context.get('request')
        if not obj.image_file:
            return ""
        url = obj.image_file.url
        return request.build_absolute_uri(url) if request else url


class UserOpenAISettingsSerializer(serializers.ModelSerializer):
    has_api_key = serializers.SerializerMethodField()

    class Meta:
        model = UserOpenAISettings
        fields = ['has_api_key', 'created_at', 'updated_at']
        read_only_fields = ['has_api_key', 'created_at', 'updated_at']

    def get_has_api_key(self, obj):
        return bool(obj.encrypted_api_key)


class SaveUserOpenAISettingsSerializer(serializers.Serializer):
    api_key = serializers.CharField(write_only=True, trim_whitespace=True)

    def validate_api_key(self, value):
        if not value:
            raise serializers.ValidationError("La clé API est obligatoire.")
        return value


class TestOpenAIKeySerializer(serializers.Serializer):
    api_key = serializers.CharField(write_only=True, trim_whitespace=True, required=False, allow_blank=True)

    def validate_api_key(self, value):
        return value or ""


class AnalyzePlanImageSerializer(serializers.Serializer):
    image = serializers.ImageField(write_only=True)


class OpenAICleanPlanSerializer(serializers.Serializer):
    CLEANING_MODE_CHOICES = {
        'sketch_to_plan': 'sketch_to_plan',
        'existing_plan_cleanup': 'existing_plan_cleanup',
    }
    QUALITY_CHOICES = {
        'low': 'low',
        'medium': 'medium',
        'high': 'high',
    }
    CLEANUP_LEVEL_CHOICES = {
        'leger': 'leger', 'light': 'light',
        'moyen': 'moyen', 'medium': 'medium',
        'fort': 'fort', 'strong': 'strong',
    }

    cleaning_mode = serializers.ChoiceField(
        choices=list(CLEANING_MODE_CHOICES.keys()),
        required=False,
        default='sketch_to_plan',
    )
    quality = serializers.ChoiceField(
        choices=list(QUALITY_CHOICES.keys()),
        required=False,
        default='medium',
    )
    conserver_machines = serializers.BooleanField(required=False, default=True)
    supprimer_texte = serializers.BooleanField(required=False, default=False)
    supprimer_dimensions = serializers.BooleanField(required=False, default=False)
    corriger_perspective = serializers.BooleanField(required=False, default=False)
    conserver_ouvertures = serializers.BooleanField(required=False, default=True)
    epaisseur_murs = serializers.IntegerField(required=False, min_value=1, max_value=5, default=3)
    instructions_supplementaires = serializers.CharField(required=False, allow_blank=True, default="")
    plan_type = serializers.CharField(required=False, allow_blank=True, default="")
    cleaning_profile = serializers.CharField(required=False, allow_blank=True, default="")
    detected_plan_type = serializers.CharField(required=False, allow_blank=True, default="")
    detection_confidence = serializers.FloatField(required=False, allow_null=True, default=None)
    detected_elements = serializers.DictField(required=False, default=dict)
    supprimer_pictogrammes = serializers.BooleanField(required=False, default=True)
    supprimer_itineraires = serializers.BooleanField(required=False, default=True)
    supprimer_vous_etes_ici = serializers.BooleanField(required=False, default=True)
    supprimer_legende = serializers.BooleanField(required=False, default=True)
    supprimer_logos = serializers.BooleanField(required=False, default=True)
    supprimer_ombres_papier = serializers.BooleanField(required=False, default=False)
    redresser_lignes = serializers.BooleanField(required=False, default=False)
    reduire_bruit = serializers.BooleanField(required=False, default=True)
    conserver_noms_locaux = serializers.BooleanField(required=False, default=True)
    conserver_fenetres = serializers.BooleanField(required=False, default=True)
    supprimer_annotations = serializers.BooleanField(required=False, default=True)
    supprimer_cartouche = serializers.BooleanField(required=False, default=True)
    supprimer_hachures = serializers.BooleanField(required=False, default=True)
    supprimer_mobilier = serializers.BooleanField(required=False, default=True)
    conserver_portes = serializers.BooleanField(required=False, default=True)
    conserver_escaliers = serializers.BooleanField(required=False, default=True)
    simplifier_rendu = serializers.BooleanField(required=False, default=True)
    niveau_nettoyage = serializers.ChoiceField(
        choices=list(CLEANUP_LEVEL_CHOICES.keys()),
        required=False,
        default='moyen',
    )
    output_size = serializers.CharField(required=False, allow_blank=True, default="auto")
    verification_enabled = serializers.BooleanField(required=False, default=False)
    max_automatic_corrections = serializers.IntegerField(required=False, min_value=0, max_value=5, default=0)


class OpenAICleanCostEstimateSerializer(serializers.Serializer):
    CLEANING_MODE_CHOICES = {
        'local': 'local',
        'local_walls': 'local_walls',
        'sketch_to_plan': 'sketch_to_plan',
        'existing_plan_cleanup': 'existing_plan_cleanup',
    }
    QUALITY_CHOICES = OpenAICleanPlanSerializer.QUALITY_CHOICES

    cleaning_mode = serializers.ChoiceField(choices=list(CLEANING_MODE_CHOICES.keys()))
    quality = serializers.ChoiceField(choices=list(QUALITY_CHOICES.keys()), default='medium')
    output_size = serializers.CharField(required=False, allow_blank=True, default="auto")
    verification_enabled = serializers.BooleanField(required=False, default=False)
    max_automatic_corrections = serializers.IntegerField(required=False, min_value=0, max_value=5, default=0)


class UseOpenAICleanedPlanSerializer(serializers.Serializer):
    image_data = serializers.CharField(write_only=True)

    def validate_image_data(self, value):
        if not value.startswith('data:image/'):
            raise serializers.ValidationError("Image générée invalide.")
        if ';base64,' not in value:
            raise serializers.ValidationError("Image générée invalide.")
        if len(value) > MAX_OPENAI_IMAGE_DATA_LENGTH:
            raise serializers.ValidationError("Image générée trop volumineuse.")
        return value


class UseCleaningHistorySerializer(serializers.Serializer):
    history_id = serializers.IntegerField(min_value=1)


class ApplyManualPlanEditSerializer(serializers.Serializer):
    """Background retouched with the editor's eraser, sent back as a data URL."""

    image_data = serializers.CharField(write_only=True)

    def validate_image_data(self, value):
        if not value.startswith('data:image/'):
            raise serializers.ValidationError("Image retouchée invalide.")
        if ';base64,' not in value:
            raise serializers.ValidationError("Image retouchée invalide.")
        if len(value) > MAX_OPENAI_IMAGE_DATA_LENGTH:
            raise serializers.ValidationError("Image retouchée trop volumineuse.")
        return value
