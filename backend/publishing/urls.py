from django.urls import path
from . import views

urlpatterns = [
    path("check/",        views.check_subdomain,  name="publish-check"),
    path("publish/",      views.publish_site,      name="publish-site"),
    path("republish/",    views.republish_site,    name="republish-site"),
    path("status/<int:generation_id>/", views.publish_status, name="publish-status"),
    path("unpublish/<int:generation_id>/", views.unpublish_site, name="unpublish-site"),
]
