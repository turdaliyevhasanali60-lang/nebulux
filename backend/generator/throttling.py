# generator/throttling.py
from django.conf import settings
from rest_framework.throttling import SimpleRateThrottle


class BaseIPThrottle(SimpleRateThrottle):
    """Common base: use IP address as the cache key. No-ops in DEBUG mode."""

    def allow_request(self, request, view):
        # Never throttle during local development
        if getattr(settings, 'DEBUG', False):
            return True
        return super().allow_request(request, view)

    def get_cache_key(self, request, view):
        ident = self._get_ident(request)
        return self.cache_format % {'scope': self.scope, 'ident': ident}

    def _get_ident(self, request):
        if request.user and request.user.is_authenticated:
            return str(request.user.pk)
        forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
        if forwarded:
            return forwarded.split(',')[0].strip()
        return request.META.get('REMOTE_ADDR', 'unknown')


class GenerateFreeThrottle(BaseIPThrottle):
    scope = 'generate_free'


class GenerateStandardThrottle(BaseIPThrottle):
    scope = 'generate_standard'


class GenerateProThrottle(BaseIPThrottle):
    scope = 'generate_pro'


class SpecThrottle(BaseIPThrottle):
    scope = 'spec'