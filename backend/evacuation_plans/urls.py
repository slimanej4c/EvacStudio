import logging

from django.conf import settings
from django.contrib.auth.models import User
from django.core.exceptions import ObjectDoesNotExist
from django.urls import path, include
from rest_framework_simplejwt.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import AccessToken
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .media_access import set_media_session_cookie
from .media_views import ProtectedMediaView
from .throttles import LoginRateThrottle

audit = logging.getLogger('evacstudio.audit')


def attach_media_session_from_access_token(response):
    """Bind protected image requests to the browser that received the JWT."""
    access_value = getattr(response, 'data', {}).get('access')
    if response.status_code != 200 or not access_value:
        return response
    token = AccessToken(access_value)
    user = User.objects.filter(
        pk=token[settings.SIMPLE_JWT['USER_ID_CLAIM']],
        is_active=True,
    ).first()
    return set_media_session_cookie(response, user) if user is not None else response


class SafeTokenRefreshSerializer(TokenRefreshSerializer):
    """Reject a refresh token whose user was deleted instead of returning 500.

    SimpleJWT 5.5.1 fetches the token owner with ``objects.get()`` but does not
    catch ``DoesNotExist``. A browser holding an old token must be logged out,
    not receive an internal-server error.
    """

    def validate(self, attrs):
        try:
            return super().validate(attrs)
        except ObjectDoesNotExist:
            raise AuthenticationFailed(
                self.error_messages['no_active_account'],
                'no_active_account',
            ) from None


class ThrottledTokenObtainPairView(TokenObtainPairView):
    """Login. Rate-limited: it is the one endpoint worth guessing against.

    SimpleJWT n'émet le signal `user_logged_in` que si UPDATE_LAST_LOGIN est
    activé : les connexions réussies par l'API sont donc tracées ici. Les
    échecs, eux, passent par `user_login_failed` et sont tracés dans signals.py.
    """

    throttle_classes = [LoginRateThrottle]

    def post(self, request, *args, **kwargs):
        # Seuls les succès sont journalisés ici : en cas d'échec SimpleJWT lève
        # une exception, et le backend d'authentification a déjà émis
        # `user_login_failed` — que signals.py trace pour l'API comme pour
        # l'admin. Dupliquer produirait deux lignes pour un même événement.
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200:
            audit.info(
                "auth.api_login.success username=%s",
                str(request.data.get('username', '?'))[:150],
            )
        return attach_media_session_from_access_token(response)


class ThrottledTokenRefreshView(TokenRefreshView):
    """Refresh. A stolen refresh token should not be exchangeable in bulk."""

    throttle_classes = [LoginRateThrottle]
    serializer_class = SafeTokenRefreshSerializer

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        return attach_media_session_from_access_token(response)

from .views import (
    RegisterView,
    CurrentUserView,
    EvacuationPlanViewSet,
    PlanFolderViewSet,
    PlanIconViewSet,
    UserXaiSettingsView,
    SaveUserXaiSettingsView,
    DeleteUserXaiSettingsView,
    TestXaiKeyView,
    LogoutView,
    WorkspaceCollaboratorsView,
    RevokeWorkspaceAccessView,
    AcceptWorkspaceInvitationView,
)

router = DefaultRouter()
router.register(r'plans', EvacuationPlanViewSet, basename='plan')
router.register(r'plan-folders', PlanFolderViewSet, basename='plan-folder')
router.register(r'evacuation-plans', EvacuationPlanViewSet, basename='evacuation-plan')
router.register(r'icons', PlanIconViewSet, basename='icon')

urlpatterns = [
    path('auth/register/', RegisterView.as_view(), name='auth_register'),
    path('auth/token/', ThrottledTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/token/refresh/', ThrottledTokenRefreshView.as_view(), name='token_refresh'),
    path('auth/logout/', LogoutView.as_view(), name='auth_logout'),
    path('auth/me/', CurrentUserView.as_view(), name='auth_me'),
    path('xai-settings/', UserXaiSettingsView.as_view(), name='xai_settings'),
    path('xai-settings/save/', SaveUserXaiSettingsView.as_view(), name='xai_settings_save'),
    path('xai-settings/delete/', DeleteUserXaiSettingsView.as_view(), name='xai_settings_delete'),
    path('xai/test-key/', TestXaiKeyView.as_view(), name='xai_test_key'),
    path('workspace/collaborators/', WorkspaceCollaboratorsView.as_view(), name='workspace_collaborators'),
    path('workspace/revoke/', RevokeWorkspaceAccessView.as_view(), name='workspace_revoke'),
    path('workspace/accept/', AcceptWorkspaceInvitationView.as_view(), name='workspace_accept'),
    # Seule porte vers MEDIA_ROOT ; `path` accepte les sous-répertoires.
    path('media/<path:media_path>', ProtectedMediaView.as_view(), name='protected_media'),
    path('', include(router.urls)),
]
