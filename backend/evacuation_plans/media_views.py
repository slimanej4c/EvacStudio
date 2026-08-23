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
    MEDIA_EXPIRY_PARAM,
    MEDIA_SIGNATURE_PARAM,
    normalize_media_path,
    verify_media_signature,
)
from .throttles import SignedMediaRateThrottle

logger = logging.getLogger(__name__)

# Types renvoyés tels quels. Tout le reste est servi en octets bruts, pour
# qu'un fichier ne soit jamais interprété par le navigateur.
SAFE_INLINE_CONTENT_TYPES = {
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'image/bmp', 'image/tiff', 'application/pdf',
}


class ProtectedMediaView(APIView):
    """Sert un fichier de MEDIA_ROOT après vérification.

    L'accès est accordé dans deux cas seulement :

    * l'URL porte une signature valide et non expirée — le cas d'une balise
      ``<img>``, qui ne peut pas transmettre d'en-tête ;
    * la requête est authentifiée — le cas d'un client d'API.

    Toute autre requête reçoit 403, et un chemin invalide 404, sans jamais
    révéler d'emplacement réel sur le serveur.
    """

    # La permission est décidée dans `get` : une URL signée doit fonctionner
    # sans jeton, sinon les images ne s'afficheraient pas.
    permission_classes = [permissions.AllowAny]
    # Do not use DRF's generic anonymous bucket here: one editor load requests
    # the whole pictogram library and would exhaust its 60/hour allowance.
    throttle_classes = [SignedMediaRateThrottle]

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

        signature_ok = verify_media_signature(
            relative_path,
            request.GET.get(MEDIA_EXPIRY_PARAM),
            request.GET.get(MEDIA_SIGNATURE_PARAM),
        )
        if not signature_ok and not (request.user and request.user.is_authenticated):
            return Response(
                {"detail": "Authentification requise pour accéder à ce fichier."},
                status=status.HTTP_403_FORBIDDEN,
            )

        absolute_path = os.path.join(settings.MEDIA_ROOT, relative_path)
        if not os.path.isfile(absolute_path):
            raise Http404

        content_type = (
            mimetypes.guess_type(relative_path)[0] or 'application/octet-stream'
        )
        # Un SVG rendu en ligne s'exécute sur cette origine. Servi en octets
        # bruts et en pièce jointe, il redevient un simple fichier — l'éditeur
        # ne le charge que via <img>, ce qui reste possible.
        if content_type not in SAFE_INLINE_CONTENT_TYPES:
            content_type = 'application/octet-stream'

        if getattr(settings, 'MEDIA_USE_X_ACCEL_REDIRECT', False):
            # Nginx sert le fichier depuis une `location internal`, donc
            # inatteignable directement. Django garde la décision, sans lire
            # le fichier ni occuper un worker pendant le transfert.
            response = HttpResponse(status=200)
            response['X-Accel-Redirect'] = (
                f"{settings.MEDIA_X_ACCEL_LOCATION}{quote(relative_path)}"
            )
            # Laisser Nginx fixer la longueur ; la conserver ici tronquerait.
            del response['Content-Type']
            response['Content-Type'] = content_type
        else:
            response = FileResponse(open(absolute_path, 'rb'), content_type=content_type)

        response['X-Content-Type-Options'] = 'nosniff'
        if content_type == 'application/octet-stream':
            filename = os.path.basename(relative_path)
            response['Content-Disposition'] = f'attachment; filename="{filename}"'
        # Privé : ces fichiers ne doivent pas finir dans un cache partagé.
        response['Cache-Control'] = 'private, max-age=3600'
        return response
