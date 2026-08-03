# SecurPlan - Createur de Plans d'Evacuation

SecurPlan est une application Django + Next.js dediee a la creation de plans d'evacuation incendie. Elle permet d'importer une image ou un PDF comme fond de plan, d'ajouter des pictogrammes de securite, de les positionner dans un editeur interactif, puis d'exporter le resultat en PNG ou PDF.

## Structure

```text
backend/
  config/              # Configuration Django
  evacuation_plans/    # API plans, icones, auth JWT
  media/               # Fonds de plans et pictogrammes

frontend/
  src/app/             # Pages Next.js
  src/components/      # Editeur canvas et UI
  src/context/         # Authentification JWT
```

## Backend

```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

API locale: `http://localhost:8000`

## Frontend

Creer `frontend/.env`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Puis lancer:

```bash
cd frontend
npm run dev
```

`npm install` est necessaire seulement la premiere fois ou apres modification des dependances:

```bash
cd frontend
npm install
```

Le script `npm run dev` utilise Webpack et `127.0.0.1` pour eviter les pics de ressources observes avec Turbopack.

Application locale: `http://localhost:3000`

## Pages

- `/`
- `/login`
- `/register`
- `/dashboard`
- `/evacuation-plans`
- `/evacuation-plans/new`
- `/evacuation-plans/[id]/editor`

## Tests

```bash
cd backend
./venv/bin/python manage.py check
./venv/bin/python manage.py test

cd ../frontend
npm run build
```
# EvacStudio
