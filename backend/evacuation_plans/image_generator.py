import base64
import os
import uuid
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Any

from django.conf import settings
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    OpenAI,
    PermissionDeniedError,
    RateLimitError,
)
from PIL import Image, ImageOps, UnidentifiedImageError


ACCEPTED_INPUT_MIME_TYPES = {
    "image/png": "PNG",
    "image/jpeg": "JPEG",
    "image/webp": "WEBP",
}

OUTPUT_MIME_TYPES = {
    "png": "image/png",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
}

QUALITY_ALIASES = {
    "rapide": "low",
    "standard": "medium",
    "haute": "high",
}

ALLOWED_OPENAI_QUALITIES = {"low", "medium", "high"}


class PlanImageGenerationError(Exception):
    user_message = "Erreur pendant la génération du plan."

    def __init__(self, diagnostic: str | None = None):
        super().__init__(self.user_message)
        self.diagnostic = diagnostic or self.__class__.__name__


class MissingAPIKeyError(PlanImageGenerationError):
    user_message = "Clé API OpenAI absente."


class InvalidAPIKeyError(PlanImageGenerationError):
    user_message = "Clé API OpenAI invalide."


class InsufficientCreditsError(PlanImageGenerationError):
    user_message = "Crédit OpenAI insuffisant."


class ModelUnavailableError(PlanImageGenerationError):
    user_message = "Modèle OpenAI inaccessible."


class InvalidImageFormatError(PlanImageGenerationError):
    user_message = "Format d'image invalide."


class ImageTooLargeError(PlanImageGenerationError):
    user_message = "Fichier image trop volumineux."


class OpenAIRequestTimeoutError(PlanImageGenerationError):
    user_message = "La requête OpenAI a expiré."


class OpenAIRateLimitError(PlanImageGenerationError):
    user_message = "Limite de débit OpenAI atteinte."


class OpenAINetworkError(PlanImageGenerationError):
    user_message = "Erreur réseau avec OpenAI."


class OpenAIResponseWithoutImageError(PlanImageGenerationError):
    user_message = "OpenAI n'a retourné aucune image."


class ReturnedImageUnreadableError(PlanImageGenerationError):
    user_message = "L'image générée est illisible."


class GeneratedImageSaveError(PlanImageGenerationError):
    user_message = "Impossible d'enregistrer l'image générée."


class UnknownImageGenerationError(PlanImageGenerationError):
    user_message = "Erreur interne inconnue pendant la génération."


@dataclass
class PreparedSourceImage:
    content: bytes
    filename: str
    mime_type: str
    width: int
    height: int
    openai_size: str
    canvas_width: int
    canvas_height: int
    source_box: tuple[int, int, int, int]
    warnings: list[str] = field(default_factory=list)


@dataclass
class GeneratedPlanResult:
    image_path: str
    mime_type: str
    width: int | None
    height: int | None
    model: str
    status: str
    quality: str = "medium"
    request_id: str | None = None
    warnings: list[str] = field(default_factory=list)
    user_id: int | None = None
    plan_id: int | None = None


def _get_env_int(name: str, default: int) -> int:
    raw_value = os.environ.get(name)
    if not raw_value:
        return default
    try:
        return int(raw_value)
    except ValueError:
        return default


def get_plan_image_model() -> str:
    return os.environ.get("OPENAI_PLAN_IMAGE_MODEL", "gpt-image-1")


def get_request_timeout_seconds() -> int:
    return _get_env_int("OPENAI_REQUEST_TIMEOUT_SECONDS", 120)


def get_max_image_size_mb() -> int:
    return _get_env_int("OPENAI_MAX_IMAGE_SIZE_MB", 25)


def get_plan_output_format() -> str:
    output_format = os.environ.get("OPENAI_PLAN_OUTPUT_FORMAT", "png").lower()
    return output_format if output_format in OUTPUT_MIME_TYPES else "png"


def get_default_quality() -> str:
    quality = os.environ.get("OPENAI_PLAN_DEFAULT_QUALITY", "medium").lower()
    return QUALITY_ALIASES.get(quality, quality if quality in ALLOWED_OPENAI_QUALITIES else "medium")


