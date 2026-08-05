"""Step 1 of the OpenAI cleaning flow: what kind of plan did the user import?

The cleaning instructions that follow depend entirely on this answer — a
hand-drawn sketch, a CAD export and an already-finished evacuation plan need
opposite treatments. Guessing wrong is worse than asking, so the classifier is
told to fall back to `unknown_or_mixed` rather than commit to a shaky guess.
"""

import json
import os
from dataclasses import dataclass, field
from typing import Any

from openai import OpenAI

from .plan_analyzer import _prepare_image_data_url


DEFAULT_DETECTION_MODEL = "gpt-5"
DEFAULT_DETECTION_TIMEOUT_SECONDS = 60

#: Below this, the classifier must answer `unknown_or_mixed` and the user confirms.
CONFIDENCE_CONFIRMATION_THRESHOLD = 0.70

from .cleaning_profiles import (  # noqa: E402  (kept next to its siblings)
    CLEANUP_LEVELS as CLEANING_LEVELS,
    PLAN_TYPES,
    QUALITY_LEVELS,
    describe_profile,
    profiles_for_plan_type,
)

DETECTED_ELEMENT_KEYS = (
    "handwriting",
    "paper_background",
    "shadows",
    "perspective_distortion",
    "dimensions",
    "dimension_lines",
    "room_labels",
    "furniture",
    "hatching",
    "title_block",
    "stairs",
    "doors",
    "openings",
    "windows",
    "machines",
    "obstacles",
    "technical_symbols",
    "evacuation_icons",
    "evacuation_routes",
    "you_are_here",
    "legend",
    "logos",
)

RECOMMENDED_OPTION_KEYS = (
    "remove_paper_background",
    "remove_shadows",
    "remove_handwriting",
    "correct_perspective",
    "straighten_lines",
    "remove_dimensions",
    "remove_dimension_lines",
    "remove_title_block",
    "remove_hatching",
    "remove_furniture",
    "remove_technical_symbols",
    "remove_evacuation_icons",
    "remove_evacuation_routes",
    "remove_you_are_here",
    "remove_legend",
    "remove_logos",
    "keep_room_labels",
    "keep_machines",
    "keep_obstacles",
    "preserve_doors",
    "preserve_openings",
    "preserve_stairs",
    "preserve_windows",
)

#: Detector vocabulary -> the option names the cleaning pipeline understands.
#: Several detector keys collapse onto one pipeline option; any of them turns it on.
RECOMMENDED_OPTION_TO_CLEANING_OPTION = {
    "remove_paper_background": "remove_paper_shadows",
    "remove_shadows": "remove_paper_shadows",
    "remove_handwriting": "remove_annotations",
    "remove_technical_symbols": "remove_annotations",
    "correct_perspective": "correct_perspective",
    "straighten_lines": "straighten_lines",
    "remove_dimensions": "remove_dimensions",
    "remove_dimension_lines": "remove_dimensions",
    "remove_title_block": "remove_title_block",
    "remove_hatching": "remove_hatching",
    "remove_furniture": "remove_furniture",
    "remove_evacuation_icons": "remove_existing_pictograms",
    "remove_evacuation_routes": "remove_routes",
    "remove_you_are_here": "remove_you_are_here",
    "remove_legend": "remove_legend",
    "remove_logos": "remove_logos",
    "keep_room_labels": "keep_room_labels",
    "keep_machines": "keep_machines",
    "keep_obstacles": "keep_obstacles",
    "preserve_doors": "preserve_doors",
    "preserve_openings": "preserve_openings",
    "preserve_stairs": "preserve_stairs",
    "preserve_windows": "preserve_windows",
}


class PlanTypeDetectionError(Exception):
    error_code = "DETECTION_FAILED"

    def __init__(self, message: str, diagnostic: str | None = None, error_code: str | None = None):
        super().__init__(message)
        self.diagnostic = diagnostic or message
        self.error_code = error_code or self.__class__.error_code


