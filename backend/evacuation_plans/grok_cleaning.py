"""Vider un plan d'évacuation existant en base architecturale vide, avec Grok.

Deux étapes, fidèles au script de référence :

1. ``grok-4.5`` lit le plan (vision) et produit un prompt d'édition compact,
   spécifique à l'image, qui dit exactement ce qu'il faut préserver (murs,
   portes, escaliers...) et ce qu'il faut retirer (flèches, pictogrammes,
   « you are here », légendes...).
2. ``grok-imagine-image-quality`` réédite l'image source à partir de ce prompt,
   en résolution 2K, et renvoie une URL temporaire que l'on télécharge.

Le résultat est une base architecturale propre sur laquelle on peut reconstruire
un nouveau plan d'évacuation.
"""

import base64
import json
import logging
import os
from dataclasses import dataclass, field
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import cv2
import numpy as np


logger = logging.getLogger(__name__)


# ── Configuration ───────────────────────────────────────────────────────────

DEFAULT_ANALYSIS_MODEL = "grok-4.5"
DEFAULT_EDIT_MODEL = "grok-imagine-image-quality"
DEFAULT_RESOLUTION = "2k"
DEFAULT_XAI_REQUEST_TIMEOUT_SECONDS = 300
MAX_EDIT_PROMPT_LENGTH = 7500


def _get_analysis_model() -> str:
    return os.environ.get("XAI_ANALYSIS_MODEL", DEFAULT_ANALYSIS_MODEL)


def _get_edit_model() -> str:
    return os.environ.get("XAI_EDIT_MODEL", DEFAULT_EDIT_MODEL)


def _get_resolution() -> str:
    return os.environ.get("XAI_RESOLUTION", DEFAULT_RESOLUTION)


def _get_request_timeout() -> int:
    """Return a bounded per-request timeout for the xAI SDK.

    The SDK default is 27 minutes. This pipeline makes two sequential calls,
    so relying on that default can leave an editor polling for almost an hour.
    """
    try:
        timeout = int(os.environ.get(
            "XAI_REQUEST_TIMEOUT_SECONDS",
            DEFAULT_XAI_REQUEST_TIMEOUT_SECONDS,
        ))
    except (TypeError, ValueError):
        return DEFAULT_XAI_REQUEST_TIMEOUT_SECONDS
    return max(30, min(timeout, 900))


# ── Instruction d'analyse (reproduit à l'identique le script de référence) ──

