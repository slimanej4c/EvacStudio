import json


PLAN_CLEANING_LIST_FIELDS = (
    "outer_walls",
    "interior_walls",
    "openings",
    "doors",
    "windows",
    "machines",
    "obstacles",
    "texts",
    "dimensions",
    "objects_to_keep",
    "objects_to_remove",
    "ambiguities",
    "critical_constraints",
)


PLAN_CLEANING_DEFAULT_OPTIONS = {
    "remove_text": False,
    "remove_dimensions": False,
    "correct_perspective": False,
    "keep_machines": True,
    "keep_obstacles": True,
    "keep_doors": True,
    "keep_windows": True,
    "wall_thickness": "medium",
    "output_style": "clean_architectural_plan",
    "quality": "high",
}


SENSITIVE_OPTION_KEYS = {
    "api_key",
    "apikey",
    "openai_api_key",
    "authorization",
    "token",
    "secret",
}


ANALYSIS_SECTIONS = (
    "murs",
    "ouvertures",
    "machines",
    "objets",
    "texte",
    "annotations",
    "qualite",
    "perspective",
    "ambiguites",
)


OPTION_LABELS = {
    "qualite": "niveau de qualite",
    "conserver_machines": "conserver les machines",
    "supprimer_texte": "supprimer le texte",
    "supprimer_dimensions": "supprimer les dimensions",
    "corriger_perspective": "corriger la perspective",
    "epaisseur_murs": "epaisseur des murs",
}


def _normalize_mapping(value, name):
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise TypeError(f"{name} doit etre un dictionnaire.")
    return value


def _normalize_plan_cleaning_analysis(analysis):
    normalized = _normalize_mapping(analysis, "analysis").copy()
    for field in PLAN_CLEANING_LIST_FIELDS:
        value = normalized.get(field, [])
        if value is None:
            value = []
        if not isinstance(value, list):
            raise TypeError(f"analysis['{field}'] doit etre une liste.")
        normalized[field] = value

    if "perspective_correction_needed" not in normalized:
        normalized["perspective_correction_needed"] = False
    normalized["perspective_correction_needed"] = bool(normalized["perspective_correction_needed"])
    normalized["image_type"] = normalized.get("image_type") or "unknown_plan"
    return normalized


def _normalize_plan_cleaning_options(options):
    normalized = PLAN_CLEANING_DEFAULT_OPTIONS.copy()
    supplied_options = _normalize_mapping(options, "options")
    for key, value in supplied_options.items():
        if key.lower() not in SENSITIVE_OPTION_KEYS:
            normalized[key] = value
    return normalized


def _format_value(value):
    if isinstance(value, bool):
        return "oui" if value else "non"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    if value is None:
        return "non precise"
    return str(value)


def _describe_items(items):
    if not items:
        return "None detected."

    lines = []
    for index, item in enumerate(items, start=1):
        if isinstance(item, dict):
            parts = []
            for key in sorted(item.keys()):
                value = item[key]
                if value in (None, "", [], {}):
                    continue
                parts.append(f"{key}: {_format_value(value)}")
            description = "; ".join(parts) if parts else "unspecified item"
        else:
            description = _format_value(item)
        lines.append(f"{index}. {description}")
    return "\n".join(lines)


def _append_section(prompt_parts, title, items):
    prompt_parts.append(f"{title}:")
    prompt_parts.append(_describe_items(items))
    prompt_parts.append("")


def _count_items(value):
    if isinstance(value, list):
        return len(value)
    if isinstance(value, dict):
        return 1 if value else 0
    return 1 if value else 0


def _summarize_collection(section_name, value):
    if isinstance(value, list):
        if not value:
            return f"- {section_name}: aucun element detecte."
        lines = [f"- {section_name}: {len(value)} element(s) detecte(s)."]
        for index, item in enumerate(value, start=1):
            lines.append(f"  {index}. {_format_value(item)}")
        return "\n".join(lines)

    if isinstance(value, dict):
        if not value:
            return f"- {section_name}: non renseigne."
        return f"- {section_name}: {_format_value(value)}"

    if value:
        return f"- {section_name}: {_format_value(value)}"
    return f"- {section_name}: non renseigne."


