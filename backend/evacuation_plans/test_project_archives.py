import io
import shutil
import tempfile
import zipfile

from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from .models import EvacuationPlan, PlanIcon, PlanProjectRevision
from .project_archives import (
    ProjectArchiveError,
    build_project_zip,
    capture_project_revision,
    import_project_zip,
    inspect_project_zip,
    restore_project_revision,
    verify_project_integrity,
)


class AutonomousProjectArchiveTests(TestCase):
    SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="#C1121C" d="M0 0h10v10H0z"/></svg>'

    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='evacstudio-project-test-')
        self.settings_override = self.settings(MEDIA_ROOT=self.media_root)
        self.settings_override.enable()
        self.user = User.objects.create_user(username='project-owner', password='secret123')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)

    def make_plan(self, title='Projet autonome'):
        plan = EvacuationPlan(
            user=self.user,
            title=title,
            building_name='Bâtiment A',
            floor_name='RDC',
            background_type='image',
        )
        plan.background_file.save('plan.png', ContentFile(b'plan-background-bytes'), save=False)
        plan.save()
        return plan

    def freeze_icon(self, plan, x=12):
        PlanIcon.objects.create(
            plan=plan,
            icon_type='extincteur-projet',
            x=x,
            y=20,
            width=40,
            height=40,
        )
        return capture_project_revision(
            plan,
            actor=self.user,
            pictogram_sources=[{
                'icon_type': 'extincteur-projet',
                'label': 'Extincteur',
                'svg_text': self.SVG,
                'standard': 'nfx08070',
                'category': 'incendie',
            }],
        )

    def test_revision_assets_are_content_addressed_and_immutable(self):
        plan = self.make_plan()
        revision = self.freeze_icon(plan)

        self.assertEqual(revision.revision_number, 1)
        pictogram = plan.project_resources.select_related('asset').get(
            role='pictogram', key='extincteur-projet'
        )
        self.assertEqual(len(pictogram.asset.sha256), 64)
        self.assertIn(str(plan.project_uuid), pictogram.asset.file.name)
        self.assertTrue(verify_project_integrity(plan)['ok'])

        revision.reason = 'changed'
        with self.assertRaises(ValidationError):
            revision.save()
        pictogram.asset.original_name = 'changed.svg'
        with self.assertRaises(ValidationError):
            pictogram.asset.save()

    def test_delete_archives_and_restore_reactivates_the_same_project(self):
        plan = self.make_plan()
        self.freeze_icon(plan)

        response = self.client.delete(f'/api/plans/{plan.pk}/')
        self.assertEqual(response.status_code, 204)
        plan.refresh_from_db()
        self.assertIsNotNone(plan.archived_at)
        self.assertFalse(any(item['id'] == plan.pk for item in self.client.get('/api/plans/').json()))
        archived = self.client.get('/api/plans/?archived=true').json()
        self.assertEqual([item['id'] for item in archived], [plan.pk])

        response = self.client.post(f'/api/plans/{plan.pk}/restore-archived/')
        self.assertEqual(response.status_code, 200)
        plan.refresh_from_db()
        self.assertIsNone(plan.archived_at)
        self.assertTrue(plan.project_resources.filter(role='pictogram').exists())

    def test_restore_creates_a_new_revision_without_erasing_history(self):
        plan = self.make_plan()
        first = self.freeze_icon(plan, x=12)
        plan.icons.update(x=88)
        capture_project_revision(plan, actor=self.user)

        restored = restore_project_revision(plan, first, actor=self.user)

        self.assertEqual(plan.icons.get().x, 12)
        self.assertEqual(restored.revision_number, 3)
        self.assertEqual(plan.project_revisions.count(), 3)

    def test_zip_round_trip_keeps_layers_and_frozen_resources(self):
        plan = self.make_plan('Plan à transporter')
        self.freeze_icon(plan)
        archive_file = build_project_zip(plan)
        upload = SimpleUploadedFile(
            'projet.evacstudio.zip',
            archive_file.read(),
            content_type='application/zip',
        )

        imported = import_project_zip(upload, owner=self.user, title='Copie transportée')

        self.assertEqual(imported.title, 'Copie transportée')
        self.assertNotEqual(imported.project_uuid, plan.project_uuid)
        self.assertEqual(imported.icons.get().icon_type, 'extincteur-projet')
        self.assertTrue(imported.project_resources.filter(
            role='pictogram', key='extincteur-projet'
        ).exists())
        self.assertTrue(verify_project_integrity(imported)['ok'])

    def test_zip_with_traversal_entry_is_rejected(self):
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, 'w') as archive:
            archive.writestr('../danger.txt', 'no')
            archive.writestr('manifest.json', '{}')
        payload.seek(0)
        upload = SimpleUploadedFile('danger.zip', payload.read(), content_type='application/zip')

        with self.assertRaises(ProjectArchiveError):
            inspect_project_zip(upload)