ANALYSIS_INSTRUCTION = r"""
You are an expert in:

- architectural floor-plan interpretation
- evacuation plans
- fire-safety plans
- technical drawings
- architectural image restoration

Analyze ONLY the supplied existing evacuation-plan image.

Your mission is NOT to generate or redraw the cleaned image.

Your mission is to understand exactly:

1. what architectural geometry must remain;
2. what evacuation graphics must be removed;
3. what areas are partially hidden by evacuation overlays;
4. what geometry is ambiguous;
5. what local restoration may safely be performed.

The supplied source image is the sole geometric authority.


============================================================
GOAL
============================================================

The final operation will transform this evacuation plan into an EMPTY
ARCHITECTURAL BASE suitable for creating a new evacuation plan.

The cleaning must remove evacuation-related graphics while preserving
the original architectural geometry as faithfully as possible.


============================================================
ABSOLUTE PRESERVATION RULE
============================================================

Architectural preservation is more important than visual simplification.

Detect and protect whenever visible:

- exterior walls
- structural walls
- interior walls
- partitions
- wall thicknesses
- wall corners
- short wall returns
- room boundaries
- corridors
- passages
- openings
- windows
- doors
- door jambs
- door leaves
- hinges
- door swing arcs
- straight stairs
- curved stairs
- stair treads
- landings
- elevators
- elevator shafts
- technical shafts
- technical cores
- fixed technical rooms
- columns
- pillars
- ramps
- parking-space boundaries
- storage-space boundaries
- thin architectural lines
- fixed architectural equipment outlines
- irregular geometric details
- diagonal walls
- curved walls

DO NOT classify a small black or gray line as noise merely because it
is thin or difficult to read.


============================================================
EVACUATION GRAPHICS TO DETECT
============================================================

Identify when visible:

- YOU ARE HERE
- VOUS ÊTES ICI
- current-position markers
- position dots
- position pointers
- direction arrows
- evacuation arrows
- evacuation routes
- evacuation path lines
- highlighted routes
- running-person pictograms
- emergency-exit pictograms
- exit signs
- extinguisher pictograms
- fire-hose / RIA graphics
- fire-alarm symbols
- evacuation-specific safety labels
- safety boxes
- green overlays
- blue overlays
- cyan overlays
- yellow overlays
- orange overlays
- red evacuation overlays
- colored safety zones
- evacuation leaders
- evacuation annotations


============================================================
OTHER NON-ARCHITECTURAL GRAPHICS
============================================================

For an empty architectural base, identify removable:

- floor titles
- room-use text
- addresses
- explanatory text
- legends
- sheet titles
- company logos
- owner logos
- security-company information
- footer text
- document references
- printer references
- decorative borders
- non-geometric labels

These can be removed ONLY as graphics/text.

If they overlap architecture, the architecture must remain.


============================================================
VERY IMPORTANT:
OVERLAYS CROSSING ARCHITECTURAL GEOMETRY
============================================================

Evacuation symbols often cover architectural lines.

When an overlay crosses architecture, determine:

- overlay type;
- exact location;
- architectural feature underneath;
- whether visible endpoints support continuation;
- whether local restoration is safe.

Examples:

a green arrow may cross a wall;

a YOU ARE HERE box may hide a partition;

an exit sign may cover a door jamb;

a colored route may cover stair treads;

an extinguisher symbol may cover a parking divider.


============================================================
REPAIR RULE
============================================================

Only recommend repair when visible geometry strongly supports it.

A missing short segment may be restored when:

- both endpoints are visible;
- alignment is obvious;
- curvature is obvious;
- line thickness can be inferred;
- continuation is local and unambiguous.

Do NOT invent geometry when the overlay completely hides it.

It is better to preserve uncertainty than create false architecture.


============================================================
DO NOT ALLOW
============================================================

Never recommend:

- redesigning the plan
- recreating the building from memory
- simplifying complicated areas
- moving walls
- straightening walls
- resizing rooms
- changing scale
- making the building symmetrical
- orthogonalizing diagonal walls
- creating doors
- removing real doors
- closing real openings
- creating new openings
- replacing stairs with generic stairs
- replacing elevators with generic symbols
- merging parking spaces
- merging rooms
- removing small technical rooms
- changing the relative position of separate floor plans


============================================================
SOURCE QUALITY
============================================================

Determine whether the source is:

- photograph
- scan
- screenshot
- CAD export
- printed plan

Also detect:

- blur
- paper texture
- discoloration
- shadows
- perspective distortion
- compression artifacts
- halftone pattern
- low contrast
- background noise

These visual artifacts may be cleaned later, but weak architectural
linework must remain.


============================================================
OUTPUT
============================================================

Return ONLY valid JSON.

No Markdown.
No code fences.
No comments outside JSON.


Use this structure:

{
  "source_type": "",

  "source_quality": {
    "overall": "",
    "photographed": false,
    "scanned": false,
    "perspective_distortion": false,
    "blur": "",
    "background_noise": "",
    "paper_texture": false,
    "comments": []
  },

  "plan_areas": [
    {
      "id": "",
      "position": "",
      "approximate_shape": "",
      "orientation": "",
      "important_geometry": [],
      "dense_or_sensitive_areas": []
    }
  ],

  "preserve": [
    {
      "type": "",
      "location": "",
      "description": "",
      "priority": "critical"
    }
  ],

  "remove": [
    {
      "type": "",
      "location": "",
      "description": "",
      "overlaps_architecture": false
    }
  ],

  "repair_candidates": [
    {
      "location": "",
      "overlay": "",
      "underlying_geometry": "",
      "confidence": "high",
      "instruction": ""
    }
  ],

  "small_details_to_protect": [],

  "ambiguous_areas": [
    {
      "location": "",
      "description": "",
      "instruction": "preserve_if_uncertain"
    }
  ],

  "source_specific_constraints": [],

  "compact_edit_prompt": ""
}


============================================================
COMPACT_EDIT_PROMPT
============================================================

The field "compact_edit_prompt" is extremely important.

Generate the final image-editing prompt directly inside this field.

It will be sent to an image-editing model.

It MUST be:

- source-specific
- concise
- technically precise
- focused on actual visible details
- less than 5500 characters

DO NOT generate a giant essay.

DO NOT repeat generic rules unnecessarily.

Priority order:

1. Preserve original architectural geometry.
2. Describe important source-specific architectural areas.
3. Identify evacuation graphics to remove.
4. Identify sensitive overlapping areas.
5. Mention ambiguous areas.
6. Prevent redesign, simplification and hallucination.


The prompt MUST begin with:

"Edit the supplied existing evacuation-plan image and produce a clean empty architectural base."


It must clearly say:

- use the source image as the sole geometric reference;
- preserve exact walls, partitions, doors, stairs, shafts, openings and
  fine architectural lines;
- remove evacuation overlays;
- remove non-geometric plan annotations;
- perform only local repairs;
- never invent hidden geometry;
- preserve scale and relative position;
- use white background and black/dark architectural linework.


Terminate compact_edit_prompt EXACTLY with:

"Use a clean pure white background and retain crisp black architectural linework.
Return only the cleaned architectural base image."


Be highly accurate.

Base all source-specific information ONLY on what is actually visible.
"""


# ── Erreurs ─────────────────────────────────────────────────────────────────


class GrokCleaningError(Exception):
    """Erreur pendant le nettoyage Grok. ``error_code`` est stable pour l'UI."""

    user_message = "Erreur pendant le nettoyage avec l'IA."
    error_code = "GROK_FAILED"

    def __init__(self, diagnostic, error_code=None, user_message=None):
        super().__init__(user_message or self.user_message)
        self.diagnostic = diagnostic or self.__class__.__name__
        self.error_code = error_code or self.__class__.error_code
        self.user_message = user_message or self.user_message


class MissingXaiApiKeyError(GrokCleaningError):
    user_message = "Clé API xAI absente."
    error_code = "XAI_KEY_MISSING"


# ── Résultat ────────────────────────────────────────────────────────────────


@dataclass
class GrokCleaningResult:
    analysis: dict
    generation_prompt: str
    cleaned_image_bytes: bytes
    analysis_model: str
    image_model: str
    warnings: list = field(default_factory=list)
    status: str = "success"


# ── Utilitaires ─────────────────────────────────────────────────────────────


def image_bytes_to_data_url(image_bytes: bytes, mime_type: str = "image/png") -> str:
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def _clean_json_response(text: str) -> str:
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:].strip()
    elif text.startswith("```"):
        text = text[3:].strip()
    if text.endswith("```"):
        text = text[:-3].strip()
    return text


def _download_image(url: str, timeout: int = 60) -> bytes:
    """Télécharge l'image générée depuis son URL temporaire."""
    response = urlopen(Request(url), timeout=timeout)
    try:
        return response.read()
    finally:
        response.close()


