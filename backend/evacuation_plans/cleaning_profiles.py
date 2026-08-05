"""The five prompt families, and how a detected plan type selects one.

A single generic prompt cannot serve every case: turning a pen sketch into a
drawing, tidying a clean CAD export, rescuing a noisy scan, sharpening a finished
evacuation poster and stripping that same poster back to its base are five
different jobs. Two of them are even opposites — enhancement keeps the safety
signage, the empty-base family removes it — so they cannot share directives.

Each profile owns its opening sentence, the sentences the generated prompt must
repeat verbatim, the directives that are always true for that family, and the
options the UI should pre-tick.
"""

from dataclasses import dataclass, field


# ── Objectives ──────────────────────────────────────────────────────────────
OBJECTIVE_TRANSFORM = "transform"
OBJECTIVE_CLEANUP = "cleanup"
OBJECTIVE_ENHANCE = "enhance"
OBJECTIVE_EMPTY_BASE = "empty_base"

# ── Detected plan types ─────────────────────────────────────────────────────
TYPE_SKETCH = "hand_drawn_sketch"
TYPE_CLEAR_ARCHITECTURAL = "clear_architectural_plan"
TYPE_NOISY_ARCHITECTURAL = "noisy_architectural_plan"
TYPE_EXISTING_EVACUATION = "existing_evacuation_plan"
TYPE_UNKNOWN = "unknown_or_mixed"

PLAN_TYPES = (
    TYPE_SKETCH,
    TYPE_CLEAR_ARCHITECTURAL,
    TYPE_NOISY_ARCHITECTURAL,
    TYPE_EXISTING_EVACUATION,
    TYPE_UNKNOWN,
)

PLAN_TYPE_LABELS = {
    TYPE_SKETCH: "Croquis dessiné au stylo",
    TYPE_CLEAR_ARCHITECTURAL: "Plan architectural clair",
    TYPE_NOISY_ARCHITECTURAL: "Plan architectural bruité",
    TYPE_EXISTING_EVACUATION: "Plan d'évacuation existant",
    TYPE_UNKNOWN: "Plan incertain ou mixte",
}

CLEANUP_LEVELS = ("light", "medium", "strong")

CLEANUP_LEVEL_ALIASES = {
    "leger": "light", "léger": "light", "light": "light",
    "moyen": "medium", "medium": "medium",
    "fort": "strong", "renforce": "strong", "renforcé": "strong", "strong": "strong",
}

QUALITY_LEVELS = ("low", "medium", "high")


def normalize_cleanup_level(value: str | None) -> str:
    return CLEANUP_LEVEL_ALIASES.get(str(value or "").strip().lower(), "medium")


def normalize_quality(value: str | None) -> str:
    candidate = str(value or "").strip().lower()
    return candidate if candidate in QUALITY_LEVELS else "medium"


#: Directives that hold for every family without exception. The building is never
#: a candidate for removal, whatever the user ticks.
ALWAYS_PRESERVED = (
    "Always preserve walls, partitions, doors, passages, openings, stairs and circulation "
    "areas: they are the plan itself and are never candidates for removal.",
)


@dataclass(frozen=True)
class CleaningProfile:
    key: str
    label: str
    objective: str
    plan_types: tuple[str, ...]
    prompt_start: str
    required_sentences: tuple[str, ...]
    directives: tuple[str, ...]
    default_options: dict
    default_cleanup_level: str
    #: Shown to the user before launching, when the family carries a real risk.
    warning: str = ""
    #: Options this family exposes in the UI, in display order.
    exposed_options: tuple[str, ...] = field(default_factory=tuple)

    def build_directives(self, options: dict) -> str:
        """Family directives plus the ones the user's choices switch on."""
        parts = [*self.directives]
        for option_key, sentence in OPTION_SENTENCES.items():
            if option_key in self.exposed_options and bool(options.get(option_key)):
                parts.append(sentence)
        parts.extend(ALWAYS_PRESERVED)
        parts.append(CLEANUP_LEVEL_SENTENCES[normalize_cleanup_level(options.get("cleanup_level"))])
        return " ".join(parts)


