"""One place deciding what an API error tells the caller.

DRF renders its own exceptions safely, but anything it does not recognise —
a bug, a broken third-party call, a database error — reaches the client as a
500. With DEBUG on that is a full traceback; the risk is that a server is
deployed with DEBUG left on, or that an exception message carries a filesystem
path or a query. The detail belongs in the log, not in the response.
"""

import logging

from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)


def safe_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is not None:
        # DRF already turned this into a deliberate, user-facing message.
        return response

    view = context.get('view')
    request = context.get('request')
    logger.exception(
        "api.unhandled_exception view=%s path=%s user_id=%s",
        view.__class__.__name__ if view else '?',
        getattr(request, 'path', '?'),
        getattr(getattr(request, 'user', None), 'id', None),
    )
    # Deliberately returns None: Django's own handler takes over, which honours
    # DEBUG for local work and renders a bare 500 in production. The value added
    # here is the log line above, written either way.
    return None