def _extract_image_bytes(response) -> bytes:
    """Récupère les bytes de l'image générée en privilégiant l'accès direct.

    Ordre de préférence :

    1. ``response.image`` — les bytes bruts (mode ``image_format="base64"``).
       C'est le chemin le plus sûr : il évite tout téléchargement HTTP depuis
       l'URL temporaire de xAI, qui échoue souvent (expiration, redirect).
    2. ``response.base64`` — la chaîne base64 à décoder.
    3. ``response.url`` — l'URL temporaire, téléchargée en dernier recours.

    Lève :class:`GrokCleaningError` si rien n'est disponible.
    """
    # 1. Bytes directs.
    raw = getattr(response, "image", None)
    if isinstance(raw, (bytes, bytearray)) and raw:
        return bytes(raw)

    # 2. Base64 à décoder.
    b64 = getattr(response, "base64", None)
    if isinstance(b64, str) and b64:
        try:
            decoded = base64.b64decode(b64, validate=False)
        except Exception as exc:
            raise GrokCleaningError(
                f"image_invalid_base64:{exc.__class__.__name__}",
                error_code="IMAGE_GENERATION_FAILED",
                user_message="L'image générée est illisible.",
            ) from exc
        if decoded:
            return decoded

    # 3. URL temporaire (fallback).
    image_url = getattr(response, "url", None)
    if image_url:
        try:
            return _download_image(image_url)
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            raise GrokCleaningError(
                f"image_download_failed:{exc.__class__.__name__}",
                error_code="IMAGE_DOWNLOAD_FAILED",
                user_message=(
                    "Impossible de télécharger l'image générée. Le lien xAI a "
                    "expiré ou a été refusé ; relancez le nettoyage."
                ),
            ) from exc

    raise GrokCleaningError(
        "image_empty_response",
        error_code="IMAGE_GENERATION_FAILED",
        user_message="xAI n'a retourné aucune image exploitable.",
    )


def _map_grpc_error(exc: Exception) -> GrokCleaningError:
    """Traduit une grpc.RpcError en GrokCleaningError avec un code stable."""
    code = None
    details = ""
    try:
        code = exc.code()  # type: ignore[attr-defined]
        details = exc.details() or ""  # type: ignore[attr-defined]
    except Exception:  # pragma: no cover - défensive, dépend de gRPC
        pass

    code_name = getattr(code, "name", str(code)) if code is not None else "UNKNOWN"

    if code_name in ("UNAUTHENTICATED", "PERMISSION_DENIED"):
        return GrokCleaningError(
            "xai_unauthenticated",
            error_code="XAI_KEY_INVALID",
            user_message="Clé API xAI invalide ou non autorisée.",
        )
    if code_name == "RESOURCE_EXHAUSTED":
        return GrokCleaningError(
            "xai_resource_exhausted",
            error_code="XAI_RATE_LIMIT",
            user_message="Limite de débit xAI atteinte. Réessayez dans un instant.",
        )
    if code_name == "DEADLINE_EXCEEDED":
        return GrokCleaningError(
            "xai_deadline_exceeded",
            error_code="XAI_TIMEOUT",
            user_message="L'appel à xAI a dépassé le délai d'attente.",
        )
    if code_name == "INVALID_ARGUMENT":
        return GrokCleaningError(
            f"xai_invalid_argument:{details}",
            error_code="XAI_BAD_REQUEST",
            user_message="Paramètre invalide envoyé à xAI.",
        )
    return GrokCleaningError(
        f"xai_error:{code_name}:{details}",
        error_code="XAI_FAILED",
        user_message="Erreur pendant l'appel à xAI.",
    )


# ── Entrée principale ───────────────────────────────────────────────────────


