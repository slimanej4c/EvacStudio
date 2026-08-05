import logging
from dataclasses import dataclass, field

from openai import APIStatusError, AuthenticationError

from .image_generator import (
    GeneratedImageSaveError,
    InvalidAPIKeyError,
    MissingAPIKeyError,
    PlanImageGenerationError,
)
from .cleaning_profiles import normalize_cleanup_level, normalize_quality, resolve_profile
from .plan_analyzer import (
    EXISTING_PLAN_PROMPT_CONCEPTS,
    SKETCH_PROMPT_CONCEPTS,
    PlanAnalyzerError,
    PlanAnalysisResult,
    analyze_existing_plan_and_build_prompt,
    analyze_plan_and_build_prompt,
    analyze_with_profile,
)
from .plan_image_generator import (
    generate_cleaned_plan,
    get_saved_openai_api_key,
    read_generated_image_bytes,
)


logger = logging.getLogger(__name__)


class OpenAIPlanCleaningPipelineError(Exception):
    user_message = "Erreur pendant le nettoyage OpenAI."
    error_code = "OPENAI_PIPELINE_FAILED"

    def __init__(self, diagnostic: str | None = None, error_code: str | None = None):
        super().__init__(self.user_message)
        self.diagnostic = diagnostic or self.__class__.__name__
        self.error_code = error_code or self.__class__.error_code


class InvalidGeneratedPromptError(OpenAIPlanCleaningPipelineError):
    user_message = "L'analyse OpenAI n'a pas produit d'instructions assez spécifiques pour générer le plan."
    error_code = "PROMPT_INVALID"


@dataclass
class OpenAIPlanCleaningResult:
    analysis: dict
    generation_prompt: str
    original_image_bytes: bytes
    cleaned_image_bytes: bytes
    analysis_model: str
    image_model: str
    quality: str
    generated_image_path: str
    warnings: list[str] = field(default_factory=list)
    status: str = "success"


def _normalize_pipeline_options(options: dict, user_instructions: str | None = None) -> dict:
    options = options or {}
    cleaning_mode = options.get("cleaning_mode", "sketch_to_plan")
    if cleaning_mode not in {"sketch_to_plan", "existing_plan_cleanup"}:
        cleaning_mode = "sketch_to_plan"
    normalized = {
        "cleaning_mode": cleaning_mode,
        "quality": options.get("quality", options.get("qualite", "medium")),
        "keep_machines": bool(options.get("keep_machines", options.get("conserver_machines", True))),
        "keep_obstacles": bool(options.get("keep_obstacles", options.get("conserver_machines", True))),
        "remove_text": bool(options.get("remove_text", options.get("supprimer_texte", False))),
        "remove_dimensions": bool(options.get("remove_dimensions", options.get("supprimer_dimensions", False))),
        "correct_perspective": bool(options.get("correct_perspective", options.get("corriger_perspective", False))),
        "preserve_openings": bool(options.get("preserve_openings", options.get("conserver_ouvertures", True))),
        "wall_thickness": options.get("wall_thickness", options.get("epaisseur_murs", "medium")),
        "plan_type": options.get("plan_type") or options.get("confirmed_plan_type") or "architectural_plan",
        "remove_existing_pictograms": bool(options.get("remove_existing_pictograms", options.get("supprimer_pictogrammes", True))),
        "remove_routes": bool(options.get("remove_routes", options.get("supprimer_itineraires", True))),
        "remove_you_are_here": bool(options.get("remove_you_are_here", options.get("supprimer_vous_etes_ici", True))),
        "remove_legend": bool(options.get("remove_legend", options.get("supprimer_legende", True))),
        "remove_logos": bool(options.get("remove_logos", options.get("supprimer_logos", True))),
        "remove_paper_shadows": bool(options.get("remove_paper_shadows", options.get("supprimer_ombres_papier", False))),
        "straighten_lines": bool(options.get("straighten_lines", options.get("redresser_lignes", False))),
        "reduce_visual_noise": bool(options.get("reduce_visual_noise", options.get("reduire_bruit", True))),
        "keep_room_labels": bool(options.get("keep_room_labels", options.get("conserver_noms_locaux", True))),
        "preserve_windows": bool(options.get("preserve_windows", options.get("conserver_fenetres", True))),
        "remove_annotations": bool(options.get("remove_annotations", options.get("supprimer_annotations", True))),
        "remove_title_block": bool(options.get("remove_title_block", options.get("supprimer_cartouche", True))),
        "remove_hatching": bool(options.get("remove_hatching", options.get("supprimer_hachures", True))),
        "remove_furniture": bool(options.get("remove_furniture", options.get("supprimer_mobilier", True))),
        "preserve_doors": bool(options.get("preserve_doors", options.get("conserver_portes", True))),
        "preserve_stairs": bool(options.get("preserve_stairs", options.get("conserver_escaliers", True))),
        "simplify_rendering": bool(options.get("simplify_rendering", options.get("simplifier_rendu", True))),
        "cleanup_level": options.get("cleanup_level", options.get("niveau_nettoyage", "moyen")),
    }
    normalized["user_instructions"] = user_instructions or options.get("user_instructions") or ""
    normalized["cleanup_level"] = normalize_cleanup_level(normalized["cleanup_level"])
    normalized["quality"] = normalize_quality(normalized["quality"])

    # Resolve the cleaning family once, here, so every downstream step agrees on it.
    profile_key = options.get("cleaning_profile") or options.get("profil_nettoyage")
    if profile_key or options.get("plan_type"):
        try:
            profile = resolve_profile(normalized["plan_type"], profile_key)
        except ValueError:
            profile = None
        if profile is not None:
            normalized["_profile"] = profile
            normalized["cleaning_profile"] = profile.key
            normalized["objective"] = profile.objective
            # The family's own default level applies unless the user picked one.
            if not (options.get("cleanup_level") or options.get("niveau_nettoyage")):
                normalized["cleanup_level"] = profile.default_cleanup_level
            # Options the family does not expose must not leak into its prompt.
            for key, value in profile.default_options.items():
                normalized.setdefault(key, value)
    return normalized


