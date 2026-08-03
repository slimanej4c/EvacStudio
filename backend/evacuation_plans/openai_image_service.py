import base64
import json
import mimetypes
import os
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


OPENAI_IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits"
DEFAULT_GPT_IMAGE_MODEL = "gpt-image-1"


class OpenAIImageServiceError(Exception):
    pass


def _read_image_bytes(image):
    if isinstance(image, bytes):
        return image, "plan.png", "image/png"

    if isinstance(image, str):
        content_type = mimetypes.guess_type(image)[0] or "image/png"
        with open(image, "rb") as image_file:
            return image_file.read(), image.rsplit("/", 1)[-1] or "plan.png", content_type

    name = getattr(image, "name", "plan.png") or "plan.png"
    content_type = getattr(image, "content_type", None) or mimetypes.guess_type(name)[0] or "image/png"
    image.seek(0)
    image_bytes = image.read()
    image.seek(0)
    return image_bytes, name, content_type


def _multipart_body(fields, files):
    boundary = f"----planevacuation-{uuid.uuid4().hex}"
    chunks = []

    for name, value in fields.items():
        chunks.extend([
            f"--{boundary}\r\n".encode("utf-8"),
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"),
            str(value).encode("utf-8"),
            b"\r\n",
        ])

    for name, file_info in files.items():
        filename, content_type, content = file_info
        filename = os.path.basename(filename).replace('"', "")
        chunks.extend([
            f"--{boundary}\r\n".encode("utf-8"),
            (
                f'Content-Disposition: form-data; name="{name}"; '
                f'filename="{filename}"\r\n'
            ).encode("utf-8"),
            f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"),
            content,
            b"\r\n",
        ])

    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return boundary, b"".join(chunks)


def _extract_image_bytes(response_data):
    data = response_data.get("data") or []
    if not data:
        raise OpenAIImageServiceError("OpenAI image response did not contain an image.")

    b64_image = data[0].get("b64_json")
    if not b64_image:
        raise OpenAIImageServiceError("OpenAI image response did not contain b64_json.")

    try:
        return base64.b64decode(b64_image)
    except ValueError as exc:
        raise OpenAIImageServiceError("OpenAI image response contained invalid base64.") from exc


def clean_plan_with_gpt_image(image, prompt, api_key, model=DEFAULT_GPT_IMAGE_MODEL):
    if not prompt or not str(prompt).strip():
        raise ValueError("prompt est obligatoire.")
    if not api_key or not str(api_key).strip():
        raise ValueError("api_key est obligatoire.")

    image_bytes, filename, content_type = _read_image_bytes(image)
    boundary, body = _multipart_body(
        fields={
            "model": model,
            "prompt": prompt,
            "n": 1,
            "size": "auto",
            "quality": "auto",
            "output_format": "png",
        },
        files={
            "image": (filename, content_type, image_bytes),
        },
    )

    request = Request(
        OPENAI_IMAGE_EDIT_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=120) as response:
            response_data = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise OpenAIImageServiceError(f"OpenAI image service failed with status {exc.code}.") from exc
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise OpenAIImageServiceError("OpenAI image service request failed.") from exc

    return _extract_image_bytes(response_data)
