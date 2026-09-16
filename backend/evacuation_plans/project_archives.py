"""Autonomous, content-addressed project snapshots for evacuation plans."""

import base64
import hashlib
import json
import mimetypes
import os
import re
import tempfile
import zipfile
from types import SimpleNamespace
from datetime import date, datetime
from pathlib import Path

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import transaction
from django.utils import timezone

from .models import (
    EvacuationPlan,
    PlanCleaningHistory,
    PlanIcon,
    PlanOverlay,
    PlanProjectAsset,
    PlanProjectResource,
    PlanProjectRevision,
    PlanShape,
    PlanText,
    SheetTemplateAsset,
    SheetTemplateVersion,
    UserPictogramLabel,
    accessible_library_owner_ids,
)
from .pictogram_security import validate_and_sanitize_pictogram_svg


PROJECT_SCHEMA_VERSION = 1
PROJECT_ARCHIVE_FORMAT = 'evacstudio-autonomous-project'
MAX_PROJECT_ZIP_BYTES = 250 * 1024 * 1024
MAX_PROJECT_ZIP_UNCOMPRESSED_BYTES = 750 * 1024 * 1024
MAX_PROJECT_ZIP_ENTRIES = 2_000
MAX_TEMPLATE_SNAPSHOT_BYTES = 5 * 1024 * 1024
SHA256_PATTERN = re.compile(r'^[0-9a-f]{64}$')

PLAN_STATE_EXCLUDED = {
    'id', 'user', 'folder', 'project_uuid', 'archived_at', 'created_at', 'updated_at',
    'background_file', 'cleaned_background_file', 'plan_situation_background_file',
}
RELATED_STATE_EXCLUDED = {'id', 'plan', 'created_at', 'updated_at'}
MANAGED_RESOURCE_ROLES = {
    'background', 'overlay', 'cleaning_history', 'pictogram', 'template_asset', 'logo',
}


class ProjectArchiveError(ValueError):
    pass


def _json_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if hasattr(value, 'hex') and value.__class__.__name__ == 'UUID':
        return str(value)
    return value


def _model_state(instance, excluded):
    return {
        field.name: _json_value(getattr(instance, field.name))
        for field in instance._meta.concrete_fields
        if field.name not in excluded and not field.is_relation
    }


def canonical_json_bytes(value):
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(',', ':'),
    ).encode('utf-8')


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def _safe_original_name(name, fallback):
    clean = os.path.basename(str(name or fallback)).replace('\x00', '')[:255]
    return clean or fallback


def _asset_extension(original_name, media_type):
    extension = Path(str(original_name or '')).suffix.lower()
    if extension and len(extension) <= 11 and extension[1:].isalnum():
        return extension
    guessed = mimetypes.guess_extension(media_type or '') or '.bin'
    return '.jpg' if guessed == '.jpe' else guessed


def ensure_project_asset(plan, content, *, original_name, media_type='', kind='other'):
    if not isinstance(content, bytes) or not content:
        raise ProjectArchiveError("Une ressource vide ne peut pas être figée.")
    digest = sha256_bytes(content)
    existing = PlanProjectAsset.objects.filter(plan=plan, sha256=digest).first()
    if existing:
        return existing

    media_type = media_type or mimetypes.guess_type(original_name or '')[0] or 'application/octet-stream'
    original_name = _safe_original_name(original_name, f'{digest}.bin')
    asset = PlanProjectAsset(
        plan=plan,
        sha256=digest,
        original_name=original_name,
        media_type=media_type[:100],
        size=len(content),
        kind=kind[:32],
    )
    asset.file.save(
        f'{digest}{_asset_extension(original_name, media_type)}',
        ContentFile(content),
        save=False,
    )
    asset.save()
    return asset


def _read_field_file(field_file):
    if not field_file or not field_file.name:
        return None
    try:
        with field_file.open('rb') as source:
            return source.read()
    except (OSError, ValueError):
        return None


def bind_project_resource(plan, *, role, key, asset, metadata=None):
    resource, _created = PlanProjectResource.objects.update_or_create(
        plan=plan,
        role=role,
        key=str(key)[:255],
        defaults={'asset': asset, 'metadata': metadata or {}},
    )
    return resource


def bind_field_resource(plan, *, role, key, field_file, kind, metadata=None):
    content = _read_field_file(field_file)
    if content is None:
        return PlanProjectResource.objects.filter(plan=plan, role=role, key=key).first()
    name = os.path.basename(field_file.name)
    asset = ensure_project_asset(
        plan,
        content,
        original_name=name,
        media_type=mimetypes.guess_type(name)[0] or 'application/octet-stream',
        kind=kind,
    )
    return bind_project_resource(
        plan,
        role=role,
        key=key,
        asset=asset,
        metadata=metadata,
    )


