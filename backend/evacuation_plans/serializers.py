import base64
import binascii
import calendar
import io
import json
import math
import re

from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from django.contrib.auth.models import User
from PIL import Image, UnidentifiedImageError
from .media_access import protected_url_for_field
from .upload_validation import (
    UploadRejected,
    safe_upload_name,
    validate_background_upload,
)
from .models import (
    EvacuationPlan,
    PlanFolder,
    PlanCleaningHistory,
    PlanIcon,
    PlanOverlay,
    PlanProjectRevision,
    PlanShape,
    PlanText,
    SheetTemplateAsset,
    SheetTemplateVersion,
    UserXaiSettings,
    WorkspaceInvitation,
    WorkspaceMembership,
    accessible_plan_owner_ids,
    user_can_edit_plan,
)

MAX_IMAGE_DATA_LENGTH = 20 * 1024 * 1024
MAX_LOGO_DATA_LENGTH = 2 * 1024 * 1024
MAX_LOGO_SIDE = 2_000
MAX_LOGO_PIXELS = 4_000_000
DEFAULT_STUDIO_LOGO_PATH = '/prev-inc-cie-logo.png'
MAX_SHEET_TEMPLATE_VERSIONS = 100
MAX_SHEET_TEMPLATE_BLOCKS = 300
MAX_SHEET_TEMPLATE_SYNC_BYTES = 5 * 1024 * 1024
MAX_PLAN_SITUATION_BYTES = 512 * 1024
MAX_PLAN_SITUATION_BLOCKS = 100
PLAN_INFORMATION_LAYOUT_KEY = re.compile(r'^[a-z0-9_]{1,64}$')
PLAN_INFORMATION_LAYOUT_FIELDS = {'x', 'y', 'width', 'height', 'rotation'}
PLAN_LEGEND_LAYOUT_FIELDS = {'x', 'y', 'width', 'height', 'rotation', 'visible'}
MAX_ICON_LEADER_POINTS = 32
LEADER_POINT_ID = re.compile(r'^[A-Za-z0-9:_-]{1,80}$')
MAX_PROJECT_PICTOGRAM_SOURCES = 300


def validate_plan_information_layout(value):
    """Accept only finite, bounded geometry values for movable plan cards."""
    if not isinstance(value, dict):
        raise serializers.ValidationError("La disposition des informations doit être un objet.")

    for template_key, layout in value.items():
        if not isinstance(template_key, str) or not PLAN_INFORMATION_LAYOUT_KEY.fullmatch(template_key):
            raise serializers.ValidationError("Une clé de template de la disposition est invalide.")
        if not isinstance(layout, dict):
            raise serializers.ValidationError(
                f"La disposition du template « {template_key} » doit être un objet."
            )
        unknown_fields = sorted(set(layout) - PLAN_INFORMATION_LAYOUT_FIELDS)
        if unknown_fields:
            raise serializers.ValidationError(
                f"Propriétés de disposition inconnues : {', '.join(unknown_fields)}."
            )
        missing_fields = sorted(PLAN_INFORMATION_LAYOUT_FIELDS - set(layout))
        if missing_fields:
            raise serializers.ValidationError(
                f"Propriétés de disposition manquantes : {', '.join(missing_fields)}."
            )
        for field, number in layout.items():
            if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number):
                raise serializers.ValidationError(
                    f"La propriété « {field} » de la disposition doit être un nombre fini."
                )
            if abs(number) > 10_000:
                raise serializers.ValidationError(
                    f"La propriété « {field} » de la disposition dépasse la limite autorisée."
                )
        if layout['width'] < 20 or layout['height'] < 16:
            raise serializers.ValidationError(
                "La fiche d’informations doit mesurer au moins 20 × 16 unités."
            )
    return value


def validate_plan_legend_layout(value):
    """Accept bounded per-template geometry for the plan-owned legend."""
    if not isinstance(value, dict):
        raise serializers.ValidationError("La disposition de la légende doit être un objet.")

    for template_key, layout in value.items():
        if not isinstance(template_key, str) or not PLAN_INFORMATION_LAYOUT_KEY.fullmatch(template_key):
            raise serializers.ValidationError("Une clé de template de la légende est invalide.")
        if not isinstance(layout, dict):
            raise serializers.ValidationError(
                f"La disposition de légende du template « {template_key} » doit être un objet."
            )
        unknown_fields = sorted(set(layout) - PLAN_LEGEND_LAYOUT_FIELDS)
        missing_fields = sorted(PLAN_LEGEND_LAYOUT_FIELDS - set(layout))
        if unknown_fields:
            raise serializers.ValidationError(
                f"Propriétés de légende inconnues : {', '.join(unknown_fields)}."
            )
        if missing_fields:
            raise serializers.ValidationError(
                f"Propriétés de légende manquantes : {', '.join(missing_fields)}."
            )
        if not isinstance(layout['visible'], bool):
            raise serializers.ValidationError("La visibilité de la légende doit être vraie ou fausse.")
        for field in ('x', 'y', 'width', 'height', 'rotation'):
            number = layout[field]
            if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number):
                raise serializers.ValidationError(
                    f"La propriété « {field} » de la légende doit être un nombre fini."
                )
            if abs(number) > 10_000:
                raise serializers.ValidationError(
                    f"La propriété « {field} » de la légende dépasse la limite autorisée."
                )
        if layout['width'] < 20 or layout['height'] < 16:
            raise serializers.ValidationError("La légende doit mesurer au moins 20 × 16 unités.")
    return value


