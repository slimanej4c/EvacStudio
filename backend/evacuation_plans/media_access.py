"""Accès contrôlé aux fichiers de ``MEDIA_ROOT``.

Pourquoi une URL signée plutôt qu'un simple contrôle d'authentification
----------------------------------------------------------------------

Les plans sont affichés par des balises ``<img>`` et par ``new Image()`` dans
l'éditeur Konva. **Aucune de ces deux API ne permet d'ajouter un en-tête
HTTP**, et le jeton JWT d'EvacStudio vit dans ``localStorage``, pas dans un
cookie envoyé automatiquement. Exiger ``Authorization`` sur ``/media/`` aurait
donc cassé l'affichage de tous les plans, de tous les pictogrammes et tous les
exports — exactement ce qu'il fallait éviter.

La solution retenue place la preuve d'autorisation *dans l'URL* : le serveur
signe le chemin et une date d'expiration, le navigateur n'a rien à ajouter.
C'est le mécanisme des URL pré-signées (S3, GCS). La signature n'est pas une
donnée personnelle et ne révèle rien : elle ne prouve que « ce serveur a
autorisé ce chemin jusqu'à cette date ».

Deux voies d'accès sont acceptées :

1. une signature valide et non expirée — le cas des ``<img>`` ;
2. une requête authentifiée — le cas d'un client d'API qui possède un jeton.

En production le fichier n'est pas lu par Python : Django répond
``X-Accel-Redirect`` et Nginx sert le fichier depuis une ``location internal``,
donc inaccessible directement. Django reste le seul point de décision, sans en
payer le coût en bande passante.
"""

import hashlib
import hmac
import os
import time
from urllib.parse import quote

from django.conf import settings

# Étiquette de dérivation propre à cet usage : la clé de signature des médias
# n'est ainsi jamais la même que celle qui chiffre les clés API.
_DERIVATION_LABEL = b':evacstudio-media-url:v1'

# Durée de validité par défaut. Doit couvrir une session d'édition complète :
# l'URL est signée au chargement du plan et réutilisée tant que l'onglet reste
# ouvert.
DEFAULT_MEDIA_URL_TTL = 12 * 3600

MEDIA_SIGNATURE_PARAM = 'sig'
MEDIA_EXPIRY_PARAM = 'exp'


def _signing_key():
    return hashlib.sha256(settings.SECRET_KEY.encode('utf-8') + _DERIVATION_LABEL).digest()


def normalize_media_path(raw_path):
    """Chemin relatif sûr, ou ``None`` s'il tente de sortir de MEDIA_ROOT.

    Le contrôle est fait sur le chemin *résolu* et non sur la chaîne : c'est le
    seul moyen d'attraper aussi les liens symboliques et les encodages
    exotiques une fois décodés par Django.
    """
    if not raw_path:
        return None

    candidate = str(raw_path).replace('\\', '/').lstrip('/')
    if '\x00' in candidate:
        return None

    media_root = os.path.realpath(settings.MEDIA_ROOT)
    absolute = os.path.realpath(os.path.join(media_root, candidate))
    if absolute != media_root and not absolute.startswith(media_root + os.sep):
        return None

    relative = os.path.relpath(absolute, media_root)
    if relative.startswith('..'):
        return None
    return relative.replace(os.sep, '/')


def _signature_for(relative_path, expires_at):
    message = f'{relative_path}:{expires_at}'.encode('utf-8')
    return hmac.new(_signing_key(), message, hashlib.sha256).hexdigest()


def sign_media_path(relative_path, ttl=None):
    """URL relative signée pour un chemin de MEDIA_ROOT, ou '' s'il est invalide."""
    normalized = normalize_media_path(relative_path)
    if normalized is None:
        return ''

    ttl = ttl or getattr(settings, 'MEDIA_URL_TTL_SECONDS', DEFAULT_MEDIA_URL_TTL)
    expires_at = int(time.time()) + int(ttl)
    signature = _signature_for(normalized, expires_at)
    quoted = quote(normalized)
    return (
        f'{settings.PROTECTED_MEDIA_URL}{quoted}'
        f'?{MEDIA_EXPIRY_PARAM}={expires_at}&{MEDIA_SIGNATURE_PARAM}={signature}'
    )


def build_signed_media_url(request, relative_path, ttl=None):
    """Version absolue de :func:`sign_media_path`, pour les réponses d'API."""
    signed = sign_media_path(relative_path, ttl=ttl)
    if not signed:
        return ''
    return request.build_absolute_uri(signed) if request is not None else signed


def signed_url_for_field(request, field_file, ttl=None):
    """URL signée d'un ``FileField``, ou '' si le champ est vide."""
    if not field_file or not getattr(field_file, 'name', ''):
        return ''
    return build_signed_media_url(request, field_file.name, ttl=ttl)


def verify_media_signature(relative_path, expires_at, signature):
    """Vrai si la signature couvre ce chemin et n'est pas expirée."""
    if not signature or not expires_at:
        return False
    try:
        expiry = int(expires_at)
    except (TypeError, ValueError):
        return False
    if expiry < time.time():
        return False
    # Comparaison à temps constant : une comparaison naïve laisse fuir la
    # signature attendue, octet par octet.
    return hmac.compare_digest(_signature_for(relative_path, expiry), str(signature))