def _icon_types_in_project(plan):
    icon_types = set(plan.icons.values_list('icon_type', flat=True))

    def visit(value):
        if isinstance(value, dict):
            icon_type = value.get('iconType') or value.get('icon_type')
            if isinstance(icon_type, str) and icon_type:
                icon_types.add(icon_type)
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(plan.template_snapshot)
    visit(plan.plan_situation_config)
    return sorted(icon_types)


def _capture_pictograms(plan, pictogram_sources, allowed_media_paths, active_keys, warnings):
    sources = {
        str(item.get('icon_type')): item
        for item in (pictogram_sources or [])
        if isinstance(item, dict) and item.get('icon_type')
    }
    allowed_media_paths = set(allowed_media_paths or [])

    for icon_type in _icon_types_in_project(plan):
        source = sources.get(icon_type, {})
        metadata = {
            'label': str(source.get('label') or icon_type)[:255],
            'standard': str(source.get('standard') or '')[:64],
            'standard_label': str(source.get('standard_label') or '')[:255],
            'category': str(source.get('category') or '')[:100],
            'category_label': str(source.get('category_label') or '')[:255],
        }
        content = None
        original_name = f'{icon_type}.svg'
        media_type = 'image/svg+xml'
        svg_text = source.get('svg_text')
        media_path = str(source.get('file_name') or '').replace('\\', '/').strip('/')

        if isinstance(svg_text, str) and svg_text:
            sanitized, error = validate_and_sanitize_pictogram_svg(svg_text.encode('utf-8'))
            if error:
                warnings.append({'role': 'pictogram', 'key': icon_type, 'error': error})
            else:
                content = sanitized
        elif media_path and media_path in allowed_media_paths:
            try:
                with default_storage.open(media_path, 'rb') as pictogram_file:
                    raw = pictogram_file.read()
                if media_path.lower().endswith('.svg'):
                    content, error = validate_and_sanitize_pictogram_svg(raw)
                    if error:
                        warnings.append({'role': 'pictogram', 'key': icon_type, 'error': error})
                else:
                    content = raw
                    media_type = mimetypes.guess_type(media_path)[0] or 'application/octet-stream'
                original_name = os.path.basename(media_path)
            except OSError:
                content = None

        resource = None
        if content:
            asset = ensure_project_asset(
                plan,
                content,
                original_name=original_name,
                media_type=media_type,
                kind='pictogram',
            )
            resource = bind_project_resource(
                plan,
                role='pictogram',
                key=icon_type,
                asset=asset,
                metadata=metadata,
            )
        else:
            resource = PlanProjectResource.objects.filter(
                plan=plan, role='pictogram', key=icon_type
            ).first()

        if resource:
            active_keys.add(('pictogram', icon_type))
        else:
            warnings.append({
                'role': 'pictogram',
                'key': icon_type,
                'error': "Le fichier source du pictogramme n’est pas disponible.",
            })


def _capture_template_assets(plan, actor, active_keys, warnings):
    asset_ids = set()

    def visit(value):
        if isinstance(value, dict):
            asset_id = value.get('assetId') or value.get('asset_id')
            if asset_id:
                asset_ids.add(str(asset_id))
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(plan.template_snapshot)
    owner_ids = accessible_library_owner_ids(actor) if actor else {plan.user_id}
    for asset_id in sorted(asset_ids):
        source_asset = SheetTemplateAsset.objects.filter(
            user_id__in=owner_ids,
            asset_id=asset_id,
        ).first()
        resource = None
        if source_asset:
            resource = bind_field_resource(
                plan,
                role='template_asset',
                key=asset_id,
                field_file=source_asset.image_file,
                kind='template_asset',
                metadata={
                    'name': source_asset.name,
                    'width': source_asset.width,
                    'height': source_asset.height,
                },
            )
        if resource is None:
            resource = PlanProjectResource.objects.filter(
                plan=plan, role='template_asset', key=asset_id
            ).first()
        if resource:
            active_keys.add(('template_asset', asset_id))
        else:
            warnings.append({
                'role': 'template_asset', 'key': asset_id,
                'error': "Le fond du template n’est pas disponible.",
            })


