"""Chemins protégés et session de navigateur pour les fichiers de MEDIA_ROOT.

Une URL de média ne contient aucun secret : la copier ne donne jamais accès au
fichier. Les balises ``<img>`` et le canvas s'authentifient avec un cookie dédié,
HttpOnly et signé, que Django émet uniquement après une authentification JWT.
La vue média contrôle ensuite le propriétaire ou l'invitation dans la base.

En production Django conserve la décision d'autorisation puis délègue seulement
le transfert à la location Nginx ``internal`` via ``X-Accel-Redirect``.
"""

import os
from urllib.parse import quote, unquote, urlsplit

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.utils.crypto import constant_time_compare

MEDIA_SESSION_SALT = 'evacstudio.media-session.v1'


def decode_media_path(raw_path):
    """Decode URL escaping until the filesystem path is reached.

    Local Django tests usually pass decoded path segments to the view, while
    production stacks can forward an already-escaped path. Decoding a bounded
    number of times makes ``%20`` and accidental ``%2520`` converge to the same
    filesystem name, then the realpath check below keeps traversal attempts out.
    """
    candidate = str(raw_path)
    for _ in range(3):
        decoded = unquote(candidate)
        if decoded == candidate:
            break
        candidate = decoded
    return candidate


def strip_media_url_prefix(raw_path):
    """Accept legacy/public media URLs and return the stored relative path."""
    candidate = decode_media_path(raw_path).replace('\\', '/').strip()
    if '://' in candidate:
        candidate = urlsplit(candidate).path
    candidate = candidate.lstrip('/')

    prefixes = []
    for prefix in (
        getattr(settings, 'PROTECTED_MEDIA_URL', ''),
        getattr(settings, 'MEDIA_URL', ''),
        '/api/media/',
    ):
        normalized_prefix = str(prefix or '').strip('/')
        if normalized_prefix:
            prefixes.append(f'{normalized_prefix}/')

    for prefix in sorted(set(prefixes), key=len, reverse=True):
        if candidate.startswith(prefix):
            return candidate[len(prefix):]
    return candidate


def normalize_media_path(raw_path):
    """Chemin relatif sûr, ou ``None`` s'il tente de sortir de MEDIA_ROOT.

    Le contrôle est fait sur le chemin *résolu* et non sur la chaîne : c'est le
    seul moyen d'attraper aussi les liens symboliques et les encodages
    exotiques une fois décodés par Django.
    """
    if not raw_path:
        return None

    candidate = strip_media_url_prefix(raw_path)
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


def protected_media_path(relative_path):
    """Return the protected relative URL, without any bearer credential."""
    normalized = normalize_media_path(relative_path)
    if normalized is None:
        return ''
    return f'{settings.PROTECTED_MEDIA_URL}{quote(normalized, safe="/")}'


def media_path_aliases(relative_path):
    """Stored-name variants accepted for pre-protected-media rows."""
    normalized = normalize_media_path(relative_path)
    if normalized is None:
        return []

    encoded = quote(normalized, safe='/')
    aliases = {normalized, encoded}
    for prefix in (getattr(settings, 'MEDIA_URL', ''), getattr(settings, 'PROTECTED_MEDIA_URL', '')):
        clean = str(prefix or '').strip('/')
        if not clean:
            continue
        aliases.add(f'{clean}/{normalized}')
        aliases.add(f'/{clean}/{normalized}')
        aliases.add(f'{clean}/{encoded}')
        aliases.add(f'/{clean}/{encoded}')
    return sorted(aliases)


def build_protected_media_url(request, relative_path):
    """Absolute protected URL used by API serializers."""
    protected = protected_media_path(relative_path)
    if not protected:
        return ''
    return request.build_absolute_uri(protected) if request is not None else protected


def protected_url_for_field(request, field_file):
    """Protected URL for a ``FileField``, or an empty string."""
    if not field_file or not getattr(field_file, 'name', ''):
        return ''
    return build_protected_media_url(request, field_file.name)


def media_session_value(user):
    """Create a short-lived credential bound to a user and password state."""
    return signing.dumps(
        {
            'user_id': user.pk,
            'auth_hash': user.get_session_auth_hash(),
        },
        key=settings.SECRET_KEY,
        salt=MEDIA_SESSION_SALT,
        compress=True,
    )


def set_media_session_cookie(response, user):
    """Attach the HttpOnly media session after successful JWT authentication."""
    response.set_cookie(
        settings.MEDIA_SESSION_COOKIE_NAME,
        media_session_value(user),
        max_age=settings.MEDIA_SESSION_COOKIE_AGE_SECONDS,
        httponly=True,
        secure=not settings.DEBUG,
        samesite='Lax',
        path='/',
    )
    return response


def clear_media_session_cookie(response):
    response.delete_cookie(
        settings.MEDIA_SESSION_COOKIE_NAME,
        path='/',
        samesite='Lax',
    )
    return response


def media_session_user(request):
    """Return the active user authenticated by the dedicated media cookie."""
    value = request.COOKIES.get(settings.MEDIA_SESSION_COOKIE_NAME)
    if not value:
        return None
    try:
        payload = signing.loads(
            value,
            key=settings.SECRET_KEY,
            salt=MEDIA_SESSION_SALT,
            max_age=settings.MEDIA_SESSION_COOKIE_AGE_SECONDS,
        )
        user_id = payload['user_id']
        auth_hash = payload['auth_hash']
    except (KeyError, TypeError, signing.BadSignature):
        return None

    user = get_user_model()._default_manager.filter(pk=user_id, is_active=True).first()
    if user is None or not constant_time_compare(auth_hash, user.get_session_auth_hash()):
        return None
    return user
