import os
from pathlib import Path
from datetime import timedelta
import dj_database_url
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Load environmental variables from this Django backend only.
load_dotenv(BASE_DIR / '.env')

# Off unless explicitly asked for: a forgotten variable on the server must fail
# closed, not publish stack traces and settings to every visitor.
DEBUG = os.environ.get('DEBUG', 'False').lower() in ('true', '1', 't')

# Convenience key for local work only. It is public — it lives in the repository —
# so it signs nothing that matters: it is refused as soon as DEBUG is off.
_INSECURE_DEV_SECRET_KEY = 'django-insecure-8ww+72hh1przrg8mta#*%5qylxo4nf2nm2f=+7@%*2cx$#itc7'

SECRET_KEY = os.environ.get('SECRET_KEY') or _INSECURE_DEV_SECRET_KEY

if not DEBUG and SECRET_KEY == _INSECURE_DEV_SECRET_KEY:
    raise ImproperlyConfigured(
        "SECRET_KEY doit être défini hors développement : la valeur de repli est "
        "publique, et elle signe les jetons JWT ainsi que les clés API chiffrées."
    )

_allowed_hosts = [host.strip() for host in os.environ.get('ALLOWED_HOSTS', '').split(',') if host.strip()]
# '*' only while developing; in production the host header must be pinned or
# the application answers to any domain pointed at it.
ALLOWED_HOSTS = _allowed_hosts or (['*'] if DEBUG else [])

if not DEBUG and not _allowed_hosts:
    raise ImproperlyConfigured(
        "ALLOWED_HOSTS doit lister les domaines servis hors développement."
    )

# Public self-service accounts are closed by default. Existing users and the
# invitation workflow remain available. Set this explicitly to True only while
# an administrator intentionally opens registration.
PUBLIC_REGISTRATION_ENABLED = os.environ.get(
    'PUBLIC_REGISTRATION_ENABLED', 'False'
).lower() in ('true', '1', 't')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    
    # Third party apps
    'rest_framework',
    # Table des jetons de rafraîchissement révoqués. Sans elle, une déconnexion
    # ne peut être que côté client : le serveur n'a aucun moyen de refuser un
    # jeton qu'il a signé et qui n'est pas encore expiré.
    'rest_framework_simplejwt.token_blacklist',
    'corsheaders',
    
    # Custom apps
    'evacuation_plans',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware', # MUST be at the top
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    # /admin/login/ est une vue Django, hors de portée des throttles DRF.
    'evacuation_plans.admin_protection.AdminLoginRateLimitMiddleware',
]

# Force brute sur l'admin : tentatives autorisées par adresse et par fenêtre.
ADMIN_LOGIN_MAX_ATTEMPTS = int(os.environ.get('ADMIN_LOGIN_MAX_ATTEMPTS', 10))
ADMIN_LOGIN_WINDOW_SECONDS = int(os.environ.get('ADMIN_LOGIN_WINDOW_SECONDS', 300))

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

