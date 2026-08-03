import os
import base64
import cv2
import logging
import threading
import numpy as np
import fitz # PyMuPDF
from urllib.parse import quote
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from django.conf import settings
from django.db import close_old_connections
from django.core.files.base import ContentFile
from rest_framework import viewsets, permissions, status, generics
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.decorators import action
from django.contrib.auth.models import User
from .models import EvacuationPlan, OpenAIPlanCleaningJob, PlanCleaningHistory, PlanIcon, UserOpenAISettings
from .openai_analysis import OpenAIPlanAnalysisError, analyze_plan_image_with_openai
from .pipeline import (
    InvalidGeneratedPromptError,
    OpenAIPlanCleaningPipelineError,
    clean_plan_with_openai,
)
from .serializers import (
    AnalyzePlanImageSerializer,
    OpenAICleanCostEstimateSerializer,
    OpenAICleanPlanSerializer,
    UserRegistrationSerializer,
    UserSerializer,
    EvacuationPlanSerializer,
    PlanIconSerializer,
    SaveUserOpenAISettingsSerializer,
    TestOpenAIKeySerializer,
    PlanCleaningHistorySerializer,
    ApplyManualPlanEditSerializer,
    UseCleaningHistorySerializer,
    UseOpenAICleanedPlanSerializer,
    UserOpenAISettingsSerializer
)
from .openai_pricing import estimate_cleaning_cost

PLAN_PICTOGRAM_DIRS = ('plan_picto', 'nf_x-picto')
PLAN_PICTOGRAM_EXTENSIONS = {'.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif'}
logger = logging.getLogger(__name__)


TERMINAL_OPENAI_CLEANING_STATUSES = {
    OpenAIPlanCleaningJob.STATUS_COMPLETED,
    OpenAIPlanCleaningJob.STATUS_FAILED,
}

def get_plan_pictogram_directory():
    for directory in PLAN_PICTOGRAM_DIRS:
        path = os.path.join(settings.MEDIA_ROOT, directory)
        if os.path.isdir(path):
            return directory, path
    return PLAN_PICTOGRAM_DIRS[0], os.path.join(settings.MEDIA_ROOT, PLAN_PICTOGRAM_DIRS[0])

def build_plan_pictogram_url(request, relative_path):
    media_path = '/'.join(relative_path.split(os.sep))
    url = settings.MEDIA_URL + quote(media_path)
    return request.build_absolute_uri(url)

def list_plan_pictograms(request):
    directory, root = get_plan_pictogram_directory()
    if not os.path.isdir(root):
        return []

    pictograms = []
    for filename in sorted(os.listdir(root), key=str.casefold):
        path = os.path.join(root, filename)
        name, extension = os.path.splitext(filename)
        if not os.path.isfile(path) or extension.lower() not in PLAN_PICTOGRAM_EXTENSIONS:
            continue

        relative_path = os.path.join(directory, filename)
        pictograms.append({
            'type': name,
            'label': name,
            'file_name': filename,
            'url': build_plan_pictogram_url(request, relative_path),
        })

    return pictograms

def load_plan_image(plan, dpi=200):
    original_path = plan.background_file.path

    if plan.background_type == 'pdf':
        doc = fitz.open(original_path)
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

    img = cv2.imread(original_path)
    if img is None:
        return None, "Failed to load original image"
    return img, None

def create_cleaning_history(plan, image_bytes, prefix, cleaning_method, title, options=None, openai_job=None):
    original_name = os.path.splitext(os.path.basename(plan.background_file.path))[0]
    filename = f"{prefix}_{original_name}.png"
    history = PlanCleaningHistory(
        plan=plan,
        user=plan.user,
        openai_job=openai_job,
        cleaning_method=cleaning_method,
        title=title,
        options=options or {},
    )
    history.image_file.save(filename, ContentFile(image_bytes), save=True)
    return history


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


