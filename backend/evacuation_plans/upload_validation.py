"""Validation of every file a user uploads as a plan background.

The rule applied here is that a file is what its *content* says it is, never
what its name or its Content-Type header claims. Both are chosen by the client
and neither survives contact with an attacker.

This matters more than it looks: uploads are written under ``MEDIA_ROOT`` and
served back by the web server, usually from the same domain as the application.
An ``.html`` or an unsanitised ``.svg`` stored there is not an inert document —
it is a script running on the application's own origin.
"""

import io
import os
import re

from PIL import Image, UnidentifiedImageError

# Generous enough for a scanned A0 floor plan, small enough that a single
# request cannot fill the disk.
MAX_BACKGROUND_UPLOAD_BYTES = 30 * 1024 * 1024
MAX_IMAGE_SIDE = 20_000
MAX_IMAGE_PIXELS = 80_000_000
MAX_UPLOAD_NAME_LENGTH = 80

# Extension -> the Pillow formats accepted for it. An SVG carries no Pillow
# format: it is XML, and goes through the SVG sanitiser instead.
ALLOWED_IMAGE_EXTENSIONS = {
    '.png': {'PNG'},
    '.jpg': {'JPEG'},
    '.jpeg': {'JPEG'},
    '.webp': {'WEBP'},
    '.gif': {'GIF'},
    '.bmp': {'BMP'},
    '.tif': {'TIFF'},
    '.tiff': {'TIFF'},
}
ALLOWED_BACKGROUND_EXTENSIONS = set(ALLOWED_IMAGE_EXTENSIONS) | {'.pdf', '.svg'}

PDF_MAGIC = b'%PDF-'


class UploadRejected(Exception):
    """Carries the message shown to the user; never the technical detail."""


def safe_upload_name(raw_name, fallback='plan'):
    """A filename that cannot escape its directory or confuse a shell.

    Django already refuses relative paths in ``FileField``; this trims the
    result down to something predictable as well — no control characters, no
    separators, no 300-character names.
    """
    base = os.path.basename(str(raw_name or ''))
    stem, extension = os.path.splitext(base)
    extension = extension.lower()
    stem = re.sub(r'[^A-Za-z0-9._-]+', '-', stem).strip('-._')
    stem = re.sub(r'-{2,}', '-', stem)[:MAX_UPLOAD_NAME_LENGTH]
    return f"{stem or fallback}{extension}"


def _read_upload(upload):
    """The whole file, with the pointer left where the caller found it."""
    position = upload.tell() if hasattr(upload, 'tell') else 0
    upload.seek(0)
    try:
        return upload.read()
    finally:
        upload.seek(position)


def validate_image_bytes(content, label="Le fichier"):
    """Confirms the bytes really decode as an image of a reasonable size."""
    try:
        with Image.open(io.BytesIO(content)) as image:
            detected_format = image.format
            width, height = image.size
            if (
                width <= 0 or height <= 0
                or width > MAX_IMAGE_SIDE or height > MAX_IMAGE_SIDE
                or width * height > MAX_IMAGE_PIXELS
            ):
                # Refused before decoding: a small file can declare enormous
                # dimensions and make the decoder allocate gigabytes.
                raise UploadRejected(f"{label} dépasse les dimensions maximales autorisées.")
        with Image.open(io.BytesIO(content)) as image:
            image.verify()
    except UploadRejected:
        raise
    except (UnidentifiedImageError, OSError, ValueError):
        raise UploadRejected(f"{label} n'est pas une image valide.")
    return detected_format


PILLOW_FORMAT_TO_EXTENSION = {
    'PNG': '.png', 'JPEG': '.jpg', 'WEBP': '.webp',
    'GIF': '.gif', 'BMP': '.bmp', 'TIFF': '.tif',
}


def _sniff_extension(content):
    """Best guess at an extension for a file that arrived without a name."""
    if content.startswith(PDF_MAGIC):
        return '.pdf'
    stripped = content[:512].lstrip()
    if stripped.startswith(b'<?xml') or stripped.startswith(b'<svg'):
        return '.svg'
    try:
        with Image.open(io.BytesIO(content)) as image:
            return PILLOW_FORMAT_TO_EXTENSION.get(image.format, '')
    except (UnidentifiedImageError, OSError, ValueError):
        return ''


def validate_background_upload(upload):
    """Checks one uploaded background and returns its plan background type.

    Returns ``'pdf'`` or ``'image'``, matching ``EvacuationPlan.background_type``.
    Raises :class:`UploadRejected` with a message meant for the user.
    """
    if upload is None:
        raise UploadRejected("Aucun fichier fourni.")

    size = getattr(upload, 'size', None)
    if size is not None and size > MAX_BACKGROUND_UPLOAD_BYTES:
        megabytes = MAX_BACKGROUND_UPLOAD_BYTES // (1024 * 1024)
        raise UploadRejected(f"Le fichier dépasse la taille maximale de {megabytes} Mo.")

    extension = os.path.splitext(getattr(upload, 'name', '') or '')[1].lower()

    content = _read_upload(upload)
    if not content:
        raise UploadRejected("Le fichier est vide.")

    if not extension:
        # A client may send a nameless blob. Read the type out of the bytes
        # rather than refusing: the content check below is the real gate, and
        # the extension only picks which one runs.
        extension = _sniff_extension(content)

    if extension not in ALLOWED_BACKGROUND_EXTENSIONS:
        allowed = ', '.join(sorted(ALLOWED_BACKGROUND_EXTENSIONS))
        raise UploadRejected(f"Format de fichier non autorisé. Formats acceptés : {allowed}.")
    if len(content) > MAX_BACKGROUND_UPLOAD_BYTES:
        megabytes = MAX_BACKGROUND_UPLOAD_BYTES // (1024 * 1024)
        raise UploadRejected(f"Le fichier dépasse la taille maximale de {megabytes} Mo.")

    if not os.path.splitext(getattr(upload, 'name', '') or '')[1]:
        upload.name = f"{safe_upload_name(getattr(upload, 'name', ''))}{extension}"

    if extension == '.pdf':
        if not content.startswith(PDF_MAGIC):
            raise UploadRejected("Le fichier n'est pas un PDF valide.")
        return 'pdf'

    if extension == '.svg':
        from .pictogram_security import validate_and_sanitize_pictogram_svg

        sanitized, error = validate_and_sanitize_pictogram_svg(content)
        if error:
            raise UploadRejected(error)
        # Stored sanitised, so what the server serves is what it validated.
        upload.seek(0)
        upload.file = io.BytesIO(sanitized)
        upload.size = len(sanitized)
        return 'image'

    detected = validate_image_bytes(content)
    if detected not in ALLOWED_IMAGE_EXTENSIONS[extension]:
        # A PNG named .jpg is harmless; an HTML page named .png is not. Both
        # are refused, because only the content decides what this file is.
        raise UploadRejected(
            "Le contenu du fichier ne correspond pas à son extension."
        )
    return 'image'
