import base64
import json
import os
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Any

from openai import OpenAI
from PIL import Image, ImageOps, UnidentifiedImageError


DEFAULT_PLAN_ANALYSIS_MODEL = "gpt-5"
DEFAULT_PLAN_ANALYSIS_TIMEOUT_SECONDS = 90
PROMPT_START = "Edit the supplied source image into a clean black-and-white top-down architectural floor plan."
EXISTING_PLAN_PROMPT_START = "Clean this existing architectural floor plan and convert it into a simplified black-and-white floor plan suitable as the base for an evacuation plan."
REQUIRED_PROMPT_SENTENCES = (
    "The supplied source image is the authoritative geometric reference.",
    "Preserve the exact visible topology and relative spatial relationships.",
    "Do not redesign the building.",
    "Do not invent, add, remove, close or relocate any wall, opening, door, machine or obstacle unless explicitly requested.",
    "Use the source image together with the geometric description below.",
    "Preserve ambiguous areas as closely as possible to the source image. Do not complete missing geometry without sufficient visual evidence.",
    "Return only the cleaned floor-plan image, with no explanation or text.",
)
REQUIRED_ANALYSIS_FIELDS = (
    "image_type",
    "overall_shape",
    "outer_perimeter_description",
    "interior_walls",
    "openings",
    "doors",
    "windows",
    "machines",
    "obstacles",
    "elements_to_remove",
    "elements_to_keep",
    "perspective_issues",
    "ambiguous_areas",
    "critical_constraints",
    "generation_prompt",
)
REQUIRED_EXISTING_PLAN_ANALYSIS_FIELDS = (
    "image_type",
    "structure_summary",
    "geometry_to_preserve",
    "elements_to_remove",
    "elements_to_keep",
    "simplification_level",
    "visual_noise_level",
    "critical_constraints",
    "generation_prompt",
)
LIST_FIELDS = (
    "interior_walls",
    "openings",
    "doors",
    "windows",
    "machines",
    "obstacles",
    "elements_to_remove",
    "elements_to_keep",
    "perspective_issues",
    "ambiguous_areas",
    "critical_constraints",
)
EXISTING_PLAN_LIST_FIELDS = (
    "geometry_to_preserve",
    "elements_to_remove",
    "elements_to_keep",
    "critical_constraints",
)
RELATIVE_POSITIONS = (
    "top-left",
    "top-center",
    "top-right",
    "middle-left",
    "center",
    "middle-right",
    "bottom-left",
    "bottom-center",
    "bottom-right",
)
RELATION_TERMS = (
    "attached to",
    "extending inward",
    "starting from",
    "separated from",
    "open toward",
    "connected to",
    "continuous",
)


class PlanAnalyzerError(Exception):
    error_code = "ANALYSIS_FAILED"

    def __init__(self, message: str, diagnostic: str | None = None, error_code: str | None = None):
        super().__init__(message)
        self.diagnostic = diagnostic or message
        self.error_code = error_code or self.__class__.error_code


class InvalidPlanAnalysisResponseError(PlanAnalyzerError):
    pass


class MissingPlanAnalyzerAPIKeyError(PlanAnalyzerError):
    pass


@dataclass
class PlanAnalysisResult:
    analysis: dict
    generation_prompt: str
    model: str
    warnings: list[str] = field(default_factory=list)
    status: str = "success"


def _get_model() -> str:
    return os.environ.get("OPENAI_PLAN_ANALYSIS_MODEL", DEFAULT_PLAN_ANALYSIS_MODEL)


def _get_timeout_seconds() -> int:
    raw_value = os.environ.get("OPENAI_PLAN_ANALYSIS_TIMEOUT_SECONDS")
    if not raw_value:
        return DEFAULT_PLAN_ANALYSIS_TIMEOUT_SECONDS
    try:
        return int(raw_value)
    except ValueError:
        return DEFAULT_PLAN_ANALYSIS_TIMEOUT_SECONDS


def _read_image_bytes(image: Any) -> tuple[bytes, str]:
    if isinstance(image, bytes):
        return image, "plan.png"

    if isinstance(image, (str, Path)):
        path = Path(image)
        return path.read_bytes(), path.name or "plan.png"

    name = getattr(image, "name", "plan.png") or "plan.png"
    if hasattr(image, "seek"):
        image.seek(0)
    content = image.read()
    if hasattr(image, "seek"):
        image.seek(0)
    return content, Path(name).name or "plan.png"