def serialize_openai_cleaning_job(job):
    data = {
        "job_id": job.id,
        "status": job.status,
        "error_code": job.error_code or "",
        "error": job.error_message or "",
        "diagnostic": job.diagnostic or "",
        "estimated_cost_min": float(job.estimated_cost_min) if job.estimated_cost_min is not None else None,
        "estimated_cost_max": float(job.estimated_cost_max) if job.estimated_cost_max is not None else None,
        "pricing_currency": job.pricing_currency,
        "actual_cost": float(job.actual_cost) if job.actual_cost is not None else None,
        "actual_cost_available": job.actual_cost_available,
    }
    if job.status == OpenAIPlanCleaningJob.STATUS_COMPLETED:
        data.update({
            "before_image": job.before_image_data,
            "after_image": job.after_image_data,
            "analysis": job.analysis,
            "generation_prompt": job.generation_prompt,
            "models": job.models_used,
            "quality": job.options.get("quality", "medium"),
            "warnings": job.warnings,
        })
    return data


def serialize_openai_cleaning_history_item(job):
    return {
        "job_id": job.id,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "before_image": job.before_image_data,
        "after_image": job.after_image_data,
        "quality": job.options.get("quality", "medium"),
        "cleaning_mode": job.options.get("cleaning_mode", "sketch_to_plan"),
        "options": job.options,
        "models": job.models_used,
        "warnings": job.warnings,
    }


def run_openai_cleaning_job(job_id):
    close_old_connections()
    try:
        job = OpenAIPlanCleaningJob.objects.select_related("plan", "user").get(id=job_id)
        plan = job.plan
        user = job.user

        job.mark_status(OpenAIPlanCleaningJob.STATUS_LOADING_SOURCE)
        original_image, error = load_plan_image(plan, dpi=250)
        if error:
            job.mark_failed("IMAGE_SAVE_FAILED", error, "source_load_failed")
            return

        original_bytes = encode_image_to_png_bytes(original_image)
        if original_bytes is None:
            job.mark_failed("IMAGE_SAVE_FAILED", "Impossible de préparer le plan original.", "source_encode_failed")
            return

        before_image_data = image_bytes_to_data_url(original_bytes)

        try:
            result = clean_plan_with_openai(
                original_bytes,
                user,
                job.options,
                user_instructions=job.options.get("instructions_supplementaires"),
                plan=plan,
                status_callback=job.mark_status,
            )
        except InvalidGeneratedPromptError as exc:
            job.mark_failed(exc.error_code, str(exc), exc.diagnostic)
            return
        except OpenAIPlanCleaningPipelineError as exc:
            job.mark_failed(exc.error_code, str(exc), exc.diagnostic)
            return
        except Exception as exc:
            logger.exception("openai_clean.job.unexpected_failed", extra={"job_id": job.id, "user_id": user.id, "plan_id": plan.id})
            job.mark_failed("IMAGE_GENERATION_FAILED", "Erreur pendant le nettoyage OpenAI.", exc.__class__.__name__)
            return

        job.refresh_from_db()
        if job.status == OpenAIPlanCleaningJob.STATUS_FAILED:
            return

        job.status = OpenAIPlanCleaningJob.STATUS_COMPLETED
        job.before_image_data = before_image_data
        job.after_image_data = image_bytes_to_data_url(result.cleaned_image_bytes)
        job.analysis = result.analysis
        job.generation_prompt = result.generation_prompt
        job.models_used = {
            "analysis": result.analysis_model,
            "image": result.image_model,
        }
        job.options = {**job.options, "quality": result.quality}
        job.warnings = result.warnings
        job.error_code = ""
        job.error_message = ""
        job.diagnostic = ""
        job.save(update_fields=[
            "status",
            "before_image_data",
            "after_image_data",
            "analysis",
            "generation_prompt",
            "models_used",
            "options",
            "warnings",
            "error_code",
            "error_message",
            "diagnostic",
            "updated_at",
        ])
        cleaning_mode = job.options.get("cleaning_mode", "sketch_to_plan")
        if cleaning_mode == "existing_plan_cleanup":
            cleaning_method = PlanCleaningHistory.METHOD_OPENAI_EXISTING
            title = "Nettoyage OpenAI d'un plan existant"
        else:
            cleaning_method = PlanCleaningHistory.METHOD_OPENAI_SKETCH
            title = "Croquis vers plan propre avec OpenAI"
        create_cleaning_history(
            plan,
            result.cleaned_image_bytes,
            "openai",
            cleaning_method,
            title,
            options=job.options,
            openai_job=job,
        )
    finally:
        close_old_connections()

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

class RegisterView(generics.CreateAPIView):
    queryset = User.objects.all()
    permission_classes = [permissions.AllowAny]
    serializer_class = UserRegistrationSerializer