def _normalize_quality(quality: str | None) -> str:
    if not quality:
        return get_default_quality()
    normalized = QUALITY_ALIASES.get(quality.lower(), quality.lower())
    return normalized if normalized in ALLOWED_OPENAI_QUALITIES else get_default_quality()


def _choose_openai_output_size(width: int, height: int) -> tuple[str, int, int]:
    source_ratio = width / height
    candidates = (
        ("1024x1024", 1024, 1024),
        ("1536x1024", 1536, 1024),
        ("1024x1536", 1024, 1536),
    )
    return min(candidates, key=lambda item: abs((item[1] / item[2]) - source_ratio))


def _pad_to_target_aspect(image: Image.Image, target_width: int, target_height: int) -> tuple[Image.Image, tuple[int, int, int, int]]:
    width, height = image.size
    target_ratio = target_width / target_height
    source_ratio = width / height

    if abs(source_ratio - target_ratio) < 0.01:
        return image, (0, 0, width, height)

    if source_ratio > target_ratio:
        canvas_width = width
        canvas_height = int(round(width / target_ratio))
    else:
        canvas_width = int(round(height * target_ratio))
        canvas_height = height

    left = (canvas_width - width) // 2
    top = (canvas_height - height) // 2
    mode = "RGBA" if image.mode in ("RGBA", "LA") else "RGB"
    canvas = Image.new(mode, (canvas_width, canvas_height), (255, 255, 255, 0) if mode == "RGBA" else "white")
    canvas.paste(image.convert(mode), (left, top))
    return canvas, (left, top, left + width, top + height)


def _read_source_bytes(source_image: Any) -> tuple[bytes, str]:
    if isinstance(source_image, bytes):
        return source_image, "source.png"

    if isinstance(source_image, (str, Path)):
        path = Path(source_image)
        return path.read_bytes(), path.name or "source.png"

    name = getattr(source_image, "name", "source.png") or "source.png"
    if hasattr(source_image, "seek"):
        source_image.seek(0)
    content = source_image.read()
    if hasattr(source_image, "seek"):
        source_image.seek(0)
    return content, Path(name).name or "source.png"


def _detect_mime_type(image: Image.Image) -> str:
    image_format = (image.format or "").upper()
    for mime_type, accepted_format in ACCEPTED_INPUT_MIME_TYPES.items():
        if image_format == accepted_format:
            return mime_type
    return f"image/{image_format.lower()}" if image_format else "application/octet-stream"


def _prepare_source_image(source_image: Any, max_size_mb: int) -> PreparedSourceImage:
    original_bytes, original_filename = _read_source_bytes(source_image)
    if len(original_bytes) > max_size_mb * 1024 * 1024:
        raise ImageTooLargeError("source_image_exceeds_configured_limit")

    try:
        with Image.open(BytesIO(original_bytes)) as opened:
            source_mime_type = _detect_mime_type(opened)
            corrected = ImageOps.exif_transpose(opened)
            corrected.load()
            width, height = corrected.size
            openai_size, target_width, target_height = _choose_openai_output_size(width, height)
            prepared_canvas, source_box = _pad_to_target_aspect(corrected, target_width, target_height)
            canvas_width, canvas_height = prepared_canvas.size

            warnings = []
            was_padded = source_box != (0, 0, width, height)
            if was_padded:
                warnings.append("source_image_padded_to_preserve_full_plan_aspect_ratio")
            if source_mime_type not in ACCEPTED_INPUT_MIME_TYPES:
                warnings.append("source_image_converted_to_png")
                output = BytesIO()
                prepared_canvas.convert("RGBA" if prepared_canvas.mode in ("RGBA", "LA") else "RGB").save(output, format="PNG")
                return PreparedSourceImage(
                    content=output.getvalue(),
                    filename=f"{Path(original_filename).stem or 'source'}.png",
                    mime_type="image/png",
                    width=width,
                    height=height,
                    openai_size=openai_size,
                    canvas_width=canvas_width,
                    canvas_height=canvas_height,
                    source_box=source_box,
                    warnings=warnings,
                )

            if was_padded:
                output = BytesIO()
                prepared_canvas.convert("RGBA" if prepared_canvas.mode in ("RGBA", "LA") else "RGB").save(output, format="PNG")
                return PreparedSourceImage(
                    content=output.getvalue(),
                    filename=f"{Path(original_filename).stem or 'source'}.png",
                    mime_type="image/png",
                    width=width,
                    height=height,
                    openai_size=openai_size,
                    canvas_width=canvas_width,
                    canvas_height=canvas_height,
                    source_box=source_box,
                    warnings=warnings,
                )

            output = BytesIO()
            save_format = ACCEPTED_INPUT_MIME_TYPES[source_mime_type]
            corrected.save(output, format=save_format)
            return PreparedSourceImage(
                content=output.getvalue(),
                filename=original_filename,
                mime_type=source_mime_type,
                width=width,
                height=height,
                openai_size=openai_size,
                canvas_width=canvas_width,
                canvas_height=canvas_height,
                source_box=source_box,
                warnings=warnings,
            )
    except (UnidentifiedImageError, OSError) as exc:
        raise InvalidImageFormatError("source_image_unreadable") from exc


