# nebulux/views.py
from django.shortcuts import redirect, render
from django.contrib import messages
from django.conf import settings
from django.http import HttpResponse, Http404
import math
from rest_framework.views import exception_handler
from rest_framework.exceptions import Throttled
from rest_framework.response import Response


def react_app(request):
    """Serve the React SPA index.html for all frontend routes."""
    index_path = settings.FRONTEND_DIR / "react-dist" / "index.html"
    if not index_path.exists():
        raise Http404("React build not found. Run: cd frontend-react && npm run build")
    with open(index_path, "r", encoding="utf-8") as f:
        content = f.read()
    return HttpResponse(content, content_type="text/html")


def custom_404(request, exception):
    return react_app(request)


def templates_coming_soon(request):
    """
    Backend guard: if a user manually navigates to /templates/,
    redirect them to the homepage with a 'Coming Soon' message.
    This prevents bypassing the disabled UI button.
    """
    messages.info(request, "Templates are coming soon! Stay tuned.")
    return redirect("/?notice=templates_coming_soon")


def custom_exception_handler(exc, context):
    response = exception_handler(exc, context)

    if isinstance(exc, Throttled) and response is not None:
        wait = exc.wait
        if wait is None:
            msg = "Too many attempts. Please try again later."
        elif wait < 60:
            msg = f"Too many attempts. Please wait {math.ceil(wait)} seconds."
        elif wait < 3600:
            msg = f"Too many attempts. Please try again in {math.ceil(wait / 60)} minutes."
        else:
            msg = f"Too many attempts. Please try again in {math.ceil(wait / 3600)} hour(s)."

        response.data = {"detail": msg}

    return response