# Database configuration
# Fallback to SQLite if DATABASE_URL is not set
DATABASE_URL = os.environ.get('DATABASE_URL')
if DATABASE_URL:
    database_config = dj_database_url.config(default=DATABASE_URL, conn_max_age=600)
    if database_config['ENGINE'] == 'django.db.backends.mysql':
        # Keep MySQL aligned with Django's documented production defaults:
        # full Unicode, truncation errors instead of silent data loss, and the
        # isolation level expected by get_or_create() and concurrent requests.
        mysql_options = database_config.setdefault('OPTIONS', {})
        mysql_options.setdefault('charset', 'utf8mb4')
        mysql_options.setdefault('init_command', "SET sql_mode='STRICT_TRANS_TABLES'")
        mysql_options.setdefault('isolation_level', 'read committed')
    DATABASES = {
        'default': database_config
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

# Media files (uploaded plans)
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

# ── Accès aux médias ────────────────────────────────────────────────────────
# MEDIA_URL n'est plus servi directement : les fichiers passent par
# PROTECTED_MEDIA_URL, qui vérifie une signature ou une authentification.
# Voir evacuation_plans/media_access.py pour le raisonnement.
PROTECTED_MEDIA_URL = '/api/media/'
MEDIA_URL_TTL_SECONDS = int(os.environ.get('MEDIA_URL_TTL_SECONDS', 12 * 3600))

# En production Nginx sert le fichier depuis une `location internal`, Django ne
# fait que décider. En développement Django sert le fichier lui-même.
MEDIA_USE_X_ACCEL_REDIRECT = os.environ.get(
    'MEDIA_USE_X_ACCEL_REDIRECT', 'False' if DEBUG else 'True'
).lower() in ('true', '1', 't')
MEDIA_X_ACCEL_LOCATION = os.environ.get('MEDIA_X_ACCEL_LOCATION', '/protected-media/')

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# REST Framework Configuration
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_THROTTLE_CLASSES': (
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ),
    # Sized for a company of internal users, not for a public API: the point is
    # to make password guessing and runaway automation impossible, while a busy
    # editor session — which saves, syncs and re-renders constantly — never
    # comes close to the ceiling.
    'DEFAULT_THROTTLE_RATES': {
        'anon': os.environ.get('THROTTLE_ANON', '60/hour'),
        'user': os.environ.get('THROTTLE_USER', '2000/hour'),
        # Password guessing: unauthenticated and cheap to attempt.
        'login': os.environ.get('THROTTLE_LOGIN', '10/min'),
        # Each call costs real money at OpenAI or xAI.
        'ai': os.environ.get('THROTTLE_AI', '30/hour'),
        # Writes a file to disk.
        'upload': os.environ.get('THROTTLE_UPLOAD', '120/hour'),
        # Une ouverture de l'éditeur charge environ 90 ressources. Le quota est
        # volontairement séparé du petit quota anonyme et dimensionné pour les
        # utilisateurs internes partageant éventuellement la même adresse IP.
        'media': os.environ.get('THROTTLE_MEDIA', '10000/hour'),
    },
    'EXCEPTION_HANDLER': 'evacuation_plans.error_handling.safe_exception_handler',
}

# SimpleJWT configuration
# En développement, retomber sur SECRET_KEY évite d'imposer deux variables pour
# travailler en local. En production les deux sont exigées ET distinctes : une
# même clé signant les jetons JWT, les sessions, les cookies CSRF et les liens
# de réinitialisation fait qu'une faiblesse dans un domaine les compromet tous,
# et qu'aucune ne peut être renouvelée sans renouveler l'autre.
_jwt_secret = os.environ.get('JWT_SECRET')

if not DEBUG:
    if not _jwt_secret:
        raise ImproperlyConfigured(
            "JWT_SECRET doit être défini hors développement, distinct de SECRET_KEY."
        )
    if _jwt_secret == _INSECURE_DEV_SECRET_KEY:
        raise ImproperlyConfigured(
            "JWT_SECRET reprend la valeur publique du dépôt : générez-en une autre."
        )
    if _jwt_secret == SECRET_KEY:
        raise ImproperlyConfigured(
            "JWT_SECRET et SECRET_KEY doivent être deux valeurs différentes."
        )

JWT_SECRET = _jwt_secret or SECRET_KEY
SIMPLE_JWT = {
    # Court : un jeton d'accès volé n'est pas révocable, seule sa brièveté
    # limite la fenêtre. Le rafraîchissement, lui, est révocable.
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=int(os.environ.get('ACCESS_TOKEN_MINUTES', 30))),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=int(os.environ.get('REFRESH_TOKEN_DAYS', 7))),
    # Chaque rafraîchissement émet un nouveau jeton et révoque l'ancien : un
    # jeton de rafraîchissement rejoué après usage est refusé.
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'UPDATE_LAST_LOGIN': False,
    'ALGORITHM': 'HS256',
    'SIGNING_KEY': JWT_SECRET,
    'VERIFYING_KEY': None,
    'AUDIENCE': None,
    'ISSUER': None,
    'AUTH_HEADER_TYPES': ('Bearer',),
    'AUTH_HEADER_NAME': 'HTTP_AUTHORIZATION',
    'USER_ID_FIELD': 'id',
    'USER_ID_CLAIM': 'user_id',
}

