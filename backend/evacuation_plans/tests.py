import base64
import io
import sys
import tempfile
import types
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from .models import (
    EvacuationPlan,
    GrokCleaningJob,
    PlanCleaningHistory,
    PlanIcon,
    PlanOverlay,
    UserXaiSettings,
)


def _png_bytes(color=(0, 0, 0), size=(24, 24)):
    """A tiny PNG, ready to upload as a plan background."""
    image = Image.new("RGB", size, color)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class _PlanFactoryMixin:
    def setUp(self):
        # File storage is not transactional. Give every test its own disposable
        # media root so failures and rollbacks can never litter the real project.
        self._test_media = tempfile.TemporaryDirectory()
        self._media_override = override_settings(MEDIA_ROOT=self._test_media.name)
        self._media_override.enable()
        super().setUp()

    def tearDown(self):
        try:
            super().tearDown()
        finally:
            self._media_override.disable()
            self._test_media.cleanup()

    def make_plan(self, user, background_bytes=None, name="plan"):
        background_bytes = background_bytes or _png_bytes(color=(255, 255, 255))
        plan = EvacuationPlan.objects.create(
            user=user,
            title=name,
            building_name="B",
            floor_name="F",
            background_type="image",
        )
        plan.background_file.save(f"{name}.png", ContentFile(background_bytes), save=True)
        return plan

    def authed_client(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client


class UserRegistrationTests(TestCase):
    def test_user_registration(self):
        client = APIClient()
        response = client.post(
            "/api/auth/register/",
            {"username": "alice", "email": "alice@example.com", "password": "longsecret-1"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(User.objects.filter(username="alice").exists())


class AuthTests(TestCase):
    def test_user_login_and_jwt(self):
        User.objects.create_user(username="bob", password="longsecret-1")
        client = APIClient()
        response = client.post(
            "/api/auth/token/",
            {"username": "bob", "password": "longsecret-1"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.json())


class PlansCrudTests(_PlanFactoryMixin, TestCase):
    def test_plans_crud_unauthenticated(self):
        # Anonymous users must not reach the plans list.
        client = APIClient()
        self.assertEqual(client.get("/api/plans/").status_code, 401)

    def test_plans_crud_authenticated(self):
        user = User.objects.create_user(username="carol", password="longsecret-1")
        client = self.authed_client(user)
        self.make_plan(user)

        response = client.get("/api/plans/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 1)

    def test_create_pdf_plan_authenticated(self):
        user = User.objects.create_user(username="dave", password="longsecret-1")
        client = self.authed_client(user)
        pdf_bytes = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
        response = client.post(
            "/api/plans/",
            {
                "title": "PDF plan",
                "building_name": "B",
                "floor_name": "F",
                "background_type": "pdf",
                "background_file": io.BytesIO(pdf_bytes),
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 201)


class LocalCleaningTests(_PlanFactoryMixin, TestCase):
    def test_clean_and_revert_plan(self):
        user = User.objects.create_user(username="erin", password="longsecret-1")
        plan = self.make_plan(user)
        client = self.authed_client(user)

        clean = client.post(f"/api/plans/{plan.id}/clean/")
        self.assertEqual(clean.status_code, 200)
        plan.refresh_from_db()
        self.assertTrue(plan.use_cleaned_background)

        revert = client.post(f"/api/plans/{plan.id}/revert/")
        self.assertEqual(revert.status_code, 200)
        plan.refresh_from_db()
        self.assertFalse(plan.use_cleaned_background)

    def test_clean_walls_plan(self):
        user = User.objects.create_user(username="frank", password="longsecret-1")
        plan = self.make_plan(user)
        client = self.authed_client(user)

        response = client.post(f"/api/plans/{plan.id}/clean-walls/")
        self.assertEqual(response.status_code, 200)
        plan.refresh_from_db()
        self.assertTrue(plan.use_cleaned_background)

    def test_local_clean_creates_cleaning_history_entry(self):
        user = User.objects.create_user(username="gina", password="longsecret-1")
        plan = self.make_plan(user)
        client = self.authed_client(user)

        client.post(f"/api/plans/{plan.id}/clean/")
        self.assertEqual(
            PlanCleaningHistory.objects.filter(plan=plan, cleaning_method=PlanCleaningHistory.METHOD_LOCAL).count(),
            1,
        )


class CleaningHistoryTests(_PlanFactoryMixin, TestCase):
    def test_cleaning_history_lists_cleaned_plan_versions(self):
        user = User.objects.create_user(username="hank", password="longsecret-1")
        plan = self.make_plan(user)
        client = self.authed_client(user)

        client.post(f"/api/plans/{plan.id}/clean/")
        response = client.get(f"/api/plans/{plan.id}/cleaning-history/")
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(response.json()), 1)

    def test_use_cleaning_history_applies_selected_cleaned_version(self):
        user = User.objects.create_user(username="ivy", password="longsecret-1")
        plan = self.make_plan(user)
        client = self.authed_client(user)

        client.post(f"/api/plans/{plan.id}/clean/")
        history = PlanCleaningHistory.objects.filter(plan=plan).first()
        self.assertIsNotNone(history)

        # Reset to original, then restore the cleaned version from history.
        plan.use_cleaned_background = False
        plan.save(update_fields=["use_cleaned_background"])
        response = client.post(
            f"/api/plans/{plan.id}/use-cleaning-history/",
            {"history_id": history.id},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        plan.refresh_from_db()
        self.assertTrue(plan.use_cleaned_background)


class EditorSyncTests(_PlanFactoryMixin, TestCase):
    def editor_payload(self, image_data):
        return {
            "icons": [{
                "icon_type": "extincteur",
                "x": 10,
                "y": 20,
                "width": 40,
                "height": 40,
                "rotation": 0,
                "label": "E1",
                "locked": True,
                "group_id": "plan-group-test",
                "object_group_id": "object-group-test",
            }],
            "shapes": [{
                "shape_type": "rect",
                "x": 20,
                "y": 30,
                "width": 100,
                "height": 60,
                "rotation": 0,
                "stroke_width": 3,
                "color": "#ff0000",
                "fill_color": None,
                "fill_opacity": None,
                "tension": None,
                "control_points": {},
                "points": None,
                "locked": False,
                "group_id": "plan-group-test",
                "object_group_id": "object-group-test",
            }],
            "texts": [{
                "text": "Sortie",
                "x": 50,
                "y": 60,
                "font_size": 24,
                "font_family": "Arial",
                "color": "#000000",
                "bold": False,
                "italic": False,
                "background_color": None,
                "rotation": 0,
                "locked": False,
                "group_id": "plan-group-test",
                "object_group_id": "object-group-test",
            }],
            "overlays": [{
                "image_data": image_data,
                "x": 120,
                "y": 90,
                "width": 450,
                "height": 300,
                "rotation": 12,
                "label": "Étage 2",
                "locked": True,
                "group_id": "plan-group-test",
            }],
            "plan_settings": {
                "main_plan_x": 45,
                "main_plan_y": 30,
                "main_plan_width": 900,
                "main_plan_height": 650,
                "main_plan_locked": True,
                "main_plan_group_id": "plan-group-main",
                "main_plan_grouping_enabled": True,
                "watermark": {
                    "enabled": True,
                    "text": "BON À TIRER",
                    "client": "Client test",
                    "reference": "BAT-42",
                    "date": "2026-08-10",
                    "comment": "Validation interne",
                    "client_logo": image_data,
                    "creator_logo": image_data,
                    "show_bat_block": True,
                    "repeat": True,
                    "diagonal": True,
                    "block_x": 0.7,
                    "block_y": 0.6,
                    "block_locked": False,
                },
            },
        }

    def test_sync_editor_persists_complete_visual_state(self):
        user = User.objects.create_user(username="editor", password="longsecret-1")
        plan = self.make_plan(user)
        client = self.authed_client(user)
        image_data = "data:image/png;base64," + base64.b64encode(_png_bytes()).decode("ascii")

        response = client.post(
            f"/api/plans/{plan.id}/sync-editor/",
            self.editor_payload(image_data),
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        plan.refresh_from_db()
        self.assertEqual(plan.main_plan_x, 45)
        self.assertTrue(plan.main_plan_locked)
        self.assertEqual(plan.main_plan_group_id, "plan-group-main")
        self.assertTrue(plan.main_plan_grouping_enabled)
        self.assertTrue(plan.watermark_config["enabled"])
        self.assertEqual(plan.watermark_config["reference"], "BAT-42")
        self.assertTrue(plan.watermark_config["client_logo"].startswith("data:image/png;base64,"))
        self.assertTrue(plan.watermark_config["creator_logo"].startswith("data:image/png;base64,"))
        self.assertTrue(plan.icons.get().locked)
        self.assertEqual(plan.icons.get().group_id, "plan-group-test")
        self.assertEqual(plan.icons.get().object_group_id, "object-group-test")
        self.assertEqual(plan.shapes.get().group_id, "plan-group-test")
        self.assertEqual(plan.shapes.get().object_group_id, "object-group-test")
        self.assertEqual(plan.texts.get().group_id, "plan-group-test")
        self.assertEqual(plan.texts.get().object_group_id, "object-group-test")
        overlay = plan.overlays.get()
        self.assertTrue(overlay.locked)
        self.assertEqual(overlay.group_id, "plan-group-test")
        self.assertEqual(overlay.rotation, 12)

    def test_sync_editor_validates_before_replacing_existing_layers(self):
        user = User.objects.create_user(username="atomic", password="longsecret-1")
        plan = self.make_plan(user)
        PlanIcon.objects.create(
            plan=plan,
            icon_type="existant",
            x=1,
            y=2,
            width=30,
            height=30,
        )
        client = self.authed_client(user)
        for invalid_image in ("data:image/png;base64,not-valid-base64", "not-a-data-url"):
            with self.subTest(invalid_image=invalid_image):
                payload = self.editor_payload(invalid_image)
                response = client.post(f"/api/plans/{plan.id}/sync-editor/", payload, format="json")

                self.assertEqual(response.status_code, 400)
                self.assertEqual(list(plan.icons.values_list("icon_type", flat=True)), ["existant"])
                self.assertFalse(PlanOverlay.objects.filter(plan=plan).exists())


class XaiSettingsTests(_PlanFactoryMixin, TestCase):
    """xAI key CRUD round-trip — no live API call."""

    def test_save_get_delete_xai_key(self):
        user = User.objects.create_user(username="jack", password="longsecret-1")
        client = self.authed_client(user)

        # Initially no key.
        self.assertFalse(client.get("/api/xai-settings/").json()["has_api_key"])

        # Save one.
        save = client.post("/api/xai-settings/save/", {"api_key": "xai-secret-123"}, format="json")
        self.assertEqual(save.status_code, 200)
        self.assertTrue(save.json()["has_api_key"])

        # It is stored encrypted, not in clear text.
        stored = UserXaiSettings.objects.get(user=user)
        self.assertNotIn("xai-secret-123", stored.encrypted_api_key)
        self.assertEqual(stored.get_api_key(), "xai-secret-123")

        # Delete it.
        self.assertEqual(client.delete("/api/xai-settings/delete/").status_code, 204)
        self.assertFalse(client.get("/api/xai-settings/").json()["has_api_key"])

    def test_test_xai_key_marks_invalid_on_grpc_auth_error(self):
        """A gRPC UNAUTHENTICATED must be reported as 'invalide', not crash."""

        class FakeRpcError(Exception):
            class _Code:
                name = "UNAUTHENTICATED"

            def code(self):
                return self._Code

            def details(self):
                return "bad key"

        user = User.objects.create_user(username="kate", password="longsecret-1")
        client = self.authed_client(user)

        def _raise(*_args, **_kwargs):
            raise FakeRpcError()

        fake_sdk = types.ModuleType("xai_sdk")
        fake_sdk.Client = _raise
        fake_chat = types.ModuleType("xai_sdk.chat")
        fake_chat.user = lambda message: message
        with patch.dict(sys.modules, {"xai_sdk": fake_sdk, "xai_sdk.chat": fake_chat}):
            response = client.post("/api/xai/test-key/", {"api_key": "bad"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["result"], "invalide")


class GrokCleaningTests(_PlanFactoryMixin, TestCase):
    def test_grok_clean_requires_xai_key(self):
        user = User.objects.create_user(username="leo", password="longsecret-1")
        plan = self.make_plan(user)
        client = self.authed_client(user)

        response = client.post(f"/api/plans/{plan.id}/grok-clean/")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error_code"], "XAI_KEY_MISSING")

    def test_grok_clean_launches_job_and_succeeds(self):
        """The whole pipeline runs under the mock; the job ends up completed.

        The endpoint normally spins up a daemon thread. Calling the worker
        directly keeps the test deterministic (SQLite is not happy with a
        thread hammering the same table) and still exercises the full lifecycle:
        the endpoint only difference is the thread wrapper.
        """
        from .views import run_grok_cleaning_job
        from .grok_cleaning import GrokCleaningResult

        user = User.objects.create_user(username="mike", password="longsecret-1")
        plan = self.make_plan(user)
        settings_obj = UserXaiSettings.objects.create(user=user)
        settings_obj.set_api_key("xai-secret")
        settings_obj.save()

        job = GrokCleaningJob.objects.create(
            user=user,
            plan=plan,
            status=GrokCleaningJob.STATUS_PENDING,
        )

        fake_result = GrokCleaningResult(
            analysis={"compact_edit_prompt": "p"},
            generation_prompt="p",
            cleaned_image_bytes=_png_bytes(color=(200, 200, 200)),
            analysis_model="grok-4.5",
            image_model="grok-imagine-image-quality",
        )
        with patch("evacuation_plans.views.analyze_and_clean_plan", return_value=fake_result):
            run_grok_cleaning_job(job.id)

        job.refresh_from_db()
        self.assertEqual(job.status, GrokCleaningJob.STATUS_COMPLETED)
        plan.refresh_from_db()
        self.assertTrue(plan.use_cleaned_background)
        self.assertEqual(
            PlanCleaningHistory.objects.filter(plan=plan, cleaning_method=PlanCleaningHistory.METHOD_GROK).count(),
            1,
        )
