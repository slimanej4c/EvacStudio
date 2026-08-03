from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from .views import (
    RegisterView,
    CurrentUserView,
    EvacuationPlanViewSet,
    PlanIconViewSet,
    UserOpenAISettingsView,
    SaveUserOpenAISettingsView,
    DeleteUserOpenAISettingsView,
    TestOpenAIKeyView,
    AnalyzePlanImageView,
)

router = DefaultRouter()
router.register(r'plans', EvacuationPlanViewSet, basename='plan')
router.register(r'evacuation-plans', EvacuationPlanViewSet, basename='evacuation-plan')
router.register(r'icons', PlanIconViewSet, basename='icon')

urlpatterns = [
    path('auth/register/', RegisterView.as_view(), name='auth_register'),
    path('auth/token/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('auth/me/', CurrentUserView.as_view(), name='auth_me'),
    path('openai-settings/', UserOpenAISettingsView.as_view(), name='openai_settings'),
    path('openai-settings/save/', SaveUserOpenAISettingsView.as_view(), name='openai_settings_save'),
    path('openai-settings/delete/', DeleteUserOpenAISettingsView.as_view(), name='openai_settings_delete'),
    path('openai/test-key/', TestOpenAIKeyView.as_view(), name='openai_test_key'),
    path('openai/analyze-plan/', AnalyzePlanImageView.as_view(), name='openai_analyze_plan'),
    path('', include(router.urls)),
]