def _capture_data_url_logo(plan, key, value, active_keys, warnings):
    if not isinstance(value, str) or not value.startswith('data:image/') or ';base64,' not in value:
        return
    header, encoded = value.split(';base64,', 1)
    try:
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError):
        warnings.append({'role': 'logo', 'key': key, 'error': 'Logo encodé invalide.'})
        return
    if len(content) > 8 * 1024 * 1024:
        warnings.append({'role': 'logo', 'key': key, 'error': 'Logo trop volumineux.'})
        return
    media_type = header[5:] if header.startswith('data:') else 'image/png'
    asset = ensure_project_asset(
        plan,
        content,
        original_name=f'{key}{_asset_extension("", media_type)}',
        media_type=media_type,
        kind='logo',
    )
    bind_project_resource(plan, role='logo', key=key, asset=asset)
    active_keys.add(('logo', key))


def _capture_plan_resources(plan, actor=None, pictogram_sources=None, allowed_media_paths=None):
    active_keys = set()
    warnings = []

    for key, field_file in (
        ('original', plan.background_file),
        ('cleaned', plan.cleaned_background_file),
        ('situation', plan.plan_situation_background_file),
    ):
        if not field_file or not field_file.name:
            continue
        resource = bind_field_resource(
            plan, role='background', key=key, field_file=field_file, kind='background'
        )
        if resource:
            active_keys.add(('background', key))
        else:
            warnings.append({'role': 'background', 'key': key, 'error': 'Fichier inaccessible.'})

    for overlay in plan.overlays.all():
        for suffix, field_file in (
            ('image', overlay.image_file),
            ('original', overlay.original_image_file),
        ):
            if not field_file or not field_file.name:
                continue
            key = f'{overlay.pk}:{suffix}'
            resource = bind_field_resource(
                plan,
                role='overlay',
                key=key,
                field_file=field_file,
                kind='overlay',
                metadata={'overlay_id': overlay.pk, 'slot': suffix},
            )
            if resource:
                active_keys.add(('overlay', key))

    for history in plan.cleaning_history.all():
        key = str(history.pk)
        resource = bind_field_resource(
            plan,
            role='cleaning_history',
            key=key,
            field_file=history.image_file,
            kind='history',
            metadata={'title': history.title, 'method': history.cleaning_method},
        )
        if resource:
            active_keys.add(('cleaning_history', key))

    _capture_pictograms(plan, pictogram_sources, allowed_media_paths, active_keys, warnings)
    _capture_template_assets(plan, actor, active_keys, warnings)
    watermark = plan.watermark_config if isinstance(plan.watermark_config, dict) else {}
    _capture_data_url_logo(plan, 'client', watermark.get('client_logo'), active_keys, warnings)
    _capture_data_url_logo(plan, 'studio', watermark.get('creator_logo'), active_keys, warnings)

    for resource in PlanProjectResource.objects.filter(plan=plan, role__in=MANAGED_RESOURCE_ROLES):
        if (resource.role, resource.key) not in active_keys:
            resource.delete()
    return warnings


def _build_manifest(plan, warnings, revision_number, previous_hash, reason):
    resources = [
        {
            'role': resource.role,
            'key': resource.key,
            'sha256': resource.asset.sha256,
            'originalName': resource.asset.original_name,
            'mediaType': resource.asset.media_type,
            'size': resource.asset.size,
            'metadata': resource.metadata,
        }
        for resource in plan.project_resources.select_related('asset').order_by('role', 'key')
    ]
    overlays = []
    for overlay in plan.overlays.all():
        row = _model_state(overlay, RELATED_STATE_EXCLUDED | {'image_file', 'original_image_file'})
        row['sourceId'] = overlay.pk
        row['imageResourceKey'] = f'{overlay.pk}:image'
        row['originalResourceKey'] = f'{overlay.pk}:original' if overlay.original_image_file else ''
        overlays.append(row)
    histories = []
    for history in plan.cleaning_history.all():
        row = _model_state(history, RELATED_STATE_EXCLUDED | {'user', 'image_file'})
        row['sourceId'] = history.pk
        row['resourceKey'] = str(history.pk)
        histories.append(row)

    return {
        'format': PROJECT_ARCHIVE_FORMAT,
        'schemaVersion': PROJECT_SCHEMA_VERSION,
        'project': {
            'uuid': str(plan.project_uuid),
            'title': plan.title,
            'folderName': plan.folder.name if plan.folder_id else '',
        },
        'revision': {
            'number': revision_number,
            'reason': reason,
            'createdAt': timezone.now().isoformat(),
            'previousManifestSha256': previous_hash,
        },
        'state': {
            'plan': _model_state(plan, PLAN_STATE_EXCLUDED),
            'icons': [_model_state(item, RELATED_STATE_EXCLUDED) for item in plan.icons.all()],
            'shapes': [_model_state(item, RELATED_STATE_EXCLUDED) for item in plan.shapes.all()],
            'texts': [_model_state(item, RELATED_STATE_EXCLUDED) for item in plan.texts.all()],
            'overlays': overlays,
            'cleaningHistory': histories,
        },
        'resources': resources,
        'warnings': warnings,
    }


