from django.contrib import admin
from django.urls import path, include


urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('evacuation_plans.urls')),
]

# MEDIA_URL n'est plus servi directement, même en développement : les fichiers
# passent par /api/media/ (voir evacuation_plans/media_access.py). Servir les
# deux ferait cohabiter une porte contrôlée et une porte ouverte, et le
# développement ne testerait plus ce que la production applique.
