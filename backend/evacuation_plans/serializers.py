import base64
import binascii
import io

from rest_framework import serializers
from django.contrib.auth.models import User
from PIL import Image, UnidentifiedImageError
from .models import (
    EvacuationPlan,
    PlanCleaningHistory,
    PlanIcon,
    PlanOverlay,
    PlanShape,
    PlanText,
    UserXaiSettings,
    WorkspaceInvitation,
    WorkspaceMembership,
    user_can_edit_plan,
)

MAX_IMAGE_DATA_LENGTH = 20 * 1024 * 1024
MAX_LOGO_DATA_LENGTH = 2 * 1024 * 1024
MAX_LOGO_SIDE = 2_000
MAX_LOGO_PIXELS = 4_000_000


def validate_logo_data_url(value):
    if not value:
        return value
    allowed_prefixes = (
        'data:image/png;base64,',
        'data:image/jpeg;base64,',
        'data:image/jpg;base64,',
        'data:image/webp;base64,',
    )
    if not value.startswith(allowed_prefixes):
        raise serializers.ValidationError('Le logo doit être une image PNG, JPEG ou WebP encodée.')
    try:
        encoded = value.split(';base64,', 1)[1]
        image_bytes = base64.b64decode(encoded, validate=True)
        with Image.open(io.BytesIO(image_bytes)) as image:
            width, height = image.size
            if (
                width <= 0
                or height <= 0
                or width > MAX_LOGO_SIDE
                or height > MAX_LOGO_SIDE
                or width * height > MAX_LOGO_PIXELS
            ):
                raise serializers.ValidationError('Le logo dépasse les dimensions maximales autorisées.')
            image.verify()
    except serializers.ValidationError:
        raise
    except (binascii.Error, IndexError, UnidentifiedImageError, OSError, ValueError):
        raise serializers.ValidationError('Le logo est illisible.')
    return value

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
                  'anchor_x', 'anchor_y', 'leader_width', 'framed', 'flip_x', 'flip_y', 'locked',
                  'visible', 'z_index', 'group_id', 'object_group_id', 'color',
                  'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_plan(self, plan):
        """`plan` is writable here, so its owner has to be checked by hand.

        Without this an authenticated user could post any plan id and drop icons
        into — or move them onto — someone else's plan. The sibling serializers
        keep `plan` read-only and get this for free; this one cannot, because
        `/api/icons/` is a standalone endpoint that needs the field.
        """
        request = self.context.get('request')
        if request is None or not request.user.is_authenticated:
            raise serializers.ValidationError("Authentification requise.")
        # Write access, not merely visibility: a read-only member of a shared
        # workspace can see the plan but must not drop icons into it.
        if not user_can_edit_plan(request.user, plan):
            # Same message either way: do not confirm that the plan exists.
            raise serializers.ValidationError("Plan introuvable.")
        return plan

class PlanShapeSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlanShape
        fields = ['id', 'plan', 'shape_type', 'x', 'y', 'width', 'height', 'rotation',
                  'stroke_width', 'color', 'fill_color', 'fill_opacity', 'tension',
                  'control_points', 'points', 'locked', 'visible', 'z_index', 'group_id', 'object_group_id', 'created_at', 'updated_at']
        read_only_fields = ['id', 'plan', 'created_at', 'updated_at']

    def validate(self, attrs):
        shape_type = attrs.get('shape_type')
        points = attrs.get('points')
        is_polyline = shape_type == PlanShape.SHAPE_POLYLINE
        is_polygon = shape_type in (
            PlanShape.SHAPE_POLYGON_ZONE,
            PlanShape.SHAPE_FREE_POLYGON_ZONE,
            PlanShape.SHAPE_CURVE_POLYGON_ZONE,
        )
        if is_polyline:
            if not points or not isinstance(points, list) or len(points) < 2:
                raise serializers.ValidationError(
                    {'points': 'Une polyligne nécessite au moins 2 points.'}
                )
            # A polyline is deliberately open and line-only. Ignore any stale
            # or malicious fill values sent by a client.
            attrs['fill_color'] = None
            attrs['fill_opacity'] = 0
            attrs['tension'] = 0
        elif is_polygon:
            if not points or not isinstance(points, list) or len(points) < 3:
                raise serializers.ValidationError(
                    {'points': 'Un polygone nécessite au moins 3 points.'}
                )
        if is_polyline or is_polygon:
            for index, point in enumerate(points):
                if not isinstance(point, dict) or 'x' not in point or 'y' not in point:
                    raise serializers.ValidationError(
                        {'points': f'Point {index + 1} invalide.'}
                    )
        elif points is not None:
            raise serializers.ValidationError(
                {'points': 'Les points ne sont autorisés que pour les polylignes et les zones polygonales.'}
            )
        return attrs


class PlanTextSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlanText
        fields = ['id', 'plan', 'text', 'x', 'y', 'font_size', 'font_family', 'color',
                  'bold', 'italic', 'background_color', 'rotation', 'locked', 'visible', 'z_index', 'group_id', 'object_group_id', 'created_at', 'updated_at']
        read_only_fields = ['id', 'plan', 'created_at', 'updated_at']


class PlanOverlaySerializer(serializers.ModelSerializer):
    """Read side of a secondary plan: the client only ever needs its URL."""

    image_url = serializers.SerializerMethodField()
    can_revert_original = serializers.SerializerMethodField()

    class Meta:
        model = PlanOverlay
        fields = [
            'id', 'image_url', 'x', 'y', 'width', 'height', 'rotation',
            'label', 'locked', 'visible', 'z_index', 'group_id', 'is_original', 'can_revert_original',
        ]
        read_only_fields = fields

    def get_image_url(self, obj):
        if not obj.image_file:
            return ""
        request = self.context.get('request')
        url = obj.image_file.url
        return request.build_absolute_uri(url) if request else url

    def get_can_revert_original(self, obj):
        return bool(obj.original_image_file)


class SyncPlanOverlaySerializer(serializers.Serializer):
    """Write side: either a fresh image, or a reference to one already stored.

    Re-uploading an unchanged plan on every save would rewrite megabytes for
    nothing, so an untouched overlay travels as its id (`image_ref`) instead.
    """

    image_data = serializers.CharField(required=False, allow_blank=True, max_length=MAX_IMAGE_DATA_LENGTH)
    image_ref = serializers.IntegerField(required=False, allow_null=True)
    overlay_id = serializers.IntegerField(required=False, allow_null=True)
    x = serializers.FloatField()
    y = serializers.FloatField()
    width = serializers.FloatField(min_value=1)
    height = serializers.FloatField(min_value=1)
    rotation = serializers.FloatField(required=False, default=0.0)
    label = serializers.CharField(required=False, allow_blank=True, default='', max_length=255)
    locked = serializers.BooleanField(required=False, default=False)
    visible = serializers.BooleanField(required=False, default=True)
    z_index = serializers.IntegerField(required=False, default=100)
    group_id = serializers.CharField(required=False, allow_blank=True, default='', max_length=64)

    def validate(self, attrs):
        if not attrs.get('image_data') and not attrs.get('image_ref'):
            raise serializers.ValidationError(
                "Chaque plan secondaire doit fournir 'image_data' ou 'image_ref'."
            )
        return attrs


class SyncPlanIconSerializer(serializers.Serializer):
    icon_type = serializers.CharField(max_length=100)
    x = serializers.FloatField()
    y = serializers.FloatField()
    width = serializers.FloatField(min_value=1)
    height = serializers.FloatField(min_value=1)
    rotation = serializers.FloatField(required=False, default=0.0)
    label = serializers.CharField(required=False, allow_blank=True, allow_null=True, default='')
    anchor_x = serializers.FloatField(required=False, allow_null=True)
    anchor_y = serializers.FloatField(required=False, allow_null=True)
    leader_width = serializers.FloatField(required=False, min_value=0, default=2.0)
    framed = serializers.BooleanField(required=False, default=False)
    flip_x = serializers.BooleanField(required=False, default=False)
    flip_y = serializers.BooleanField(required=False, default=False)
    locked = serializers.BooleanField(required=False, default=False)
    visible = serializers.BooleanField(required=False, default=True)
    z_index = serializers.IntegerField(required=False, default=300)
    group_id = serializers.CharField(required=False, allow_blank=True, default='', max_length=64)
    object_group_id = serializers.CharField(required=False, allow_blank=True, default='', max_length=64)
    # Blank means "leave the pictogram's own colours alone".
    color = serializers.RegexField(
        r'^(#[0-9a-fA-F]{6})?$',
        required=False,
        allow_blank=True,
        default='',
        error_messages={'invalid': "La couleur doit être au format #rrggbb."},
    )