def _prompt_mentions_detected_items(analysis: dict, prompt: str) -> bool:
    prompt_lower = prompt.lower()
    relative_positions = {
        "top-left",
        "top-center",
        "top-right",
        "middle-left",
        "center",
        "middle-right",
        "bottom-left",
        "bottom-center",
        "bottom-right",
    }
    detected_positions = set()
    detected_text = analysis.get("outer_perimeter_description", "")
    for field in ("interior_walls", "openings", "machines", "obstacles"):
        for item in analysis.get(field, []):
            position = item.get("position") if isinstance(item, dict) else ""
            description = item.get("description") if isinstance(item, dict) else str(item)
            if isinstance(position, str):
                detected_positions.add(position.lower())
            if isinstance(description, str):
                detected_text = f"{detected_text} {description}"

    detected_positions.update(position for position in relative_positions if position in detected_text.lower())
    if detected_positions and any(position in prompt_lower for position in detected_positions):
        return True

    geometry_terms = (
        "perimeter",
        "wall",
        "walls",
        "partition",
        "opening",
        "openings",
        "passage",
        "door",
        "window",
        "machine",
        "obstacle",
        "top-down",
        "floor plan",
        "layout",
        "topology",
    )
    return any(term in prompt_lower for term in geometry_terms)


def _prompt_contains_any(prompt: str, phrases: tuple[str, ...]) -> bool:
    prompt_normalized = prompt.lower().replace(":", " ").replace("-", " ")
    return any(phrase in prompt_normalized for phrase in phrases)