AUTOCAD_ANALYSIS_INSTRUCTION = r"""
You are an expert architectural drafter specialized in interpreting
AutoCAD floor plans and preparing architectural drawings for evacuation
and fire-safety plan production.

Analyze ONLY the supplied source image.

Your task is NOT to clean the image yet.

Your task is to generate an extremely accurate image-editing prompt that
will transform this existing AutoCAD-derived plan into a CLEAN,
EMPTY ARCHITECTURAL BASE suitable for creating a new evacuation plan.


======================================================================
PRIMARY OBJECTIVE
======================================================================

The resulting drawing must preserve the real architectural geometry of
the supplied source while removing information that is unnecessary for
an evacuation-plan base.

The source image is the ONLY geometric authority.

This operation is:

- NOT a redesign
- NOT a reconstruction from memory
- NOT a simplification of the building
- NOT an architectural reinterpretation
- NOT an attempt to make the building more symmetrical
- NOT an attempt to generate a new floor plan

The objective is targeted graphical cleaning.


======================================================================
FIRST: ANALYZE THE PLAN
======================================================================

Describe precisely:

1. Number of separate floor-plan areas visible.
2. Exact position of each plan area on the sheet.
3. General exterior contour of each building/floor.
4. Main internal circulation areas.
5. Rooms and enclosed spaces.
6. Stairs and landings.
7. Elevators and elevator shafts.
8. Technical shafts and technical rooms.
9. Doors.
10. Door leaves.
11. Door swing arcs.
12. Windows and glazed openings.
13. Structural columns/pillars.
14. Wall thicknesses.
15. Interior partitions.
16. Exterior walls.
17. Open passages.
18. Corridors.
19. Ramps if visible.
20. Fixed architectural equipment that must remain.
21. Fine architectural lines that could accidentally be removed.


======================================================================
ARCHITECTURAL GEOMETRY TO PRESERVE EXACTLY
======================================================================

Generate a section titled exactly:

"Architectural geometry to preserve exactly:"

Describe every important visible architectural category.

Use labels such as:

- outer_wall
- structural_wall
- inner_wall
- partition
- room_boundary
- corridor
- opening
- door
- door_leaf
- door_swing
- window
- stair
- curved_stair
- landing
- elevator
- elevator_shaft
- technical_core
- technical_room
- shaft
- column
- ramp
- step
- thin_line
- architectural_fixture

For each detected architectural feature specify:

- approximate location
- geometry
- relationship with surrounding geometry
- important small details
- priority: critical / high / medium

Be extremely conservative.

Small or thin architectural geometry MUST NOT be classified as noise
simply because it is small.


======================================================================
WHAT SHOULD GENERALLY BE REMOVED
======================================================================

Generate another section titled exactly:

"Remove only these non-essential AutoCAD elements:"

Detect which of the following actually exist in the supplied plan.

REMOVE when visible and when they are NOT architectural geometry:

- dimensions
- dimension lines
- extension lines
- dimension arrows
- dimension numbers
- coordinate labels
- level markers
- elevation annotations
- section markers
- detail references
- drawing references
- room names
- room numbers
- area values
- surface-area annotations
- descriptive text
- technical notes
- construction notes
- legends
- title blocks
- drawing borders
- company logos
- project logos
- revision tables
- sheet numbers
- drawing numbers
- dates
- author names
- scale text
- north arrow if it is only sheet annotation
- grid labels
- axis bubbles
- decorative labels
- leader lines belonging to annotations
- colored revision clouds
- revision symbols
- temporary construction annotations

REMOVE non-essential furnishing when clearly identifiable:

- tables
- desks
- office chairs
- sofas
- beds
- wardrobes
- cabinets
- shelves
- movable storage
- decorative furniture
- loose equipment
- plants
- vehicles
- decorative objects

REMOVE unnecessary technical layers when they are clearly separate
from architectural geometry:

- electrical wiring
- electrical circuit lines
- cable routes
- lighting connection lines
- plumbing routes
- pipe networks
- ventilation duct annotations
- HVAC routes
- sprinkler network lines
- sensor coverage
- technical arrows
- installation tags
- electrical device labels
- plumbing labels
- mechanical labels

REMOVE graphical fills when they are not required to understand
architectural geometry:

- material hatches
- floor hatching
- wall material patterns
- insulation patterns
- decorative fills
- gradients
- CAD layer colors
- colored zoning
- colored technical overlays

BUT preserve the boundaries of real walls, rooms and architectural
elements beneath those fills.


======================================================================
CRITICAL ITEMS THAT MUST NEVER BE REMOVED
======================================================================

Never delete:

- exterior wall boundaries
- structural walls
- interior walls
- room partitions
- actual wall thickness
- columns
- pillars
- doors
- door jambs
- door leaves
- door swing arcs
- windows
- stairs
- individual stair treads where visible
- landings
- elevators
- elevator shafts
- technical shafts
- fixed service cores
- ramps
- architectural openings
- corridor boundaries
- emergency-exit doors when they are actual architectural doors
- permanent room contours

Do not remove something simply because it resembles an annotation.

If a black line belongs to the actual architecture, preserve it.


======================================================================
SPECIAL RULE FOR FURNITURE
======================================================================

Furniture can be removed ONLY when it is clearly distinguishable from
architectural geometry.

If an object is ambiguous, preserve it rather than accidentally
destroying architectural geometry.


======================================================================
SPECIAL RULE FOR TECHNICAL ROOMS
======================================================================

Technical-room WALLS and boundaries must remain.

Internal removable technical symbols may be removed only if doing so
does not destroy understanding of the architectural layout.

Elevator shafts, stair cores, electrical rooms, mechanical rooms,
utility rooms and similar enclosed architectural spaces must NEVER
disappear merely because they contain technical symbols.


======================================================================
TEXT REMOVAL
======================================================================

Remove ordinary AutoCAD annotation text unless that text is required
to preserve geometry.

Text removal must never erase the wall, door, partition, stair,
window or other architectural line beneath the text.

If text overlaps architectural geometry, locally restore only
line continuations strongly supported by visible geometry.


======================================================================
HATCH REMOVAL
======================================================================

Remove dense CAD hatching while preserving its architectural boundary.

A hatch is NOT a wall.

A hatch pattern must not cause:

- a room to disappear
- a wall to become thicker
- a wall to become thinner
- a doorway to close
- a shaft to disappear


======================================================================
OVERLAPPING ELEMENTS
======================================================================

Generate a section titled:

"Architectural fragments covered by removable CAD elements that may require local repair:"

Identify areas where:

- dimension lines cross walls
- text covers walls
- hatches cover fine details
- furniture touches partitions
- annotations cover doors
- technical symbols intersect architectural geometry

For these areas instruct the image editor to restore ONLY line segments
that can be reliably inferred from immediately visible endpoints.

Never invent hidden geometry.


======================================================================
MANDATORY PRESERVATION RULES
======================================================================

Generate a section titled exactly:

"Mandatory preservation rules:"

Include these principles:

- Preserve the exact exterior footprint.
- Preserve exact room proportions.
- Preserve wall positions.
- Preserve wall thicknesses.
- Preserve all openings.
- Preserve every visible door.
- Preserve every visible door swing.
- Preserve every visible window.
- Preserve every stair and landing.
- Preserve elevator and shaft geometry.
- Preserve columns.
- Preserve unusual angled or curved walls.
- Preserve small rooms.
- Preserve narrow corridors.
- Preserve irregular geometry.
- Preserve asymmetry.
- Preserve fine architectural linework.

Do not:

- move walls
- straighten walls
- align walls artificially
- resize rooms
- merge rooms
- create rooms
- close openings
- create openings
- invent doors
- replace stairs with generic stairs
- replace elevators with generic symbols
- simplify complicated areas
- regularize irregular contours


======================================================================
ADDITIONAL CRITICAL CONSTRAINTS
======================================================================

Generate a section:

"Additional critical constraints detected for this source:"

This section MUST be source-specific.

Mention any unusual geometry detected, such as:

- diagonal walls
- curved walls
- dense stair cores
- unusual shafts
- repetitive rooms
- very thin partitions
- complex entrances
- multiple disconnected buildings
- irregular exterior boundaries
- large open spaces
- nested rooms
- technical zones
- overlapping CAD layers


======================================================================
AMBIGUOUS AREAS
======================================================================

Generate a section:

"Ambiguous areas:"

List anything that cannot be identified with high confidence.

For every ambiguous object:

PRESERVE geometry rather than inventing a replacement.

If removal could destroy architectural information, do not remove it.


======================================================================
OUTPUT APPEARANCE
======================================================================

The final cleaned drawing must look like a professional,
minimal architectural base suitable for an evacuation plan.

Desired appearance:

- pure white background
- black or very dark architectural linework
- clean crisp lines
- no unnecessary colors
- no shadows
- no paper texture
- no photographic background
- no CAD dark workspace
- no title block
- no dimensions
- no decorative graphics
- no evacuation symbols
- no evacuation arrows
- no evacuation routes
- no "YOU ARE HERE" marker
- no new labels
- no watermark

IMPORTANT:

Do not redraw the architecture from imagination.

Keep the source drawing spatially registered with the original image.

Do NOT crop architectural portions.

Do NOT rotate the plan unless required only to correct an obvious
photographic skew.

Do NOT alter the relative position of separate plan areas.


======================================================================
FINAL PROMPT STRUCTURE
======================================================================

Your generated prompt MUST begin exactly with:

"Clean the supplied existing AutoCAD-derived architectural plan and
produce an empty architectural base suitable for creating an evacuation
plan.

This is a targeted CAD-cleaning operation. It is NOT a redesign,
simplification, beautification, reinterpretation or global
reconstruction.

The supplied source image is the authoritative geometric reference."


Then produce:

1. Source plan description
2. Architectural geometry to preserve exactly
3. Small architectural details that must not disappear
4. Remove only these non-essential AutoCAD elements
5. Architectural fragments covered by removable CAD elements that may require local repair
6. Mandatory preservation rules
7. Additional critical constraints detected for this source
8. Ambiguous areas


Terminate EXACTLY with:

"Use a clean pure white background and retain crisp black architectural linework.
Do not add evacuation graphics yet.
Return only the cleaned empty architectural base image."


Be exhaustive but avoid useless repetition.

CRITICAL PROMPT LENGTH CONSTRAINT:
Your generated prompt MUST NOT exceed 6000 characters total. Keep explanations dense, concise, and focused on essential architectural rules and elements without unnecessary prose or repeated sentences.

Do not invent information that is not visible in the supplied image.
"""


