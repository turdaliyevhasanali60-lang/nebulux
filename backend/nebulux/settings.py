# nebulux/settings.py
"""
Nebulux — production Django settings.
Designed for 10 000+ concurrent users.

Environment variables are loaded from .env via python-decouple.
Never commit .env to version control.
"""
import os
from datetime import timedelta
from pathlib import Path

from celery.schedules import crontab
from decouple import Csv, config

# ─── Paths ────────────────────────────────────────────────────────────────
# BASE_DIR → nebulux-backend/nebulux/  →  .parent → nebulux-backend/
BASE_DIR     = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"

# ─── Core ─────────────────────────────────────────────────────────────────
SECRET_KEY    = config("SECRET_KEY")
DEBUG         = config("DEBUG", default=False, cast=bool)
ALLOWED_HOSTS = config(
    "ALLOWED_HOSTS",
    default="localhost,127.0.0.1",
    cast=Csv(),
)

# ─── Application definition ───────────────────────────────────────────────
DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",  # required for logout blacklisting
    "corsheaders",
]

LOCAL_APPS = [
    "accounts.apps.AccountsConfig",
    "generator.apps.GeneratorConfig",
    "payments.apps.PaymentsConfig",
    "publishing",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

# ─── Middleware ────────────────────────────────────────────────────────────
MIDDLEWARE = [
    "publishing.middleware.SubdomainMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",      # serve static files in production
    "corsheaders.middleware.CorsMiddleware",            # must be before CommonMiddleware
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF      = "nebulux.urls"
WSGI_APPLICATION  = "nebulux.wsgi.application"
ASGI_APPLICATION  = "nebulux.asgi.application"

# ─── Templates ────────────────────────────────────────────────────────────
TEMPLATES = [
    {
        "BACKEND":  "django.template.backends.django.DjangoTemplates",
        "DIRS":     [FRONTEND_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS":  {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# ─── Database ─────────────────────────────────────────────────────────────
DATABASES = {
    "default": {
        "ENGINE":       "django.db.backends.postgresql",
        "NAME":         config("DB_NAME"),
        "USER":         config("DB_USER"),
        "PASSWORD":     config("DB_PASSWORD"),
        "HOST":         config("DB_HOST", default="localhost"),
        "PORT":         config("DB_PORT", default="5432"),
        # Keep connections alive for 60 s to avoid per-request overhead
        "CONN_MAX_AGE": 60,
        "OPTIONS": {
            "connect_timeout": 10,
        },
    }
}

# ─── Cache (Redis) ─────────────────────────────────────────────────────────
#
# Used for:
#   • OTP codes + attempt counters    (accounts/utils.py)
#   • Login brute-force counters      (accounts/utils.py)
#   • Password reset tokens           (accounts/utils.py)
#   • DRF throttle counters           (REST_FRAMEWORK config below)
#   • Celery broker + result backend  (CELERY_* config below)
#
REDIS_URL = config("REDIS_URL", default="redis://127.0.0.1:6379/1")

CACHES = {
    "default": {
        "BACKEND":  "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
        "OPTIONS": {
            "socket_connect_timeout": 5,
            "socket_timeout":         5,
            "retry_on_timeout":       True,
            "max_connections":        200,
        },
        "KEY_PREFIX": "nbx",
        "TIMEOUT":    300,
    }
}

# ─── Custom User ──────────────────────────────────────────────────────────
AUTH_USER_MODEL = "accounts.User"

# ─── Password validation ──────────────────────────────────────────────────
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
     "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ─── Session Configuration ────────────────────────────────────────────────
#
# FIX: Persistent sessions — users should NEVER be logged out unless they
# explicitly click "Sign out". These settings ensure:
#   1. Sessions survive browser close (SESSION_EXPIRE_AT_BROWSER_CLOSE = False)
#   2. Sessions last 30 days (SESSION_COOKIE_AGE = 30 days in seconds)
#   3. Session expiry is refreshed on every request (SESSION_SAVE_EVERY_REQUEST)
#
# NOTE: Nebulux uses JWT tokens (not Django sessions) for API auth, but
# Django's session middleware is still active for admin and CSRF handling.
# The real fix for "random logouts" is in the JWT config below — the
# refresh token lifetime must be long enough, and the frontend token
# refresh logic must handle rotation gracefully.
#
SESSION_ENGINE                  = "django.contrib.sessions.backends.cache"
SESSION_CACHE_ALIAS             = "default"
SESSION_COOKIE_AGE              = 60 * 60 * 24 * 30   # 30 days (in seconds)
SESSION_EXPIRE_AT_BROWSER_CLOSE = False                # persist across browser restarts
SESSION_SAVE_EVERY_REQUEST      = True                 # refresh expiry on each request
SESSION_COOKIE_NAME             = "nbx_session"
SESSION_COOKIE_HTTPONLY          = True
SESSION_COOKIE_SAMESITE          = "Lax"

# ─── JWT (SimpleJWT) ──────────────────────────────────────────────────────
#
# Access token:  2 hours    — reduces refresh frequency and race-condition window
# Refresh token: 30 days    — persistent sessions without re-login
# Rotation + Blacklist:      old refresh token is invalidated on each use
#
# NOTE on multi-tab refresh race condition:
#   SimpleJWT does NOT have a built-in grace period for blacklisted tokens.
#   ALLOW_TOKEN_REFRESH_AFTER_BLACKLIST does not exist as a SimpleJWT setting —
#   if it appears anywhere in comments it was aspirational, not implemented.
#   The real mitigation is:
#     1. A long ACCESS_TOKEN_LIFETIME (2 h) so most tabs never need to refresh
#        simultaneously.
#     2. Frontend retry logic in auth.js: on a 401 during refresh, re-try once
#        before treating it as a logout (handles the rare simultaneous-refresh case).
#   A proper grace period requires a custom TokenRefreshView with a short
#   blacklist TTL window — add that if the race is still hit in production.
#
SIMPLE_JWT = {
    # Lifetimes
    "ACCESS_TOKEN_LIFETIME":    timedelta(hours=2),
    "REFRESH_TOKEN_LIFETIME":   timedelta(days=30),

    # Rotation — every refresh call issues a new refresh token
    "ROTATE_REFRESH_TOKENS":    True,
    "BLACKLIST_AFTER_ROTATION": True,   # requires token_blacklist in INSTALLED_APPS
    "UPDATE_LAST_LOGIN":        True,

    # Crypto
    "ALGORITHM":   "HS256",
    "SIGNING_KEY": SECRET_KEY,

    # Header
    "AUTH_HEADER_TYPES": ("Bearer",),
    "AUTH_HEADER_NAME":  "HTTP_AUTHORIZATION",

    # Claims
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",

    # Token serializers (defaults — listed explicitly for clarity)
    "TOKEN_OBTAIN_SERIALIZER":  "rest_framework_simplejwt.serializers.TokenObtainPairSerializer",
    "TOKEN_REFRESH_SERIALIZER": "rest_framework_simplejwt.serializers.TokenRefreshSerializer",

    # Blacklist cleanup — purge expired tokens on each rotation
    "TOKEN_BLACKLIST_SERIALIZER": "rest_framework_simplejwt.serializers.TokenBlacklistSerializer",
}

# ─── Django REST Framework ────────────────────────────────────────────────
REST_FRAMEWORK = {
    # Authentication: every request checks for a Bearer JWT first
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "generator.authentication.BearerAuthentication",
    ],
    # Endpoints that do not add @permission_classes require auth by default
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    # Only JSON — no browsable API in production
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
    ],
    # Global throttle fallback (individual views override with their own classes)
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    # ── Rate limits ────────────────────────────────────────────────────
    # Scale these up as user base grows; Redis handles the counters.
    # auth_* scopes are per-IP; generate_* scopes are per-user-ID.
    "DEFAULT_THROTTLE_RATES": {
        # Global fallbacks
        "anon": "120/minute",
        "user": "600/minute",
        # Auth endpoints (accounts/throttling.py)
        "auth_register": "5/hour",       # 5 registration attempts per IP per hour
        "auth_login":    "20/minute",     # 20 login attempts per IP per minute
        "auth_forgot":   "5/hour",        # 5 reset-link requests per IP per hour
        # Generator endpoints (generator/throttling.py)
        "spec":             "60/minute",  # spec extraction (no credit cost)
        "generate_free":    "20/hour",    # free-tier generation (credits are primary gate)
        "generate_standard":"100/hour",   # standard plan
        "generate_pro":     "500/hour",   # pro plan
    },
    # Pagination
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.LimitOffsetPagination",
    "PAGE_SIZE": 20,

    "EXCEPTION_HANDLER": "nebulux.views.custom_exception_handler",
}

# ─── CORS ─────────────────────────────────────────────────────────────────
# In production, list your real domain(s).
# In development, localhost:8000 is enough because the frontend is served
# by Django itself (no cross-origin request is made).
CORS_ALLOWED_ORIGINS = config(
    "CORS_ALLOWED_ORIGINS",
    default="http://localhost:8000,http://127.0.0.1:8000",
    cast=Csv(),
)
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = [
    "accept",
    "accept-encoding",
    "authorization",
    "content-type",
    "dnt",
    "origin",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
]

# ─── Email ────────────────────────────────────────────────────────────────
EMAIL_BACKEND       = config("EMAIL_BACKEND",       default="django.core.mail.backends.smtp.EmailBackend")
EMAIL_HOST          = config("EMAIL_HOST",          default="smtp.gmail.com")
EMAIL_PORT          = config("EMAIL_PORT",          default=587, cast=int)
EMAIL_USE_TLS       = config("EMAIL_USE_TLS",       default=True,  cast=bool)
EMAIL_USE_SSL       = config("EMAIL_USE_SSL",       default=False, cast=bool)
EMAIL_HOST_USER     = config("EMAIL_HOST_USER",     default="")
EMAIL_HOST_PASSWORD = config("EMAIL_HOST_PASSWORD", default="")
DEFAULT_FROM_EMAIL  = config("DEFAULT_FROM_EMAIL",  default="Nebulux <noreply@nebulux.io>")
SERVER_EMAIL        = DEFAULT_FROM_EMAIL
EMAIL_TIMEOUT       = 10   # seconds — prevent worker from blocking on a dead SMTP server

# ─── Google OAuth ─────────────────────────────────────────────────────────
GOOGLE_CLIENT_ID     = config("GOOGLE_CLIENT_ID",     default="")
GOOGLE_CLIENT_SECRET = config("GOOGLE_CLIENT_SECRET", default="")
GOOGLE_REDIRECT_URI  = config(
    "GOOGLE_REDIRECT_URI",
    default="http://127.0.0.1:8000/api/auth/google/callback/",
)


# ─── AI Provider Configuration ───────────────────────────────────────────
AI_MODELS = {
    "spec":      "claude-haiku-3.5",   # keep Haiku for spec — cheap + accurate
    "generate":  "kimi-k2.5",
    "edit":      "gemini-2.5-flash",
    "fast_edit": "claude-haiku-3.5",
    # "generate": "kimi-k2.5",         # ready — just needs MOONSHOT_API_KEY funded
    # "edit":     "kimi-k2.5",
}

# ─── AI Provider API Keys ────────────────────────────────────────────────
OPENAI_API_KEY    = config("OPENAI_API_KEY",    default="")
ANTHROPIC_API_KEY = config("ANTHROPIC_API_KEY", default="")
GOOGLE_AI_API_KEY = config("GOOGLE_AI_API_KEY", default="")
DEEPSEEK_API_KEY  = config("DEEPSEEK_API_KEY",  default="")
MOONSHOT_API_KEY  = config("MOONSHOT_API_KEY",  default="")
GROQ_API_KEY      = config("GROQ_API_KEY",      default="")
MISTRAL_API_KEY   = config("MISTRAL_API_KEY",   default="")

# ─── AI Shared Settings ──────────────────────────────────────────────────
# AI_REQUEST_TIMEOUT — request timeout in seconds for all AI provider calls.
# model_registry.py reads this key via:
#   getattr(settings, "AI_REQUEST_TIMEOUT", 120)
# If model_registry.py still reads the old name "OPENAI_TIMEOUT", update it.
AI_REQUEST_TIMEOUT = config("AI_REQUEST_TIMEOUT", default=120, cast=int)
MAX_PROMPT_LENGTH = 50_000

# ─── Frontend ─────────────────────────────────────────────────────────────
FRONTEND_URL = config("FRONTEND_URL", default="http://localhost:8000")

# ─── Celery ───────────────────────────────────────────────────────────────
CELERY_BROKER_URL             = REDIS_URL
CELERY_RESULT_BACKEND         = REDIS_URL
CELERY_ACCEPT_CONTENT         = ["json"]
CELERY_TASK_SERIALIZER        = "json"
CELERY_RESULT_SERIALIZER      = "json"
CELERY_TIMEZONE               = "UTC"
CELERY_ENABLE_UTC             = True
CELERY_TASK_TRACK_STARTED     = True

CELERY_TASK_TIME_LIMIT        = 600
CELERY_TASK_SOFT_TIME_LIMIT   = 540

CELERY_WORKER_CONCURRENCY          = 4
CELERY_WORKER_MAX_TASKS_PER_CHILD  = 500
CELERY_WORKER_PREFETCH_MULTIPLIER  = 1
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True

CELERY_BEAT_SCHEDULE = {
    "monthly-credit-reset": {
        "task":     "accounts.reset_monthly_credits",
        "schedule": crontab(day_of_month=1, hour=0, minute=0),
    },
}

# ─── Internationalisation ─────────────────────────────────────────────────
LANGUAGE_CODE = "en-us"
TIME_ZONE     = "UTC"
USE_I18N      = True
USE_TZ        = True

# ─── Static / Media ───────────────────────────────────────────────────────
STATIC_URL       = "/static/"
STATIC_ROOT      = BASE_DIR.parent / "staticfiles"
# Only include FRONTEND_DIR/static if it actually exists — an API-only
# deployment (e.g. a backend-only Docker container) should not crash on
# collectstatic just because the frontend directory is absent.
_frontend_static = FRONTEND_DIR / "static"
STATICFILES_DIRS = [_frontend_static] if _frontend_static.exists() else []

STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

MEDIA_URL  = "/media/"
MEDIA_ROOT = BASE_DIR.parent / "media"

# ─── Cloudflare R2 (user-uploaded images) ────────────────────────────────────
_R2_CONFIGURED = all([
    config("R2_ACCESS_KEY_ID", default=""),
    config("R2_SECRET_ACCESS_KEY", default=""),
    config("R2_BUCKET_NAME", default=""),
    config("R2_ACCOUNT_ID", default=""),
])

if _R2_CONFIGURED:
    R2_ACCOUNT_ID      = config("R2_ACCOUNT_ID")
    R2_ACCESS_KEY_ID   = config("R2_ACCESS_KEY_ID")
    R2_SECRET_ACCESS_KEY = config("R2_SECRET_ACCESS_KEY")
    R2_BUCKET_NAME     = config("R2_BUCKET_NAME")
    R2_PUBLIC_URL      = config("R2_PUBLIC_URL", default="")

    AWS_ACCESS_KEY_ID       = R2_ACCESS_KEY_ID
    AWS_SECRET_ACCESS_KEY   = R2_SECRET_ACCESS_KEY
    AWS_STORAGE_BUCKET_NAME = R2_BUCKET_NAME
    AWS_S3_ENDPOINT_URL     = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    AWS_S3_REGION_NAME      = "auto"
    AWS_DEFAULT_ACL         = None          # R2 uses bucket policy, not ACLs
    AWS_S3_FILE_OVERWRITE   = False
    AWS_QUERYSTRING_AUTH    = False         # public bucket — no signed URLs needed
    AWS_S3_CUSTOM_DOMAIN    = None          # we build URLs manually from R2_PUBLIC_URL

# ─── Misc ─────────────────────────────────────────────────────────────────
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ─── Security (production hardening) ─────────────────────────────────────
if not DEBUG:
    SECURE_SSL_REDIRECT               = True
    SECURE_PROXY_SSL_HEADER           = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_HSTS_SECONDS               = 31_536_000
    SECURE_HSTS_INCLUDE_SUBDOMAINS    = True
    SECURE_HSTS_PRELOAD               = True
    SECURE_BROWSER_XSS_FILTER         = True
    SECURE_CONTENT_TYPE_NOSNIFF       = True
    X_FRAME_OPTIONS                   = "DENY"
    SECURE_REFERRER_POLICY            = "strict-origin-when-cross-origin"

    SESSION_COOKIE_SECURE             = True
    CSRF_COOKIE_SECURE                = True
    CSRF_COOKIE_HTTPONLY              = True

    REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"] = [
        "rest_framework.renderers.JSONRenderer",
    ]

# ─── Logging ──────────────────────────────────────────────────────────────
_LOG_DIR = BASE_DIR / "logs"
try:
    _LOG_DIR.mkdir(exist_ok=True)
except OSError as _log_dir_exc:
    import warnings
    warnings.warn(
        f"[Nebulux] Could not create log directory {_LOG_DIR}: {_log_dir_exc}. "
        "File logging will fall back to console only.",
        RuntimeWarning,
        stacklevel=1,
    )

LOGGING = {
    "version":                  1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format":  "{levelname} {asctime} [{module}:{lineno}] {message}",
            "style":   "{",
            "datefmt": "%Y-%m-%d %H:%M:%S",
        },
        "simple": {
            "format": "{levelname} {asctime} {module}: {message}",
            "style":  "{",
        },
    },
    "handlers": {
        "console": {
            "class":     "logging.StreamHandler",
            "formatter": "simple",
            "level":     "DEBUG",
        },
        "file_error": {
            "class":       "logging.handlers.RotatingFileHandler",
            "filename":    _LOG_DIR / "errors.log",
            "maxBytes":    10_485_760,
            "backupCount": 5,
            "formatter":   "verbose",
            "level":       "ERROR",
        },
        "file_app": {
            "class":       "logging.handlers.RotatingFileHandler",
            "filename":    _LOG_DIR / "app.log",
            "maxBytes":    52_428_800,
            "backupCount": 10,
            "formatter":   "verbose",
            "level":       "INFO",
        },
    },
    "root": {
        "handlers": ["console"],
        "level":    "WARNING",
    },
    "loggers": {
        "django": {
            "handlers":  ["console", "file_error"],
            "level":     "INFO",
            "propagate": False,
        },
        "django.request": {
            "handlers":  ["file_error", "console"],
            "level":     "ERROR",
            "propagate": False,
        },
        "accounts": {
            "handlers":  ["console", "file_app"],
            "level":     "DEBUG" if DEBUG else "INFO",
            "propagate": False,
        },
        "generator": {
            "handlers":  ["console", "file_app"],
            "level":     "DEBUG" if DEBUG else "INFO",
            "propagate": False,
        },
        "payments": {
            "handlers":  ["console", "file_app"],
            "level":     "DEBUG" if DEBUG else "INFO",
            "propagate": False,
        },
        "payments.webhook.errors": {
            "handlers":  ["console", "file_error", "file_app"],
            "level":     "ERROR",
            "propagate": False,
        },
        "celery": {
            "handlers":  ["console", "file_app"],
            "level":     "INFO",
            "propagate": False,
        },
    },
}