@dataclass
class PlanTypeDetection:
    plan_type: str
    confidence: float
    summary: str
    image_quality: str
    readability: str
    detected_elements: dict
    recommended_cleaning_level: str
    recommended_options: dict
    model: str
    needs_confirmation: bool = False
    warnings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "plan_type": self.plan_type,
            "confidence": self.confidence,
            "summary": self.summary,
            "image_quality": self.image_quality,
            "readability": self.readability,
            "detected_elements": self.detected_elements,
            "available_profiles": [
                describe_profile(profile, self.as_cleaning_options())
                for profile in profiles_for_plan_type(self.plan_type)
            ],
            "recommended_cleaning_level": self.recommended_cleaning_level,
            "recommended_options": self.recommended_options,
            "cleaning_options": self.as_cleaning_options(),
            "needs_confirmation": self.needs_confirmation,
            "model": self.model,
            "warnings": self.warnings,
        }

    def as_cleaning_options(self) -> dict:
        """Recommendations translated into the names the cleaning pipeline uses."""
        cleaning_options: dict[str, bool] = {}
        for detector_key, value in (self.recommended_options or {}).items():
            pipeline_key = RECOMMENDED_OPTION_TO_CLEANING_OPTION.get(detector_key)
            if not pipeline_key:
                continue
            # Collapsed keys are OR'd: remove_shadows alone is enough to strip the paper.
            cleaning_options[pipeline_key] = bool(cleaning_options.get(pipeline_key)) or bool(value)
        return cleaning_options


def _get_model() -> str:
    return os.environ.get("OPENAI_PLAN_DETECTION_MODEL", DEFAULT_DETECTION_MODEL)


def _get_timeout_seconds() -> int:
    raw_value = os.environ.get("OPENAI_PLAN_DETECTION_TIMEOUT_SECONDS")
    if not raw_value:
        return DEFAULT_DETECTION_TIMEOUT_SECONDS
    try:
        return int(raw_value)
    except ValueError:
        return DEFAULT_DETECTION_TIMEOUT_SECONDS


def _detection_schema() -> dict:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "plan_type",
            "confidence",
            "summary",
            "image_quality",
            "readability",
            "detected_elements",
            "recommended_cleaning_level",
            "recommended_options",
            "warnings",
        ],
        "properties": {
            "plan_type": {"type": "string", "enum": list(PLAN_TYPES)},
            "confidence": {"type": "number"},
            "summary": {"type": "string"},
            "image_quality": {"type": "string", "enum": list(QUALITY_LEVELS)},
            "readability": {"type": "string", "enum": list(QUALITY_LEVELS)},
            "detected_elements": {
                "type": "object",
                "additionalProperties": False,
                "required": list(DETECTED_ELEMENT_KEYS),
                "properties": {key: {"type": "boolean"} for key in DETECTED_ELEMENT_KEYS},
            },
            "recommended_cleaning_level": {"type": "string", "enum": list(CLEANING_LEVELS)},
            "recommended_options": {
                "type": "object",
                "additionalProperties": False,
                "required": list(RECOMMENDED_OPTION_KEYS),
                "properties": {key: {"type": "boolean"} for key in RECOMMENDED_OPTION_KEYS},
            },
            "warnings": {"type": "array", "items": {"type": "string"}},
        },
    }


def _build_detection_instruction() -> str:
    return (
        "You are an expert visual classifier of architectural, technical and evacuation plans.\n\n"
        "Carefully inspect the supplied source image.\n\n"
        "Your task is only to:\n\n"
        "1. determine the type of plan;\n"
        "2. identify the visible elements;\n"
        "3. recommend suitable cleaning options.\n\n"
        "Classify the image as exactly one of:\n\n"
        "- hand_drawn_sketch\n"
        "- clear_architectural_plan\n"
        "- noisy_architectural_plan\n"
        "- existing_evacuation_plan\n"
        "- unknown_or_mixed\n\n"
        "Definitions:\n\n"
        "hand_drawn_sketch:\n"
        "A rough plan drawn manually with a pen or pencil, usually containing irregular lines, "
        "handwriting, paper texture, shadows or camera perspective.\n\n"
        "clear_architectural_plan:\n"
        "An architectural, technical or CAD-style plan that is sharp and legible. Straight clean "
        "lines, readable labels, no significant noise. It may contain dimensions, room labels, "
        "furniture, hatching, technical symbols or a title block.\n\n"
        "noisy_architectural_plan:\n"
        "The same kind of plan, but degraded: a poor scan or photograph, faint or broken lines, "
        "speckles, stains, skew, low contrast, or text that is hard to read. Choose this whenever "
        "an automated cleaning would struggle to tell a wall from an artefact.\n\n"
        "existing_evacuation_plan:\n"
        "A plan already containing evacuation pictograms, directional arrows, evacuation routes, "
        "“You are here” markers, legends, safety equipment or company logos.\n\n"
        "unknown_or_mixed:\n"
        "The type cannot be identified reliably, the image is unclear, or several incompatible "
        "plan types are combined.\n\n"
        "Also rate the source itself, independently of its type:\n"
        "- image_quality: how good the capture is (sharpness, contrast, exposure);\n"
        "- readability: how easily walls, doors and labels can be told apart.\n"
        "Use low, medium or high for both. A plan can be well drawn but badly photographed.\n\n"
        "Detect only elements actually visible in the source image.\n\n"
        "Do not invent rooms, walls, doors, stairs, machines, dimensions, pictograms or other "
        "elements.\n\n"
        "If confidence is below 0.70, return plan_type as unknown_or_mixed.\n\n"
        "Return only valid JSON. Do not return Markdown, explanations or code fences."
    )