def _prepare_image_data_url(image: Any) -> str:
    image_bytes, _ = _read_image_bytes(image)
    try:
        with Image.open(BytesIO(image_bytes)) as opened:
            corrected = ImageOps.exif_transpose(opened)
            corrected.load()
            output = BytesIO()
            image_format = (opened.format or "PNG").upper()
            if image_format not in {"PNG", "JPEG", "WEBP"}:
                image_format = "PNG"
            corrected.save(output, format=image_format)
            mime = "image/jpeg" if image_format == "JPEG" else f"image/{image_format.lower()}"
            encoded = base64.b64encode(output.getvalue()).decode("ascii")
            return f"data:{mime};base64,{encoded}"
    except (UnidentifiedImageError, OSError) as exc:
        raise InvalidPlanAnalysisResponseError("Image source illisible.") from exc


def _build_options_text(options: dict) -> str:
    if not isinstance(options, dict):
        raise TypeError("options doit etre un dictionnaire.")

    safe_options = {
        "keep_machines": bool(options.get("keep_machines", True)),
        "keep_obstacles": bool(options.get("keep_obstacles", True)),
        "remove_text": bool(options.get("remove_text", False)),
        "remove_dimensions": bool(options.get("remove_dimensions", False)),
        "correct_perspective": bool(options.get("correct_perspective", False)),
        "preserve_openings": bool(options.get("preserve_openings", True)),
        "wall_thickness": options.get("wall_thickness", "medium"),
        "user_instructions": options.get("user_instructions") or "",
    }
    return json.dumps(safe_options, ensure_ascii=False, sort_keys=True)


def _build_existing_plan_options_text(options: dict) -> str:
    if not isinstance(options, dict):
        raise TypeError("options doit etre un dictionnaire.")

    safe_options = {
        "remove_dimensions": bool(options.get("remove_dimensions", True)),
        "remove_annotations": bool(options.get("remove_annotations", True)),
        "remove_title_block": bool(options.get("remove_title_block", True)),
        "remove_hatching": bool(options.get("remove_hatching", True)),
        "remove_furniture": bool(options.get("remove_furniture", True)),
        "preserve_doors": bool(options.get("preserve_doors", True)),
        "preserve_stairs": bool(options.get("preserve_stairs", True)),
        "preserve_openings": bool(options.get("preserve_openings", True)),
        "simplify_rendering": bool(options.get("simplify_rendering", True)),
        "cleanup_level": options.get("cleanup_level", "moyen"),
        "quality": options.get("quality", "medium"),
        "user_instructions": options.get("user_instructions") or "",
    }
    return json.dumps(safe_options, ensure_ascii=False, sort_keys=True)


def _required_prompt_rules() -> str:
    # The sentences below are the exact ones _validate_generation_prompt looks for.
    # Asking for them verbatim keeps the instruction and the validation in step —
    # they had drifted apart, and the model's natural phrasing was being rejected.
    verbatim_sentences = " ".join(REQUIRED_PROMPT_SENTENCES)
    return (
        "The generation_prompt must be in English and must include these sections exactly: "
        "Visible geometry to preserve:, Elements to remove:, Critical constraints:. "
        "It must state that the source image is the authoritative geometric reference, preserve exact visible topology "
        "and relative spatial relationships, preserve all walls and openings, never close an opening, never create a new wall, "
        "remove only requested elements, use uniform wall thickness, use a pure white background with black lines, "
        "and add no text, evacuation symbols, furniture, title, decoration or watermark. "
        "The generation_prompt must also contain these sentences verbatim, word for word: "
        f"{verbatim_sentences}"
    )