#: One sentence per switchable option. Only emitted when the family exposes it,
#: so a sketch is never told about a legend it does not have.
OPTION_SENTENCES = {
    "remove_paper_shadows": (
        "Remove the paper texture, the photographic shadows, the glare and the colour cast; "
        "return a flat pure white background."
    ),
    "remove_handwriting": "Remove handwritten notes and annotations.",
    "correct_perspective": (
        "Correct the camera perspective so the plan is seen strictly from above, square to the frame."
    ),
    "straighten_lines": "Straighten the lines: walls must become clean straight segments.",
    "keep_machines": "Keep the machines and fixed equipment that are visible.",
    "keep_obstacles": "Keep the obstacles that are visible.",
    "remove_dimensions": "Remove dimension figures and dimension lines.",
    "remove_title_block": "Remove the title block, company logos, certification marks and footers.",
    "remove_hatching": "Remove decorative hatching and surface textures.",
    "remove_furniture": "Remove furniture and loose equipment drawings.",
    "remove_technical_symbols": "Remove technical symbols that are irrelevant to evacuation.",
    "keep_room_labels": (
        "Keep the short labels that name rooms and technical spaces, horizontal and readable."
    ),
    "remove_text": "Remove every piece of text, including room names.",
    "reduce_visual_noise": (
        "Reduce visual noise: drop faint marks, speckles, stains and scanning artefacts."
    ),
    "remove_existing_pictograms": (
        "Remove every existing evacuation and safety pictogram already drawn on the plan."
    ),
    "remove_routes": (
        "Remove the coloured escape-route paths and every directional evacuation arrow."
    ),
    "remove_you_are_here": "Remove the 'you are here' marker and its position dot.",
    "remove_legend": "Remove the legend, the key and any table of symbols.",
    "remove_logos": "Remove company logos, publisher marks and certification stamps.",
    "keep_pictograms": (
        "Keep every existing evacuation and safety pictogram exactly where it is, at its size and "
        "orientation."
    ),
    "keep_routes": (
        "Keep the escape routes and directional arrows exactly as drawn, including their colour."
    ),
    "keep_you_are_here": "Keep the 'you are here' marker exactly where it is.",
    "keep_legend": "Keep the legend and its entries intact and readable.",
    "sharpen": (
        "Improve sharpness and contrast so thin lines and small symbols become crisp and legible."
    ),
}


CLEANUP_LEVEL_SENTENCES = {
    "light": (
        "Cleanup level is light: change as little as possible. The drawing is already close to "
        "what is needed, so touch only what is clearly unwanted."
    ),
    "medium": (
        "Cleanup level is medium: remove the listed elements and tidy the line work, keeping every "
        "architectural detail."
    ),
    "strong": (
        "Cleanup level is strong: simplify firmly and drop secondary detail, but never at the cost "
        "of a wall, a door, an opening or a staircase."
    ),
}


SHARED_GEOMETRY_SENTENCES = (
    "The supplied source image is the authoritative geometric reference.",
    "Preserve the exact visible topology and relative spatial relationships.",
    "Do not redesign, do not reinterpret and do not invent any part of the building.",
    "Return only the resulting floor-plan image, with no explanation or text.",
)