@transaction.atomic
def capture_project_revision(
    plan,
    *,
    actor=None,
    reason=PlanProjectRevision.REASON_SAVE,
    pictogram_sources=None,
    allowed_media_paths=None,
):
    plan = EvacuationPlan.objects.select_for_update().get(pk=plan.pk)
    warnings = _capture_plan_resources(
        plan,
        actor=actor,
        pictogram_sources=pictogram_sources,
        allowed_media_paths=allowed_media_paths,
    )
    previous = plan.project_revisions.order_by('-revision_number').first()
    number = (previous.revision_number if previous else 0) + 1
    previous_hash = previous.manifest_sha256 if previous else ''
    manifest = _build_manifest(plan, warnings, number, previous_hash, reason)
    digest = sha256_bytes(canonical_json_bytes(manifest))
    return PlanProjectRevision.objects.create(
        plan=plan,
        revision_number=number,
        schema_version=PROJECT_SCHEMA_VERSION,
        reason=reason,
        manifest=manifest,
        manifest_sha256=digest,
        previous_manifest_sha256=previous_hash,
        created_by=actor if getattr(actor, 'is_authenticated', False) else None,
    )


@transaction.atomic
def clone_project_resources(source_plan, target_plan, *, actor=None):
    """Copy every frozen byte into the duplicate's own project namespace."""
    asset_map = {}
    for source_asset in source_plan.project_assets.all():
        content = _read_field_file(source_asset.file)
        if content is None:
            continue
        asset_map[source_asset.pk] = ensure_project_asset(
            target_plan,
            content,
            original_name=source_asset.original_name,
            media_type=source_asset.media_type,
            kind=source_asset.kind,
        )
    for source_resource in source_plan.project_resources.all():
        target_asset = asset_map.get(source_resource.asset_id)
        if target_asset:
            bind_project_resource(
                target_plan,
                role=source_resource.role,
                key=source_resource.key,
                asset=target_asset,
                metadata=source_resource.metadata,
            )
    return capture_project_revision(
        target_plan,
        actor=actor,
        reason=PlanProjectRevision.REASON_DUPLICATE,
    )


def project_pictograms(plan, request=None):
    from .media_access import build_protected_media_url

    result = []
    labels = {}
    if request is not None and getattr(request, 'user', None) and request.user.is_authenticated:
        labels = {
            item.icon_type: (item.label, 'all')
            for item in UserPictogramLabel.objects.filter(user=request.user, plan__isnull=True)
        }
        labels.update({
            item.icon_type: (item.label, 'plan')
            for item in UserPictogramLabel.objects.filter(user=request.user, plan=plan)
        })
    resources = plan.project_resources.filter(role='pictogram').select_related('asset')
    for resource in resources:
        metadata = resource.metadata if isinstance(resource.metadata, dict) else {}
        original_label = metadata.get('label') or resource.key
        custom_label, custom_label_scope = labels.get(resource.key, ('', None))
        result.append({
            'type': resource.key,
            'label': custom_label or original_label,
            'original_label': original_label,
            'custom_label': custom_label,
            'custom_label_scope': custom_label_scope,
            'file_name': resource.asset.file.name,
            'url': build_protected_media_url(request, resource.asset.file.name),
            'standard': metadata.get('standard') or 'project',
            'standard_label': metadata.get('standard_label') or 'Ressources figées du projet',
            'category': metadata.get('category') or 'snapshot',
            'category_label': metadata.get('category_label') or 'Copies du projet',
            'sha256': resource.asset.sha256,
            'deletable': False,
        })
    return result


