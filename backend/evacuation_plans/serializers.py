from rest_framework import serializers
from django.contrib.auth.models import User
from .models import EvacuationPlan, PlanCleaningHistory, PlanIcon, PlanShape, PlanText, UserXaiSettings

MAX_IMAGE_DATA_LENGTH = 20 * 1024 * 1024

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
                  'anchor_x', 'anchor_y', 'leader_width', 'framed', 'flip_x', 'flip_y', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

class PlanShapeSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlanShape
        fields = ['id', 'plan', 'shape_type', 'x', 'y', 'width', 'height', 'rotation',
                  'stroke_width', 'color', 'fill_color', 'fill_opacity', 'tension',
                  'control_points', 'points', 'created_at', 'updated_at']
        read_only_fields = ['id', 'plan', 'created_at', 'updated_at']

    def validate(self, attrs):
        shape_type = attrs.get('shape_type')
        points = attrs.get('points')
        is_polygon = shape_type in (
            PlanShape.SHAPE_POLYGON_ZONE,
            PlanShape.SHAPE_FREE_POLYGON_ZONE,
            PlanShape.SHAPE_CURVE_POLYGON_ZONE,
        )
        if is_polygon:
            if not points or not isinstance(points, list) or len(points) < 3:
                raise serializers.ValidationError(
                    {'points': 'Un polygone nécessite au moins 3 points.'}
                )
            for index, point in enumerate(points):
                if not isinstance(point, dict) or 'x' not in point or 'y' not in point:
                    raise serializers.ValidationError(
                        {'points': f'Point {index + 1} invalide.'}
                    )
        elif points is not None:
            raise serializers.ValidationError(
                {'points': 'Les points ne sont autorisés que pour les zones polygonales.'}
            )
        return attrs


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


class UserXaiSettingsSerializer(serializers.ModelSerializer):
    has_api_key = serializers.SerializerMethodField()

    class Meta:
        model = UserXaiSettings
        fields = ['has_api_key', 'created_at', 'updated_at']
        read_only_fields = ['has_api_key', 'created_at', 'updated_at']

    def get_has_api_key(self, obj):
        return bool(obj.encrypted_api_key)


class SaveUserXaiSettingsSerializer(serializers.Serializer):
    api_key = serializers.CharField(write_only=True, trim_whitespace=True)

    def validate_api_key(self, value):
        if not value:
            raise serializers.ValidationError("La clé API est obligatoire.")
        return value


class TestXaiKeySerializer(serializers.Serializer):
    api_key = serializers.CharField(write_only=True, trim_whitespace=True, required=False, allow_blank=True)

    def validate_api_key(self, value):
        return value or ""


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
        if len(value) > MAX_IMAGE_DATA_LENGTH:
            raise serializers.ValidationError("Image retouchée trop volumineuse.")
        return value
