"""La seule porte d'entrée vers les fichiers de ``MEDIA_ROOT``.

Voir :mod:`evacuation_plans.media_access` pour le raisonnement derrière les URL
signées. Ce module ne contient que la vue et sa logique de service.
"""

import logging
import mimetypes
import os
from urllib.parse import quote

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .media_access import (
    media_session_user,
    normalize_media_path,
)
from .models import user_can_access_media_path
from .pictogram_catalogs import is_registered_catalogue_svg_path
from .pictogram_security import sanitize_pictogram_svg_file
from .throttles import ProtectedMediaRateThrottle

logger = logging.getLogger(__name__)

# Types renvoyés tels quels. Tout le reste est servi en octets bruts, pour
# qu'un fichier ne soit jamais interprété par le navigateur.
SAFE_INLINE_CONTENT_TYPES = {
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'image/bmp', 'image/tiff', 'image/svg+xml', 'application/pdf',
}


class ProtectedMediaView(APIView):
    """Sert un fichier de MEDIA_ROOT après vérification.

    L'accès exige un compte authentifié — par JWT pour un client d'API ou par
    le cookie média HttpOnly pour une balise ``<img>`` — puis vérifie que le
    fichier appartient au compte ou à un espace auquel il a été invité.

    Toute autre requête reçoit 403, et un chemin invalide 404, sans jamais
    révéler d'emplacement réel sur le serveur.
    """

    # La permission est décidée dans `get`, car les balises image utilisent le
    # cookie média plutôt que l'authentificateur JWT de DRF.
    permission_classes = [permissions.AllowAny]
    # Do not use DRF's generic anonymous bucket here: one editor load requests
    # the whole pictogram library and would exhaust its 60/hour allowance.
    throttle_classes = [ProtectedMediaRateThrottle]

    def get(self, request, media_path):
        relative_path = normalize_media_path(media_path)
        if relative_path is None:
            # Sortie de MEDIA_ROOT tentée : 404, pas 403 — ne pas confirmer
            # qu'un chemin hors périmètre existe.
            logger.warning(
                "media.path_rejected user_id=%s",
                getattr(getattr(request, 'user', None), 'id', None),
            )
            raise Http404

        jwt_user = request.user if request.user and request.user.is_authenticated else None
        authorized_user = jwt_user or media_session_user(request)
        if not user_can_access_media_path(authorized_user, relative_path):
            return Response(
                {"detail": "Vous n'avez pas accès à ce fichier."},
                status=status.HTTP_403_FORBIDDEN,
            )

        absolute_path = os.path.join(settings.MEDIA_ROOT, relative_path)
        if not os.path.isfile(absolute_path):
            raise Http404

        sanitized_catalogue_svg = None
        if is_registered_catalogue_svg_path(relative_path):
            sanitized_catalogue_svg, validation_error = sanitize_pictogram_svg_file(absolute_path)
            if validation_error:
                logger.warning(
                    "media.catalogue_svg_rejected path=%s reason=%s",
                    relative_path,
                    validation_error,
                )
                raise Http404

        content_type = (
            mimetypes.guess_type(relative_path)[0] or 'application/octet-stream'
        )
        # Uploaded SVG files are sanitised before storage. Registered catalogue
        # SVGs are re-sanitised below when served. Keep everything else as inert
        # bytes so arbitrary uploads cannot become same-origin documents.
        if content_type not in SAFE_INLINE_CONTENT_TYPES:
            content_type = 'application/octet-stream'

        if sanitized_catalogue_svg is not None:
            # Catalogue files are always served from the sanitized bytes. This
            # keeps a future folder addition safe even when its URL is guessed
            # directly instead of first discovered through the API.
            response = HttpResponse(
                sanitized_catalogue_svg,
                content_type='image/svg+xml',
            )
        elif getattr(settings, 'MEDIA_USE_X_ACCEL_REDIRECT', False):
            # Nginx sert le fichier depuis une `location internal`, donc
            # inatteignable directement. Django garde la décision, sans lire
            # le fichier ni occuper un worker pendant le transfert.
            response = HttpResponse(status=200)
            response['X-Accel-Redirect'] = (
                f"{settings.MEDIA_X_ACCEL_LOCATION}{quote(relative_path, safe='/')}"
            )
            # Laisser Nginx fixer la longueur ; la conserver ici tronquerait.
            del response['Content-Type']
            response['Content-Type'] = content_type
        else:
            response = FileResponse(open(absolute_path, 'rb'), content_type=content_type)

        response['X-Content-Type-Options'] = 'nosniff'
        if content_type == 'image/svg+xml':
            response['Content-Security-Policy'] = (
                "default-src 'none'; style-src 'unsafe-inline'; sandbox"
            )
        if content_type == 'application/octet-stream':
            filename = os.path.basename(relative_path)
            response['Content-Disposition'] = f'attachment; filename="{filename}"'
        # Ne pas conserver une copie après révocation d'une invitation ou
        # déconnexion. `Vary` empêche aussi tout mélange entre deux comptes.
        response['Cache-Control'] = 'private, no-store'
        response['Vary'] = 'Cookie, Authorization'
        return response
