# Frontend - Plans d'evacuation

Application Next.js pour creer, modifier et exporter des plans d'evacuation.

## Configuration

Creer `frontend/.env.local` en developpement local:

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

En production, laisser `NEXT_PUBLIC_API_URL` vide ou ne pas definir la variable. Les appels utilisent alors les URLs relatives `/api/...`.

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

## Vérifications

```bash
npm test
npm run lint
npm run build
```

Les tests couvrent le plan de situation, la légende, les logos, le verrouillage,
le recadrage et la sauvegarde automatique. `npm run test:auto-save` vérifie aussi
les échecs réseau, l’édition pendant une requête et la conservation des images
de plans secondaires modifiées pendant leur enregistrement.

La sauvegarde est isolée dans `src/hooks/useAutoSave.ts`, son minuteur dans
`src/lib/autoSave.ts` et la comparaison des états dans `src/lib/editorPersistence.ts`.
Le minuteur lit toujours le dernier état de l’éditeur et reste stable pendant
l’édition. Une requête en cours bloque les enregistrements concurrents ; un
échec laisse les modifications en attente d’une nouvelle tentative.

Les exceptions locales à `react-hooks/set-state-in-effect` sont commentées sur
les synchronisations avec le canvas, le stockage du navigateur et les données
chargées. Elles conservent ces comportements existants sans désactiver les autres
contrôles React ou TypeScript.

## Pages conservees

- `/`
- `/login`
- `/register`
- `/dashboard`
- `/evacuation-plans`
- `/evacuation-plans/new`
- `/evacuation-plans/[id]/editor`
