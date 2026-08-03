from django.contrib.auth.models import User
from django.urls import reverse
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError
from rest_framework import status
from rest_framework.test import APITestCase
from openai import APITimeoutError, AuthenticationError, RateLimitError
from .image_generator import (
    GeneratedImageSaveError,
    ImageTooLargeError,
    InvalidAPIKeyError,
    InvalidImageFormatError,
    MissingAPIKeyError,
    OpenAIRequestTimeoutError,
    OpenAIResponseWithoutImageError,
    OpenAIRateLimitError,
    ReturnedImageUnreadableError,
    generate_cleaned_plan,
)
from .plan_analyzer import (
    InvalidPlanAnalysisResponseError,
    analyze_existing_plan_and_build_prompt,
    analyze_plan_and_build_prompt,
)
from .pipeline import InvalidGeneratedPromptError, OpenAIPlanCleaningPipelineError, clean_plan_with_openai
from .openai_image_service import clean_plan_with_gpt_image
from .models import EvacuationPlan, OpenAIPlanCleaningJob, PlanCleaningHistory, PlanIcon, UserOpenAISettings
from .openai_pricing import estimate_cleaning_cost
from .prompt_builder import build_final_prompt, build_plan_cleaning_prompt
from .serializers import OpenAICleanPlanSerializer
from .verifier import verifier_plans