# ─── Lemon Squeezy ───────────────────────────────────────────────────────
LEMON_SQUEEZY_API_KEY        = config("LEMON_SQUEEZY_API_KEY", default="")
LEMON_SQUEEZY_WEBHOOK_SECRET = config("LEMON_SQUEEZY_WEBHOOK_SECRET", default="")
LEMON_SQUEEZY_STORE_ID       = config("LEMON_SQUEEZY_STORE_ID", default="")

# Variant IDs (Lemon Squeezy's version of Price IDs)
LS_VARIANT_STANDARD_MONTHLY = config("LS_VARIANT_STANDARD_MONTHLY", default="")
LS_VARIANT_PRO_MONTHLY      = config("LS_VARIANT_PRO_MONTHLY", default="")
LS_VARIANT_STARTER_PACK     = config("LS_VARIANT_STARTER_PACK", default="")
LS_VARIANT_BUILDER_PACK     = config("LS_VARIANT_BUILDER_PACK", default="")
LS_VARIANT_AGENCY_PACK      = config("LS_VARIANT_AGENCY_PACK", default="")

# Credit mapping logic
# Token Unit (TU) amounts per product.  1 TU = 1,000 API tokens.
# Packs are priced to give better value than the subscription rate ($0.015/TU):
#   Starter  $4.99 → 400 TU  = $0.0125/TU  (17% cheaper)
#   Builder  $8.99 → 850 TU  = $0.0106/TU  (29% cheaper)
#   Agency  $14.99 → 1,600 TU = $0.0094/TU  (37% cheaper)
LS_CREDIT_MAP = {
    "standard_monthly": 2_000,
    "pro_monthly":      5_000,
    "starter_pack":     400,
    "builder_pack":     850,
    "agency_pack":      1_600,
}
# FIX 7: LS_VARIANT_* values default to "" when the env var is unset.
# Inserting them unconditionally collapses all four into a single "" key
# (last-write-wins = 1000) so webhook credit lookups always miss.
# Only add them when the env var actually contains a value.
_ls_variant_credit_map = {
    LS_VARIANT_STANDARD_MONTHLY: 2_000,
    LS_VARIANT_PRO_MONTHLY:      5_000,
    LS_VARIANT_STARTER_PACK:     400,
    LS_VARIANT_BUILDER_PACK:     850,
    LS_VARIANT_AGENCY_PACK:      1_600,
}
LS_CREDIT_MAP.update({k: v for k, v in _ls_variant_credit_map.items() if k})


SITE_URL = "https://nebulux.one"  # no trailing slash

# ─── Pexels  ───────────────────────────────────────────────────────
PEXELS_API_KEY = config('PEXELS_API_KEY', default='')