SKETCH_ANALYSIS_INSTRUCTION = r"""
You are an expert architectural drafter specialized in converting hand-drawn
floor-plan sketches into clean technical drawings that can be used as the
architectural base of an evacuation plan.

Analyze ONLY the supplied source image. The source may be a scan or photograph
of a sketch drawn with pen or pencil on plain, lined or graph paper.

Your task is NOT to invent a building. Your task is to generate a precise,
source-specific image-editing prompt that transforms the visible sketch into a
professional empty architectural floor-plan base.

Critical interpretation rule: infer the intended designed architecture rather
than reproducing the literal coordinates of shaky strokes. Treat small angle,
alignment and straightness errors as drawing noise. Explicitly inspect the
outer perimeter, every interior wall, every opening and the room topology.
Identify which rare slanted or curved exterior boundaries are clearly
intentional so they remain deliberate geometry; all ordinary interior walls
must be reconstructed on a precise orthogonal architectural grid.


======================================================================
GEOMETRIC AUTHORITY
======================================================================

The supplied sketch is the sole authority for topology and intended relative
geometry. Preserve the following architectural information whenever visible,
but do not preserve accidental hand-drawn deviations from straightness,
parallelism, alignment or right angles:

- the number and arrangement of rooms and spaces;
- exterior footprint and irregular contours;
- wall, partition and corridor positions;
- openings, passages, doors and door-swing direction;
- windows, stairs, landings, elevators, shafts and columns;
- adjacency between rooms and circulation paths;
- relative proportions, orientation and position of all areas;
- separate floor-plan areas and their relative placement on the sheet.

Never add a room, door, window, stair, corridor, exit or technical space that
is not supported by visible strokes. Never make the layout symmetrical, merge
rooms or close openings merely to make the result prettier. Minor snapping and
alignment corrections are required when they recover the clearly intended
architectural geometry without changing topology.


======================================================================
INTERPRETING HAND-DRAWN STROKES
======================================================================

Distinguish intentional architectural strokes from paper defects, shadows,
folds, stains, handwriting and accidental marks.

Convert clearly intentional architecture into clean technical linework:

- straighten a shaky line only when it clearly represents a straight wall;
- retain intentional angled, curved or irregular walls;
- default every ordinary interior wall to exactly horizontal or exactly
  vertical; retain an interior diagonal only when it is unmistakably intended;
- snap every ordinary interior corner and T-junction to an exact 90-degree
  architectural angle;
- align nearly collinear wall segments to the same exact horizontal or vertical
  axis and make walls intended as parallel perfectly parallel;
- replace bowed or wavy intended straight walls with one best-fit straight line;
- join and close wall corners or wall ends that visibly meet, without closing
  intentional doors, windows, passages or other openings;
- make L-, T- and cross-junctions meet flush, with no gap, overlap, protruding
  cap, hook or overshoot;
- reconstruct walls as solid, continuous, fully opaque technical linework with
  clean edges and consistent thickness;
- reject thin gray, broken, fuzzy, translucent, paint-like or duplicated ghost
  outlines instead of reproducing them from the sketch;
- interpret two parallel wall boundaries as the edges of one wall mass and fill
  the complete space between them with one solid wall color;
- never render a wall as a hollow background-colored strip enclosed by contours,
  parallel outline rails or an empty rectangle;
- when the sketch uses a single wall stroke, rebuild it as one solid filled band
  of suitable uniform thickness rather than adding a hollow second outline;
- do not invent wall thickness when the sketch gives no reliable evidence;
- convert clear door leaves and swing arcs into crisp conventional geometry;
- redraw clear windows, stairs and treads faithfully at the same locations;
- preserve incomplete or uncertain geometry rather than guessing its meaning.

If the source is photographed, correct obvious camera perspective, rotation and
paper skew only enough to present the same geometry orthogonally. Do not use
perspective correction as permission to reshape the plan.


======================================================================
REMOVE FROM THE FINAL BASE
======================================================================

Remove only non-architectural material when visible:

- paper texture, graph lines, ruled lines, shadows, folds and stains;
- pen pressure variations, ink bleed, smudges and scanning noise;
- handwritten notes, dimensions, arrows and correction marks;
- legends, title blocks, borders, logos, dates and signatures;
- existing evacuation pictograms, routes, safety colors and YOU ARE HERE marks;
- loose furniture only when it is clearly not part of the architecture.

When text or a mark crosses a wall, restore only the short continuation strongly
supported by immediately visible endpoints. Never hallucinate hidden geometry.


======================================================================
TARGET APPEARANCE
======================================================================

The result must be a clean professional 2D architectural base ready for the
editor to receive evacuation pictograms and routes:

- same canvas coverage and same relative scale as the source;
- pure flat uniform background with no paper texture or shadow;
- crisp, solid, continuous and fully opaque architectural linework;
- wall bodies filled edge-to-edge with the requested wall color and no hollow center;
- clear walls, openings, doors, stairs and circulation;
- no perspective presentation, 3D effect, color rendering or decoration;
- no evacuation symbols, arrows, labels, legend or YOU ARE HERE marker yet;
- no cropped architectural area and no watermark.

This is a faithful drafting conversion, not a redesign and not a generic floor
plan generated from imagination.


======================================================================
OUTPUT
======================================================================

Return ONLY one valid JSON object with this structure:

{
  "source_summary": "",
  "recognized_architecture": [],
  "hand_drawn_artifacts_to_remove": [],
  "uncertain_areas": [],
  "compact_edit_prompt": ""
}

The compact_edit_prompt must be source-specific, technically precise and less
than 6000 characters. Mention the actual visible plan organization, the
architectural features to redraw, artifacts to remove and every uncertain area.

The compact_edit_prompt MUST begin exactly with:

"Transform the supplied hand-drawn floor-plan sketch into a clean professional architectural base suitable for creating an evacuation plan."

It must explicitly state that the sketch is the sole geometric reference, that
only clearly intended architectural strokes may be regularized, and that no
hidden geometry may be invented.

Terminate compact_edit_prompt EXACTLY with:

"Use a clean uniform background and retain crisp high-contrast architectural linework.
Return only the cleaned architectural base image."

Base all source-specific information ONLY on what is actually visible.
"""


