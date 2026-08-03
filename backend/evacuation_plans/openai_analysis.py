import base64
from io import BytesIO
import json
import mimetypes
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings


OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
DEFAULT_ANALYSIS_MODEL = "gpt-5"


class OpenAIPlanAnalysisError(Exception):
    pass


PLAN_ANALYSIS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "murs",
        "ouvertures",
        "machines",
        "objets",
        "texte",
        "annotations",
        "qualite",
        "perspective",
        "ambiguites",
    ],
    "properties": {
        "murs": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["description", "position", "orientation", "epaisseur", "confiance"],
                "properties": {
                    "description": {"type": "string"},
                    "position": {"type": "string"},
                    "orientation": {"type": "string"},
                    "epaisseur": {"type": "string"},
                    "confiance": {"type": "number"},
                },
            },
        },
        "ouvertures": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["type", "description", "position", "confiance"],
                "properties": {
                    "type": {"type": "string"},
                    "description": {"type": "string"},
                    "position": {"type": "string"},
                    "confiance": {"type": "number"},
                },
            },
        },
        "machines": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["type", "description", "position", "confiance"],
                "properties": {
                    "type": {"type": "string"},
                    "description": {"type": "string"},
                    "position": {"type": "string"},
                    "confiance": {"type": "number"},
                },
            },
        },
        "objets": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["type", "description", "position", "confiance"],
                "properties": {
                    "type": {"type": "string"},
                    "description": {"type": "string"},
                    "position": {"type": "string"},
                    "confiance": {"type": "number"},
                },
            },
        },
        "texte": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["contenu", "position", "confiance"],
                "properties": {
                    "contenu": {"type": "string"},
                    "position": {"type": "string"},
                    "confiance": {"type": "number"},
                },
            },
        },
        "annotations": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["type", "contenu", "position", "confiance"],
                "properties": {
                    "type": {"type": "string"},
                    "contenu": {"type": "string"},
                    "position": {"type": "string"},
                    "confiance": {"type": "number"},
                },
            },
        },
        "qualite": {
            "type": "object",
            "additionalProperties": False,
            "required": ["niveau", "problemes", "confiance"],
            "properties": {
                "niveau": {"type": "string"},
                "problemes": {"type": "array", "items": {"type": "string"}},
                "confiance": {"type": "number"},
            },
        },
        "perspective": {
            "type": "object",
            "additionalProperties": False,
            "required": ["etat", "correction_necessaire", "details", "confiance"],
            "properties": {
                "etat": {"type": "string"},
                "correction_necessaire": {"type": "boolean"},
                "details": {"type": "string"},
                "confiance": {"type": "number"},
            },
        },
        "ambiguites": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["element", "raison", "position", "confiance"],
                "properties": {
                    "element": {"type": "string"},
                    "raison": {"type": "string"},
                    "position": {"type": "string"},
                    "confiance": {"type": "number"},
                },
            },
        },
    },
}


def _image_file_to_data_url(image_file):
    if isinstance(image_file, bytes):
        encoded_image = base64.b64encode(image_file).decode("ascii")
        return f"data:image/png;base64,{encoded_image}"

    if isinstance(image_file, BytesIO):
        image_file.seek(0)
        encoded_image = base64.b64encode(image_file.read()).decode("ascii")
        image_file.seek(0)
        return f"data:image/png;base64,{encoded_image}"

    content_type = getattr(image_file, "content_type", None)
    if not content_type:
        content_type = mimetypes.guess_type(getattr(image_file, "name", ""))[0]
    content_type = content_type or "image/png"

    image_file.seek(0)
    encoded_image = base64.b64encode(image_file.read()).decode("ascii")
    image_file.seek(0)
    return f"data:{content_type};base64,{encoded_image}"


def _extract_output_text(response_data):
    if response_data.get("output_text"):
        return response_data["output_text"]

    for output_item in response_data.get("output", []):
        for content_item in output_item.get("content", []):
            text = content_item.get("text")
            if text:
                return text

    raise OpenAIPlanAnalysisError("OpenAI response did not contain text output.")


def analyze_plan_image_with_openai(image_file, api_key):
    data_url = _image_file_to_data_url(image_file)
    model = getattr(settings, "OPENAI_ANALYSIS_MODEL", DEFAULT_ANALYSIS_MODEL)

    payload = {
        "model": model,
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            "Analyse ce plan d'intervention et d'evacuation. "
                            "Retourne uniquement le JSON structure demande. "
                            "Ne genere aucune image. Decris les positions en langage clair "
                            "si les coordonnees exactes ne sont pas certaines."
                        ),
                    },
                    {
                        "type": "input_image",
                        "image_url": data_url,
                        "detail": "high",
                    },
                ],
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "plan_analysis",
                "strict": True,
                "schema": PLAN_ANALYSIS_SCHEMA,
            }
        },
    }

    request = Request(
        OPENAI_RESPONSES_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=60) as response:
            response_data = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise OpenAIPlanAnalysisError(f"OpenAI analysis failed with status {exc.code}.") from exc
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise OpenAIPlanAnalysisError("OpenAI analysis request failed.") from exc

    output_text = _extract_output_text(response_data)
    try:
        return json.loads(output_text)
    except json.JSONDecodeError as exc:
        raise OpenAIPlanAnalysisError("OpenAI analysis did not return valid JSON.") from exc