def _extract_output_text(response: Any) -> str:
    output_text = getattr(response, "output_text", None)
    if output_text:
        return output_text

    for output_item in getattr(response, "output", None) or []:
        for content_item in getattr(output_item, "content", []) or []:
            text = getattr(content_item, "text", None)
            if text:
                return text
            if isinstance(content_item, dict) and content_item.get("text"):
                return content_item["text"]

    raise PlanTypeDetectionError(
        "Réponse OpenAI sans texte structuré.", diagnostic="detection_response_empty"
    )


def _validate(payload: dict) -> None:
    if not isinstance(payload, dict):
        raise PlanTypeDetectionError("Détection non structurée.", diagnostic="detection_not_object")

    if payload.get("plan_type") not in PLAN_TYPES:
        raise PlanTypeDetectionError(
            "Type de plan inconnu.", diagnostic="detection_unknown_plan_type"
        )

    confidence = payload.get("confidence")
    if not isinstance(confidence, (int, float)) or not 0 <= float(confidence) <= 1:
        raise PlanTypeDetectionError(
            "Indice de confiance invalide.", diagnostic="detection_invalid_confidence"
        )

    if payload.get("recommended_cleaning_level") not in CLEANING_LEVELS:
        raise PlanTypeDetectionError(
            "Niveau de nettoyage recommandé invalide.",
            diagnostic="detection_invalid_cleaning_level",
        )

    elements = payload.get("detected_elements")
    if not isinstance(elements, dict):
        raise PlanTypeDetectionError(
            "Éléments détectés absents.", diagnostic="detection_missing_elements"
        )

    missing = [key for key in DETECTED_ELEMENT_KEYS if key not in elements]
    if missing:
        raise PlanTypeDetectionError(
            "Éléments détectés incomplets.",
            diagnostic=f"detection_incomplete_elements:{','.join(missing)}",
        )


def detect_plan_type(image: Any, api_key: str) -> PlanTypeDetection:
    if not api_key or not str(api_key).strip():
        raise PlanTypeDetectionError(
            "Clé API OpenAI absente.", diagnostic="missing_api_key", error_code="OPENAI_KEY_INVALID"
        )

    model = _get_model()
    timeout = _get_timeout_seconds()
    client = OpenAI(api_key=api_key, timeout=timeout)

    response = client.responses.create(
        model=model,
        input=[
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": _build_detection_instruction()},
                    {
                        "type": "input_image",
                        "image_url": _prepare_image_data_url(image),
                        "detail": "high",
                    },
                ],
            }
        ],
        text={
            "format": {
                "type": "json_schema",
                "name": "plan_type_detection",
                "schema": _detection_schema(),
                "strict": True,
            }
        },
        timeout=timeout,
    )

    try:
        payload = json.loads(_extract_output_text(response))
    except json.JSONDecodeError as exc:
        raise PlanTypeDetectionError(
            "Réponse OpenAI non JSON.", diagnostic="detection_not_json"
        ) from exc

    _validate(payload)

    confidence = float(payload["confidence"])
    plan_type = payload["plan_type"]
    warnings = list(payload.get("warnings") or [])

    # The classifier is asked to answer unknown_or_mixed below the threshold. Enforce
    # it here too rather than trust it: a confident-looking wrong type silently
    # applies the wrong cleaning.
    if confidence < CONFIDENCE_CONFIRMATION_THRESHOLD and plan_type != "unknown_or_mixed":
        warnings.append(
            f"Type ramené à unknown_or_mixed : confiance {confidence:.2f} sous le seuil de "
            f"{CONFIDENCE_CONFIRMATION_THRESHOLD:.2f}."
        )
        plan_type = "unknown_or_mixed"

    return PlanTypeDetection(
        plan_type=plan_type,
        confidence=confidence,
        summary=payload.get("summary", ""),
        image_quality=payload.get("image_quality", "medium"),
        readability=payload.get("readability", "medium"),
        detected_elements=payload["detected_elements"],
        recommended_cleaning_level=payload["recommended_cleaning_level"],
        recommended_options=payload.get("recommended_options") or {},
        model=model,
        needs_confirmation=(
            confidence < CONFIDENCE_CONFIRMATION_THRESHOLD or plan_type == "unknown_or_mixed"
        ),
        warnings=warnings,
    )