def _build_openai_file(prepared_image: PreparedSourceImage) -> BytesIO:
    image_file = BytesIO(prepared_image.content)
    image_file.name = Path(prepared_image.filename).name
    return image_file


def _extract_request_id(response: Any) -> str | None:
    return getattr(response, "_request_id", None) or getattr(response, "id", None)


def _extract_image_bytes(response: Any) -> bytes:
    data = getattr(response, "data", None) or []
    if not data:
        raise OpenAIResponseWithoutImageError("missing_response_data")

    first_image = data[0]
    b64_json = getattr(first_image, "b64_json", None)
    if not b64_json and isinstance(first_image, dict):
        b64_json = first_image.get("b64_json")
    if not b64_json:
        raise OpenAIResponseWithoutImageError("missing_b64_json")

    try:
        return base64.b64decode(b64_json)
    except ValueError as exc:
        raise OpenAIResponseWithoutImageError("invalid_b64_json") from exc


def _inspect_generated_image(image_bytes: bytes) -> tuple[str, int, int]:
    try:
        with Image.open(BytesIO(image_bytes)) as image:
            image.load()
            mime_type = _detect_mime_type(image)
            if mime_type not in OUTPUT_MIME_TYPES.values():
                mime_type = "image/png"
            return mime_type, image.width, image.height
    except (UnidentifiedImageError, OSError) as exc:
        raise ReturnedImageUnreadableError("generated_image_unreadable") from exc


def _fit_generated_image_to_source_dimensions(
    image_bytes: bytes,
    prepared_image: PreparedSourceImage,
    output_format: str,
) -> bytes:
    try:
        with Image.open(BytesIO(image_bytes)) as generated:
            corrected = ImageOps.exif_transpose(generated)
            corrected.load()
            left, top, right, bottom = prepared_image.source_box
            if prepared_image.canvas_width > 0 and prepared_image.canvas_height > 0:
                scale_x = corrected.width / prepared_image.canvas_width
                scale_y = corrected.height / prepared_image.canvas_height
                crop_box = (
                    max(0, int(round(left * scale_x))),
                    max(0, int(round(top * scale_y))),
                    min(corrected.width, int(round(right * scale_x))),
                    min(corrected.height, int(round(bottom * scale_y))),
                )
                if crop_box[2] > crop_box[0] and crop_box[3] > crop_box[1]:
                    corrected = corrected.crop(crop_box)

            if corrected.size != (prepared_image.width, prepared_image.height):
                corrected = corrected.resize((prepared_image.width, prepared_image.height), Image.Resampling.LANCZOS)

            output = BytesIO()
            save_format = OUTPUT_MIME_TYPES.get(output_format, "image/png").split("/", 1)[1].upper()
            if save_format == "JPEG":
                corrected = corrected.convert("RGB")
            corrected.save(output, format=save_format)
            return output.getvalue()
    except (UnidentifiedImageError, OSError) as exc:
        raise ReturnedImageUnreadableError("generated_image_unreadable") from exc


