import os
import json
import base64
import binascii
import copy
import io
import re
import cv2
import logging
import threading
import numpy as np
import fitz # PyMuPDF
from datetime import timedelta
from PIL import Image, UnidentifiedImageError
from urllib.parse import quote
from django.conf import settings
from django.db import close_old_connections, transaction
from django.db.models import Q
from django.utils import timezone
from django.core.files.base import ContentFile
from django.http import FileResponse
from rest_framework import viewsets, permissions, status, generics
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework.response import Response
from rest_framework.decorators import action
from django.contrib.auth.models import User
from .models import (
    EvacuationPlan,
    GrokCleaningJob,
    PlanCleaningHistory,
    PlanIcon,
    PlanFolder,
    PlanOverlay,
    PlanProjectRevision,
    PlanShape,
    PlanText,
    SheetTemplateAsset,
    SheetTemplateVersion,
    UserPictogramLabel,
    UserXaiSettings,
    WorkspaceInvitation,
    WorkspaceMembership,
    accessible_library_owner_ids,
    accessible_plan_owner_ids,
    hash_invitation_token,
    restrict_plans_to,
    user_can_edit_plan,
    user_can_edit_default_templates,
)
from .media_access import (
    build_protected_media_url,
    clear_media_session_cookie,
    set_media_session_cookie,
)
from .pictogram_catalogs import (
    PICTOGRAM_CATALOGS,
    catalogue_icon_type,
    catalogue_metadata,
    humanize_pictogram_label,
)
from .pictogram_security import (
    MAX_PICTOGRAM_SVG_BYTES,
    sanitize_pictogram_svg_file,
    validate_and_sanitize_pictogram_svg,
)
from .plan_compliance import automatic_plan_number
from .throttles import AiRateThrottle, LoginRateThrottle, UploadRateThrottle
from .upload_validation import (
    UploadRejected,
    safe_upload_name,
    validate_background_upload,
)
from .grok_cleaning import (
    GrokCleaningError,
    MissingXaiApiKeyError,
    _get_request_timeout,
    analyze_and_clean_plan,
    normalize_hex_color,
)
from .serializers import (
    UserRegistrationSerializer,
    UserSerializer,
    EvacuationPlanSerializer,
    DuplicatePlanSerializer,
    PlanProjectRevisionSerializer,
    ProjectImportSerializer,
    PlanFolderSerializer,
    PlanIconSerializer,
    PlanOverlaySerializer,
    PlanShapeSerializer,
    PlanTextSerializer,
    SyncEditorSerializer,
    AcceptWorkspaceInvitationSerializer,
    CreateWorkspaceInvitationSerializer,
    SyncPlanIconSerializer,
    SyncPlanOverlaySerializer,
    MAX_IMAGE_DATA_LENGTH,
    SaveUserXaiSettingsSerializer,
    SheetTemplateAssetSerializer,
    SheetTemplateSyncSerializer,
    SheetTemplateVersionSerializer,
    TestXaiKeySerializer,
    PlanCleaningHistorySerializer,
    ApplyManualPlanEditSerializer,
    UseCleaningHistorySerializer,
    UserXaiSettingsSerializer,
    WorkspaceInvitationSerializer,
    WorkspaceMembershipSerializer,
)
from .project_archives import (
    ProjectArchiveError,
    build_project_zip,
    capture_project_revision,
    clone_project_resources,
    import_project_zip,
    restore_project_revision,
    verify_project_integrity,
)

PLAN_LEGACY_CUSTOM_PICTOGRAM_DIR = 'plan_picto'
PLAN_USER_PICTOGRAM_ROOT = 'user_pictograms'
PLAN_PICTOGRAM_EXTENSIONS = {'.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif'}
logger = logging.getLogger(__name__)
# Piste d'audit : qui a fait quoi. Voir evacuation_plans/signals.py.
audit = logging.getLogger('evacstudio.audit')

MAX_OVERLAY_IMAGE_SIDE = 20_000
MAX_OVERLAY_IMAGE_PIXELS = 80_000_000
DEFAULT_GROK_JOB_STALE_SECONDS = 420


def clone_stored_file(field_file):
    """Return an independent in-memory copy suitable for another FileField."""
    if not field_file or not field_file.name:
        return None
    with field_file.open('rb') as source:
        return ContentFile(source.read(), name=os.path.basename(field_file.name))


def clone_model_values(instance, excluded):
    """Copy every concrete data field so future visual fields are not omitted."""
    return {
        field.name: copy.deepcopy(getattr(instance, field.name))
        for field in instance._meta.concrete_fields
        if field.name not in excluded
    }


def get_grok_job_stale_seconds():
    """Maximum time a Grok job may remain in one stage without progress."""
    try:
        timeout = int(os.environ.get(
            "GROK_JOB_STALE_SECONDS",
            DEFAULT_GROK_JOB_STALE_SECONDS,
        ))
    except (TypeError, ValueError):
        return DEFAULT_GROK_JOB_STALE_SECONDS
    return max(60, min(timeout, 1800))


def expire_stalled_grok_job(job):
    """Turn an abandoned active job into a terminal failure for pollers."""
    active_statuses = {
        GrokCleaningJob.STATUS_PENDING,
        GrokCleaningJob.STATUS_ANALYZING,
        GrokCleaningJob.STATUS_GENERATING,
    }
    if job.status not in active_statuses:
        return False
    stale_before = timezone.now() - timedelta(seconds=get_grok_job_stale_seconds())
    if job.updated_at > stale_before:
        return False
    stalled_status = job.status
    job.mark_failed(
        "XAI_TIMEOUT",
        "Le nettoyage avec Grok a dépassé le délai d’attente. Veuillez réessayer.",
        f"job_stalled:{stalled_status}",
    )
    return True


def validate_overlay_image_bytes(image_bytes):
    """Inspect image headers before OpenCV allocates the decoded pixel buffer."""
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            width, height = image.size
            if (
                width <= 0
                or height <= 0
                or width > MAX_OVERLAY_IMAGE_SIDE
                or height > MAX_OVERLAY_IMAGE_SIDE
                or width * height > MAX_OVERLAY_IMAGE_PIXELS
            ):
                return False, "Le plan secondaire dépasse les dimensions maximales autorisées."
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError):
        return False, "Le fichier secondaire n'est pas une image valide."
    return True, None


def build_plan_pictogram_url(request, relative_path):
    # Protégée comme tout le reste de MEDIA_ROOT : la bibliothèque est partagée
    # entre comptes connectés, pas publique sur Internet.
    media_path = '/'.join(relative_path.split(os.sep))
    return build_protected_media_url(request, media_path)


def normalize_pictogram_name(value):
    name = os.path.basename(str(value or '')).rsplit('.', 1)[0]
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', ' ', name)
    name = re.sub(r'\s+', ' ', name).strip(' .')
    if not name:
        return None
    return name[:80].strip()


def user_pictogram_directory(user_id, standard=None, category=None):
    directory = f'{PLAN_USER_PICTOGRAM_ROOT}/{int(user_id)}'
    if standard and category:
        directory = f'{directory}/{standard}/{category}'
    return directory


def user_pictogram_owner_id(directory):
    parts = str(directory or '').split('/')
    if len(parts) < 2 or parts[0] != PLAN_USER_PICTOGRAM_ROOT:
        return None
    try:
        return int(parts[1])
    except (TypeError, ValueError):
        return None


def resolve_user_pictogram_file(request, requested_filename):
    requested_path = str(requested_filename or '').replace('\\', '/').strip('/')
    owner_ids = accessible_plan_owner_ids(request.user, editable_only=True)
    if not owner_ids:
        return None, None, None

    ordered_owner_ids = [request.user.id, *sorted(owner_id for owner_id in owner_ids if owner_id != request.user.id)]
    candidate_directories = [user_pictogram_directory(owner_id) for owner_id in ordered_owner_ids]
    if '/' in requested_path:
        path_parts = requested_path.split('/')
        if any(part in {'', '.', '..'} for part in path_parts):
            return None, None, None
        directory, filename = requested_path.rsplit('/', 1)
        candidate_directories = [
            owner_directory
            for owner_directory in candidate_directories
            if directory == owner_directory or directory.startswith(f'{owner_directory}/')
        ]
        search_directories = [directory] if candidate_directories else []
    else:
        filename = os.path.basename(requested_path)
        search_directories = []
        for owner_directory in candidate_directories:
            owner_root = os.path.join(settings.MEDIA_ROOT, owner_directory)
            if not os.path.isdir(owner_root):
                continue
            for current_root, child_directories, _filenames in os.walk(owner_root, followlinks=False):
                child_directories[:] = [
                    child for child in child_directories
                    if not os.path.islink(os.path.join(current_root, child))
                ]
                search_directories.append(
                    os.path.relpath(current_root, settings.MEDIA_ROOT).replace(os.sep, '/')
                )

    if not filename or filename != os.path.basename(filename) or not filename.lower().endswith('.svg'):
        return None, None, None

    for directory in search_directories:
        root = os.path.join(settings.MEDIA_ROOT, directory)
        if not os.path.isdir(root):
            continue
        stored_filename = next(
            (item for item in os.listdir(root) if item.casefold() == filename.casefold()),
            None,
        )
        if stored_filename:
            return directory, root, stored_filename
    return None, None, None


def serialize_plan_pictogram(
    request,
    directory,
    filename,
    *,
    deletable=False,
    icon_type=None,
    label=None,
    standard='general',
    standard_label='Bibliothèque générale',
    category='uncategorized',
    category_label='Non classés',
    subcategory='',
    subcategory_label='',
):
    name, _extension = os.path.splitext(filename)
    relative_path = os.path.join(directory, filename)
    display_label = label or name
    return {
        'type': icon_type or name,
        'label': display_label,
        'original_label': display_label,
        'custom_label': '',
        'file_name': '/'.join(relative_path.split(os.sep)),
        'url': build_plan_pictogram_url(request, relative_path),
        'deletable': bool(deletable and filename.lower().endswith('.svg')),
        'standard': standard,
        'standard_label': standard_label,
        'category': category,
        'category_label': category_label,
        'subcategory': subcategory,
        'subcategory_label': subcategory_label,
    }


def apply_user_pictogram_labels(request, pictograms):
    if not getattr(request, 'user', None) or not request.user.is_authenticated:
        return pictograms
    plan_id = request.query_params.get('plan_id')
    if not plan_id and getattr(request, 'resolver_match', None):
        plan_id = request.resolver_match.kwargs.get('pk')
    labels = {
        item.icon_type: (item.label, 'all')
        for item in UserPictogramLabel.objects.filter(user=request.user, plan__isnull=True)
    }
    if plan_id:
        labels.update({
            item.icon_type: (item.label, 'plan')
            for item in UserPictogramLabel.objects.filter(
                user=request.user,
                plan_id=plan_id,
            )
        })
    if not labels:
        return pictograms
    for pictogram in pictograms:
        custom_label_data = labels.get(pictogram.get('type'))
        if custom_label_data:
            custom_label, custom_label_scope = custom_label_data
            pictogram['custom_label'] = custom_label
            pictogram['custom_label_scope'] = custom_label_scope
            pictogram['label'] = custom_label
    return pictograms


def flat_pictogram_metadata(directory):
    if directory.startswith(f'{PLAN_USER_PICTOGRAM_ROOT}/'):
        return {
            'standard': 'general',
            'standard_label': 'Personnels et généraux',
            'category': 'personal',
            'category_label': 'Pictogrammes personnels',
        }
    return {
        'standard': 'other',
        'standard_label': 'Autres',
        'category': '99-historique',
        'category_label': 'Imports historiques',
    }


def selected_catalogue_metadata(standard, category):
    """Validate an import destination and return its public filter metadata."""
    catalogue = PICTOGRAM_CATALOGS.get(str(standard or ''))
    category_key = str(category or '')
    if not catalogue or not category_key:
        return None

    root_category = catalogue['root_category']
    if category_key == root_category['key']:
        category_label = root_category['label']
    else:
        category_label = catalogue['categories'].get(category_key)
    if not category_label:
        return None

    return {
        'standard': str(standard),
        'standard_label': catalogue['label'],
        'category': category_key,
        'category_label': category_label,
        'subcategory': '',
        'subcategory_label': '',
    }


def user_pictogram_metadata(relative_path):
    """Read a user SVG classification from <standard>/<category>/<file>."""
    parts = str(relative_path or '').replace('\\', '/').strip('/').split('/')
    if len(parts) == 3:
        selected = selected_catalogue_metadata(parts[0], parts[1])
        if selected:
            return selected
    return flat_pictogram_metadata(f'{PLAN_USER_PICTOGRAM_ROOT}/0')


def serialize_user_pictogram(request, directory, filename, *, deletable):
    owner_id = user_pictogram_owner_id(directory)
    if owner_id is None:
        metadata = flat_pictogram_metadata(directory)
    else:
        owner_directory = user_pictogram_directory(owner_id)
        relative_path = os.path.relpath(
            os.path.join(directory, filename),
            owner_directory,
        ).replace(os.sep, '/')
        metadata = user_pictogram_metadata(relative_path)
    return serialize_plan_pictogram(
        request,
        directory,
        filename,
        deletable=deletable,
        **metadata,
    )


def user_pictogram_name_exists(owner_ids, name, excluded_media_path=None):
    normalized_name = str(name or '').casefold()
    excluded = str(excluded_media_path or '').replace('\\', '/').strip('/')
    for owner_id in owner_ids:
        owner_directory = user_pictogram_directory(owner_id)
        owner_root = os.path.join(settings.MEDIA_ROOT, owner_directory)
        if not os.path.isdir(owner_root):
            continue
        for current_root, child_directories, filenames in os.walk(owner_root, followlinks=False):
            child_directories[:] = [
                child for child in child_directories
                if not os.path.islink(os.path.join(current_root, child))
            ]
            for filename in filenames:
                media_path = os.path.relpath(
                    os.path.join(current_root, filename),
                    settings.MEDIA_ROOT,
                ).replace(os.sep, '/')
                if (
                    media_path != excluded
                    and os.path.splitext(filename)[0].casefold() == normalized_name
                ):
                    return True
    return False


