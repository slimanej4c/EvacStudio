"""Limitation de débit sur la page de connexion de l'admin Django.

L'API est protégée par les throttles de DRF, mais ``/admin/login/`` est une vue
Django ordinaire : elle ne passe pas par DRF et acceptait donc un nombre illimité
de tentatives. L'admin étant le point le plus sensible du projet — il permet de
créer d'autres administrateurs — c'est la surface la plus rentable à deviner.

Volontairement sans dépendance : ``django-axes`` apporterait des modèles, des
migrations et un backend d'authentification pour un besoin que le cache couvre
en quelques lignes. Le compteur est en cache, donc partagé entre workers dès que
le cache l'est (Redis, Memcached) ; avec le cache local par défaut, chaque
worker compte séparément — la protection est alors approximative mais réelle.
"""

import logging
import time

from django.conf import settings
from django.core.cache import cache
from django.http import HttpResponse

logger = logging.getLogger(__name__)

CACHE_PREFIX = 'admin-login-attempts:'
DEFAULT_MAX_ATTEMPTS = 10
DEFAULT_WINDOW_SECONDS = 300


def _client_ip(request):
    """Adresse du client, en tenant compte du reverse proxy.

    ``X-Forwarded-For`` est falsifiable si rien ne le réécrit ; la configuration
    Nginx fournie le renseigne elle-même, ce qui rend la première valeur fiable
    derrière ce proxy. Sans proxy, ``REMOTE_ADDR`` fait foi.
    """
    if getattr(settings, 'ADMIN_LOGIN_TRUST_FORWARDED_FOR', not settings.DEBUG):
        forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
        if forwarded:
            return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', '') or 'unknown'


class AdminLoginRateLimitMiddleware:
    """Bloque une adresse après trop de tentatives de connexion à l'admin."""

    def __init__(self, get_response):
        self.get_response = get_response
        self.max_attempts = int(
            getattr(settings, 'ADMIN_LOGIN_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS)
        )
        self.window = int(
            getattr(settings, 'ADMIN_LOGIN_WINDOW_SECONDS', DEFAULT_WINDOW_SECONDS)
        )

    def __call__(self, request):
        if not self._is_admin_login_attempt(request):
            return self.get_response(request)

        key = f'{CACHE_PREFIX}{_client_ip(request)}'
        attempts = cache.get(key, 0)
        if attempts >= self.max_attempts:
            logger.warning(
                "admin.login.blocked ip=%s attempts=%s", _client_ip(request), attempts
            )
            retry_after = self.window
            response = HttpResponse(
                "Trop de tentatives de connexion. Réessayez plus tard.",
                status=429,
                content_type='text/plain; charset=utf-8',
            )
            response['Retry-After'] = str(retry_after)
            return response

        response = self.get_response(request)

        # Une connexion réussie redirige (302) ; un échec réaffiche le
        # formulaire (200). Seuls les échecs sont comptés, et une réussite
        # remet le compteur à zéro.
        if response.status_code == 200:
            # `add` puis `incr` : `incr` seul échoue si la clé n'existe pas, et
            # `add` ne fait rien si elle existe déjà — pas de course.
            cache.add(key, 0, self.window)
            try:
                cache.incr(key)
            except ValueError:  # la clé a expiré entre les deux appels
                cache.set(key, 1, self.window)
            logger.warning(
                "admin.login.failed ip=%s at=%s", _client_ip(request), int(time.time())
            )
        elif response.status_code in (301, 302):
            cache.delete(key)

        return response

    @staticmethod
    def _is_admin_login_attempt(request):
        if request.method != 'POST':
            return False
        path = request.path
        # `/admin/login/` en temps normal, et la redirection de session expirée.
        return path.endswith('/admin/login/') or path == '/admin/login'