def _save_generated_image(image_bytes: bytes, output_format: str, user: Any = None, plan: Any = None) -> str:
    storage_dir = Path(settings.MEDIA_ROOT) / "backgrounds_cleaned" / "openai"
    storage_dir.mkdir(parents=True, exist_ok=True)

    user_part = getattr(user, "id", None) or "anonymous"
    plan_part = getattr(plan, "id", None) or "unlinked"
    filename = f"{uuid.uuid4().hex}_{user_part}_{plan_part}.{output_format}"
    path = storage_dir / filename
    path.write_bytes(image_bytes)
    return str(path)


def _map_openai_error(exc: Exception) -> PlanImageGenerationError:
    if isinstance(exc, AuthenticationError):
        return InvalidAPIKeyError("openai_authentication_failed")
    if isinstance(exc, PermissionDeniedError):
        return ModelUnavailableError("openai_model_permission_denied")
    if isinstance(exc, RateLimitError):
        return OpenAIRateLimitError("openai_rate_limit")
    if isinstance(exc, APITimeoutError):
        return OpenAIRequestTimeoutError("openai_timeout")
    if isinstance(exc, APIConnectionError):
        return OpenAINetworkError("openai_network_error")
    if isinstance(exc, BadRequestError):
        return InvalidImageFormatError("openai_bad_request")
    if isinstance(exc, APIStatusError):
        status_code = getattr(exc, "status_code", None)
        if status_code == 401:
            return InvalidAPIKeyError("openai_unauthorized")
        if status_code == 402:
            return InsufficientCreditsError("openai_insufficient_credits")
        if status_code == 403:
            return ModelUnavailableError("openai_forbidden")
        if status_code == 404:
            return ModelUnavailableError("openai_model_not_found")
        if status_code == 429:
            return OpenAIRateLimitError("openai_rate_limit")
        return UnknownImageGenerationError(f"openai_status_{status_code or 'unknown'}")
    return UnknownImageGenerationError("openai_unknown_error")


def generate_cleaned_plan(
    source_image,
    prompt: str,
    api_key: str,
    quality: str = "medium",
    *,
    user=None,
    plan=None,
) -> GeneratedPlanResult:
    if not api_key or not str(api_key).strip():
        raise MissingAPIKeyError("missing_api_key")
    if not prompt or not str(prompt).strip():
        raise ValueError("prompt est obligatoire.")

    model = get_plan_image_model()
    timeout_seconds = get_request_timeout_seconds()
    max_size_mb = get_max_image_size_mb()
    output_format = get_plan_output_format()
    normalized_quality = _normalize_quality(quality)

    prepared_image = _prepare_source_image(source_image, max_size_mb)
    client = OpenAI(api_key=api_key, timeout=timeout_seconds)

    try:
        response = client.images.edit(
            model=model,
            image=_build_openai_file(prepared_image),
            prompt=prompt,
            quality=normalized_quality,
            output_format=output_format,
            size=prepared_image.openai_size,
            n=1,
            input_fidelity="high",
            timeout=timeout_seconds,
        )
    except Exception as exc:
        mapped_error = _map_openai_error(exc)
        raise mapped_error from exc

    generated_bytes = _fit_generated_image_to_source_dimensions(
        _extract_image_bytes(response),
        prepared_image,
        output_format,
    )
    mime_type, width, height = _inspect_generated_image(generated_bytes)
    try:
        image_path = _save_generated_image(generated_bytes, output_format, user=user, plan=plan)
    except OSError as exc:
        raise GeneratedImageSaveError("generated_image_save_failed") from exc

    return GeneratedPlanResult(
        image_path=image_path,
        mime_type=mime_type,
        width=width,
        height=height,
        model=model,
        status="success",
        quality=normalized_quality,
        request_id=_extract_request_id(response),
        warnings=prepared_image.warnings,
        user_id=getattr(user, "id", None),
        plan_id=getattr(plan, "id", None),
    )
