# generator/urls.py
from django.urls import path
from . import views

urlpatterns = [
    # ── AI Pipeline
    path("spec/",          views.extract_spec_view,    name="extract-spec"),
    path("spec/complete/", views.complete_spec_view,   name="complete-spec"),
    path("generate/",      views.generate_website_view, name="generate-website"),
    path("modify/",        views.modify_website_view,   name="modify-website"),

    # ── Chat utilities (no credit deduction)
    path("intent/",        views.intent_view,           name="intent"),
    path("chat/",          views.chat_view,             name="chat"),

    # ── User's projects (auth required)
    path("websites/",                        views.list_generations,  name="list-generations"),
    path("websites/<int:generation_id>/",    views.get_generation,    name="get-generation"),
    path("websites/<int:generation_id>/delete/", views.delete_generation, name="delete-generation"),

    # ── Ops
    path("image/", views.pexels_image, name="pexels-image"),
    path("health/", views.health_check, name="health-check"),
    path("stats/",  views.api_stats,    name="api-stats"),
]