def verify_project_integrity(plan):
    errors = []
    checked_assets = 0
    for asset in plan.project_assets.all():
        checked_assets += 1
        if not asset.file or not default_storage.exists(asset.file.name):
            errors.append({'type': 'missing_asset', 'sha256': asset.sha256})
            continue
        digest = hashlib.sha256()
        size = 0
        try:
            with asset.file.open('rb') as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    digest.update(chunk)
                    size += len(chunk)
        except OSError:
            errors.append({'type': 'unreadable_asset', 'sha256': asset.sha256})
            continue
        if digest.hexdigest() != asset.sha256 or size != asset.size:
            errors.append({'type': 'asset_hash_mismatch', 'sha256': asset.sha256})

    previous_hash = ''
    revisions = list(plan.project_revisions.order_by('revision_number'))
    for revision in revisions:
        calculated = sha256_bytes(canonical_json_bytes(revision.manifest))
        if calculated != revision.manifest_sha256:
            errors.append({'type': 'manifest_hash_mismatch', 'revision': revision.revision_number})
        if revision.previous_manifest_sha256 != previous_hash:
            errors.append({'type': 'revision_chain_broken', 'revision': revision.revision_number})
        previous_hash = revision.manifest_sha256

    latest_warnings = revisions[-1].manifest.get('warnings', []) if revisions else []
    return {
        'ok': not errors and not latest_warnings,
        'errors': errors,
        'warnings': latest_warnings,
        'assetsChecked': checked_assets,
        'revisionsChecked': len(revisions),
        'latestRevision': revisions[-1].revision_number if revisions else None,
    }


def _resource_asset_map(plan, manifest):
    assets = {asset.sha256: asset for asset in plan.project_assets.all()}
    return {
        (item.get('role'), item.get('key')): assets.get(item.get('sha256'))
        for item in manifest.get('resources', [])
        if isinstance(item, dict)
    }


def _copy_asset_to_field(asset, field_file, fallback_name):
    if asset is None or not asset.file:
        raise ProjectArchiveError(f"Ressource manquante : {fallback_name}.")
    with asset.file.open('rb') as source:
        field_file.save(asset.original_name or fallback_name, ContentFile(source.read()), save=False)


def _filtered_model_values(model, values, excluded):
    allowed = {
        field.name for field in model._meta.concrete_fields
        if field.name not in excluded and not field.is_relation
    }
    return {key: value for key, value in values.items() if key in allowed}


@transaction.atomic
def restore_project_revision(
    plan,
    revision,
    *,
    actor=None,
    title_override=None,
    reason=PlanProjectRevision.REASON_RESTORE,
):
    if revision.plan_id != plan.id:
        raise ProjectArchiveError("Cette révision n’appartient pas au projet.")
    if sha256_bytes(canonical_json_bytes(revision.manifest)) != revision.manifest_sha256:
        raise ProjectArchiveError("Le manifeste de cette révision est corrompu.")

    manifest = revision.manifest
    state = manifest.get('state')
    if not isinstance(state, dict):
        raise ProjectArchiveError("L’état de la révision est invalide.")
    resources = _resource_asset_map(plan, manifest)

    for field, value in _filtered_model_values(EvacuationPlan, state.get('plan', {}), PLAN_STATE_EXCLUDED).items():
        setattr(plan, field, value)
    if title_override is not None:
        plan.title = str(title_override).strip()[:255] or 'Projet importé'
    original_asset = resources.get(('background', 'original'))
    if original_asset:
        _copy_asset_to_field(original_asset, plan.background_file, 'plan-original.bin')
    cleaned_asset = resources.get(('background', 'cleaned'))
    if cleaned_asset:
        _copy_asset_to_field(cleaned_asset, plan.cleaned_background_file, 'plan-nettoye.png')
    else:
        plan.cleaned_background_file = None
    situation_asset = resources.get(('background', 'situation'))
    if situation_asset:
        _copy_asset_to_field(situation_asset, plan.plan_situation_background_file, 'plan-situation.png')
    else:
        plan.plan_situation_background_file = None
    plan.save()

    plan.icons.all().delete()
    PlanIcon.objects.bulk_create([
        PlanIcon(plan=plan, **_filtered_model_values(PlanIcon, row, RELATED_STATE_EXCLUDED))
        for row in state.get('icons', []) if isinstance(row, dict)
    ])
    plan.shapes.all().delete()
    PlanShape.objects.bulk_create([
        PlanShape(plan=plan, **_filtered_model_values(PlanShape, row, RELATED_STATE_EXCLUDED))
        for row in state.get('shapes', []) if isinstance(row, dict)
    ])
    plan.texts.all().delete()
    PlanText.objects.bulk_create([
        PlanText(plan=plan, **_filtered_model_values(PlanText, row, RELATED_STATE_EXCLUDED))
        for row in state.get('texts', []) if isinstance(row, dict)
    ])

    plan.overlays.all().delete()
    for row in state.get('overlays', []):
        if not isinstance(row, dict):
            continue
        overlay = PlanOverlay(
            plan=plan,
            **_filtered_model_values(
                PlanOverlay,
                row,
                RELATED_STATE_EXCLUDED | {'image_file', 'original_image_file'},
            ),
        )
        _copy_asset_to_field(
            resources.get(('overlay', row.get('imageResourceKey'))),
            overlay.image_file,
            'overlay.png',
        )
        original = resources.get(('overlay', row.get('originalResourceKey')))
        if original:
            _copy_asset_to_field(original, overlay.original_image_file, 'overlay-original.png')
        overlay.save()

    plan.cleaning_history.all().delete()
    for row in state.get('cleaningHistory', []):
        if not isinstance(row, dict):
            continue
        history = PlanCleaningHistory(
            plan=plan,
            user=actor if getattr(actor, 'is_authenticated', False) else plan.user,
            **_filtered_model_values(
                PlanCleaningHistory,
                row,
                RELATED_STATE_EXCLUDED | {'user', 'image_file'},
            ),
        )
        _copy_asset_to_field(
            resources.get(('cleaning_history', row.get('resourceKey'))),
            history.image_file,
            'historique-plan.png',
        )
        history.save()

    # Rebind the logical resources to the exact bytes referenced by the restored manifest.
    resource_rows = {
        (item.get('role'), item.get('key')): item
        for item in manifest.get('resources', []) if isinstance(item, dict)
    }
    for (role, key), item in resource_rows.items():
        asset = resources.get((role, key))
        if asset:
            bind_project_resource(
                plan, role=role, key=key, asset=asset, metadata=item.get('metadata') or {}
            )

    return capture_project_revision(
        plan,
        actor=actor,
        reason=reason,
    )