def validate_legend_hidden_icon_types(value):
    if not isinstance(value, list):
        raise serializers.ValidationError("Les éléments masqués de la légende doivent former une liste.")
    if len(value) > 300:
        raise serializers.ValidationError("La légende contient trop d’éléments masqués.")

    normalized = []
    seen = set()
    for icon_type in value:
        if not isinstance(icon_type, str) or not icon_type.strip() or len(icon_type) > 100:
            raise serializers.ValidationError("Un type de pictogramme masqué est invalide.")
        icon_type = icon_type.strip()
        if icon_type not in seen:
            normalized.append(icon_type)
            seen.add(icon_type)
    return normalized


def validate_template_snapshot(value):
    """Validate the plan-owned template copy without tying it to one UI version."""
    if value in (None, {}):
        return {}
    if not isinstance(value, dict):
        raise serializers.ValidationError("La copie du template doit être un objet.")
    try:
        encoded = json.dumps(value, ensure_ascii=False).encode('utf-8')
    except (TypeError, ValueError):
        raise serializers.ValidationError("La copie du template contient une valeur invalide.")
    if len(encoded) > MAX_SHEET_TEMPLATE_SYNC_BYTES:
        raise serializers.ValidationError("La copie du template dépasse 5 Mo.")
    blocks = value.get('blocks', [])
    if not isinstance(blocks, list) or len(blocks) > MAX_SHEET_TEMPLATE_BLOCKS:
        raise serializers.ValidationError("La copie du template contient trop de blocs.")
    if any(not isinstance(block, dict) for block in blocks):
        raise serializers.ValidationError("Chaque bloc de la copie du template doit être un objet.")
    return value


def validate_project_pictogram_sources(value):
    """Accept only bounded source descriptors used to freeze the active icons."""
    if value in (None, []):
        return []
    if not isinstance(value, list) or len(value) > MAX_PROJECT_PICTOGRAM_SOURCES:
        raise serializers.ValidationError("La liste des pictogrammes du projet est invalide.")
    normalized = []
    seen = set()
    for item in value:
        if not isinstance(item, dict):
            raise serializers.ValidationError("Une source de pictogramme est invalide.")
        icon_type = item.get('icon_type')
        if not isinstance(icon_type, str) or not icon_type.strip() or len(icon_type.strip()) > 100:
            raise serializers.ValidationError("Le type d’un pictogramme à figer est invalide.")
        icon_type = icon_type.strip()
        if icon_type in seen:
            continue
        svg_text = item.get('svg_text', '')
        file_name = item.get('file_name', '')
        if svg_text and (not isinstance(svg_text, str) or len(svg_text.encode('utf-8')) > 250 * 1024):
            raise serializers.ValidationError("Un pictogramme SVG à figer dépasse 250 Ko.")
        if file_name and (not isinstance(file_name, str) or len(file_name) > 500):
            raise serializers.ValidationError("Le chemin d’un pictogramme à figer est invalide.")
        row = {'icon_type': icon_type}
        for key, limit in (
            ('label', 255), ('file_name', 500), ('standard', 64),
            ('standard_label', 255), ('category', 100), ('category_label', 255),
        ):
            item_value = item.get(key, '')
            if item_value:
                if not isinstance(item_value, str):
                    raise serializers.ValidationError(f"La propriété {key} du pictogramme est invalide.")
                row[key] = item_value[:limit]
        if svg_text:
            row['svg_text'] = svg_text
        normalized.append(row)
        seen.add(icon_type)
    return normalized


def validate_icon_leader_points(value):
    if value in (None, []):
        return []
    if not isinstance(value, list):
        raise serializers.ValidationError("Les points de déport doivent former une liste.")
    if len(value) > MAX_ICON_LEADER_POINTS:
        raise serializers.ValidationError(
            f"Un pictogramme ne peut pas avoir plus de {MAX_ICON_LEADER_POINTS} déports."
        )

    normalized = []
    seen_ids = set()
    for point in value:
        if not isinstance(point, dict) or set(point) != {'id', 'x', 'y'}:
            raise serializers.ValidationError("Chaque déport doit contenir id, x et y.")
        point_id = point.get('id')
        if not isinstance(point_id, str) or not LEADER_POINT_ID.fullmatch(point_id):
            raise serializers.ValidationError("L’identifiant d’un point de déport est invalide.")
        if point_id in seen_ids:
            raise serializers.ValidationError("Deux points de déport ont le même identifiant.")
        coordinates = []
        for field in ('x', 'y'):
            coordinate = point.get(field)
            if (
                isinstance(coordinate, bool)
                or not isinstance(coordinate, (int, float))
                or not math.isfinite(coordinate)
                or abs(coordinate) > 1_000_000
            ):
                raise serializers.ValidationError(
                    f"La coordonnée {field} d’un point de déport est invalide."
                )
            coordinates.append(float(coordinate))
        normalized.append({'id': point_id, 'x': coordinates[0], 'y': coordinates[1]})
        seen_ids.add(point_id)
    return normalized