# This block is injected directly into the image-generation prompt. It is kept
# separate from the vision-analysis instruction so the image model receives the
# anti-sketch requirements even if the analysis response paraphrases or omits
# part of them.
SKETCH_GENERATION_REQUIREMENTS = r"""
Convert this hand-drawn floor sketch into a clean, professional high-contrast CAD-style architectural floor plan.

CRITICAL INSTRUCTIONS:
- Use the source sketch only as a geometric reference and reconstruct the plan.
- Do NOT trace the sketch literally or reproduce its drawing style.
- Infer the intended professional architecture; do NOT preserve accidental crooked lines, approximate angles, poor alignment or freehand deformation.
- Do NOT reproduce the hand-drawn style, shaky strokes, irregular pen pressure or paint-like appearance.
- Do NOT keep sketch-like, thin, broken, fuzzy, translucent or double-outline lines.
- Do NOT draw walls as hollow outlined shapes, two parallel rails or contours with the background visible at their center.
- Do NOT produce pencil, paint, artistic, illustrated, hand-rendered or traced-paint effects.

GEOMETRY — PRESERVE THE INTENDED DESIGN:
- Preserve the intended layout, topology, room adjacency and relative proportions, not the accidental wobble of the drawn strokes.
- Preserve the intended outer perimeter, including only clearly deliberate slanted, angled, irregular and curved boundaries.
- Preserve every interior wall and opening in its intended relative position while correcting small drawing inaccuracies.
- Preserve clear doors, door swings, windows, stairs, landings, shafts and columns at their original positions.
- Do not move, merge, add or remove spaces, walls, openings or architectural features.
- Never invent hidden geometry or technical details that are not supported by the source.

MANDATORY ARCHITECTURAL ORTHOGONALIZATION:
- Reconstruct all ordinary interior walls on a precise horizontal-and-vertical architectural grid.
- Every ordinary interior corner must be exactly 90 degrees. Do not output approximate 88°, 92° or other almost-square angles.
- Every intended horizontal wall must be mathematically straight and level; every intended vertical wall must be mathematically straight and upright.
- Walls intended to be parallel must be perfectly parallel. Nearly collinear segments must snap to the exact same axis.
- Replace every bowed, wavy, leaning or irregular intended straight stroke with one clean best-fit straight wall.
- Keep an interior diagonal only when the source makes it unmistakably intentional. Never infer a diagonal merely from an imprecise hand-drawn line.
- Keep a deliberate curved exterior boundary, but redraw it as one smooth controlled curve without bumps, flat spots or kinks.
- Make every L-, T- and cross-junction meet exactly and flush, with no gaps, overlaps, hooks, protruding ends or overshoots.
- Keep door and passage openings clear and correctly aligned; do not close them while joining walls.

LINE RECONSTRUCTION:
- Convert every intended straight wall into a crisp, perfectly straight horizontal, vertical or deliberately angled architectural line.
- Keep curves only where the source clearly shows a deliberately curved boundary.
- REQUIRED WALL COLOR: {wall_color}. Use this exact HEX color for every wall and architectural line.
- Use solid, continuous, fully opaque wall linework in exactly {wall_color}, with clean edges and uniform, consistent thickness.
- Render every wall as a SOLID FILLED BAND. The complete wall thickness must be {wall_color} from edge to edge.
- If two wall boundaries are visible, treat them as the limits of one wall and fill all space between them with {wall_color}.
- The background color inside a wall thickness is strictly forbidden. The background may appear only in rooms, corridors and intentional openings.
- Do not substitute black, another gray or any approximate shade when {wall_color} is requested. No faded, semi-transparent, fuzzy or fragmented linework.
- Replace rough strokes with a single clean architectural result; remove duplicate, offset or ghost outlines caused by the sketch.
- Exterior walls may be thicker than interior partitions, but both must remain completely filled with {wall_color} and have no hollow center.
- Door leaves and swing arcs may remain crisp single technical lines in {wall_color}; the surrounding wall bodies must remain solid filled bands.
- Join and close wall corners and wall ends where the source shows that they meet. Never close an intentional door, window, passage or opening.

CLEANUP AND OUTPUT:
- Correct paper or camera rotation and perspective without altering the plan geometry.
- Remove handwritten labels, notes, dimensions, arrows and correction marks.
- Remove paper texture, graph or ruled lines, shadows, stains, folds, ink noise and camera background.
- Produce a clean top-down orthographic plan on the exact flat background {background_color}, using only {wall_color} for architectural linework.
- No unintended colors, pencil effect, sketch effect, paint effect, textures, hatching or shading.
- No furniture, dimensions, title, border, logo or watermark.
- No evacuation pictograms, routes or symbols yet.

The final result must look like a digitally drafted CAD-style architectural base plan: precise, high-contrast, clean and suitable for evacuation-plan preparation. It must never look like a traced sketch.
""".strip()


