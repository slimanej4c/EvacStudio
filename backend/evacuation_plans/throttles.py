"""Throttle scopes used by the sensitive endpoints.

Rates live in settings so they can be tuned per deployment without a code
change; the classes here only name the buckets.
"""

from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class LoginRateThrottle(AnonRateThrottle):
    """Password guessing against the token endpoint.

    Keyed on the client address because the attacker chooses the username, so
    a per-account counter would simply be sidestepped by rotating it.
    """

    scope = 'login'


class AiRateThrottle(UserRateThrottle):
    """Calls that cost money at OpenAI or xAI."""

    scope = 'ai'


class UploadRateThrottle(UserRateThrottle):
    """Endpoints that write a file to disk."""

    scope = 'upload'


class SignedMediaRateThrottle(AnonRateThrottle):
    """Downloads made through a signed media URL.

    Images loaded by ``<img>`` do not carry the JWT header, so they are
    anonymous from DRF's point of view even though their URL is signed. Giving
    this traffic its own bucket prevents the generic 60/hour anonymous limit
    from blanking the complete pictogram library after its first page load.
    """

    scope = 'media'