def _build_analysis_instruction(options: dict) -> str:
    return (
        "You are an expert in interpreting hand-drawn architectural and industrial floor-plan sketches. "
        "Analyze the supplied image carefully before writing the generation prompt. "
        "Your task is not to redesign the building. "
        "First identify the visible outer perimeter, interior walls, openings, doors, windows, machines, obstacles, "
        "handwritten notes, dimensions, perspective distortion and ambiguous areas. "
        "Then write a detailed image-editing prompt tailored specifically to the supplied image. "
        "The prompt must describe the actual visible geometry using relative positions such as top-left, top-center, top-right, "
        "middle-left, center, middle-right, bottom-left, bottom-center and bottom-right. "
        "Do not invent precise dimensions. Do not invent rooms, walls, openings, doors, windows, machines or obstacles that are not visible. "
        "The generated prompt must preserve the exact visible topology and spatial relationships. "
        "The source image will be supplied separately to the image-generation model, so refer to it as the authoritative geometric reference. "
        "Return only valid structured JSON matching the required schema. "
        "Perform two operations in this same response: analyze the visible geometry of this specific plan, then write generation_prompt. "
        "Do not return generic categories only. Describe concrete layout details and relations such as attached to, extending inward, "
        "starting from, separated from, connected to, continuous, or open toward. "
        "The generation_prompt must start exactly with: "
        f"{PROMPT_START} "
        f"{_required_prompt_rules()} "
        "If an area is ambiguous, tell the image model to preserve it as closely as possible without completing missing geometry. "
        f"User options: {_build_options_text(options)}"
    )


def _build_existing_plan_analysis_instruction(options: dict) -> str:
    return (
        "You are an expert in cleaning existing architectural floor plans exported from AutoCAD, PDF or raster images. "
        "This is not a hand-drawn sketch reconstruction task. The supplied plan is already architectural. "
        "Analyze the supplied image carefully and identify the real building geometry, exterior walls, interior partitions, doors, openings, stairs, "
        "circulation areas, dimensions, technical annotations, hatching, title block, furniture, unnecessary symbols and visual clutter. "
        "Then write a detailed image-editing prompt tailored to this exact image. "
        "The prompt must preserve the source geometry with maximum fidelity and must not redesign, reinterpret, invent rooms, move walls, close openings, "
        "or transform the drawing into an imaginary plan. "
        "Describe concrete visible elements using relative positions such as top-left, top-center, top-right, middle-left, center, middle-right, "
        "bottom-left, bottom-center and bottom-right. "
        "Return only valid structured JSON matching the required schema. "
        "The generation_prompt must start exactly with: "
        f"{EXISTING_PLAN_PROMPT_START} "
        "The generation_prompt must be in English and must include these sections exactly: "
        "Geometry to preserve:, Elements to remove:, Elements to keep:, Critical constraints:. "
        "It must state that the source image is the authoritative geometric reference, preserve the exact building geometry and layout, "
        "preserve exterior and interior walls, preserve doors/openings/stairs according to options, remove only selected clutter, "
        "use a clean white background with clear black architectural lines, add no evacuation symbols, title, watermark, textures or decorative elements, "
        "and output only the cleaned floor-plan image. "
        f"User options: {_build_existing_plan_options_text(options)}"
    )


def _response_schema() -> dict:
    string_list_schema = {
        "type": "array",
        "items": {"type": "string"},
    }
    wall_schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["position", "orientation", "description"],
        "properties": {
            "position": {"type": "string"},
            "orientation": {"type": "string"},
            "description": {"type": "string"},
        },
    }
    positioned_item_schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["position", "description"],
        "properties": {
            "position": {"type": "string"},
            "description": {"type": "string"},
        },
    }
    machine_schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["position", "shape", "description"],
        "properties": {
            "position": {"type": "string"},
            "shape": {"type": "string"},
            "description": {"type": "string"},
        },
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": list(REQUIRED_ANALYSIS_FIELDS),
        "properties": {
            "image_type": {"type": "string"},
            "overall_shape": {"type": "string"},
            "outer_perimeter_description": {"type": "string"},
            "interior_walls": {"type": "array", "items": wall_schema},
            "openings": {"type": "array", "items": positioned_item_schema},
            "doors": {"type": "array", "items": positioned_item_schema},
            "windows": {"type": "array", "items": positioned_item_schema},
            "machines": {"type": "array", "items": machine_schema},
            "obstacles": {"type": "array", "items": positioned_item_schema},
            "elements_to_remove": string_list_schema,
            "elements_to_keep": string_list_schema,
            "perspective_issues": string_list_schema,
            "ambiguous_areas": string_list_schema,
            "critical_constraints": string_list_schema,
            "generation_prompt": {"type": "string"},
        },
    }