def build_project_zip(plan):
    latest = plan.project_revisions.order_by('-revision_number').first()
    if latest is None:
        latest = capture_project_revision(plan, actor=None, reason=PlanProjectRevision.REASON_BOOTSTRAP)

    output = tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024, mode='w+b')
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.writestr('manifest.json', json.dumps(latest.manifest, ensure_ascii=False, indent=2))
        for revision in plan.project_revisions.order_by('revision_number'):
            archive.writestr(
                f'revisions/{revision.revision_number:06d}.json',
                json.dumps({
                    'manifest': revision.manifest,
                    'manifestSha256': revision.manifest_sha256,
                    'previousManifestSha256': revision.previous_manifest_sha256,
                }, ensure_ascii=False, indent=2),
            )
        for asset in plan.project_assets.all():
            if not asset.file or not default_storage.exists(asset.file.name):
                continue
            extension = _asset_extension(asset.original_name, asset.media_type)
            with asset.file.open('rb') as source, archive.open(f'assets/{asset.sha256}{extension}', 'w') as target:
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    target.write(chunk)
        archive.writestr(
            'LISEZ-MOI.txt',
            "Projet autonome EvacStudio. Le fichier manifest.json et les ressources sont vérifiés par SHA-256.\n",
        )
    output.seek(0)
    return output


def inspect_project_zip(upload):
    if getattr(upload, 'size', 0) > MAX_PROJECT_ZIP_BYTES:
        raise ProjectArchiveError("L’archive dépasse la taille maximale de 250 Mo.")
    try:
        archive = zipfile.ZipFile(upload)
    except (zipfile.BadZipFile, OSError):
        raise ProjectArchiveError("Le fichier n’est pas une archive EvacStudio valide.") from None
    infos = archive.infolist()
    if len(infos) > MAX_PROJECT_ZIP_ENTRIES:
        archive.close()
        raise ProjectArchiveError("L’archive contient trop de fichiers.")
    names = [info.filename.replace('\\', '/') for info in infos]
    if len(names) != len(set(names)):
        archive.close()
        raise ProjectArchiveError("L’archive contient des entrées en double.")
    total_size = 0
    for info in infos:
        normalized = info.filename.replace('\\', '/')
        if normalized.startswith('/') or '..' in normalized.split('/'):
            archive.close()
            raise ProjectArchiveError("L’archive contient un chemin interdit.")
        if info.is_dir():
            continue
        total_size += info.file_size
        if info.compress_size and info.file_size > max(10 * 1024 * 1024, info.compress_size * 200):
            archive.close()
            raise ProjectArchiveError("L’archive contient un fichier anormalement compressé.")
    if total_size > MAX_PROJECT_ZIP_UNCOMPRESSED_BYTES:
        archive.close()
        raise ProjectArchiveError("Le contenu décompressé dépasse 750 Mo.")
    manifest_info = next((info for info in infos if info.filename == 'manifest.json'), None)
    if manifest_info is None or manifest_info.file_size > MAX_TEMPLATE_SNAPSHOT_BYTES:
        archive.close()
        raise ProjectArchiveError("Le manifeste du projet est absent ou trop volumineux.")
    try:
        manifest = json.loads(archive.read('manifest.json'))
    except (KeyError, json.JSONDecodeError, UnicodeDecodeError):
        archive.close()
        raise ProjectArchiveError("Le manifeste du projet est absent ou invalide.") from None
    if manifest.get('format') != PROJECT_ARCHIVE_FORMAT or manifest.get('schemaVersion') != 1:
        archive.close()
        raise ProjectArchiveError("Ce format de projet n’est pas pris en charge.")
    return archive, manifest