class WatermarkConfigSerializer(serializers.Serializer):
    enabled = serializers.BooleanField(required=False, default=False)
    text = serializers.CharField(required=False, allow_blank=True, default='BON À TIRER – POUR VALIDATION UNIQUEMENT', max_length=500)
    client = serializers.CharField(required=False, allow_blank=True, default='', max_length=255)
    reference = serializers.CharField(required=False, allow_blank=True, default='', max_length=255)
    date = serializers.CharField(required=False, allow_blank=True, default='', max_length=32)
    comment = serializers.CharField(required=False, allow_blank=True, default='', max_length=2000)
    client_logo = serializers.CharField(
        required=False,
        allow_blank=True,
        default='',
        max_length=MAX_LOGO_DATA_LENGTH,
        validators=[validate_logo_data_url],
    )
    creator_logo = serializers.CharField(
        required=False,
        allow_blank=True,
        default='',
        max_length=MAX_LOGO_DATA_LENGTH,
        validators=[validate_logo_data_url],
    )
    show_bat_block = serializers.BooleanField(required=False, default=True)
    repeat = serializers.BooleanField(required=False, default=True)
    diagonal = serializers.BooleanField(required=False, default=True)
    block_x = serializers.FloatField(required=False, min_value=0, max_value=1, default=0.68)
    block_y = serializers.FloatField(required=False, min_value=0, max_value=1, default=0.62)
    block_locked = serializers.BooleanField(required=False, default=False)


class EditorPlanSettingsSerializer(serializers.Serializer):
    main_plan_x = serializers.FloatField(required=False, default=0.0)
    main_plan_y = serializers.FloatField(required=False, default=0.0)
    main_plan_width = serializers.FloatField(required=False, min_value=0, default=0.0)
    main_plan_height = serializers.FloatField(required=False, min_value=0, default=0.0)
    main_plan_locked = serializers.BooleanField(required=False, default=False)
    main_plan_visible = serializers.BooleanField(required=False, default=True)
    main_plan_z_index = serializers.IntegerField(required=False, default=0)
    main_plan_group_id = serializers.CharField(required=False, allow_blank=True, default='', max_length=64)
    main_plan_grouping_enabled = serializers.BooleanField(required=False, default=False)
    watermark = WatermarkConfigSerializer(required=False, default=dict)


class SyncEditorSerializer(serializers.Serializer):
    """Validates the complete visual editor state before any row is changed."""

    icons = SyncPlanIconSerializer(many=True)
    shapes = PlanShapeSerializer(many=True)
    texts = PlanTextSerializer(many=True)
    overlays = SyncPlanOverlaySerializer(many=True)
    plan_settings = EditorPlanSettingsSerializer()


class EvacuationPlanSerializer(serializers.ModelSerializer):
    icons = PlanIconSerializer(many=True, read_only=True)
    shapes = PlanShapeSerializer(many=True, read_only=True)
    texts = PlanTextSerializer(many=True, read_only=True)
    overlays = PlanOverlaySerializer(many=True, read_only=True)
    user = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = EvacuationPlan
        fields = ['id', 'user', 'title', 'building_name', 'floor_name', 'background_file',
                  'background_type', 'cleaned_background_file', 'use_cleaned_background',
                  'main_plan_x', 'main_plan_y', 'main_plan_width', 'main_plan_height',
                  'main_plan_locked', 'main_plan_visible', 'main_plan_z_index',
                  'main_plan_group_id', 'main_plan_grouping_enabled',
                  'watermark_config', 'icons', 'shapes', 'texts',
                  'overlays', 'created_at', 'updated_at']
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
    overlay_id = serializers.IntegerField(min_value=1, required=False)


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


class WorkspaceMembershipSerializer(serializers.ModelSerializer):
    member_username = serializers.CharField(source='member.username', read_only=True)
    member_email = serializers.EmailField(source='member.email', read_only=True)

    class Meta:
        model = WorkspaceMembership
        fields = ['id', 'member_username', 'member_email', 'role', 'created_at']
        read_only_fields = fields


class WorkspaceInvitationSerializer(serializers.ModelSerializer):
    """Read side. The token is deliberately absent: it is shown once, at
    creation, and only its hash is ever stored."""

    status = serializers.SerializerMethodField()

    class Meta:
        model = WorkspaceInvitation
        fields = ['id', 'email', 'role', 'status', 'created_at', 'expires_at']
        read_only_fields = fields

    def get_status(self, invitation):
        if invitation.accepted_at:
            return 'accepted'
        if invitation.revoked_at:
            return 'revoked'
        if not invitation.is_pending:
            return 'expired'
        return 'pending'


class CreateWorkspaceInvitationSerializer(serializers.Serializer):
    email = serializers.EmailField()
    role = serializers.ChoiceField(
        choices=WorkspaceMembership.ROLE_CHOICES,
        default=WorkspaceMembership.ROLE_VIEWER,
    )

    def validate_email(self, email):
        owner = self.context['request'].user
        if owner.email and email.lower() == owner.email.lower():
            raise serializers.ValidationError("Vous ne pouvez pas vous inviter vous-même.")
        return email.lower()


class AcceptWorkspaceInvitationSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=128, trim_whitespace=True)