def _build_option_instructions(options):
    instructions = []

    if "conserver_machines" in options:
        instructions.append(
            "- Conserver les machines et equipements techniques."
            if options["conserver_machines"]
            else "- Les machines peuvent etre simplifiees ou supprimees si elles genent la lecture."
        )

    if options.get("supprimer_texte"):
        instructions.append("- Supprimer les textes detectes hors informations indispensables.")

    if options.get("supprimer_dimensions"):
        instructions.append("- Supprimer les cotes, mesures et dimensions visibles.")

    if options.get("corriger_perspective"):
        instructions.append("- Corriger la perspective du plan si l'analyse indique une deformation.")

    if options.get("epaisseur_murs") is not None:
        instructions.append(f"- Harmoniser les murs avec une epaisseur {_format_value(options['epaisseur_murs'])}.")

    if options.get("qualite"):
        instructions.append(f"- Viser une qualite de nettoyage {_format_value(options['qualite'])}.")

    for key, value in sorted(options.items()):
        if key not in OPTION_LABELS:
            label = key.replace("_", " ")
            instructions.append(f"- Option utilisateur: {label} = {_format_value(value)}.")

    return instructions


def build_plan_cleaning_prompt(
    analysis: dict,
    options: dict,
    user_instructions: str | None = None
) -> str:
    normalized_analysis = _normalize_plan_cleaning_analysis(analysis)
    normalized_options = _normalize_plan_cleaning_options(options)

    if user_instructions is not None and not isinstance(user_instructions, str):
        raise TypeError("user_instructions doit etre une chaine ou None.")

    remove_targets = []
    if normalized_options.get("remove_text"):
        remove_targets.append("detected texts")
    if normalized_options.get("remove_dimensions"):
        remove_targets.append("visible dimensions and measurement labels")
    remove_targets.extend(_format_value(item) for item in normalized_analysis["objects_to_remove"])

    keep_targets = []
    if normalized_options.get("keep_machines"):
        keep_targets.append("all detected machines at their relative positions")
    if normalized_options.get("keep_obstacles"):
        keep_targets.append("all detected obstacles at their relative positions")
    if normalized_options.get("keep_doors"):
        keep_targets.append("all doors and their openings")
    if normalized_options.get("keep_windows"):
        keep_targets.append("all windows and their openings")
    keep_targets.extend(_format_value(item) for item in normalized_analysis["objects_to_keep"])

    perspective_requested = (
        bool(normalized_options.get("correct_perspective"))
        and normalized_analysis["perspective_correction_needed"]
    )

    prompt_parts = [
        "Task: clean and redraw the provided evacuation/intervention plan image.",
        f"Detected image type: {_format_value(normalized_analysis['image_type'])}.",
        f"Requested output style: {_format_value(normalized_options.get('output_style'))}.",
        f"Requested quality: {_format_value(normalized_options.get('quality'))}.",
        "",
        "Global rules:",
        "- Use the original image as the primary reference.",
        "- Preserve the topology and all spatial relationships.",
        "- Preserve all exterior and interior walls.",
        "- Preserve every opening at its relative position.",
        "- Do not close any existing opening.",
        "- Do not invent walls, rooms, doors, windows, machines, obstacles, or equipment.",
        "- Do not move preserved machines or preserved obstacles.",
        "- Correct only visual defects in the drawing.",
        "- Straighten irregular lines while preserving geometry.",
        f"- {'Correct perspective because it is requested and needed.' if perspective_requested else 'Do not apply perspective correction.'}",
        f"- Use uniform wall thickness: {_format_value(normalized_options.get('wall_thickness'))}.",
        "- Remove only the elements explicitly selected by the user.",
        "- Produce a strict top-down plan view.",
        "- Produce a white background with black linework.",
        "- Do not produce any title, decoration, watermark, logo, legend, frame, or ornamental element.",
        "",
    ]

    _append_section(prompt_parts, "Exterior walls to preserve", normalized_analysis["outer_walls"])
    _append_section(prompt_parts, "Interior walls to preserve", normalized_analysis["interior_walls"])
    _append_section(prompt_parts, "Openings to preserve at relative positions", normalized_analysis["openings"])
    _append_section(prompt_parts, "Doors to preserve", normalized_analysis["doors"])
    _append_section(prompt_parts, "Windows to preserve", normalized_analysis["windows"])
    _append_section(prompt_parts, "Machines to preserve", normalized_analysis["machines"] if normalized_options.get("keep_machines") else [])
    _append_section(prompt_parts, "Obstacles to preserve", normalized_analysis["obstacles"] if normalized_options.get("keep_obstacles") else [])

    prompt_parts.append("Elements to remove:")
    prompt_parts.append(_describe_items(remove_targets))
    prompt_parts.append("")

    prompt_parts.append("Additional elements to keep:")
    prompt_parts.append(_describe_items(keep_targets))
    prompt_parts.append("")

    if normalized_analysis["texts"] and not normalized_options.get("remove_text"):
        _append_section(prompt_parts, "Texts detected but not selected for removal", normalized_analysis["texts"])
    elif normalized_options.get("remove_text"):
        _append_section(prompt_parts, "Texts selected for removal", normalized_analysis["texts"])

    if normalized_analysis["dimensions"] and not normalized_options.get("remove_dimensions"):
        _append_section(prompt_parts, "Dimensions detected but not selected for removal", normalized_analysis["dimensions"])
    elif normalized_options.get("remove_dimensions"):
        _append_section(prompt_parts, "Dimensions selected for removal", normalized_analysis["dimensions"])

    _append_section(prompt_parts, "Ambiguities detected", normalized_analysis["ambiguities"])
    if normalized_analysis["ambiguities"]:
        prompt_parts.append(
            "Preserve the ambiguous area as closely as possible to the source image and do not complete missing geometry without sufficient visual evidence."
        )
        prompt_parts.append("")

    _append_section(prompt_parts, "Critical constraints", normalized_analysis["critical_constraints"])

    if user_instructions and user_instructions.strip():
        prompt_parts.append("Additional user instructions:")
        prompt_parts.append(user_instructions.strip())
        prompt_parts.append("")

    return "\n".join(part for part in prompt_parts if part is not None).strip()


