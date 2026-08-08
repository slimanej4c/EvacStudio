import os
import base64
import cv2
import logging
import threading
import numpy as np
import fitz # PyMuPDF
from urllib.parse import quote
from django.conf import settings
from django.db import close_old_connections, transaction
from django.core.files.base import ContentFile
from rest_framework import viewsets, permissions, status, generics
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.decorators import action
from django.contrib.auth.models import User
from .models import (
    EvacuationPlan,
    GrokCleaningJob,
    PlanCleaningHistory,
    PlanIcon,
    PlanShape,
    PlanText,
    UserXaiSettings,
)
from .grok_cleaning import (
    GrokCleaningError,
    MissingXaiApiKeyError,
    analyze_and_clean_plan,
)
from .serializers import (
    UserRegistrationSerializer,
    UserSerializer,
    EvacuationPlanSerializer,
    PlanIconSerializer,
    PlanShapeSerializer,
    PlanTextSerializer,
    SaveUserXaiSettingsSerializer,
    TestXaiKeySerializer,
    PlanCleaningHistorySerializer,
    ApplyManualPlanEditSerializer,
    UseCleaningHistorySerializer,
    UserXaiSettingsSerializer,
)

PLAN_PICTOGRAM_DIRS = ('plan_picto', 'nf_x-picto')
PLAN_PICTOGRAM_EXTENSIONS = {'.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif'}
logger = logging.getLogger(__name__)


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

    img = cv2.imread(target_path)
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
        "error_code": job.error_code or "",
        "error": job.error_message or "",
        "diagnostic": job.diagnostic or "",
    }
    if job.status == GrokCleaningJob.STATUS_COMPLETED:
        data.update({
            "before_image": job.before_image_data,
            "after_image": job.after_image_data,
            "analysis": job.analysis,
            "generation_prompt": job.generation_prompt,
            "model": job.model_used,
        })
    return data


def run_grok_cleaning_job(job_id):
    """Background worker: analyse + image generation, then auto-apply the result."""
    close_old_connections()
    try:
        job = GrokCleaningJob.objects.select_related("plan", "user").get(id=job_id)
        plan = job.plan
        user = job.user
        preset = getattr(job, "preset", "evacuation")

        settings_obj = UserXaiSettings.objects.filter(user=user).first()
        if not settings_obj:
            job.mark_failed("XAI_KEY_MISSING", "Aucune clé API xAI enregistrée.", "missing_xai_settings")
            return
        api_key = settings_obj.get_api_key()

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
                original_bytes, api_key, background_color=job.target_background_color or "#FFFFFF", preset=preset
            )
        except (GrokCleaningError, MissingXaiApiKeyError) as exc:
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

        job.mark_status(GrokCleaningJob.STATUS_GENERATING)

        after_image_data = image_bytes_to_data_url(result.cleaned_image_bytes)
        if not result.cleaned_image_bytes or not after_image_data:
            job.mark_failed("IMAGE_SAVE_FAILED", "Image nettoyée vide.", "empty_cleaned_image")
            return

        # Apply the cleaned image immediately and record it in the shared history.
        history_method = PlanCleaningHistory.METHOD_GROK_AUTOCAD if preset == "autocad" else PlanCleaningHistory.METHOD_GROK
        history_title = "Base architecturale AutoCAD extraite par l'IA (Grok)" if preset == "autocad" else "Base architecturale extraite par l'IA (Grok)"

        if not save_cleaned_plan_bytes(
            plan,
            result.cleaned_image_bytes,
            "grok_cleaned",
            history_method,
            history_title,
            options={
                "preset": preset,
                "analysis_model": result.analysis_model,
                "image_model": result.image_model,
                "target_background_color": job.target_background_color or "#FFFFFF",
            },
        ):
            job.mark_failed("IMAGE_SAVE_FAILED", "Impossible d'enregistrer l'image nettoyée.", "save_failed")
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
        job.save(update_fields=[
            "status",
            "after_image_data",
            "analysis",
            "generation_prompt",
            "model_used",
            "error_code",
            "error_message",
            "diagnostic",
            "updated_at",
        ])
    finally:
        close_old_connections()


class RegisterView(generics.CreateAPIView):
    queryset = User.objects.all()
    permission_classes = [permissions.AllowAny]
    serializer_class = UserRegistrationSerializer

class CurrentUserView(generics.RetrieveAPIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user


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
        try:
            from xai_sdk import Client
            from xai_sdk.chat import user

            client = Client(api_key=api_key)
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
                logger.warning("xai_test_key.failed code=%s", code_name,
                               extra={"user_id": request.user.id})
            else:
                logger.warning("xai_test_key.failed class=%s", exc.__class__.__name__,
                               extra={"user_id": request.user.id})
            result = "invalide"

        return Response({"result": result}, status=status.HTTP_200_OK)


def _looks_like_grpc_error(exc: Exception) -> bool:
    if exc.__class__.__module__.startswith("grpc"):
        return True
    return hasattr(exc, "code") and hasattr(exc, "details")


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

    @action(detail=True, methods=['post'], url_path='clean')
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

    @action(detail=True, methods=['post'], url_path='clean-walls')
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

    @action(detail=True, methods=['post'], url_path='change-background')
    def change_background(self, request, pk=None):
        plan = self.get_object()
        file_obj = request.FILES.get('background_file')
        if not file_obj:
            return Response({"error": "Aucun fichier fourni."}, status=status.HTTP_400_BAD_REQUEST)

        extension = os.path.splitext(file_obj.name)[1].lower()
        background_type = 'pdf' if extension == '.pdf' else 'image'

        plan.background_file = file_obj
        plan.background_type = background_type
        plan.cleaned_background_file = None
        plan.use_cleaned_background = False
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

    @action(detail=True, methods=['post'], url_path='grok-clean')
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
        preset = "evacuation"
        if isinstance(request.data, dict):
            if "background_color" in request.data:
                background_color = str(request.data["background_color"]).strip() or "#FFFFFF"
            if "preset" in request.data:
                preset = str(request.data["preset"]).strip() or "evacuation"

        job = GrokCleaningJob.objects.create(
            user=request.user,
            plan=plan,
            status=GrokCleaningJob.STATUS_PENDING,
            target_background_color=background_color,
            preset=preset,
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
        return Response(serialize_grok_cleaning_job(job), status=status.HTTP_200_OK)

    @action(detail=True, methods=['get'], url_path='cleaning-history')
    def cleaning_history(self, request, pk=None):
        plan = self.get_object()
        history = PlanCleaningHistory.objects.filter(
            user=request.user,
            plan=plan,
        )
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
                label=icon_data.get('label', ''),
                anchor_x=icon_data.get('anchor_x'),
                anchor_y=icon_data.get('anchor_y'),
                leader_width=icon_data.get('leader_width', 2.0),
                framed=icon_data.get('framed', False),
                flip_x=icon_data.get('flip_x', False),
                flip_y=icon_data.get('flip_y', False),
            )
            icon.save()
            created_icons.append(icon)

        serializer = PlanIconSerializer(created_icons, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

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
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = PlanIconSerializer

    def get_queryset(self):
        return PlanIcon.objects.filter(plan__user=self.request.user)