def registered_catalogue_contains_name(name):
    """Return whether a bundled catalogue already owns this display name."""
    normalized_name = str(name or '').casefold()
    for catalogue in PICTOGRAM_CATALOGS.values():
        catalogue_root = os.path.join(
            settings.MEDIA_ROOT,
            str(catalogue['directory']).strip('/'),
        )
        if not os.path.isdir(catalogue_root):
            continue
        for current_root, child_directories, filenames in os.walk(catalogue_root, followlinks=False):
            child_directories[:] = [
                child for child in child_directories
                if not os.path.islink(os.path.join(current_root, child))
            ]
            if any(
                filename.lower().endswith('.svg')
                and os.path.splitext(filename)[0].casefold() == normalized_name
                for filename in filenames
            ):
                return True
    return False


def append_user_pictograms(request, pictograms, seen_types, owner_ids, editable_owner_ids):
    """Recursively expose classified and legacy user-created pictograms."""
    for owner_id in owner_ids:
        owner_directory = user_pictogram_directory(owner_id)
        owner_root = os.path.join(settings.MEDIA_ROOT, owner_directory)
        if not os.path.isdir(owner_root):
            continue

        for current_root, child_directories, filenames in os.walk(owner_root, followlinks=False):
            child_directories[:] = sorted(
                (
                    child for child in child_directories
                    if not os.path.islink(os.path.join(current_root, child))
                ),
                key=str.casefold,
            )
            for filename in sorted(filenames, key=str.casefold):
                absolute_path = os.path.join(current_root, filename)
                name, extension = os.path.splitext(filename)
                normalized_type = name.casefold()
                if (
                    os.path.islink(absolute_path)
                    or not os.path.isfile(absolute_path)
                    or extension.lower() not in PLAN_PICTOGRAM_EXTENSIONS
                    or normalized_type in seen_types
                ):
                    continue

                relative_user_path = os.path.relpath(
                    absolute_path,
                    owner_root,
                ).replace(os.sep, '/')
                media_directory = os.path.relpath(
                    current_root,
                    settings.MEDIA_ROOT,
                ).replace(os.sep, '/')
                seen_types.add(normalized_type)
                pictograms.append(serialize_plan_pictogram(
                    request,
                    media_directory,
                    filename,
                    deletable=owner_id in editable_owner_ids,
                    **user_pictogram_metadata(relative_user_path),
                ))


def append_registered_catalogues(request, pictograms, seen_types):
    """Recursively expose safe SVGs from every configured standard catalogue."""
    for catalogue_key, catalogue in PICTOGRAM_CATALOGS.items():
        catalogue_directory = str(catalogue['directory']).strip('/')
        catalogue_root = os.path.join(settings.MEDIA_ROOT, catalogue_directory)
        if not os.path.isdir(catalogue_root):
            continue

        for current_root, child_directories, filenames in os.walk(catalogue_root, followlinks=False):
            child_directories[:] = sorted(
                (
                    name for name in child_directories
                    if not os.path.islink(os.path.join(current_root, name))
                ),
                key=str.casefold,
            )
            for filename in sorted(filenames, key=str.casefold):
                absolute_path = os.path.join(current_root, filename)
                if (
                    os.path.islink(absolute_path)
                    or not os.path.isfile(absolute_path)
                    or not filename.lower().endswith('.svg')
                ):
                    continue

                _sanitized, validation_error = sanitize_pictogram_svg_file(absolute_path)
                if validation_error:
                    logger.warning(
                        'pictogram_catalog.svg_rejected catalogue=%s file=%s reason=%s',
                        catalogue_key,
                        os.path.relpath(absolute_path, catalogue_root),
                        validation_error,
                    )
                    continue

                relative_catalogue_path = os.path.relpath(
                    absolute_path,
                    catalogue_root,
                ).replace(os.sep, '/')
                icon_type = catalogue_icon_type(catalogue_key, relative_catalogue_path)
                normalized_type = icon_type.casefold()
                if normalized_type in seen_types:
                    continue

                relative_media_path = os.path.join(catalogue_directory, relative_catalogue_path)
                media_directory, media_filename = os.path.split(relative_media_path)
                metadata = catalogue_metadata(catalogue_key, relative_catalogue_path)
                seen_types.add(normalized_type)
                pictograms.append(serialize_plan_pictogram(
                    request,
                    media_directory,
                    media_filename,
                    icon_type=icon_type,
                    label=humanize_pictogram_label(os.path.splitext(media_filename)[0]),
                    **metadata,
                ))


def list_plan_pictograms(request):
    pictograms = []
    seen_types = set()
    owner_ids = accessible_library_owner_ids(request.user)
    editable_owner_ids = accessible_plan_owner_ids(request.user, editable_only=True)
    ordered_owner_ids = [request.user.id, *sorted(owner_id for owner_id in owner_ids if owner_id != request.user.id)]
    append_user_pictograms(
        request,
        pictograms,
        seen_types,
        ordered_owner_ids,
        editable_owner_ids,
    )
    # Keep reading the old upload folder for installations that still contain
    # user-created SVGs there. Bundled artwork now lives exclusively in the
    # registered, structured catalogues appended below.
    directories = [(PLAN_LEGACY_CUSTOM_PICTOGRAM_DIR, False, None)]

    for directory, deletable, allowed_names in directories:
        root = os.path.join(settings.MEDIA_ROOT, directory)
        if not os.path.isdir(root):
            continue

        for filename in sorted(os.listdir(root), key=str.casefold):
            path = os.path.join(root, filename)
            name, extension = os.path.splitext(filename)
            icon_type = name
            normalized_type = icon_type.casefold()
            if (
                not os.path.isfile(path)
                or extension.lower() not in PLAN_PICTOGRAM_EXTENSIONS
                or normalized_type in seen_types
                or (allowed_names is not None and name not in allowed_names)
            ):
                continue

            seen_types.add(normalized_type)
            pictograms.append(serialize_plan_pictogram(
                request,
                directory,
                filename,
                deletable=deletable,
                **flat_pictogram_metadata(directory),
            ))

    append_registered_catalogues(request, pictograms, seen_types)

    return apply_user_pictogram_labels(request, pictograms)


def project_pictogram_capture_inputs(request):
    """Return trusted catalogue paths plus the metadata needed by a snapshot."""
    catalog = list_plan_pictograms(request)
    sources = [
        {**item, 'icon_type': item.get('type')}
        for item in catalog
        if item.get('type')
    ]
    allowed_paths = {
        str(item.get('file_name') or '').replace('\\', '/').strip('/')
        for item in sources
        if item.get('file_name')
    }
    return sources, allowed_paths


def freeze_template_versions_for_projects(request, versions):
    """Detach affected plans from reusable templates before library deletion."""
    versions = list(versions)
    if not versions:
        return
    sources, allowed_paths = project_pictogram_capture_inputs(request)
    plan_owner_ids = accessible_library_owner_ids(request.user)
    for version in versions:
        affected_plans = EvacuationPlan.objects.filter(
            user_id__in=plan_owner_ids,
        ).filter(
            Q(active_sheet_template_version_id=version.version_id)
            | Q(last_sheet_template_version_id=version.version_id)
        ).distinct()
        for plan in affected_plans:
            snapshot = plan.template_snapshot if isinstance(plan.template_snapshot, dict) else {}
            if snapshot.get('versionId') != version.version_id:
                plan.template_snapshot = {
                    'schemaVersion': 1,
                    'templateKey': version.template_key,
                    'versionId': version.version_id,
                    'name': version.name,
                    'blocks': version.blocks,
                    'planPlacement': version.plan_placement,
                }
                plan.save(update_fields=['template_snapshot', 'updated_at'])
            capture_project_revision(
                plan,
                actor=request.user,
                pictogram_sources=sources,
                allowed_media_paths=allowed_paths,
            )


def flatten_on_white(img):
    """Lays a transparent image on a white sheet, the way it is displayed.

    A plan exported as PNG — or cut out with the lasso — is transparent around
    its outline. Read as plain colour, those pixels are black, and the cleaning
    then reads the whole background as one uniform dark area and wipes the plan
    out: what came back was a blank white page. Compositing first keeps the
    drawing where it is.
    """
    if img is None:
        return None
    if img.ndim == 2:
        return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if img.shape[2] == 4:
        alpha = img[:, :, 3:4].astype(np.float32) / 255.0
        colour = img[:, :, :3].astype(np.float32)
        return (colour * alpha + 255.0 * (1.0 - alpha)).astype(np.uint8)
    return img


def load_plan_image(plan, dpi=200, use_active_background=True):
    target_file = None
    if use_active_background and plan.use_cleaned_background and plan.cleaned_background_file:
        target_file = plan.cleaned_background_file
    else:
        target_file = plan.background_file

    if not target_file or not target_file.name:
        return None, "Background file missing"

    target_path = target_file.path

    if plan.background_type == 'pdf' and not (use_active_background and plan.use_cleaned_background):
        doc = fitz.open(target_path)
        try:
            if doc.page_count == 0:
                return None, "PDF has no pages"

            page = doc.load_page(0)
            pix = page.get_pixmap(dpi=dpi)
            img_data = np.frombuffer(pix.samples, dtype=np.uint8).reshape((pix.h, pix.w, pix.n))

            if pix.n == 4:
                return cv2.cvtColor(img_data, cv2.COLOR_RGBA2BGR), None
            if pix.n == 3:
                return cv2.cvtColor(img_data, cv2.COLOR_RGB2BGR), None
            return img_data, None
        finally:
            doc.close()

    img = flatten_on_white(cv2.imread(target_path, cv2.IMREAD_UNCHANGED))
    if img is None:
        return None, "Failed to load image"
    return img, None

def create_cleaning_history(plan, image_bytes, prefix, cleaning_method, title, options=None):
    original_name = os.path.splitext(os.path.basename(plan.background_file.path))[0]
    filename = f"{prefix}_{original_name}.png"
    history = PlanCleaningHistory(
        plan=plan,
        user=plan.user,
        cleaning_method=cleaning_method,
        title=title,
        options=options or {},
    )
    history.image_file.save(filename, ContentFile(image_bytes), save=True)
    return history


def save_cleaned_overlay_bytes(
    overlay,
    image_bytes,
    prefix,
    cleaning_method,
    title,
    options=None,
    original_bytes=None,
    create_history=True,
):
    """Persist a cleaned secondary plan while preserving its first original."""
    image_array = np.frombuffer(image_bytes, dtype=np.uint8)
    if cv2.imdecode(image_array, cv2.IMREAD_COLOR) is None:
        return False

    if not overlay.original_image_file:
        source_bytes = original_bytes
        if not source_bytes and overlay.image_file:
            try:
                with overlay.image_file.open('rb') as source_file:
                    source_bytes = source_file.read()
            except OSError:
                source_bytes = None
        if source_bytes:
            overlay.original_image_file.save(
                f"original_overlay_{overlay.pk}.png",
                ContentFile(source_bytes),
                save=False,
            )

    overlay.image_file.save(
        f"{prefix}_overlay_{overlay.pk}.png",
        ContentFile(image_bytes),
        save=False,
    )
    overlay.is_original = False
    overlay.save()

    if create_history:
        history_options = dict(options or {})
        history_options.update({"target_kind": "overlay", "overlay_id": overlay.pk})
        create_cleaning_history(
            overlay.plan,
            image_bytes,
            f"{prefix}_overlay_{overlay.pk}",
            cleaning_method,
            title,
            history_options,
        )
    return True


def save_cleaned_plan(plan, image, prefix, cleaning_method=None, title=None, options=None):
    ret, buffer = cv2.imencode('.png', image)
    if not ret:
        return False

    original_name = os.path.splitext(os.path.basename(plan.background_file.path))[0]
    filename = f"{prefix}_{original_name}.png"
    image_bytes = buffer.tobytes()
    content = ContentFile(image_bytes)

    plan.cleaned_background_file.save(filename, content, save=False)
    plan.use_cleaned_background = True
    plan.save()
    if cleaning_method and title:
        create_cleaning_history(plan, image_bytes, prefix, cleaning_method, title, options)
    return True

def encode_image_to_png_bytes(image):
    ret, buffer = cv2.imencode('.png', image)
    if not ret:
        return None
    return buffer.tobytes()

def image_bytes_to_data_url(image_bytes):
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def normalize_plan_image_data(image_data):
    """Validate a browser image data URL and normalize it to a flat PNG."""
    if not image_data or not isinstance(image_data, str):
        return None, "Aucune image de plan secondaire n'a été fournie."
    if len(image_data) > MAX_IMAGE_DATA_LENGTH:
        return None, "L'image du plan secondaire est trop volumineuse."
    if not image_data.startswith('data:image/') or ';base64,' not in image_data:
        return None, "Image invalide : une data URL base64 est attendue."

    try:
        _, encoded = image_data.split(';base64,', 1)
        image_bytes = base64.b64decode(encoded, validate=True)
        valid, validation_error = validate_overlay_image_bytes(image_bytes)
        if not valid:
            return None, validation_error
        image_array = np.frombuffer(image_bytes, np.uint8)
        image = flatten_on_white(cv2.imdecode(image_array, cv2.IMREAD_UNCHANGED))
        if image is None:
            return None, "Le fichier du plan secondaire n'est pas une image valide."
        normalized_bytes = encode_image_to_png_bytes(image)
        if not normalized_bytes:
            return None, "Impossible de préparer l'image du plan secondaire."
        return normalized_bytes, None
    except (ValueError, binascii.Error, OSError):
        return None, "Impossible de décoder l'image du plan secondaire."