# ── Journalisation ──────────────────────────────────────────────────────────
# Deux flux distincts : 'evacstudio.audit' trace les actions sensibles (qui a
# fait quoi, sur quelle ressource, avec quel résultat), le reste va au flux
# applicatif. Aucun secret n'y transite — voir evacuation_plans/signals.py.
#
# Par défaut tout part sur la sortie standard, ce que systemd, Docker ou
# gunicorn capturent déjà. Renseigner LOG_DIR ajoute des fichiers tournants,
# utile quand la rétention doit survivre à un redémarrage.
LOG_DIR = os.environ.get('LOG_DIR', '')
LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO').upper()

_log_handlers = {
    'console': {
        'class': 'logging.StreamHandler',
        'formatter': 'standard',
    },
}
_app_handlers = ['console']
_audit_handlers = ['console']

if LOG_DIR:
    os.makedirs(LOG_DIR, exist_ok=True)
    _log_handlers['app_file'] = {
        'class': 'logging.handlers.RotatingFileHandler',
        'filename': os.path.join(LOG_DIR, 'evacstudio.log'),
        'maxBytes': 10 * 1024 * 1024,
        'backupCount': 5,
        'formatter': 'standard',
    }
    _log_handlers['audit_file'] = {
        'class': 'logging.handlers.RotatingFileHandler',
        'filename': os.path.join(LOG_DIR, 'audit.log'),
        'maxBytes': 10 * 1024 * 1024,
        # Conservé plus longtemps : c'est la piste d'audit.
        'backupCount': 20,
        'formatter': 'standard',
    }
    _app_handlers.append('app_file')
    _audit_handlers.append('audit_file')

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'standard': {
            'format': '{asctime} {levelname} {name} {message}',
            'style': '{',
        },
    },
    'handlers': _log_handlers,
    'loggers': {
        'evacuation_plans': {'handlers': _app_handlers, 'level': LOG_LEVEL, 'propagate': False},
        'evacstudio.audit': {'handlers': _audit_handlers, 'level': 'INFO', 'propagate': False},
        'django.security': {'handlers': _app_handlers, 'level': 'WARNING', 'propagate': False},
        'django.request': {'handlers': _app_handlers, 'level': 'ERROR', 'propagate': False},
    },
}

# ── CORS ────────────────────────────────────────────────────────────────────
# Authentication travels in the Authorization header, not in a cookie, so the
# application does not need cross-origin credentials at all. Sending them with
# an open origin list would let any site call the API with the browser's
# ambient credentials, which is why the two are never combined here.
_cors_origins = [origin.strip() for origin in os.environ.get('CORS_ALLOWED_ORIGINS', '').split(',') if origin.strip()]
CORS_ALLOW_CREDENTIALS = False

if _cors_origins:
    CORS_ALLOWED_ORIGINS = _cors_origins
    CORS_ALLOW_ALL_ORIGINS = False
elif DEBUG:
    # Local work: the Next.js dev server runs on another port.
    CORS_ALLOW_ALL_ORIGINS = True
else:
    raise ImproperlyConfigured(
        "CORS_ALLOWED_ORIGINS doit lister les origines du frontend hors développement."
    )

# ── Durcissement production ─────────────────────────────────────────────────
# Applied only when DEBUG is off so local HTTP development keeps working.
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'same-origin'
X_FRAME_OPTIONS = 'DENY'
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'

if not DEBUG:
    SECURE_SSL_REDIRECT = os.environ.get('SECURE_SSL_REDIRECT', 'True').lower() in ('true', '1', 't')
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = int(os.environ.get('SECURE_HSTS_SECONDS', 31536000))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = False
    # Nginx terminates TLS, so Django learns the original scheme from it.
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    CSRF_TRUSTED_ORIGINS = _cors_origins
