import base64
import io
import os
import sys
import tempfile
import types
from unittest.mock import patch

from datetime import timedelta

from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from .models import (
    EvacuationPlan,
    GrokCleaningJob,
    PlanCleaningHistory,
    PlanIcon,
    PlanOverlay,
    UserXaiSettings,
    WorkspaceInvitation,
    WorkspaceMembership,
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

    def make_overlay(self, plan, image_bytes=None, label="Plan secondaire"):
        overlay = PlanOverlay(
            plan=plan,
            x=10,
            y=20,
            width=300,
            height=200,
            label=label,
        )
        overlay.image_file.save(
            "overlay.png",
            ContentFile(image_bytes or _png_bytes(color=(255, 255, 255))),
            save=True,
        )
        return overlay


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


class PictogramLibraryTests(_PlanFactoryMixin, TestCase):
    VALID_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 170 170">
      <rect x="10" y="10" width="150" height="150" fill="#00a651" />
      <path d="M45 85h80" stroke="#fff" stroke-width="12" />
    </svg>"""

    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(username="svg-user", password="longsecret-1")
        self.client = self.authed_client(self.user)

    def test_create_svg_from_code_adds_it_to_the_library(self):
        response = self.client.post(
            "/api/plans/pictograms/",
            {"name": "Sortie personnalisée", "svg": self.VALID_SVG},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["type"], "Sortie personnalisée")
        self.assertTrue(
            os.path.isfile(os.path.join(self._test_media.name, "plan_picto", "Sortie personnalisée.svg"))
        )

        listing = self.client.get("/api/plans/pictograms/")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual([item["type"] for item in listing.json()], ["Sortie personnalisée"])

    def test_import_svg_file_uses_the_uploaded_filename_by_default(self):
        upload = SimpleUploadedFile(
            "Point rassemblement.svg",
            self.VALID_SVG.encode("utf-8"),
            content_type="image/svg+xml",
        )
        response = self.client.post(
            "/api/plans/pictograms/",
            {"file": upload},
            format="multipart",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["type"], "Point rassemblement")

    def test_svg_with_script_is_rejected(self):
        unsafe_svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
          <script>alert('x')</script>
        </svg>"""
        response = self.client.post(
            "/api/plans/pictograms/",
            {"name": "Dangereux", "svg": unsafe_svg},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(os.path.exists(os.path.join(self._test_media.name, "plan_picto", "Dangereux.svg")))

    def test_non_square_svg_is_rejected(self):
        response = self.client.post(
            "/api/plans/pictograms/",
            {
                "name": "Rectangle",
                "svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" />',
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("carré", response.json()["error"])

    def test_delete_unused_custom_svg_removes_it_from_the_library(self):
        create = self.client.post(
            "/api/plans/pictograms/",
            {"name": "À supprimer", "svg": self.VALID_SVG},
            format="json",
        )
        self.assertEqual(create.status_code, 201)

        response = self.client.delete(
            "/api/plans/pictograms/?file_name=%C3%80%20supprimer.svg"
        )

        self.assertEqual(response.status_code, 204)
        self.assertFalse(
            os.path.exists(os.path.join(self._test_media.name, "plan_picto", "À supprimer.svg"))
        )

    def test_delete_svg_in_use_is_blocked(self):
        create = self.client.post(
            "/api/plans/pictograms/",
            {"name": "SVG utilisé", "svg": self.VALID_SVG},
            format="json",
        )
        self.assertEqual(create.status_code, 201)
        plan = self.make_plan(self.user, name="plan-with-custom-svg")
        PlanIcon.objects.create(
            plan=plan,
            icon_type="SVG utilisé",
            x=10,
            y=10,
            width=40,
            height=40,
        )

        response = self.client.delete(
            "/api/plans/pictograms/?file_name=SVG%20utilis%C3%A9.svg"
        )

        self.assertEqual(response.status_code, 409)
        self.assertIn("utilisé", response.json()["error"])
        self.assertTrue(
            os.path.exists(os.path.join(self._test_media.name, "plan_picto", "SVG utilisé.svg"))
        )

    def test_rename_svg_updates_the_library_and_existing_plan_icons(self):
        create = self.client.post(
            "/api/plans/pictograms/",
            {"name": "Ancien nom", "svg": self.VALID_SVG},
            format="json",
        )
        self.assertEqual(create.status_code, 201)
        plan = self.make_plan(self.user, name="plan-with-renamed-svg")
        icon = PlanIcon.objects.create(
            plan=plan,
            icon_type="Ancien nom",
            x=10,
            y=10,
            width=40,
            height=40,
        )

        response = self.client.patch(
            "/api/plans/pictograms/",
            {"file_name": "Ancien nom.svg", "name": "Nouveau nom"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["type"], "Nouveau nom")
        self.assertFalse(os.path.exists(os.path.join(self._test_media.name, "plan_picto", "Ancien nom.svg")))
        self.assertTrue(os.path.exists(os.path.join(self._test_media.name, "plan_picto", "Nouveau nom.svg")))
        icon.refresh_from_db()
        self.assertEqual(icon.icon_type, "Nouveau nom")

    def test_rename_svg_rejects_an_existing_name(self):
        for name in ("Premier", "Deuxième"):
            response = self.client.post(
                "/api/plans/pictograms/",
                {"name": name, "svg": self.VALID_SVG},
                format="json",
            )
            self.assertEqual(response.status_code, 201)

        response = self.client.patch(
            "/api/plans/pictograms/",
            {"file_name": "Premier.svg", "name": "Deuxième"},
            format="json",
        )

        self.assertEqual(response.status_code, 409)


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
    def test_open_polyline_accepts_two_points_and_never_keeps_a_fill(self):
        from .serializers import PlanShapeSerializer

        serializer = PlanShapeSerializer(data={
            "shape_type": "polyline",
            "x": 10,
            "y": 20,
            "width": 80,
            "height": 40,
            "rotation": 0,
            "stroke_width": 3,
            "color": "#111111",
            "fill_color": "#ff0000",
            "fill_opacity": 0.8,
            "tension": 0.5,
            "points": [{"x": 10, "y": 20}, {"x": 90, "y": 60}],
        })

        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertIsNone(serializer.validated_data["fill_color"])
        self.assertEqual(serializer.validated_data["fill_opacity"], 0)
        self.assertEqual(serializer.validated_data["tension"], 0)

    def test_open_polyline_requires_at_least_two_points(self):
        from .serializers import PlanShapeSerializer

        serializer = PlanShapeSerializer(data={
            "shape_type": "polyline",
            "x": 10,
            "y": 20,
            "width": 0,
            "height": 0,
            "rotation": 0,
            "stroke_width": 3,
            "color": "#111111",
            "points": [{"x": 10, "y": 20}],
        })

        self.assertFalse(serializer.is_valid())
        self.assertIn("points", serializer.errors)

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
                "visible": True,
                "z_index": 80,
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
                "visible": False,
                "z_index": 70,
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
                "visible": True,
                "z_index": 90,
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
                "visible": False,
                "z_index": 40,
                "group_id": "plan-group-test",
            }],
            "plan_settings": {
                "main_plan_x": 45,
                "main_plan_y": 30,
                "main_plan_width": 900,
                "main_plan_height": 650,
                "main_plan_locked": True,
                "main_plan_visible": False,
                "main_plan_z_index": 50,
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
        self.assertFalse(plan.main_plan_visible)
        self.assertEqual(plan.main_plan_z_index, 50)
        self.assertEqual(plan.main_plan_group_id, "plan-group-main")
        self.assertTrue(plan.main_plan_grouping_enabled)
        self.assertTrue(plan.watermark_config["enabled"])
        self.assertEqual(plan.watermark_config["reference"], "BAT-42")
        self.assertTrue(plan.watermark_config["client_logo"].startswith("data:image/png;base64,"))
        self.assertTrue(plan.watermark_config["creator_logo"].startswith("data:image/png;base64,"))
        self.assertTrue(plan.icons.get().locked)
        self.assertTrue(plan.icons.get().visible)
        self.assertEqual(plan.icons.get().z_index, 80)
        self.assertEqual(plan.icons.get().group_id, "plan-group-test")
        self.assertEqual(plan.icons.get().object_group_id, "object-group-test")
        self.assertEqual(plan.shapes.get().group_id, "plan-group-test")
        self.assertEqual(plan.shapes.get().object_group_id, "object-group-test")
        self.assertFalse(plan.shapes.get().visible)
        self.assertEqual(plan.shapes.get().z_index, 70)
        self.assertEqual(plan.texts.get().group_id, "plan-group-test")
        self.assertEqual(plan.texts.get().object_group_id, "object-group-test")
        self.assertTrue(plan.texts.get().visible)
        self.assertEqual(plan.texts.get().z_index, 90)
        overlay = plan.overlays.get()
        self.assertTrue(overlay.locked)
        self.assertFalse(overlay.visible)
        self.assertEqual(overlay.z_index, 40)
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


class SecondaryPlanCleaningHistoryTests(_PlanFactoryMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(username="overlay-history", password="longsecret-1")
        self.plan = self.make_plan(self.user)
        self.overlay = self.make_overlay(self.plan, _png_bytes(color=(245, 245, 245)))
        self.client = self.authed_client(self.user)

    def clean_overlay(self):
        image_data = "data:image/png;base64," + base64.b64encode(_png_bytes()).decode("ascii")
        return self.client.post(
            f"/api/plans/{self.plan.id}/clean-image-data/",
            {"image_data": image_data, "method": "plan", "overlay_id": self.overlay.id},
            format="json",
        )

    def test_local_overlay_cleaning_preserves_original_and_creates_scoped_history(self):
        response = self.clean_overlay()

        self.assertEqual(response.status_code, 200)
        self.overlay.refresh_from_db()
        self.assertFalse(self.overlay.is_original)
        self.assertTrue(bool(self.overlay.original_image_file))

        overlay_history = self.client.get(
            f"/api/plans/{self.plan.id}/cleaning-history/?overlay_id={self.overlay.id}"
        )
        main_history = self.client.get(f"/api/plans/{self.plan.id}/cleaning-history/")
        self.assertEqual(len(overlay_history.json()), 1)
        self.assertEqual(len(main_history.json()), 0)

    def test_overlay_history_can_be_reapplied_and_original_can_be_restored(self):
        self.assertEqual(self.clean_overlay().status_code, 200)
        history = PlanCleaningHistory.objects.get(plan=self.plan)

        use_history = self.client.post(
            f"/api/plans/{self.plan.id}/use-cleaning-history/",
            {"history_id": history.id, "overlay_id": self.overlay.id},
            format="json",
        )
        self.assertEqual(use_history.status_code, 200)
        self.assertEqual(use_history.json()["target_kind"], "overlay")

        revert = self.client.post(
            f"/api/plans/{self.plan.id}/revert-overlay/",
            {"overlay_id": self.overlay.id},
            format="json",
        )
        self.assertEqual(revert.status_code, 200)
        self.assertTrue(revert.json()["is_original"])
        self.overlay.refresh_from_db()
        self.assertTrue(self.overlay.is_original)


class GrokCleaningTests(_PlanFactoryMixin, TestCase):
    def test_xai_request_timeout_is_configurable_and_bounded(self):
        from .grok_cleaning import _get_request_timeout

        with patch.dict(os.environ, {"XAI_REQUEST_TIMEOUT_SECONDS": "123"}):
            self.assertEqual(_get_request_timeout(), 123)
        with patch.dict(os.environ, {"XAI_REQUEST_TIMEOUT_SECONDS": "invalid"}):
            self.assertEqual(_get_request_timeout(), 300)
        with patch.dict(os.environ, {"XAI_REQUEST_TIMEOUT_SECONDS": "9999"}):
            self.assertEqual(_get_request_timeout(), 900)

    def test_sketch_generation_prompt_always_includes_strict_cad_rules(self):
        from .grok_cleaning import _validate_analysis

        prompt = _validate_analysis(
            {"compact_edit_prompt": "Preserve the visible rooms and openings."},
            background_color="#FFFFFF",
            preset="sketch",
        )

        self.assertIn("Do NOT trace the sketch literally", prompt)
        self.assertIn(
            "Do NOT keep sketch-like, thin, broken, fuzzy, translucent or double-outline lines.",
            prompt,
        )
        self.assertIn("REQUIRED WALL COLOR: #000000", prompt)
        self.assertIn("Use solid, continuous, fully opaque wall linework in exactly #000000", prompt)
        self.assertIn("Render every wall as a SOLID FILLED BAND", prompt)
        self.assertIn("The background color inside a wall thickness is strictly forbidden", prompt)
        self.assertIn("fill all space between them with #000000", prompt)
        self.assertIn("Every ordinary interior corner must be exactly 90 degrees", prompt)
        self.assertIn("Nearly collinear segments must snap to the exact same axis", prompt)
        self.assertIn("Make every L-, T- and cross-junction meet exactly and flush", prompt)
        self.assertIn("Join and close wall corners and wall ends", prompt)
        self.assertIn("digitally drafted CAD-style architectural base plan", prompt)
        self.assertIn("Preserve the visible rooms and openings.", prompt)
        self.assertIn("100% pure flat solid white background", prompt)

    def test_sketch_generation_prompt_uses_selected_wall_color(self):
        from .grok_cleaning import _validate_analysis

        prompt = _validate_analysis(
            {"compact_edit_prompt": "Preserve the intended rooms."},
            background_color="#FFFFFF",
            wall_color="#4b5563",
            preset="sketch",
        )

        self.assertIn("REQUIRED WALL COLOR: #4B5563", prompt)
        self.assertIn("fill all space between them with #4B5563", prompt)
        self.assertIn("Use exact wall and architectural-line color #4B5563", prompt)
        self.assertNotIn("REQUIRED WALL COLOR: #000000", prompt)

    def test_non_sketch_prompt_does_not_receive_sketch_rendering_rules(self):
        from .grok_cleaning import _validate_analysis

        prompt = _validate_analysis(
            {"compact_edit_prompt": "Clean this evacuation plan."},
            preset="evacuation",
        )

        self.assertNotIn("Do NOT trace the sketch literally", prompt)

    def test_grok_clean_requires_xai_key(self):
        user = User.objects.create_user(username="leo", password="longsecret-1")
        plan = self.make_plan(user)
        client = self.authed_client(user)

        response = client.post(f"/api/plans/{plan.id}/grok-clean/")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error_code"], "XAI_KEY_MISSING")

    def test_grok_status_expires_a_stalled_job(self):
        user = User.objects.create_user(username="stalled-grok", password="longsecret-1")
        plan = self.make_plan(user)
        client = self.authed_client(user)
        job = GrokCleaningJob.objects.create(
            user=user,
            plan=plan,
            status=GrokCleaningJob.STATUS_ANALYZING,
        )
        GrokCleaningJob.objects.filter(id=job.id).update(
            updated_at=timezone.now() - timedelta(seconds=61),
        )

        with patch.dict(os.environ, {"GROK_JOB_STALE_SECONDS": "60"}):
            response = client.get(
                f"/api/plans/{plan.id}/grok-clean-status/?job_id={job.id}"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], GrokCleaningJob.STATUS_FAILED)
        self.assertEqual(response.json()["error_code"], "XAI_TIMEOUT")
        self.assertEqual(response.json()["diagnostic"], "job_stalled:analyzing")

    def test_completed_main_job_status_does_not_return_large_image_data(self):
        user = User.objects.create_user(username="lean-grok-status", password="longsecret-1")
        plan = self.make_plan(user)
        client = self.authed_client(user)
        job = GrokCleaningJob.objects.create(
            user=user,
            plan=plan,
            status=GrokCleaningJob.STATUS_COMPLETED,
            before_image_data="data:image/png;base64,before",
            after_image_data="data:image/png;base64,after",
        )

        response = client.get(
            f"/api/plans/{plan.id}/grok-clean-status/?job_id={job.id}"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], GrokCleaningJob.STATUS_COMPLETED)
        self.assertNotIn("before_image", response.json())
        self.assertNotIn("after_image", response.json())

        overlay = self.make_overlay(plan)
        overlay_job = GrokCleaningJob.objects.create(
            user=user,
            plan=plan,
            target_kind="overlay",
            target_overlay=overlay,
            status=GrokCleaningJob.STATUS_COMPLETED,
            after_image_data="data:image/png;base64,overlay-after",
        )
        overlay_response = client.get(
            f"/api/plans/{plan.id}/grok-clean-status/?job_id={overlay_job.id}"
        )
        self.assertEqual(
            overlay_response.json()["after_image"],
            "data:image/png;base64,overlay-after",
        )

    def test_unexpected_worker_crash_marks_the_job_failed(self):
        from .views import run_grok_cleaning_job

        user = User.objects.create_user(username="crashed-grok", password="longsecret-1")
        plan = self.make_plan(user)
        settings_obj = UserXaiSettings.objects.create(user=user)
        settings_obj.set_api_key("xai-secret")
        settings_obj.save()
        job = GrokCleaningJob.objects.create(
            user=user,
            plan=plan,
            status=GrokCleaningJob.STATUS_PENDING,
        )

        with patch(
            "evacuation_plans.models.UserXaiSettings.get_api_key",
            side_effect=RuntimeError("broken key storage"),
        ):
            run_grok_cleaning_job(job.id)

        job.refresh_from_db()
        self.assertEqual(job.status, GrokCleaningJob.STATUS_FAILED)
        self.assertEqual(job.error_code, "GROK_FAILED")
        self.assertEqual(job.diagnostic, "worker_crashed:RuntimeError")

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

        def finish_fake_pipeline(*_args, **kwargs):
            kwargs["on_generation_started"]()
            job.refresh_from_db()
            self.assertEqual(job.status, GrokCleaningJob.STATUS_GENERATING)
            return fake_result

        with patch(
            "evacuation_plans.views.analyze_and_clean_plan",
            side_effect=finish_fake_pipeline,
        ):
            run_grok_cleaning_job(job.id)

        job.refresh_from_db()
        self.assertEqual(job.status, GrokCleaningJob.STATUS_COMPLETED)
        plan.refresh_from_db()
        self.assertTrue(plan.use_cleaned_background)
        self.assertEqual(
            PlanCleaningHistory.objects.filter(plan=plan, cleaning_method=PlanCleaningHistory.METHOD_GROK).count(),
            1,
        )

    def test_grok_clean_accepts_sketch_preset(self):
        user = User.objects.create_user(username="sketch-launch", password="longsecret-1")
        plan = self.make_plan(user)
        settings_obj = UserXaiSettings.objects.create(user=user)
        settings_obj.set_api_key("xai-secret")
        settings_obj.save()
        client = self.authed_client(user)

        with patch("evacuation_plans.views.threading.Thread") as thread_class:
            response = client.post(
                f"/api/plans/{plan.id}/grok-clean/",
                {"preset": "sketch", "background_color": "#FFFFFF", "wall_color": "#4B5563"},
                format="json",
            )

        self.assertEqual(response.status_code, 202)
        job = GrokCleaningJob.objects.get(id=response.json()["job_id"])
        self.assertEqual(job.preset, "sketch")
        self.assertEqual(job.target_wall_color, "#4B5563")
        self.assertEqual(response.json()["wall_color"], "#4B5563")
        thread_class.assert_called_once()

    def test_grok_clean_rejects_invalid_wall_color(self):
        user = User.objects.create_user(username="invalid-wall-color", password="longsecret-1")
        plan = self.make_plan(user)
        settings_obj = UserXaiSettings.objects.create(user=user)
        settings_obj.set_api_key("xai-secret")
        settings_obj.save()
        client = self.authed_client(user)

        response = client.post(
            f"/api/plans/{plan.id}/grok-clean/",
            {"preset": "sketch", "wall_color": "not-a-color"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error_code"], "INVALID_WALL_COLOR")

    def test_grok_clean_rejects_unknown_preset(self):
        user = User.objects.create_user(username="invalid-preset", password="longsecret-1")
        plan = self.make_plan(user)
        settings_obj = UserXaiSettings.objects.create(user=user)
        settings_obj.set_api_key("xai-secret")
        settings_obj.save()
        client = self.authed_client(user)

        response = client.post(
            f"/api/plans/{plan.id}/grok-clean/",
            {"preset": "unknown"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error_code"], "INVALID_PRESET")

    def test_sketch_job_uses_sketch_profile_and_history_method(self):
        from .views import run_grok_cleaning_job
        from .grok_cleaning import GrokCleaningResult

        user = User.objects.create_user(username="sketch-worker", password="longsecret-1")
        plan = self.make_plan(user)
        settings_obj = UserXaiSettings.objects.create(user=user)
        settings_obj.set_api_key("xai-secret")
        settings_obj.save()
        job = GrokCleaningJob.objects.create(
            user=user,
            plan=plan,
            status=GrokCleaningJob.STATUS_PENDING,
            preset="sketch",
            target_wall_color="#4B5563",
        )
        fake_result = GrokCleaningResult(
            analysis={"compact_edit_prompt": "sketch prompt"},
            generation_prompt="sketch prompt",
            cleaned_image_bytes=_png_bytes(color=(230, 230, 230)),
            analysis_model="grok-4.5",
            image_model="grok-imagine-image-quality",
        )

        with patch("evacuation_plans.views.analyze_and_clean_plan", return_value=fake_result) as cleaner:
            run_grok_cleaning_job(job.id)

        job.refresh_from_db()
        self.assertEqual(job.status, GrokCleaningJob.STATUS_COMPLETED)
        self.assertEqual(cleaner.call_args.kwargs["preset"], "sketch")
        self.assertEqual(cleaner.call_args.kwargs["wall_color"], "#4B5563")
        history = PlanCleaningHistory.objects.get(
            plan=plan,
            cleaning_method=PlanCleaningHistory.METHOD_GROK_SKETCH,
        )
        self.assertEqual(history.options["preset"], "sketch")
        self.assertEqual(history.options["target_wall_color"], "#4B5563")

    def test_grok_clean_accepts_a_secondary_plan_image(self):
        user = User.objects.create_user(username="overlay-launch", password="longsecret-1")
        plan = self.make_plan(user)
        settings_obj = UserXaiSettings.objects.create(user=user)
        settings_obj.set_api_key("xai-secret")
        settings_obj.save()
        client = self.authed_client(user)
        overlay = self.make_overlay(plan)
        image_data = "data:image/png;base64," + base64.b64encode(_png_bytes()).decode("ascii")

        with patch("evacuation_plans.views.threading.Thread") as thread_class:
            response = client.post(
                f"/api/plans/{plan.id}/grok-clean/",
                {
                    "preset": "sketch",
                    "target_kind": "overlay",
                    "overlay_id": overlay.id,
                    "image_data": image_data,
                },
                format="json",
            )

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()["target_kind"], "overlay")
        job = GrokCleaningJob.objects.get(id=response.json()["job_id"])
        self.assertEqual(job.target_kind, "overlay")
        self.assertEqual(job.target_overlay_id, overlay.id)
        self.assertTrue(job.source_image_data.startswith("data:image/png;base64,"))
        thread_class.assert_called_once()

    def test_secondary_plan_job_returns_image_without_replacing_main_background(self):
        from .views import run_grok_cleaning_job
        from .grok_cleaning import GrokCleaningResult

        user = User.objects.create_user(username="overlay-worker", password="longsecret-1")
        plan = self.make_plan(user)
        settings_obj = UserXaiSettings.objects.create(user=user)
        settings_obj.set_api_key("xai-secret")
        settings_obj.save()
        overlay = self.make_overlay(plan)
        source_data = "data:image/png;base64," + base64.b64encode(_png_bytes()).decode("ascii")
        job = GrokCleaningJob.objects.create(
            user=user,
            plan=plan,
            status=GrokCleaningJob.STATUS_PENDING,
            preset="sketch",
            target_kind="overlay",
            target_overlay=overlay,
            source_image_data=source_data,
        )
        fake_result = GrokCleaningResult(
            analysis={"compact_edit_prompt": "overlay sketch"},
            generation_prompt="overlay sketch",
            cleaned_image_bytes=_png_bytes(color=(210, 210, 210)),
            analysis_model="grok-4.5",
            image_model="grok-imagine-image-quality",
        )

        with patch("evacuation_plans.views.analyze_and_clean_plan", return_value=fake_result):
            run_grok_cleaning_job(job.id)

        job.refresh_from_db()
        plan.refresh_from_db()
        overlay.refresh_from_db()
        self.assertEqual(job.status, GrokCleaningJob.STATUS_COMPLETED)
        self.assertTrue(job.after_image_data.startswith("data:image/png;base64,"))
        self.assertEqual(job.source_image_data, "")
        self.assertFalse(plan.use_cleaned_background)
        self.assertFalse(overlay.is_original)
        self.assertTrue(bool(overlay.original_image_file))
        history = PlanCleaningHistory.objects.get(plan=plan)
        self.assertEqual(history.options["target_kind"], "overlay")
        self.assertEqual(history.options["overlay_id"], overlay.id)


class PlanOwnershipTests(_PlanFactoryMixin, TestCase):
    """A plan belongs to one account: nothing may be written into someone else's."""

    def setUp(self):
        super().setUp()
        self.owner = User.objects.create_user(username="owner", password="pw-owner-1")
        self.intruder = User.objects.create_user(username="intruder", password="pw-intruder-1")
        self.plan = self.make_plan(self.owner, name="owned")
        self.client = APIClient()
        self.client.force_authenticate(user=self.intruder)

    def test_cannot_create_an_icon_on_another_users_plan(self):
        response = self.client.post("/api/icons/", {
            "plan": self.plan.id,
            "icon_type": "extincteur",
            "x": 10, "y": 10, "width": 30, "height": 30,
        }, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.plan.icons.count(), 0)

    def test_owner_can_still_create_an_icon_on_their_own_plan(self):
        self.client.force_authenticate(user=self.owner)

        response = self.client.post("/api/icons/", {
            "plan": self.plan.id,
            "icon_type": "extincteur",
            "x": 10, "y": 10, "width": 30, "height": 30,
        }, format="json")

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.plan.icons.count(), 1)

    def test_cannot_move_an_icon_onto_another_users_plan(self):
        own_plan = self.make_plan(self.intruder, name="mine")
        icon = PlanIcon.objects.create(
            plan=own_plan, icon_type="extincteur", x=1, y=1, width=10, height=10
        )

        response = self.client.patch(f"/api/icons/{icon.id}/", {"plan": self.plan.id}, format="json")

        self.assertEqual(response.status_code, 400)
        icon.refresh_from_db()
        self.assertEqual(icon.plan_id, own_plan.id)


class SyncIconsRobustnessTests(_PlanFactoryMixin, TestCase):
    """sync-icons replaces everything, so a bad payload must change nothing."""

    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(username="sync", password="pw-sync-12")
        self.plan = self.make_plan(self.user, name="sync")
        PlanIcon.objects.create(
            plan=self.plan, icon_type="extincteur", x=5, y=5, width=20, height=20
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_an_invalid_icon_leaves_the_existing_ones_untouched(self):
        response = self.client.post(
            f"/api/plans/{self.plan.id}/sync-icons/",
            [
                {"icon_type": "issue", "x": 1, "y": 1, "width": 10, "height": 10},
                {"icon_type": "issue", "x": "pas-un-nombre", "y": 2, "width": 10, "height": 10},
            ],
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.plan.icons.count(), 1)
        self.assertEqual(self.plan.icons.first().icon_type, "extincteur")

    def test_a_valid_payload_replaces_the_icons(self):
        response = self.client.post(
            f"/api/plans/{self.plan.id}/sync-icons/",
            [{"icon_type": "issue", "x": 1, "y": 1, "width": 10, "height": 10}],
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.plan.icons.count(), 1)
        self.assertEqual(self.plan.icons.first().icon_type, "issue")


class WorkspaceCollaborationTests(_PlanFactoryMixin, TestCase):
    """Sharing widens access exactly as far as intended, and no further."""

    def setUp(self):
        super().setUp()
        self.owner = User.objects.create_user(
            username="wowner", password="pw-owner-42", email="owner@example.test"
        )
        self.guest = User.objects.create_user(
            username="wguest", password="pw-guest-42", email="guest@example.test"
        )
        self.stranger = User.objects.create_user(username="wstranger", password="pw-str-42")
        self.plan = self.make_plan(self.owner, name="shared")
        self.client = APIClient()

    def _invite(self, role="viewer"):
        self.client.force_authenticate(user=self.owner)
        response = self.client.post(
            "/api/workspace/collaborators/", {"email": "guest@example.test", "role": role}, format="json"
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data["token"]

    def _accept(self, token, user):
        self.client.force_authenticate(user=user)
        return self.client.post("/api/workspace/accept/", {"token": token}, format="json")

    def test_a_stranger_sees_nothing(self):
        self.client.force_authenticate(user=self.stranger)
        response = self.client.get("/api/plans/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 0)

    def test_the_raw_token_is_never_stored_or_readable_afterwards(self):
        token = self._invite()
        invitation = WorkspaceInvitation.objects.get()
        self.assertNotEqual(invitation.token_hash, token)
        self.assertNotIn(token, str(invitation.__dict__))

        self.client.force_authenticate(user=self.owner)
        listing = self.client.get("/api/workspace/collaborators/")
        self.assertNotIn(token, str(listing.data))

    def test_an_accepted_invitation_grants_read_access_to_the_list(self):
        token = self._invite(role="viewer")
        self.assertEqual(self._accept(token, self.guest).status_code, 200)

        response = self.client.get("/api/plans/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["id"] for item in response.data], [self.plan.id])

    def test_a_viewer_cannot_write(self):
        self._accept(self._invite(role="viewer"), self.guest)

        sync = self.client.post(
            f"/api/plans/{self.plan.id}/sync-icons/",
            [{"icon_type": "issue", "x": 1, "y": 1, "width": 10, "height": 10}],
            format="json",
        )
        self.assertEqual(sync.status_code, 403)
        self.assertEqual(self.plan.icons.count(), 0)

        icon = self.client.post("/api/icons/", {
            "plan": self.plan.id, "icon_type": "issue",
            "x": 1, "y": 1, "width": 10, "height": 10,
        }, format="json")
        self.assertEqual(icon.status_code, 400)

        delete = self.client.delete(f"/api/plans/{self.plan.id}/")
        self.assertEqual(delete.status_code, 403)
        self.assertTrue(EvacuationPlan.objects.filter(pk=self.plan.pk).exists())

    def test_an_editor_can_write(self):
        self._accept(self._invite(role="editor"), self.guest)

        sync = self.client.post(
            f"/api/plans/{self.plan.id}/sync-icons/",
            [{"icon_type": "issue", "x": 1, "y": 1, "width": 10, "height": 10}],
            format="json",
        )
        self.assertEqual(sync.status_code, 200, sync.data)
        self.assertEqual(self.plan.icons.count(), 1)

    def test_a_token_works_only_once(self):
        token = self._invite()
        self.assertEqual(self._accept(token, self.guest).status_code, 200)
        replay = self._accept(token, self.stranger)
        self.assertEqual(replay.status_code, 400)
        self.assertFalse(
            WorkspaceMembership.objects.filter(owner=self.owner, member=self.stranger).exists()
        )

    def test_an_expired_token_is_refused(self):
        token = self._invite()
        WorkspaceInvitation.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self._accept(token, self.guest).status_code, 400)
        self.assertFalse(WorkspaceMembership.objects.exists())

    def test_a_revoked_invitation_is_refused(self):
        token = self._invite()
        self.client.force_authenticate(user=self.owner)
        invitation = WorkspaceInvitation.objects.get()
        revoke = self.client.post(
            "/api/workspace/revoke/", {"invitation_id": invitation.id}, format="json"
        )
        self.assertEqual(revoke.status_code, 204)
        self.assertEqual(self._accept(token, self.guest).status_code, 400)

    def test_revoking_access_takes_the_plans_away_again(self):
        self._accept(self._invite(role="editor"), self.guest)
        membership = WorkspaceMembership.objects.get()

        self.client.force_authenticate(user=self.owner)
        self.assertEqual(
            self.client.post("/api/workspace/revoke/", {"membership_id": membership.id}, format="json").status_code,
            204,
        )

        self.client.force_authenticate(user=self.guest)
        self.assertEqual(len(self.client.get("/api/plans/").data), 0)

    def test_only_the_owner_may_revoke(self):
        self._accept(self._invite(), self.guest)
        membership = WorkspaceMembership.objects.get()

        self.client.force_authenticate(user=self.stranger)
        response = self.client.post(
            "/api/workspace/revoke/", {"membership_id": membership.id}, format="json"
        )
        self.assertEqual(response.status_code, 404)
        self.assertTrue(WorkspaceMembership.objects.filter(pk=membership.pk).exists())

    def test_every_failure_gives_the_same_message(self):
        token = self._invite()
        wrong = self._accept("nimporte-quoi", self.guest)
        WorkspaceInvitation.objects.update(revoked_at=timezone.now())
        revoked = self._accept(token, self.guest)
        self.assertEqual(wrong.status_code, revoked.status_code)
        self.assertEqual(wrong.data, revoked.data)

    def test_a_guest_plan_lands_in_their_own_list_not_the_owners(self):
        self._accept(self._invite(role="editor"), self.guest)
        response = self.client.post("/api/plans/", {
            "title": "chez moi",
            "building_name": "B",
            "floor_name": "F",
            "background_type": "image",
            "background_file": SimpleUploadedFile("bg.png", _png_bytes(), content_type="image/png"),
        }, format="multipart")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(EvacuationPlan.objects.get(pk=response.data["id"]).user_id, self.guest.id)


class AdminWorkspaceGrantTests(_PlanFactoryMixin, TestCase):
    """Access granted from the Django admin behaves exactly like an accepted
    invitation — the API reads one place, so both routes must agree."""

    def setUp(self):
        super().setUp()
        self.staff = User.objects.create_user(
            username="patron", password="pw-patron-99", is_staff=True, is_superuser=True
        )
        self.owner = User.objects.create_user(username="aowner", password="pw-aowner-99")
        self.colleague = User.objects.create_user(username="acolleague", password="pw-acol-99")
        self.plan = self.make_plan(self.owner, name="admin-granted")

        self.admin_client = Client()
        self.admin_client.force_login(self.staff)
        self.api = APIClient()

    def test_the_membership_page_is_reachable_by_staff(self):
        response = self.admin_client.get("/admin/evacuation_plans/workspacemembership/")
        self.assertEqual(response.status_code, 200)

    def test_granting_from_the_admin_gives_immediate_access(self):
        response = self.admin_client.post(
            "/admin/evacuation_plans/workspacemembership/add/",
            {"owner": self.owner.id, "member": self.colleague.id, "role": "editor"},
        )
        self.assertEqual(response.status_code, 302, getattr(response, "context", None))
        self.assertTrue(
            WorkspaceMembership.objects.filter(owner=self.owner, member=self.colleague).exists()
        )

        self.api.force_authenticate(user=self.colleague)
        listing = self.api.get("/api/plans/")
        self.assertEqual([item["id"] for item in listing.data], [self.plan.id])

        # 'editor' really means editor, not just visibility.
        sync = self.api.post(
            f"/api/plans/{self.plan.id}/sync-icons/",
            [{"icon_type": "issue", "x": 1, "y": 1, "width": 10, "height": 10}],
            format="json",
        )
        self.assertEqual(sync.status_code, 200, sync.data)

    def test_a_viewer_granted_from_the_admin_still_cannot_write(self):
        WorkspaceMembership.objects.create(
            owner=self.owner, member=self.colleague, role="viewer"
        )
        self.api.force_authenticate(user=self.colleague)
        sync = self.api.post(
            f"/api/plans/{self.plan.id}/sync-icons/",
            [{"icon_type": "issue", "x": 1, "y": 1, "width": 10, "height": 10}],
            format="json",
        )
        self.assertEqual(sync.status_code, 403)

    def test_deleting_the_membership_takes_the_access_back(self):
        membership = WorkspaceMembership.objects.create(
            owner=self.owner, member=self.colleague, role="editor"
        )
        membership.delete()

        self.api.force_authenticate(user=self.colleague)
        self.assertEqual(len(self.api.get("/api/plans/").data), 0)

    def test_a_user_cannot_be_granted_access_to_their_own_list(self):
        response = self.admin_client.post(
            "/admin/evacuation_plans/workspacemembership/add/",
            {"owner": self.owner.id, "member": self.owner.id, "role": "editor"},
        )
        self.assertEqual(response.status_code, 200)  # redisplayed with the error
        self.assertFalse(WorkspaceMembership.objects.exists())

    def test_invitations_cannot_be_forged_from_the_admin(self):
        response = self.admin_client.get("/admin/evacuation_plans/workspaceinvitation/add/")
        self.assertEqual(response.status_code, 403)

    def test_a_plain_user_cannot_reach_the_admin(self):
        client = Client()
        client.force_login(self.colleague)
        response = client.get("/admin/evacuation_plans/workspacemembership/")
        # Bounced to the admin login rather than shown the list.
        self.assertEqual(response.status_code, 302)
        self.assertIn("/admin/login/", response["Location"])

        followed = client.get("/admin/evacuation_plans/workspacemembership/", follow=True)
        self.assertNotContains(followed, self.owner.username)