def _read_revision_history(archive, latest_manifest):
    infos = sorted(
        (
            info for info in archive.infolist()
            if re.fullmatch(r'revisions/[0-9]{6}\.json', info.filename)
        ),
        key=lambda info: info.filename,
    )
    history = []
    previous_hash = ''
    for expected_number, info in enumerate(infos, start=1):
        if info.file_size > MAX_TEMPLATE_SNAPSHOT_BYTES:
            raise ProjectArchiveError("Une révision du projet est trop volumineuse.")
        try:
            payload = json.loads(archive.read(info))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ProjectArchiveError("Une révision du projet est invalide.") from None
        revision_manifest = payload.get('manifest') if isinstance(payload, dict) else None
        if not isinstance(revision_manifest, dict):
            raise ProjectArchiveError("Une révision ne contient pas de manifeste valide.")
        revision_number = revision_manifest.get('revision', {}).get('number')
        digest = str(payload.get('manifestSha256') or '')
        declared_previous = str(payload.get('previousManifestSha256') or '')
        if revision_number != expected_number:
            raise ProjectArchiveError("La numérotation des révisions est incomplète.")
        if not SHA256_PATTERN.fullmatch(digest):
            raise ProjectArchiveError("L’empreinte d’une révision est invalide.")
        if digest != sha256_bytes(canonical_json_bytes(revision_manifest)):
            raise ProjectArchiveError(f"La révision {revision_number} est corrompue.")
        if declared_previous != previous_hash:
            raise ProjectArchiveError(f"La chaîne est rompue à la révision {revision_number}.")
        history.append((revision_manifest, digest, declared_previous))
        previous_hash = digest

    if history and canonical_json_bytes(history[-1][0]) != canonical_json_bytes(latest_manifest):
        raise ProjectArchiveError("Le manifeste courant ne correspond pas à la dernière révision.")
    return history