def build_final_prompt(analyse_json, options_utilisateur=None):
    analysis = _normalize_mapping(analyse_json, "analyse_json")
    options = _normalize_mapping(options_utilisateur, "options_utilisateur")

    detected_sections = [
        section for section in ANALYSIS_SECTIONS
        if section in analysis and _count_items(analysis[section]) > 0
    ]
    missing_sections = [section for section in ANALYSIS_SECTIONS if section not in analysis]

    prompt_parts = [
        "Tu es un assistant specialise dans le nettoyage de plans d'intervention et d'evacuation.",
        "Construis les instructions de nettoyage a partir de l'analyse fournie et des options utilisateur.",
        "Ne genere pas d'image dans cette etape.",
        "Retourne une reponse exploitable pour une etape de traitement ulterieure.",
        "",
        "Synthese dynamique de l'analyse:",
    ]

    if detected_sections:
        prompt_parts.append(f"Sections detectees: {', '.join(detected_sections)}.")
    else:
        prompt_parts.append("Aucune section exploitable n'a ete detectee dans l'analyse.")

    if missing_sections:
        prompt_parts.append(f"Sections absentes: {', '.join(missing_sections)}.")

    for section in ANALYSIS_SECTIONS:
        if section in analysis:
            prompt_parts.append(_summarize_collection(section, analysis[section]))

    option_instructions = _build_option_instructions(options)
    prompt_parts.extend(["", "Options utilisateur:"])
    if option_instructions:
        prompt_parts.extend(option_instructions)
    else:
        prompt_parts.append("- Aucune option specifique fournie.")

    if analysis.get("ambiguites"):
        prompt_parts.extend([
            "",
            "Traitement des ambiguites:",
            "- Ne pas inventer les elements incertains.",
            "- Preserver les zones ambigues si leur suppression risque d'enlever une information utile.",
        ])

    if isinstance(analysis.get("qualite"), dict) and analysis["qualite"].get("problemes"):
        prompt_parts.extend([
            "",
            "Points de qualite a prioriser:",
            f"- {_format_value(analysis['qualite']['problemes'])}",
        ])

    return "\n".join(prompt_parts)