def validate_sheet_plan_placement(value):
    """Validate the per-plan zoom and offset used inside a template window."""
    if value in (None, {}):
        return {}
    if not isinstance(value, dict) or set(value) != {'scale', 'offsetX', 'offsetY'}:
        raise serializers.ValidationError(
            "Le recadrage du plan doit contenir scale, offsetX et offsetY."
        )
    for field, number in value.items():
        if (
            isinstance(number, bool)
            or not isinstance(number, (int, float))
            or not math.isfinite(number)
        ):
            raise serializers.ValidationError("Le recadrage du plan contient une valeur invalide.")
        if field == 'scale' and not 10 <= number <= 1000:
            raise serializers.ValidationError("Le zoom du plan doit être compris entre 10 % et 1 000 %.")
        if field != 'scale' and abs(number) > 10_000:
            raise serializers.ValidationError("Le déplacement interne du plan dépasse la limite autorisée.")
    return value


def validate_plan_situation_config(value):
    """Bound the plan-specific sheet inset without freezing its visual schema."""
    if value in (None, {}):
        return {}
    if not isinstance(value, dict):
        raise serializers.ValidationError("Le plan de situation doit être un objet.")
    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False).encode('utf-8')
    except (TypeError, ValueError):
        raise serializers.ValidationError("Le plan de situation contient une valeur invalide.")
    if len(encoded) > MAX_PLAN_SITUATION_BYTES:
        raise serializers.ValidationError("Le plan de situation dépasse 512 Ko.")

    allowed_top_level = {
        'version', 'enabled', 'visible', 'locked', 'sectorial',
        'auto_refresh_visible_area', 'orientation', 'orientation_mode',
        'content_width_percent', 'content_height_percent',
        'zone_opacity_percent', 'blocks',
    }
    unknown = sorted(set(value) - allowed_top_level)
    if unknown:
        raise serializers.ValidationError(
            f"Propriétés inconnues du plan de situation : {', '.join(unknown)}."
        )
    if value.get('version', 1) != 1:
        raise serializers.ValidationError("Version du plan de situation non prise en charge.")
    for field in ('enabled', 'visible', 'locked', 'sectorial', 'auto_refresh_visible_area'):
        if field in value and not isinstance(value[field], bool):
            raise serializers.ValidationError(f"La propriété « {field} » doit être booléenne.")
    orientation = value.get('orientation', 0)
    if (
        isinstance(orientation, bool)
        or not isinstance(orientation, (int, float))
        or not math.isfinite(orientation)
        or orientation < -3600
        or orientation > 3600
    ):
        raise serializers.ValidationError("L’orientation du plan de situation est invalide.")
    if value.get('orientation_mode', 'manual') not in {'manual', 'observer'}:
        raise serializers.ValidationError("Le mode d’orientation du plan de situation est invalide.")
    for field, minimum in (
        ('content_width_percent', 20),
        ('content_height_percent', 20),
        ('zone_opacity_percent', 5),
    ):
        number = value.get(field, 35 if field == 'zone_opacity_percent' else 90)
        if (
            isinstance(number, bool)
            or not isinstance(number, (int, float))
            or not math.isfinite(number)
            or number < minimum
            or number > 100
        ):
            raise serializers.ValidationError(f"La propriété « {field} » est invalide.")

    blocks = value.get('blocks', [])
    if not isinstance(blocks, list) or len(blocks) > MAX_PLAN_SITUATION_BLOCKS:
        raise serializers.ValidationError("Le plan de situation contient trop d’éléments.")
    allowed_kinds = {'image', 'picto', 'shape', 'text'}
    allowed_roles = {
        'frame', 'background', 'building_outline', 'assembly_point', 'observer', 'represented_zone',
        'road', 'parking', 'building', 'other_building', 'remote_equipment',
        'text', 'arrow', 'pictogram',
    }
    allowed_block_fields = {
        'id', 'kind', 'label', 'x', 'y', 'width', 'height', 'rotation', 'visible',
        'locked', 'title', 'text', 'imageKey', 'iconType', 'flipX', 'flipY',
        'lockAspectRatio', 'shapeType', 'shapePoints', 'shapeControlPoints',
        'shapeClosed', 'shapeStraightSegments', 'shapeTension', 'fillOpacity',
        'fill', 'stroke', 'strokeWidth', 'cornerRadius', 'color', 'fontSize',
        'fontStyle', 'align', 'verticalAlign', 'lineHeight', 'letterSpacing',
        'padding', 'uppercase', 'titleFill', 'titleColor', 'titleFontSize',
        'titleHeight', 'titleAlign', 'titleRule', 'titleLetterSpacing',
        'objectGroupId', 'planSpecificKind', 'situationRole',
        'situationSourcePoints',
    }
    seen_ids = set()
    for index, block in enumerate(blocks):
        if not isinstance(block, dict):
            raise serializers.ValidationError(f"L’élément {index + 1} doit être un objet.")
        unknown_block_fields = sorted(set(block) - allowed_block_fields)
        if unknown_block_fields:
            raise serializers.ValidationError(
                f"Propriétés inconnues dans l’élément {index + 1} : "
                f"{', '.join(unknown_block_fields)}."
            )
        block_id = block.get('id')
        if (
            not isinstance(block_id, str)
            or not re.fullmatch(r'plan-situation:[A-Za-z0-9:_-]{1,120}', block_id)
            or block_id in seen_ids
        ):
            raise serializers.ValidationError(f"Identifiant invalide pour l’élément {index + 1}.")
        seen_ids.add(block_id)
        if block.get('planSpecificKind') != 'situation':
            raise serializers.ValidationError("Chaque élément doit appartenir au plan de situation.")
        if block.get('kind') not in allowed_kinds:
            raise serializers.ValidationError(f"Type invalide pour l’élément {index + 1}.")
        if block.get('situationRole') not in allowed_roles:
            raise serializers.ValidationError(f"Rôle invalide pour l’élément {index + 1}.")
        for field in ('x', 'y', 'width', 'height', 'rotation'):
            number = block.get(field)
            if (
                isinstance(number, bool)
                or not isinstance(number, (int, float))
                or not math.isfinite(number)
                or abs(number) > 10_000
            ):
                raise serializers.ValidationError(
                    f"La géométrie de l’élément {index + 1} est invalide."
                )
        if block['width'] < 1 or block['height'] < 1:
            raise serializers.ValidationError("Les éléments doivent avoir une taille positive.")
        for field in ('visible', 'locked', 'flipX', 'flipY', 'lockAspectRatio', 'shapeClosed', 'uppercase', 'titleRule'):
            if field in block and not isinstance(block[field], bool):
                raise serializers.ValidationError(
                    f"La propriété « {field} » de l’élément {index + 1} doit être booléenne."
                )
        for field in ('label', 'title', 'text', 'iconType', 'imageKey', 'situationRole', 'objectGroupId'):
            if field in block and (
                not isinstance(block[field], str)
                or len(block[field]) > (5000 if field == 'text' else 255)
            ):
                raise serializers.ValidationError(
                    f"La propriété « {field} » de l’élément {index + 1} est invalide."
                )
        if block.get('imageKey') not in (None, 'planSituationBackground'):
            raise serializers.ValidationError("La source du fond du plan de situation est invalide.")
        source_points = block.get('situationSourcePoints')
        if source_points is not None:
            if not isinstance(source_points, list) or len(source_points) > 500:
                raise serializers.ValidationError("Le contour source du plan de situation est invalide.")
            for point in source_points:
                if not isinstance(point, dict) or set(point) != {'x', 'y'}:
                    raise serializers.ValidationError("Un point du contour source est invalide.")
                for coordinate in ('x', 'y'):
                    number = point[coordinate]
                    if (
                        isinstance(number, bool)
                        or not isinstance(number, (int, float))
                        or not math.isfinite(number)
                        or abs(number) > 100_000
                    ):
                        raise serializers.ValidationError("Un point du contour source est invalide.")
    return value


