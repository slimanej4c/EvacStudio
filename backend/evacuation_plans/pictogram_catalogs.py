"""Declarative catalogues for bundled safety pictograms.

The filesystem carries the artwork hierarchy while this registry supplies the
stable keys and human labels exposed by the API. Adding another standard only
requires one registry entry and its media directory; the listing and frontend
filters are generic.
"""

import hashlib
import os
import re


PICTOGRAM_CATALOGS = {
    "nfx08070": {
        "label": "NF X 08-070",
        "directory": "nf-x08-070-picto/symboles/svg",
        "root_category": {
            "key": "00-reperage",
            "label": "Repérage",
        },
        "categories": {
            "01-evacuation": "Évacuation et issues",
            "02-alerte": "Alerte et alarme",
            "03-lutte": "Moyens de lutte contre l’incendie",
            "04-secours": "Secours",
            "05-elev": "Élévation",
            "06-eau": "Eau",
            "07-acces": "Accès des secours",
            "08-divers": "Équipements divers",
            "09-appareils": "Appareils de sécurité",
            "10-technique": "Installations techniques",
            "11-produits": "Produits dangereux",
            "12-elec": "Électricité",
            "13-fluides": "Fluides et énergie",
        },
        "subcategories": {
            "3A-extincteurs": "Extincteurs",
            "3B-colonnes": "Colonnes sèches et humides",
        },
    },
    "other": {
        "label": "Autres",
        "directory": "autres-picto/symboles/svg",
        "root_category": {
            "key": "00-autres",
            "label": "Pictogrammes complémentaires",
        },
        "categories": {
            "01-accessibilite": "Accessibilité et assistance",
            "02-evacuation": "Évacuation complémentaire",
            "03-secours": "Secours et communication",
            "04-technique": "Installations techniques complémentaires",
            "05-incendie": "Incendie complémentaire",
        },
        "subcategories": {},
    },
}

PICTOGRAM_LABEL_OVERRIDES = {
    "15-18": "Appel d’urgence — 15 ou 18",
    "air": "Air",
    "cheminement evacuation": "Cheminement d’évacuation — incendie",
    "ear-svgrepo-com": "Accessibilité auditive",
    "escalier 1": "Escalier — quart tournant",
    "escalier 2": "Escalier — double quart tournant",
    "escalier circle": "Escalier hélicoïdal",
    "escalier droit": "Escalier droit",
    "escalier_autocad": "Escalier — représentation technique",
    "evacuation1": "Consigne d’évacuation — sortie",
    "evacuation-2": "Consigne d’évacuation — guide-file",
    "evacuation-3": "Consigne d’évacuation — ne pas utiliser l’ascenseur",
    "fire": "Incendie",
    "icon_11_clean_safe": "Alarme accessible aux personnes sourdes",
    "icon_12_clean_safe": "Pictogramme complémentaire 12",
    "icon_13_clean_safe": "Pictogramme complémentaire 13",
    "icon_15_clean_safe": "Pictogramme complémentaire 15",
    "mege-phone": "Mégaphone",
    "svg-selection(4)": "Mégaphone — variante",
    "telephone_rouge_final_corrige": "Téléphone d’urgence rouge",
    "telephone_vert": "Téléphone d’urgence vert",
    "urgence-01": "Risque de chute",
    "urgence-02": "Assistance auditive",
    "urgence-03": "Évacuation par ascenseur",
    "urgence-05": "Évacuation en présence de fumée",
    "urgence-sourds": "Urgence personnes sourdes — 114",
    "arret-urgence": "Arrêt d’urgence",
    "asc": "Ascenseur",
    "baes": "Bloc autonome d’éclairage de sécurité (BAES)",
    "cmsi": "Centralisateur de mise en sécurité incendie (CMSI)",
    "coupure-bt": "Coupure électricité basse tension",
    "coupure-ht": "Coupure électricité haute tension",
    "dae": "Défibrillateur automatisé externe (DAE)",
    "dm": "Déclencheur manuel",
    "dm-porte": "Dispositif de commande de porte",
    "eas": "Espace d’attente sécurisé",
    "ecs": "Équipement de contrôle et de signalisation (ECS)",
    "elec": "Local électrique",
    "is-fleche": "Issue de secours avec flèche",
    "is-fleche_diag": "Issue de secours avec flèche diagonale",
    "is_d": "Issue de secours — droite",
    "is_g": "Issue de secours — gauche",
    "lsc": "Luminaire sur source centralisée (LSC)",
    "m-charge": "Monte-charge",
    "pharma": "Pharmacie",
    "poteau": "Poteau d’incendie",
    "poteau-incendie": "Poteau d’incendie",
    "bouche": "Bouche d’incendie",
    "barrage-gene": "Barrage général",
    "barrage-part": "Barrage partiel",
    "coupure-gaz": "Coupure gaz",
    "coupure-urgence": "Coupure d’urgence",
    "eau-incendie": "Eau d’incendie",
    "rassemblement": "Point de rassemblement",
    "ria": "Robinet d’incendie armé (RIA)",
    "ssi": "Système de sécurité incendie (SSI)",
    "tel-urgence": "Téléphone d’urgence",
    "tgbt": "Tableau général basse tension (TGBT)",
    "transfo": "Transformateur",
    "vanne-police": "Vanne de police",
    "voie-engins": "Voie engins",
    "voie-echelle": "Voie échelle",
    "acces-partiel": "Accès partiel",
    "acces-second": "Accès secondaire",
    "vous-ici": "Vous êtes ici",
}