def save_cleaned_plan_bytes(plan, image_bytes, prefix, cleaning_method=None, title=None, options=None, create_history=True):
    image_array = np.frombuffer(image_bytes, dtype=np.uint8)
    if cv2.imdecode(image_array, cv2.IMREAD_COLOR) is None:
        return False

    original_name = os.path.splitext(os.path.basename(plan.background_file.path))[0]
    filename = f"{prefix}_{original_name}.png"
    content = ContentFile(image_bytes)
    plan.cleaned_background_file.save(filename, content, save=False)
    plan.use_cleaned_background = True
    plan.save()
    if create_history and cleaning_method and title:
        create_cleaning_history(plan, image_bytes, prefix, cleaning_method, title, options)
    return True

def clean_plan_image(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img

    norm_img = np.zeros((gray.shape[0], gray.shape[1]))
    gray = cv2.normalize(gray, norm_img, 0, 255, cv2.NORM_MINMAX)
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    thresh = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY, 15, 8
    )

    kernel = np.ones((2, 2), np.uint8)
    opening = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
    return cv2.morphologyEx(opening, cv2.MORPH_CLOSE, kernel)

def keep_wall_components(mask):
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    kept = np.zeros_like(mask)
    image_area = mask.shape[0] * mask.shape[1]
    min_area = max(90, int(image_area * 0.000035))
    min_long_side = max(18, int(min(mask.shape[:2]) * 0.012))

    for label in range(1, num_labels):
        x, y, width, height, area = stats[label]
        long_side = max(width, height)
        short_side = max(1, min(width, height))
        aspect_ratio = long_side / short_side

        if area >= min_area and (long_side >= min_long_side or aspect_ratio >= 5):
            kept[labels == label] = 255

    return kept

def clean_walls_image(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img

    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    contrasted = clahe.apply(gray)
    blurred = cv2.GaussianBlur(contrasted, (3, 3), 0)

    binary = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 35, 11
    )

    small_kernel = np.ones((2, 2), np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, small_kernel, iterations=1)

    height, width = binary.shape
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(15, width // 55), 1))
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(15, height // 55)))

    horizontal_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel, iterations=1)
    vertical_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vertical_kernel, iterations=1)
    line_mask = cv2.bitwise_or(horizontal_lines, vertical_lines)

    distance = cv2.distanceTransform(binary, cv2.DIST_L2, 3)
    thick_mask = np.zeros_like(binary)
    thick_mask[distance >= 1.8] = 255

    walls = cv2.bitwise_or(line_mask, thick_mask)
    walls = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8), iterations=2)
    walls = cv2.dilate(walls, np.ones((2, 2), np.uint8), iterations=1)
    walls = keep_wall_components(walls)
    walls = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8), iterations=1)

    cleaned = np.full_like(walls, 255)
    cleaned[walls > 0] = 0
    return cleaned


# ── Grok cleaning job lifecycle ─────────────────────────────────────────────

def serialize_grok_cleaning_job(job):
    """Public representation of a Grok cleaning job, for the polling endpoint."""
    data = {
        "job_id": job.id,
        "status": job.status,
        "preset": getattr(job, "preset", "evacuation"),
        "target_kind": getattr(job, "target_kind", "main"),
        "wall_color": getattr(job, "target_wall_color", "#000000"),
        "error_code": job.error_code or "",
        "error": job.error_message or "",
        "diagnostic": job.diagnostic or "",
    }
    if job.status == GrokCleaningJob.STATUS_COMPLETED:
        data.update({
            "analysis": job.analysis,
            "generation_prompt": job.generation_prompt,
            "model": job.model_used,
        })
        # The main image is already persisted on the plan, so returning both
        # multi-megabyte data URLs only makes the final poll slow (and can trip
        # proxy response limits). A secondary plan still needs its image in the
        # browser canvas, so only that target receives the generated data URL.
        if getattr(job, "target_kind", "main") == "overlay":
            data["after_image"] = job.after_image_data
    return data


def run_grok_cleaning_job(job_id):
    """Background worker: analyse + image generation, then auto-apply the result."""
    close_old_connections()
    job = None
    try:
        job = GrokCleaningJob.objects.select_related("plan", "user", "target_overlay").get(id=job_id)
        plan = job.plan
        user = job.user
        preset = getattr(job, "preset", "evacuation")
        target_kind = getattr(job, "target_kind", "main")
        target_overlay = job.target_overlay

        settings_obj = UserXaiSettings.objects.filter(user=user).first()
        if not settings_obj:
            job.mark_failed("XAI_KEY_MISSING", "Aucune clé API xAI enregistrée.", "missing_xai_settings")
            return
        api_key = settings_obj.get_api_key()

        if target_kind == "overlay":
            if target_overlay is None or target_overlay.plan_id != plan.id:
                job.mark_failed("INVALID_TARGET", "Le plan secondaire ciblé n'existe plus.", "overlay_missing")
                return
            original_bytes, error = normalize_plan_image_data(job.source_image_data)
            if error:
                job.mark_failed("IMAGE_SAVE_FAILED", error, "overlay_source_load_failed")
                return
        else:
            # 150 dpi keeps the analysis fast: the model downsamples to 2K anyway,
            # so a heavier source only inflates transfer + reasoning time.
            original_image, error = load_plan_image(plan, dpi=150, use_active_background=False)
            if error:
                job.mark_failed("IMAGE_SAVE_FAILED", error, "source_load_failed")
                return

            original_bytes = encode_image_to_png_bytes(original_image)
            if original_bytes is None:
                job.mark_failed("IMAGE_SAVE_FAILED", "Impossible de préparer le plan original.", "source_encode_failed")
                return

        before_image_data = image_bytes_to_data_url(original_bytes)
        job.before_image_data = before_image_data
        job.save(update_fields=["before_image_data", "updated_at"])

        job.mark_status(GrokCleaningJob.STATUS_ANALYZING)
        try:
            result = analyze_and_clean_plan(
                original_bytes,
                api_key,
                background_color=job.target_background_color or "#FFFFFF",
                wall_color=job.target_wall_color or "#000000",
                preset=preset,
                on_generation_started=lambda: job.mark_status(
                    GrokCleaningJob.STATUS_GENERATING
                ),
            )
        except (GrokCleaningError, MissingXaiApiKeyError) as exc:
            job.refresh_from_db(fields=["status"])
            if job.status != GrokCleaningJob.STATUS_FAILED:
                job.mark_failed(exc.error_code, exc.user_message, exc.diagnostic)
            return
        except Exception as exc:
            logger.exception("grok_clean.job.unexpected_failed",
                             extra={"job_id": job.id, "user_id": user.id, "plan_id": plan.id})
            job.mark_failed("GROK_FAILED", "Erreur pendant le nettoyage avec l'IA.", exc.__class__.__name__)
            return

        job.refresh_from_db()
        if job.status == GrokCleaningJob.STATUS_FAILED:
            return

        # Test doubles and older pipeline implementations may not invoke the
        # progress callback; keep the lifecycle valid in that case.
        if job.status != GrokCleaningJob.STATUS_GENERATING:
            job.mark_status(GrokCleaningJob.STATUS_GENERATING)

        after_image_data = image_bytes_to_data_url(result.cleaned_image_bytes)
        if not result.cleaned_image_bytes or not after_image_data:
            job.mark_failed("IMAGE_SAVE_FAILED", "Image nettoyée vide.", "empty_cleaned_image")
            return

        # The polling endpoint may have expired a genuinely stalled request.
        # Never apply a late response after the job has become terminal.
        job.refresh_from_db(fields=["status"])
        if job.status == GrokCleaningJob.STATUS_FAILED:
            return

        # Main-plan results are persisted immediately. A secondary plan still
        # belongs to the browser canvas, so its result is returned through the
        # job and the editor replaces only that overlay image.
        history_profiles = {
            "evacuation": (
                PlanCleaningHistory.METHOD_GROK,
                "Base architecturale extraite par l'IA (Grok)",
                "grok_cleaned",
            ),
            "autocad": (
                PlanCleaningHistory.METHOD_GROK_AUTOCAD,
                "Base architecturale AutoCAD extraite par l'IA (Grok)",
                "grok_autocad",
            ),
            "sketch": (
                PlanCleaningHistory.METHOD_GROK_SKETCH,
                "Croquis transformé en plan architectural par l'IA (Grok)",
                "grok_sketch",
            ),
        }
        history_method, history_title, output_prefix = history_profiles.get(
            preset,
            history_profiles["evacuation"],
        )

        if target_kind == "main":
            if not save_cleaned_plan_bytes(
                plan,
                result.cleaned_image_bytes,
                output_prefix,
                history_method,
                history_title,
                options={
                    "preset": preset,
                    "analysis_model": result.analysis_model,
                    "image_model": result.image_model,
                    "target_background_color": job.target_background_color or "#FFFFFF",
                    "target_wall_color": job.target_wall_color or "#000000",
                },
            ):
                job.mark_failed("IMAGE_SAVE_FAILED", "Impossible d'enregistrer l'image nettoyée.", "save_failed")
                return
        elif not save_cleaned_overlay_bytes(
            target_overlay,
            result.cleaned_image_bytes,
            output_prefix,
            history_method,
            history_title,
            options={
                "preset": preset,
                "analysis_model": result.analysis_model,
                "image_model": result.image_model,
                "target_background_color": job.target_background_color or "#FFFFFF",
                "target_wall_color": job.target_wall_color or "#000000",
            },
            original_bytes=original_bytes,
        ):
            job.mark_failed("IMAGE_SAVE_FAILED", "Impossible d'enregistrer le plan secondaire nettoyé.", "overlay_save_failed")
            return

        # "completed" only flips after the image exists, so a client polling the
        # job can never see a finished job without its result.
        job.status = GrokCleaningJob.STATUS_COMPLETED
        job.after_image_data = after_image_data
        job.analysis = result.analysis
        job.generation_prompt = result.generation_prompt
        job.model_used = result.image_model
        job.error_code = ""
        job.error_message = ""
        job.diagnostic = ""
        job.source_image_data = ""
        job.save(update_fields=[
            "status",
            "after_image_data",
            "analysis",
            "generation_prompt",
            "model_used",
            "error_code",
            "error_message",
            "diagnostic",
            "source_image_data",
            "updated_at",
        ])
    except Exception as exc:
        logger.exception("grok_clean.job.worker_crashed", extra={"job_id": job_id})
        if job is not None:
            try:
                job.refresh_from_db(fields=["status"])
                if job.status not in {
                    GrokCleaningJob.STATUS_COMPLETED,
                    GrokCleaningJob.STATUS_FAILED,
                }:
                    job.mark_failed(
                        "GROK_FAILED",
                        "Erreur pendant le nettoyage avec l'IA.",
                        f"worker_crashed:{exc.__class__.__name__}",
                    )
            except Exception:
                logger.exception("grok_clean.job.failure_persist_failed", extra={"job_id": job_id})
    finally:
        close_old_connections()