def _existing_plan_response_schema() -> dict:
    string_list_schema = {
        "type": "array",
        "items": {"type": "string"},
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": list(REQUIRED_EXISTING_PLAN_ANALYSIS_FIELDS),
        "properties": {
            "image_type": {"type": "string"},
            "structure_summary": {"type": "string"},
            "geometry_to_preserve": string_list_schema,
            "elements_to_remove": string_list_schema,
            "elements_to_keep": string_list_schema,
            "simplification_level": {"type": "string"},
            "visual_noise_level": {"type": "string"},
            "critical_constraints": string_list_schema,
            "generation_prompt": {"type": "string"},
        },
    }


def _extract_output_text(response: Any) -> str:
    output_text = getattr(response, "output_text", None)
    if output_text:
        return output_text

    output_items = getattr(response, "output", None) or []
    for output_item in output_items:
        for content_item in getattr(output_item, "content", []) or []:
            text = getattr(content_item, "text", None)
            if text:
                return text
            if isinstance(content_item, dict) and content_item.get("text"):
                return content_item["text"]

    raise InvalidPlanAnalysisResponseError("Réponse OpenAI sans texte structuré.")


def _validate_list_field(analysis: dict, field: str) -> None:
    if not isinstance(analysis[field], list):
        raise InvalidPlanAnalysisResponseError(f"Champ {field} invalide.")


def _validate_generation_prompt(prompt: str, analysis: dict) -> None:
    if not isinstance(prompt, str) or not prompt.strip():
        raise InvalidPlanAnalysisResponseError(
            "Prompt final absent.",
            diagnostic="generation_prompt_empty",
            error_code="PROMPT_INVALID",
        )
    if len(prompt.strip()) < 500:
        raise InvalidPlanAnalysisResponseError(
            "Prompt final trop générique.",
            diagnostic="generation_prompt_too_short",
            error_code="PROMPT_INVALID",
        )
    if not prompt.startswith(PROMPT_START):
        raise InvalidPlanAnalysisResponseError(
            "Prompt final avec introduction invalide.",
            diagnostic="generation_prompt_invalid_start",
            error_code="PROMPT_INVALID",
        )

    geometry_terms = " ".join(
        str(item)
        for field in ("interior_walls", "openings", "machines", "obstacles")
        for item in analysis[field]
    ).lower()
    geometry_terms = f"{analysis['outer_perimeter_description']} {geometry_terms}".lower()
    prompt_lower = prompt.lower()
    prompt_normalized = prompt_lower.replace(":", " ").replace("-", " ")
    required_prompt_concepts = {
        "visible_geometry_to_preserve": (
            "visible geometry to preserve",
            "geometry to preserve",
            "preserve the exact layout",
            "preserve the exact visible topology",
            "preserve the topology",
        ),
        "elements_to_remove": (
            "elements to remove",
            "remove",
            "remove all",
            "remove only",
            "do not add",
            "no extra",
        ),
        "critical_constraints": (
            "critical constraints",
            "constraints",
            "requirements",
            "must",
            "never",
            "do not",
        ),
        "authoritative_reference": (
            "authoritative geometric reference",
            "source image is the authoritative",
            "authoritative reference",
            "source image",
            "original image",
            "supplied image",
            "reference image",
        ),
        "no_redesign": (
            "do not redesign",
            "not redesign",
            "preserve the exact visible topology",
            "preserve the exact layout",
            "keep all walls",
            "preserve all walls",
        ),
        "no_invention": (
            "do not invent",
            "never invent",
            "not invent",
            "do not add",
            "never add",
            "add no",
            "no extra",
            "no new",
            "without adding",
            "do not create",
            "never create",
        ),
    }
    for diagnostic, accepted_phrases in required_prompt_concepts.items():
        if not any(phrase in prompt_normalized for phrase in accepted_phrases):
            raise InvalidPlanAnalysisResponseError(
                f"Prompt final incomplet: missing_prompt_part:{diagnostic}",
                diagnostic=f"missing_prompt_part:{diagnostic}",
                error_code="PROMPT_INVALID",
            )

    if not any(position in geometry_terms or position in prompt_lower for position in RELATIVE_POSITIONS):
        raise InvalidPlanAnalysisResponseError(
            "Description géométrique trop générique.",
            diagnostic="missing_relative_position",
            error_code="PROMPT_INVALID",
        )
    if not any(term in geometry_terms or term in prompt_lower for term in RELATION_TERMS):
        raise InvalidPlanAnalysisResponseError(
            "Relations géométriques insuffisantes.",
            diagnostic="missing_spatial_relation",
            error_code="PROMPT_INVALID",
        )

    if not analysis["outer_perimeter_description"].strip():
        raise InvalidPlanAnalysisResponseError(
            "Périmètre extérieur absent.",
            diagnostic="missing_outer_perimeter_description",
            error_code="PROMPT_INVALID",
        )

    populated_geometry_sections = [
        field for field in ("interior_walls", "openings", "machines", "obstacles")
        if analysis[field]
    ]
    if len(populated_geometry_sections) < 1:
        raise InvalidPlanAnalysisResponseError(
            "Analyse géométrique insuffisamment concrète.",
            diagnostic="missing_concrete_geometry_sections",
            error_code="PROMPT_INVALID",
        )