def _run_analysis(client, source_data_url: str, analysis_model: str, instruction: str = ANALYSIS_INSTRUCTION) -> dict:
    from xai_sdk.chat import image, user
    chat = client.chat.create(model=analysis_model)
    chat.append(user(instruction, image(source_data_url, detail="high")))

    response = chat.sample()
    content = getattr(response, "content", None)
    if not content:
        raise GrokCleaningError(
            "analysis_empty_response",
            error_code="ANALYSIS_FAILED",
            user_message="L'analyse n'a retourné aucun contenu.",
        )

    try:
        return json.loads(_clean_json_response(content))
    except json.JSONDecodeError:
        return {"compact_edit_prompt": content.strip()}


def normalize_hex_color(value: str, default: str) -> str:
    """Return an uppercase six-digit HEX color, or ``default`` when invalid."""
    color = str(value or "").strip().upper()
    if len(color) == 4 and color.startswith("#"):
        color = "#" + "".join(character * 2 for character in color[1:])
    if len(color) == 7 and color.startswith("#") and all(
        character in "0123456789ABCDEF" for character in color[1:]
    ):
        return color
    return default.upper()


def _format_background_color_instruction(
    background_color: str = "#FFFFFF",
    wall_color: str = "#000000",
    preset: str = "evacuation",
) -> str:
    color = (background_color or "#FFFFFF").strip().upper()
    line_instruction = (
        f"Use exact wall and architectural-line color {wall_color}; keep it fully opaque and uniform."
        if preset == "sketch"
        else "Retain only crisp high-contrast black architectural linework."
    )
    if color in ("#FFFFFF", "WHITE", "#FFF", "PURE WHITE", "BLANC SEC"):
        return (
            "CRITICAL BACKGROUND RULE: Use a 100% pure flat solid white background (#FFFFFF) with ZERO off-white tint, ZERO paper texture, ZERO shadows, and ZERO background noise.\n"
            f"{line_instruction}\n"
            "Return only the cleaned architectural base image."
        )
    return (
        f"CRITICAL BACKGROUND RULE: Use a clean uniform solid background of exact color {color} with ZERO paper texture and ZERO shadows.\n"
        f"{line_instruction}\n"
        "Return only the cleaned architectural base image."
    )


def _validate_analysis(
    analysis: dict,
    background_color: str = "#FFFFFF",
    wall_color: str = "#000000",
    preset: str = "evacuation",
) -> str:
    """Extrait et valide le ``compact_edit_prompt``. Renvoie le prompt."""
    if not isinstance(analysis, dict):
        raise GrokCleaningError(
            "analysis_not_object",
            error_code="ANALYSIS_FAILED",
            user_message="L'analyse n'est pas structurée correctement.",
        )

    prompt = str(analysis.get("compact_edit_prompt", "")).strip()
    if not prompt:
        raise GrokCleaningError(
            "missing_compact_edit_prompt",
            error_code="ANALYSIS_FAILED",
            user_message="L'analyse n'a pas produit d'instructions assez spécifiques.",
        )

    background_color = normalize_hex_color(background_color, "#FFFFFF")
    wall_color = normalize_hex_color(wall_color, "#000000")

    if preset == "sketch":
        prompt = (
            f"{SKETCH_GENERATION_REQUIREMENTS.format(wall_color=wall_color, background_color=background_color)}\n\n"
            "SOURCE-SPECIFIC GEOMETRY ANALYSIS:\n"
            f"{prompt}"
        )

    color_instruction = _format_background_color_instruction(
        background_color,
        wall_color=wall_color,
        preset=preset,
    )
    standard_ending = (
        "Use a clean pure white background and retain crisp black architectural linework.\n"
        "Return only the cleaned architectural base image."
    )
    if standard_ending in prompt:
        prompt = prompt.replace(standard_ending, color_instruction)
    elif "Return only the cleaned architectural base image." in prompt:
        prompt = prompt.replace("Return only the cleaned architectural base image.", color_instruction)
    else:
        prompt = f"{prompt}\n\n{color_instruction}"

    if len(prompt) > MAX_EDIT_PROMPT_LENGTH:
        prompt = prompt[:MAX_EDIT_PROMPT_LENGTH - len(color_instruction) - 20] + "\n\n" + color_instruction
    return prompt