PICTOGRAM_UPPERCASE_TOKENS = {
    "abc", "baes", "bt", "cmsi", "co2", "dae", "dm", "eas", "eau",
    "ecs", "ht", "lsc", "pcs", "pmr", "ria", "ssi", "tgbt", "zag",
}


def humanize_pictogram_label(stem):
    """Turn a stable filename into a readable French library label."""
    source = str(stem or "").strip()
    override = PICTOGRAM_LABEL_OVERRIDES.get(source.casefold())
    if override:
        return override

    tokens = [token for token in re.split(r"[-_\s]+", source) if token]
    words = [
        token.upper() if token.casefold() in PICTOGRAM_UPPERCASE_TOKENS else token.casefold()
        for token in tokens
    ]
    label = " ".join(words).strip()
    return label[:1].upper() + label[1:] if label else "Pictogramme"


def humanize_catalogue_segment(segment):
    """Fallback label for a category/subcategory absent from the registry."""
    without_order = re.sub(r"^\d+[A-Za-z]?-", "", str(segment or ""))
    return humanize_pictogram_label(without_order)


def catalogue_icon_type(catalogue_key, relative_svg_path):
    """Build a stable, collision-free PlanIcon identifier (100 chars max)."""
    relative_without_extension = os.path.splitext(str(relative_svg_path))[0]
    path_key = relative_without_extension.replace("\\", "/").replace("/", ":")
    raw = f"{catalogue_key}:{path_key}".casefold()
    if len(raw) <= 100:
        return raw
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]
    return f"{raw[:87]}:{digest}"


def catalogue_metadata(catalogue_key, relative_svg_path):
    catalogue = PICTOGRAM_CATALOGS[catalogue_key]
    parts = str(relative_svg_path).replace("\\", "/").strip("/").split("/")
    if len(parts) == 1:
        category = catalogue["root_category"]
        category_key = category["key"]
        category_label = category["label"]
        subcategory_key = ""
        subcategory_label = ""
    else:
        category_key = parts[0]
        category_label = catalogue["categories"].get(
            category_key,
            humanize_catalogue_segment(category_key),
        )
        subcategory_key = parts[1] if len(parts) > 2 else ""
        subcategory_label = catalogue["subcategories"].get(
            subcategory_key,
            humanize_catalogue_segment(subcategory_key) if subcategory_key else "",
        )

    return {
        "standard": catalogue_key,
        "standard_label": catalogue["label"],
        "category": category_key,
        "category_label": category_label,
        "subcategory": subcategory_key,
        "subcategory_label": subcategory_label,
    }


def registered_catalogue_for_media_path(relative_path):
    """Return catalogue metadata when a media path belongs to a registry root."""
    candidate = str(relative_path or "").replace("\\", "/").strip("/")
    for catalogue_key, catalogue in PICTOGRAM_CATALOGS.items():
        root = str(catalogue["directory"]).strip("/")
        prefix = f"{root}/"
        if candidate.startswith(prefix):
            return catalogue_key, catalogue, candidate[len(prefix):]
    return None


def is_registered_catalogue_svg_path(relative_path):
    match = registered_catalogue_for_media_path(relative_path)
    return bool(match and str(relative_path).lower().endswith(".svg"))