def validate_generation_prompt_for_image_model(analysis_result: PlanAnalysisResult) -> None:
    analysis = analysis_result.analysis
    prompt = analysis_result.generation_prompt or ""
    prompt_lower = prompt.lower()

    if "geometry_to_preserve" in analysis:
        if len(prompt.strip()) < 500:
            raise InvalidGeneratedPromptError("generation_prompt_too_short")
        # Reuses the analyzer's table: a prompt the analyzer accepted must never
        # be rejected here. The two lists used to be written separately and drifted,
        # which is what made OpenAI cleaning fail intermittently.
        required_concepts = EXISTING_PLAN_PROMPT_CONCEPTS
        for diagnostic, phrases in required_concepts.items():
            if not _prompt_contains_any(prompt, phrases):
                raise InvalidGeneratedPromptError(f"missing_existing_prompt_concept:{diagnostic}")
        if not analysis.get("geometry_to_preserve"):
            raise InvalidGeneratedPromptError("missing_geometry_to_preserve")
        return

    if len(prompt.strip()) < 500:
        raise InvalidGeneratedPromptError("generation_prompt_too_short")
    if not analysis.get("outer_perimeter_description", "").strip():
        raise InvalidGeneratedPromptError("missing_outer_perimeter_description")
    if analysis.get("openings") and not _prompt_contains_any(prompt, ("opening", "gap", "passage", "doorway")):
        raise InvalidGeneratedPromptError("missing_openings_in_prompt")
    required_concepts = SKETCH_PROMPT_CONCEPTS
    for diagnostic, phrases in required_concepts.items():
        if not _prompt_contains_any(prompt, phrases):
            raise InvalidGeneratedPromptError(f"missing_prompt_concept:{diagnostic}")
    if not _prompt_mentions_detected_items(analysis, prompt):
        raise InvalidGeneratedPromptError("prompt_does_not_reference_detected_geometry")


def _analysis_error_code(exc: Exception) -> str:
    explicit_error_code = getattr(exc, "error_code", None)
    if explicit_error_code:
        return explicit_error_code
    if isinstance(exc, (AuthenticationError, InvalidAPIKeyError, MissingAPIKeyError)):
        return "OPENAI_KEY_INVALID"
    if isinstance(exc, APIStatusError) and getattr(exc, "status_code", None) == 401:
        return "OPENAI_KEY_INVALID"
    if isinstance(exc, InvalidGeneratedPromptError):
        return exc.error_code
    if isinstance(exc, PlanAnalyzerError):
        return "ANALYSIS_FAILED"
    return "ANALYSIS_FAILED"


def _image_generation_error_code(exc: Exception) -> str:
    if isinstance(exc, (InvalidAPIKeyError, MissingAPIKeyError, AuthenticationError)):
        return "OPENAI_KEY_INVALID"
    if isinstance(exc, GeneratedImageSaveError):
        return "IMAGE_SAVE_FAILED"
    if isinstance(exc, PlanImageGenerationError):
        return "IMAGE_GENERATION_FAILED"
    return "IMAGE_GENERATION_FAILED"


