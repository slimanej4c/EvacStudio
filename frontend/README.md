# Frontend - Plans d'evacuation

Application Next.js pour creer, modifier et exporter des plans d'evacuation.

## Configuration

Creer `frontend/.env`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Lancement

```bash
npm run dev
```

Ouvrir `http://localhost:3000`.

Installer les dependances seulement la premiere fois ou apres modification de `package.json`:

```bash
npm install
```

Le script `npm run dev` utilise Webpack et `127.0.0.1` pour eviter les pics de ressources de Turbopack en mode developpement. Pour tester Turbopack explicitement:

```bash
npm run dev:turbo
```

## Pages conservees

- `/`
- `/login`
- `/register`
- `/dashboard`
- `/evacuation-plans`
- `/evacuation-plans/new`
- `/evacuation-plans/[id]/editor`
