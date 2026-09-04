import base64
import io
import os
import sys
import tempfile
import types
from urllib.parse import quote, urlsplit
from unittest.mock import patch

from datetime import timedelta

from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from .models import (
    DefaultTemplateEditPermission,
    EvacuationPlan,
    GrokCleaningJob,
    PlanCleaningHistory,
    PlanFolder,
    PlanIcon,
    PlanOverlay,
    PlanShape,
    PlanText,
    SheetTemplateAsset,
    SheetTemplateVersion,
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


def _required_plan_creation_data():
    return {
        "establishment_name": "Établissement Démonstration",
        "building_name": "Bâtiment A",
        "floor_name": "RDC",
        "plan_number": "PE-001",
        "design_date": "2026-08-31",
        "designer": "Bureau sécurité",
        "revision_index": "A",
        "last_verification_date": "2026-08-31",
        "next_verification_date": "2027-08-31",
        "active_sheet_template_key": "evacuation_consigne_gauche",
        "active_sheet_template_version_id": "",
        "active_sheet_template_name": "Évacuation avec consignes",
    }


def _complete_plan_information(plan):
    for field, value in _required_plan_creation_data().items():
        if field.startswith("active_sheet_template_"):
            continue
        setattr(plan, field, value)
    plan.save()
    return plan


def _plan_situation_config():
    """A compact but complete plan-owned inset, as emitted by the studio."""
    return {
        "version": 1,
        "enabled": True,
        "visible": True,
        "locked": False,
        "sectorial": True,
        "orientation": 90,
        "orientation_mode": "manual",
        "content_width_percent": 50,
        "content_height_percent": 30,
        "zone_opacity_percent": 35,
        "blocks": [
            {
                "id": "plan-situation:background",
                "kind": "image",
                "planSpecificKind": "situation",
                "situationRole": "background",
                "label": "Fond du plan de situation",
                "x": 810,
                "y": 600,
                "width": 280,
                "height": 190,
                "rotation": 90,
                "visible": True,
                "locked": True,
                "imageKey": "planSituationBackground",
            },
            {
                "id": "plan-situation:frame",
                "kind": "text",
                "planSpecificKind": "situation",
                "situationRole": "frame",
                "label": "Plan de situation",
                "x": 800,
                "y": 580,
                "width": 300,
                "height": 230,
                "rotation": 90,
                "visible": True,
                "locked": False,
                "title": "PLAN DE SITUATION",
                "text": "",
                "stroke": "#111827",
                "strokeWidth": 2,
                "titleHeight": 28,
            },
            {
                "id": "plan-situation:represented_zone:test-zone",
                "kind": "shape",
                "planSpecificKind": "situation",
                "situationRole": "represented_zone",
                "label": "Zone représentée",
                "x": 860,
                "y": 650,
                "width": 110,
                "height": 70,
                "rotation": 90,
                "visible": True,
                "locked": False,
                "shapeType": "zone",
                "shapePoints": [
                    {"x": 0, "y": 0}, {"x": 1, "y": 0},
                    {"x": 1, "y": 1}, {"x": 0, "y": 1},
                ],
                "shapeClosed": True,
                "fill": "#f59e0b",
                "fillOpacity": 0.2,
                "stroke": "#c2410c",
                "strokeWidth": 3,
                "situationSourcePoints": [
                    {"x": 400, "y": 100}, {"x": 700, "y": 100},
                    {"x": 700, "y": 350}, {"x": 400, "y": 350},
                ],
            },
            {
                "id": "plan-situation:assembly_point:test-point",
                "kind": "picto",
                "planSpecificKind": "situation",
                "situationRole": "assembly_point",
                "label": "Point de rassemblement",
                "x": 990,
                "y": 650,
                "width": 42,
                "height": 42,
                "rotation": 90,
                "visible": True,
                "locked": False,
                "iconType": "point_de_rassemblement",
                "lockAspectRatio": True,
                "objectGroupId": "plan-situation-group",
            },
            {
                "id": "plan-situation:building_outline:test-outline",
                "kind": "shape",
                "planSpecificKind": "situation",
                "situationRole": "building_outline",
                "label": "Silhouette du bâtiment",
                "x": 825,
                "y": 630,
                "width": 220,
                "height": 120,
                "rotation": 90,
                "visible": True,
                "locked": False,
                "shapeType": "polygon_zone",
                "shapePoints": [
                    {"x": 0, "y": 0}, {"x": 1, "y": 0},
                    {"x": 1, "y": 1}, {"x": 0, "y": 1},
                ],
                "shapeClosed": True,
                "fill": "#e5e7eb",
                "fillOpacity": 0.75,
                "stroke": "#111827",
                "strokeWidth": 2,
                "situationSourcePoints": [
                    {"x": 100, "y": 50}, {"x": 800, "y": 50},
                    {"x": 800, "y": 400}, {"x": 100, "y": 400},
                ],
            },
        ],
    }


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
    @override_settings(PUBLIC_REGISTRATION_ENABLED=True)
    def test_user_registration(self):
        client = APIClient()
        response = client.post(
            "/api/auth/register/",
            {"username": "alice", "email": "alice@example.com", "password": "longsecret-1"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(User.objects.filter(username="alice").exists())

    @override_settings(PUBLIC_REGISTRATION_ENABLED=False)
    def test_public_registration_is_disabled_by_default(self):
        response = APIClient().post(
            "/api/auth/register/",
            {"username": "blocked", "email": "blocked@example.com", "password": "longsecret-1"},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(User.objects.filter(username="blocked").exists())


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

    def test_plan_folders_group_plans_and_deleting_one_keeps_the_plans(self):
        user = User.objects.create_user(username="folder-owner", password="longsecret-1")
        client = self.authed_client(user)
        plan = self.make_plan(user, name="RDC")

        created = client.post("/api/plan-folders/", {"name": "Site Central"}, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        folder_id = created.data["id"]

        moved = client.patch(
            f"/api/plans/{plan.id}/", {"folder": folder_id}, format="json"
        )
        self.assertEqual(moved.status_code, 200, moved.content)
        self.assertEqual(moved.data["folder"], folder_id)
        self.assertEqual(moved.data["folder_name"], "Site Central")

        renamed = client.patch(
            f"/api/plan-folders/{folder_id}/", {"name": "Site Nord"}, format="json"
        )
        self.assertEqual(renamed.status_code, 200, renamed.content)
        self.assertEqual(renamed.data["name"], "Site Nord")

        deleted = client.delete(f"/api/plan-folders/{folder_id}/")
        self.assertEqual(deleted.status_code, 204, deleted.content)
        plan.refresh_from_db()
        self.assertIsNone(plan.folder_id)
        self.assertTrue(EvacuationPlan.objects.filter(pk=plan.id).exists())

    def test_plan_cannot_be_moved_into_another_users_folder(self):
        owner = User.objects.create_user(username="folder-plan-owner", password="longsecret-1")
        stranger = User.objects.create_user(username="folder-stranger", password="longsecret-1")
        plan = self.make_plan(owner)
        foreign_folder = PlanFolder.objects.create(user=stranger, name="Secret")

        response = self.authed_client(owner).patch(
            f"/api/plans/{plan.id}/", {"folder": foreign_folder.id}, format="json"
        )

        self.assertEqual(response.status_code, 400, response.content)
        plan.refresh_from_db()
        self.assertIsNone(plan.folder_id)

    def test_plan_keeps_last_template_when_saved_in_plan_only_mode(self):
        user = User.objects.create_user(username="template-plan", password="longsecret-1")
        client = self.authed_client(user)
        plan = self.make_plan(user)

        response = client.patch(
            f"/api/plans/{plan.id}/",
            {
                **_required_plan_creation_data(),
                "active_sheet_template_key": "nfx08070",
                "active_sheet_template_version_id": "custom:client-final",
                "active_sheet_template_name": "Template final client",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        plan.refresh_from_db()
        self.assertEqual(plan.active_sheet_template_key, "nfx08070")
        self.assertEqual(plan.active_sheet_template_version_id, "custom:client-final")
        self.assertEqual(plan.active_sheet_template_name, "Template final client")
        self.assertEqual(plan.last_sheet_template_key, "nfx08070")
        self.assertEqual(plan.last_sheet_template_version_id, "custom:client-final")
        self.assertEqual(plan.last_sheet_template_name, "Template final client")

        response = client.patch(
            f"/api/plans/{plan.id}/",
            {
                "active_sheet_template_key": "none",
                "active_sheet_template_version_id": "",
                "active_sheet_template_name": "Plan seul",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        plan.refresh_from_db()
        self.assertEqual(plan.active_sheet_template_key, "none")
        self.assertEqual(plan.active_sheet_template_name, "Plan seul")
        self.assertEqual(plan.last_sheet_template_key, "nfx08070")
        self.assertEqual(plan.last_sheet_template_version_id, "custom:client-final")
        self.assertEqual(plan.last_sheet_template_name, "Template final client")
        listed = client.get("/api/plans/").json()[0]
        self.assertEqual(listed["active_sheet_template_name"], "Plan seul")
        self.assertEqual(listed["last_sheet_template_name"], "Template final client")

    def test_plan_rejects_an_invalid_active_sheet_template_key(self):
        user = User.objects.create_user(username="invalid-template-plan", password="longsecret-1")
        client = self.authed_client(user)
        plan = self.make_plan(user)

        response = client.patch(
            f"/api/plans/{plan.id}/",
            {"active_sheet_template_key": "../../template"},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.content)
        plan.refresh_from_db()
        self.assertEqual(plan.active_sheet_template_key, "none")

    def test_imported_plan_is_visible_by_default(self):
        user = User.objects.create_user(username="visible-import", password="longsecret-1")
        client = self.authed_client(user)

        response = client.post(
            "/api/plans/",
            {
                "title": "Plan visible",
                **_required_plan_creation_data(),
                "background_type": "image",
                "background_file": SimpleUploadedFile(
                    "plan-visible.png",
                    _png_bytes(),
                    content_type="image/png",
                ),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(response.data["main_plan_visible"])
        self.assertTrue(EvacuationPlan.objects.get(pk=response.data["id"]).main_plan_visible)

    def test_create_pdf_plan_authenticated(self):
        user = User.objects.create_user(username="dave", password="longsecret-1")
        client = self.authed_client(user)
        pdf_bytes = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
        response = client.post(
            "/api/plans/",
            {
                "title": "PDF plan",
                **_required_plan_creation_data(),
                "background_type": "pdf",
                "background_file": io.BytesIO(pdf_bytes),
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 201)

    def test_create_plan_keeps_template_and_traceability_in_the_studio(self):
        user = User.objects.create_user(username="studio-plan-fields", password="longsecret-1")
        client = self.authed_client(user)

        response = client.post(
            "/api/plans/",
            {
                "title": "Plan à compléter dans le studio",
                "building_name": "Bâtiment A",
                "floor_name": "RDC",
                "background_type": "image",
                "background_file": SimpleUploadedFile(
                    "plan-studio.png",
                    _png_bytes(),
                    content_type="image/png",
                ),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data["active_sheet_template_key"], "none")
        self.assertEqual(response.data["establishment_name"], "")
        self.assertEqual(response.data["plan_information_visibility"], {})
        self.assertEqual(response.data["plan_information_layout"], {})
        self.assertEqual(response.data["plan_number"], f"PLAN-{response.data['id']:06d}")
        self.assertEqual(response.data["revision_index"], "A")
        self.assertEqual(response.data["export_paper_format"], "a3")
        self.assertEqual(response.data["print_scale_denominator"], 250)

    def test_non_recommended_export_format_and_scale_remain_selectable(self):
        user = User.objects.create_user(username="plan-compliance", password="longsecret-1")
        client = self.authed_client(user)
        plan = self.make_plan(user)

        evacuation_a4 = client.patch(
            f"/api/plans/{plan.id}/",
            {
                "document_type": "evacuation",
                "export_paper_format": "a4",
                "print_scale_denominator": 250,
            },
            format="json",
        )
        standard_limit = client.patch(
            f"/api/plans/{plan.id}/",
            {
                "document_type": "evacuation",
                "export_paper_format": "a3",
                "print_scale_denominator": 250,
            },
            format="json",
        )
        standard_over_limit = client.patch(
            f"/api/plans/{plan.id}/",
            {"print_scale_denominator": 251},
            format="json",
        )
        a2_limit = client.patch(
            f"/api/plans/{plan.id}/",
            {
                "export_paper_format": "a2",
                "print_scale_denominator": 350,
            },
            format="json",
        )
        a2_over_limit = client.patch(
            f"/api/plans/{plan.id}/",
            {"print_scale_denominator": 351},
            format="json",
        )
        room_a4 = client.patch(
            f"/api/plans/{plan.id}/",
            {
                "document_type": "room",
                "export_paper_format": "a4",
                "print_scale_denominator": 100,
            },
            format="json",
        )

        self.assertEqual(evacuation_a4.status_code, 200, evacuation_a4.content)
        self.assertEqual(standard_limit.status_code, 200, standard_limit.content)
        self.assertEqual(standard_over_limit.status_code, 200, standard_over_limit.content)
        self.assertEqual(a2_limit.status_code, 200, a2_limit.content)
        self.assertEqual(a2_over_limit.status_code, 200, a2_over_limit.content)
        self.assertEqual(room_a4.status_code, 200, room_a4.content)

    def test_template_selection_requires_complete_studio_information(self):
        user = User.objects.create_user(username="required-studio-fields", password="longsecret-1")
        client = self.authed_client(user)
        plan = self.make_plan(user)

        incomplete = client.patch(
            f"/api/plans/{plan.id}/",
            {
                "active_sheet_template_key": "evacuation_consigne_gauche",
                "active_sheet_template_name": "Évacuation avec consignes",
            },
            format="json",
        )
        complete_information = _required_plan_creation_data()
        complete_information.pop("last_verification_date")
        complete_information.pop("next_verification_date")
        complete = client.patch(
            f"/api/plans/{plan.id}/",
            {
                **complete_information,
                "plan_information_visibility": {
                    "establishment_name": True,
                    "designer": False,
                },
            },
            format="json",
        )

        self.assertEqual(incomplete.status_code, 400, incomplete.content)
        self.assertIn("establishment_name", incomplete.data)
        self.assertEqual(complete.status_code, 200, complete.content)
        self.assertFalse(complete.data["plan_information_visibility"]["designer"])
        self.assertIsNone(complete.data["last_verification_date"])
        self.assertEqual(complete.data["next_verification_date"], "2027-08-31")

    def test_plan_information_visibility_rejects_unknown_or_non_boolean_values(self):
        user = User.objects.create_user(username="invalid-plan-visibility", password="longsecret-1")
        client = self.authed_client(user)
        plan = self.make_plan(user)

        unknown = client.patch(
            f"/api/plans/{plan.id}/",
            {"plan_information_visibility": {"unexpected": True}},
            format="json",
        )
        invalid = client.patch(
            f"/api/plans/{plan.id}/",
            {"plan_information_visibility": {"designer": "yes"}},
            format="json",
        )

        self.assertEqual(unknown.status_code, 400, unknown.content)
        self.assertEqual(invalid.status_code, 400, invalid.content)
        self.assertIn("plan_information_visibility", unknown.data)
        self.assertIn("plan_information_visibility", invalid.data)

    def test_plan_information_layout_accepts_geometry_and_rejects_unsafe_values(self):
        user = User.objects.create_user(username="plan-information-layout", password="longsecret-1")
        client = self.authed_client(user)
        plan = self.make_plan(user)
        layout = {
            "evacuation_consigne_gauche": {
                "x": 1040,
                "y": 885,
                "width": 520,
                "height": 120,
                "rotation": 0,
            },
        }

        accepted = client.patch(
            f"/api/plans/{plan.id}/",
            {"plan_information_layout": layout},
            format="json",
        )
        rejected = client.patch(
            f"/api/plans/{plan.id}/",
            {
                "plan_information_layout": {
                    "evacuation_consigne_gauche": {
                        **layout["evacuation_consigne_gauche"],
                        "width": 0,
                    },
                },
            },
            format="json",
        )

        self.assertEqual(accepted.status_code, 200, accepted.content)
        self.assertEqual(accepted.data["plan_information_layout"], layout)
        self.assertEqual(rejected.status_code, 400, rejected.content)
        self.assertIn("plan_information_layout", rejected.data)

    def test_sheet_plan_placement_is_plan_owned_and_validated(self):
        user = User.objects.create_user(username="plan-reframe", password="longsecret-1")
        client = self.authed_client(user)
        plan = self.make_plan(user)
        placement = {"scale": 245.5, "offsetX": -180, "offsetY": 74}

        accepted = client.patch(
            f"/api/plans/{plan.id}/",
            {"sheet_plan_placement": placement},
            format="json",
        )
        rejected = client.patch(
            f"/api/plans/{plan.id}/",
            {"sheet_plan_placement": {**placement, "scale": 5000}},
            format="json",
        )

        self.assertEqual(accepted.status_code, 200, accepted.content)
        self.assertEqual(accepted.data["sheet_plan_placement"], placement)
        self.assertEqual(rejected.status_code, 400, rejected.content)
        plan.refresh_from_db()
        self.assertEqual(plan.sheet_plan_placement, placement)

    def test_plan_legend_layout_is_plan_owned_and_validated(self):
        user = User.objects.create_user(username="plan-legend-layout", password="longsecret-1")
        client = self.authed_client(user)
        plan = self.make_plan(user)
        layout = {
            "nfx08070": {
                "x": 760,
                "y": 610,
                "width": 330,
                "height": 145,
                "rotation": 0,
                "visible": True,
            },
        }

        accepted = client.patch(
            f"/api/plans/{plan.id}/",
            {"plan_legend_layout": layout},
            format="json",
        )
        rejected = client.patch(
            f"/api/plans/{plan.id}/",
            {"plan_legend_layout": {"nfx08070": {**layout["nfx08070"], "visible": "yes"}}},
            format="json",
        )

        self.assertEqual(accepted.status_code, 200, accepted.content)
        self.assertEqual(accepted.data["plan_legend_layout"], layout)
        self.assertEqual(rejected.status_code, 400, rejected.content)
        plan.refresh_from_db()
        self.assertEqual(plan.plan_legend_layout, layout)

    def test_verification_dates_are_optional_and_next_date_is_automatic(self):
        user = User.objects.create_user(username="automatic-plan-dates", password="longsecret-1")
        client = self.authed_client(user)
        payload = {
            **_required_plan_creation_data(),
            "title": "Plan dates automatiques",
            "design_date": "2024-02-29",
            "background_type": "image",
            "background_file": SimpleUploadedFile(
                "plan-dates.png",
                _png_bytes(),
                content_type="image/png",
            ),
        }
        payload.pop("last_verification_date")
        payload.pop("next_verification_date")

        response = client.post("/api/plans/", payload, format="multipart")

        self.assertEqual(response.status_code, 201, response.content)
        self.assertIsNone(response.data["last_verification_date"])
        self.assertEqual(response.data["next_verification_date"], "2025-02-28")

    def test_duplicate_plan_copies_the_complete_editor_state(self):
        user = User.objects.create_user(username="plan-copy", password="longsecret-1")
        client = self.authed_client(user)
        source = self.make_plan(user, name="Étage 1")
        source.main_plan_x = 34
        source.main_plan_y = 56
        source.main_plan_width = 900
        source.main_plan_height = 650
        source.main_plan_locked = True
        source.main_plan_group_id = "main-group"
        source.main_plan_grouping_enabled = True
        source.watermark_config = {"client": "Client test", "reference": "ABC-42"}
        source.sheet_plan_placement = {"scale": 225, "offsetX": -120, "offsetY": 45}
        source.plan_legend_layout = {
            "nfx08070": {
                "x": 760, "y": 610, "width": 330, "height": 145,
                "rotation": 0, "visible": True,
            },
        }
        source.legend_hidden_icon_types = ["ria"]
        source.folder = PlanFolder.objects.create(user=user, name="Hôtel Central")
        source.active_sheet_template_key = "nfx08070"
        source.active_sheet_template_version_id = "custom:client-final"
        source.active_sheet_template_name = "Template final client"
        source.last_sheet_template_key = "nfx08070"
        source.last_sheet_template_version_id = "custom:client-final"
        source.last_sheet_template_name = "Template final client"
        source.cleaned_background_file.save(
            "cleaned.png", ContentFile(_png_bytes(color=(240, 240, 240))), save=False
        )
        source.use_cleaned_background = True
        source.save()

        PlanIcon.objects.create(
            plan=source,
            icon_type="extincteur",
            x=10,
            y=20,
            width=32,
            height=48,
            rotation=15,
            object_group_id="equipment-group",
            color="#C1121C",
            leader_points=[
                {"id": "leader-a", "x": 11.5, "y": 22.5},
                {"id": "leader-b", "x": 41.5, "y": 52.5},
            ],
        )
        PlanShape.objects.create(
            plan=source,
            shape_type="curve_polygon_zone",
            x=1,
            y=2,
            width=120,
            height=80,
            points=[{"x": 1, "y": 2}, {"x": 50, "y": 2}, {"x": 50, "y": 40}],
            control_points={"0": {"x": 25, "y": 8}},
            straight_segments=[1],
            closed=False,
        )
        PlanText.objects.create(
            plan=source,
            text="Sortie",
            x=80,
            y=90,
            align="center",
            bold=True,
        )
        overlay = self.make_overlay(source, label="Sous-sol")
        overlay.original_image_file.save(
            "overlay-original.png", ContentFile(_png_bytes(color=(250, 250, 250))), save=True
        )
        history = PlanCleaningHistory(
            plan=source,
            user=user,
            cleaning_method=PlanCleaningHistory.METHOD_LOCAL,
            title="Nettoyage local",
            options={"threshold": 180},
        )
        history.image_file.save(
            "history.png", ContentFile(_png_bytes(color=(230, 230, 230))), save=True
        )

        response = client.post(f"/api/plans/{source.id}/duplicate/", {}, format="json")

        self.assertEqual(response.status_code, 201, response.content)
        duplicated = EvacuationPlan.objects.get(pk=response.data["id"])
        self.assertEqual(duplicated.user, user)
        self.assertEqual(duplicated.title, "Étage 1 (copie)")
        self.assertEqual(duplicated.plan_number, f"PLAN-{duplicated.id:06d}")
        self.assertEqual(duplicated.revision_index, "A")
        self.assertEqual(duplicated.main_plan_x, 34)
        self.assertEqual(duplicated.watermark_config["reference"], "ABC-42")
        self.assertEqual(duplicated.sheet_plan_placement, source.sheet_plan_placement)
        self.assertEqual(duplicated.plan_legend_layout, source.plan_legend_layout)
        self.assertEqual(duplicated.legend_hidden_icon_types, ["ria"])
        self.assertEqual(duplicated.folder, source.folder)
        self.assertEqual(duplicated.active_sheet_template_key, "nfx08070")
        self.assertEqual(duplicated.active_sheet_template_version_id, "custom:client-final")
        self.assertEqual(duplicated.active_sheet_template_name, "Template final client")
        self.assertEqual(duplicated.last_sheet_template_key, "nfx08070")
        self.assertEqual(duplicated.last_sheet_template_version_id, "custom:client-final")
        self.assertEqual(duplicated.last_sheet_template_name, "Template final client")
        self.assertTrue(duplicated.use_cleaned_background)
        self.assertNotEqual(duplicated.background_file.name, source.background_file.name)
        self.assertNotEqual(
            duplicated.cleaned_background_file.name,
            source.cleaned_background_file.name,
        )
        self.assertEqual(duplicated.icons.count(), 1)
        self.assertEqual(duplicated.icons.get().object_group_id, "equipment-group")
        self.assertEqual(len(duplicated.icons.get().leader_points), 2)
        self.assertEqual(duplicated.shapes.count(), 1)
        self.assertFalse(duplicated.shapes.get().closed)
        self.assertEqual(duplicated.texts.get().align, "center")
        self.assertEqual(duplicated.overlays.count(), 1)
        self.assertNotEqual(
            duplicated.overlays.get().image_file.name,
            overlay.image_file.name,
        )
        self.assertTrue(bool(duplicated.overlays.get().original_image_file))
        self.assertEqual(duplicated.cleaning_history.count(), 1)
        self.assertEqual(duplicated.cleaning_history.get().user, user)

    def test_duplicate_plan_uses_an_available_copy_name(self):
        user = User.objects.create_user(username="plan-copy-name", password="longsecret-1")
        client = self.authed_client(user)
        source = self.make_plan(user, name="RDC")

        first = client.post(f"/api/plans/{source.id}/duplicate/", {}, format="json")
        second = client.post(f"/api/plans/{source.id}/duplicate/", {}, format="json")

        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(second.status_code, 201, second.content)
        self.assertEqual(first.data["title"], "RDC (copie)")
        self.assertEqual(second.data["title"], "RDC (copie 2)")

    def test_duplicate_plan_accepts_a_chosen_name(self):
        user = User.objects.create_user(username="plan-copy-custom", password="longsecret-1")
        client = self.authed_client(user)
        source = self.make_plan(user, name="RDC")

        response = client.post(
            f"/api/plans/{source.id}/duplicate/",
            {"title": "RDC – variante client"},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data["title"], "RDC – variante client")


class PlanSituationTests(_PlanFactoryMixin, TestCase):
    SAFE_SVG = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80">
      <rect x="1" y="1" width="118" height="78" fill="#ffffff" stroke="#111827" />
      <path d="M10 60 L55 20 L110 60" fill="none" stroke="#2563eb" />
    </svg>'''

    def setUp(self):
        super().setUp()
        self.owner = User.objects.create_user(
            username="situation-owner", password="longsecret-1"
        )
        self.viewer = User.objects.create_user(
            username="situation-viewer", password="longsecret-1"
        )
        self.plan = self.make_plan(self.owner, name="Plan avec situation")
        self.client = self.authed_client(self.owner)

    def test_old_plan_has_an_empty_backward_compatible_situation(self):
        response = self.client.get(f"/api/plans/{self.plan.id}/")

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data["plan_situation_config"], {})
        self.assertIsNone(response.data["plan_situation_background_file"])

    def test_situation_geometry_objects_rotation_and_locks_round_trip(self):
        config = _plan_situation_config()

        saved = self.client.patch(
            f"/api/plans/{self.plan.id}/",
            {"plan_situation_config": config},
            format="json",
        )
        reloaded = self.client.get(f"/api/plans/{self.plan.id}/")

        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(reloaded.status_code, 200, reloaded.content)
        self.assertEqual(reloaded.data["plan_situation_config"], config)
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.plan_situation_config["orientation"], 90)
        self.assertTrue(self.plan.plan_situation_config["sectorial"])
        self.assertEqual(
            self.plan.plan_situation_config["blocks"][3]["objectGroupId"],
            "plan-situation-group",
        )

    def test_situation_rejects_unknown_or_unsafe_block_sources(self):
        invalid_id = _plan_situation_config()
        invalid_id["blocks"][0]["id"] = "foreign-template-block"
        invalid_source = _plan_situation_config()
        invalid_source["blocks"][0]["imageKey"] = "https://attacker.example/plan.svg"

        rejected_id = self.client.patch(
            f"/api/plans/{self.plan.id}/",
            {"plan_situation_config": invalid_id},
            format="json",
        )
        rejected_source = self.client.patch(
            f"/api/plans/{self.plan.id}/",
            {"plan_situation_config": invalid_source},
            format="json",
        )

        self.assertEqual(rejected_id.status_code, 400, rejected_id.content)
        self.assertEqual(rejected_source.status_code, 400, rejected_source.content)
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.plan_situation_config, {})

    def test_png_background_upload_and_clean_delete(self):
        uploaded = self.client.post(
            f"/api/plans/{self.plan.id}/situation-background/",
            {
                "file": SimpleUploadedFile(
                    "site.png", _png_bytes(size=(320, 180)), content_type="image/png"
                )
            },
            format="multipart",
        )

        self.assertEqual(uploaded.status_code, 200, uploaded.content)
        self.assertTrue(uploaded.data["plan_situation_background_file"])
        self.plan.refresh_from_db()
        stored_name = self.plan.plan_situation_background_file.name
        self.assertTrue(self.plan.plan_situation_background_file.storage.exists(stored_name))

        with self.captureOnCommitCallbacks(execute=True):
            deleted = self.client.delete(
                f"/api/plans/{self.plan.id}/situation-background/"
            )

        self.assertEqual(deleted.status_code, 200, deleted.content)
        self.plan.refresh_from_db()
        self.assertFalse(self.plan.plan_situation_background_file)
        self.assertFalse(self.plan._meta.get_field(
            "plan_situation_background_file"
        ).storage.exists(stored_name))

    def test_safe_svg_is_stored_sanitized_and_active_svg_is_rejected(self):
        accepted = self.client.post(
            f"/api/plans/{self.plan.id}/situation-background/",
            {
                "file": SimpleUploadedFile(
                    "site.svg", self.SAFE_SVG, content_type="image/svg+xml"
                )
            },
            format="multipart",
        )

        self.assertEqual(accepted.status_code, 200, accepted.content)
        self.plan.refresh_from_db()
        stored_name = self.plan.plan_situation_background_file.name
        with self.plan.plan_situation_background_file.storage.open(stored_name, "rb") as stored:
            stored_svg = stored.read().lower()
        self.assertIn(b"<svg", stored_svg)
        self.assertNotIn(b"<script", stored_svg)

        rejected = self.client.post(
            f"/api/plans/{self.plan.id}/situation-background/",
            {
                "file": SimpleUploadedFile(
                    "active.svg",
                    b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>',
                    content_type="image/svg+xml",
                )
            },
            format="multipart",
        )

        self.assertEqual(rejected.status_code, 400, rejected.content)
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.plan_situation_background_file.name, stored_name)

    def test_duplicate_copies_situation_json_and_background_independently(self):
        self.plan.plan_situation_config = _plan_situation_config()
        self.plan.plan_situation_background_file.save(
            "situation.png", ContentFile(_png_bytes(size=(300, 180))), save=True
        )
        source_name = self.plan.plan_situation_background_file.name

        duplicated_response = self.client.post(
            f"/api/plans/{self.plan.id}/duplicate/", {}, format="json"
        )

        self.assertEqual(duplicated_response.status_code, 201, duplicated_response.content)
        duplicated = EvacuationPlan.objects.get(pk=duplicated_response.data["id"])
        self.assertEqual(duplicated.plan_situation_config, self.plan.plan_situation_config)
        self.assertNotEqual(duplicated.plan_situation_background_file.name, source_name)
        self.assertTrue(duplicated.plan_situation_background_file.storage.exists(
            duplicated.plan_situation_background_file.name
        ))

    def test_workspace_viewer_can_read_but_cannot_change_situation_background(self):
        WorkspaceMembership.objects.create(
            owner=self.owner,
            member=self.viewer,
            role=WorkspaceMembership.ROLE_VIEWER,
        )
        viewer_client = self.authed_client(self.viewer)

        detail = viewer_client.get(f"/api/plans/{self.plan.id}/")
        upload = viewer_client.post(
            f"/api/plans/{self.plan.id}/situation-background/",
            {
                "file": SimpleUploadedFile(
                    "site.png", _png_bytes(), content_type="image/png"
                )
            },
            format="multipart",
        )
        delete = viewer_client.delete(
            f"/api/plans/{self.plan.id}/situation-background/"
        )
        patch_response = viewer_client.patch(
            f"/api/plans/{self.plan.id}/",
            {"plan_situation_config": _plan_situation_config()},
            format="json",
        )

        self.assertEqual(detail.status_code, 200, detail.content)
        self.assertEqual(upload.status_code, 403, upload.content)
        self.assertEqual(delete.status_code, 403, delete.content)
        self.assertEqual(patch_response.status_code, 403, patch_response.content)


class PictogramLibraryTests(_PlanFactoryMixin, TestCase):
    VALID_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 170 170">
      <rect x="10" y="10" width="150" height="150" fill="#00a651" />
      <path d="M45 85h80" stroke="#fff" stroke-width="12" />
    </svg>"""

    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(username="svg-user", password="longsecret-1")
        self.client = self.authed_client(self.user)

    def user_pictogram_path(self, user, *path_parts):
        return os.path.join(
            self._test_media.name,
            "user_pictograms",
            str(user.id),
            *path_parts,
        )

    def catalogue_pictogram_path(self, relative_path):
        return os.path.join(
            self._test_media.name,
            "nf-x08-070-picto",
            "symboles",
            "svg",
            *relative_path.split("/"),
        )

    def other_catalogue_pictogram_path(self, relative_path):
        return os.path.join(
            self._test_media.name,
            "autres-picto",
            "symboles",
            "svg",
            *relative_path.split("/"),
        )

    def write_catalogue_pictogram(self, relative_path, source=None):
        absolute_path = self.catalogue_pictogram_path(relative_path)
        os.makedirs(os.path.dirname(absolute_path), exist_ok=True)
        with open(absolute_path, "w", encoding="utf-8") as destination:
            destination.write(source or self.VALID_SVG)
        return absolute_path

    def write_other_catalogue_pictogram(self, relative_path, source=None):
        absolute_path = self.other_catalogue_pictogram_path(relative_path)
        os.makedirs(os.path.dirname(absolute_path), exist_ok=True)
        with open(absolute_path, "w", encoding="utf-8") as destination:
            destination.write(source or self.VALID_SVG)
        return absolute_path

    def use_media_cookie(self, client, user):
        from django.conf import settings as django_settings
        from .media_access import media_session_value

        client.cookies[django_settings.MEDIA_SESSION_COOKIE_NAME] = media_session_value(user)
        return client

    def test_registered_standard_catalogue_is_recursive_and_categorized(self):
        self.write_catalogue_pictogram("03-lutte/3A-extincteurs/lutte_ext_CO2.svg")

        response = self.client.get("/api/plans/pictograms/")

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.json()), 1)
        pictogram = response.json()[0]
        self.assertEqual(
            pictogram["type"],
            "nfx08070:03-lutte:3a-extincteurs:lutte_ext_co2",
        )
        self.assertEqual(pictogram["label"], "Lutte ext CO2")
        self.assertEqual(pictogram["standard"], "nfx08070")
        self.assertEqual(pictogram["standard_label"], "NF X 08-070")
        self.assertEqual(pictogram["category"], "03-lutte")
        self.assertEqual(
            pictogram["category_label"],
            "Moyens de lutte contre l’incendie",
        )
        self.assertEqual(pictogram["subcategory"], "3A-extincteurs")
        self.assertEqual(pictogram["subcategory_label"], "Extincteurs")
        self.assertFalse(pictogram["deletable"])

    def test_complementary_catalogue_is_separate_from_nf_x_08_070(self):
        self.write_other_catalogue_pictogram("01-accessibilite/urgence-sourds.svg")

        response = self.client.get("/api/plans/pictograms/")

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.json()), 1)
        pictogram = response.json()[0]
        self.assertEqual(pictogram["type"], "other:01-accessibilite:urgence-sourds")
        self.assertEqual(pictogram["label"], "Urgence personnes sourdes — 114")
        self.assertEqual(pictogram["standard"], "other")
        self.assertEqual(pictogram["standard_label"], "Autres")
        self.assertEqual(pictogram["category"], "01-accessibilite")
        self.assertEqual(pictogram["category_label"], "Accessibilité et assistance")
        self.assertFalse(pictogram["deletable"])

    def test_unsafe_registered_catalogue_svg_is_neither_listed_nor_served(self):
        relative_path = "01-evacuation/dangereux.svg"
        self.write_catalogue_pictogram(
            relative_path,
            """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
              <script>alert('x')</script>
            </svg>""",
        )

        listing = self.client.get("/api/plans/pictograms/")
        self.use_media_cookie(self.client, self.user)
        media = self.client.get(
            f"/api/media/nf-x08-070-picto/symboles/svg/{relative_path}"
        )

        self.assertEqual(listing.status_code, 200, listing.content)
        self.assertEqual(listing.json(), [])
        self.assertEqual(media.status_code, 404)

    @override_settings(
        MEDIA_USE_X_ACCEL_REDIRECT=True,
        MEDIA_X_ACCEL_LOCATION="/protected-media/",
    )
    def test_registered_catalogue_svg_is_sanitized_when_served(self):
        relative_path = "01-evacuation/avec-metadata.svg"
        self.write_catalogue_pictogram(
            relative_path,
            """<svg xmlns="http://www.w3.org/2000/svg"
                     xmlns:editor="https://example.invalid/editor"
                     viewBox="0 0 100 100">
              <editor:layer><path d="M0 0h100v100H0z" /></editor:layer>
            </svg>""",
        )
        self.use_media_cookie(self.client, self.user)

        response = self.client.get(
            f"/api/media/nf-x08-070-picto/symboles/svg/{relative_path}"
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response["Content-Type"], "image/svg+xml")
        self.assertNotIn("X-Accel-Redirect", response)
        self.assertIn("sandbox", response["Content-Security-Policy"])
        self.assertNotIn(b"editor:layer", response.content)
        self.assertNotIn(b"example.invalid", response.content)
        self.assertIn(b"<path", response.content)

    def test_create_svg_from_code_adds_it_to_the_library(self):
        response = self.client.post(
            "/api/plans/pictograms/",
            {"name": "Sortie personnalisée", "svg": self.VALID_SVG},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["type"], "Sortie personnalisée")
        self.assertEqual(
            response.json()["file_name"],
            f"user_pictograms/{self.user.id}/Sortie personnalisée.svg",
        )
        self.assertTrue(
            os.path.isfile(self.user_pictogram_path(self.user, "Sortie personnalisée.svg"))
        )

        listing = self.client.get("/api/plans/pictograms/")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual([item["type"] for item in listing.json()], ["Sortie personnalisée"])

    def test_create_svg_can_choose_a_standard_and_category(self):
        response = self.client.post(
            "/api/plans/pictograms/",
            {
                "name": "Extincteur complémentaire",
                "svg": self.VALID_SVG,
                "standard": "nfx08070",
                "category": "03-lutte",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.content)
        pictogram = response.json()
        self.assertEqual(pictogram["standard"], "nfx08070")
        self.assertEqual(pictogram["standard_label"], "NF X 08-070")
        self.assertEqual(pictogram["category"], "03-lutte")
        self.assertEqual(
            pictogram["category_label"],
            "Moyens de lutte contre l’incendie",
        )
        self.assertEqual(
            pictogram["file_name"],
            f"user_pictograms/{self.user.id}/nfx08070/03-lutte/Extincteur complémentaire.svg",
        )
        self.assertTrue(os.path.isfile(self.user_pictogram_path(
            self.user,
            "nfx08070",
            "03-lutte",
            "Extincteur complémentaire.svg",
        )))

        listing = self.client.get("/api/plans/pictograms/")
        listed = next(
            item for item in listing.json()
            if item["type"] == "Extincteur complémentaire"
        )
        self.assertEqual(listed["standard"], "nfx08070")
        self.assertEqual(listed["category"], "03-lutte")
        self.assertTrue(listed["deletable"])

        renamed = self.client.patch(
            "/api/plans/pictograms/",
            {
                "file_name": pictogram["file_name"],
                "name": "Extincteur classé",
            },
            format="json",
        )
        self.assertEqual(renamed.status_code, 200, renamed.content)
        self.assertEqual(renamed.json()["standard"], "nfx08070")
        self.assertEqual(renamed.json()["category"], "03-lutte")
        self.assertTrue(os.path.isfile(self.user_pictogram_path(
            self.user,
            "nfx08070",
            "03-lutte",
            "Extincteur classé.svg",
        )))

        deleted = self.client.delete(
            f"/api/plans/pictograms/?file_name={quote(renamed.json()['file_name'], safe='')}",
        )
        self.assertEqual(deleted.status_code, 204, deleted.content)

    def test_create_svg_rejects_an_unknown_catalogue_destination(self):
        response = self.client.post(
            "/api/plans/pictograms/",
            {
                "name": "Mauvaise destination",
                "svg": self.VALID_SVG,
                "standard": "nfx08070",
                "category": "99-inconnue",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("destination", response.json()["error"])
        self.assertFalse(os.path.exists(self.user_pictogram_path(
            self.user,
            "nfx08070",
            "99-inconnue",
        )))

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
        self.assertFalse(os.path.exists(self.user_pictogram_path(self.user, "Dangereux.svg")))

    def test_rectangular_svg_is_accepted(self):
        response = self.client.post(
            "/api/plans/pictograms/",
            {
                "name": "Rectangle",
                "svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" />',
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(
            os.path.isfile(self.user_pictogram_path(self.user, "Rectangle.svg"))
        )

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
            os.path.exists(self.user_pictogram_path(self.user, "À supprimer.svg"))
        )

    def test_delete_svg_in_use_is_frozen_in_each_project_first(self):
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

        self.assertEqual(response.status_code, 204)
        self.assertFalse(os.path.exists(self.user_pictogram_path(self.user, "SVG utilisé.svg")))
        frozen = plan.project_resources.select_related('asset').get(
            role='pictogram', key='SVG utilisé'
        )
        self.assertTrue(frozen.asset.file.storage.exists(frozen.asset.file.name))
        self.assertEqual(plan.project_revisions.count(), 1)

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
        self.assertFalse(os.path.exists(self.user_pictogram_path(self.user, "Ancien nom.svg")))
        self.assertTrue(os.path.exists(self.user_pictogram_path(self.user, "Nouveau nom.svg")))
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

    def test_imported_svg_is_private_to_its_creator(self):
        other = User.objects.create_user(username="svg-other", password="longsecret-1")
        other_client = self.authed_client(other)

        create = self.client.post(
            "/api/plans/pictograms/",
            {"name": "Privé créateur", "svg": self.VALID_SVG},
            format="json",
        )
        self.assertEqual(create.status_code, 201)
        media_url = create.json()["url"]

        owner_listing = self.client.get("/api/plans/pictograms/")
        other_listing = other_client.get("/api/plans/pictograms/")

        self.assertIn("Privé créateur", [item["type"] for item in owner_listing.json()])
        self.assertNotIn("Privé créateur", [item["type"] for item in other_listing.json()])
        self.use_media_cookie(other_client, other)
        self.assertEqual(other_client.get(urlsplit(media_url).path).status_code, 403)

    def test_invited_user_can_see_owner_imported_svg(self):
        invited = User.objects.create_user(username="svg-invited", password="longsecret-1")
        WorkspaceMembership.objects.create(
            owner=self.user,
            member=invited,
            role=WorkspaceMembership.ROLE_VIEWER,
        )
        invited_client = self.authed_client(invited)

        create = self.client.post(
            "/api/plans/pictograms/",
            {"name": "Visible invité", "svg": self.VALID_SVG},
            format="json",
        )
        self.assertEqual(create.status_code, 201)

        listing = invited_client.get("/api/plans/pictograms/")

        self.assertIn("Visible invité", [item["type"] for item in listing.json()])

    def test_workspace_owner_can_see_invited_user_imported_svg(self):
        invited = User.objects.create_user(username="svg-invited-owner-view", password="longsecret-1")
        WorkspaceMembership.objects.create(
            owner=self.user,
            member=invited,
            role=WorkspaceMembership.ROLE_EDITOR,
        )
        invited_client = self.authed_client(invited)

        create = invited_client.post(
            "/api/plans/pictograms/",
            {"name": "SVG ajouté par invité", "svg": self.VALID_SVG},
            format="json",
        )
        self.assertEqual(create.status_code, 201)

        listing = self.client.get("/api/plans/pictograms/")
        media_client = self.use_media_cookie(self.client, self.user)
        media_response = media_client.get(urlsplit(create.json()["url"]).path)

        self.assertIn("SVG ajouté par invité", [item["type"] for item in listing.json()])
        self.assertEqual(media_response.status_code, 200)
        self.assertEqual(media_response["Content-Type"], "image/svg+xml")

    def test_legacy_plan_picto_svg_is_shared_with_all_users(self):
        other = User.objects.create_user(username="legacy-other", password="longsecret-1")
        invited = User.objects.create_user(username="legacy-invited", password="longsecret-1")
        WorkspaceMembership.objects.create(
            owner=self.user,
            member=invited,
            role=WorkspaceMembership.ROLE_VIEWER,
        )
        plan = self.make_plan(self.user, name="legacy-svg-plan")
        PlanIcon.objects.create(
            plan=plan,
            icon_type="Ancien SVG",
            x=10,
            y=10,
            width=40,
            height=40,
        )
        name = default_storage.save(
            "plan_picto/Ancien SVG.svg",
            ContentFile(self.VALID_SVG.encode("utf-8")),
        )

        try:
            owner_listing = self.client.get("/api/plans/pictograms/")
            invited_listing = self.authed_client(invited).get("/api/plans/pictograms/")
            other_client = self.use_media_cookie(self.authed_client(other), other)

            self.assertIn("Ancien SVG", [item["type"] for item in owner_listing.json()])
            self.assertIn("Ancien SVG", [item["type"] for item in invited_listing.json()])
            self.assertIn(
                "Ancien SVG",
                [item["type"] for item in self.authed_client(other).get("/api/plans/pictograms/").json()],
            )
            self.assertEqual(other_client.get(f"/api/media/{quote(name, safe='/')}").status_code, 200)
        finally:
            default_storage.delete(name)

    def test_template_assets_are_private_but_visible_to_invited_users(self):
        other = User.objects.create_user(username="asset-other", password="longsecret-1")
        invited = User.objects.create_user(username="asset-invited", password="longsecret-1")
        WorkspaceMembership.objects.create(
            owner=self.user,
            member=invited,
            role=WorkspaceMembership.ROLE_VIEWER,
        )
        asset = SheetTemplateAsset.objects.create(
            user=self.user,
            name="PDF importé privé",
            image_file=SimpleUploadedFile("template.png", _png_bytes(), content_type="image/png"),
            width=24,
            height=24,
        )

        self.assertTrue(asset.image_file.name.startswith("sheet_template_assets/"))
        other_client = self.use_media_cookie(self.authed_client(other), other)
        self.assertEqual(other_client.get(f"/api/media/{asset.image_file.name}").status_code, 403)
        invited_client = self.authed_client(invited)
        self.use_media_cookie(invited_client, invited)
        self.assertEqual(invited_client.get(f"/api/media/{asset.image_file.name}").status_code, 200)


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
    def test_replacing_hidden_main_plan_makes_new_background_visible(self):
        user = User.objects.create_user(username="replace-hidden-plan", password="longsecret-1")
        plan = self.make_plan(user)
        plan.main_plan_x = 400
        plan.main_plan_y = 250
        plan.main_plan_width = 900
        plan.main_plan_height = 600
        plan.main_plan_visible = False
        plan.save(update_fields=[
            "main_plan_x",
            "main_plan_y",
            "main_plan_width",
            "main_plan_height",
            "main_plan_visible",
        ])
        client = self.authed_client(user)

        response = client.post(
            f"/api/plans/{plan.id}/change-background/",
            {
                "background_file": SimpleUploadedFile(
                    "nouveau-plan.png",
                    _png_bytes(color=(230, 230, 230)),
                    content_type="image/png",
                ),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 200, response.content)
        plan.refresh_from_db()
        self.assertTrue(plan.main_plan_visible)
        self.assertEqual(plan.main_plan_x, 0)
        self.assertEqual(plan.main_plan_y, 0)
        self.assertEqual(plan.main_plan_width, 0)
        self.assertEqual(plan.main_plan_height, 0)
        self.assertTrue(response.data["main_plan_visible"])

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
        self.assertFalse(serializer.validated_data["closed"])

    def test_curve_zone_can_stay_open_and_never_keeps_a_fill(self):
        from .serializers import PlanShapeSerializer

        serializer = PlanShapeSerializer(data={
            "shape_type": "curve_polygon_zone",
            "x": 10,
            "y": 20,
            "width": 80,
            "height": 40,
            "rotation": 0,
            "stroke_width": 3,
            "color": "#111111",
            "fill_color": "#ff0000",
            "fill_opacity": 0.8,
            "tension": 0.35,
            "closed": False,
            "straight_segments": [0],
            "points": [
                {"x": 10, "y": 20},
                {"x": 50, "y": 60},
                {"x": 90, "y": 20},
            ],
        })

        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertFalse(serializer.validated_data["closed"])
        self.assertEqual(serializer.validated_data["straight_segments"], [0])
        self.assertEqual(serializer.validated_data["tension"], 0)
        self.assertIsNone(serializer.validated_data["fill_color"])
        self.assertEqual(serializer.validated_data["fill_opacity"], 0)

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
                "leader_points": [
                    {"id": "leader-1", "x": 12.5, "y": 24.5},
                    {"id": "leader-2", "x": 62.5, "y": 74.5},
                ],
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
                "align": "center",
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
                "active_sheet_template_key": "nfx08070",
                "active_sheet_template_version_id": "custom:client-final",
                "active_sheet_template_name": "Template final client",
                "document_type": "technical_safety",
                "export_paper_format": "a3",
                "print_scale_denominator": 250,
                "plan_information_layout": {
                    "nfx08070": {
                        "x": 990,
                        "y": 920,
                        "width": 500,
                        "height": 110,
                        "rotation": 0,
                    },
                },
                "plan_legend_layout": {
                    "nfx08070": {
                        "x": 760,
                        "y": 610,
                        "width": 330,
                        "height": 145,
                        "rotation": 0,
                        "visible": True,
                    },
                },
                "legend_hidden_icon_types": ["ria", "alarme"],
                "plan_situation_config": _plan_situation_config(),
                "sheet_plan_placement": {
                    "scale": 240,
                    "offsetX": -175,
                    "offsetY": 68,
                },
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
        _complete_plan_information(plan)
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
        self.assertEqual(plan.active_sheet_template_key, "nfx08070")
        self.assertEqual(plan.active_sheet_template_version_id, "custom:client-final")
        self.assertEqual(plan.active_sheet_template_name, "Template final client")
        self.assertEqual(plan.last_sheet_template_key, "nfx08070")
        self.assertEqual(plan.last_sheet_template_version_id, "custom:client-final")
        self.assertEqual(plan.last_sheet_template_name, "Template final client")
        self.assertEqual(plan.document_type, "technical_safety")
        self.assertEqual(plan.export_paper_format, "a3")
        self.assertEqual(plan.print_scale_denominator, 250)
        self.assertEqual(response.data["active_sheet_template_name"], "Template final client")
        self.assertEqual(plan.plan_information_layout["nfx08070"]["x"], 990)
        self.assertEqual(response.data["plan_information_layout"], plan.plan_information_layout)
        self.assertEqual(plan.plan_legend_layout["nfx08070"]["x"], 760)
        self.assertEqual(response.data["plan_legend_layout"], plan.plan_legend_layout)
        self.assertEqual(plan.legend_hidden_icon_types, ["ria", "alarme"])
        self.assertEqual(response.data["legend_hidden_icon_types"], ["ria", "alarme"])
        self.assertEqual(plan.plan_situation_config, _plan_situation_config())
        self.assertEqual(response.data["plan_situation_config"], plan.plan_situation_config)
        self.assertEqual(
            plan.sheet_plan_placement,
            {"scale": 240, "offsetX": -175, "offsetY": 68},
        )
        self.assertEqual(response.data["sheet_plan_placement"], plan.sheet_plan_placement)
        self.assertTrue(plan.watermark_config["enabled"])
        self.assertEqual(plan.watermark_config["reference"], "BAT-42")
        self.assertTrue(plan.watermark_config["client_logo"].startswith("data:image/png;base64,"))
        self.assertTrue(plan.watermark_config["creator_logo"].startswith("data:image/png;base64,"))
        self.assertTrue(plan.icons.get().locked)
        self.assertTrue(plan.icons.get().visible)
        self.assertEqual(plan.icons.get().z_index, 80)
        self.assertEqual(plan.icons.get().group_id, "plan-group-test")
        self.assertEqual(plan.icons.get().object_group_id, "object-group-test")
        self.assertEqual(len(plan.icons.get().leader_points), 2)
        self.assertEqual(plan.shapes.get().group_id, "plan-group-test")
        self.assertEqual(plan.shapes.get().object_group_id, "object-group-test")
        self.assertFalse(plan.shapes.get().visible)
        self.assertEqual(plan.shapes.get().z_index, 70)
        self.assertEqual(plan.texts.get().group_id, "plan-group-test")
        self.assertEqual(plan.texts.get().object_group_id, "object-group-test")
        self.assertEqual(plan.texts.get().align, "center")
        self.assertTrue(plan.texts.get().visible)
        self.assertEqual(plan.texts.get().z_index, 90)
        overlay = plan.overlays.get()
        self.assertTrue(overlay.locked)
        self.assertFalse(overlay.visible)
        self.assertEqual(overlay.z_index, 40)
        self.assertEqual(overlay.group_id, "plan-group-test")
        self.assertEqual(overlay.rotation, 12)

    def test_sync_editor_persists_a_hidden_scale_calibration_and_measurement(self):
        user = User.objects.create_user(username="scale-calibration", password="longsecret-1")
        plan = self.make_plan(user)
        _complete_plan_information(plan)
        client = self.authed_client(user)
        image_data = "data:image/png;base64," + base64.b64encode(_png_bytes()).decode("ascii")
        payload = self.editor_payload(image_data)
        payload["shapes"].append({
            "shape_type": "line",
            "x": 100,
            "y": 120,
            "width": 400,
            "height": 0,
            "rotation": 0,
            "stroke_width": 2,
            "color": "#0ea5e9",
            "locked": False,
            "visible": True,
            "z_index": 200,
            "group_id": "",
            "object_group_id": "",
            "is_scale_calibration": True,
            "calibration_real_distance_m": 10,
        })
        payload["plan_settings"]["measured_scale_denominator"] = 200.0

        response = client.post(
            f"/api/plans/{plan.id}/sync-editor/",
            payload,
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        plan.refresh_from_db()
        calibration = plan.shapes.get(is_scale_calibration=True)
        self.assertEqual(calibration.shape_type, "line")
        self.assertEqual(calibration.calibration_real_distance_m, 10)
        self.assertTrue(calibration.locked)
        self.assertFalse(calibration.visible)
        self.assertEqual(plan.measured_scale_denominator, 200.0)
        self.assertEqual(response.data["measured_scale_denominator"], 200.0)

    def test_sync_editor_rejects_a_measurement_without_calibration(self):
        user = User.objects.create_user(username="scale-without-line", password="longsecret-1")
        plan = self.make_plan(user)
        _complete_plan_information(plan)
        client = self.authed_client(user)
        image_data = "data:image/png;base64," + base64.b64encode(_png_bytes()).decode("ascii")
        payload = self.editor_payload(image_data)
        payload["plan_settings"]["measured_scale_denominator"] = 200.0

        response = client.post(
            f"/api/plans/{plan.id}/sync-editor/",
            payload,
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("plan_settings", response.data)
        self.assertEqual(plan.shapes.count(), 0)

    def test_sync_editor_saves_a_measured_scale_over_the_recommended_limit(self):
        user = User.objects.create_user(username="scale-over-limit", password="longsecret-1")
        plan = self.make_plan(user)
        _complete_plan_information(plan)
        client = self.authed_client(user)
        image_data = "data:image/png;base64," + base64.b64encode(_png_bytes()).decode("ascii")
        payload = self.editor_payload(image_data)
        payload["shapes"].append({
            "shape_type": "line",
            "x": 0,
            "y": 0,
            "width": 100,
            "height": 0,
            "rotation": 0,
            "stroke_width": 2,
            "color": "#0ea5e9",
            "is_scale_calibration": True,
            "calibration_real_distance_m": 10,
        })
        payload["plan_settings"]["measured_scale_denominator"] = 251.0

        response = client.post(
            f"/api/plans/{plan.id}/sync-editor/",
            payload,
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        plan.refresh_from_db()
        self.assertEqual(plan.shapes.filter(is_scale_calibration=True).count(), 1)
        self.assertEqual(plan.measured_scale_denominator, 251.0)

    def test_scale_calibration_shape_requires_a_positive_distance(self):
        from .serializers import PlanShapeSerializer

        serializer = PlanShapeSerializer(data={
            "shape_type": "line",
            "x": 0,
            "y": 0,
            "width": 100,
            "height": 0,
            "rotation": 0,
            "stroke_width": 2,
            "color": "#0ea5e9",
            "is_scale_calibration": True,
            "calibration_real_distance_m": 0,
        })

        self.assertFalse(serializer.is_valid())
        self.assertIn("calibration_real_distance_m", serializer.errors)

    def test_sync_editor_rejects_a_template_until_plan_information_is_complete(self):
        user = User.objects.create_user(username="incomplete-template-save", password="longsecret-1")
        plan = self.make_plan(user)
        client = self.authed_client(user)
        image_data = "data:image/png;base64," + base64.b64encode(_png_bytes()).decode("ascii")

        response = client.post(
            f"/api/plans/{plan.id}/sync-editor/",
            self.editor_payload(image_data),
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("establishment_name", response.data["missing_fields"])
        self.assertEqual(plan.icons.count(), 0)

    def test_sync_editor_accepts_bundled_default_studio_logo(self):
        user = User.objects.create_user(username="default-logo-editor", password="longsecret-1")
        plan = self.make_plan(user)
        _complete_plan_information(plan)
        client = self.authed_client(user)
        image_data = "data:image/png;base64," + base64.b64encode(_png_bytes()).decode("ascii")
        payload = self.editor_payload(image_data)
        payload["plan_settings"]["watermark"]["creator_logo"] = "/prev-inc-cie-logo.png"

        response = client.post(
            f"/api/plans/{plan.id}/sync-editor/",
            payload,
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        plan.refresh_from_db()
        self.assertEqual(plan.watermark_config["creator_logo"], "/prev-inc-cie-logo.png")

    def test_sync_editor_validates_before_replacing_existing_layers(self):
        user = User.objects.create_user(username="atomic", password="longsecret-1")
        plan = self.make_plan(user)
        _complete_plan_information(plan)
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


class SheetTemplatePersistenceTests(_PlanFactoryMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(username="template-owner", password="longsecret-1")
        self.other_user = User.objects.create_user(username="template-other", password="longsecret-1")
        DefaultTemplateEditPermission.objects.create(
            user=self.user,
            can_edit_default_templates=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.payload = {
            "versions": [{
                "id": "draft:nfx08070",
                "template": "nfx08070",
                "name": "Dernière modification - NF X08-070",
                "blocks": [{
                    "id": "plan-main",
                    "kind": "plan",
                    "label": "Plan principal",
                    "x": 100,
                    "y": 120,
                    "width": 900,
                    "height": 700,
                    "rotation": 0,
                    "visible": True,
                }],
                "planPlacement": {"scale": 110, "offsetX": 15, "offsetY": -8},
                "createdAt": "2026-08-19T10:00:00Z",
                "updatedAt": "2026-08-19T10:05:00Z",
            }],
        }

    def test_template_versions_are_saved_and_read_from_the_server(self):
        saved = self.client.put("/api/plans/sheet-templates/", self.payload, format="json")

        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(SheetTemplateVersion.objects.filter(user=self.user).count(), 1)
        stored = SheetTemplateVersion.objects.get(user=self.user)
        self.assertEqual(stored.version_id, "draft:nfx08070")
        self.assertEqual(stored.blocks[0]["width"], 900)

        loaded = self.client.get("/api/plans/sheet-templates/")
        self.assertEqual(loaded.status_code, 200, loaded.content)
        self.assertEqual(loaded.data, saved.data)
        self.assertEqual(loaded.data[0]["planPlacement"]["scale"], 110.0)

    def test_template_versions_are_private_to_each_account(self):
        self.client.put("/api/plans/sheet-templates/", self.payload, format="json")
        self.client.force_authenticate(user=self.other_user)

        response = self.client.get("/api/plans/sheet-templates/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, [])

    def test_invited_user_reads_owner_template_versions(self):
        custom = {
            **self.payload["versions"][0],
            "id": "custom:test-template",
            "name": "Template créé par test",
        }
        self.client.put("/api/plans/sheet-templates/", {"versions": [custom]}, format="json")
        WorkspaceMembership.objects.create(
            owner=self.user,
            member=self.other_user,
            role=WorkspaceMembership.ROLE_EDITOR,
        )
        self.client.force_authenticate(user=self.other_user)

        response = self.client.get("/api/plans/sheet-templates/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual([version["id"] for version in response.data], ["custom:test-template"])
        self.assertEqual(response.data[0]["owner"], self.user.id)

    def test_workspace_owner_reads_invited_user_template_versions(self):
        WorkspaceMembership.objects.create(
            owner=self.user,
            member=self.other_user,
            role=WorkspaceMembership.ROLE_EDITOR,
        )
        self.client.force_authenticate(user=self.other_user)
        custom = {
            **self.payload["versions"][0],
            "id": "custom:test7-template",
            "name": "Template créé par test7",
        }
        saved = self.client.put("/api/plans/sheet-templates/", {"versions": [custom]}, format="json")
        self.assertEqual(saved.status_code, 200, saved.content)

        self.client.force_authenticate(user=self.user)
        response = self.client.get("/api/plans/sheet-templates/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("custom:test7-template", [version["id"] for version in response.data])
        invited_version = next(version for version in response.data if version["id"] == "custom:test7-template")
        self.assertEqual(invited_version["owner"], self.other_user.id)

    def test_invited_user_writes_only_their_own_template_versions(self):
        self.client.put("/api/plans/sheet-templates/", self.payload, format="json")
        WorkspaceMembership.objects.create(
            owner=self.user,
            member=self.other_user,
            role=WorkspaceMembership.ROLE_EDITOR,
        )
        self.client.force_authenticate(user=self.other_user)
        personal = {
            **self.payload["versions"][0],
            "id": "custom:test7-copy",
            "name": "Copie test7",
        }

        response = self.client.put(
            "/api/plans/sheet-templates/",
            {"versions": [personal]},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(
            SheetTemplateVersion.objects.filter(user=self.user, version_id="draft:nfx08070").exists()
        )
        self.assertTrue(
            SheetTemplateVersion.objects.filter(user=self.other_user, version_id="custom:test7-copy").exists()
        )

    def test_replacing_versions_removes_deleted_template_from_server(self):
        self.client.put("/api/plans/sheet-templates/", self.payload, format="json")

        response = self.client.put(
            "/api/plans/sheet-templates/",
            {"versions": []},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(SheetTemplateVersion.objects.filter(user=self.user).exists())

    def test_invalid_template_payload_is_rejected(self):
        invalid = {
            "versions": [{
                **self.payload["versions"][0],
                "id": "invalid id with spaces",
            }],
        }

        response = self.client.put("/api/plans/sheet-templates/", invalid, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertFalse(SheetTemplateVersion.objects.exists())

    def test_custom_template_and_its_restore_baseline_round_trip(self):
        custom = {
            **self.payload["versions"][0],
            "id": "custom:hotel-a3",
            "name": "Hôtel A3 personnalisé",
        }
        baseline = {
            **custom,
            "id": "baseline:hotel-a3",
            "name": "Hôtel A3 personnalisé — état de départ",
        }

        saved = self.client.put(
            "/api/plans/sheet-templates/",
            {"versions": [custom, baseline]},
            format="json",
        )

        self.assertEqual(saved.status_code, 200, saved.content)
        loaded = self.client.get("/api/plans/sheet-templates/")
        self.assertEqual(loaded.status_code, 200, loaded.content)
        self.assertEqual(
            {version["id"] for version in loaded.data},
            {"custom:hotel-a3", "baseline:hotel-a3"},
        )

    def test_default_template_changes_require_an_admin_grant(self):
        self.client.force_authenticate(user=self.other_user)

        response = self.client.put("/api/plans/sheet-templates/", self.payload, format="json")

        self.assertEqual(response.status_code, 403, response.content)
        self.assertFalse(SheetTemplateVersion.objects.filter(user=self.other_user).exists())

    def test_personal_template_does_not_require_an_admin_grant(self):
        self.client.force_authenticate(user=self.other_user)
        personal = {
            **self.payload["versions"][0],
            "id": "custom:personal-copy",
            "name": "Copie personnelle",
        }

        response = self.client.put(
            "/api/plans/sheet-templates/",
            {"versions": [personal]},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data[0]["id"], "custom:personal-copy")

    def test_permission_endpoint_reflects_the_django_admin_setting(self):
        granted = self.client.get("/api/plans/sheet-template-permissions/")
        self.assertEqual(granted.status_code, 200)
        self.assertTrue(granted.data["can_edit_default_templates"])

        self.client.force_authenticate(user=self.other_user)
        denied = self.client.get("/api/plans/sheet-template-permissions/")
        self.assertEqual(denied.status_code, 200)
        self.assertFalse(denied.data["can_edit_default_templates"])

    def test_revoked_user_only_reads_personal_templates(self):
        self.client.put("/api/plans/sheet-templates/", self.payload, format="json")
        permission = self.user.default_template_edit_permission
        permission.can_edit_default_templates = False
        permission.save()

        response = self.client.get("/api/plans/sheet-templates/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, [])

    def test_publish_default_template_requires_permission(self):
        self.client.force_authenticate(user=self.other_user)
        response = self.client.post(
            "/api/plans/publish-default/",
            {"template": "nfx08070", "blocks": []},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_publish_default_template_success(self):
        self.client.force_authenticate(user=self.user)
        import unittest.mock as mock
        with mock.patch("builtins.open", mock.mock_open(read_data='{"templates": {}}')):
            response = self.client.post(
                "/api/plans/publish-default/",
                {
                    "template": "nfx08070",
                    "blocks": [{"id": "test", "kind": "text", "text": "hello"}],
                    "planPlacement": {"x": 0, "y": 0},
                },
                format="json",
            )
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.data["success"])

    def test_pdf_template_page_asset_is_private_and_deletable(self):
        uploaded = self.client.post(
            "/api/plans/sheet-template-assets/",
            {
                "name": "Template client — page 1",
                "file": SimpleUploadedFile(
                    "template-page.png",
                    _png_bytes(size=(320, 240)),
                    content_type="image/png",
                ),
            },
            format="multipart",
        )

        self.assertEqual(uploaded.status_code, 201, uploaded.content)
        self.assertEqual(uploaded.data["width"], 320)
        self.assertEqual(uploaded.data["height"], 240)
        self.assertTrue(uploaded.data["url"])
        asset = SheetTemplateAsset.objects.get(user=self.user)

        self.client.force_authenticate(user=self.other_user)
        self.assertEqual(self.client.get("/api/plans/sheet-template-assets/").data, [])
        foreign_delete = self.client.delete(
            f"/api/plans/sheet-template-assets/?id={asset.asset_id}"
        )
        self.assertEqual(foreign_delete.status_code, 404)

        self.client.force_authenticate(user=self.user)
        with self.captureOnCommitCallbacks(execute=True):
            deleted = self.client.delete(
                f"/api/plans/sheet-template-assets/?id={asset.asset_id}"
            )
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(SheetTemplateAsset.objects.filter(pk=asset.pk).exists())
        self.assertFalse(asset.image_file.storage.exists(asset.image_file.name))

    def test_invited_user_reads_owner_template_assets(self):
        asset = SheetTemplateAsset.objects.create(
            user=self.user,
            name="Fond importé par test",
            image_file=SimpleUploadedFile("template-page.png", _png_bytes(size=(320, 240)), content_type="image/png"),
            width=320,
            height=240,
        )
        WorkspaceMembership.objects.create(
            owner=self.user,
            member=self.other_user,
            role=WorkspaceMembership.ROLE_VIEWER,
        )
        self.client.force_authenticate(user=self.other_user)

        response = self.client.get("/api/plans/sheet-template-assets/")
        delete_response = self.client.delete(
            f"/api/plans/sheet-template-assets/?id={asset.asset_id}"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["owner"], self.user.id)
        self.assertEqual(delete_response.status_code, 404)

    def test_workspace_owner_reads_invited_user_template_assets(self):
        WorkspaceMembership.objects.create(
            owner=self.user,
            member=self.other_user,
            role=WorkspaceMembership.ROLE_VIEWER,
        )
        asset = SheetTemplateAsset.objects.create(
            user=self.other_user,
            name="Fond importé par test7",
            image_file=SimpleUploadedFile("template-page.png", _png_bytes(size=(320, 240)), content_type="image/png"),
            width=320,
            height=240,
        )

        response = self.client.get("/api/plans/sheet-template-assets/")
        delete_response = self.client.delete(
            f"/api/plans/sheet-template-assets/?id={asset.asset_id}"
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn(str(asset.asset_id), [item["id"] for item in response.data])
        invited_asset = next(item for item in response.data if item["id"] == str(asset.asset_id))
        self.assertEqual(invited_asset["owner"], self.other_user.id)
        self.assertEqual(delete_response.status_code, 404)

    def test_pdf_template_asset_rejects_non_image_content(self):
        response = self.client.post(
            "/api/plans/sheet-template-assets/",
            {
                "name": "Faux template",
                "file": SimpleUploadedFile(
                    "template-page.jpg",
                    b"<html><script>alert(1)</script></html>",
                    content_type="image/jpeg",
                ),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(SheetTemplateAsset.objects.exists())


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


class GrokCleaningTests(_PlanFactoryMixin, TransactionTestCase):
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


class SharedWorkspaceAccessTests(_PlanFactoryMixin, TestCase):
    """Every account is isolated until the owner explicitly shares access."""

    def setUp(self):
        super().setUp()
        self.alice = User.objects.create_user(username="alice", password="pw-alice-77")
        self.bob = User.objects.create_user(username="bob", password="pw-bob-77")
        self.plan = self.make_plan(self.alice, name="commun")
        self.client = APIClient()

    def test_a_colleague_without_an_invitation_cannot_see_or_edit_a_plan(self):
        self.client.force_authenticate(user=self.bob)

        listing = self.client.get("/api/plans/")
        self.assertEqual(listing.status_code, 200)
        self.assertNotIn(self.plan.id, [item["id"] for item in listing.data])

        detail = self.client.get(f"/api/plans/{self.plan.id}/")
        self.assertEqual(detail.status_code, 404)

        icon = self.client.post("/api/icons/", {
            "plan": self.plan.id, "icon_type": "extincteur",
            "x": 10, "y": 10, "width": 30, "height": 30,
        }, format="json")
        self.assertIn(icon.status_code, (400, 403, 404), icon.data)

        sync = self.client.post(
            f"/api/plans/{self.plan.id}/sync-icons/",
            [{"icon_type": "issue", "x": 1, "y": 1, "width": 10, "height": 10}],
            format="json",
        )
        self.assertEqual(sync.status_code, 404)
        self.assertEqual(self.plan.icons.count(), 0)

    def test_an_anonymous_caller_reaches_nothing(self):
        for method, url in (
            ("get", "/api/plans/"),
            ("get", f"/api/plans/{self.plan.id}/"),
            ("get", "/api/icons/"),
            ("get", "/api/auth/me/"),
            ("get", "/api/plans/pictograms/"),
            ("get", "/api/workspace/collaborators/"),
        ):
            with self.subTest(url=url):
                response = getattr(self.client, method)(url)
                self.assertIn(response.status_code, (401, 403), url)

    def test_an_anonymous_caller_cannot_write(self):
        for url in (
            f"/api/plans/{self.plan.id}/sync-icons/",
            f"/api/plans/{self.plan.id}/change-background/",
            "/api/icons/",
        ):
            with self.subTest(url=url):
                response = self.client.post(url, {}, format="json")
                self.assertIn(response.status_code, (401, 403), url)
        self.assertIn(
            self.client.delete(f"/api/plans/{self.plan.id}/").status_code, (401, 403)
        )
        self.assertTrue(EvacuationPlan.objects.filter(pk=self.plan.pk).exists())

    def test_a_deactivated_account_loses_access(self):
        """A deactivated account cannot even reach its own workspace."""
        self.bob.is_active = False
        self.bob.save(update_fields=["is_active"])

        token = self.client.post(
            "/api/auth/token/", {"username": "bob", "password": "pw-bob-77"}, format="json"
        )
        self.assertNotEqual(token.status_code, 200)

        # And a token minted before the deactivation stops working too.
        from rest_framework_simplejwt.tokens import AccessToken

        stale = AccessToken.for_user(self.bob)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {stale}")
        self.assertIn(self.client.get("/api/plans/").status_code, (401, 403))


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
            [{
                "icon_type": "issue",
                "x": 1,
                "y": 1,
                "width": 10,
                "height": 10,
                "lock_aspect_ratio": False,
            }],
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.plan.icons.count(), 1)
        self.assertEqual(self.plan.icons.first().icon_type, "issue")
        self.assertFalse(self.plan.icons.first().lock_aspect_ratio)
        self.assertFalse(response.data[0]["lock_aspect_ratio"])

    def test_aspect_ratio_lock_is_enabled_by_default(self):
        response = self.client.post(
            f"/api/plans/{self.plan.id}/sync-icons/",
            [{"icon_type": "issue", "x": 1, "y": 1, "width": 10, "height": 10}],
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(self.plan.icons.get().lock_aspect_ratio)
        self.assertTrue(response.data[0]["lock_aspect_ratio"])

    def test_multiple_leader_points_are_saved_and_invalid_points_are_rejected(self):
        valid = self.client.post(
            f"/api/plans/{self.plan.id}/sync-icons/",
            [{
                "icon_type": "extincteur",
                "x": 50,
                "y": 60,
                "width": 30,
                "height": 30,
                "leader_points": [
                    {"id": "point-a", "x": 10, "y": 20},
                    {"id": "point-b", "x": 30, "y": 40},
                ],
            }],
            format="json",
        )
        self.assertEqual(valid.status_code, 200, valid.content)
        self.assertEqual(len(self.plan.icons.get().leader_points), 2)

        invalid = self.client.post(
            f"/api/plans/{self.plan.id}/sync-icons/",
            [{
                "icon_type": "extincteur",
                "x": 50,
                "y": 60,
                "width": 30,
                "height": 30,
                "leader_points": [{"id": "same", "x": 10, "y": 20}, {"id": "same", "x": 30, "y": 40}],
            }],
            format="json",
        )
        self.assertEqual(invalid.status_code, 400, invalid.content)
        self.assertEqual(len(self.plan.icons.get().leader_points), 2)


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

    def test_a_stranger_does_not_see_the_owners_plans(self):
        self.client.force_authenticate(user=self.stranger)
        response = self.client.get("/api/plans/")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(self.plan.id, [item["id"] for item in response.data])
        self.assertEqual(
            self.client.get(f"/api/plans/{self.plan.id}/").status_code,
            404,
        )

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

    def test_a_viewer_can_read_but_cannot_write(self):
        self._accept(self._invite(role="viewer"), self.guest)

        detail = self.client.get(f"/api/plans/{self.plan.id}/")
        self.assertEqual(detail.status_code, 200, detail.data)

        sync = self.client.post(
            f"/api/plans/{self.plan.id}/sync-icons/",
            [{"icon_type": "issue", "x": 1, "y": 1, "width": 10, "height": 10}],
            format="json",
        )
        self.assertEqual(sync.status_code, 403, sync.data)
        self.assertEqual(self.plan.icons.count(), 0)

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

    def test_revoking_removes_the_membership_row(self):
        self._accept(self._invite(role="editor"), self.guest)
        membership = WorkspaceMembership.objects.get()

        self.assertEqual(
            self.client.get(f"/api/plans/{self.plan.id}/").status_code,
            200,
        )

        self.client.force_authenticate(user=self.owner)
        self.assertEqual(
            self.client.post("/api/workspace/revoke/", {"membership_id": membership.id}, format="json").status_code,
            204,
        )
        self.assertFalse(WorkspaceMembership.objects.filter(pk=membership.pk).exists())

        self.client.force_authenticate(user=self.guest)
        self.assertEqual(
            self.client.get(f"/api/plans/{self.plan.id}/").status_code,
            404,
        )

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
            **_required_plan_creation_data(),
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

    def test_a_viewer_membership_created_by_admin_is_read_only(self):
        WorkspaceMembership.objects.create(
            owner=self.owner, member=self.colleague, role="viewer"
        )
        self.api.force_authenticate(user=self.colleague)
        self.assertEqual(
            self.api.get(f"/api/plans/{self.plan.id}/").status_code,
            200,
        )
        sync = self.api.post(
            f"/api/plans/{self.plan.id}/sync-icons/",
            [{"icon_type": "issue", "x": 1, "y": 1, "width": 10, "height": 10}],
            format="json",
        )
        self.assertEqual(sync.status_code, 403, sync.data)
        self.assertEqual(self.plan.icons.count(), 0)

    def test_deactivating_an_account_takes_all_access_back(self):
        """Disabling the account overrides every workspace membership."""
        self.colleague.is_active = False
        self.colleague.save(update_fields=["is_active"])

        from rest_framework_simplejwt.tokens import AccessToken

        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(self.colleague)}")
        self.assertIn(self.api.get("/api/plans/").status_code, (401, 403))

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


class SecurityAuditTests(_PlanFactoryMixin, TestCase):
    """The checks named in the security brief, each phrased as a claim that
    must stay true."""

    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(username="sec", password="pw-sec-4242")
        self.admin = User.objects.create_user(
            username="secadmin", password="pw-secadmin-42", is_staff=True, is_superuser=True
        )
        self.client = APIClient()

    # ── Inscription publique ────────────────────────────────────────────────
    def test_public_registration_is_closed_by_default(self):
        response = self.client.post("/api/auth/register/", {
            "username": "intrus", "email": "i@x.test", "password": "Sup3r-M0t-2-P4sse!",
        }, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(User.objects.filter(username="intrus").exists())

    @override_settings(PUBLIC_REGISTRATION_ENABLED=True)
    def test_a_weak_password_is_refused_even_when_registration_is_open(self):
        response = self.client.post("/api/auth/register/", {
            "username": "faible", "email": "f@x.test", "password": "1234",
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.data)
        self.assertFalse(User.objects.filter(username="faible").exists())

    # ── Élévation de privilèges ─────────────────────────────────────────────
    def test_a_normal_user_cannot_make_themselves_an_administrator(self):
        self.client.force_authenticate(user=self.user)
        for payload in ({"is_staff": True}, {"is_superuser": True}, {"password": "x"}):
            with self.subTest(payload=payload):
                for method in ("patch", "put", "post"):
                    response = getattr(self.client, method)("/api/auth/me/", payload, format="json")
                    self.assertIn(response.status_code, (401, 403, 405))
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_staff)
        self.assertFalse(self.user.is_superuser)

    def test_a_normal_user_cannot_reach_the_django_admin(self):
        client = Client()
        client.force_login(self.user)
        response = client.get("/admin/auth/user/")
        self.assertEqual(response.status_code, 302)
        self.assertIn("/admin/login/", response["Location"])

    def test_an_administrator_can_reach_user_management(self):
        client = Client()
        client.force_login(self.admin)
        self.assertEqual(client.get("/admin/auth/user/").status_code, 200)

    # ── Secrets ─────────────────────────────────────────────────────────────
    def test_the_stored_api_key_is_never_returned(self):
        self.client.force_authenticate(user=self.user)
        secret = "xai-" + "k" * 40
        saved = self.client.post("/api/xai-settings/save/", {"api_key": secret}, format="json")
        self.assertEqual(saved.status_code, 200, saved.data)

        read = self.client.get("/api/xai-settings/")
        self.assertEqual(read.status_code, 200)
        self.assertNotIn(secret, str(read.data))
        self.assertTrue(read.data.get("has_api_key"))

        # Not in the plan payloads either.
        self.assertNotIn(secret, str(self.client.get("/api/plans/").data))

    def test_the_api_key_is_not_stored_in_clear_text(self):
        from .models import UserXaiSettings

        secret = "xai-" + "z" * 40
        settings_row = UserXaiSettings.objects.create(user=self.user)
        settings_row.set_api_key(secret)
        settings_row.save()
        settings_row.refresh_from_db()
        self.assertNotIn(secret, settings_row.encrypted_api_key)
        self.assertEqual(settings_row.get_api_key(), secret)

    # ── SVG ─────────────────────────────────────────────────────────────────
    def _upload_svg(self, markup):
        self.client.force_authenticate(user=self.user)
        return self.client.post(
            "/api/plans/pictograms/", {"name": "essai", "svg": markup}, format="json"
        )

    def test_a_svg_carrying_a_script_is_refused(self):
        response = self._upload_svg(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
            '<script>alert(1)</script></svg>'
        )
        self.assertEqual(response.status_code, 400)

    def test_a_svg_carrying_an_event_handler_is_refused(self):
        response = self._upload_svg(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"/>'
        )
        self.assertEqual(response.status_code, 400)

    def test_a_svg_carrying_a_javascript_url_is_refused(self):
        response = self._upload_svg(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
            '<a href="javascript:alert(1)"><rect/></a></svg>'
        )
        self.assertEqual(response.status_code, 400)

    def test_a_svg_declaring_an_external_entity_is_refused(self):
        response = self._upload_svg(
            '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>'
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>&x;</text></svg>'
        )
        self.assertEqual(response.status_code, 400)

    def test_an_unknown_element_is_stripped_rather_than_stored(self):
        from .views import validate_and_sanitize_pictogram_svg

        sanitized, error = validate_and_sanitize_pictogram_svg(
            b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
            b'<blink/><rect width="1" height="1"/></svg>'
        )
        self.assertIsNone(error)
        self.assertNotIn(b'blink', sanitized)
        self.assertIn(b'rect', sanitized)

    def test_an_unknown_wrapper_does_not_erase_its_svg_drawing(self):
        from .views import validate_and_sanitize_pictogram_svg

        sanitized, error = validate_and_sanitize_pictogram_svg(
            b'<svg xmlns="http://www.w3.org/2000/svg" xmlns:cad="urn:cad" viewBox="0 0 10 10">'
            b'<cad:layer transform="translate(1 1)"><g><path d="M0 0h8v8z"/></g></cad:layer>'
            b'</svg>'
        )
        self.assertIsNone(error)
        self.assertNotIn(b'layer', sanitized)
        self.assertIn(b'<path', sanitized)
        self.assertIn(b'transform="translate(1 1)"', sanitized)

    # ── Uploads ─────────────────────────────────────────────────────────────
    def _create_plan_with(self, name, content, content_type):
        self.client.force_authenticate(user=self.user)
        return self.client.post("/api/plans/", {
            **_required_plan_creation_data(),
            "title": "t",
            "background_type": "image",
            "background_file": SimpleUploadedFile(name, content, content_type=content_type),
        }, format="multipart")

    def test_an_html_page_disguised_as_a_png_is_refused(self):
        response = self._create_plan_with(
            "x.png", b"<html><script>alert(1)</script></html>", "image/png"
        )
        self.assertEqual(response.status_code, 400)

    def test_an_executable_extension_is_refused(self):
        for name in ("shell.py", "page.html", "app.js", "run.sh", "x.phtml"):
            with self.subTest(name=name):
                self.assertEqual(self._create_plan_with(name, b"whatever", "text/plain").status_code, 400)

    def test_a_file_over_the_size_limit_is_refused(self):
        from .upload_validation import MAX_BACKGROUND_UPLOAD_BYTES

        oversized = _png_bytes() + b"0" * MAX_BACKGROUND_UPLOAD_BYTES
        self.assertEqual(self._create_plan_with("big.png", oversized, "image/png").status_code, 400)

    def test_a_legitimate_image_is_still_accepted(self):
        response = self._create_plan_with("ok.png", _png_bytes(), "image/png")
        self.assertEqual(response.status_code, 201, response.data)

    def test_a_traversing_filename_cannot_escape_the_upload_directory(self):
        response = self._create_plan_with("../../../../evil.png", _png_bytes(), "image/png")
        self.assertEqual(response.status_code, 201, response.data)
        stored = EvacuationPlan.objects.get(pk=response.data["id"]).background_file.name
        self.assertTrue(stored.startswith("backgrounds/"), stored)
        self.assertNotIn("..", stored)

    # ── SSRF ────────────────────────────────────────────────────────────────
    def test_the_generated_image_url_cannot_point_inside_the_server(self):
        from .grok_cleaning import GrokCleaningError, _assert_downloadable_url

        for url in (
            "file:///etc/passwd",
            "http://127.0.0.1:8000/admin/",
            "https://localhost/x",
            "https://169.254.169.254/latest/meta-data/",
            "https://10.0.0.5/x",
        ):
            with self.subTest(url=url):
                with self.assertRaises(GrokCleaningError):
                    _assert_downloadable_url(url)

        _assert_downloadable_url("https://api.x.ai/images/tmp/abc.png")

    # ── Rate limiting ───────────────────────────────────────────────────────
    def test_password_guessing_is_rate_limited(self):
        from django.core.cache import cache

        cache.clear()
        try:
            statuses = [
                self.client.post(
                    "/api/auth/token/",
                    {"username": "sec", "password": f"faux-{attempt}"},
                    format="json",
                ).status_code
                for attempt in range(15)
            ]
        finally:
            cache.clear()
        self.assertIn(429, statuses, "aucune limitation sur la devinette de mot de passe")


class ProtectedMediaTests(_PlanFactoryMixin, TestCase):
    """Une URL seule ne suffit jamais : compte + propriété/invitation requis."""

    NF_X_CATALOG_DIRECTORY = "nf-x08-070-picto/symboles/svg/01-evacuation"
    ENCODED_PICTOGRAM_NAMES = [
        "Extincteur.svg",
        "Bouche d’incendie.svg",
        "Itinéraire d’évacuation.svg",
        "Poteau d'incendie.svg",
        "Equipement divers de lutte contre l’incendie (à préciser).svg",
        "Extincteur  sur roues.svg",
        "Espace d’attente sécurisé.svg",
        "Accès pompiers principal.svg",
    ]

    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(username="media", password="pw-media-99")
        self.other = User.objects.create_user(username="media-other", password="pw-media-other-99")
        self.plan = self.make_plan(self.user, name="prive")
        self.client = APIClient()
        from django.core.cache import cache

        cache.clear()

    def tearDown(self):
        from django.core.cache import cache

        cache.clear()
        super().tearDown()

    def _protected_url_from_api(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(f"/api/plans/{self.plan.id}/")
        self.assertEqual(response.status_code, 200)
        self.client.force_authenticate(user=None)
        return response.data["background_file"]

    def _use_media_cookie(self, user, client=None):
        from django.conf import settings as django_settings
        from .media_access import media_session_value

        target = client or self.client
        target.cookies[django_settings.MEDIA_SESSION_COOKIE_NAME] = media_session_value(user)
        return target

    def _store_media_bytes(self, relative_path, content):
        full_path = os.path.join(self._test_media.name, relative_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "wb") as handle:
            handle.write(content)
        return ContentFile(content, name=os.path.basename(relative_path))

    def test_the_api_hands_out_a_protected_url_without_a_bearer_signature(self):
        url = self._protected_url_from_api()
        self.assertIn("/api/media/", url)
        self.assertNotIn("sig=", url)
        self.assertNotIn("exp=", url)

    def test_plan_api_refreshes_media_cookie_for_existing_jwt_sessions(self):
        from django.conf import settings as django_settings

        self.client.force_authenticate(user=self.user)
        response = self.client.get(f"/api/plans/{self.plan.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertIn(django_settings.MEDIA_SESSION_COOKIE_NAME, response.cookies)

    def test_plan_api_reports_whether_workspace_member_can_edit(self):
        viewer = self.other
        editor = User.objects.create_user(username="media-editor", password="pw-media-editor-99")
        WorkspaceMembership.objects.create(
            owner=self.user,
            member=viewer,
            role=WorkspaceMembership.ROLE_VIEWER,
        )
        WorkspaceMembership.objects.create(
            owner=self.user,
            member=editor,
            role=WorkspaceMembership.ROLE_EDITOR,
        )

        self.client.force_authenticate(user=self.user)
        owner_response = self.client.get(f"/api/plans/{self.plan.id}/")
        self.client.force_authenticate(user=viewer)
        viewer_response = self.client.get(f"/api/plans/{self.plan.id}/")
        self.client.force_authenticate(user=editor)
        editor_response = self.client.get(f"/api/plans/{self.plan.id}/")

        self.assertTrue(owner_response.data["can_edit"])
        self.assertFalse(viewer_response.data["can_edit"])
        self.assertTrue(editor_response.data["can_edit"])

    def test_existing_plan_backgrounds_cleaned_backgrounds_and_pdfs_are_served(self):
        media_cases = [
            ("backgrounds/ancien plan étage.png", _png_bytes(), "image/png", "image"),
            ("backgrounds/ancien plan photo.jpg", _png_bytes(), "image/jpeg", "image"),
            ("backgrounds/ancien plan pdf.pdf", b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF", "application/pdf", "pdf"),
        ]

        for relative_path, content, expected_type, background_type in media_cases:
            with self.subTest(relative_path=relative_path):
                self._store_media_bytes(relative_path, content)
                self.plan.background_file.name = relative_path
                self.plan.background_type = background_type
                self.plan.save(update_fields=["background_file", "background_type"])
                self.client.force_authenticate(user=self.user)
                api_response = self.client.get(f"/api/plans/{self.plan.id}/")
                self.assertEqual(api_response.status_code, 200)
                url = api_response.data["background_file"]
                self.assertIn("/api/media/", url)
                self.assertNotIn("%2520", url)
                self.assertNotIn("%25C3", url)
                self.client.force_authenticate(user=None)
                self._use_media_cookie(self.user)
                media_response = self.client.get(url)
                self.assertEqual(media_response.status_code, 200)
                self.assertEqual(media_response["Content-Type"], expected_type)

        cleaned_path = "backgrounds_cleaned/ancien nettoyé étage.png"
        self._store_media_bytes(cleaned_path, _png_bytes(color=(240, 240, 240)))
        self.plan.cleaned_background_file.name = cleaned_path
        self.plan.use_cleaned_background = True
        self.plan.save(update_fields=["cleaned_background_file", "use_cleaned_background"])
        self.client.force_authenticate(user=self.user)
        api_response = self.client.get(f"/api/plans/{self.plan.id}/")
        self.assertEqual(api_response.status_code, 200)
        cleaned_url = api_response.data["cleaned_background_file"]
        self.assertIn("/api/media/backgrounds_cleaned/", cleaned_url)
        self.assertNotIn("%2520", cleaned_url)
        self.client.force_authenticate(user=None)
        self._use_media_cookie(self.user)
        cleaned_response = self.client.get(cleaned_url)
        self.assertEqual(cleaned_response.status_code, 200)
        self.assertEqual(cleaned_response["Content-Type"], "image/png")

    def test_legacy_media_prefixed_database_paths_still_authorize_existing_plans(self):
        from .media_access import normalize_media_path, protected_media_path

        real_path = "backgrounds/ancien legacy espace.png"
        self._store_media_bytes(real_path, _png_bytes())
        self.plan.background_file.name = f"/media/{real_path}"
        self.plan.save(update_fields=["background_file"])

        self.assertEqual(normalize_media_path(f"/media/{real_path}"), real_path)
        self.assertEqual(normalize_media_path(f"/api/media/{real_path}"), real_path)
        self.assertEqual(
            protected_media_path(f"https://example.com/media/{real_path}"),
            "/api/media/backgrounds/ancien%20legacy%20espace.png",
        )

        self.client.force_authenticate(user=self.user)
        api_response = self.client.get(f"/api/plans/{self.plan.id}/")
        self.assertEqual(api_response.status_code, 200)
        self.assertEqual(
            api_response.data["background_file"],
            "http://testserver/api/media/backgrounds/ancien%20legacy%20espace.png",
        )

        self.client.force_authenticate(user=None)
        self._use_media_cookie(self.user)
        response = self.client.get("/api/media/backgrounds/ancien%20legacy%20espace.png")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/png")

    @override_settings(MEDIA_USE_X_ACCEL_REDIRECT=True, MEDIA_X_ACCEL_LOCATION='/protected-media/')
    def test_x_accel_redirect_is_once_encoded_for_existing_plan_backgrounds(self):
        real_path = "backgrounds/ancien plan étage espace.png"
        self._store_media_bytes(real_path, _png_bytes())
        self.plan.background_file.name = real_path
        self.plan.save(update_fields=["background_file"])
        self._use_media_cookie(self.user)

        response = self.client.get("/api/media/backgrounds/ancien%2520plan%2520%C3%A9tage%2520espace.png")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["X-Accel-Redirect"],
            "/protected-media/backgrounds/ancien%20plan%20%C3%A9tage%20espace.png",
        )
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertNotIn("%2520", response["X-Accel-Redirect"])
        self.assertNotIn("%25C3", response["X-Accel-Redirect"])

    def test_protected_media_does_not_use_the_generic_anonymous_quota(self):
        from .media_views import ProtectedMediaView
        from .throttles import ProtectedMediaRateThrottle

        throttles = ProtectedMediaView().get_throttles()
        self.assertEqual(len(throttles), 1)
        self.assertIsInstance(throttles[0], ProtectedMediaRateThrottle)
        self.assertEqual(throttles[0].scope, "media")

    def test_an_anonymous_caller_cannot_read_a_media_file(self):
        response = self.client.get(f"/api/media/{self.plan.background_file.name}")
        self.assertEqual(response.status_code, 403)

    def test_the_owners_media_cookie_works_for_an_image_request(self):
        """A balise image envoie le cookie HttpOnly, pas le JWT localStorage."""
        url = self._protected_url_from_api()
        self._use_media_cookie(self.user)
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")

    def test_the_owner_may_also_read_with_a_jwt_header(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(f"/api/media/{self.plan.background_file.name}")
        self.assertEqual(response.status_code, 200)

    def test_an_authenticated_stranger_cannot_read_the_file(self):
        self.client.force_authenticate(user=self.other)
        response = self.client.get(f"/api/media/{self.plan.background_file.name}")
        self.assertEqual(response.status_code, 403)

    def test_an_invited_viewer_can_read_and_revocation_removes_access(self):
        membership = WorkspaceMembership.objects.create(
            owner=self.user,
            member=self.other,
            role=WorkspaceMembership.ROLE_VIEWER,
        )
        self._use_media_cookie(self.other)
        url = f"/api/media/{self.plan.background_file.name}"
        self.assertEqual(self.client.get(url).status_code, 200)

        membership.delete()
        self.assertEqual(self.client.get(url).status_code, 403)

    def test_every_private_media_model_obeys_the_same_workspace_boundary(self):
        self.plan.cleaned_background_file.save(
            "cleaned.png",
            ContentFile(_png_bytes(color=(240, 240, 240))),
            save=True,
        )
        overlay = self.make_overlay(self.plan)
        overlay.original_image_file.save(
            "overlay-original.png",
            ContentFile(_png_bytes(color=(230, 230, 230))),
            save=True,
        )
        history = PlanCleaningHistory(
            plan=self.plan,
            user=self.user,
            cleaning_method=PlanCleaningHistory.METHOD_LOCAL,
            title="Historique privé",
        )
        history.image_file.save(
            "history.png",
            ContentFile(_png_bytes(color=(220, 220, 220))),
            save=True,
        )
        asset = SheetTemplateAsset(
            user=self.user,
            name="Template privé",
            width=24,
            height=24,
        )
        asset.image_file.save(
            "template.png",
            ContentFile(_png_bytes(color=(210, 210, 210))),
            save=True,
        )
        paths = (
            self.plan.background_file.name,
            self.plan.cleaned_background_file.name,
            overlay.image_file.name,
            overlay.original_image_file.name,
            history.image_file.name,
            asset.image_file.name,
        )

        self._use_media_cookie(self.other)
        for path in paths:
            with self.subTest(path=path, access="stranger"):
                self.assertEqual(self.client.get(f"/api/media/{path}").status_code, 403)

        WorkspaceMembership.objects.create(
            owner=self.user,
            member=self.other,
            role=WorkspaceMembership.ROLE_VIEWER,
        )
        for path in paths:
            with self.subTest(path=path, access="invited"):
                self.assertEqual(self.client.get(f"/api/media/{path}").status_code, 200)

    def test_copying_the_url_and_its_old_signature_to_another_browser_is_refused(self):
        url = self._protected_url_from_api()
        copied = APIClient()
        response = copied.get(f"{url}?exp=9999999999&sig={'a' * 64}")
        self.assertEqual(response.status_code, 403)

    def test_a_browser_logged_in_as_a_stranger_cannot_use_a_copied_url(self):
        url = self._protected_url_from_api()
        stranger_browser = self._use_media_cookie(self.other, APIClient())
        self.assertEqual(stranger_browser.get(url).status_code, 403)

    def test_login_sets_the_httponly_media_cookie(self):
        from django.conf import settings as django_settings

        response = self.client.post(
            "/api/auth/token/",
            {"username": "media", "password": "pw-media-99"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        cookie = response.cookies[django_settings.MEDIA_SESSION_COOKIE_NAME]
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["samesite"], "Lax")
        self.assertEqual(
            self.client.get(f"/api/media/{self.plan.background_file.name}").status_code,
            200,
        )

    def test_logout_deletes_the_media_cookie_and_closes_the_file(self):
        from django.conf import settings as django_settings

        login = self.client.post(
            "/api/auth/token/",
            {"username": "media", "password": "pw-media-99"},
            format="json",
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        logout = self.client.post(
            "/api/auth/logout/",
            {"refresh": login.data["refresh"]},
            format="json",
        )
        self.assertEqual(logout.status_code, 205)
        self.assertEqual(
            logout.cookies[django_settings.MEDIA_SESSION_COOKIE_NAME]["max-age"],
            0,
        )
        self.client.credentials()
        self.assertEqual(
            self.client.get(f"/api/media/{self.plan.background_file.name}").status_code,
            403,
        )

    def test_a_tampered_media_cookie_is_refused(self):
        from django.conf import settings as django_settings

        self._use_media_cookie(self.user)
        value = self.client.cookies[django_settings.MEDIA_SESSION_COOKIE_NAME].value
        self.client.cookies[django_settings.MEDIA_SESSION_COOKIE_NAME] = value[:-1] + (
            "0" if value[-1] != "0" else "1"
        )
        self.assertEqual(
            self.client.get(f"/api/media/{self.plan.background_file.name}").status_code,
            403,
        )

    @override_settings(MEDIA_SESSION_COOKIE_AGE_SECONDS=-1)
    def test_an_expired_media_cookie_is_refused(self):
        self._use_media_cookie(self.user)
        self.assertEqual(
            self.client.get(f"/api/media/{self.plan.background_file.name}").status_code,
            403,
        )

    def test_a_password_change_invalidates_the_media_cookie(self):
        self._use_media_cookie(self.user)
        self.user.set_password("pw-media-changed-99")
        self.user.save(update_fields=["password"])
        self.assertEqual(
            self.client.get(f"/api/media/{self.plan.background_file.name}").status_code,
            403,
        )

    def test_the_shared_pictogram_library_still_requires_a_logged_in_browser(self):
        name = default_storage.save(
            f"{self.NF_X_CATALOG_DIRECTORY}/shared.svg",
            ContentFile(b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9"/>'),
        )
        try:
            url = f"/api/media/{name}"
            self.assertEqual(APIClient().get(url).status_code, 403)
            self._use_media_cookie(self.other)
            self.assertEqual(self.client.get(url).status_code, 200)
        finally:
            default_storage.delete(name)

    def test_protected_media_url_is_encoded_once_for_real_pictogram_names(self):
        from .media_access import build_protected_media_url, normalize_media_path, protected_media_path

        real_names = [
            *self.ENCODED_PICTOGRAM_NAMES,
            "vous etes ici.svg",
            "Sortie 🚪 spéciale.svg",
        ]

        for filename in real_names:
            filesystem_path = f"{self.NF_X_CATALOG_DIRECTORY}/{filename}"
            expected_url = f"/api/media/{quote(filesystem_path, safe='/')}"
            once_encoded_path = expected_url.removeprefix("/api/media/")
            twice_encoded_path = quote(once_encoded_path, safe="/")
            with self.subTest(path=filesystem_path):
                self.assertEqual(normalize_media_path(filesystem_path), filesystem_path)
                self.assertEqual(normalize_media_path(once_encoded_path), filesystem_path)
                self.assertEqual(normalize_media_path(twice_encoded_path), filesystem_path)
                self.assertEqual(protected_media_path(filesystem_path), expected_url)
                self.assertEqual(protected_media_path(once_encoded_path), expected_url)
                self.assertEqual(protected_media_path(twice_encoded_path), expected_url)
                self.assertNotIn("%2520", expected_url)
                self.assertNotIn("%25C3", expected_url)
                self.assertNotIn("%25E2", expected_url)
                self.assertNotIn("%25F0", expected_url)

        request = self.client.get("/api/plans/").wsgi_request
        encoded_path = f"{self.NF_X_CATALOG_DIRECTORY}/vous%20etes%20ici.svg"
        absolute = build_protected_media_url(request, encoded_path)
        self.assertTrue(absolute.endswith(
            f"/api/media/{self.NF_X_CATALOG_DIRECTORY}/vous%20etes%20ici.svg"
        ))
        self.assertNotIn("%2520", absolute)

    def test_pictogram_api_returns_once_encoded_urls_for_real_library_names(self):
        svg = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9"/>'
        saved = [
            default_storage.save(f"{self.NF_X_CATALOG_DIRECTORY}/{filename}", ContentFile(svg))
            for filename in self.ENCODED_PICTOGRAM_NAMES
        ]
        self.client.force_authenticate(user=self.user)

        try:
            response = self.client.get("/api/plans/pictograms/")
            self.assertEqual(response.status_code, 200)
            urls_by_file = {item["file_name"]: item["url"] for item in response.data}

            for filename in self.ENCODED_PICTOGRAM_NAMES:
                with self.subTest(filename=filename):
                    filesystem_path = f"{self.NF_X_CATALOG_DIRECTORY}/{filename}"
                    url = urls_by_file[filesystem_path]
                    self.assertIn(f"/api/media/{quote(filesystem_path, safe='/')}", url)
                    self.assertNotIn("%2520", url)
                    self.assertNotIn("%25C3", url)
                    self.assertNotIn("%25E2", url)
        finally:
            for name in saved:
                default_storage.delete(name)

    def test_protected_media_route_accepts_once_and_twice_encoded_real_svg_names(self):
        svg = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9"/>'
        names = [
            f"{self.NF_X_CATALOG_DIRECTORY}/{filename}"
            for filename in self.ENCODED_PICTOGRAM_NAMES
        ]
        saved = [default_storage.save(name, ContentFile(svg)) for name in names]
        self._use_media_cookie(self.user)

        try:
            for filesystem_path in names:
                once_encoded_path = quote(filesystem_path, safe="/")
                twice_encoded_path = quote(once_encoded_path, safe="/")
                for attempt in (once_encoded_path, twice_encoded_path):
                    with self.subTest(attempt=attempt):
                        response = self.client.get(f"/api/media/{attempt}")
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(response["Content-Type"], "image/svg+xml")
                        self.assertNotIn("application/json", response["Content-Type"])
                        self.assertNotIn("text/html", response["Content-Type"])
                        body = (
                            b"".join(response.streaming_content)
                            if response.streaming
                            else response.content
                        )
                        self.assertIn(b"<svg", body)
        finally:
            for name in saved:
                default_storage.delete(name)

    @override_settings(MEDIA_USE_X_ACCEL_REDIRECT=True, MEDIA_X_ACCEL_LOCATION='/protected-media/')
    def test_x_accel_redirect_is_once_encoded_for_real_svg_names(self):
        svg = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9"/>'
        personal_directory = (
            f"user_pictograms/{self.user.id}/nfx08070/01-evacuation"
        )
        names = [
            f"{personal_directory}/{filename}"
            for filename in self.ENCODED_PICTOGRAM_NAMES
        ]
        saved = [default_storage.save(name, ContentFile(svg)) for name in names]
        self._use_media_cookie(self.user)

        try:
            for filesystem_path in names:
                once_encoded_path = quote(filesystem_path, safe="/")
                twice_encoded_path = quote(once_encoded_path, safe="/")
                with self.subTest(path=filesystem_path):
                    response = self.client.get(f"/api/media/{twice_encoded_path}")
                    self.assertEqual(response.status_code, 200)
                    redirect = response["X-Accel-Redirect"]
                    self.assertEqual(redirect, f"/protected-media/{once_encoded_path}")
                    self.assertNotIn("%2520", redirect)
                    self.assertNotIn("%25C3", redirect)
                    self.assertNotIn("%25E2", redirect)
                    self.assertNotIn("%25F0", redirect)
                    self.assertEqual(response["Content-Type"], "image/svg+xml")
        finally:
            for name in saved:
                default_storage.delete(name)

    def test_path_traversal_is_refused(self):
        self.client.force_authenticate(user=self.user)
        for attempt in (
            "../../../../etc/passwd",
            "backgrounds/../../../etc/passwd",
            "..%2f..%2f..%2fetc%2fpasswd",
            "/etc/passwd",
        ):
            with self.subTest(attempt=attempt):
                response = self.client.get(f"/api/media/{attempt}")
                self.assertIn(response.status_code, (403, 404), attempt)

    def test_a_missing_file_is_a_plain_404(self):
        self._use_media_cookie(self.user)
        default_storage.delete(self.plan.background_file.name)
        response = self.client.get(f"/api/media/{self.plan.background_file.name}")
        self.assertEqual(response.status_code, 404)

    def test_no_server_path_is_ever_disclosed(self):
        """Ni l'arborescence du serveur ni MEDIA_ROOT ne doivent transparaître."""
        from django.conf import settings as django_settings

        root = str(django_settings.MEDIA_ROOT)
        self.client.force_authenticate(user=self.user)
        for url in (
            "/api/media/backgrounds/inexistant-xyz.png",
            "/api/media/../../../../etc/passwd",
        ):
            with self.subTest(url=url):
                body = self.client.get(url).content.decode("utf-8", "replace")
                self.assertNotIn(root, body)
                self.assertNotIn("/Users/", body)
                self.assertNotIn("Traceback", body)

    def test_the_sqlite_database_cannot_be_reached_through_the_media_route(self):
        self.client.force_authenticate(user=self.user)
        for attempt in ("../db.sqlite3", "../../db.sqlite3", "../.env"):
            with self.subTest(attempt=attempt):
                self.assertIn(self.client.get(f"/api/media/{attempt}").status_code, (403, 404))

    def test_a_svg_is_served_as_an_attachment_not_inline(self):
        """SVG files remain protected, but are served with their real image type."""
        self.plan.background_file.save(
            "essai-media.svg",
            ContentFile(b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9"/>'),
            save=True,
        )
        self._use_media_cookie(self.user)
        response = self.client.get(f"/api/media/{self.plan.background_file.name}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/svg+xml")
        self.assertNotIn("attachment", response.get("Content-Disposition", ""))

    @override_settings(MEDIA_USE_X_ACCEL_REDIRECT=True, MEDIA_X_ACCEL_LOCATION='/protected-media/')
    def test_production_delegates_the_transfer_to_nginx(self):
        self._use_media_cookie(self.user)
        response = self.client.get(f"/api/media/{self.plan.background_file.name}")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response["X-Accel-Redirect"].startswith("/protected-media/"))
        # Le contenu n'est pas lu par Django : c'est Nginx qui l'envoie.
        self.assertEqual(response.content, b"")


class JwtSessionTests(_PlanFactoryMixin, TestCase):
    """Le cycle de vie des jetons : rotation, révocation, désactivation."""

    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(username="jwt", password="pw-jwt-887766")
        self.other = User.objects.create_user(username="jwtother", password="pw-jwt-998877")
        self.client = APIClient()
        from django.core.cache import cache

        cache.clear()  # les vues d'auth sont limitées en débit

    def tearDown(self):
        from django.core.cache import cache

        cache.clear()
        super().tearDown()

    def _login(self, username="jwt", password="pw-jwt-887766"):
        response = self.client.post(
            "/api/auth/token/", {"username": username, "password": password}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["access"], response.data["refresh"]

    def _as(self, access):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")

    def test_a_valid_token_works(self):
        access, _ = self._login()
        self._as(access)
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 200)

    def test_the_access_token_is_short_lived(self):
        from django.conf import settings as django_settings

        lifetime = django_settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"]
        self.assertLessEqual(lifetime.total_seconds(), 3600)

    def test_logout_makes_the_refresh_token_unusable(self):
        access, refresh = self._login()
        self._as(access)

        logout = self.client.post("/api/auth/logout/", {"refresh": refresh}, format="json")
        self.assertEqual(logout.status_code, 205)

        self.client.credentials()
        replay = self.client.post("/api/auth/token/refresh/", {"refresh": refresh}, format="json")
        self.assertEqual(replay.status_code, 401)

    def test_logout_requires_the_refresh_token(self):
        access, _ = self._login()
        self._as(access)
        self.assertEqual(self.client.post("/api/auth/logout/", {}, format="json").status_code, 400)

    def test_a_rotated_refresh_token_cannot_be_replayed(self):
        access, refresh = self._login()

        rotated = self.client.post("/api/auth/token/refresh/", {"refresh": refresh}, format="json")
        self.assertEqual(rotated.status_code, 200, rotated.data)
        self.assertIn("refresh", rotated.data, "la rotation doit émettre un nouveau jeton")
        self.assertNotEqual(rotated.data["refresh"], refresh)

        replay = self.client.post("/api/auth/token/refresh/", {"refresh": refresh}, format="json")
        self.assertEqual(replay.status_code, 401, "l'ancien jeton doit être révoqué")

        # Le nouveau, lui, fonctionne toujours.
        self.assertEqual(
            self.client.post(
                "/api/auth/token/refresh/", {"refresh": rotated.data["refresh"]}, format="json"
            ).status_code,
            200,
        )

    def test_a_user_cannot_revoke_someone_elses_session(self):
        _, victim_refresh = self._login("jwtother", "pw-jwt-998877")
        attacker_access, _ = self._login()

        self._as(attacker_access)
        response = self.client.post(
            "/api/auth/logout/", {"refresh": victim_refresh}, format="json"
        )
        self.assertEqual(response.status_code, 403)

        # La session de la victime reste utilisable.
        self.client.credentials()
        self.assertEqual(
            self.client.post(
                "/api/auth/token/refresh/", {"refresh": victim_refresh}, format="json"
            ).status_code,
            200,
        )

    def test_a_deactivated_account_is_refused_immediately(self):
        access, refresh = self._login()
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])

        self._as(access)
        self.assertIn(self.client.get("/api/auth/me/").status_code, (401, 403))

        self.client.credentials()
        self.assertEqual(
            self.client.post("/api/auth/token/refresh/", {"refresh": refresh}, format="json").status_code,
            401,
        )

    def test_a_deleted_accounts_stale_refresh_token_is_refused(self):
        _, refresh = self._login()
        self.user.delete()

        response = self.client.post(
            "/api/auth/token/refresh/", {"refresh": refresh}, format="json"
        )
        self.assertEqual(response.status_code, 401)

    def test_logging_out_twice_is_not_an_error(self):
        access, refresh = self._login()
        self._as(access)
        self.assertEqual(
            self.client.post("/api/auth/logout/", {"refresh": refresh}, format="json").status_code, 205
        )
        self.assertEqual(
            self.client.post("/api/auth/logout/", {"refresh": refresh}, format="json").status_code, 205
        )


class AdminBruteForceTests(TestCase):
    """La page de connexion de l'admin est une vue Django : elle échappe aux
    throttles de DRF et doit être protégée séparément."""

    def setUp(self):
        from django.core.cache import cache

        cache.clear()
        self.client = Client()
        User.objects.create_user(username="admin-cible", password="pw-cible-1234", is_staff=True)

    def tearDown(self):
        from django.core.cache import cache

        cache.clear()

    def test_repeated_admin_login_attempts_get_blocked(self):
        statuses = [
            self.client.post(
                "/admin/login/", {"username": "admin-cible", "password": f"faux-{attempt}"}
            ).status_code
            for attempt in range(14)
        ]
        self.assertIn(429, statuses, "aucune limitation sur /admin/login/")

    def test_a_successful_login_clears_the_counter(self):
        for attempt in range(3):
            self.client.post("/admin/login/", {"username": "admin-cible", "password": "faux"})

        ok = self.client.post(
            "/admin/login/", {"username": "admin-cible", "password": "pw-cible-1234"}
        )
        self.assertIn(ok.status_code, (301, 302))

        # Le compteur est remis à zéro : la limite ne se déclenche pas aussitôt.
        self.assertNotEqual(
            self.client.post(
                "/admin/login/", {"username": "admin-cible", "password": "faux"}
            ).status_code,
            429,
        )


class AuditLogTests(_PlanFactoryMixin, TestCase):
    """Les actions sensibles laissent une trace, et aucun secret n'y figure."""

    SENSITIVE = ("password", "pw-", "Bearer", "Authorization", "secret", "xai-")

    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(username="tracee", password="pw-tracee-3344")
        self.client = APIClient()

    def _assert_no_secret(self, lines):
        joined = " ".join(lines)
        for marker in self.SENSITIVE:
            self.assertNotIn(marker, joined, f"'{marker}' ne doit jamais être journalisé")

    def test_account_creation_and_role_changes_are_traced(self):
        with self.assertLogs("evacstudio.audit", level="INFO") as captured:
            created = User.objects.create_user(username="nouveau", password="pw-nouveau-55")
            created.is_staff = True
            created.save()
            created.is_active = False
            created.save()

        joined = " ".join(captured.output)
        self.assertIn("user.created", joined)
        self.assertIn("user.role_changed", joined)
        self.assertIn("user.deactivated", joined)
        self._assert_no_secret(captured.output)

    def test_plan_deletion_is_traced(self):
        plan = self.make_plan(self.user, name="a-supprimer")
        with self.assertLogs("evacstudio.audit", level="INFO") as captured:
            plan.delete()
        self.assertIn("plan.deleted", " ".join(captured.output))

    def test_api_key_changes_are_traced_without_the_key(self):
        from .models import UserXaiSettings

        secret = "xai-" + "s" * 40
        with self.assertLogs("evacstudio.audit", level="INFO") as captured:
            row = UserXaiSettings.objects.create(user=self.user)
            row.set_api_key(secret)
            row.save()

        joined = " ".join(captured.output)
        self.assertIn("settings.api_key_", joined)
        self.assertNotIn(secret, joined)

    def test_a_failed_api_login_is_traced_without_the_password(self):
        from django.core.cache import cache

        cache.clear()
        try:
            with self.assertLogs("evacstudio.audit", level="INFO") as captured:
                self.client.post(
                    "/api/auth/token/",
                    {"username": "tracee", "password": "mauvais-mot-de-passe"},
                    format="json",
                )
        finally:
            cache.clear()

        # Tracé par le signal `user_login_failed`, qui couvre l'API et l'admin
        # d'une seule ligne — voir ThrottledTokenObtainPairView.
        joined = " ".join(captured.output)
        self.assertIn("auth.login.failed", joined)
        self.assertIn("tracee", joined)
        self.assertNotIn("mauvais-mot-de-passe", joined)

    def test_a_successful_api_login_is_traced(self):
        from django.core.cache import cache

        cache.clear()
        try:
            with self.assertLogs("evacstudio.audit", level="INFO") as captured:
                response = self.client.post(
                    "/api/auth/token/",
                    {"username": "tracee", "password": "pw-tracee-3344"},
                    format="json",
                )
        finally:
            cache.clear()

        self.assertEqual(response.status_code, 200)
        joined = " ".join(captured.output)
        self.assertIn("auth.api_login.success", joined)
        # Le jeton émis ne doit pas se retrouver dans le journal.
        self.assertNotIn(response.data["access"], joined)
        self.assertNotIn(response.data["refresh"], joined)

    def test_workspace_access_changes_are_traced(self):
        from .models import WorkspaceMembership

        other = User.objects.create_user(username="collab", password="pw-collab-66")
        with self.assertLogs("evacstudio.audit", level="INFO") as captured:
            membership = WorkspaceMembership.objects.create(
                owner=self.user, member=other, role="editor"
            )
            membership.delete()

        joined = " ".join(captured.output)
        self.assertIn("workspace.access_granted", joined)
        self.assertIn("workspace.access_revoked", joined)