def clean_plan_with_openai(
    source_image,
    user,
    options,
    user_instructions=None,
    *,
    plan=None,
    status_callback=None,
) -> OpenAIPlanCleaningResult:
    normalized_options = _normalize_pipeline_options(options, user_instructions)
    plan_id = getattr(plan, "id", None)
    user_id = getattr(user, "id", None)

    logger.info("openai_clean.pipeline.started", extra={"user_id": user_id, "plan_id": plan_id})

    try:
        logger.info("openai_clean.key.lookup.started", extra={"user_id": user_id, "plan_id": plan_id})
        api_key = get_saved_openai_api_key(user)
        logger.info("openai_clean.key.lookup.succeeded", extra={"user_id": user_id, "plan_id": plan_id})
    except Exception as exc:
        logger.exception("openai_clean.key.lookup.failed", extra={"user_id": user_id, "plan_id": plan_id})
        raise OpenAIPlanCleaningPipelineError("saved_key_unavailable", "OPENAI_KEY_INVALID") from exc

    try:
        logger.info("openai_clean.analysis.started", extra={"user_id": user_id, "plan_id": plan_id})
        if status_callback:
            status_callback("analyzing")
        # The family decides the whole prompt. Falling back to the legacy modes only
        # when no profile was resolved keeps older jobs working.
        profile = normalized_options.get("_profile")
        if profile is not None:
            analysis_result = analyze_with_profile(source_image, profile, normalized_options, api_key)
        elif normalized_options["cleaning_mode"] == "existing_plan_cleanup":
            analysis_result = analyze_existing_plan_and_build_prompt(source_image, normalized_options, api_key)
        else:
            analysis_result = analyze_plan_and_build_prompt(source_image, normalized_options, api_key)
        logger.info(
            "openai_clean.analysis.succeeded",
            extra={
                "user_id": user_id,
                "plan_id": plan_id,
                "analysis_model": analysis_result.model,
                "prompt_length": len(analysis_result.generation_prompt or ""),
            },
        )
    except Exception as exc:
        error_code = _analysis_error_code(exc)
        diagnostic = getattr(exc, "diagnostic", exc.__class__.__name__)
        logger.exception(
            "openai_clean.analysis.failed code=%s diagnostic=%s",
            error_code,
            diagnostic,
            extra={"user_id": user_id, "plan_id": plan_id, "error_code": error_code, "diagnostic": diagnostic},
        )
        raise OpenAIPlanCleaningPipelineError(getattr(exc, "diagnostic", exc.__class__.__name__), error_code) from exc

    try:
        logger.info("openai_clean.prompt_validation.started", extra={"user_id": user_id, "plan_id": plan_id})
        validate_generation_prompt_for_image_model(analysis_result)
        if status_callback:
            status_callback("prompt_ready")
        logger.info("openai_clean.prompt_validation.succeeded", extra={"user_id": user_id, "plan_id": plan_id})
    except InvalidGeneratedPromptError as exc:
        logger.warning(
            "openai_clean.prompt_validation.failed code=%s diagnostic=%s",
            exc.error_code,
            exc.diagnostic,
            extra={"user_id": user_id, "plan_id": plan_id, "error_code": exc.error_code, "diagnostic": exc.diagnostic},
        )
        raise

    try:
        logger.info("openai_clean.image_generation.started", extra={"user_id": user_id, "plan_id": plan_id})
        if status_callback:
            status_callback("generating")
        selected_quality = normalized_options.get("quality", "medium")
        generated_result = generate_cleaned_plan(
            source_image,
            analysis_result.generation_prompt,
            user,
            quality=selected_quality,
            plan=plan,
        )
        logger.info(
            "openai_clean.image_generation.succeeded",
            extra={"user_id": user_id, "plan_id": plan_id, "image_model": generated_result.model},
        )
    except Exception as exc:
        error_code = _image_generation_error_code(exc)
        logger.exception("openai_clean.image_generation.failed", extra={"user_id": user_id, "plan_id": plan_id, "error_code": error_code})
        raise OpenAIPlanCleaningPipelineError(getattr(exc, "diagnostic", exc.__class__.__name__), error_code) from exc

    try:
        logger.info("openai_clean.image_save.read_started", extra={"user_id": user_id, "plan_id": plan_id})
        if status_callback:
            status_callback("saving_result")
        cleaned_image_bytes = read_generated_image_bytes(generated_result)
        logger.info("openai_clean.image_save.read_succeeded", extra={"user_id": user_id, "plan_id": plan_id})
    except OSError as exc:
        logger.exception("openai_clean.image_save.read_failed", extra={"user_id": user_id, "plan_id": plan_id, "error_code": "IMAGE_SAVE_FAILED"})
        raise OpenAIPlanCleaningPipelineError("generated_image_file_unreadable", "IMAGE_SAVE_FAILED") from exc

    logger.info("openai_clean.pipeline.succeeded", extra={"user_id": user_id, "plan_id": plan_id})

    return OpenAIPlanCleaningResult(
        analysis=analysis_result.analysis,
        generation_prompt=analysis_result.generation_prompt,
        original_image_bytes=source_image,
        cleaned_image_bytes=cleaned_image_bytes,
        analysis_model=analysis_result.model,
        image_model=generated_result.model,
        quality=generated_result.quality,
        generated_image_path=generated_result.image_path,
        warnings=[*analysis_result.warnings, *generated_result.warnings],
        status="success",
    )
