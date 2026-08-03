# Backend - Plans d'evacuation

API Django REST Framework pour l'authentification JWT et la creation de plans d'evacuation.

## Lancement

```bash
source venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

## Modules conserves

- `config`
- `evacuation_plans`

## Endpoints principaux

- `POST /api/auth/register/`
- `POST /api/auth/token/`
- `POST /api/auth/token/refresh/`
- `GET /api/auth/me/`
- `GET|POST /api/plans/`
- `GET|PUT|PATCH|DELETE /api/plans/{id}/`
- `GET /api/plans/pictograms/`
- `POST /api/plans/{id}/sync-icons/`
- `POST /api/plans/{id}/clean/`
- `POST /api/plans/{id}/clean-walls/`
- `POST /api/plans/{id}/revert/`