class CurrentUserView(generics.RetrieveAPIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user


class UserOpenAISettingsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        settings_obj = UserOpenAISettings.objects.filter(user=request.user).first()
        if not settings_obj:
            return Response({
                "has_api_key": False,
                "created_at": None,
                "updated_at": None,
            }, status=status.HTTP_200_OK)

        serializer = UserOpenAISettingsSerializer(settings_obj)
        return Response(serializer.data, status=status.HTTP_200_OK)


class SaveUserOpenAISettingsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = SaveUserOpenAISettingsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        settings_obj, _ = UserOpenAISettings.objects.get_or_create(user=request.user)
        settings_obj.set_api_key(serializer.validated_data["api_key"])
        settings_obj.save()

        response_serializer = UserOpenAISettingsSerializer(settings_obj)
        return Response(response_serializer.data, status=status.HTTP_200_OK)


class DeleteUserOpenAISettingsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request):
        UserOpenAISettings.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class TestOpenAIKeyView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = TestOpenAIKeySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        api_key = serializer.validated_data.get("api_key", "").strip()

        if not api_key:
            settings_obj = UserOpenAISettings.objects.filter(user=request.user).first()
            if not settings_obj:
                return Response({"result": "invalide"}, status=status.HTTP_200_OK)
            api_key = settings_obj.get_api_key()

        openai_request = Request(
            "https://api.openai.com/v1/models",
            headers={
                "Authorization": f"Bearer {api_key}",
            },
            method="GET",
        )

        try:
            with urlopen(openai_request, timeout=10) as response:
                result = "valide" if 200 <= response.status < 300 else "invalide"
        except (HTTPError, URLError, TimeoutError, OSError):
            result = "invalide"

        return Response({"result": result}, status=status.HTTP_200_OK)