def next_annual_verification_date(design_date):
    """Return the same calendar date next year, clamping 29 February."""
    day = min(
        design_date.day,
        calendar.monthrange(design_date.year + 1, design_date.month)[1],
    )
    return design_date.replace(year=design_date.year + 1, day=day)


def validate_logo_data_url(value):
    if not value:
        return value
    # The application logo is a bundled, trusted public asset. Custom logos are
    # still required to be rasterized data URLs and pass the image checks below.
    if value == DEFAULT_STUDIO_LOGO_PATH:
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
    # AUTH_PASSWORD_VALIDATORS are enforced by Django's own forms, never by a
    # DRF serializer: without this the API accepted "1234" while the admin
    # refused it.
    password = serializers.CharField(write_only=True, validators=[validate_password])
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


class PlanFolderSerializer(serializers.ModelSerializer):
    plan_count = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()

    class Meta:
        model = PlanFolder
        fields = ['id', 'user', 'name', 'plan_count', 'can_edit', 'created_at', 'updated_at']
        read_only_fields = ['id', 'user', 'plan_count', 'can_edit', 'created_at', 'updated_at']

    def get_plan_count(self, obj):
        return obj.plans.count()

    def get_can_edit(self, obj):
        request = self.context.get('request')
        if request is None:
            return False
        return obj.user_id in accessible_plan_owner_ids(request.user, editable_only=True)

    def validate_name(self, value):
        name = value.strip()
        if not name:
            raise serializers.ValidationError("Le nom du dossier est obligatoire.")
        request = self.context.get('request')
        owner_id = self.instance.user_id if self.instance else getattr(request.user, 'id', None)
        duplicates = PlanFolder.objects.filter(user_id=owner_id, name__iexact=name)
        if self.instance:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise serializers.ValidationError("Un dossier porte déjà ce nom.")
        return name


class DuplicatePlanSerializer(serializers.Serializer):
    title = serializers.CharField(required=False, allow_blank=False, max_length=255, trim_whitespace=True)


class ProjectImportSerializer(serializers.Serializer):
    archive = serializers.FileField()
    title = serializers.CharField(required=False, allow_blank=True, max_length=255, trim_whitespace=True)


class PlanProjectRevisionSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source='created_by.username', read_only=True, default='')
    warning_count = serializers.SerializerMethodField()

    class Meta:
        model = PlanProjectRevision
        fields = [
            'revision_number', 'schema_version', 'reason', 'manifest_sha256',
            'previous_manifest_sha256', 'created_by_name', 'created_at', 'warning_count',
        ]
        read_only_fields = fields

    def get_warning_count(self, obj):
        warnings = obj.manifest.get('warnings', []) if isinstance(obj.manifest, dict) else []
        return len(warnings) if isinstance(warnings, list) else 0


class PlanIconSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlanIcon
        fields = ['id', 'plan', 'icon_type', 'x', 'y', 'width', 'height', 'rotation', 'label',
                  'anchor_x', 'anchor_y', 'leader_points', 'leader_width', 'framed', 'flip_x', 'flip_y',
                  'lock_aspect_ratio', 'locked',
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

    def validate_leader_points(self, value):
        return validate_icon_leader_points(value)

class PlanShapeListSerializer(serializers.ListSerializer):
    def validate(self, shapes):
        if sum(bool(shape.get('is_scale_calibration')) for shape in shapes) > 1:
            raise serializers.ValidationError(
                "Un plan ne peut contenir qu’une seule calibration d’échelle."
            )
        return shapes


class PlanShapeSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlanShape
        list_serializer_class = PlanShapeListSerializer
        fields = ['id', 'plan', 'shape_type', 'x', 'y', 'width', 'height', 'rotation',
                  'stroke_width', 'color', 'fill_color', 'fill_opacity', 'tension',
                  'control_points', 'points', 'closed', 'straight_segments', 'locked', 'visible',
                  'z_index', 'group_id', 'object_group_id', 'is_scale_calibration',
                  'calibration_real_distance_m', 'created_at', 'updated_at']
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
        is_curve_polygon = shape_type == PlanShape.SHAPE_CURVE_POLYGON_ZONE
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
            attrs['closed'] = False
            attrs['straight_segments'] = []
        elif is_polygon:
            if not points or not isinstance(points, list) or len(points) < 3:
                raise serializers.ValidationError(
                    {'points': 'Un polygone nécessite au moins 3 points.'}
                )
            if attrs.get('closed', True) is False:
                # An open path cannot have an enclosed fill area.
                attrs['fill_color'] = None
                attrs['fill_opacity'] = 0
            straight_segments = attrs.get('straight_segments', [])
            if is_curve_polygon:
                # Curve handles control bending segment by segment. There is no
                # automatic global smoothing when the drawing is completed.
                attrs['tension'] = 0
                segment_count = len(points) if attrs.get('closed', True) else len(points) - 1
                if (
                    not isinstance(straight_segments, list)
                    or any(type(index) is not int or index < 0 or index >= segment_count for index in straight_segments)
                ):
                    raise serializers.ValidationError(
                        {'straight_segments': 'Les segments droits de la zone courbe sont invalides.'}
                    )
                attrs['straight_segments'] = sorted(set(straight_segments))
            else:
                attrs['straight_segments'] = []
        else:
            attrs['straight_segments'] = []
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
        if attrs.get('is_scale_calibration', False):
            if shape_type != PlanShape.SHAPE_LINE:
                raise serializers.ValidationError({
                    'is_scale_calibration': 'La calibration doit être une ligne à deux points.'
                })
            real_distance = attrs.get('calibration_real_distance_m')
            if real_distance is None or real_distance <= 0 or real_distance > 1_000_000:
                raise serializers.ValidationError({
                    'calibration_real_distance_m': (
                        'La distance réelle doit être comprise entre 0 et 1 000 000 mètres.'
                    )
                })
            if math.hypot(attrs.get('width', 0), attrs.get('height', 0)) < 2:
                raise serializers.ValidationError({
                    'is_scale_calibration': 'Les deux points de calibration sont trop proches.'
                })
            # A technical calibration must never appear in the deliverable or
            # be moved independently from the plan after it was measured.
            attrs['visible'] = False
            attrs['locked'] = True
        else:
            attrs['calibration_real_distance_m'] = None
        return attrs


class PlanTextSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlanText
        fields = ['id', 'plan', 'text', 'x', 'y', 'font_size', 'font_family', 'color',
                  'align', 'bold', 'italic', 'background_color', 'rotation', 'locked', 'visible', 'z_index', 'group_id', 'object_group_id', 'created_at', 'updated_at']
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
        return protected_url_for_field(self.context.get('request'), obj.image_file)

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
    leader_points = serializers.JSONField(
        required=False,
        default=list,
        validators=[validate_icon_leader_points],
    )
    leader_width = serializers.FloatField(required=False, min_value=0, default=2.0)
    framed = serializers.BooleanField(required=False, default=False)
    flip_x = serializers.BooleanField(required=False, default=False)
    flip_y = serializers.BooleanField(required=False, default=False)
    lock_aspect_ratio = serializers.BooleanField(required=False, default=True)
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
    active_sheet_template_key = serializers.RegexField(
        r'^(?:none|[a-z0-9_]{1,64})$',
        required=False,
    )
    active_sheet_template_version_id = serializers.RegexField(
        r'^[A-Za-z0-9:_-]{0,160}$',
        required=False,
        allow_blank=True,
    )
    active_sheet_template_name = serializers.CharField(
        required=False,
        allow_blank=False,
        max_length=255,
    )
    last_sheet_template_key = serializers.RegexField(
        r'^(?:none|[a-z0-9_]{1,64})$',
        required=False,
    )
    last_sheet_template_version_id = serializers.RegexField(
        r'^[A-Za-z0-9:_-]{0,160}$',
        required=False,
        allow_blank=True,
    )
    last_sheet_template_name = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=255,
    )
    document_type = serializers.ChoiceField(
        choices=['', 'evacuation', 'intervention', 'room', 'instructions', 'technical_safety'],
        required=False,
        allow_blank=True,
    )
    export_paper_format = serializers.ChoiceField(
        choices=['a4', 'a3', 'a2'],
        required=False,
    )
    print_scale_denominator = serializers.IntegerField(
        required=False,
        min_value=1,
        max_value=1_000,
    )
    measured_scale_denominator = serializers.FloatField(
        required=False,
        allow_null=True,
        min_value=1,
        max_value=1_000_000,
    )
    plan_information_layout = serializers.JSONField(
        required=False,
        validators=[validate_plan_information_layout],
    )
    plan_legend_layout = serializers.JSONField(
        required=False,
        validators=[validate_plan_legend_layout],
    )
    legend_hidden_icon_types = serializers.JSONField(
        required=False,
        validators=[validate_legend_hidden_icon_types],
    )
    plan_situation_config = serializers.JSONField(
        required=False,
        validators=[validate_plan_situation_config],
    )
    sheet_plan_placement = serializers.JSONField(
        required=False,
        validators=[validate_sheet_plan_placement],
    )
    template_snapshot = serializers.JSONField(
        required=False,
        validators=[validate_template_snapshot],
    )
    pictogram_sources = serializers.JSONField(
        required=False,
        default=list,
        validators=[validate_project_pictogram_sources],
    )
    watermark = WatermarkConfigSerializer(required=False, default=dict)

