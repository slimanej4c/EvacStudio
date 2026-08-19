from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from .views import (
    RegisterView,
    CurrentUserView,
    EvacuationPlanViewSet,
    PlanIconViewSet,
    UserXaiSettingsView,
    SaveUserXaiSettingsView,
    DeleteUserXaiSettingsView,
    TestXaiKeyView,
    WorkspaceCollaboratorsView,
    RevokeWorkspaceAccessView,
    AcceptWorkspaceInvitationView,
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
    path('xai-settings/', UserXaiSettingsView.as_view(), name='xai_settings'),
    path('xai-settings/save/', SaveUserXaiSettingsView.as_view(), name='xai_settings_save'),
    path('xai-settings/delete/', DeleteUserXaiSettingsView.as_view(), name='xai_settings_delete'),
    path('xai/test-key/', TestXaiKeyView.as_view(), name='xai_test_key'),
    path('workspace/collaborators/', WorkspaceCollaboratorsView.as_view(), name='workspace_collaborators'),
    path('workspace/revoke/', RevokeWorkspaceAccessView.as_view(), name='workspace_revoke'),
    path('workspace/accept/', AcceptWorkspaceInvitationView.as_view(), name='workspace_accept'),
    path('', include(router.urls)),
]