def analyze_and_clean_plan(
    image_bytes: bytes,
    api_key: str,
    background_color: str = "#FFFFFF",
    wall_color: str = "#000000",
    preset: str = "evacuation",
    on_generation_started=None,
) -> GrokCleaningResult:
    """Pipeline complet : analyse Grok → prompt compact → génération image 2K.

    Supporte preset="evacuation", preset="autocad" ou preset="sketch".
    Lève :class:`GrokCleaningError` (ou :class:`MissingXaiApiKeyError`) à tout
    stade en cas d'échec.
    """
    if not api_key or not str(api_key).strip():
        raise MissingXaiApiKeyError("missing_api_key")

    analysis_model = _get_analysis_model()
    edit_model = _get_edit_model()
    resolution = _get_resolution()

    instructions = {
        "evacuation": ANALYSIS_INSTRUCTION,
        "autocad": AUTOCAD_ANALYSIS_INSTRUCTION,
        "sketch": SKETCH_ANALYSIS_INSTRUCTION,
    }
    instruction = instructions.get(preset, ANALYSIS_INSTRUCTION)

    source_data_url = image_bytes_to_data_url(image_bytes)
    from xai_sdk import Client
    client = Client(api_key=api_key, timeout=_get_request_timeout())

    # ── Étape 1 : analyse ────────────────────────────────────────────────
    try:
        analysis = _run_analysis(client, source_data_url, analysis_model, instruction=instruction)
    except GrokCleaningError:
        raise
    except Exception as exc:
        # gRPC lève grpc.RpcError ; on le mappe. Tout autre échec est générique.
        if _looks_like_grpc_error(exc):
            raise _map_grpc_error(exc) from exc
        raise GrokCleaningError(
            f"analysis_failed:{exc.__class__.__name__}",
            error_code="ANALYSIS_FAILED",
            user_message="L'analyse du plan a échoué.",
        ) from exc

    generation_prompt = _validate_analysis(
        analysis,
        background_color=background_color,
        wall_color=wall_color,
        preset=preset,
    )

    # ── Étape 2 : génération de l'image nettoyée ─────────────────────────
    if on_generation_started is not None:
        on_generation_started()

    # On demande directement les bytes (base64) au SDK : l'URL temporaire
    # renvoyée par xAI est éphémère et son téléchargement échoue souvent
    # (expiration, redirect, en-têtes). Récupérer .image évite ce aller-retour.
    try:
        edit_response = client.image.sample(
            prompt=generation_prompt,
            model=edit_model,
            image_url=source_data_url,
            resolution=resolution,
            image_format="base64",
        )
    except Exception as exc:
        if _looks_like_grpc_error(exc):
            raise _map_grpc_error(exc) from exc
        raise GrokCleaningError(
            f"image_generation_failed:{exc.__class__.__name__}",
            error_code="IMAGE_GENERATION_FAILED",
            user_message="La génération de l'image nettoyée a échoué.",
        ) from exc

    cleaned_image_bytes = _extract_image_bytes(edit_response)
    cleaned_image_bytes = _normalize_background_color(cleaned_image_bytes, background_color)

    return GrokCleaningResult(
        analysis=analysis,
        generation_prompt=generation_prompt,
        cleaned_image_bytes=cleaned_image_bytes,
        analysis_model=analysis_model,
        image_model=edit_model,
        warnings=[],
        status="success",
    )


def _normalize_background_color(image_bytes: bytes, target_hex: str = "#FFFFFF") -> bytes:
    """Post-processe l'image générée par Grok pour éliminer tout effet 'off-white' / grain de papier
    et forcer un fond uni parfait correspondant à la couleur HEX demandée (#FFFFFF blanc sec par défaut).
    """
    if not image_bytes:
        return image_bytes

    try:
        image_array = np.frombuffer(image_bytes, dtype=np.uint8)
        img = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
        if img is None:
            return image_bytes

        hex_clean = (target_hex or "#FFFFFF").strip().lstrip('#')
        if len(hex_clean) == 3:
            hex_clean = ''.join(c * 2 for c in hex_clean)
        if len(hex_clean) != 6:
            hex_clean = "FFFFFF"

        r = int(hex_clean[0:2], 16)
        g = int(hex_clean[2:4], 16)
        b = int(hex_clean[4:6], 16)
        target_bgr = np.array([b, g, r], dtype=np.uint8)

        target_luminance = (0.299 * r + 0.587 * g + 0.114 * b)
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        saturation = hsv[:, :, 1]
        value = hsv[:, :, 2]

        if target_luminance >= 128:
            # Fond clair : on nettoie tous les pixels de fond clairs (value > 185 et faible saturation)
            bg_mask = (value > 185) & (saturation < 45)
        else:
            # Fond sombre : on nettoie tous les pixels de fond sombres (value < 70 et faible saturation)
            bg_mask = (value < 70) & (saturation < 45)

        img[bg_mask] = target_bgr

        ret, buffer = cv2.imencode('.png', img)
        if ret:
            return buffer.tobytes()
    except Exception as exc:
        logger.warning("_normalize_background_color failed: %s", exc)

    return image_bytes


def _looks_like_grpc_error(exc: Exception) -> bool:
    """gRPC n'est pas toujours importable au moment du test ; on reste défensif."""
    if exc.__class__.__module__.startswith("grpc"):
        return True
    return hasattr(exc, "code") and hasattr(exc, "details")