PROFILES: dict[str, CleaningProfile] = {
    "sketch_to_clean_plan": CleaningProfile(
        key="sketch_to_clean_plan",
        label="Transformer le croquis en plan propre",
        objective=OBJECTIVE_TRANSFORM,
        plan_types=(TYPE_SKETCH,),
        prompt_start=(
            "Redraw the supplied hand-drawn sketch as a clean black-and-white top-down "
            "architectural floor plan."
        ),
        required_sentences=(
            *SHARED_GEOMETRY_SENTENCES,
            "Do not invent, add, remove, close or relocate any wall, opening, door, machine or "
            "obstacle unless explicitly requested.",
            "Preserve ambiguous areas as closely as possible to the source image. Do not complete "
            "missing geometry without sufficient visual evidence.",
        ),
        directives=(
            "The supplied image is a hand-drawn sketch, probably photographed. Interpret it "
            "faithfully and turn it into a clean architectural drawing without inventing anything.",
            "Draw walls as uniform black lines on a pure white background.",
        ),
        default_options={
            "remove_paper_shadows": True,
            "remove_handwriting": True,
            "correct_perspective": True,
            "straighten_lines": True,
            "keep_machines": True,
            "keep_obstacles": True,
            "keep_room_labels": False,
        },
        default_cleanup_level="strong",
        exposed_options=(
            "remove_paper_shadows",
            "remove_handwriting",
            "correct_perspective",
            "straighten_lines",
            "keep_machines",
            "keep_obstacles",
        ),
    ),
    "clear_architectural_plan_cleanup": CleaningProfile(
        key="clear_architectural_plan_cleanup",
        label="Nettoyer et simplifier le plan",
        objective=OBJECTIVE_CLEANUP,
        plan_types=(TYPE_CLEAR_ARCHITECTURAL,),
        prompt_start=(
            "Clean this legible architectural floor plan and simplify it into a black-and-white "
            "base suitable for an evacuation plan."
        ),
        required_sentences=(
            *SHARED_GEOMETRY_SENTENCES,
            "Do not add evacuation symbols, pictograms, safety symbols or icons of any kind.",
        ),
        directives=(
            "The supplied image is an architectural drawing that is already legible. It carries no "
            "safety signage. Simplify it without redrawing the building and without losing detail.",
        ),
        default_options={
            "remove_dimensions": True,
            "remove_title_block": True,
            "remove_hatching": True,
            "remove_furniture": True,
            "remove_technical_symbols": True,
            "keep_room_labels": True,
            "reduce_visual_noise": False,
        },
        default_cleanup_level="light",
        exposed_options=(
            "remove_dimensions",
            "remove_title_block",
            "remove_hatching",
            "remove_furniture",
            "remove_technical_symbols",
            "keep_room_labels",
            "remove_text",
        ),
    ),
    "noisy_architectural_plan_cleanup": CleaningProfile(
        key="noisy_architectural_plan_cleanup",
        label="Nettoyer un plan bruité ou peu lisible",
        objective=OBJECTIVE_CLEANUP,
        plan_types=(TYPE_NOISY_ARCHITECTURAL,),
        prompt_start=(
            "Clean this noisy architectural floor plan and rebuild a legible black-and-white base "
            "suitable for an evacuation plan."
        ),
        required_sentences=(
            *SHARED_GEOMETRY_SENTENCES,
            "Do not add evacuation symbols, pictograms, safety symbols or icons of any kind.",
            "Where the source is unclear, reproduce what is visible rather than guessing a tidier "
            "layout.",
        ),
        directives=(
            "The supplied image is an architectural drawing that is noisy, faint, skewed or poorly "
            "scanned. Recover a legible drawing from it without inventing geometry.",
            "Rebuild broken and faded lines only where the source clearly shows a wall.",
        ),
        default_options={
            "reduce_visual_noise": True,
            "remove_paper_shadows": True,
            "straighten_lines": True,
            "remove_dimensions": True,
            "remove_title_block": True,
            "remove_hatching": True,
            "remove_furniture": True,
            "keep_room_labels": True,
        },
        default_cleanup_level="medium",
        warning=(
            "Sur un plan bruité, un nettoyage renforcé peut modifier ou supprimer de petits "
            "détails. Vérifiez le résultat avant de l'appliquer."
        ),
        exposed_options=(
            "reduce_visual_noise",
            "remove_paper_shadows",
            "straighten_lines",
            "remove_dimensions",
            "remove_title_block",
            "remove_hatching",
            "remove_furniture",
            "remove_technical_symbols",
            "keep_room_labels",
        ),
    ),
    "existing_evacuation_plan_enhancement": CleaningProfile(
        key="existing_evacuation_plan_enhancement",
        label="Améliorer le plan d'évacuation existant",
        objective=OBJECTIVE_ENHANCE,
        plan_types=(TYPE_EXISTING_EVACUATION,),
        prompt_start=(
            "Improve the legibility of this existing evacuation plan without removing any of its "
            "content."
        ),
        required_sentences=(
            *SHARED_GEOMETRY_SENTENCES,
            "This is a visual clean-up only: keep every pictogram, arrow, escape route, marker, "
            "legend entry and label that is present.",
            "Do not empty the plan and do not turn it back into a bare architectural drawing.",
        ),
        directives=(
            "The supplied image is a finished evacuation plan, probably photographed or scanned. "
            "Your job is to make it crisp and clean, not to change what it says.",
            "Remove stains, glare, shadows, colour cast and photographic noise.",
            "Keep the existing colours of the escape routes and of the safety pictograms.",
        ),
        default_options={
            "keep_pictograms": True,
            "keep_routes": True,
            "keep_you_are_here": True,
            "keep_legend": True,
            "keep_room_labels": True,
            "remove_paper_shadows": True,
            "reduce_visual_noise": True,
            "sharpen": True,
            "correct_perspective": True,
        },
        default_cleanup_level="light",
        exposed_options=(
            "remove_paper_shadows",
            "reduce_visual_noise",
            "sharpen",
            "correct_perspective",
            "keep_pictograms",
            "keep_routes",
            "keep_you_are_here",
            "keep_legend",
            "keep_room_labels",
        ),
    ),
    "existing_evacuation_plan_to_empty_base": CleaningProfile(
        key="existing_evacuation_plan_to_empty_base",
        label="Vider le plan et récupérer la base",
        objective=OBJECTIVE_EMPTY_BASE,
        plan_types=(TYPE_EXISTING_EVACUATION,),
        prompt_start=(
            "Strip this existing evacuation plan back to the bare architectural base it was built "
            "on."
        ),
        required_sentences=(
            *SHARED_GEOMETRY_SENTENCES,
            "Do not add evacuation symbols, pictograms, safety symbols or icons of any kind.",
            "Give back a bare architectural base with no safety symbol whatsoever.",
        ),
        directives=(
            "The supplied image is an evacuation plan that has already been produced. Your job is "
            "to strip it back to the architectural base it was built on, so new signage can be "
            "placed on it.",
        ),
        default_options={
            "remove_existing_pictograms": True,
            "remove_routes": True,
            "remove_you_are_here": True,
            "remove_legend": True,
            "remove_logos": True,
            "keep_room_labels": True,
            "reduce_visual_noise": True,
            "remove_text": False,
        },
        default_cleanup_level="medium",
        exposed_options=(
            "remove_existing_pictograms",
            "remove_routes",
            "remove_you_are_here",
            "remove_legend",
            "remove_logos",
            "remove_text",
            "keep_room_labels",
            "reduce_visual_noise",
        ),
    ),
}