class SyncEditorSerializer(serializers.Serializer):
    """Validates the complete visual editor state before any row is changed."""

    icons = SyncPlanIconSerializer(many=True)
    shapes = PlanShapeSerializer(many=True)
    texts = PlanTextSerializer(many=True)
    overlays = SyncPlanOverlaySerializer(many=True)
    plan_settings = EditorPlanSettingsSerializer()

    def validate_shapes(self, shapes):
        if sum(bool(shape.get('is_scale_calibration')) for shape in shapes) > 1:
            raise serializers.ValidationError(
                "Un plan ne peut contenir qu’une seule calibration d’échelle."
            )
        return shapes

    def validate(self, attrs):
        attrs = super().validate(attrs)
        has_calibration = any(
            bool(shape.get('is_scale_calibration')) for shape in attrs.get('shapes', [])
        )
        measured = attrs.get('plan_settings', {}).get('measured_scale_denominator')
        if has_calibration and measured is None:
            raise serializers.ValidationError({
                'plan_settings': {
                    'measured_scale_denominator': (
                        "La mesure calculée est obligatoire avec une calibration."
                    )
                }
            })
        if not has_calibration and measured is not None:
            raise serializers.ValidationError({
                'plan_settings': {
                    'measured_scale_denominator': (
                        "Une échelle mesurée nécessite une ligne de calibration."
                    )
                }
            })
        return attrs


class ProtectedFileField(serializers.FileField):
    """FileField qui rend une URL protégée sans changer l'écriture.

    Le FileField de DRF renvoie l'URL brute de MEDIA_URL, qui n'est plus servie.
    Seule `to_representation` est redéfinie : la validation et l'upload passent
    par le comportement d'origine, donc le nom du champ et le format attendu
    par le frontend restent identiques.
    """

    def to_representation(self, value):
        if not value:
            return None
        return protected_url_for_field(self.context.get('request'), value) or None