class AnalyzePlanImageView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = AnalyzePlanImageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        settings_obj = UserOpenAISettings.objects.filter(user=request.user).first()
        if not settings_obj:
            return Response(
                {"error": "Aucune clé API OpenAI enregistrée.", "error_code": "OPENAI_KEY_INVALID"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            analysis = analyze_plan_image_with_openai(
                serializer.validated_data["image"],
                settings_obj.get_api_key(),
            )
        except OpenAIPlanAnalysisError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(analysis, status=status.HTTP_200_OK)

class EvacuationPlanViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = EvacuationPlanSerializer

    def get_query_set(self):
        # Compatibility helper
        return EvacuationPlan.objects.filter(user=self.request.user)

    def get_queryset(self):
        return EvacuationPlan.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=False, methods=['get'], url_path='pictograms')
    def pictograms(self, request):
        return Response(list_plan_pictograms(request), status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='openai-clean-cost-estimate')
    def openai_clean_cost_estimate(self, request, pk=None):
        self.get_object()
        serializer = OpenAICleanCostEstimateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            estimate = estimate_cleaning_cost(**serializer.validated_data)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(estimate, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='clean')
    def clean_plan(self, request, pk=None):
        plan = self.get_object()
        img, error = load_plan_image(plan)
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

    @action(detail=True, methods=['post'], url_path='clean-walls')
    def clean_walls(self, request, pk=None):
        plan = self.get_object()
        img, error = load_plan_image(plan, dpi=250)
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

    @action(detail=True, methods=['post'], url_path='openai-clean')
    def openai_clean(self, request, pk=None):
        plan = self.get_object()
        serializer = OpenAICleanPlanSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        settings_obj = UserOpenAISettings.objects.filter(user=request.user).first()
        if not settings_obj:
            return Response(
                {"error": "Aucune clé API OpenAI enregistrée.", "error_code": "OPENAI_KEY_INVALID"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        cost_estimate = estimate_cleaning_cost(
            cleaning_mode=serializer.validated_data.get("cleaning_mode", "sketch_to_plan"),
            quality=serializer.validated_data.get("quality", "medium"),
            output_size=serializer.validated_data.get("output_size", "auto"),
            verification_enabled=serializer.validated_data.get("verification_enabled", False),
            max_automatic_corrections=serializer.validated_data.get("max_automatic_corrections", 0),
        )

        job = OpenAIPlanCleaningJob.objects.create(
            user=request.user,
            plan=plan,
            status=OpenAIPlanCleaningJob.STATUS_PENDING,
            options=serializer.validated_data,
            estimated_cost_min=cost_estimate["estimated_min"],
            estimated_cost_max=cost_estimate["estimated_max"],
            pricing_currency=cost_estimate["currency"],
            quality=cost_estimate["details"]["quality"],
            generation_attempts=cost_estimate["details"]["generation_count_max"],
            verification_enabled=cost_estimate["details"]["verification"],
        )
        thread = threading.Thread(target=run_openai_cleaning_job, args=(job.id,), daemon=True)
        thread.start()

        return Response(serialize_openai_cleaning_job(job), status=status.HTTP_202_ACCEPTED)

    @action(detail=True, methods=['get'], url_path='openai-clean-status')
    def openai_clean_status(self, request, pk=None):
        plan = self.get_object()
        job_id = request.query_params.get("job_id")
        jobs = OpenAIPlanCleaningJob.objects.filter(user=request.user, plan=plan)
        if job_id:
            jobs = jobs.filter(id=job_id)
        job = jobs.order_by("-created_at").first()
        if not job:
            return Response({"error": "Traitement OpenAI introuvable.", "error_code": "JOB_NOT_FOUND"}, status=status.HTTP_404_NOT_FOUND)
        return Response(serialize_openai_cleaning_job(job), status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='use-openai-cleaned')
    def use_openai_cleaned(self, request, pk=None):
        plan = self.get_object()
        serializer = UseOpenAICleanedPlanSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        image_data = serializer.validated_data["image_data"]
        _, encoded_image = image_data.split(";base64,", 1)
        try:
            image_bytes = base64.b64decode(encoded_image, validate=True)
        except ValueError:
            return Response({"error": "Image générée invalide."}, status=status.HTTP_400_BAD_REQUEST)

        if not save_cleaned_plan_bytes(
            plan,
            image_bytes,
            "openai_cleaned",
            PlanCleaningHistory.METHOD_OPENAI_APPLIED,
            "Résultat OpenAI appliqué",
        ):
            return Response({"error": "Image générée invalide."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = self.get_serializer(plan)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['get'], url_path='openai-clean-history')
    def openai_clean_history(self, request, pk=None):
        plan = self.get_object()
        history = PlanCleaningHistory.objects.filter(
            user=request.user,
            plan=plan,
        )
        serializer = PlanCleaningHistorySerializer(history, many=True, context={"request": request})
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='use-openai-clean-history')
    def use_openai_clean_history(self, request, pk=None):
        plan = self.get_object()
        serializer = UseCleaningHistorySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        history = PlanCleaningHistory.objects.filter(
            id=serializer.validated_data["history_id"],
            user=request.user,
            plan=plan,
        ).first()
        if not history or not history.image_file:
            return Response({"error": "Historique de nettoyage introuvable."}, status=status.HTTP_404_NOT_FOUND)

        try:
            image_bytes = history.image_file.read()
        except OSError:
            return Response({"error": "Image historique invalide."}, status=status.HTTP_400_BAD_REQUEST)

        if not save_cleaned_plan_bytes(plan, image_bytes, "history_restored", create_history=False):
            return Response({"error": "Image historique invalide."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = self.get_serializer(plan)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='apply-manual-edit')
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

    @action(detail=True, methods=['post'], url_path='sync-icons')
    def sync_icons(self, request, pk=None):
        """
        Expects a list of icons: [{'icon_type': ..., 'x': ..., 'y': ..., 'width': ..., 'height': ..., 'rotation': ..., 'label': ...}]
        Deletes all existing icons for this plan and inserts the new list.
        """
        plan = self.get_object()
        icons_data = request.data
        if not isinstance(icons_data, list):
            return Response({"error": "Expected a list of icons"}, status=status.HTTP_400_BAD_REQUEST)

        # Clear existing icons
        plan.icons.all().delete()

        # Create new ones
        created_icons = []
        for icon_data in icons_data:
            icon = PlanIcon(
                plan=plan,
                icon_type=icon_data.get('icon_type'),
                x=icon_data.get('x'),
                y=icon_data.get('y'),
                width=icon_data.get('width'),
                height=icon_data.get('height'),
                rotation=icon_data.get('rotation', 0.0),
                label=icon_data.get('label', '')
            )
            icon.save()
            created_icons.append(icon)

        serializer = PlanIconSerializer(created_icons, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

class PlanIconViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = PlanIconSerializer

    def get_queryset(self):
        return PlanIcon.objects.filter(plan__user=self.request.user)
