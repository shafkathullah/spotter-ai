from django.urls import path

from . import views

urlpatterns = [
    path("health", views.health),
    path("geocode", views.geocode),
    path("routes", views.routes),
    path("heatmap", views.heatmap),
]