#: Which objectives a detected type offers. An evacuation plan is the only case
#: where the user genuinely has to choose, and the two answers are opposites.
OBJECTIVES_BY_PLAN_TYPE = {
    TYPE_SKETCH: ("sketch_to_clean_plan",),
    TYPE_CLEAR_ARCHITECTURAL: ("clear_architectural_plan_cleanup",),
    TYPE_NOISY_ARCHITECTURAL: ("noisy_architectural_plan_cleanup",),
    TYPE_EXISTING_EVACUATION: (
        "existing_evacuation_plan_enhancement",
        "existing_evacuation_plan_to_empty_base",
    ),
    # Nothing is certain here, so offer every family and let the user decide.
    TYPE_UNKNOWN: tuple(PROFILES.keys()),
}


def profiles_for_plan_type(plan_type: str) -> tuple[CleaningProfile, ...]:
    keys = OBJECTIVES_BY_PLAN_TYPE.get(plan_type, OBJECTIVES_BY_PLAN_TYPE[TYPE_UNKNOWN])
    return tuple(PROFILES[key] for key in keys)


def resolve_profile(plan_type: str, profile_key: str | None = None) -> CleaningProfile:
    """The family to use, from the confirmed type and the chosen objective."""
    if profile_key and profile_key in PROFILES:
        return PROFILES[profile_key]

    candidates = profiles_for_plan_type(plan_type)
    if not candidates:
        raise ValueError(f"Aucun profil de nettoyage pour le type {plan_type!r}.")
    return candidates[0]


def describe_profile(profile: CleaningProfile, options: dict | None = None) -> dict:
    """What the UI needs to present the family and pre-tick its options."""
    merged = {**profile.default_options, **(options or {})}
    return {
        "key": profile.key,
        "label": profile.label,
        "objective": profile.objective,
        "plan_types": list(profile.plan_types),
        "default_cleanup_level": profile.default_cleanup_level,
        "warning": profile.warning,
        "exposed_options": list(profile.exposed_options),
        "options": {key: bool(merged.get(key, False)) for key in profile.exposed_options},
    }