class EvacuationPlanSerializer(serializers.ModelSerializer):
    # Déclarés explicitement : c'est ainsi qu'on impose une classe de champ.
    # Le nom et le comportement en écriture ne changent pas, seule la sortie
    # devient une URL protégée — le frontend continue d'envoyer `background_file`.
    background_file = ProtectedFileField()
    cleaned_background_file = ProtectedFileField(read_only=True)
    plan_situation_background_file = ProtectedFileField(read_only=True)
    icons = PlanIconSerializer(many=True, read_only=True)
    shapes = PlanShapeSerializer(many=True, read_only=True)
    texts = PlanTextSerializer(many=True, read_only=True)
    overlays = PlanOverlaySerializer(many=True, read_only=True)
    user = serializers.PrimaryKeyRelatedField(read_only=True)
    folder_name = serializers.CharField(source='folder.name', read_only=True)
    can_edit = serializers.SerializerMethodField()
    is_archived = serializers.SerializerMethodField()
    revision_count = serializers.IntegerField(source='project_revisions.count', read_only=True)
    current_revision = serializers.SerializerMethodField()
    project_pictograms = serializers.SerializerMethodField()
    project_resources = serializers.SerializerMethodField()
    active_sheet_template_key = serializers.RegexField(
        r'^(?:none|[a-z0-9_]{1,64})$',
        required=False,
    )
    active_sheet_template_version_id = serializers.RegexField(
        r'^[A-Za-z0-9:_-]{0,160}$',
        required=False,
        allow_blank=True,
    )
    last_sheet_template_key = serializers.RegexField(
        r'^(?:none|[a-z0-9_]{1,64})$',
        required=False,
    )
    last_sheet_template_version_id = serializers.RegexField(
        r'^[A-Za-z0-9:_-]{0,160}$',
        required=False,
        allow_blank=True,
    )

    class Meta:
        model = EvacuationPlan
        fields = ['id', 'project_uuid', 'user', 'folder', 'folder_name', 'title', 'establishment_name', 'building_name', 'floor_name',
                  'plan_number', 'design_date', 'designer', 'revision_index',
                  'last_verification_date', 'next_verification_date',
                  'plan_information_visibility', 'plan_information_layout', 'plan_legend_layout',
                  'legend_hidden_icon_types', 'template_snapshot',
                  'plan_situation_config', 'plan_situation_background_file', 'background_file',
                  'document_type', 'export_paper_format', 'print_scale_denominator',
                  'measured_scale_denominator',
                  'background_type', 'cleaned_background_file', 'use_cleaned_background',
                  'main_plan_x', 'main_plan_y', 'main_plan_width', 'main_plan_height',
                  'main_plan_locked', 'main_plan_visible', 'main_plan_z_index',
                  'main_plan_group_id', 'main_plan_grouping_enabled',
                  'watermark_config', 'sheet_plan_placement', 'active_sheet_template_key',
                  'active_sheet_template_version_id', 'active_sheet_template_name',
                  'last_sheet_template_key', 'last_sheet_template_version_id',
                  'last_sheet_template_name',
                  'icons', 'shapes', 'texts',
                  'overlays', 'can_edit', 'is_archived', 'archived_at',
                  'revision_count', 'current_revision', 'project_pictograms',
                  'project_resources',
                  'created_at', 'updated_at']
        read_only_fields = [
            'id', 'project_uuid', 'user', 'plan_number', 'measured_scale_denominator',
            'cleaned_background_file', 'can_edit', 'is_archived', 'archived_at',
            'revision_count', 'current_revision', 'project_pictograms',
            'project_resources',
            'created_at', 'updated_at',
        ]

    def get_can_edit(self, obj):
        request = self.context.get('request')
        if request is None:
            return False
        return user_can_edit_plan(request.user, obj)

    def get_is_archived(self, obj):
        return obj.archived_at is not None

    def get_current_revision(self, obj):
        revision = obj.project_revisions.order_by('-revision_number').only('revision_number').first()
        return revision.revision_number if revision else None

    def get_project_pictograms(self, obj):
        from .project_archives import project_pictograms
        return project_pictograms(obj, self.context.get('request'))

    def get_project_resources(self, obj):
        from .media_access import build_protected_media_url
        return [
            {
                'role': resource.role,
                'key': resource.key,
                'sha256': resource.asset.sha256,
                'url': build_protected_media_url(
                    self.context.get('request'), resource.asset.file.name
                ),
                'media_type': resource.asset.media_type,
                'metadata': resource.metadata,
            }
            for resource in obj.project_resources.select_related('asset').order_by('role', 'key')
        ]

    def validate_template_snapshot(self, value):
        return validate_template_snapshot(value)

    def validate_folder(self, folder):
        if folder is None:
            return None
        request = self.context.get('request')
        expected_owner_id = (
            self.instance.user_id
            if self.instance is not None
            else getattr(getattr(request, 'user', None), 'id', None)
        )
        if folder.user_id != expected_owner_id:
            raise serializers.ValidationError(
                "Le dossier doit appartenir à la même liste que le plan."
            )
        return folder


    def validate_background_file(self, upload):
        """Uploads are served back from MEDIA_ROOT, so what lands there has to
        be a plan — not an HTML page or a script wearing an image extension."""
        try:
            background_type = validate_background_upload(upload)
        except UploadRejected as rejected:
            raise serializers.ValidationError(str(rejected))
        upload.name = safe_upload_name(upload.name)
        # Remembered so validate() can align background_type with the content.
        self._validated_background_type = background_type
        return upload

    def validate_plan_information_visibility(self, value):
        allowed_fields = {
            'establishment_name',
            'building_name',
            'floor_name',
            'plan_number',
            'design_date',
            'designer',
            'revision_index',
            'last_verification_date',
            'next_verification_date',
        }
        if not isinstance(value, dict):
            raise serializers.ValidationError("Les réglages de visibilité doivent être un objet.")
        unknown_fields = sorted(set(value) - allowed_fields)
        if unknown_fields:
            raise serializers.ValidationError(
                f"Champs de visibilité inconnus : {', '.join(unknown_fields)}."
            )
        if any(not isinstance(visible, bool) for visible in value.values()):
            raise serializers.ValidationError(
                "Chaque réglage de visibilité doit être vrai ou faux."
            )
        return value

    def validate_plan_information_layout(self, value):
        return validate_plan_information_layout(value)

    def validate_plan_legend_layout(self, value):
        return validate_plan_legend_layout(value)

    def validate_legend_hidden_icon_types(self, value):
        return validate_legend_hidden_icon_types(value)

    def validate_plan_situation_config(self, value):
        return validate_plan_situation_config(value)

    def validate_sheet_plan_placement(self, value):
        return validate_sheet_plan_placement(value)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        detected = getattr(self, '_validated_background_type', None)
        if detected is not None:
            # The client sends this field too; the file itself is the authority.
            attrs['background_type'] = detected

        information_fields = {
            'establishment_name': "Le nom de l’établissement est obligatoire.",
            'building_name': "Le bâtiment ou la zone est obligatoire.",
            'floor_name': "L’étage est obligatoire.",
            'design_date': "La date de conception est obligatoire.",
            'designer': "Le concepteur est obligatoire.",
            'revision_index': "L’indice de révision est obligatoire.",
        }
        current_template_key = attrs.get(
            'active_sheet_template_key',
            getattr(self.instance, 'active_sheet_template_key', 'none'),
        )
        # Selecting a real template always refreshes the plan's remembered
        # template. Switching back to ``none`` deliberately leaves that memory
        # untouched unless the caller explicitly supplies the last_* fields.
        if current_template_key != 'none':
            attrs['last_sheet_template_key'] = current_template_key
            attrs['last_sheet_template_version_id'] = attrs.get(
                'active_sheet_template_version_id',
                getattr(self.instance, 'active_sheet_template_version_id', ''),
            )
            attrs['last_sheet_template_name'] = attrs.get(
                'active_sheet_template_name',
                getattr(self.instance, 'active_sheet_template_name', ''),
            )
        information_is_being_finalized = (
            current_template_key != 'none'
            and (
                self.instance is None
                or 'active_sheet_template_key' in attrs
                or 'plan_information_visibility' in attrs
                or any(field in attrs for field in information_fields)
            )
        )
        if information_is_being_finalized:
            missing = {}
            for field, message in information_fields.items():
                value = attrs.get(field, getattr(self.instance, field, None))
                if value is None or (isinstance(value, str) and not value.strip()):
                    missing[field] = message
            if missing:
                raise serializers.ValidationError(missing)

        design_date = attrs.get('design_date', getattr(self.instance, 'design_date', None))
        if design_date:
            # This field is derived, not user-authored. Keeping the rule here
            # also protects imports and API clients that bypass the studio UI.
            attrs['next_verification_date'] = next_annual_verification_date(design_date)

        return attrs


class PlanCleaningHistorySerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = PlanCleaningHistory
        fields = ['id', 'plan', 'cleaning_method', 'title', 'image_url', 'options', 'created_at']
        read_only_fields = ['id', 'plan', 'cleaning_method', 'title', 'image_url', 'options', 'created_at']

    def get_image_url(self, obj):
        return protected_url_for_field(self.context.get('request'), obj.image_file)


class UserXaiSettingsSerializer(serializers.ModelSerializer):
    has_api_key = serializers.SerializerMethodField()

    class Meta:
        model = UserXaiSettings
        fields = ['has_api_key', 'created_at', 'updated_at']
        read_only_fields = ['has_api_key', 'created_at', 'updated_at']

    def get_has_api_key(self, obj):
        return bool(obj.encrypted_api_key)


class SheetTemplateVersionSerializer(serializers.ModelSerializer):
    id = serializers.RegexField(r'^[A-Za-z0-9._:-]{1,128}$', source='version_id')
    template = serializers.RegexField(r'^[a-z0-9_]{1,64}$', source='template_key')
    planPlacement = serializers.JSONField(source='plan_placement')
    createdAt = serializers.DateTimeField(source='source_created_at')
    updatedAt = serializers.DateTimeField(source='source_updated_at')
    owner = serializers.IntegerField(source='user_id', read_only=True)

    class Meta:
        model = SheetTemplateVersion
        fields = ['id', 'template', 'name', 'blocks', 'planPlacement', 'createdAt', 'updatedAt', 'owner']

    def validate_blocks(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('Les blocs du template doivent former une liste.')
        if len(value) > MAX_SHEET_TEMPLATE_BLOCKS:
            raise serializers.ValidationError('Ce template contient trop de blocs.')
        if any(not isinstance(block, dict) for block in value):
            raise serializers.ValidationError('Un bloc du template est invalide.')
        return value

    def validate_planPlacement(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError('Le placement du plan est invalide.')
        try:
            scale = float(value.get('scale', 100))
            offset_x = float(value.get('offsetX', 0))
            offset_y = float(value.get('offsetY', 0))
        except (TypeError, ValueError):
            raise serializers.ValidationError('Le placement du plan est invalide.')
        if not 1 <= scale <= 1_000 or abs(offset_x) > 100_000 or abs(offset_y) > 100_000:
            raise serializers.ValidationError('Le placement du plan dépasse les limites autorisées.')
        return {'scale': scale, 'offsetX': offset_x, 'offsetY': offset_y}

    def validate(self, attrs):
        if attrs['source_updated_at'] < attrs['source_created_at']:
            raise serializers.ValidationError('La date de modification du template est invalide.')
        return attrs


class SheetTemplateAssetSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source='asset_id', read_only=True)
    url = serializers.SerializerMethodField()
    owner = serializers.IntegerField(source='user_id', read_only=True)

    class Meta:
        model = SheetTemplateAsset
        fields = ['id', 'name', 'url', 'width', 'height', 'created_at', 'owner']
        read_only_fields = fields

    def get_url(self, obj):
        return protected_url_for_field(self.context.get('request'), obj.image_file)


class SheetTemplateSyncSerializer(serializers.Serializer):
    versions = SheetTemplateVersionSerializer(many=True)

    def validate_versions(self, versions):
        if len(versions) > MAX_SHEET_TEMPLATE_VERSIONS:
            raise serializers.ValidationError('Trop de versions de templates ont été envoyées.')
        version_ids = [version['version_id'] for version in versions]
        if len(version_ids) != len(set(version_ids)):
            raise serializers.ValidationError('Chaque version de template doit avoir un identifiant unique.')
        return versions

    def validate(self, attrs):
        try:
            payload_size = len(json.dumps(self.initial_data, ensure_ascii=False).encode('utf-8'))
        except (TypeError, ValueError):
            raise serializers.ValidationError('Les données des templates sont invalides.')
        if payload_size > MAX_SHEET_TEMPLATE_SYNC_BYTES:
            raise serializers.ValidationError('Les templates dépassent la taille maximale autorisée.')
        return attrs


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