def _validate_analysis(analysis: dict) -> None:
    if not isinstance(analysis, dict):
        raise InvalidPlanAnalysisResponseError("Analyse non structurée.")

    missing_fields = [field for field in REQUIRED_ANALYSIS_FIELDS if field not in analysis]
    if missing_fields:
        raise InvalidPlanAnalysisResponseError("Analyse incomplète.")

    for field in LIST_FIELDS:
        _validate_list_field(analysis, field)

    for field in ("image_type", "overall_shape", "outer_perimeter_description"):
        if not isinstance(analysis[field], str):
            raise InvalidPlanAnalysisResponseError(f"Champ {field} invalide.")

    _validate_generation_prompt(analysis["generation_prompt"], analysis)


def _validate_existing_plan_generation_prompt(prompt: str, analysis: dict) -> None:
    if not isinstance(prompt, str) or not prompt.strip():
        raise InvalidPlanAnalysisResponseError(
            "Prompt final absent.",
            diagnostic="generation_prompt_empty",
            error_code="PROMPT_INVALID",
        )
    if len(prompt.strip()) < 500:
        raise InvalidPlanAnalysisResponseError(
            "Prompt final trop générique.",
            diagnostic="generation_prompt_too_short",
            error_code="PROMPT_INVALID",
        )
    if not prompt.startswith(EXISTING_PLAN_PROMPT_START):
        raise InvalidPlanAnalysisResponseError(
            "Prompt final avec introduction invalide.",
            diagnostic="existing_plan_generation_prompt_invalid_start",
            error_code="PROMPT_INVALID",
        )

    prompt_normalized = prompt.lower().replace(":", " ").replace("-", " ")
    required_prompt_concepts = {
        "geometry_to_preserve": (
            "geometry to preserve",
            "preserve the exact building geometry",
            "preserve the exact layout",
            "preserve all exterior and interior walls",
        ),
        "elements_to_remove": (
            "elements to remove",
            "remove dimensions",
            "remove technical annotations",
            "remove only selected",
        ),
        "elements_to_keep": (
            "elements to keep",
            "preserve doors",
            "preserve openings",
            "preserve stairs",
        ),
        "critical_constraints": (
            "critical constraints",
            "do not redesign",
            "do not reinterpret",
            "do not invent",
            "do not add evacuation symbols",
            "add no evacuation symbols",
            "no evacuation symbols",
            "do not add evacuation pictograms",
            "add no evacuation pictograms",
            "no evacuation pictograms",
            "do not add pictograms",
            "add no pictograms",
            "no pictograms",
            "do not add evacuation icons",
            "add no evacuation icons",
            "no evacuation icons",
            "do not add safety symbols",
            "add no safety symbols",
            "no safety symbols",
            "do not add symbols",
            "add no symbols",
            "no symbols",
        ),
        "authoritative_reference": (
            "source image is the authoritative",
            "authoritative geometric reference",
            "source image",
            "original image",
        ),
    }
    for diagnostic, accepted_phrases in required_prompt_concepts.items():
        if not any(phrase in prompt_normalized for phrase in accepted_phrases):
            raise InvalidPlanAnalysisResponseError(
                f"Prompt final incomplet: missing_existing_prompt_part:{diagnostic}",
                diagnostic=f"missing_existing_prompt_part:{diagnostic}",
                error_code="PROMPT_INVALID",
            )

    concrete_geometry = " ".join(analysis["geometry_to_preserve"]).lower()
    if not concrete_geometry.strip():
        raise InvalidPlanAnalysisResponseError(
            "Géométrie à préserver absente.",
            diagnostic="missing_geometry_to_preserve",
            error_code="PROMPT_INVALID",
        )
    if not any(position in concrete_geometry or position in prompt_normalized for position in RELATIVE_POSITIONS):
        raise InvalidPlanAnalysisResponseError(
            "Description géométrique trop générique.",
            diagnostic="missing_relative_position",
            error_code="PROMPT_INVALID",
        )


