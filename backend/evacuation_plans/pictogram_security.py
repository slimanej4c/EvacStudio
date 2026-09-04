"""SVG validation shared by uploads, catalog discovery and media serving."""

import os
import re
import xml.etree.ElementTree as ET
from functools import lru_cache


MAX_PICTOGRAM_SVG_BYTES = 250 * 1024

# Rejected outright: these elements can execute code, navigate, animate, or
# load another document/resource in at least one SVG-capable browser.
SVG_DANGEROUS_TAGS = {
    "script", "foreignobject", "iframe", "object", "embed", "image", "audio",
    "video", "canvas", "a", "animate", "animatemotion", "animatetransform", "set",
    "handler", "listener", "discard",
}

SVG_ALLOWED_TAGS = {
    "svg", "g", "defs", "style", "title", "desc",
    "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
    "text", "tspan", "textpath",
    "lineargradient", "radialgradient", "stop",
    "clippath", "mask", "pattern", "symbol", "use", "marker",
    "switch", "metadata",
}

SVG_UNKNOWN_ELEMENT_LIMIT = 5000
SVG_DANGEROUS_CSS = ("javascript:", "expression(", "@import", "-moz-binding", "behavior:")


def svg_local_name(value):
    return value.rsplit("}", 1)[-1].lower()


def validate_and_sanitize_pictogram_svg(svg_bytes):
    """Return safe SVG bytes with a valid viewBox, or a French validation error."""
    if not svg_bytes:
        return None, "Le fichier SVG est vide."
    if len(svg_bytes) > MAX_PICTOGRAM_SVG_BYTES:
        return None, "Le SVG dépasse la taille maximale de 250 Ko."

    try:
        source = svg_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        return None, "Le SVG doit être encodé en UTF-8."

    lowered = source.lower()
    if "<!doctype" in lowered or "<!entity" in lowered:
        return None, "Les déclarations DOCTYPE et ENTITY ne sont pas autorisées."

    try:
        root = ET.fromstring(source)
    except ET.ParseError:
        return None, "Le contenu n'est pas un SVG valide."

    if svg_local_name(root.tag) != "svg":
        return None, "Le document doit commencer par un élément <svg>."

    view_box = root.attrib.get("viewBox") or root.attrib.get("viewbox")
    if not view_box:
        return None, 'Le SVG doit contenir un viewBox, par exemple "0 0 170 170".'
    try:
        values = [float(part) for part in re.split(r"[\s,]+", view_box.strip()) if part]
    except ValueError:
        values = []
    if len(values) != 4 or values[2] <= 0 or values[3] <= 0:
        return None, "Le viewBox du SVG est invalide."

    unknown_elements = []
    for element in root.iter():
        tag = svg_local_name(element.tag)
        if tag in SVG_DANGEROUS_TAGS:
            return None, f"L'élément SVG <{tag}> n'est pas autorisé."

        if tag == "style" and element.text:
            css = element.text.lower()
            if any(pattern in css for pattern in SVG_DANGEROUS_CSS):
                return None, "Les styles SVG ne peuvent pas charger de contenu externe."
            for url_target in re.findall(r"url\(([^)]*)\)", css):
                if not url_target.strip(" \"'").startswith("#"):
                    return None, "Les styles SVG ne peuvent pas charger de contenu externe."

        for attribute, value in list(element.attrib.items()):
            attribute_name = svg_local_name(attribute)
            value_lower = str(value).strip().lower()
            if attribute_name.startswith("on"):
                return None, "Les événements JavaScript ne sont pas autorisés dans un SVG."
            if attribute_name in {"href", "src"} and value_lower and not value_lower.startswith("#"):
                return None, "Les liens et images externes ne sont pas autorisés dans un SVG."
            if "javascript:" in value_lower or "data:text/html" in value_lower:
                return None, "Le SVG contient une valeur potentiellement dangereuse."
            if attribute_name == "style" and any(
                pattern in value_lower for pattern in SVG_DANGEROUS_CSS
            ):
                return None, "Le SVG contient un style potentiellement dangereux."
            for url_target in re.findall(r"url\(([^)]+)\)", value_lower):
                if not url_target.strip(" \"'").startswith("#"):
                    return None, "Les ressources externes ne sont pas autorisées dans un SVG."

        if element is not root and tag not in SVG_ALLOWED_TAGS:
            unknown_elements.append(element)

    if len(unknown_elements) > SVG_UNKNOWN_ELEMENT_LIMIT:
        return None, "Le SVG contient trop d'éléments non pris en charge."

    for element in unknown_elements:
        element.tag = "{http://www.w3.org/2000/svg}g"

    ET.register_namespace("", "http://www.w3.org/2000/svg")
    sanitized = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    return sanitized, None


@lru_cache(maxsize=1024)
def _sanitize_file_version(absolute_path, modified_ns, file_size):
    del modified_ns, file_size  # They are cache-version keys, not processing inputs.
    try:
        with open(absolute_path, "rb") as source:
            return validate_and_sanitize_pictogram_svg(source.read())
    except OSError:
        return None, "Le fichier SVG est inaccessible."


def sanitize_pictogram_svg_file(absolute_path):
    """Validate one non-symlink file and cache the sanitized bytes by version."""
    if os.path.islink(absolute_path) or not os.path.isfile(absolute_path):
        return None, "Le fichier SVG est invalide."
    try:
        stat = os.stat(absolute_path)
    except OSError:
        return None, "Le fichier SVG est inaccessible."
    return _sanitize_file_version(
        os.path.realpath(absolute_path),
        stat.st_mtime_ns,
        stat.st_size,
    )