class EvacuationPlansAPITests(APITestCase):
    def setUp(self):
        self.username = 'testuser'
        self.email = 'test@example.com'
        self.password = 'superpassword123'
        self.user = User.objects.create_user(
            username=self.username,
            email=self.email,
            password=self.password
        )
        self.register_url = reverse('auth_register')
        self.token_url = reverse('token_obtain_pair')
        self.plans_list_url = reverse('plan-list')

    def test_user_registration(self):
        data = {
            'username': 'newuser',
            'email': 'new@example.com',
            'password': 'newpassword123'
        }
        response = self.client.post(self.register_url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(User.objects.filter(username='newuser').count(), 1)

    def test_user_login_and_jwt(self):
        data = {
            'username': self.username,
            'password': self.password
        }
        response = self.client.post(self.token_url, data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)
        self.assertIn('refresh', response.data)

    def test_plans_crud_unauthenticated(self):
        # Listing plans should fail when not logged in
        response = self.client.get(self.plans_list_url)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_plans_crud_authenticated(self):
        # Authenticate first
        self.client.force_authenticate(user=self.user)

        # Create a plan
        background = SimpleUploadedFile(
            name='test_plan.png',
            content=b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR...',
            content_type='image/png'
        )
        data = {
            'title': 'Main Floor Plan',
            'building_name': 'Building A',
            'floor_name': 'Ground Floor',
            'background_file': background,
            'background_type': 'image'
        }
        
        response = self.client.post(self.plans_list_url, data, format='multipart')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(EvacuationPlan.objects.count(), 1)
        plan_id = response.data['id']

        # Get list of plans
        response = self.client.get(self.plans_list_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)

        # Sync icons for this plan
        sync_url = reverse('plan-sync-icons', kwargs={'pk': plan_id})
        icons_data = [
            {
                'icon_type': 'extincteur',
                'x': 100.5,
                'y': 200.0,
                'width': 32.0,
                'height': 32.0,
                'rotation': 90.0,
                'label': 'Extincteur Hall A'
            }
        ]
        response = self.client.post(sync_url, icons_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(PlanIcon.objects.count(), 1)
        self.assertEqual(PlanIcon.objects.first().label, 'Extincteur Hall A')

    def test_create_pdf_plan_authenticated(self):
        self.client.force_authenticate(user=self.user)

        background = SimpleUploadedFile(
            name='test_plan.pdf',
            content=b'%PDF-1.4\n% test pdf\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF',
            content_type='application/pdf'
        )
        data = {
            'title': 'PDF Floor Plan',
            'building_name': 'Building A',
            'floor_name': 'Ground Floor',
            'background_file': background,
            'background_type': 'pdf'
        }

        response = self.client.post(self.plans_list_url, data, format='multipart')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['background_type'], 'pdf')

    def test_clean_and_revert_plan(self):
        from io import BytesIO
        from PIL import Image
        self.client.force_authenticate(user=self.user)
        
        file_io = BytesIO()
        img = Image.new('RGB', (20, 20), color='white')
        img.save(file_io, 'PNG')
        file_io.seek(0)
        
        background = SimpleUploadedFile(
            name='test_plan.png',
            content=file_io.read(),
            content_type='image/png'
        )
        plan = EvacuationPlan.objects.create(
            user=self.user,
            title='Main Floor Plan',
            building_name='Building A',
            floor_name='Ground Floor',
            background_file=background,
            background_type='image'
        )

        clean_url = reverse('plan-clean-plan', kwargs={'pk': plan.id})
        revert_url = reverse('plan-revert-plan', kwargs={'pk': plan.id})

        # Test Clean
        response = self.client.post(clean_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        plan.refresh_from_db()
        self.assertTrue(plan.use_cleaned_background)
        self.assertIsNotNone(plan.cleaned_background_file)
        self.assertTrue(plan.cleaned_background_file.name.startswith('backgrounds_cleaned/cleaned_'))

        # Test Revert
        response = self.client.post(revert_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        plan.refresh_from_db()
        self.assertFalse(plan.use_cleaned_background)

    def test_clean_walls_plan(self):
        from io import BytesIO
        from PIL import Image, ImageDraw

        self.client.force_authenticate(user=self.user)

        file_io = BytesIO()
        img = Image.new('RGB', (140, 100), color='white')
        draw = ImageDraw.Draw(img)
        draw.rectangle((10, 10, 130, 90), outline='black', width=8)
        draw.line((20, 50, 120, 50), fill='black', width=6)
        draw.text((18, 18), 'BUREAU', fill='black')
        draw.line((25, 25, 45, 35), fill='black', width=1)
        draw.point((70, 20), fill='red')
        img.save(file_io, 'PNG')
        file_io.seek(0)

        background = SimpleUploadedFile(
            name='walls_plan.png',
            content=file_io.read(),
            content_type='image/png'
        )
        plan = EvacuationPlan.objects.create(
            user=self.user,
            title='Walls Plan',
            building_name='Building A',
            floor_name='Ground Floor',
            background_file=background,
            background_type='image'
        )

        clean_walls_url = reverse('plan-clean-walls', kwargs={'pk': plan.id})
        response = self.client.post(clean_walls_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        plan.refresh_from_db()
        self.assertTrue(plan.use_cleaned_background)
        self.assertIsNotNone(plan.cleaned_background_file)
        self.assertTrue(plan.cleaned_background_file.name.startswith('backgrounds_cleaned/walls_'))

    def test_openai_settings_store_retrieve_and_delete_without_exposing_key(self):
        self.client.force_authenticate(user=self.user)
        api_key = 'sk-test-secret-key'

        save_url = reverse('openai_settings_save')
        get_url = reverse('openai_settings')
        delete_url = reverse('openai_settings_delete')

        response = self.client.post(save_url, {'api_key': api_key}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['has_api_key'], True)
        self.assertNotIn('api_key', response.data)
        self.assertNotIn('encrypted_api_key', response.data)

        settings_obj = UserOpenAISettings.objects.get(user=self.user)
        self.assertNotEqual(settings_obj.encrypted_api_key, api_key)
        self.assertTrue(settings_obj.encrypted_api_key.startswith('v1:'))

        response = self.client.get(get_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['has_api_key'], True)
        self.assertNotIn('api_key', response.data)
        self.assertNotIn('encrypted_api_key', response.data)

        response = self.client.delete(delete_url)
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(UserOpenAISettings.objects.filter(user=self.user).exists())

        response = self.client.get(get_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['has_api_key'], False)

    def test_openai_settings_replace_key_without_exposing_key(self):
        self.client.force_authenticate(user=self.user)
        save_url = reverse('openai_settings_save')

        first_response = self.client.post(save_url, {'api_key': 'sk-first-key'}, format='json')
        first_encrypted_key = UserOpenAISettings.objects.get(user=self.user).encrypted_api_key
        second_response = self.client.post(save_url, {'api_key': 'sk-second-key'}, format='json')
        settings_obj = UserOpenAISettings.objects.get(user=self.user)

        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertEqual(second_response.status_code, status.HTTP_200_OK)
        self.assertEqual(UserOpenAISettings.objects.filter(user=self.user).count(), 1)
        self.assertNotEqual(settings_obj.encrypted_api_key, first_encrypted_key)
        self.assertEqual(settings_obj.get_api_key(), 'sk-second-key')
        self.assertNotIn('api_key', second_response.data)
        self.assertNotIn('encrypted_api_key', second_response.data)

    @patch('evacuation_plans.views.urlopen')
    def test_openai_test_key_returns_valid_without_saving_key(self, mock_urlopen):
        self.client.force_authenticate(user=self.user)
        test_url = reverse('openai_test_key')
        response_context = MagicMock()
        response_context.__enter__.return_value.status = 200
        mock_urlopen.return_value = response_context

        response = self.client.post(test_url, {'api_key': 'sk-valid'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['result'], 'valide')
        self.assertFalse(UserOpenAISettings.objects.filter(user=self.user).exists())
        request_arg = mock_urlopen.call_args.args[0]
        self.assertEqual(request_arg.full_url, 'https://api.openai.com/v1/models')
        self.assertEqual(request_arg.get_method(), 'GET')

    @patch('evacuation_plans.views.urlopen')
    def test_openai_test_key_can_use_saved_key_without_returning_it(self, mock_urlopen):
        self.client.force_authenticate(user=self.user)
        settings_obj = UserOpenAISettings(user=self.user)
        settings_obj.set_api_key('sk-saved-key')
        settings_obj.save()
        response_context = MagicMock()
        response_context.__enter__.return_value.status = 200
        mock_urlopen.return_value = response_context

        response = self.client.post(reverse('openai_test_key'), {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['result'], 'valide')
        self.assertNotIn('api_key', response.data)
        self.assertNotIn('encrypted_api_key', response.data)

    @patch('evacuation_plans.views.urlopen')
    def test_openai_test_key_returns_invalid_without_saving_key(self, mock_urlopen):
        self.client.force_authenticate(user=self.user)
        test_url = reverse('openai_test_key')
        mock_urlopen.side_effect = HTTPError(
            url='https://api.openai.com/v1/models',
            code=401,
            msg='Unauthorized',
            hdrs=None,
            fp=None,
        )

        response = self.client.post(test_url, {'api_key': 'sk-invalid'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['result'], 'invalide')
        self.assertFalse(UserOpenAISettings.objects.filter(user=self.user).exists())

    @patch('evacuation_plans.views.analyze_plan_image_with_openai')
    def test_openai_analyze_plan_returns_structured_json(self, mock_analyze):
        from io import BytesIO
        from PIL import Image

        self.client.force_authenticate(user=self.user)
        settings_obj = UserOpenAISettings(user=self.user)
        settings_obj.set_api_key('sk-saved')
        settings_obj.save()

        mock_analysis = {
            'murs': [],
            'ouvertures': [],
            'machines': [],
            'objets': [],
            'texte': [],
            'annotations': [],
            'qualite': {'niveau': 'bonne', 'problemes': [], 'confiance': 0.9},
            'perspective': {
                'etat': 'droite',
                'correction_necessaire': False,
                'details': '',
                'confiance': 0.8,
            },
            'ambiguites': [],
        }
        mock_analyze.return_value = mock_analysis

        file_io = BytesIO()
        image = Image.new('RGB', (20, 20), color='white')
        image.save(file_io, 'PNG')
        file_io.seek(0)
        uploaded_image = SimpleUploadedFile(
            name='plan.png',
            content=file_io.read(),
            content_type='image/png',
        )

        response = self.client.post(
            reverse('openai_analyze_plan'),
            {'image': uploaded_image},
            format='multipart',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, mock_analysis)
        self.assertEqual(UserOpenAISettings.objects.count(), 1)
        self.assertEqual(EvacuationPlan.objects.count(), 0)
        mock_analyze.assert_called_once()

    def test_openai_analyze_plan_requires_saved_key(self):
        from io import BytesIO
        from PIL import Image

        self.client.force_authenticate(user=self.user)
        file_io = BytesIO()
        image = Image.new('RGB', (20, 20), color='white')
        image.save(file_io, 'PNG')
        file_io.seek(0)
        uploaded_image = SimpleUploadedFile(
            name='plan.png',
            content=file_io.read(),
            content_type='image/png',
        )

        response = self.client.post(
            reverse('openai_analyze_plan'),
            {'image': uploaded_image},
            format='multipart',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(EvacuationPlan.objects.count(), 0)

    def test_prompt_builder_builds_dynamic_prompt_from_analysis_and_options(self):
        analysis = {
            'murs': [
                {
                    'description': 'mur principal nord',
                    'position': 'haut du plan',
                    'orientation': 'horizontal',
                    'epaisseur': 'forte',
                    'confiance': 0.9,
                }
            ],
            'machines': [
                {
                    'type': 'ventilation',
                    'description': 'groupe ventilation',
                    'position': 'local technique',
                    'confiance': 0.8,
                }
            ],
            'qualite': {
                'niveau': 'moyenne',
                'problemes': ['texte flou'],
                'confiance': 0.7,
            },
            'ambiguites': [
                {
                    'element': 'trait fin',
                    'raison': 'peut etre une cote ou une cloison',
                    'position': 'centre',
                    'confiance': 0.4,
                }
            ],
        }
        options = {
            'conserver_machines': True,
            'supprimer_texte': True,
            'epaisseur_murs': 'moyenne',
        }

        prompt = build_final_prompt(analysis, options)

        self.assertIn('mur principal nord', prompt)
        self.assertIn('groupe ventilation', prompt)
        self.assertIn('Conserver les machines', prompt)
        self.assertIn('Supprimer les textes', prompt)
        self.assertIn('epaisseur moyenne', prompt)
        self.assertIn('Ne pas inventer les elements incertains', prompt)
        self.assertIn('texte flou', prompt)

    def test_prompt_builder_changes_when_options_change(self):
        analysis = {
            'murs': [],
            'texte': [{'contenu': 'BUREAU', 'position': 'piece droite', 'confiance': 0.95}],
        }

        keep_prompt = build_final_prompt(analysis, {'conserver_machines': True})
        remove_prompt = build_final_prompt(analysis, {'conserver_machines': False})

        self.assertNotEqual(keep_prompt, remove_prompt)
        self.assertIn('conserver les machines', keep_prompt.lower())
        self.assertIn('supprimees', remove_prompt)

    def test_prompt_builder_rejects_invalid_input(self):
        with self.assertRaises(TypeError):
            build_final_prompt([], {})

    def test_plan_cleaning_prompt_remove_text_enabled(self):
        prompt = build_plan_cleaning_prompt(
            {
                'texts': [{'content': 'BUREAU', 'position': 'top right'}],
            },
            {'remove_text': True},
        )

        self.assertIn('Texts selected for removal', prompt)
        self.assertIn('BUREAU', prompt)
        self.assertIn('Remove only the elements explicitly selected by the user', prompt)

    def test_plan_cleaning_prompt_keep_machines_enabled(self):
        prompt = build_plan_cleaning_prompt(
            {
                'machines': [{'type': 'ventilation', 'position': 'technical room'}],
            },
            {'keep_machines': True},
        )

        self.assertIn('Machines to preserve', prompt)
        self.assertIn('ventilation', prompt)
        self.assertIn('Do not move preserved machines', prompt)

    def test_plan_cleaning_prompt_perspective_correction_disabled(self):
        prompt = build_plan_cleaning_prompt(
            {'perspective_correction_needed': True},
            {'correct_perspective': False},
        )

        self.assertIn('Do not apply perspective correction.', prompt)
        self.assertNotIn('Correct perspective because it is requested and needed.', prompt)

    def test_plan_cleaning_prompt_includes_openings(self):
        prompt = build_plan_cleaning_prompt(
            {
                'openings': [{'type': 'corridor opening', 'position': 'north wall'}],
            },
            {},
        )

        self.assertIn('Openings to preserve at relative positions', prompt)
        self.assertIn('corridor opening', prompt)
        self.assertIn('north wall', prompt)
        self.assertIn('Do not close any existing opening.', prompt)

    def test_plan_cleaning_prompt_includes_critical_constraints(self):
        prompt = build_plan_cleaning_prompt(
            {
                'critical_constraints': ['Do not alter the main stair enclosure.'],
            },
            {},
        )

        self.assertIn('Critical constraints', prompt)
        self.assertIn('Do not alter the main stair enclosure.', prompt)

    def test_plan_cleaning_prompt_handles_partial_analysis(self):
        prompt = build_plan_cleaning_prompt(
            {
                'image_type': 'hand_drawn_sketch',
                'outer_walls': [{'position': 'perimeter'}],
            },
            {},
        )

        self.assertIn('hand_drawn_sketch', prompt)
        self.assertIn('Exterior walls to preserve', prompt)
        self.assertIn('Interior walls to preserve', prompt)
        self.assertIn('None detected.', prompt)

    def test_plan_cleaning_prompt_includes_user_instructions(self):
        prompt = build_plan_cleaning_prompt(
            {},
            {'api_key': 'sk-secret-should-not-appear'},
            'Keep the emergency exit corridor extra sharp.',
        )

        self.assertIn('Additional user instructions', prompt)
        self.assertIn('Keep the emergency exit corridor extra sharp.', prompt)
        self.assertNotIn('sk-secret-should-not-appear', prompt)

    @patch('evacuation_plans.openai_image_service.urlopen')
    def test_openai_image_service_returns_cleaned_plan_bytes(self, mock_urlopen):
        import base64
        import json

        cleaned_bytes = b'cleaned-plan'
        response_context = MagicMock()
        response_context.__enter__.return_value.read.return_value = json.dumps({
            'data': [{'b64_json': base64.b64encode(cleaned_bytes).decode('ascii')}],
        }).encode('utf-8')
        mock_urlopen.return_value = response_context

        result = clean_plan_with_gpt_image(
            image=b'original-plan',
            prompt='Nettoyer le plan',
            api_key='sk-test',
        )

        self.assertEqual(result, cleaned_bytes)
        request_arg = mock_urlopen.call_args.args[0]
        self.assertEqual(request_arg.full_url, 'https://api.openai.com/v1/images/edits')
        self.assertEqual(request_arg.get_method(), 'POST')
        self.assertIn('multipart/form-data', request_arg.headers['Content-type'])

    def test_verifier_returns_comparison_report_without_generating_image(self):
        import numpy as np

        original = np.full((120, 120, 3), 255, dtype=np.uint8)
        generated = original.copy()
        original[20:100, 20:26] = 0
        original[20:26, 20:100] = 0
        generated[20:100, 20:26] = 0
        generated[70:76, 20:100] = 0

        report = verifier_plans(original, generated)

        self.assertIn('murs_oublies', report)
        self.assertIn('murs_inventes', report)
        self.assertIn('ouvertures_deplacees', report)
        self.assertIn('score', report)
        self.assertIn('recommandations', report)
        self.assertGreaterEqual(report['score'], 0)
        self.assertLessEqual(report['score'], 1)

    @patch('evacuation_plans.views.threading.Thread')
    def test_openai_clean_starts_pending_job(self, mock_thread):
        from io import BytesIO
        from PIL import Image

        self.client.force_authenticate(user=self.user)
        settings_obj = UserOpenAISettings(user=self.user)
        settings_obj.set_api_key('sk-saved')
        settings_obj.save()

        file_io = BytesIO()
        original_image = Image.new('RGB', (40, 40), color='white')
        original_image.save(file_io, 'PNG')
        file_io.seek(0)
        background = SimpleUploadedFile(
            name='test_plan.png',
            content=file_io.read(),
            content_type='image/png',
        )
        plan = EvacuationPlan.objects.create(
            user=self.user,
            title='OpenAI Plan',
            building_name='Building A',
            floor_name='Ground Floor',
            background_file=background,
            background_type='image',
        )

        response = self.client.post(
            reverse('plan-openai-clean', kwargs={'pk': plan.id}),
            {
                'quality': 'high',
                'conserver_machines': True,
                'supprimer_texte': True,
                'supprimer_dimensions': False,
                'corriger_perspective': True,
                'epaisseur_murs': 4,
                'conserver_ouvertures': True,
                'output_size': '1024x1024',
                'verification_enabled': True,
                'max_automatic_corrections': 1,
                'instructions_supplementaires': 'Garder le passage central visible.',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(response.data['status'], OpenAIPlanCleaningJob.STATUS_PENDING)
        self.assertIn('job_id', response.data)
        job = OpenAIPlanCleaningJob.objects.get(id=response.data['job_id'])
        self.assertEqual(job.status, OpenAIPlanCleaningJob.STATUS_PENDING)
        self.assertEqual(job.options['quality'], 'high')
        self.assertEqual(str(job.estimated_cost_min), '0.362')
        self.assertEqual(str(job.estimated_cost_max), '0.620')
        self.assertEqual(job.pricing_currency, 'USD')
        self.assertEqual(job.quality, 'high')
        self.assertEqual(job.generation_attempts, 2)
        self.assertTrue(job.verification_enabled)
        self.assertFalse(job.actual_cost_available)
        mock_thread.return_value.start.assert_called_once()

        plan.refresh_from_db()
        self.assertFalse(plan.use_cleaned_background)

    @patch('evacuation_plans.views.threading.Thread')
    def test_existing_plan_cleanup_starts_job_with_dedicated_options(self, mock_thread):
        self.client.force_authenticate(user=self.user)
        settings_obj = UserOpenAISettings(user=self.user)
        settings_obj.set_api_key('sk-saved')
        settings_obj.save()

        plan = EvacuationPlan.objects.create(
            user=self.user,
            title='Existing Plan',
            building_name='Building A',
            floor_name='Ground Floor',
            background_file=SimpleUploadedFile('plan.png', self.make_png_bytes(), content_type='image/png'),
            background_type='image',
        )

        response = self.client.post(
            reverse('plan-openai-clean', kwargs={'pk': plan.id}),
            {
                'cleaning_mode': 'existing_plan_cleanup',
                'quality': 'high',
                'supprimer_dimensions': True,
                'supprimer_annotations': True,
                'supprimer_cartouche': True,
                'supprimer_hachures': True,
                'supprimer_mobilier': False,
                'conserver_portes': True,
                'conserver_escaliers': True,
                'conserver_ouvertures': True,
                'simplifier_rendu': True,
                'niveau_nettoyage': 'fort',
                'instructions_supplementaires': 'Conserver la cage escalier centrale.',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        job = OpenAIPlanCleaningJob.objects.get(id=response.data['job_id'])
        self.assertEqual(job.options['cleaning_mode'], 'existing_plan_cleanup')
        self.assertEqual(job.options['quality'], 'high')
        self.assertTrue(job.options['supprimer_dimensions'])
        self.assertTrue(job.options['supprimer_annotations'])
        self.assertTrue(job.options['supprimer_hachures'])
        self.assertFalse(job.options['supprimer_mobilier'])
        self.assertEqual(job.options['niveau_nettoyage'], 'fort')
        mock_thread.return_value.start.assert_called_once()

    def test_openai_clean_status_returns_explicit_error_code(self):
        from io import BytesIO
        from PIL import Image

        self.client.force_authenticate(user=self.user)
        settings_obj = UserOpenAISettings(user=self.user)
        settings_obj.set_api_key('sk-saved')
        settings_obj.save()

        file_io = BytesIO()
        Image.new('RGB', (40, 40), color='white').save(file_io, 'PNG')
        file_io.seek(0)
        background = SimpleUploadedFile(
            name='test_plan.png',
            content=file_io.read(),
            content_type='image/png',
        )
        plan = EvacuationPlan.objects.create(
            user=self.user,
            title='OpenAI Plan',
            building_name='Building A',
            floor_name='Ground Floor',
            background_file=background,
            background_type='image',
        )
        job = OpenAIPlanCleaningJob.objects.create(
            user=self.user,
            plan=plan,
            status=OpenAIPlanCleaningJob.STATUS_FAILED,
            error_code='OPENAI_KEY_INVALID',
            error_message='Clé API OpenAI invalide.',
            diagnostic='openai_authentication_failed',
        )

        response = self.client.get(
            reverse('plan-openai-clean-status', kwargs={'pk': plan.id}),
            {'job_id': job.id},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], OpenAIPlanCleaningJob.STATUS_FAILED)
        self.assertEqual(response.data['error_code'], 'OPENAI_KEY_INVALID')
        self.assertEqual(response.data['diagnostic'], 'openai_authentication_failed')
        self.assertNotIn('api_key', response.data)

    def test_openai_clean_status_returns_completed_quality(self):
        plan = EvacuationPlan.objects.create(
            user=self.user,
            title='OpenAI Plan',
            building_name='Building A',
            floor_name='Ground Floor',
            background_file=SimpleUploadedFile('plan.png', self.make_png_bytes(), content_type='image/png'),
            background_type='image',
        )
        self.client.force_authenticate(user=self.user)
        job = OpenAIPlanCleaningJob.objects.create(
            user=self.user,
            plan=plan,
            status=OpenAIPlanCleaningJob.STATUS_COMPLETED,
            before_image_data='data:image/png;base64,before',
            after_image_data='data:image/png;base64,after',
            options={'quality': 'high'},
        )

        response = self.client.get(
            reverse('plan-openai-clean-status', kwargs={'pk': plan.id}),
            {'job_id': job.id},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['quality'], 'high')
        self.assertEqual(response.data['status'], OpenAIPlanCleaningJob.STATUS_COMPLETED)

    def test_cleaning_history_lists_cleaned_plan_versions(self):
        plan = EvacuationPlan.objects.create(
            user=self.user,
            title='OpenAI Plan',
            building_name='Building A',
            floor_name='Ground Floor',
            background_file=SimpleUploadedFile('plan.png', self.make_png_bytes(), content_type='image/png'),
            background_type='image',
        )
        self.client.force_authenticate(user=self.user)
        history = PlanCleaningHistory(
            user=self.user,
            plan=plan,
            cleaning_method=PlanCleaningHistory.METHOD_OPENAI_EXISTING,
            title='Nettoyage OpenAI d’un plan existant',
            options={'quality': 'high', 'cleaning_mode': 'existing_plan_cleanup'},
        )
        history.image_file.save('history.png', ContentFile(self.make_png_bytes(size=(30, 30))), save=True)
        other_plan = EvacuationPlan.objects.create(
            user=self.user,
            title='Other Plan',
            building_name='Building B',
            floor_name='Ground Floor',
            background_file=SimpleUploadedFile('other.png', self.make_png_bytes(), content_type='image/png'),
            background_type='image',
        )
        other_history = PlanCleaningHistory(
            user=self.user,
            plan=other_plan,
            cleaning_method=PlanCleaningHistory.METHOD_LOCAL,
            title='Autre historique',
        )
        other_history.image_file.save('other-history.png', ContentFile(self.make_png_bytes()), save=True)

        response = self.client.get(reverse('plan-openai-clean-history', kwargs={'pk': plan.id}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['id'], history.id)
        self.assertEqual(response.data[0]['cleaning_method'], PlanCleaningHistory.METHOD_OPENAI_EXISTING)
        self.assertEqual(response.data[0]['title'], 'Nettoyage OpenAI d’un plan existant')
        self.assertIn('/media/', response.data[0]['image_url'])

    def test_use_cleaning_history_applies_selected_cleaned_version(self):
        plan = EvacuationPlan.objects.create(
            user=self.user,
            title='OpenAI Plan',
            building_name='Building A',
            floor_name='Ground Floor',
            background_file=SimpleUploadedFile('plan.png', self.make_png_bytes(), content_type='image/png'),
            background_type='image',
        )
        self.client.force_authenticate(user=self.user)
        history = PlanCleaningHistory(
            user=self.user,
            plan=plan,
            cleaning_method=PlanCleaningHistory.METHOD_OPENAI_EXISTING,
            title='Version nettoyée choisie',
        )
        history.image_file.save('selected-history.png', ContentFile(self.make_png_bytes(size=(30, 30))), save=True)

        response = self.client.post(
            reverse('plan-use-openai-clean-history', kwargs={'pk': plan.id}),
            {'history_id': history.id},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        plan.refresh_from_db()
        self.assertTrue(plan.use_cleaned_background)
        self.assertTrue(plan.cleaned_background_file.name.startswith('backgrounds_cleaned/history_restored_'))

    def test_local_clean_creates_cleaning_history_entry(self):
        plan = EvacuationPlan.objects.create(
            user=self.user,
            title='Local Plan',
            building_name='Building A',
            floor_name='Ground Floor',
            background_file=SimpleUploadedFile('plan.png', self.make_png_bytes(), content_type='image/png'),
            background_type='image',
        )
        self.client.force_authenticate(user=self.user)

        response = self.client.post(reverse('plan-clean-plan', kwargs={'pk': plan.id}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        history = PlanCleaningHistory.objects.get(plan=plan)
        self.assertEqual(history.cleaning_method, PlanCleaningHistory.METHOD_LOCAL)
        self.assertTrue(history.image_file.name.startswith('backgrounds_cleaned/history/cleaned_'))

    def test_openai_cleaning_job_never_completes_after_failure(self):
        plan = EvacuationPlan.objects.create(
            user=self.user,
            title='OpenAI Plan',
            building_name='Building A',
            floor_name='Ground Floor',
            background_file=SimpleUploadedFile('plan.png', self.make_png_bytes(), content_type='image/png'),
            background_type='image',
        )
        job = OpenAIPlanCleaningJob.objects.create(user=self.user, plan=plan)

        job.mark_failed('ANALYSIS_FAILED', 'Analyse impossible.', 'analysis_failed')
        job.mark_status(OpenAIPlanCleaningJob.STATUS_COMPLETED)
        job.refresh_from_db()

        self.assertEqual(job.status, OpenAIPlanCleaningJob.STATUS_FAILED)
        self.assertEqual(job.error_code, 'ANALYSIS_FAILED')

    def test_openai_clean_serializer_uses_medium_quality_by_default(self):
        serializer = OpenAICleanPlanSerializer(data={})

        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data['quality'], 'medium')
        self.assertEqual(serializer.validated_data['cleaning_mode'], 'sketch_to_plan')

    def test_openai_clean_serializer_rejects_unknown_quality(self):
        serializer = OpenAICleanPlanSerializer(data={'quality': 'ultra'})

        self.assertFalse(serializer.is_valid())
        self.assertIn('quality', serializer.errors)

    def test_openai_clean_serializer_accepts_existing_plan_cleanup_options(self):
        serializer = OpenAICleanPlanSerializer(data={
            'cleaning_mode': 'existing_plan_cleanup',
            'quality': 'low',
            'supprimer_dimensions': True,
            'supprimer_annotations': True,
            'supprimer_cartouche': True,
            'supprimer_hachures': True,
            'niveau_nettoyage': 'leger',
        })

        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data['cleaning_mode'], 'existing_plan_cleanup')
        self.assertEqual(serializer.validated_data['quality'], 'low')
        self.assertTrue(serializer.validated_data['supprimer_dimensions'])
        self.assertTrue(serializer.validated_data['supprimer_annotations'])
        self.assertTrue(serializer.validated_data['supprimer_hachures'])
        self.assertEqual(serializer.validated_data['niveau_nettoyage'], 'leger')

    def test_openai_cost_estimate_local_is_free(self):
        estimate = estimate_cleaning_cost('local', 'medium', 'auto')

        self.assertEqual(estimate['currency'], 'USD')
        self.assertEqual(estimate['estimated_min'], 0.0)
        self.assertEqual(estimate['estimated_max'], 0.0)
        self.assertFalse(estimate['details']['analysis'])

    def test_openai_cost_estimate_quality_ordering(self):
        low = estimate_cleaning_cost('sketch_to_plan', 'low', '1024x1024')
        medium = estimate_cleaning_cost('sketch_to_plan', 'medium', '1024x1024')
        high = estimate_cleaning_cost('sketch_to_plan', 'high', '1024x1024')

        self.assertLess(low['estimated_max'], medium['estimated_max'])
        self.assertLess(medium['estimated_max'], high['estimated_max'])

    def test_openai_cost_estimate_adds_verification(self):
        base = estimate_cleaning_cost('existing_plan_cleanup', 'medium', '1024x1024')
        verified = estimate_cleaning_cost('existing_plan_cleanup', 'medium', '1024x1024', verification_enabled=True)

        self.assertGreater(verified['estimated_min'], base['estimated_min'])
        self.assertGreater(verified['estimated_max'], base['estimated_max'])
        self.assertTrue(verified['details']['verification'])

    def test_openai_cost_estimate_adds_automatic_correction_generation(self):
        base = estimate_cleaning_cost('sketch_to_plan', 'high', '1024x1024')
        corrected = estimate_cleaning_cost('sketch_to_plan', 'high', '1024x1024', max_automatic_corrections=1)

        self.assertEqual(corrected['details']['generation_count_max'], 2)
        self.assertEqual(corrected['estimated_min'], base['estimated_min'] * 2)
        self.assertEqual(corrected['estimated_max'], base['estimated_max'] * 2)

    def test_openai_cost_estimate_rejects_unknown_quality(self):
        with self.assertRaises(ValueError):
            estimate_cleaning_cost('sketch_to_plan', 'ultra', '1024x1024')

    def test_openai_cost_estimate_endpoint_returns_usd(self):
        plan = EvacuationPlan.objects.create(
            user=self.user,
            title='Cost Plan',
            building_name='Building A',
            floor_name='Ground Floor',
            background_file=SimpleUploadedFile('plan.png', self.make_png_bytes(), content_type='image/png'),
            background_type='image',
        )
        self.client.force_authenticate(user=self.user)

        response = self.client.post(
            reverse('plan-openai-clean-cost-estimate', kwargs={'pk': plan.id}),
            {
                'cleaning_mode': 'existing_plan_cleanup',
                'quality': 'medium',
                'output_size': '1024x1024',
                'verification_enabled': True,
                'max_automatic_corrections': 1,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['currency'], 'USD')
        self.assertEqual(response.data['details']['generation_count_max'], 2)
        self.assertTrue(response.data['details']['verification'])

    def test_openai_cost_estimate_endpoint_rejects_unknown_quality(self):
        plan = EvacuationPlan.objects.create(
            user=self.user,
            title='Cost Plan',
            building_name='Building A',
            floor_name='Ground Floor',
            background_file=SimpleUploadedFile('plan.png', self.make_png_bytes(), content_type='image/png'),
            background_type='image',
        )
        self.client.force_authenticate(user=self.user)

        response = self.client.post(
            reverse('plan-openai-clean-cost-estimate', kwargs={'pk': plan.id}),
            {'cleaning_mode': 'sketch_to_plan', 'quality': 'ultra'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('quality', response.data)

    @patch('evacuation_plans.pipeline.generate_cleaned_plan')
    @patch('evacuation_plans.pipeline.analyze_plan_and_build_prompt')
    def test_openai_pipeline_uses_saved_key_and_specific_prompt(
        self,
        mock_analyze,
        mock_generate,
    ):
        from io import BytesIO
        from PIL import Image
        from evacuation_plans.image_generator import GeneratedPlanResult
        from evacuation_plans.plan_analyzer import PlanAnalysisResult

        self.client.force_authenticate(user=self.user)
        settings_obj = UserOpenAISettings(user=self.user)
        settings_obj.set_api_key('sk-saved-user-key')
        settings_obj.save()

        file_io = BytesIO()
        Image.new('RGB', (40, 40), color='white').save(file_io, 'PNG')
        file_io.seek(0)
        background = SimpleUploadedFile(
            name='test_plan.png',
            content=file_io.read(),
            content_type='image/png',
        )
        plan = EvacuationPlan.objects.create(
            user=self.user,
            title='OpenAI Plan',
            building_name='Building A',
            floor_name='Ground Floor',
            background_file=background,
            background_type='image',
        )

        generated_io = BytesIO()
        Image.new('RGB', (40, 40), color='white').save(generated_io, 'PNG')
        generated_path = '/tmp/planevacuation-pipeline-generated.png'
        with open(generated_path, 'wb') as generated_file:
            generated_file.write(generated_io.getvalue())

        payload = self.make_plan_analysis_payload()
        mock_analyze.return_value = PlanAnalysisResult(
            analysis=payload,
            generation_prompt=payload['generation_prompt'],
            model='gpt-5',
        )
        mock_generate.return_value = GeneratedPlanResult(
            image_path=generated_path,
            mime_type='image/png',
            width=40,
            height=40,
            model='gpt-image-1',
            status='success',
        )

        result = clean_plan_with_openai(
            self.make_png_bytes(size=(40, 40)),
            self.user,
            {
                'quality': 'medium',
                'api_key': 'sk-malicious-request-key',
            },
            plan=plan,
        )

        self.assertEqual(mock_analyze.call_args.args[2], 'sk-saved-user-key')
        self.assertIsInstance(mock_analyze.call_args.args[0], bytes)
        self.assertEqual(mock_generate.call_args.args[0], mock_analyze.call_args.args[0])
        self.assertEqual(mock_generate.call_args.args[1], payload['generation_prompt'])
        self.assertEqual(mock_generate.call_args.args[2], self.user)
        self.assertEqual(mock_generate.call_args.kwargs['quality'], 'medium')
        self.assertEqual(result.generation_prompt, payload['generation_prompt'])

    @patch('evacuation_plans.pipeline.generate_cleaned_plan')
    @patch('evacuation_plans.pipeline.analyze_existing_plan_and_build_prompt')
    @patch('evacuation_plans.pipeline.analyze_plan_and_build_prompt')
    def test_openai_pipeline_uses_existing_plan_cleanup_analyzer(
        self,
        mock_sketch_analyze,
        mock_existing_analyze,
        mock_generate,
    ):
        from io import BytesIO
        from PIL import Image
        from evacuation_plans.image_generator import GeneratedPlanResult
        from evacuation_plans.plan_analyzer import PlanAnalysisResult

        settings_obj = UserOpenAISettings(user=self.user)
        settings_obj.set_api_key('sk-saved-user-key')
        settings_obj.save()

        generated_io = BytesIO()
        Image.new('RGB', (40, 40), color='white').save(generated_io, 'PNG')
        generated_path = '/tmp/planevacuation-existing-cleanup-generated.png'
        with open(generated_path, 'wb') as generated_file:
            generated_file.write(generated_io.getvalue())

        payload = self.make_existing_plan_analysis_payload()
        mock_existing_analyze.return_value = PlanAnalysisResult(
            analysis=payload,
            generation_prompt=payload['generation_prompt'],
            model='gpt-5',
        )
        mock_generate.return_value = GeneratedPlanResult(
            image_path=generated_path,
            mime_type='image/png',
            width=40,
            height=40,
            model='gpt-image-1',
            status='success',
            quality='high',
        )

        result = clean_plan_with_openai(
            self.make_png_bytes(size=(40, 40)),
            self.user,
            {
                'cleaning_mode': 'existing_plan_cleanup',
                'quality': 'high',
                'supprimer_dimensions': True,
                'supprimer_annotations': True,
                'supprimer_hachures': True,
                'niveau_nettoyage': 'fort',
            },
        )

        mock_sketch_analyze.assert_not_called()
        mock_existing_analyze.assert_called_once()
        existing_options = mock_existing_analyze.call_args.args[1]
        self.assertEqual(existing_options['cleaning_mode'], 'existing_plan_cleanup')
        self.assertTrue(existing_options['remove_dimensions'])
        self.assertTrue(existing_options['remove_annotations'])
        self.assertTrue(existing_options['remove_hatching'])
        self.assertEqual(existing_options['cleanup_level'], 'fort')
        self.assertEqual(mock_generate.call_args.kwargs['quality'], 'high')
        self.assertIn('existing architectural floor plan', result.generation_prompt)

    @patch('evacuation_plans.pipeline.generate_cleaned_plan')
    @patch('evacuation_plans.pipeline.analyze_existing_plan_and_build_prompt')
    def test_existing_plan_cleanup_prompt_accepts_pictogram_wording(
        self,
        mock_existing_analyze,
        mock_generate,
    ):
        from io import BytesIO
        from PIL import Image
        from evacuation_plans.image_generator import GeneratedPlanResult
        from evacuation_plans.plan_analyzer import PlanAnalysisResult

        settings_obj = UserOpenAISettings(user=self.user)
        settings_obj.set_api_key('sk-saved-user-key')
        settings_obj.save()

        generated_io = BytesIO()
        Image.new('RGB', (40, 40), color='white').save(generated_io, 'PNG')
        generated_path = '/tmp/planevacuation-existing-cleanup-pictogram-wording.png'
        with open(generated_path, 'wb') as generated_file:
            generated_file.write(generated_io.getvalue())

        prompt = self.make_existing_plan_analysis_payload()['generation_prompt'].replace(
            'do not add evacuation symbols',
            'do not add evacuation pictograms or safety icons',
        )
        payload = self.make_existing_plan_analysis_payload(generation_prompt=prompt)
        mock_existing_analyze.return_value = PlanAnalysisResult(
            analysis=payload,
            generation_prompt=payload['generation_prompt'],
            model='gpt-5',
        )
        mock_generate.return_value = GeneratedPlanResult(
            image_path=generated_path,
            mime_type='image/png',
            width=40,
            height=40,
            model='gpt-image-1',
            status='success',
        )

        result = clean_plan_with_openai(
            self.make_png_bytes(size=(40, 40)),
            self.user,
            {'cleaning_mode': 'existing_plan_cleanup', 'quality': 'medium'},
        )

        self.assertIn('evacuation pictograms', result.generation_prompt)
        mock_generate.assert_called_once()

    @patch('evacuation_plans.pipeline.generate_cleaned_plan')
    @patch('evacuation_plans.pipeline.analyze_plan_and_build_prompt')
    def test_openai_pipeline_maps_image_save_failure(self, mock_analyze, mock_generate):
        from evacuation_plans.plan_analyzer import PlanAnalysisResult

        settings_obj = UserOpenAISettings(user=self.user)
        settings_obj.set_api_key('sk-saved-user-key')
        settings_obj.save()
        payload = self.make_plan_analysis_payload()
        mock_analyze.return_value = PlanAnalysisResult(
            analysis=payload,
            generation_prompt=payload['generation_prompt'],
            model='gpt-5',
        )
        mock_generate.side_effect = GeneratedImageSaveError('generated_image_save_failed')

        with self.assertRaises(OpenAIPlanCleaningPipelineError) as context:
            clean_plan_with_openai(self.make_png_bytes(), self.user, {'quality': 'medium'})

        self.assertEqual(context.exception.error_code, 'IMAGE_SAVE_FAILED')
        self.assertEqual(context.exception.diagnostic, 'generated_image_save_failed')

    def test_use_openai_cleaned_applies_generated_image_only_when_requested(self):
        import base64
        from io import BytesIO
        from PIL import Image

        self.client.force_authenticate(user=self.user)

        original_io = BytesIO()
        Image.new('RGB', (20, 20), color='white').save(original_io, 'PNG')
        original_io.seek(0)
        background = SimpleUploadedFile(
            name='test_plan.png',
            content=original_io.read(),
            content_type='image/png',
        )
        plan = EvacuationPlan.objects.create(
            user=self.user,
            title='OpenAI Plan',
            building_name='Building A',
            floor_name='Ground Floor',
            background_file=background,
            background_type='image',
        )

        generated_io = BytesIO()
        Image.new('RGB', (20, 20), color='white').save(generated_io, 'PNG')
        image_data = 'data:image/png;base64,' + base64.b64encode(generated_io.getvalue()).decode('ascii')

        response = self.client.post(
            reverse('plan-use-openai-cleaned', kwargs={'pk': plan.id}),
            {'image_data': image_data},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        plan.refresh_from_db()
        self.assertTrue(plan.use_cleaned_background)
        self.assertTrue(plan.cleaned_background_file.name.startswith('backgrounds_cleaned/openai_cleaned_'))

    def make_png_bytes(self, color='white', size=(20, 20)):
        from io import BytesIO
        from PIL import Image

        output = BytesIO()
        Image.new('RGB', size, color=color).save(output, 'PNG')
        return output.getvalue()

    def make_openai_image_response(self, image_bytes=None, request_id='req_test', size=(20, 20)):
        import base64

        image_bytes = image_bytes if image_bytes is not None else self.make_png_bytes(size=size)
        image_item = MagicMock()
        image_item.b64_json = base64.b64encode(image_bytes).decode('ascii')
        response = MagicMock()
        response.data = [image_item]
        response._request_id = request_id
        return response

    def make_plan_analysis_payload(self, generation_prompt=None):
        prompt = generation_prompt if generation_prompt is not None else (
            'Edit the supplied source image into a clean black-and-white top-down architectural floor plan. '
            'The supplied source image is the authoritative geometric reference. '
            'Preserve the exact visible topology and relative spatial relationships. '
            'Do not redesign the building. '
            'Do not invent, add, remove, close or relocate any wall, opening, door, machine or obstacle unless explicitly requested. '
            'Use the source image together with the geometric description below. '
            'Visible geometry to preserve: '
            'The plan shows a building global approximatively rectangular with a continuous top wall attached to the left and right exterior walls, '
            'a large middle-left opening open toward the central area, and a bottom-center opening that must remain open. '
            'Preserve the vertical interior partition starting from the bottom wall toward the center, the horizontal partition extending inward from the right wall, '
            'and the small L-shaped partition in the bottom-left area connected to the lower zone. '
            'Preserve two rectangular machines in the top-right area separated from the exterior wall. '
            'Elements to remove: '
            'Remove handwritten room labels at top-center when text removal is requested and remove dimension marks only when dimensions removal is requested. '
            'Critical constraints: '
            'Keep the stair-like notch visible as instructed by the user. '
            'Preserve ambiguous areas as closely as possible to the source image. Do not complete missing geometry without sufficient visual evidence. '
            'Use uniform black wall lines on a pure white background and return a strict top-down architectural drawing. '
            'Return only the cleaned floor-plan image, with no explanation or text.'
        )
        return {
            'image_type': 'hand_drawn_floor_plan',
            'overall_shape': 'approximatively rectangular building with continuous top wall and visible lower passage',
            'outer_perimeter_description': (
                'top-center exterior wall continuous, attached to the top-left and top-right corners; '
                'middle-left exterior wall interrupted by a large opening open toward the central area; '
                'bottom-center exterior edge includes an opening connected to the central circulation'
            ),
            'interior_walls': [
                {
                    'position': 'bottom-center',
                    'orientation': 'vertical',
                    'description': 'vertical partition starting from the bottom wall and extending toward the center',
                },
                {
                    'position': 'middle-right',
                    'orientation': 'horizontal',
                    'description': 'horizontal partition extending inward from the middle-right wall toward the center',
                },
                {
                    'position': 'bottom-left',
                    'orientation': 'L-shaped',
                    'description': 'small L-shaped partition in the bottom-left area connected to the lower zone',
                },
            ],
            'openings': [
                {
                    'position': 'middle-left',
                    'description': 'large opening on the middle-left wall open toward the central area',
                },
                {
                    'position': 'bottom-center',
                    'description': 'bottom-center opening connected to the lower edge and central area',
                },
            ],
            'doors': [],
            'windows': [],
            'machines': [
                {
                    'position': 'top-right',
                    'shape': 'two rectangles',
                    'description': 'two rectangular machines in the top-right area, separated from the exterior wall',
                },
            ],
            'obstacles': [
                {
                    'position': 'bottom-left',
                    'description': 'small rectangular obstacle near bottom-left attached to the L-shaped partition',
                },
            ],
            'elements_to_remove': [
                'handwritten room label at top-center',
                'thin dimension mark near middle-right wall',
            ],
            'elements_to_keep': [
                'two rectangular machines in the top-right area',
                'large opening on the middle-left wall',
            ],
            'perspective_issues': [
                'slight camera skew visible along the top wall',
            ],
            'ambiguous_areas': [
                'short disconnected stroke near center-left may be a wall fragment or annotation',
            ],
            'critical_constraints': [
                'never close the middle-left opening',
                'never move the bottom-center opening',
            ],
            'generation_prompt': prompt,
        }

    def make_existing_plan_analysis_payload(self, generation_prompt=None):
        prompt = generation_prompt if generation_prompt is not None else (
            'Clean this existing architectural floor plan and convert it into a simplified black-and-white floor plan suitable as the base for an evacuation plan. '
            'The source image is the authoritative geometric reference. '
            'Geometry to preserve: Preserve the exact building geometry and layout, including the top-center exterior wall, the middle-left corridor, '
            'the bottom-right stair enclosure, all exterior and interior walls, the central partitions attached to the main circulation, and visible door openings. '
            'Elements to remove: Remove dimensions, measurement lines, technical annotations, hatching in the top-right rooms, the title block near the bottom edge, '
            'and unnecessary technical symbols according to the selected options. '
            'Elements to keep: Preserve doors, openings and stairs, especially the bottom-right stair enclosure and the middle-left door swing. '
            'Critical constraints: Do not redesign or reinterpret the building, do not invent new rooms, do not move walls, do not close openings, '
            'do not remove doors or stairs when preservation is requested, do not add evacuation symbols, title, watermark, textures or decorative elements. '
            'Simplify the drawing while preserving the architectural structure, use a clean white background and clear black architectural lines. '
            'Output only the cleaned floor-plan image suitable as the base for an evacuation plan.'
        )
        return {
            'image_type': 'existing_architectural_floor_plan',
            'structure_summary': 'Existing CAD-like plan with exterior walls, interior partitions, door openings and a stair enclosure.',
            'geometry_to_preserve': [
                'top-center exterior wall connected to left and right perimeter walls',
                'middle-left corridor and central partitions attached to the main circulation',
                'bottom-right stair enclosure with visible door opening',
            ],
            'elements_to_remove': [
                'dimension strings along the top edge',
                'technical annotations near center-right',
                'hatching in top-right rooms',
                'title block near the bottom edge',
            ],
            'elements_to_keep': [
                'all exterior and interior walls',
                'middle-left door swing',
                'bottom-right stairs',
                'visible openings',
            ],
            'simplification_level': 'fort',
            'visual_noise_level': 'high',
            'critical_constraints': [
                'do not move walls',
                'do not close openings',
                'do not add evacuation symbols',
            ],
            'generation_prompt': prompt,
        }

    def make_plan_analyzer_response(self, payload):
        response = MagicMock()
        response.output_text = __import__('json').dumps(payload)
        return response

    @patch('evacuation_plans.plan_analyzer.OpenAI')
    def test_plan_analyzer_returns_valid_structured_json(self, mock_openai):
        mock_client = mock_openai.return_value
        payload = self.make_plan_analysis_payload()
        mock_client.responses.create.return_value = self.make_plan_analyzer_response(payload)

        result = analyze_plan_and_build_prompt(
            self.make_png_bytes(),
            {'keep_machines': True, 'preserve_openings': True},
            'sk-test',
        )

        self.assertEqual(result.status, 'success')
        self.assertEqual(result.analysis['image_type'], 'hand_drawn_floor_plan')
        self.assertEqual(result.generation_prompt, payload['generation_prompt'])
        self.assertEqual(result.model, 'gpt-5')

    @patch('evacuation_plans.plan_analyzer.OpenAI')
    def test_existing_plan_analyzer_returns_cleanup_json_and_uses_options(self, mock_openai):
        mock_client = mock_openai.return_value
        payload = self.make_existing_plan_analysis_payload()
        mock_client.responses.create.return_value = self.make_plan_analyzer_response(payload)

        result = analyze_existing_plan_and_build_prompt(
            self.make_png_bytes(),
            {
                'remove_dimensions': True,
                'remove_annotations': True,
                'remove_hatching': True,
                'cleanup_level': 'fort',
                'quality': 'high',
            },
            'sk-test',
        )

        request_text = mock_client.responses.create.call_args.kwargs['input'][0]['content'][0]['text']
        self.assertIn('not a hand-drawn sketch reconstruction task', request_text)
        self.assertIn('"remove_dimensions": true', request_text)
        self.assertIn('"remove_annotations": true', request_text)
        self.assertIn('"remove_hatching": true', request_text)
        self.assertIn('"cleanup_level": "fort"', request_text)
        self.assertEqual(result.analysis['geometry_to_preserve'], payload['geometry_to_preserve'])
        self.assertIn('Do not redesign or reinterpret', result.generation_prompt)

    def test_editor_contains_existing_plan_cleanup_button_and_progress_labels(self):
        editor_path = '/Users/studio/Documents/planevacuation/frontend/src/app/evacuation-plans/[id]/editor/page.tsx'
        with open(editor_path, encoding='utf-8') as editor_file:
            source = editor_file.read()

        self.assertIn('Nettoyer un plan existant', source)
        self.assertIn('Nettoyer ce plan avec OpenAI', source)
        self.assertIn('existing_plan_cleanup', source)
        self.assertIn('Analyse du plan existant', source)
        self.assertIn('Nettoyage du plan', source)

    def test_editor_contains_dynamic_openai_cost_estimate_ui(self):
        editor_path = '/Users/studio/Documents/planevacuation/frontend/src/app/evacuation-plans/[id]/editor/page.tsx'
        with open(editor_path, encoding='utf-8') as editor_file:
            source = editor_file.read()

        self.assertIn('Coût estimé', source)
        self.assertIn('openai-clean-cost-estimate', source)
        self.assertIn('openaiOutputSize', source)
        self.assertIn('openaiVerificationEnabled', source)
        self.assertIn('openaiMaxAutomaticCorrections', source)
        self.assertIn('Coût estimé maximum pour cette opération', source)

    @patch('evacuation_plans.plan_analyzer.OpenAI')
    def test_plan_analyzer_requires_concrete_geometric_description(self, mock_openai):
        mock_openai.return_value.responses.create.return_value = self.make_plan_analyzer_response(
            self.make_plan_analysis_payload()
        )

        result = analyze_plan_and_build_prompt(self.make_png_bytes(), {}, 'sk-test')

        geometry_text = ' '.join(item['description'] for item in result.analysis['interior_walls'])
        self.assertIn('top-center exterior wall continuous', result.analysis['outer_perimeter_description'])
        self.assertIn('vertical partition starting from the bottom wall', geometry_text)
        self.assertIn('extending inward from the middle-right wall', geometry_text)

    @patch('evacuation_plans.plan_analyzer.OpenAI')
    def test_plan_analyzer_prompt_includes_detected_walls(self, mock_openai):
        mock_openai.return_value.responses.create.return_value = self.make_plan_analyzer_response(
            self.make_plan_analysis_payload()
        )

        result = analyze_plan_and_build_prompt(self.make_png_bytes(), {}, 'sk-test')

        self.assertIn('continuous top wall', result.generation_prompt)
        self.assertIn('vertical interior partition starting from the bottom wall', result.generation_prompt)
        self.assertIn('horizontal partition extending inward from the right wall', result.generation_prompt)

    @patch('evacuation_plans.plan_analyzer.OpenAI')
    def test_plan_analyzer_prompt_includes_openings(self, mock_openai):
        mock_openai.return_value.responses.create.return_value = self.make_plan_analyzer_response(
            self.make_plan_analysis_payload()
        )

        result = analyze_plan_and_build_prompt(self.make_png_bytes(), {}, 'sk-test')

        self.assertIn('large middle-left opening', result.generation_prompt)
        self.assertIn('bottom-center opening', result.generation_prompt)
        self.assertIn('never close the middle-left opening', result.analysis['critical_constraints'])

    @patch('evacuation_plans.plan_analyzer.OpenAI')
    def test_plan_analyzer_preserves_machines_when_requested(self, mock_openai):
        mock_client = mock_openai.return_value
        mock_client.responses.create.return_value = self.make_plan_analyzer_response(
            self.make_plan_analysis_payload()
        )

        result = analyze_plan_and_build_prompt(
            self.make_png_bytes(),
            {'keep_machines': True},
            'sk-test',
        )

        request_text = mock_client.responses.create.call_args.kwargs['input'][0]['content'][0]['text']
        self.assertIn('"keep_machines": true', request_text)
        self.assertIn('two rectangular machines in the top-right area', result.generation_prompt)

    @patch('evacuation_plans.plan_analyzer.OpenAI')
    def test_plan_analyzer_removes_text_when_requested(self, mock_openai):
        mock_client = mock_openai.return_value
        mock_client.responses.create.return_value = self.make_plan_analyzer_response(
            self.make_plan_analysis_payload()
        )

        result = analyze_plan_and_build_prompt(
            self.make_png_bytes(),
            {'remove_text': True},
            'sk-test',
        )

        request_text = mock_client.responses.create.call_args.kwargs['input'][0]['content'][0]['text']
        self.assertIn('"remove_text": true', request_text)
        self.assertIn('handwritten room label at top-center', result.analysis['elements_to_remove'])
        self.assertIn('Remove handwritten room labels', result.generation_prompt)

    @patch('evacuation_plans.plan_analyzer.OpenAI')
    def test_plan_analyzer_includes_user_instructions(self, mock_openai):
        mock_client = mock_openai.return_value
        mock_client.responses.create.return_value = self.make_plan_analyzer_response(
            self.make_plan_analysis_payload()
        )

        result = analyze_plan_and_build_prompt(
            self.make_png_bytes(),
            {'user_instructions': 'Keep the stair-like notch visible.'},
            'sk-test',
        )

        request_text = mock_client.responses.create.call_args.kwargs['input'][0]['content'][0]['text']
        self.assertIn('Keep the stair-like notch visible.', request_text)
        self.assertIn('Keep the stair-like notch visible', result.generation_prompt)

    @patch('evacuation_plans.plan_analyzer.OpenAI')
    def test_plan_analyzer_rejects_empty_prompt(self, mock_openai):
        payload = self.make_plan_analysis_payload(generation_prompt='')
        mock_openai.return_value.responses.create.return_value = self.make_plan_analyzer_response(payload)

        with self.assertRaises(InvalidPlanAnalysisResponseError):
            analyze_plan_and_build_prompt(self.make_png_bytes(), {}, 'sk-test')

    @patch('evacuation_plans.plan_analyzer.OpenAI')
    def test_plan_analyzer_accepts_semantic_prompt_sections_without_exact_colons(self, mock_openai):
        prompt = self.make_plan_analysis_payload()['generation_prompt'].replace(
            'Visible geometry to preserve:',
            'Geometry to preserve -',
        ).replace(
            'Elements to remove:',
            'Remove -',
        ).replace(
            'Critical constraints:',
            'Constraints -',
        )
        payload = self.make_plan_analysis_payload(generation_prompt=prompt)
        mock_openai.return_value.responses.create.return_value = self.make_plan_analyzer_response(payload)

        result = analyze_plan_and_build_prompt(self.make_png_bytes(), {}, 'sk-test')

        self.assertIn('Geometry to preserve', result.generation_prompt)

    @patch('evacuation_plans.plan_analyzer.OpenAI')
    def test_plan_analyzer_accepts_requirements_style_prompt(self, mock_openai):
        prompt = (
            'Edit the supplied source image into a clean black-and-white top-down architectural floor plan. '
            'Use the supplied image as the source image and preserve the exact layout and visible topology. '
            'Requirements: keep all walls and openings in their original relative positions, never close the middle-left opening, '
            'and do not redesign the building. The outer perimeter is a top-center continuous wall attached to top-left and top-right corners, '
            'with a middle-left opening open toward the central area and a bottom-center opening connected to the lower edge. '
            'Preserve the vertical partition starting from the bottom wall toward the center, the horizontal partition extending inward from '
            'the middle-right wall, and the bottom-left L-shaped partition connected to the lower zone. '
            'Keep two rectangular machines in the top-right area separated from the exterior wall. '
            'Remove handwritten room labels and dimension marks only; do not add extra walls, doors, windows, labels, symbols, furniture, title, '
            'textures, shading, colors or watermark. Use uniform black lines on a pure white background and output a strict top-down floor plan.'
        )
        payload = self.make_plan_analysis_payload(generation_prompt=prompt)
        mock_openai.return_value.responses.create.return_value = self.make_plan_analyzer_response(payload)

        result = analyze_plan_and_build_prompt(self.make_png_bytes(), {}, 'sk-test')

        self.assertIn('Requirements', result.generation_prompt)

    @patch('evacuation_plans.plan_analyzer.OpenAI')
    def test_plan_analyzer_prompt_error_has_prompt_invalid_code(self, mock_openai):
        payload = self.make_plan_analysis_payload(generation_prompt='Generic clean floor plan.')
        mock_openai.return_value.responses.create.return_value = self.make_plan_analyzer_response(payload)

        with self.assertRaises(InvalidPlanAnalysisResponseError) as context:
            analyze_plan_and_build_prompt(self.make_png_bytes(), {}, 'sk-test')

        self.assertEqual(context.exception.error_code, 'PROMPT_INVALID')
        self.assertEqual(context.exception.diagnostic, 'generation_prompt_too_short')

    @patch('evacuation_plans.plan_analyzer.OpenAI')
    def test_plan_analyzer_rejects_unstructured_response(self, mock_openai):
        response = MagicMock()
        response.output_text = 'not-json'
        mock_openai.return_value.responses.create.return_value = response

        with self.assertRaises(InvalidPlanAnalysisResponseError):
            analyze_plan_and_build_prompt(self.make_png_bytes(), {}, 'sk-test')

    @patch('logging.Logger._log')
    @patch('evacuation_plans.plan_analyzer.OpenAI')
    def test_plan_analyzer_keeps_api_key_out_of_logs(self, mock_openai, mock_log):
        secret_key = 'sk-secret-should-not-leak'
        response = MagicMock()
        response.output_text = 'not-json'
        mock_openai.return_value.responses.create.return_value = response

        with self.assertRaises(InvalidPlanAnalysisResponseError) as context:
            analyze_plan_and_build_prompt(self.make_png_bytes(), {}, secret_key)

        logged_text = ' '.join(str(call) for call in mock_log.call_args_list)
        self.assertNotIn(secret_key, str(context.exception))
        self.assertNotIn(secret_key, logged_text)

    @patch('evacuation_plans.plan_analyzer.OpenAI')
    def test_plan_analyzer_generation_prompt_changes_with_analysis(self, mock_openai):
        first_payload = self.make_plan_analysis_payload()
        second_payload = self.make_plan_analysis_payload()
        second_payload['outer_perimeter_description'] = (
            'top-left stair-shaped exterior perimeter connected to a bottom-right service wing'
        )
        second_payload['generation_prompt'] = second_payload['generation_prompt'].replace(
            'building global approximatively rectangular with a continuous top wall',
            'building with a stair-shaped top-left perimeter connected to a bottom-right service wing',
        )
        mock_openai.return_value.responses.create.side_effect = [
            self.make_plan_analyzer_response(first_payload),
            self.make_plan_analyzer_response(second_payload),
        ]

        first_result = analyze_plan_and_build_prompt(self.make_png_bytes(), {}, 'sk-test')
        second_result = analyze_plan_and_build_prompt(self.make_png_bytes(), {}, 'sk-test')

        self.assertNotEqual(first_result.generation_prompt, second_result.generation_prompt)
        self.assertIn('bottom-right service wing', second_result.generation_prompt)

    @patch('evacuation_plans.pipeline.generate_cleaned_plan')
    @patch('evacuation_plans.pipeline.analyze_plan_and_build_prompt')
    def test_openai_pipeline_accepts_requirements_style_prompt_validation(self, mock_analyze, mock_generate):
        from evacuation_plans.image_generator import GeneratedPlanResult
        from evacuation_plans.plan_analyzer import PlanAnalysisResult

        settings_obj = UserOpenAISettings(user=self.user)
        settings_obj.set_api_key('sk-saved-user-key')
        settings_obj.save()
        generated_path = '/tmp/planevacuation-pipeline-requirements.png'
        with open(generated_path, 'wb') as generated_file:
            generated_file.write(self.make_png_bytes())

        prompt = (
            'Edit the supplied source image into a clean black-and-white top-down architectural floor plan. '
            'Use the original image as the source image and preserve the exact layout and topology. '
            'Requirements: keep all walls and openings in their original relative positions, never close the middle-left opening, '
            'and do not redesign the building. The outer perimeter is a top-center continuous wall attached to top-left and top-right corners, '
            'with a middle-left passage open toward the central area and a bottom-center opening connected to the lower edge. '
            'Preserve the vertical partition starting from the bottom wall toward the center, the horizontal partition extending inward from '
            'the middle-right wall, and the bottom-left L-shaped partition connected to the lower zone. '
            'Keep two rectangular machines in the top-right area separated from the exterior wall. '
            'Remove handwritten labels and dimension marks only; do not add extra walls, doors, windows, labels, symbols, furniture, title, '
            'textures, shading, colors or watermark. Use uniform black lines on a pure white background and output a strict top-down floor plan.'
        )
        payload = self.make_plan_analysis_payload(generation_prompt=prompt)
        mock_analyze.return_value = PlanAnalysisResult(analysis=payload, generation_prompt=prompt, model='gpt-5')
        mock_generate.return_value = GeneratedPlanResult(
            image_path=generated_path,
            mime_type='image/png',
            width=20,
            height=20,
            model='gpt-image-1',
            status='success',
        )

        result = clean_plan_with_openai(self.make_png_bytes(), self.user, {'quality': 'medium'})

        self.assertEqual(result.generation_prompt, prompt)
        mock_generate.assert_called_once()

    @patch('evacuation_plans.pipeline.generate_cleaned_plan')
    @patch('evacuation_plans.pipeline.analyze_plan_and_build_prompt')
    def test_openai_pipeline_blocks_generic_analysis_before_generation(self, mock_analyze, mock_generate):
        from evacuation_plans.plan_analyzer import PlanAnalysisResult

        settings_obj = UserOpenAISettings(user=self.user)
        settings_obj.set_api_key('sk-saved-user-key')
        settings_obj.save()
        payload = self.make_plan_analysis_payload(generation_prompt='Generic clean floor plan.')
        mock_analyze.return_value = PlanAnalysisResult(
            analysis=payload,
            generation_prompt='Generic clean floor plan.',
            model='gpt-5',
        )

        with self.assertRaises(InvalidGeneratedPromptError):
            clean_plan_with_openai(self.make_png_bytes(), self.user, {})

        mock_generate.assert_not_called()

    @override_settings(MEDIA_ROOT='/tmp/planevacuation-test-media')
    @patch('evacuation_plans.image_generator.OpenAI')
    def test_image_generator_success(self, mock_openai):
        mock_client = mock_openai.return_value
        mock_client.images.edit.return_value = self.make_openai_image_response()

        result = generate_cleaned_plan(
            source_image=self.make_png_bytes(),
            prompt='Prompt final',
            api_key='sk-test',
            quality='medium',
            user=self.user,
        )

        self.assertEqual(result.status, 'success')
        self.assertEqual(result.mime_type, 'image/png')
        self.assertEqual(result.width, 20)
        self.assertEqual(result.height, 20)
        self.assertEqual(result.request_id, 'req_test')
        self.assertEqual(result.user_id, self.user.id)
        self.assertEqual(result.quality, 'medium')

    @override_settings(MEDIA_ROOT='/tmp/planevacuation-test-media')
    @patch('evacuation_plans.image_generator.OpenAI')
    def test_image_generator_transmits_low_quality_to_openai(self, mock_openai):
        mock_client = mock_openai.return_value
        mock_client.images.edit.return_value = self.make_openai_image_response()

        result = generate_cleaned_plan(self.make_png_bytes(), 'Prompt final', 'sk-test', quality='low')

        self.assertEqual(mock_client.images.edit.call_args.kwargs['quality'], 'low')
        self.assertEqual(result.quality, 'low')

    @override_settings(MEDIA_ROOT='/tmp/planevacuation-test-media')
    @patch('evacuation_plans.image_generator.OpenAI')
    def test_image_generator_transmits_high_quality_to_openai(self, mock_openai):
        mock_client = mock_openai.return_value
        mock_client.images.edit.return_value = self.make_openai_image_response()

        result = generate_cleaned_plan(self.make_png_bytes(), 'Prompt final', 'sk-test', quality='high')

        self.assertEqual(mock_client.images.edit.call_args.kwargs['quality'], 'high')
        self.assertEqual(result.quality, 'high')

    @override_settings(MEDIA_ROOT='/tmp/planevacuation-test-media')
    @patch('evacuation_plans.image_generator.OpenAI')
    def test_image_generator_transmits_original_image(self, mock_openai):
        mock_client = mock_openai.return_value
        mock_client.images.edit.return_value = self.make_openai_image_response()
        source_bytes = self.make_png_bytes(color='black')

        generate_cleaned_plan(source_bytes, 'Prompt final', 'sk-test')

        sent_image = mock_client.images.edit.call_args.kwargs['image']
        sent_image.seek(0)
        self.assertEqual(sent_image.read(), source_bytes)
        self.assertEqual(mock_client.images.edit.call_args.kwargs['size'], '1024x1024')

    @override_settings(MEDIA_ROOT='/tmp/planevacuation-test-media')
    @patch('evacuation_plans.image_generator.OpenAI')
    def test_image_generator_pads_wide_source_and_restores_original_dimensions(self, mock_openai):
        from PIL import Image

        mock_client = mock_openai.return_value
        mock_client.images.edit.return_value = self.make_openai_image_response(size=(1536, 1024))
        source_bytes = self.make_png_bytes(size=(120, 60))

        result = generate_cleaned_plan(source_bytes, 'Prompt final', 'sk-test')

        self.assertEqual(mock_client.images.edit.call_args.kwargs['size'], '1536x1024')
        sent_image = mock_client.images.edit.call_args.kwargs['image']
        sent_image.seek(0)
        with Image.open(sent_image) as opened:
            self.assertEqual(opened.size, (120, 80))

        with Image.open(result.image_path) as generated:
            self.assertEqual(generated.size, (120, 60))
        self.assertEqual(result.width, 120)
        self.assertEqual(result.height, 60)
        self.assertIn('source_image_padded_to_preserve_full_plan_aspect_ratio', result.warnings)

    @override_settings(MEDIA_ROOT='/tmp/planevacuation-test-media')
    @patch('evacuation_plans.image_generator.OpenAI')
    def test_image_generator_transmits_final_prompt(self, mock_openai):
        mock_client = mock_openai.return_value
        mock_client.images.edit.return_value = self.make_openai_image_response()

        generate_cleaned_plan(self.make_png_bytes(), 'Prompt final dynamique', 'sk-test')

        self.assertEqual(mock_client.images.edit.call_args.kwargs['prompt'], 'Prompt final dynamique')

    def test_image_generator_missing_api_key(self):
        with self.assertRaises(MissingAPIKeyError):
            generate_cleaned_plan(self.make_png_bytes(), 'Prompt final', '')

    @patch('evacuation_plans.image_generator.OpenAI')
    def test_image_generator_invalid_api_key(self, mock_openai):
        mock_response = MagicMock()
        mock_response.status_code = 401
        mock_openai.return_value.images.edit.side_effect = AuthenticationError(
            'invalid api key',
            response=mock_response,
            body=None,
        )

        with self.assertRaises(InvalidAPIKeyError):
            generate_cleaned_plan(self.make_png_bytes(), 'Prompt final', 'sk-invalid')

    def test_image_generator_disallowed_file(self):
        with self.assertRaises(InvalidImageFormatError):
            generate_cleaned_plan(b'not an image', 'Prompt final', 'sk-test')

    @patch.dict('os.environ', {'OPENAI_MAX_IMAGE_SIZE_MB': '1'})
    def test_image_generator_file_too_large(self):
        with self.assertRaises(ImageTooLargeError):
            generate_cleaned_plan(b'0' * (1024 * 1024 + 1), 'Prompt final', 'sk-test')

    @patch('evacuation_plans.image_generator.OpenAI')
    def test_image_generator_timeout(self, mock_openai):
        mock_openai.return_value.images.edit.side_effect = APITimeoutError(request=MagicMock())

        with self.assertRaises(OpenAIRequestTimeoutError):
            generate_cleaned_plan(self.make_png_bytes(), 'Prompt final', 'sk-test')

    @patch('evacuation_plans.image_generator.OpenAI')
    def test_image_generator_rate_limit(self, mock_openai):
        mock_response = MagicMock()
        mock_response.status_code = 429
        mock_openai.return_value.images.edit.side_effect = RateLimitError(
            'rate limited',
            response=mock_response,
            body=None,
        )

        with self.assertRaises(OpenAIRateLimitError):
            generate_cleaned_plan(self.make_png_bytes(), 'Prompt final', 'sk-test')

    @patch('evacuation_plans.image_generator.OpenAI')
    def test_image_generator_response_without_image(self, mock_openai):
        response = MagicMock()
        response.data = []
        mock_openai.return_value.images.edit.return_value = response

        with self.assertRaises(OpenAIResponseWithoutImageError):
            generate_cleaned_plan(self.make_png_bytes(), 'Prompt final', 'sk-test')

    @patch('evacuation_plans.image_generator.OpenAI')
    def test_image_generator_invalid_returned_image(self, mock_openai):
        mock_openai.return_value.images.edit.return_value = self.make_openai_image_response(b'invalid image bytes')

        with self.assertRaises(ReturnedImageUnreadableError):
            generate_cleaned_plan(self.make_png_bytes(), 'Prompt final', 'sk-test')

    @patch('evacuation_plans.image_generator.OpenAI')
    def test_image_generator_keeps_api_key_out_of_exception_message(self, mock_openai):
        mock_openai.return_value.images.edit.side_effect = APITimeoutError(request=MagicMock())
        secret_key = 'sk-secret-should-not-leak'

        try:
            generate_cleaned_plan(self.make_png_bytes(), 'Prompt final', secret_key)
        except OpenAIRequestTimeoutError as exc:
            self.assertNotIn(secret_key, str(exc))
            self.assertNotIn(secret_key, exc.diagnostic)

    @override_settings(MEDIA_ROOT='/tmp/planevacuation-test-media')
    @patch('evacuation_plans.image_generator.OpenAI')
    def test_image_generator_preserves_original_file(self, mock_openai):
        from pathlib import Path

        original_path = Path('/tmp/planevacuation-original.png')
        original_bytes = self.make_png_bytes(color='black')
        original_path.write_bytes(original_bytes)
        mock_openai.return_value.images.edit.return_value = self.make_openai_image_response()

        generate_cleaned_plan(str(original_path), 'Prompt final', 'sk-test')

        self.assertEqual(original_path.read_bytes(), original_bytes)

    @override_settings(MEDIA_ROOT='/tmp/planevacuation-test-media')
    @patch.dict('os.environ', {'OPENAI_PLAN_IMAGE_MODEL': 'gpt-image-test-model'})
    @patch('evacuation_plans.image_generator.OpenAI')
    def test_image_generator_uses_configured_model(self, mock_openai):
        mock_client = mock_openai.return_value
        mock_client.images.edit.return_value = self.make_openai_image_response()

        result = generate_cleaned_plan(self.make_png_bytes(), 'Prompt final', 'sk-test')

        self.assertEqual(mock_client.images.edit.call_args.kwargs['model'], 'gpt-image-test-model')
        self.assertEqual(result.model, 'gpt-image-test-model')