def _validate_existing_plan_analysis(analysis: dict) -> None:
    if not isinstance(analysis, dict):
        raise InvalidPlanAnalysisResponseError("Analyse non structurée.")

    missing_fields = [field for field in REQUIRED_EXISTING_PLAN_ANALYSIS_FIELDS if field not in analysis]
    if missing_fields:
        raise InvalidPlanAnalysisResponseError("Analyse de plan existant incomplète.")

    for field in EXISTING_PLAN_LIST_FIELDS:
        _validate_list_field(analysis, field)

    for field in ("image_type", "structure_summary", "simplification_level", "visual_noise_level"):
        if not isinstance(analysis[field], str):
            raise InvalidPlanAnalysisResponseError(f"Champ {field} invalide.")

    _validate_existing_plan_generation_prompt(analysis["generation_prompt"], analysis)


def _parse_response_json(output_text: str) -> dict:
    try:
        parsed = json.loads(output_text)
    except json.JSONDecodeError as exc:
        raise InvalidPlanAnalysisResponseError("Réponse OpenAI non JSON.") from exc
    _validate_analysis(parsed)
    return parsed


def _parse_existing_plan_response_json(output_text: str) -> dict:
    try:
        parsed = json.loads(output_text)
    except json.JSONDecodeError as exc:
        raise InvalidPlanAnalysisResponseError("Réponse OpenAI non JSON.") from exc
    _validate_existing_plan_analysis(parsed)
    return parsed


def analyze_plan_and_build_prompt(
    image,
    options,
    api_key,
) -> PlanAnalysisResult:
    if not api_key or not str(api_key).strip():
        raise MissingPlanAnalyzerAPIKeyError("Clé API OpenAI absente.")

    model = _get_model()
    timeout = _get_timeout_seconds()
    image_data_url = _prepare_image_data_url(image)
    client = OpenAI(api_key=api_key, timeout=timeout)

    response = client.responses.create(
        model=model,
        input=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": _build_analysis_instruction(options),
                    },
                    {
                        "type": "input_image",
                        "image_url": image_data_url,
                        "detail": "high",
                    },
                ],
            }
        ],
        text={
            "format": {
                "type": "json_schema",
                "name": "plan_analysis_with_cleaning_prompt",
                "schema": _response_schema(),
                "strict": True,
            }
        },
        timeout=timeout,
    )

    analysis = _parse_response_json(_extract_output_text(response))
    return PlanAnalysisResult(
        analysis=analysis,
        generation_prompt=analysis["generation_prompt"],
        model=model,
        warnings=[],
        status="success",
    )


def analyze_existing_plan_and_build_prompt(
    image,
    options,
    api_key,
) -> PlanAnalysisResult:
    if not api_key or not str(api_key).strip():
        raise MissingPlanAnalyzerAPIKeyError("Clé API OpenAI absente.")

    model = _get_model()
    timeout = _get_timeout_seconds()
    image_data_url = _prepare_image_data_url(image)
    client = OpenAI(api_key=api_key, timeout=timeout)

    response = client.responses.create(
        model=model,
        input=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": _build_existing_plan_analysis_instruction(options),
                    },
                    {
                        "type": "input_image",
                        "image_url": image_data_url,
                        "detail": "high",
                    },
                ],
            }
        ],
        text={
            "format": {
                "type": "json_schema",
                "name": "existing_plan_cleanup_analysis_with_prompt",
                "schema": _existing_plan_response_schema(),
                "strict": True,
            }
        },
        timeout=timeout,
    )

    analysis = _parse_existing_plan_response_json(_extract_output_text(response))
    return PlanAnalysisResult(
        analysis=analysis,
        generation_prompt=analysis["generation_prompt"],
        model=model,
        warnings=[],
        status="success",
    )