class RegisterView(generics.CreateAPIView):
    queryset = User.objects.all()
    permission_classes = [permissions.AllowAny]
    serializer_class = UserRegistrationSerializer

    def create(self, request, *args, **kwargs):
        if not settings.PUBLIC_REGISTRATION_ENABLED:
            return Response(
                {
                    "detail": (
                        "L'inscription publique est temporairement désactivée. "
                        "Demandez un accès à l'administrateur de votre entreprise."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().create(request, *args, **kwargs)

class CurrentUserView(generics.RetrieveAPIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        return set_media_session_cookie(response, request.user)


# ── xAI API key management ──────────────────────────────────────────────────

class UserXaiSettingsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        settings_obj = UserXaiSettings.objects.filter(user=request.user).first()
        if not settings_obj:
            return Response({
                "has_api_key": False,
                "created_at": None,
                "updated_at": None,
            }, status=status.HTTP_200_OK)

        serializer = UserXaiSettingsSerializer(settings_obj)
        return Response(serializer.data, status=status.HTTP_200_OK)


class SaveUserXaiSettingsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = SaveUserXaiSettingsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        settings_obj, _ = UserXaiSettings.objects.get_or_create(user=request.user)
        settings_obj.set_api_key(serializer.validated_data["api_key"])
        settings_obj.save()

        response_serializer = UserXaiSettingsSerializer(settings_obj)
        return Response(response_serializer.data, status=status.HTTP_200_OK)


class DeleteUserXaiSettingsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request):
        UserXaiSettings.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class TestXaiKeyView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = TestXaiKeySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        api_key = serializer.validated_data.get("api_key", "").strip()

        if not api_key:
            settings_obj = UserXaiSettings.objects.filter(user=request.user).first()
            if not settings_obj:
                return Response({"result": "invalide"}, status=status.HTTP_200_OK)
            api_key = settings_obj.get_api_key()

        # A minimal Grok chat call is the most direct way to confirm the key is
        # accepted by xAI. We send a tiny prompt so the request is cheap.
        error_detail = None
        try:
            from xai_sdk import Client
            from xai_sdk.chat import user

            client = Client(api_key=api_key, timeout=_get_request_timeout())
            chat = client.chat.create(model="grok-4.5")
            chat.append(user("Reply with the single word: ok"))
            chat.sample()
            result = "valide"
        except Exception as exc:
            if _looks_like_grpc_error(exc):
                code = None
                try:
                    code = exc.code()  # type: ignore[attr-defined]
                except Exception:  # pragma: no cover - defensive
                    pass
                code_name = getattr(code, "name", str(code)) if code is not None else "UNKNOWN"
                details = getattr(exc, "details", lambda: str(exc))()
                logger.warning("xai_test_key.failed code=%s details=%s", code_name, details,
                               extra={"user_id": request.user.id})
                if code_name in ("UNAUTHENTICATED", "PERMISSION_DENIED"):
                    result = "invalide"
                    error_detail = "Clé API refusée par xAI (non autorisée)."
                elif code_name in ("UNAVAILABLE", "DEADLINE_EXCEEDED"):
                    result = "invalide"
                    error_detail = "Serveurs xAI temporairement inaccessibles ou problème de connexion/DNS."
                else:
                    result = "invalide"
                    error_detail = f"Erreur xAI ({code_name})"
            else:
                logger.warning("xai_test_key.failed class=%s: %s", exc.__class__.__name__, exc,
                               extra={"user_id": request.user.id})
                result = "invalide"
                error_detail = str(exc)

        payload = {"result": result}
        if error_detail:
            payload["detail"] = error_detail
        return Response(payload, status=status.HTTP_200_OK)


def _looks_like_grpc_error(exc: Exception) -> bool:
    if exc.__class__.__module__.startswith("grpc"):
        return True
    return hasattr(exc, "code") and hasattr(exc, "details")


class WorkspaceEditPermission(permissions.BasePermission):
    """Read for any member of the workspace, writes for editors and the owner."""

    message = "Vous n'avez qu'un accès en lecture à cette liste de plans."

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        if isinstance(obj, PlanFolder):
            return obj.user_id in accessible_plan_owner_ids(request.user, editable_only=True)
        plan = obj if isinstance(obj, EvacuationPlan) else getattr(obj, 'plan', None)
        if plan is None:
            return True
        return user_can_edit_plan(request.user, plan)


class PlanFolderViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated, WorkspaceEditPermission]
    serializer_class = PlanFolderSerializer

    def get_queryset(self):
        return PlanFolder.objects.filter(
            user_id__in=accessible_plan_owner_ids(self.request.user)
        ).select_related('user')

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class EvacuationPlanViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated, WorkspaceEditPermission]
    serializer_class = EvacuationPlanSerializer

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        if (
            200 <= response.status_code < 400
            and request.user
            and request.user.is_authenticated
        ):
            return set_media_session_cookie(response, request.user)
        return response

    def get_queryset(self):
        # Only the owner and explicitly invited workspace members may reach a
        # plan. `restrict_plans_to` keeps that decision in one place.
        queryset = restrict_plans_to(
            EvacuationPlan.objects.select_related('folder'),
            self.request.user,
        )
        if self.action == 'list':
            archived = str(self.request.query_params.get('archived', '')).lower()
            return queryset.filter(
                archived_at__isnull=archived not in {'1', 'true', 'yes'},
            )
        if self.action in {
            'restore_archived', 'project_export', 'project_integrity',
            'project_revisions', 'restore_project_snapshot',
        }:
            return queryset
        return queryset.filter(archived_at__isnull=True)

    def perform_create(self, serializer):
        # A new plan always lands in the creator's own list, never in a list
        # they merely have access to. Multipart forms treat a missing checkbox
        # as False, so explicitly show the newly imported main plan instead of
        # relying on the model's True default.
        plan = serializer.save(user=self.request.user, main_plan_visible=True)
        updates = []
        if not plan.plan_number:
            plan.plan_number = automatic_plan_number(plan.pk)
            updates.append('plan_number')
        if not plan.revision_index:
            plan.revision_index = 'A'
            updates.append('revision_index')
        if updates:
            plan.save(update_fields=updates)
        capture_project_revision(
            plan,
            actor=self.request.user,
            reason=PlanProjectRevision.REASON_BOOTSTRAP,
        )

    def perform_update(self, serializer):
        plan = serializer.save()
        sources, allowed_paths = project_pictogram_capture_inputs(self.request)
        capture_project_revision(
            plan,
            actor=self.request.user,
            pictogram_sources=sources,
            allowed_media_paths=allowed_paths,
        )

    def destroy(self, request, *args, **kwargs):
        """Archive a project; normal application flows never destroy its data."""
        plan = self.get_object()
        with transaction.atomic():
            plan.archived_at = timezone.now()
            plan.save(update_fields=['archived_at', 'updated_at'])
            capture_project_revision(
                plan,
                actor=request.user,
                reason=PlanProjectRevision.REASON_ARCHIVE,
            )
        audit.warning(
            "plan.archived plan_id=%s owner_id=%s actor_id=%s",
            plan.pk, plan.user_id, request.user.id,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='restore-archived')
    def restore_archived(self, request, pk=None):
        plan = self.get_object()
        if plan.archived_at is not None:
            plan.archived_at = None
            plan.save(update_fields=['archived_at', 'updated_at'])
            sources, allowed_paths = project_pictogram_capture_inputs(request)
            capture_project_revision(
                plan,
                actor=request.user,
                reason=PlanProjectRevision.REASON_RESTORE,
                pictogram_sources=sources,
                allowed_media_paths=allowed_paths,
            )
        return Response(self.get_serializer(plan).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='project-snapshot')
    def project_snapshot(self, request, pk=None):
        plan = self.get_object()
        sources, allowed_paths = project_pictogram_capture_inputs(request)
        revision = capture_project_revision(
            plan,
            actor=request.user,
            pictogram_sources=sources,
            allowed_media_paths=allowed_paths,
        )
        return Response(
            PlanProjectRevisionSerializer(revision).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['get'], url_path='project-integrity')
    def project_integrity(self, request, pk=None):
        return Response(verify_project_integrity(self.get_object()))

    @action(detail=True, methods=['get'], url_path='project-revisions')
    def project_revisions(self, request, pk=None):
        revisions = self.get_object().project_revisions.select_related('created_by')
        return Response(PlanProjectRevisionSerializer(revisions, many=True).data)

    @action(
        detail=True,
        methods=['post'],
        url_path=r'project-revisions/(?P<revision_number>[0-9]+)/restore',
    )
    def restore_project_snapshot(self, request, pk=None, revision_number=None):
        plan = self.get_object()
        revision = plan.project_revisions.filter(revision_number=revision_number).first()
        if revision is None:
            return Response(
                {'detail': "Cette révision n’existe pas."},
                status=status.HTTP_404_NOT_FOUND,
            )
        try:
            restored = restore_project_revision(plan, revision, actor=request.user)
        except ProjectArchiveError as error:
            return Response({'detail': str(error)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(PlanProjectRevisionSerializer(restored).data)

    @action(detail=True, methods=['get'], url_path='project-export')
    def project_export(self, request, pk=None):
        plan = self.get_object()
        output = build_project_zip(plan)
        safe_title = re.sub(r'[^A-Za-z0-9._-]+', '-', plan.title).strip('-') or 'projet'
        return FileResponse(
            output,
            as_attachment=True,
            filename=f'{safe_title}.evacstudio.zip',
            content_type='application/zip',
        )

    @action(
        detail=False,
        methods=['post'],
        url_path='project-import',
        throttle_classes=[UploadRateThrottle],
    )
    def project_import(self, request):
        serializer = ProjectImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            plan = import_project_zip(
                serializer.validated_data['archive'],
                owner=request.user,
                title=serializer.validated_data.get('title', ''),
            )
        except ProjectArchiveError as error:
            return Response({'detail': str(error)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(plan).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='duplicate')
    def duplicate(self, request, pk=None):
        """Create a fully independent copy of a plan in the caller's workspace."""
        source_plan = self.get_object()
        duplicate_options = DuplicatePlanSerializer(data=request.data)
        duplicate_options.is_valid(raise_exception=True)
        requested_title = duplicate_options.validated_data.get('title')

        def available_copy_title():
            number = 1
            while True:
                suffix = " (copie)" if number == 1 else f" (copie {number})"
                base = source_plan.title[:max(1, 255 - len(suffix))].rstrip()
                candidate = f"{base}{suffix}"
                if not EvacuationPlan.objects.filter(user=request.user, title=candidate).exists():
                    return candidate
                number += 1

        created_files = []
        pictogram_sources, allowed_media_paths = project_pictogram_capture_inputs(request)

        def remember_file(field_file):
            if field_file and field_file.name:
                created_files.append((field_file.storage, field_file.name))

        try:
            with transaction.atomic():
                capture_project_revision(
                    source_plan,
                    actor=request.user,
                    pictogram_sources=pictogram_sources,
                    allowed_media_paths=allowed_media_paths,
                )
                plan_values = clone_model_values(source_plan, {
                    'id', 'user', 'folder', 'title', 'background_file', 'cleaned_background_file',
                    'plan_situation_background_file', 'project_uuid', 'archived_at',
                    'plan_number', 'revision_index',
                    'created_at', 'updated_at',
                })
                duplicated_plan = EvacuationPlan(
                    user=request.user,
                    folder=source_plan.folder if source_plan.user_id == request.user.id else None,
                    title=requested_title or available_copy_title(),
                    **plan_values,
                )
                duplicated_plan.background_file = clone_stored_file(source_plan.background_file)
                duplicated_plan.cleaned_background_file = clone_stored_file(
                    source_plan.cleaned_background_file
                )
                duplicated_plan.plan_situation_background_file = clone_stored_file(
                    source_plan.plan_situation_background_file
                )
                duplicated_plan.save()
                duplicated_plan.plan_number = automatic_plan_number(duplicated_plan.pk)
                duplicated_plan.save(update_fields=['plan_number'])
                remember_file(duplicated_plan.background_file)
                remember_file(duplicated_plan.cleaned_background_file)
                remember_file(duplicated_plan.plan_situation_background_file)

                for model, related_rows in (
                    (PlanIcon, source_plan.icons.all()),
                    (PlanShape, source_plan.shapes.all()),
                    (PlanText, source_plan.texts.all()),
                ):
                    model.objects.bulk_create([
                        model(
                            plan=duplicated_plan,
                            **clone_model_values(row, {
                                'id', 'plan', 'created_at', 'updated_at',
                            }),
                        )
                        for row in related_rows
                    ])

                for overlay in source_plan.overlays.all():
                    duplicated_overlay = PlanOverlay(
                        plan=duplicated_plan,
                        **clone_model_values(overlay, {
                            'id', 'plan', 'image_file', 'original_image_file',
                            'created_at', 'updated_at',
                        }),
                    )
                    duplicated_overlay.image_file = clone_stored_file(overlay.image_file)
                    duplicated_overlay.original_image_file = clone_stored_file(
                        overlay.original_image_file
                    )
                    duplicated_overlay.save()
                    remember_file(duplicated_overlay.image_file)
                    remember_file(duplicated_overlay.original_image_file)

                for history in source_plan.cleaning_history.all():
                    duplicated_history = PlanCleaningHistory(
                        plan=duplicated_plan,
                        user=request.user,
                        **clone_model_values(history, {
                            'id', 'plan', 'user', 'image_file', 'created_at',
                        }),
                    )
                    duplicated_history.image_file = clone_stored_file(history.image_file)
                    duplicated_history.save()
                    remember_file(duplicated_history.image_file)

                clone_project_resources(
                    source_plan,
                    duplicated_plan,
                    actor=request.user,
                )
        except Exception:
            # SQL rollback does not remove files already written to storage.
            for storage, name in reversed(created_files):
                if name and storage.exists(name):
                    storage.delete(name)
            raise

        return Response(
            self.get_serializer(duplicated_plan).data,
            status=status.HTTP_201_CREATED,
        )

    @action(
        detail=True,
        methods=['post', 'delete'],
        url_path='situation-background',
        throttle_classes=[UploadRateThrottle],
    )
    def situation_background(self, request, pk=None):
        """Store or remove the inset background independently from the main plan."""
        plan = self.get_object()
        field = plan._meta.get_field('plan_situation_background_file')
        storage = field.storage
        old_name = plan.plan_situation_background_file.name or ''

        if request.method == 'DELETE':
            sources, allowed_paths = project_pictogram_capture_inputs(request)
            capture_project_revision(
                plan,
                actor=request.user,
                pictogram_sources=sources,
                allowed_media_paths=allowed_paths,
            )
            plan.plan_situation_background_file = None
            plan.save(update_fields=['plan_situation_background_file', 'updated_at'])
            capture_project_revision(
                plan,
                actor=request.user,
                pictogram_sources=sources,
                allowed_media_paths=allowed_paths,
            )
            if old_name:
                transaction.on_commit(
                    lambda name=old_name: storage.delete(name) if storage.exists(name) else None
                )
            return Response(self.get_serializer(plan).data)

        upload = request.FILES.get('file')
        extension = os.path.splitext(getattr(upload, 'name', '') or '')[1].lower()
        if extension not in {'.png', '.jpg', '.jpeg', '.svg'}:
            return Response(
                {'file': 'Formats acceptés : PNG, JPG, JPEG ou SVG.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            detected_type = validate_background_upload(upload)
            if detected_type != 'image':
                raise UploadRejected('Le fond du plan de situation doit être une image.')
        except UploadRejected as rejected:
            return Response({'file': str(rejected)}, status=status.HTTP_400_BAD_REQUEST)

        upload.name = safe_upload_name(upload.name, fallback='plan-situation')
        new_name = ''
        try:
            plan.plan_situation_background_file.save(upload.name, upload, save=False)
            new_name = plan.plan_situation_background_file.name
            plan.save(update_fields=['plan_situation_background_file', 'updated_at'])
        except Exception:
            if new_name and storage.exists(new_name):
                storage.delete(new_name)
            raise
        if old_name and old_name != new_name:
            transaction.on_commit(
                lambda name=old_name: storage.delete(name) if storage.exists(name) else None
            )
        sources, allowed_paths = project_pictogram_capture_inputs(request)
        capture_project_revision(
            plan,
            actor=request.user,
            pictogram_sources=sources,
            allowed_media_paths=allowed_paths,
        )
        return Response(self.get_serializer(plan).data)

    @action(detail=False, methods=['get', 'put'], url_path='sheet-templates')
    def sheet_templates(self, request):
        """Read or replace the authenticated user's reusable sheet layouts."""
        can_edit_defaults = user_can_edit_default_templates(request.user)
        owner_ids = accessible_library_owner_ids(request.user)
        visible_versions = SheetTemplateVersion.objects.filter(user_id__in=owner_ids)
        if not can_edit_defaults:
            visible_versions = visible_versions.filter(
                Q(version_id__startswith='custom:')
                | Q(version_id__startswith='baseline:')
            )

        if request.method == 'GET':
            deduped = {}
            for v in visible_versions.order_by('source_updated_at', 'updated_at'):
                if v.version_id not in deduped or v.user_id == request.user.id:
                    deduped[v.version_id] = v
            return Response(SheetTemplateVersionSerializer(list(deduped.values()), many=True).data)

        serializer = SheetTemplateSyncSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        submitted = serializer.validated_data['versions']
        protected_versions = [
            version for version in submitted
            if not version['version_id'].startswith(('custom:', 'baseline:'))
        ]
        if protected_versions and not can_edit_defaults:
            return Response(
                {
                    'detail': (
                        "La modification des templates par défaut doit être autorisée "
                        "par un administrateur. Clonez le template pour créer une copie personnelle."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        version_ids = [version['version_id'] for version in submitted]

        with transaction.atomic():
            versions_to_replace = SheetTemplateVersion.objects.filter(user=request.user)
            if not can_edit_defaults:
                versions_to_replace = versions_to_replace.filter(
                    Q(version_id__startswith='custom:')
                    | Q(version_id__startswith='baseline:')
                )
            versions_to_delete = list(versions_to_replace.exclude(version_id__in=version_ids))
            freeze_template_versions_for_projects(request, versions_to_delete)
            for version in submitted:
                version_id = version.pop('version_id')
                SheetTemplateVersion.objects.update_or_create(
                    user=request.user,
                    version_id=version_id,
                    defaults=version,
                )
            SheetTemplateVersion.objects.filter(
                pk__in=[version.pk for version in versions_to_delete]
            ).delete()

        versions = SheetTemplateVersion.objects.filter(user=request.user)
        if not can_edit_defaults:
            versions = versions.filter(
                Q(version_id__startswith='custom:')
                | Q(version_id__startswith='baseline:')
            )
        return Response(SheetTemplateVersionSerializer(versions, many=True).data)

    @action(detail=False, methods=['get'], url_path='sheet-template-permissions')
    def sheet_template_permissions(self, request):
        """Tell the editor whether Django admin unlocked built-in templates."""

        return Response({
            'can_edit_default_templates': user_can_edit_default_templates(request.user),
        })

    @action(detail=False, methods=['post'], url_path='publish-default')
    def publish_default(self, request):
        """Publish an edited template as the official built-in default for all users."""
        if not user_can_edit_default_templates(request.user):
            return Response(
                {'detail': "Seul un administrateur autorisé peut modifier les templates par défaut officiels."},
                status=status.HTTP_403_FORBIDDEN,
            )

        template_key = request.data.get('template')
        blocks = request.data.get('blocks')
        plan_placement = request.data.get('planPlacement', {})

        if not template_key or not isinstance(blocks, list):
            return Response(
                {'detail': "Paramètres template et blocks requis."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        states_path = os.path.join(
            os.path.dirname(settings.BASE_DIR),
            'frontend',
            'src',
            'lib',
            'finalSheetTemplateStates.json',
        )
        if not os.path.exists(states_path):
            return Response(
                {'detail': "Fichier finalSheetTemplateStates.json introuvable."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        try:
            with open(states_path, 'r', encoding='utf-8') as f:
                states_data = json.load(f)

            if 'templates' not in states_data:
                states_data['templates'] = {}

            states_data['templates'][template_key] = {
                'blocks': blocks,
                'planPlacement': plan_placement,
            }

            with open(states_path, 'w', encoding='utf-8') as f:
                json.dump(states_data, f, indent=2, ensure_ascii=False)
                f.write('\n')

            now = timezone.now()
            baseline_id = f"baseline-builtin:{template_key}"
            SheetTemplateVersion.objects.filter(version_id=baseline_id).update(
                blocks=blocks,
                plan_placement=plan_placement,
                source_updated_at=now,
            )

            # Also update the user's active baseline/draft so it matches the published default
            SheetTemplateVersion.objects.update_or_create(
                user=request.user,
                version_id=baseline_id,
                defaults={
                    'template_key': template_key,
                    'name': f"{template_key} — design par défaut",
                    'blocks': blocks,
                    'plan_placement': plan_placement,
                    'source_created_at': now,
                    'source_updated_at': now,
                },
            )

            return Response({
                'success': True,
                'message': f"Le template {template_key} a été enregistré comme template officiel par défaut pour tous les utilisateurs.",
                'template': template_key,
            })
        except Exception as e:
            return Response(
                {'detail': f"Erreur lors de l'enregistrement du template par défaut: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(
        detail=False,
        methods=['get', 'post', 'delete'],
        url_path='sheet-template-assets',
        throttle_classes=[UploadRateThrottle],
    )
    def sheet_template_assets(self, request):
        """Store rasterized PDF pages used by personal sheet templates."""

        visible_assets = SheetTemplateAsset.objects.filter(
            user_id__in=accessible_library_owner_ids(request.user)
        )
        own_assets = SheetTemplateAsset.objects.filter(user=request.user)
        if request.method == 'GET':
            return Response(
                SheetTemplateAssetSerializer(
                    visible_assets,
                    many=True,
                    context={'request': request},
                ).data
            )

        if request.method == 'DELETE':
            asset_id = request.query_params.get('id', '')
            try:
                asset = own_assets.get(asset_id=asset_id)
            except (SheetTemplateAsset.DoesNotExist, ValueError):
                return Response(
                    {'detail': "Le fond de template est introuvable."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            asset_key = str(asset.asset_id)

            def uses_asset(value):
                if isinstance(value, dict):
                    return value.get('assetId') == asset_key or any(
                        uses_asset(child) for child in value.values()
                    )
                if isinstance(value, list):
                    return any(uses_asset(child) for child in value)
                return False

            affected_versions = [
                version for version in SheetTemplateVersion.objects.filter(user=request.user)
                if uses_asset(version.blocks)
            ]
            freeze_template_versions_for_projects(request, affected_versions)
            asset.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        upload = request.FILES.get('file')
        if upload is None:
            return Response(
                {'detail': "Aucune page de template n’a été fournie."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if getattr(upload, 'size', 0) > 8 * 1024 * 1024:
            return Response(
                {'detail': "La page de template dépasse la taille maximale de 8 Mo."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        extension = os.path.splitext(upload.name or '')[1].lower()
        if extension not in {'.png', '.jpg', '.jpeg', '.webp'}:
            return Response(
                {'detail': "La page doit être une image PNG, JPEG ou WebP."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            detected_type = validate_background_upload(upload)
            upload.seek(0)
            with Image.open(upload) as image:
                width, height = image.size
            upload.seek(0)
        except UploadRejected as rejected:
            return Response({'detail': str(rejected)}, status=status.HTTP_400_BAD_REQUEST)
        except (UnidentifiedImageError, OSError, ValueError):
            return Response(
                {'detail': "La page de template est illisible."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if detected_type != 'image':
            return Response(
                {'detail': "La page de template doit être une image."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        name = str(request.data.get('name') or upload.name or 'Template PDF').strip()[:255]
        upload.name = safe_upload_name(upload.name, fallback='template-pdf')
        asset = SheetTemplateAsset.objects.create(
            user=request.user,
            name=name or 'Template PDF',
            image_file=upload,
            width=width,
            height=height,
        )
        return Response(
            SheetTemplateAssetSerializer(asset, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=['get', 'post', 'patch', 'delete'], url_path='pictograms')
    def pictograms(self, request):
        if request.method == 'GET':
            return Response(list_plan_pictograms(request), status=status.HTTP_200_OK)

        if request.method == 'PATCH':
            requested_filename = str(request.data.get('file_name', '') or '')
            directory, root, stored_filename = resolve_user_pictogram_file(request, requested_filename)
            new_name = normalize_pictogram_name(request.data.get('name'))
            if not requested_filename or not new_name:
                return Response(
                    {"error": "Le fichier ou le nouveau nom du SVG est invalide."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if not directory or not root or not stored_filename:
                return Response(
                    {"error": "Ce pictogramme SVG personnalisé n'existe pas."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            old_name = os.path.splitext(stored_filename)[0]
            new_filename = f'{new_name}.svg'
            if new_filename == stored_filename:
                return Response(
                    serialize_user_pictogram(
                        request,
                        directory,
                        stored_filename,
                        deletable=True,
                    ),
                    status=status.HTTP_200_OK,
                )

            source_media_path = f'{directory}/{stored_filename}'
            name_already_exists = (
                registered_catalogue_contains_name(new_name)
                or user_pictogram_name_exists(
                    accessible_library_owner_ids(request.user),
                    new_name,
                    excluded_media_path=source_media_path,
                )
            )
            if name_already_exists:
                return Response(
                    {"error": "Un pictogramme portant ce nom existe déjà."},
                    status=status.HTTP_409_CONFLICT,
                )

            source_path = os.path.join(root, stored_filename)
            target_path = os.path.join(root, new_filename)
            file_was_renamed = False
            target_owner_id = user_pictogram_owner_id(directory)
            editable_owner_ids = [target_owner_id] if target_owner_id else accessible_plan_owner_ids(request.user, editable_only=True)
            try:
                os.rename(source_path, target_path)
                file_was_renamed = True
                with transaction.atomic():
                    PlanIcon.objects.filter(
                        plan__user_id__in=editable_owner_ids,
                        icon_type=old_name,
                    ).update(icon_type=new_name)
            except Exception:
                if file_was_renamed and os.path.exists(target_path) and not os.path.exists(source_path):
                    try:
                        os.rename(target_path, source_path)
                    except OSError:
                        logger.exception("pictogram_rename.rollback_failed")
                logger.exception("pictogram_rename.failed", extra={"user_id": request.user.id})
                return Response(
                    {"error": "Le pictogramme n'a pas pu être renommé."},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

            return Response(
                serialize_user_pictogram(
                    request,
                    directory,
                    new_filename,
                    deletable=True,
                ),
                status=status.HTTP_200_OK,
            )

        if request.method == 'DELETE':
            requested_filename = request.query_params.get('file_name', '')
            directory, root, stored_filename = resolve_user_pictogram_file(request, requested_filename)
            if not requested_filename:
                return Response(
                    {"error": "Le nom du fichier SVG à supprimer est invalide."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if not directory or not root or not stored_filename:
                return Response(
                    {"error": "Ce pictogramme SVG personnalisé n'existe pas."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            icon_type = os.path.splitext(stored_filename)[0]
            target_owner_id = user_pictogram_owner_id(directory)
            owner_ids_to_check = [target_owner_id] if target_owner_id else accessible_plan_owner_ids(request.user)
            affected_plans = EvacuationPlan.objects.filter(
                user_id__in=owner_ids_to_check,
                icons__icon_type=icon_type,
            ).distinct()

            # The reusable library item may be deleted only after every using
            # project owns an immutable copy of its bytes.
            if affected_plans.exists():
                sources, allowed_paths = project_pictogram_capture_inputs(request)
                try:
                    with transaction.atomic():
                        for affected_plan in affected_plans:
                            capture_project_revision(
                                affected_plan,
                                actor=request.user,
                                pictogram_sources=sources,
                                allowed_media_paths=allowed_paths,
                            )
                except (OSError, ProjectArchiveError):
                    logger.exception(
                        "pictogram_delete.snapshot_failed",
                        extra={"user_id": request.user.id, "file": stored_filename},
                    )
                    return Response(
                        {"error": "Le pictogramme n’a pas été supprimé car sa copie de sécurité a échoué."},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    )

            target_path = os.path.join(root, stored_filename)
            if not os.path.isfile(target_path):
                return Response(
                    {"error": "Ce pictogramme SVG personnalisé n'existe pas."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            try:
                os.remove(target_path)
            except OSError:
                logger.exception("pictogram_delete.failed", extra={"user_id": request.user.id})
                audit.warning(
                    "pictogram.delete_failed user_id=%s file=%s",
                    request.user.id, stored_filename,
                )
                return Response(
                    {"error": "Le pictogramme n'a pas pu être supprimé."},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )
            audit.warning(
                "pictogram.deleted user_id=%s file=%s", request.user.id, stored_filename
            )
            return Response(status=status.HTTP_204_NO_CONTENT)

        upload = request.FILES.get('file')
        raw_svg = request.data.get('svg')
        raw_name = request.data.get('name') or getattr(upload, 'name', '')
        name = normalize_pictogram_name(raw_name)
        if not name:
            return Response(
                {"error": "Indiquez un nom pour le pictogramme."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        requested_standard = str(request.data.get('standard') or '')
        requested_category = str(request.data.get('category') or '')
        if requested_standard or requested_category:
            destination_metadata = selected_catalogue_metadata(
                requested_standard,
                requested_category,
            )
            if destination_metadata is None:
                return Response(
                    {"error": "La norme ou la catégorie de destination est invalide."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            custom_directory = user_pictogram_directory(
                request.user.id,
                requested_standard,
                requested_category,
            )
        else:
            destination_metadata = flat_pictogram_metadata(
                user_pictogram_directory(request.user.id)
            )
            custom_directory = user_pictogram_directory(request.user.id)
        custom_root = os.path.join(settings.MEDIA_ROOT, custom_directory)

        if upload is not None:
            if not upload.name.lower().endswith('.svg'):
                return Response(
                    {"error": "Seuls les fichiers .svg sont acceptés."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if upload.size > MAX_PICTOGRAM_SVG_BYTES:
                return Response(
                    {"error": "Le SVG dépasse la taille maximale de 250 Ko."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            svg_bytes = upload.read(MAX_PICTOGRAM_SVG_BYTES + 1)
        elif isinstance(raw_svg, str):
            svg_bytes = raw_svg.encode('utf-8')
        else:
            return Response(
                {"error": "Ajoutez un fichier SVG ou collez son code."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        sanitized_svg, validation_error = validate_and_sanitize_pictogram_svg(svg_bytes)
        if validation_error:
            return Response(
                {"error": validation_error},
                status=status.HTTP_400_BAD_REQUEST,
            )

        directory, root = custom_directory, custom_root
        os.makedirs(root, exist_ok=True)
        filename = f'{name}.svg'
        name_already_exists = (
            registered_catalogue_contains_name(name)
            or user_pictogram_name_exists(
                accessible_library_owner_ids(request.user),
                name,
            )
        )
        if name_already_exists:
            return Response(
                {"error": "Un pictogramme portant ce nom existe déjà."},
                status=status.HTTP_409_CONFLICT,
            )

        target_path = os.path.join(root, filename)
        try:
            with open(target_path, 'xb') as svg_file:
                svg_file.write(sanitized_svg)
        except FileExistsError:
            return Response(
                {"error": "Un pictogramme portant ce nom existe déjà."},
                status=status.HTTP_409_CONFLICT,
            )
        except OSError:
            logger.exception("pictogram_upload.failed", extra={"user_id": request.user.id})
            return Response(
                {"error": "Le pictogramme n'a pas pu être enregistré."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            serialize_plan_pictogram(
                request,
                directory,
                filename,
                deletable=True,
                **destination_metadata,
            ),
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=['get', 'post', 'patch', 'delete'], url_path='pictogram-labels')
    def pictogram_labels(self, request):
        if request.method == 'GET':
            labels = UserPictogramLabel.objects.filter(user=request.user)
            return Response(
                [
                    {
                        'icon_type': item.icon_type,
                        'label': item.label,
                        'scope': 'plan' if item.plan_id else 'all',
                        'plan_id': item.plan_id,
                    }
                    for item in labels
                ],
                status=status.HTTP_200_OK,
            )

        scope = str(
            request.data.get('scope', 'plan')
            if request.method != 'DELETE'
            else request.query_params.get('scope', 'plan')
        ).strip()
        if scope not in {'plan', 'all'}:
            return Response(
                {'error': "La portée du nom personnalisé est invalide."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        plan = None
        if scope == 'plan':
            plan_id = (
                request.data.get('plan_id')
                if request.method != 'DELETE'
                else request.query_params.get('plan_id')
            )
            plan = self.get_queryset().filter(pk=plan_id).first()
            if plan is None:
                return Response(
                    {'error': "Le projet courant est introuvable."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        icon_type = str(
            request.data.get('icon_type')
            if request.method != 'DELETE'
            else request.query_params.get('icon_type', '')
        ).strip()
        if not icon_type or len(icon_type) > 255:
            return Response(
                {'error': "Le pictogramme est invalide."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if request.method == 'DELETE':
            UserPictogramLabel.objects.filter(
                user=request.user,
                plan=plan,
                icon_type=icon_type,
            ).delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        label = str(request.data.get('label') or '').strip()
        if not label:
            return Response(
                {'error': "Le nom personnalisé ne peut pas être vide."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(label) > 255:
            return Response(
                {'error': "Le nom personnalisé est trop long."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        item, _created = UserPictogramLabel.objects.update_or_create(
            user=request.user,
            plan=plan,
            icon_type=icon_type,
            defaults={'label': label},
        )
        return Response(
            {
                'icon_type': item.icon_type,
                'label': item.label,
                'scope': scope,
                'plan_id': item.plan_id,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=['post'], url_path='clean', throttle_classes=[AiRateThrottle])
    def clean_plan(self, request, pk=None):
        plan = self.get_object()
        img, error = load_plan_image(plan, use_active_background=False)
        if error:
            return Response({"error": error}, status=status.HTTP_400_BAD_REQUEST)

        cleaned = clean_plan_image(img)

        if not save_cleaned_plan(
            plan,
            cleaned,
            "cleaned",
            PlanCleaningHistory.METHOD_LOCAL,
            "Nettoyage local",
        ):
            return Response({"error": "Failed to process cleaned image"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        serializer = self.get_serializer(plan)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='clean-walls', throttle_classes=[AiRateThrottle])
    def clean_walls(self, request, pk=None):
        plan = self.get_object()
        img, error = load_plan_image(plan, dpi=250, use_active_background=False)
        if error:
            return Response({"error": error}, status=status.HTTP_400_BAD_REQUEST)

        cleaned = clean_walls_image(img)

        if not save_cleaned_plan(
            plan,
            cleaned,
            "walls",
            PlanCleaningHistory.METHOD_LOCAL_WALLS,
            "Nettoyage local des murs",
        ):
            return Response({"error": "Failed to process walls image"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        serializer = self.get_serializer(plan)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='clean-image-data', throttle_classes=[AiRateThrottle])
    def clean_image_data(self, request, pk=None):
        """Cleans any raw base64 plan image using OpenCV (full plan clean or walls extraction).

        Used by the secondary plans, which live in the browser until they are
        saved and so have no file on disk to point the other clean actions at.
        """
        # The plan lookup keeps the endpoint behind the same ownership check as
        # the rest of the viewset and scopes an optional secondary-plan target.
        plan = self.get_object()

        image_data = request.data.get('image_data')
        method = request.data.get('method', 'plan')
        overlay_id = request.data.get('overlay_id')
        target_overlay = None
        if overlay_id is not None:
            target_overlay = PlanOverlay.objects.filter(id=overlay_id, plan=plan).first()
            if target_overlay is None:
                return Response(
                    {"error": "Plan secondaire introuvable."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        if not image_data or not isinstance(image_data, str):
            return Response({"error": "No image_data provided."}, status=status.HTTP_400_BAD_REQUEST)
        if len(image_data) > MAX_IMAGE_DATA_LENGTH:
            return Response({"error": "Image trop volumineuse."}, status=status.HTTP_400_BAD_REQUEST)
        if not image_data.startswith('data:image/') or ';base64,' not in image_data:
            return Response(
                {"error": "Image invalide : une data URL base64 est attendue."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            _, encoded = image_data.split(';base64,', 1)
            image_bytes = base64.b64decode(encoded, validate=True)
            valid, validation_error = validate_overlay_image_bytes(image_bytes)
            if not valid:
                return Response({"error": validation_error}, status=status.HTTP_400_BAD_REQUEST)
            np_arr = np.frombuffer(image_bytes, np.uint8)
            img = flatten_on_white(cv2.imdecode(np_arr, cv2.IMREAD_UNCHANGED))
            if img is None:
                return Response({"error": "Invalid image file."}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            return Response({"error": "Failed to decode image data."}, status=status.HTTP_400_BAD_REQUEST)

        if method == 'walls':
            cleaned = clean_walls_image(img)
        else:
            cleaned = clean_plan_image(img)

        ret, buffer = cv2.imencode('.png', cleaned)
        if not ret:
            return Response({"error": "Failed to encode cleaned image."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        cleaned_bytes = buffer.tobytes()
        cleaned_data_url = image_bytes_to_data_url(cleaned_bytes)
        if target_overlay is not None:
            original_bytes = encode_image_to_png_bytes(img)
            cleaning_method = (
                PlanCleaningHistory.METHOD_LOCAL_WALLS
                if method == 'walls'
                else PlanCleaningHistory.METHOD_LOCAL
            )
            title = (
                "Extraction locale des murs — plan secondaire"
                if method == 'walls'
                else "Nettoyage local — plan secondaire"
            )
            if not save_cleaned_overlay_bytes(
                target_overlay,
                cleaned_bytes,
                "walls" if method == 'walls' else "cleaned",
                cleaning_method,
                title,
                original_bytes=original_bytes,
            ):
                return Response(
                    {"error": "Impossible d'enregistrer le plan secondaire nettoyé."},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

        return Response({
            "cleaned_image_data": cleaned_data_url,
            "overlay": (
                PlanOverlaySerializer(target_overlay, context={"request": request}).data
                if target_overlay is not None
                else None
            ),
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='change-background', throttle_classes=[UploadRateThrottle])
    def change_background(self, request, pk=None):
        plan = self.get_object()
        file_obj = request.FILES.get('background_file')
        if not file_obj:
            return Response({"error": "Aucun fichier fourni."}, status=status.HTTP_400_BAD_REQUEST)

        # Same gate as plan creation: this endpoint writes to the very same
        # place, so it cannot be the loose way in.
        try:
            background_type = validate_background_upload(file_obj)
        except UploadRejected as rejected:
            return Response({"error": str(rejected)}, status=status.HTTP_400_BAD_REQUEST)
        file_obj.name = safe_upload_name(file_obj.name)

        plan.background_file = file_obj
        plan.background_type = background_type
        plan.cleaned_background_file = None
        plan.use_cleaned_background = False
        plan.main_plan_x = 0.0
        plan.main_plan_y = 0.0
        plan.main_plan_width = 0.0
        plan.main_plan_height = 0.0
        # A replacement plan must be shown immediately even when the previous
        # background had deliberately been hidden from the Layers panel.
        plan.main_plan_visible = True
        plan.save()

        serializer = self.get_serializer(plan)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='crop')
    def crop(self, request, pk=None):
        """Crop the current background image to a selected bounding box."""
        plan = self.get_object()

        try:
            crop_x = float(request.data.get('x', 0))
            crop_y = float(request.data.get('y', 0))
            crop_w = float(request.data.get('width', 1))
            crop_h = float(request.data.get('height', 1))
        except (ValueError, TypeError):
            return Response({"error": "Coordonnées de rognage invalides."}, status=status.HTTP_400_BAD_REQUEST)

        is_normalized = bool(request.data.get('normalized', True))

        img, error = load_plan_image(plan, dpi=150)
        if error or img is None:
            return Response({"error": error or "Impossible de charger le plan."}, status=status.HTTP_400_BAD_REQUEST)

        img_h, img_w = img.shape[:2]

        if is_normalized:
            x1 = max(0, min(img_w - 1, int(crop_x * img_w)))
            y1 = max(0, min(img_h - 1, int(crop_y * img_h)))
            w = max(10, min(img_w - x1, int(crop_w * img_w)))
            h = max(10, min(img_h - y1, int(crop_h * img_h)))
        else:
            x1 = max(0, min(img_w - 1, int(crop_x)))
            y1 = max(0, min(img_h - 1, int(crop_y)))
            w = max(10, min(img_w - x1, int(crop_w)))
            h = max(10, min(img_h - y1, int(crop_h)))

        x2 = min(img_w, x1 + w)
        y2 = min(img_h, y1 + h)

        if x2 - x1 < 10 or y2 - y1 < 10:
            return Response({"error": "Zone de rognage trop petite."}, status=status.HTTP_400_BAD_REQUEST)

        cropped_img = img[y1:y2, x1:x2]

        if not save_cleaned_plan(
            plan,
            cropped_img,
            "cropped",
            PlanCleaningHistory.METHOD_LOCAL,
            "Rognage du plan",
        ):
            return Response({"error": "Impossible d'enregistrer le plan rogné."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        serializer = self.get_serializer(plan)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='grok-clean', throttle_classes=[AiRateThrottle])
    def grok_clean(self, request, pk=None):
        """Launch an asynchronous Grok cleaning job (analyse + image generation)."""
        plan = self.get_object()

        settings_obj = UserXaiSettings.objects.filter(user=request.user).first()
        if not settings_obj:
            return Response(
                {"error": "Aucune clé API xAI enregistrée.", "error_code": "XAI_KEY_MISSING"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        background_color = "#FFFFFF"
        wall_color = "#000000"
        preset = "evacuation"
        target_kind = "main"
        source_image_data = ""
        target_overlay = None
        if isinstance(request.data, dict):
            if "background_color" in request.data:
                background_color = str(request.data["background_color"]).strip() or "#FFFFFF"
            if "wall_color" in request.data:
                requested_wall_color = str(request.data["wall_color"]).strip()
                wall_color = normalize_hex_color(requested_wall_color, "")
                if not wall_color:
                    return Response(
                        {"error": "La couleur des parois doit être au format HEX, par exemple #000000.", "error_code": "INVALID_WALL_COLOR"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            if "preset" in request.data:
                preset = str(request.data["preset"]).strip() or "evacuation"
            if "target_kind" in request.data:
                target_kind = str(request.data["target_kind"]).strip() or "main"
        if preset not in {"evacuation", "autocad", "sketch"}:
            return Response(
                {"error": "Le type de plan source est invalide.", "error_code": "INVALID_PRESET"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if target_kind not in {"main", "overlay"}:
            return Response(
                {"error": "La cible du traitement est invalide.", "error_code": "INVALID_TARGET"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if target_kind == "overlay":
            overlay_id = request.data.get("overlay_id")
            target_overlay = PlanOverlay.objects.filter(id=overlay_id, plan=plan).first()
            if target_overlay is None:
                return Response(
                    {"error": "Le plan secondaire ciblé est introuvable.", "error_code": "INVALID_TARGET"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            normalized_bytes, image_error = normalize_plan_image_data(request.data.get("image_data"))
            if image_error:
                return Response(
                    {"error": image_error, "error_code": "INVALID_IMAGE"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            source_image_data = image_bytes_to_data_url(normalized_bytes)

        job = GrokCleaningJob.objects.create(
            user=request.user,
            plan=plan,
            status=GrokCleaningJob.STATUS_PENDING,
            target_background_color=background_color,
            target_wall_color=wall_color,
            preset=preset,
            target_kind=target_kind,
            source_image_data=source_image_data,
            target_overlay=target_overlay,
        )
        thread = threading.Thread(target=run_grok_cleaning_job, args=(job.id,), daemon=True)
        thread.start()

        return Response(serialize_grok_cleaning_job(job), status=status.HTTP_202_ACCEPTED)

    @action(detail=True, methods=['get'], url_path='grok-clean-status')
    def grok_clean_status(self, request, pk=None):
        plan = self.get_object()
        job_id = request.query_params.get("job_id")
        jobs = GrokCleaningJob.objects.filter(user=request.user, plan=plan)
        if job_id:
            jobs = jobs.filter(id=job_id)
        job = jobs.order_by("-created_at").first()
        if not job:
            return Response(
                {"error": "Traitement introuvable.", "error_code": "JOB_NOT_FOUND"},
                status=status.HTTP_404_NOT_FOUND,
            )
        expire_stalled_grok_job(job)
        return Response(serialize_grok_cleaning_job(job), status=status.HTTP_200_OK)

    @action(detail=True, methods=['get'], url_path='cleaning-history')
    def cleaning_history(self, request, pk=None):
        plan = self.get_object()
        history = PlanCleaningHistory.objects.filter(
            user=request.user,
            plan=plan,
        )
        overlay_id = request.query_params.get("overlay_id")
        if overlay_id:
            overlay = PlanOverlay.objects.filter(id=overlay_id, plan=plan).first()
            if overlay is None:
                return Response(
                    {"error": "Plan secondaire introuvable."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            history = history.filter(
                options__target_kind="overlay",
                options__overlay_id=overlay.id,
            )
        else:
            # SQLite's JSON exclusion treats a missing key as SQL NULL, so a
            # plain ``exclude`` would also hide legacy/main-plan rows. Filtering
            # the already scoped queryset keeps those historical entries.
            history = [
                item for item in history
                if item.options.get("target_kind") != "overlay"
            ]
        serializer = PlanCleaningHistorySerializer(history, many=True, context={"request": request})
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='use-cleaning-history')
    def use_cleaning_history(self, request, pk=None):
        plan = self.get_object()
        serializer = UseCleaningHistorySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        history = PlanCleaningHistory.objects.filter(
            id=serializer.validated_data["history_id"],
            plan=plan,
        ).first()
        if not history or not history.image_file:
            return Response({"error": "Historique de nettoyage introuvable."}, status=status.HTTP_404_NOT_FOUND)

        try:
            with history.image_file.open('rb') as f:
                image_bytes = f.read()
        except Exception as exc:
            logger.exception("use_cleaning_history.file_read_failed")
            return Response({"error": "Impossible de lire le fichier de l'historique."}, status=status.HTTP_400_BAD_REQUEST)

        overlay_id = serializer.validated_data.get("overlay_id")
        if overlay_id is not None:
            overlay = PlanOverlay.objects.filter(id=overlay_id, plan=plan).first()
            if (
                overlay is None
                or history.options.get("target_kind") != "overlay"
                or history.options.get("overlay_id") != overlay.id
            ):
                return Response(
                    {"error": "Historique du plan secondaire introuvable."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            if not save_cleaned_overlay_bytes(
                overlay,
                image_bytes,
                "history_restored",
                history.cleaning_method,
                history.title,
                create_history=False,
            ):
                return Response({"error": "Image historique invalide."}, status=status.HTTP_400_BAD_REQUEST)
            return Response({
                "target_kind": "overlay",
                "overlay": PlanOverlaySerializer(overlay, context={"request": request}).data,
            }, status=status.HTTP_200_OK)

        if history.options.get("target_kind") == "overlay":
            return Response(
                {"error": "Sélectionnez le plan secondaire correspondant à cette version."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not save_cleaned_plan_bytes(plan, image_bytes, "history_restored", create_history=False):
            return Response({"error": "Image historique invalide."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = self.get_serializer(plan)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='revert-overlay')
    def revert_overlay(self, request, pk=None):
        plan = self.get_object()
        overlay = PlanOverlay.objects.filter(id=request.data.get("overlay_id"), plan=plan).first()
        if overlay is None:
            return Response({"error": "Plan secondaire introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if not overlay.original_image_file:
            return Response(
                {"error": "Aucune version originale n'est enregistrée pour ce plan secondaire."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            with overlay.original_image_file.open('rb') as original_file:
                original_bytes = original_file.read()
            valid, validation_error = validate_overlay_image_bytes(original_bytes)
            if not valid:
                return Response({"error": validation_error}, status=status.HTTP_400_BAD_REQUEST)
            original_extension = os.path.splitext(overlay.original_image_file.name)[1] or '.png'
            overlay.image_file.save(
                f"restored_original_overlay_{overlay.pk}{original_extension}",
                ContentFile(original_bytes),
                save=False,
            )
            overlay.is_original = True
            overlay.save()
        except OSError:
            logger.exception("revert_overlay.file_read_failed", extra={"overlay_id": overlay.id})
            return Response(
                {"error": "Impossible de lire l'original du plan secondaire."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            PlanOverlaySerializer(overlay, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=['post'], url_path='apply-manual-edit', throttle_classes=[UploadRateThrottle])
    def apply_manual_edit(self, request, pk=None):
        """Stores the background as retouched with the editor's eraser."""
        plan = self.get_object()
        serializer = ApplyManualPlanEditSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        _, encoded_image = serializer.validated_data["image_data"].split(";base64,", 1)
        try:
            image_bytes = base64.b64decode(encoded_image, validate=True)
        except ValueError:
            return Response({"error": "Image retouchée invalide."}, status=status.HTTP_400_BAD_REQUEST)

        if not save_cleaned_plan_bytes(
            plan,
            image_bytes,
            "manual_edit",
            PlanCleaningHistory.METHOD_MANUAL_EDIT,
            "Retouche manuelle (gomme)",
        ):
            return Response({"error": "Image retouchée invalide."}, status=status.HTTP_400_BAD_REQUEST)

        return Response(self.get_serializer(plan).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='revert')
    def revert_plan(self, request, pk=None):
        plan = self.get_object()
        plan.use_cleaned_background = False
        plan.save()
        serializer = self.get_serializer(plan)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='sync-shapes')
    def sync_shapes(self, request, pk=None):
        """Replaces the plan's shapes with the supplied list, all or nothing."""
        plan = self.get_object()
        serializer = PlanShapeSerializer(data=request.data, many=True)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            plan.shapes.all().delete()
            created = PlanShape.objects.bulk_create([
                PlanShape(plan=plan, **item) for item in serializer.validated_data
            ])

        return Response(PlanShapeSerializer(created, many=True).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='sync-overlays')
    def sync_overlays(self, request, pk=None):
        """Replaces the plan's secondary plans with the supplied list.

        An overlay whose image has not changed travels as `image_ref` (its id),
        so only the ones the user actually edited are decoded and rewritten.
        """
        plan = self.get_object()
        serializer = SyncPlanOverlaySerializer(data=request.data, many=True)
        serializer.is_valid(raise_exception=True)

        existing = {overlay.pk: overlay for overlay in plan.overlays.all()}
        kept_files = set()
        rows = []

        for item in serializer.validated_data:
            image_data = item.get('image_data')
            reference = item.get('image_ref')

            if image_data:
                if not image_data.startswith('data:image/') or ';base64,' not in image_data:
                    return Response(
                        {"error": "Plan secondaire invalide : une data URL base64 est attendue."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                header, encoded = image_data.split(';base64,', 1)
                try:
                    image_bytes = base64.b64decode(encoded, validate=True)
                except (ValueError, binascii.Error):
                    return Response(
                        {"error": "Plan secondaire illisible."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                valid, validation_error = validate_overlay_image_bytes(image_bytes)
                if not valid:
                    return Response(
                        {"error": validation_error},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                extension = header.split('/', 1)[-1].split(';')[0].lower()
                if extension not in ('png', 'jpeg', 'jpg', 'webp'):
                    extension = 'png'
                content = ContentFile(image_bytes, name=f"overlay.{extension}")
            else:
                previous = existing.get(reference)
                if previous is None:
                    return Response(
                        {"error": f"Plan secondaire {reference} introuvable."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                # Reuse the stored file instead of rewriting identical bytes.
                content = previous.image_file.name
                kept_files.add(previous.image_file.name)

            rows.append((content, item))

        stale_files = {
            overlay.image_file.name
            for overlay in existing.values()
            if overlay.image_file and overlay.image_file.name not in kept_files
        }
        new_files = []
        storage = PlanOverlay._meta.get_field('image_file').storage
        try:
            with transaction.atomic():
                plan.overlays.all().delete()

                for content, item in rows:
                    overlay = PlanOverlay(
                        plan=plan,
                        x=item['x'],
                        y=item['y'],
                        width=item['width'],
                        height=item['height'],
                        rotation=item.get('rotation', 0.0),
                        label=item.get('label', ''),
                        locked=item.get('locked', False),
                        group_id=item.get('group_id', ''),
                    )
                    if isinstance(content, str):
                        overlay.image_file.name = content
                        overlay.save()
                    else:
                        overlay.image_file.save(content.name, content, save=True)
                        new_files.append(overlay.image_file.name)

                def delete_stale_files(names=tuple(stale_files)):
                    for name in names:
                        if PlanOverlay.objects.filter(image_file=name).exists():
                            continue
                        if storage.exists(name):
                            storage.delete(name)

                transaction.on_commit(delete_stale_files)
        except Exception:
            for name in new_files:
                if name and storage.exists(name):
                    storage.delete(name)
            raise

        return Response(
            PlanOverlaySerializer(plan.overlays.all(), many=True, context={'request': request}).data,
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=['post'], url_path='sync-editor')
    def sync_editor(self, request, pk=None):
        """Atomically stores every editable layer and the visual project settings.

        Validation and image decoding happen before the database is touched. New
        files are removed if the SQL transaction fails; replaced files are only
        removed after commit, so a failed save cannot destroy the last good plan.
        """
        plan = self.get_object()
        serializer = SyncEditorSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        settings_data = payload['plan_settings']
        catalog_sources, allowed_media_paths = project_pictogram_capture_inputs(request)
        submitted_sources = settings_data.get('pictogram_sources', [])
        source_by_type = {
            str(item.get('icon_type') or item.get('type')): item
            for item in catalog_sources
            if item.get('icon_type') or item.get('type')
        }
        source_by_type.update({
            str(item.get('icon_type')): item
            for item in submitted_sources
            if item.get('icon_type')
        })
        project_sources = list(source_by_type.values())
        requested_template_key = payload['plan_settings'].get(
            'active_sheet_template_key',
            plan.active_sheet_template_key,
        )
        if requested_template_key != 'none':
            required_information = {
                'establishment_name': plan.establishment_name,
                'building_name': plan.building_name,
                'floor_name': plan.floor_name,
                'plan_number': plan.plan_number,
                'design_date': plan.design_date,
                'designer': plan.designer,
                'revision_index': plan.revision_index,
            }
            missing_information = [
                field for field, value in required_information.items()
                if value is None or (isinstance(value, str) and not value.strip())
            ]
            if missing_information:
                return Response(
                    {
                        "error": (
                            "Complétez les informations obligatoires du plan dans le studio "
                            "avant d’enregistrer ce template."
                        ),
                        "missing_fields": missing_information,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        existing_overlays = {overlay.pk: overlay for overlay in plan.overlays.all()}
        prepared_overlays = []
        used_overlay_ids = set()

        for item in payload['overlays']:
            image_data = item.get('image_data')
            reference = item.get('image_ref')
            overlay_id = item.get('overlay_id') or reference

            if overlay_id is not None:
                if overlay_id not in existing_overlays:
                    return Response(
                        {"error": f"Plan secondaire {overlay_id} introuvable."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if overlay_id in used_overlay_ids:
                    return Response(
                        {"error": f"Plan secondaire {overlay_id} présent plusieurs fois."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                used_overlay_ids.add(overlay_id)

            image_bytes = None
            extension = 'png'
            if image_data:
                if not image_data.startswith('data:image/') or ';base64,' not in image_data:
                    return Response(
                        {"error": "Plan secondaire invalide : une data URL base64 est attendue."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                header, encoded = image_data.split(';base64,', 1)
                try:
                    image_bytes = base64.b64decode(encoded, validate=True)
                except (ValueError, binascii.Error):
                    return Response(
                        {"error": "Plan secondaire illisible."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                valid, validation_error = validate_overlay_image_bytes(image_bytes)
                if not valid:
                    return Response(
                        {"error": validation_error},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                extension = header.split('/', 1)[-1].split(';')[0].lower()
                if extension not in ('png', 'jpeg', 'jpg', 'webp'):
                    extension = 'png'
            elif overlay_id is None:
                return Response(
                    {"error": "Un nouveau plan secondaire doit contenir une image."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            prepared_overlays.append((overlay_id, image_bytes, extension, item))

        new_file_names = []
        files_to_delete = set()
        try:
            with transaction.atomic():
                plan.icons.all().delete()
                PlanIcon.objects.bulk_create([
                    PlanIcon(plan=plan, **item) for item in payload['icons']
                ])

                plan.shapes.all().delete()
                PlanShape.objects.bulk_create([
                    PlanShape(plan=plan, **item) for item in payload['shapes']
                ])

                plan.texts.all().delete()
                PlanText.objects.bulk_create([
                    PlanText(plan=plan, **item) for item in payload['texts']
                ])

                retained_ids = []
                for overlay_id, image_bytes, extension, item in prepared_overlays:
                    overlay = existing_overlays.get(overlay_id) if overlay_id is not None else None
                    is_new_overlay = overlay is None
                    if overlay is None:
                        overlay = PlanOverlay(plan=plan)

                    old_file_name = overlay.image_file.name if overlay.image_file else ''
                    overlay.x = item['x']
                    overlay.y = item['y']
                    overlay.width = item['width']
                    overlay.height = item['height']
                    overlay.rotation = item.get('rotation', 0.0)
                    overlay.label = item.get('label', '')
                    overlay.locked = item.get('locked', False)
                    overlay.visible = item.get('visible', True)
                    overlay.z_index = item.get('z_index', 100)
                    overlay.group_id = item.get('group_id', '')

                    if image_bytes is not None:
                        if not overlay.original_image_file:
                            original_bytes = image_bytes
                            if old_file_name:
                                try:
                                    with overlay.image_file.open('rb') as old_file:
                                        original_bytes = old_file.read()
                                except OSError:
                                    original_bytes = image_bytes
                            overlay.original_image_file.save(
                                f"original_overlay_{overlay_id or 'new'}.{extension}",
                                ContentFile(original_bytes),
                                save=False,
                            )
                        overlay.image_file.save(
                            f"overlay.{extension}",
                            ContentFile(image_bytes),
                            save=False,
                        )
                        overlay.is_original = is_new_overlay
                        new_file_names.append(overlay.image_file.name)
                        if old_file_name and old_file_name != overlay.image_file.name:
                            files_to_delete.add(old_file_name)

                    overlay.save()
                    retained_ids.append(overlay.pk)

                removed = plan.overlays.exclude(pk__in=retained_ids)
                files_to_delete.update(
                    name for name in removed.values_list('image_file', flat=True) if name
                )
                removed.delete()

                settings_data = payload['plan_settings']
                plan.main_plan_x = settings_data.get('main_plan_x', 0.0)
                plan.main_plan_y = settings_data.get('main_plan_y', 0.0)
                plan.main_plan_width = settings_data.get('main_plan_width', 0.0)
                plan.main_plan_height = settings_data.get('main_plan_height', 0.0)
                plan.main_plan_locked = settings_data.get('main_plan_locked', False)
                plan.main_plan_visible = settings_data.get('main_plan_visible', True)
                plan.main_plan_z_index = settings_data.get('main_plan_z_index', 0)
                plan.main_plan_group_id = settings_data.get('main_plan_group_id', '')
                plan.main_plan_grouping_enabled = settings_data.get('main_plan_grouping_enabled', False)
                plan.watermark_config = dict(settings_data.get('watermark', {}))
                plan.document_type = settings_data.get('document_type', plan.document_type)
                plan.export_paper_format = settings_data.get(
                    'export_paper_format',
                    plan.export_paper_format,
                )
                plan.print_scale_denominator = settings_data.get(
                    'print_scale_denominator',
                    plan.print_scale_denominator,
                )
                plan.measured_scale_denominator = settings_data.get(
                    'measured_scale_denominator',
                    None,
                )
                plan.plan_information_layout = dict(settings_data.get(
                    'plan_information_layout',
                    plan.plan_information_layout,
                ))
                plan.plan_legend_layout = dict(settings_data.get(
                    'plan_legend_layout',
                    plan.plan_legend_layout,
                ))
                plan.legend_hidden_icon_types = list(settings_data.get(
                    'legend_hidden_icon_types',
                    plan.legend_hidden_icon_types,
                ))
                plan.plan_situation_config = dict(settings_data.get(
                    'plan_situation_config',
                    plan.plan_situation_config,
                ))
                plan.sheet_plan_placement = dict(settings_data.get(
                    'sheet_plan_placement',
                    plan.sheet_plan_placement,
                ))
                plan.template_snapshot = dict(settings_data.get(
                    'template_snapshot',
                    plan.template_snapshot,
                ))
                plan.active_sheet_template_key = settings_data.get(
                    'active_sheet_template_key',
                    plan.active_sheet_template_key,
                )
                plan.active_sheet_template_version_id = settings_data.get(
                    'active_sheet_template_version_id',
                    plan.active_sheet_template_version_id,
                )
                plan.active_sheet_template_name = settings_data.get(
                    'active_sheet_template_name',
                    plan.active_sheet_template_name,
                )
                if plan.active_sheet_template_key != 'none':
                    plan.last_sheet_template_key = plan.active_sheet_template_key
                    plan.last_sheet_template_version_id = plan.active_sheet_template_version_id
                    plan.last_sheet_template_name = plan.active_sheet_template_name
                else:
                    plan.last_sheet_template_key = settings_data.get(
                        'last_sheet_template_key',
                        plan.last_sheet_template_key,
                    )
                    plan.last_sheet_template_version_id = settings_data.get(
                        'last_sheet_template_version_id',
                        plan.last_sheet_template_version_id,
                    )
                    plan.last_sheet_template_name = settings_data.get(
                        'last_sheet_template_name',
                        plan.last_sheet_template_name,
                    )
                plan.save(update_fields=[
                    'main_plan_x', 'main_plan_y', 'main_plan_width', 'main_plan_height',
                    'main_plan_locked', 'main_plan_visible', 'main_plan_z_index',
                    'main_plan_group_id', 'main_plan_grouping_enabled',
                    'watermark_config', 'document_type', 'export_paper_format',
                    'print_scale_denominator', 'measured_scale_denominator',
                    'plan_information_layout', 'plan_legend_layout',
                    'legend_hidden_icon_types', 'plan_situation_config',
                    'sheet_plan_placement', 'template_snapshot',
                    'active_sheet_template_key',
                    'active_sheet_template_version_id', 'active_sheet_template_name',
                    'last_sheet_template_key', 'last_sheet_template_version_id',
                    'last_sheet_template_name',
                    'updated_at',
                ])

                capture_project_revision(
                    plan,
                    actor=request.user,
                    pictogram_sources=project_sources,
                    allowed_media_paths=allowed_media_paths,
                )

                live_file_names = set(
                    plan.overlays.exclude(image_file='').values_list('image_file', flat=True)
                )
                stale_file_names = tuple(files_to_delete - live_file_names)
                storage = PlanOverlay._meta.get_field('image_file').storage
                transaction.on_commit(
                    lambda names=stale_file_names, target_storage=storage: [
                        target_storage.delete(name) for name in names if target_storage.exists(name)
                    ]
                )
        except Exception:
            storage = PlanOverlay._meta.get_field('image_file').storage
            for name in new_file_names:
                if name and storage.exists(name):
                    storage.delete(name)
            raise

        plan.refresh_from_db()
        response_data = dict(self.get_serializer(plan).data)
        # Input order is the editor's layer order; model ordering by primary key
        # is not sufficient when a new overlay is inserted between old ones.
        response_data['overlay_ids'] = retained_ids
        return Response(response_data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='sync-icons')
    def sync_icons(self, request, pk=None):
        """Replaces the plan's icons with the supplied list, all or nothing.

        Validated first and wrapped in a transaction, like its sibling actions:
        the old rows are deleted here, so a payload that fails halfway through
        used to leave the plan stripped of the icons it started with.
        """
        plan = self.get_object()
        serializer = SyncPlanIconSerializer(data=request.data, many=True)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            plan.icons.all().delete()
            created = PlanIcon.objects.bulk_create([
                PlanIcon(plan=plan, **item) for item in serializer.validated_data
            ])

        return Response(PlanIconSerializer(created, many=True).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='sync-texts')
    def sync_texts(self, request, pk=None):
        """Replaces the plan's texts with the supplied list, all or nothing."""
        plan = self.get_object()
        serializer = PlanTextSerializer(data=request.data, many=True)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            plan.texts.all().delete()
            created = PlanText.objects.bulk_create([
                PlanText(plan=plan, **item) for item in serializer.validated_data
            ])

        return Response(PlanTextSerializer(created, many=True).data, status=status.HTTP_200_OK)

class PlanIconViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated, WorkspaceEditPermission]
    serializer_class = PlanIconSerializer

    def get_queryset(self):
        owner_ids = accessible_plan_owner_ids(self.request.user)
        return PlanIcon.objects.filter(plan__user_id__in=owner_ids)


class WorkspaceCollaboratorsView(APIView):
    """The owner's side: who shares their plan list, and who has been invited."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        memberships = WorkspaceMembership.objects.filter(owner=request.user).select_related('member')
        invitations = WorkspaceInvitation.objects.filter(owner=request.user).order_by('-created_at')
        shared_with_me = WorkspaceMembership.objects.filter(member=request.user).select_related('owner')
        return Response({
            'members': WorkspaceMembershipSerializer(memberships, many=True).data,
            'invitations': WorkspaceInvitationSerializer(invitations, many=True).data,
            'shared_with_me': [
                {'owner_username': item.owner.username, 'role': item.role}
                for item in shared_with_me
            ],
        }, status=status.HTTP_200_OK)

    def post(self, request):
        serializer = CreateWorkspaceInvitationSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data['email']
        role = serializer.validated_data['role']

        # A pending invitation is replaced rather than stacked, so one address
        # never ends up with several usable tokens at once.
        WorkspaceInvitation.objects.filter(
            owner=request.user, email=email, accepted_at__isnull=True, revoked_at__isnull=True
        ).update(revoked_at=timezone.now())

        invitation, token = WorkspaceInvitation.issue(request.user, email, role)
        logger.info(
            "workspace_invitation.created",
            extra={"owner_id": request.user.id, "invitation_id": invitation.id},
        )
        return Response({
            'invitation': WorkspaceInvitationSerializer(invitation).data,
            # Shown once. Only its hash is stored, so it cannot be read back.
            'token': token,
        }, status=status.HTTP_201_CREATED)


class RevokeWorkspaceAccessView(APIView):
    """Withdraws a pending invitation, or an access already granted."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        invitation_id = request.data.get('invitation_id')
        membership_id = request.data.get('membership_id')

        if invitation_id is not None:
            updated = WorkspaceInvitation.objects.filter(
                id=invitation_id, owner=request.user, accepted_at__isnull=True
            ).update(revoked_at=timezone.now())
            if not updated:
                return Response({"error": "Invitation introuvable."}, status=status.HTTP_404_NOT_FOUND)
            return Response(status=status.HTTP_204_NO_CONTENT)

        if membership_id is not None:
            deleted, _ = WorkspaceMembership.objects.filter(
                id=membership_id, owner=request.user
            ).delete()
            if not deleted:
                return Response({"error": "Accès introuvable."}, status=status.HTTP_404_NOT_FOUND)
            return Response(status=status.HTTP_204_NO_CONTENT)

        return Response(
            {"error": "Indiquez 'invitation_id' ou 'membership_id'."},
            status=status.HTTP_400_BAD_REQUEST,
        )


class AcceptWorkspaceInvitationView(APIView):
    """The guest's side: redeem a token to join the inviter's plan list."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = AcceptWorkspaceInvitationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Looked up by hash: the raw token is never stored, so a leak of this
        # table cannot be replayed.
        invitation = WorkspaceInvitation.objects.filter(
            token_hash=hash_invitation_token(serializer.validated_data['token'])
        ).first()

        # One message for every failure, so a wrong token cannot be told apart
        # from an expired or already-used one.
        invalid = Response(
            {"error": "Cette invitation est invalide, expirée ou déjà utilisée."},
            status=status.HTTP_400_BAD_REQUEST,
        )
        if invitation is None or not invitation.is_pending:
            return invalid
        if invitation.owner_id == request.user.id:
            return invalid

        with transaction.atomic():
            # Re-read under lock: two clicks on the same link must not both win.
            locked = WorkspaceInvitation.objects.select_for_update().get(pk=invitation.pk)
            if not locked.is_pending:
                return invalid

            membership, created = WorkspaceMembership.objects.get_or_create(
                owner=locked.owner,
                member=request.user,
                defaults={'role': locked.role},
            )
            if not created and membership.role != locked.role:
                membership.role = locked.role
                membership.save(update_fields=['role'])

            locked.accepted_at = timezone.now()
            locked.accepted_by = request.user
            locked.save(update_fields=['accepted_at', 'accepted_by'])

        logger.info(
            "workspace_invitation.accepted",
            extra={"owner_id": invitation.owner_id, "member_id": request.user.id},
        )
        return Response({
            'owner_username': invitation.owner.username,
            'role': membership.role,
        }, status=status.HTTP_200_OK)


class LogoutView(APIView):
    """Déconnexion réelle : révoque le jeton de rafraîchissement côté serveur.

    Effacer le jeton dans le navigateur ne prouve rien — une copie prise avant
    la déconnexion resterait échangeable pendant sept jours. Le porter sur la
    liste noire est ce qui met fin à la session.

    Le jeton d'accès, lui, n'est pas révocable : sa durée de vie courte (30 min)
    est la seule limite. C'est le compromis assumé des jetons sans état.
    """

    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [LoginRateThrottle]

    def post(self, request):
        refresh_token = request.data.get('refresh')
        if not refresh_token:
            return clear_media_session_cookie(
                Response(
                    {"error": "Le jeton de rafraîchissement est requis pour se déconnecter."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            )

        try:
            token = RefreshToken(refresh_token)
            # Un utilisateur ne révoque que ses propres sessions : sans ce
            # contrôle, un jeton volé permettrait de déconnecter autrui.
            if str(token.payload.get(settings.SIMPLE_JWT['USER_ID_CLAIM'])) != str(request.user.id):
                logger.warning(
                    "auth.logout.foreign_token user_id=%s", request.user.id
                )
                return clear_media_session_cookie(
                    Response(
                        {"error": "Ce jeton n'appartient pas à ce compte."},
                        status=status.HTTP_403_FORBIDDEN,
                    )
                )
            token.blacklist()
        except TokenError:
            # Déjà révoqué ou expiré : la session est close, c'est le résultat
            # demandé. Répondre 400 pousserait le client à réessayer en boucle.
            logger.info("auth.logout.already_invalid user_id=%s", request.user.id)
            return clear_media_session_cookie(
                Response(status=status.HTTP_205_RESET_CONTENT)
            )

        logger.info("auth.logout user_id=%s", request.user.id)
        return clear_media_session_cookie(
            Response(status=status.HTTP_205_RESET_CONTENT)
        )