@transaction.atomic
def import_project_zip(upload, *, owner, title=''):
    archive, manifest = inspect_project_zip(upload)
    try:
        history = _read_revision_history(archive, manifest)
        state = manifest.get('state') or {}
        plan_state = state.get('plan') or {}
        resource_rows = [item for item in manifest.get('resources', []) if isinstance(item, dict)]
        all_resource_rows = list(resource_rows)
        for historical_manifest, _digest, _previous in history:
            all_resource_rows.extend(
                item for item in historical_manifest.get('resources', []) if isinstance(item, dict)
            )
        resource_by_key = {(item.get('role'), item.get('key')): item for item in resource_rows}
        background_row = resource_by_key.get(('background', 'original'))
        if not background_row:
            raise ProjectArchiveError("Le plan original est absent de l’archive.")

        values = _filtered_model_values(EvacuationPlan, plan_state, PLAN_STATE_EXCLUDED)
        values['title'] = str(title or values.get('title') or 'Projet importé').strip()[:255]
        values['building_name'] = str(values.get('building_name') or 'Bâtiment')[:255]
        values['floor_name'] = str(values.get('floor_name') or 'Niveau')[:255]
        plan = EvacuationPlan(user=owner, **values)

        asset_bytes = {}
        for row in all_resource_rows:
            digest = str(row.get('sha256') or '')
            if not SHA256_PATTERN.fullmatch(digest):
                raise ProjectArchiveError("Une empreinte de ressource est invalide.")
            if digest in asset_bytes:
                continue
            matches = [
                info for info in archive.infolist()
                if info.filename.startswith(f'assets/{digest}.') and not info.is_dir()
            ]
            if len(matches) != 1:
                raise ProjectArchiveError(f"Ressource {digest[:12]} absente de l’archive.")
            content = archive.read(matches[0])
            if sha256_bytes(content) != digest:
                raise ProjectArchiveError(f"Ressource {digest[:12]} corrompue.")
            asset_bytes[digest] = content

        background_bytes = asset_bytes.get(background_row.get('sha256'))
        if not background_bytes:
            raise ProjectArchiveError("Le fond original du plan est vide.")
        plan.background_file.save(
            background_row.get('originalName') or 'plan-original.bin',
            ContentFile(background_bytes),
            save=False,
        )
        plan.save()

        assets = {}
        for row in all_resource_rows:
            digest = row.get('sha256')
            if digest in assets:
                continue
            assets[digest] = ensure_project_asset(
                plan,
                asset_bytes[digest],
                original_name=row.get('originalName') or f'{digest}.bin',
                media_type=row.get('mediaType') or 'application/octet-stream',
                kind=row.get('role') or 'other',
            )
        for row in resource_rows:
            bind_project_resource(
                plan,
                role=str(row.get('role') or 'other')[:40],
                key=str(row.get('key') or '')[:255],
                asset=assets[row['sha256']],
                metadata=row.get('metadata') if isinstance(row.get('metadata'), dict) else {},
            )

        if history:
            for historical_manifest, digest, previous_hash in history:
                revision_data = historical_manifest.get('revision', {})
                PlanProjectRevision.objects.create(
                    plan=plan,
                    revision_number=revision_data['number'],
                    schema_version=historical_manifest.get('schemaVersion', PROJECT_SCHEMA_VERSION),
                    reason=str(revision_data.get('reason') or PlanProjectRevision.REASON_SAVE)[:24],
                    manifest=historical_manifest,
                    manifest_sha256=digest,
                    previous_manifest_sha256=previous_hash,
                )
            imported_revision = plan.project_revisions.get(
                revision_number=history[-1][0]['revision']['number']
            )
        else:
            imported_manifest = json.loads(json.dumps(manifest))
            imported_manifest['revision'] = {
                'number': 1,
                'reason': PlanProjectRevision.REASON_IMPORT,
                'createdAt': timezone.now().isoformat(),
                'previousManifestSha256': '',
            }
            digest = sha256_bytes(canonical_json_bytes(imported_manifest))
            imported_revision = PlanProjectRevision.objects.create(
                plan=plan,
                revision_number=1,
                reason=PlanProjectRevision.REASON_IMPORT,
                manifest=imported_manifest,
                manifest_sha256=digest,
            )

        restore_project_revision(
            plan,
            imported_revision,
            actor=owner,
            title_override=plan.title,
            reason=PlanProjectRevision.REASON_IMPORT,
        )
        return EvacuationPlan.objects.get(pk=plan.pk)
    finally:
        archive.close()


def bootstrap_missing_project_archives():
    """Create the first recoverable snapshot for plans predating schema v1."""
    from .views import list_plan_pictograms

    captured = 0
    failed = []
    plans = EvacuationPlan.objects.select_related('user')
    catalog_cache = {}
    for plan in plans.iterator():
        try:
            needs_revision = not plan.project_revisions.exists()
            snapshot_added = False
            if not plan.template_snapshot:
                remembered_version_id = (
                    plan.active_sheet_template_version_id
                    or plan.last_sheet_template_version_id
                )
                if remembered_version_id:
                    owner_ids = accessible_library_owner_ids(plan.user)
                    version = SheetTemplateVersion.objects.filter(
                        user_id__in=owner_ids,
                        version_id=remembered_version_id,
                    ).first()
                    if version:
                        plan.template_snapshot = {
                            'schemaVersion': PROJECT_SCHEMA_VERSION,
                            'templateKey': version.template_key,
                            'versionId': version.version_id,
                            'name': version.name,
                            'blocks': version.blocks,
                            'planPlacement': version.plan_placement,
                        }
                        plan.save(update_fields=['template_snapshot'])
                        snapshot_added = True
            if not needs_revision and not snapshot_added:
                continue
            if plan.user_id not in catalog_cache:
                request = SimpleNamespace(
                    user=plan.user,
                    build_absolute_uri=lambda path: path,
                )
                catalog = list_plan_pictograms(request)
                sources = [
                    {**item, 'icon_type': item.get('type')}
                    for item in catalog if item.get('type')
                ]
                allowed = {
                    str(item.get('file_name') or '').replace('\\', '/').strip('/')
                    for item in catalog if item.get('file_name')
                }
                catalog_cache[plan.user_id] = (sources, allowed)
            sources, allowed = catalog_cache[plan.user_id]
            capture_project_revision(
                plan,
                actor=plan.user,
                reason=PlanProjectRevision.REASON_BOOTSTRAP,
                pictogram_sources=sources,
                allowed_media_paths=allowed,
            )
            captured += 1
        except Exception as error:  # Keep deployment running; report exact plans to repair.
            failed.append({'plan_id': plan.pk, 'error': str(error)})
    return {'captured': captured, 'failed': failed}
