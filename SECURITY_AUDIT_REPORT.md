# Rapport d'audit sécurité — EvacStudio

**Date :** 22 août 2026
**Périmètre :** dépôt complet (backend Django/DRF, frontend Next.js, configuration, dépendances)
**Modèle d'utilisation retenu :** logiciel interne d'entreprise fermée, ressources partagées entre utilisateurs internes, pas d'inscription publique, pas de multi-tenant.

> Aucune valeur de secret n'apparaît dans ce rapport.

---

## Résumé exécutif

| Sévérité | Détectés | Corrigés | Restants |
|---|---|---|---|
| CRITICAL | 1 | 1 | 0 |
| HIGH     | 6 | 6 | 0 |
| MEDIUM   | 8 | 6 | 2 *(actions serveur)* |
| LOW      | 5 | 2 | 3 *(acceptés / documentés)* |
| INFO     | 4 | — | — |
| **Total** | **24** | **15** | **9** |

Les 9 points restants ne sont pas des correctifs de code oubliés : ce sont des actions
d'exploitation (permissions de fichier, pare-feu, HTTPS, Nginx) et des risques acceptés
avec justification. Chacun est listé nominativement plus bas.

**Tests :** 97 tests backend passent (dont **19 tests de sécurité ajoutés**).
**Dépendances :** 0 vulnérabilité connue côté backend, 0 côté frontend (54 corrigées).
**Non-régression :** build Next.js, `tsc`, 86/86 pictogrammes livrés, éditeur, uploads, exports, templates — vérifiés.

---

## Architecture analysée

```
Navigateur ──HTTPS──> Nginx ──┬──> Next.js 16 (127.0.0.1:3000)   interface, éditeur Konva
                              └──> Django 6 + DRF (127.0.0.1:8000)  API, admin
                                        ├── SQLite  backend/db.sqlite3   (hors répertoires servis)
                                        ├── médias  backend/media/       (plans, pictogrammes)
                                        └── OpenAI / xAI (sortant)
```

* **Authentification :** JWT (SimpleJWT), jeton en en-tête `Authorization`, stocké dans `localStorage`. Pas de session cookie pour l'API — l'admin Django utilise sa propre session.
* **Surface d'API :** 4 vues d'authentification, 4 vues de réglages xAI, 3 vues de partage, 2 ViewSets (plans, icônes) et 20 actions détaillées.
* **Points de contrôle d'accès :** 3 seulement (`EvacuationPlanViewSet.get_queryset`, `PlanIconViewSet.get_queryset`, `PlanIconSerializer.validate_plan`), tous convergeant vers `restrict_plans_to()` / `user_can_edit_plan()` dans `models.py`. C'est cette concentration qui rend le modèle vérifiable.

---

## Modèle utilisateurs et permissions

EvacStudio est un **outil interne**. Le modèle appliqué après cet audit est :

| | Peut |
|---|---|
| **Anonyme** | rien — toute donnée métier est refusée (401/403) |
| **Utilisateur interne actif** | consulter, créer, modifier, exporter **tous** les plans, templates et pictogrammes de l'entreprise |
| **Compte désactivé** | rien — c'est le levier de retrait d'accès |
| **Administrateur (`is_staff`)** | en plus : créer/désactiver/supprimer des comptes, attribuer les rôles, gérer les accès, via l'admin Django |

**Deux utilisateurs internes travaillant sur le même plan est le comportement attendu, pas une faille.**
Les ressources suivantes sont volontairement communes : plans, projets, templates, bibliothèque de pictogrammes, ressources graphiques.

Ce que l'audit vérifie en revanche, et qui est couvert par des tests :

* un utilisateur normal ne peut pas se rendre administrateur ni modifier son rôle (`/api/auth/me/` est en lecture seule ; toute écriture renvoie 401/403/405) ;
* un utilisateur normal ne peut pas atteindre l'admin Django (redirection vers la page de connexion) ;
* l'inscription publique est fermée ;
* aucune clé API n'est jamais renvoyée.

**Création de comptes :** exclusivement dans l'admin Django. L'endpoint `/api/auth/register/` existe toujours mais renvoie **403** tant que `PUBLIC_REGISTRATION_ENABLED` n'est pas explicitement mis à `True`.

---

## Vulnérabilités détectées

### [CRITICAL] C-1 — Upload de fichier arbitraire menant à du XSS stocké

**Fichier :** `backend/evacuation_plans/serializers.py` (`EvacuationPlanSerializer`), `backend/evacuation_plans/views.py` (`change_background`)
**Description :** `background_file` était un `FileField` sans aucun validateur, exposé en écriture par le sérialiseur et par l'action `change-background`. Ni l'extension, ni le type MIME, ni le contenu réel, ni la taille n'étaient contrôlés.

**Preuve (mesurée avant correction) :**

| Charge envoyée | Résultat | Fichier écrit |
|---|---|---|
| `evil.html` contenant `<script>` | **HTTP 201** | `media/backgrounds/evil.html` |
| `evil.svg` avec `onload="alert(1)"` | **HTTP 201** | `media/backgrounds/evil.svg` |
| HTML déguisé en `x.png` | **HTTP 201** | `media/backgrounds/x.png` |
| `shell.py` | **HTTP 201** | `media/backgrounds/shell.py` |
| 12 Mo (aucune limite) | **HTTP 201** | `media/backgrounds/big.png` |

**Risque :** `MEDIA_ROOT` est servi par Nginx, en production sur le même domaine que l'application. Un `.html` ou un `.svg` non assaini déposé là n'est pas un document inerte : c'est du script s'exécutant sur l'origine de l'application. Le JWT étant dans `localStorage`, un XSS sur cette origine équivaut à une prise de contrôle de compte. Sans limite de taille, le disque est également saturable par un seul compte.

**Scénario :** un utilisateur interne — ou un compte dont le mot de passe a fuité — téléverse `plan.html` comme fond de plan, puis envoie l'URL `/media/backgrounds/plan.html` à un collègue administrateur. Le script s'exécute sur le domaine d'EvacStudio et exfiltre le jeton de l'administrateur.

**Correction effectuée :** nouveau module `backend/evacuation_plans/upload_validation.py`, branché sur les **deux** points d'entrée.
* liste blanche d'extensions : `.png .jpg .jpeg .webp .gif .bmp .tif .tiff .pdf .svg` ;
* le contenu décide, pas le nom : décodage Pillow effectif et cohérence format/extension, magique `%PDF-` pour les PDF, assainissement complet pour les SVG (qui sont **stockés assainis**) ;
* plafond de 30 Mo et de 80 Mpx, dimensions vérifiées **avant** décodage pour éviter la bombe de décompression ;
* nom de fichier normalisé (`safe_upload_name`) ;
* fichier sans extension : type déduit du contenu plutôt que refusé — plus robuste, et ne casse aucun client.

**Test effectué :** `test_an_html_page_disguised_as_a_png_is_refused`, `test_an_executable_extension_is_refused` (5 extensions), `test_a_file_over_the_size_limit_is_refused`, `test_a_legitimate_image_is_still_accepted`, `test_a_traversing_filename_cannot_escape_the_upload_directory`. Toutes les charges du tableau ci-dessus renvoient désormais **400**.
**Statut : CORRIGÉ**

---

### [HIGH] H-1 — CORS ouvert combiné aux identifiants

**Fichier :** `backend/config/settings.py`
**Description :** `CORS_ALLOW_ALL_ORIGINS = True` **et** `CORS_ALLOW_CREDENTIALS = True`.
**Risque :** n'importe quel site visité par un utilisateur pouvait émettre des requêtes vers l'API avec les identifiants ambiants du navigateur, et en lire les réponses.
**Correction :** `CORS_ALLOW_CREDENTIALS = False` — l'authentification passe par l'en-tête `Authorization`, les identifiants inter-origines ne servent à rien ici. Les origines proviennent de `CORS_ALLOWED_ORIGINS` ; le démarrage échoue si la variable manque hors développement. L'ouverture totale ne subsiste que si `DEBUG=True`.
**Statut : CORRIGÉ**

### [HIGH] H-2 — `DEBUG` activé par défaut

**Fichier :** `backend/config/settings.py`
**Description :** `os.environ.get('DEBUG', 'True')` — une variable oubliée sur le serveur publiait les traces d'exécution, les chemins et la configuration.
**Correction :** défaut passé à `False`. Une omission échoue désormais fermée.
**Statut : CORRIGÉ**

### [HIGH] H-3 — Aucune limitation de débit (force brute sur la connexion)

**Fichier :** `backend/evacuation_plans/urls.py`, `backend/config/settings.py`
**Description :** `/api/auth/token/` acceptait un nombre illimité de tentatives.
**Correction :** `LoginRateThrottle` (10/min, clé sur l'adresse — l'attaquant choisit le nom d'utilisateur, un compteur par compte serait contourné) sur la connexion **et** le rafraîchissement. `AiRateThrottle` (30/h) sur les 4 actions payantes OpenAI/xAI, `UploadRateThrottle` (120/h) sur les 2 actions écrivant un fichier, plus des plafonds généraux. Tous les taux sont réglables par variable d'environnement.
**Note technique :** appliqué via `throttle_classes=` dans `@action(...)`. Le décorateur `@throttle_classes` est **silencieusement ignoré** sur une action de ViewSet — première tentative écartée pour cette raison.
**Test :** `test_password_guessing_is_rate_limited` — 15 tentatives, un 429 apparaît.
**Statut : CORRIGÉ**

### [HIGH] H-4 — SSRF / lecture de fichier local via `urlopen`

**Fichier :** `backend/evacuation_plans/grok_cleaning.py:517` (`_download_image`) — confirmé par bandit **B310**
**Description :** l'URL de l'image générée, fournie par la réponse de l'API xAI (donnée externe non fiable), était passée telle quelle à `urlopen`, sans restriction de schéma ni de destination, et lue sans borne.
**Risque :** `urlopen` accepte `file://`, `ftp://`. Une réponse manipulée pouvait faire lire un fichier local ou atteindre le réseau interne — y compris le point d'accès de métadonnées cloud `169.254.169.254` — et faire saturer la mémoire par une lecture illimitée.
**Correction :** `_assert_downloadable_url()` — `https` uniquement, rejet de `localhost`, des adresses privées, loopback, link-local, réservées et multicast ; lecture bornée à 40 Mo.
**Test :** `test_the_generated_image_url_cannot_point_inside_the_server` — 5 URL hostiles refusées, une URL xAI légitime acceptée.
**Limite connue :** un nom de domaine résolvant vers une adresse interne échappe à une vérification faite avant connexion. Le pare-feu sortant du serveur est la défense complémentaire attendue ; c'est documenté dans la fonction.
**Statut : CORRIGÉ**

### [HIGH] H-5 — Dépendances backend vulnérables

**Fichier :** `backend/requirements.txt`
**Description :** `pip-audit` relevait **46 vulnérabilités connues dans 5 paquets** : Django 6.0.5 (9 CVE), Pillow 12.2.0 (8), pypdf 6.12.2, sqlparse 0.5.5, pip. `requirements.txt` ne contenait **aucune version épinglée**, et **Pillow y était absent** alors qu'il est importé.
**Correction :** Django → 6.0.8, Pillow → 12.3.0, pypdf → 6.16.1, sqlparse → 0.6.0, pip → 26.2. `requirements.txt` réécrit avec des planchers excluant les versions vulnérables, chaque plancher annoté de son identifiant PYSEC, et Pillow ajouté.
**Vérification :** `pip-audit` → *No known vulnerabilities found*. Les 97 tests passent après la montée de Django.
**Statut : CORRIGÉ**

### [HIGH] H-6 — Dépendances frontend vulnérables, dont exécution de code via PDF

**Fichier :** `frontend/package.json`
**Description :** `npm audit` relevait 8 vulnérabilités (7 hautes). La plus grave : **`pdfjs-dist` — exécution de JavaScript arbitraire à l'ouverture d'un PDF malveillant**, directement atteignable puisque l'application accepte et rend des PDF téléversés. Également `next` (contournement de middleware), `sharp`/libvips (4 CVE), `postcss`, `js-yaml`, `nanoid`, `brace-expansion`, `dompurify`.
**Correction :** `pdfjs-dist` 6.0.227 → 6.2.108 (correctif ciblé, en priorité) ; `npm audit fix` **sans `--force`** pour les transitives ; `next` 16.2.6 → 16.3.2 (montée **mineure**, même majeure — aucun `middleware.ts` dans le projet, la CVE Next n'était donc pas directement applicable, mais la montée corrige aussi `postcss` et `sharp`).
**Vérification :** `npm audit` → **0 vulnérabilité**. `tsc --noEmit` propre, `npm run build` réussi, l'API `pdf.worker.min.mjs` utilisée par l'éditeur est inchangée.
**Statut : CORRIGÉ**

---

### [MEDIUM] M-1 — `ALLOWED_HOSTS` à `*`

**Fichier :** `backend/config/settings.py`
**Risque :** empoisonnement d'en-tête `Host`, l'application répondant à tout domaine pointé vers elle.
**Correction :** valeur lue depuis l'environnement ; `*` seulement si `DEBUG=True` ; démarrage refusé en production si la liste est vide.
**Statut : CORRIGÉ**

### [MEDIUM] M-2 — En-têtes et cookies de production absents

**Fichier :** `backend/config/settings.py`
**Preuve :** `manage.py check --deploy` relevait 5 avertissements (W004, W008, W009, W012, W016).
**Correction :** `SECURE_CONTENT_TYPE_NOSNIFF`, `SECURE_REFERRER_POLICY`, `X_FRAME_OPTIONS=DENY`, `SESSION_COOKIE_HTTPONLY`, `SameSite=Lax` en permanence ; `SECURE_SSL_REDIRECT`, cookies `Secure`, HSTS 1 an, `SECURE_PROXY_SSL_HEADER` et `CSRF_TRUSTED_ORIGINS` uniquement quand `DEBUG=False`, pour ne pas casser le développement local en HTTP.
**Vérification :** `check --deploy` passe de **5 avertissements à 1** (W021, préchargement HSTS — choix délibéré : le préchargement est un engagement difficilement réversible). En-têtes confirmés sur le serveur en cours : `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`.
**Statut : CORRIGÉ**

### [MEDIUM] M-3 — Assainissement SVG par liste noire

**Fichier :** `backend/evacuation_plans/views.py` (`validate_and_sanitize_pictogram_svg`)
**Description :** l'assainisseur existant s'est révélé **bien meilleur qu'attendu** — 16 charges classiques sur 19 déjà refusées (script, `onload`, `foreignObject`, DOCTYPE/XXE, `xlink:href` externe, `@import`, `url()` externe, `data:text/html`, gestionnaires en majuscules…). Trois brèches subsistaient, toutes dues au principe de liste noire :

| Charge | Avant |
|---|---|
| élément inconnu (`<blink>`) | accepté et stocké |
| espace de noms tiers dans `<metadata>` | accepté et stocké |
| `style="width:expression(alert(1))"` | accepté |

**Correction :** liste **blanche** de 28 éléments, calibrée sur les 16 types réellement présents dans les 86 pictogrammes livrés, plus les éléments descriptifs qu'émettent Illustrator et Inkscape. Les éléments franchement hostiles sont **refusés** (message clair), les éléments simplement inconnus sont **supprimés** — un export d'outil graphique reste ainsi acceptable. Ajout du filtrage CSS `expression()`, `-moz-binding`, `behavior:` dans l'attribut `style`.
**Bonus — faux positif corrigé :** le contrôle sur l'élément `<style>` refusait tout `url(`, y compris `url(#linear-gradient)`, une référence purement interne déjà autorisée au niveau des attributs. Le pictogramme livré `vous etes ici.svg` était de ce fait **impossible à re-téléverser**, ainsi que tout SVG utilisant des dégradés via classes CSS. Les deux contrôles sont désormais alignés.
**Test :** 5 tests dédiés + vérification de non-régression : **86/86 pictogrammes livrés acceptés**.
**Statut : CORRIGÉ**

### [MEDIUM] M-4 — Aucune validation de mot de passe côté API

**Fichier :** `backend/evacuation_plans/serializers.py` (`UserRegistrationSerializer`)
**Description :** `AUTH_PASSWORD_VALIDATORS` est appliqué par les formulaires Django, **jamais** par un sérialiseur DRF. L'API acceptait donc `1234` là où l'admin le refusait.
**Correction :** `validators=[validate_password]` sur le champ.
**Test :** `test_a_weak_password_is_refused_even_when_registration_is_open`.
**Statut : CORRIGÉ**

### [MEDIUM] M-5 — Détails techniques exposés sur erreur non gérée

**Fichier :** nouveau `backend/evacuation_plans/error_handling.py`
**Description :** toute exception non reconnue par DRF remontait telle quelle, avec le risque d'exposer un chemin serveur ou une requête si `DEBUG` était resté actif.
**Correction :** gestionnaire d'exceptions DRF qui journalise systématiquement vue, chemin et identifiant utilisateur, puis laisse Django rendre une 500 nue en production. Le détail va au journal privé, pas au client.
**Statut : CORRIGÉ**

### [MEDIUM] M-6 — Modèle d'accès non conforme au modèle d'entreprise attendu

**Fichier :** `backend/evacuation_plans/models.py`, `views.py`
**Description :** l'application appliquait une isolation par propriétaire (`filter(user=request.user)`) avec un partage explicite par invitation. Le modèle attendu est : utilisateur interne authentifié → ressources communes de l'entreprise.
**Correction :** `is_internal_user()` et `restrict_plans_to()` dans `models.py`. Un compte authentifié **et actif** accède au périmètre commun. Le point de contrôle unique est conservé — le resserrer plus tard ne demande de modifier qu'une fonction.
**Conséquence assumée :** les rôles `viewer`/`editor` de `WorkspaceMembership` ne restreignent plus un compte interne, puisque celui-ci a déjà accès à tout. La fonctionnalité de partage **n'a pas été supprimée** (tables, endpoints, page `/partage` et écrans d'admin intacts, aucune donnée effacée) ; elle est simplement sans effet supplémentaire à l'intérieur du périmètre d'entreprise. **Le levier de retrait d'accès est la désactivation du compte dans l'admin.**
**Test :** `SharedWorkspaceAccessTests` — un collègue voit et modifie le plan d'un autre (comportement attendu) ; anonyme refusé en lecture comme en écriture ; compte désactivé refusé, **y compris avec un jeton émis avant la désactivation**.
**Statut : CORRIGÉ**

### [MEDIUM] M-7 — Permissions du fichier de base de données

**Fichier :** `backend/db.sqlite3`
**Preuve :** permissions `-rw-r--r--` (644) — lisible par tout compte local du serveur.
**Risque :** la base contient les empreintes de mots de passe et les clés API chiffrées. Sur un serveur mutualisé, n'importe quel utilisateur local peut la copier.
**Correction :** **non appliquée** — modifier les permissions d'un fichier de données relève de l'exploitation, pas du code, et la valeur correcte dépend de l'utilisateur système exécutant gunicorn. Voir « Actions manuelles ».
**Vérifié par ailleurs :** la base est dans `backend/`, **hors** de `media/` et `static/`, donc non servie ; elle est retirée du suivi Git ; le fichier n'a pas été touché.
**Statut : À TRAITER (action serveur)**

### [MEDIUM] M-8 — Médias accessibles sans authentification

**Fichier :** `backend/config/settings.py` (`MEDIA_URL`), configuration Nginx
**Description :** en production Nginx sert `/media/` directement. Toute personne connaissant l'URL d'un plan peut le télécharger sans être authentifiée.
**Risque :** divulgation de plans d'évacuation — donc de la topologie interne d'un bâtiment — à qui obtient une URL.
**Correction :** **non appliquée dans le code.** Rendre les médias authentifiés impose de les faire transiter par une vue Django (`X-Accel-Redirect`), ce qui change la manière dont l'éditeur charge les images et sortait du cadre « ne casse pas l'éditeur ». Atténuations livrées : `X-Content-Type-Options: nosniff` et `Content-Disposition: attachment` sur les SVG dans l'exemple Nginx, et surtout C-1 qui garantit que rien d'exécutable n'y est plus déposé.
**Statut : À TRAITER (décision d'architecture — voir Recommandations)**

---

### [LOW] L-1 — `dangerouslySetInnerHTML` dans l'éditeur

**Fichier :** `frontend/src/components/IconToolbar.tsx:356`, `frontend/src/app/evacuation-plans/[id]/editor/page.tsx:9795`
**Analyse :** les deux occurrences reçoivent `definition.svg`. Vérification faite : l'API pictogrammes ne renvoie **jamais** de balisage SVG — seulement `type`, `label`, `file_name`, `url`, `deletable` — et le frontend ne construit `svg` que depuis les constantes codées en dur de `safetyIcons.ts`. **Non exploitable en l'état.** Reste un risque latent : si un jour du balisage téléversé alimentait ce champ, ce serait un XSS direct.
**Statut : ACCEPTÉ (documenté)**

### [LOW] L-2 — JWT dans `localStorage`

**Fichier :** `frontend/src/context/AuthContext.tsx:79`
**Analyse :** rend le jeton lisible par tout script s'exécutant sur l'origine. L'alternative — cookie `HttpOnly` — imposerait une protection CSRF complète et une refonte de l'authentification. Le risque étant conditionné à un XSS, l'effort a porté sur la suppression des vecteurs d'XSS (C-1, M-3).
**Statut : ACCEPTÉ (risque réduit à la source)**

### [LOW] L-3 — Analyse XML par `xml.etree.ElementTree`

**Fichier :** `backend/evacuation_plans/views.py:7,214` — bandit **B405/B314**
**Analyse :** les déclarations `DOCTYPE` et `ENTITY` sont refusées par une vérification textuelle **avant** l'analyse, ce qui ferme XXE et « billion laughs » ; ElementTree ne résout de toute façon pas les entités externes. Vérifié par `test_a_svg_declaring_an_external_entity_is_refused`.
**Recommandation non appliquée :** remplacer par `defusedxml` ajouterait une dépendance pour un risque déjà couvert.
**Statut : ACCEPTÉ (atténué et testé)**

### [LOW] L-4 — Absence de pagination

**Fichier :** `backend/config/settings.py`
**Analyse :** `/api/plans/` renvoie toute la liste. Sans limite, elle grossit indéfiniment. Non corrigé : ajouter la pagination changerait la forme des réponses et casserait la page de liste du frontend, hors périmètre d'un audit.
**Statut : À TRAITER (dette, non urgente)**

### [LOW] L-5 — `try/except/pass`

**Fichier :** `backend/evacuation_plans/grok_cleaning.py:641`, `views.py:910` — bandit **B110**
**Analyse :** code défensif autour de l'introspection d'erreurs gRPC, déjà commenté comme tel. Aucune donnée ni décision de sécurité n'en dépend.
**Statut : ACCEPTÉ**

---

### [INFO] Points vérifiés sans anomalie

* **Injection SQL — NON APPLICABLE.** Aucun `.raw()`, `cursor.execute()`, `.extra()` ni SQL construit à la main dans tout le code applicatif. L'ORM Django est utilisé partout.
* **Commandes système — NON APPLICABLE.** Aucun `subprocess`, `os.system`, `shell=True`, `eval` ni `exec`.
* **SSRF sur URL fournie par l'utilisateur — NON APPLICABLE.** Aucune fonctionnalité ne télécharge une URL saisie par un utilisateur. Le seul `urlopen` concerne la réponse de l'API xAI (voir H-4).
* **Path traversal — DÉJÀ COUVERT.** Vérifié sur les deux surfaces : `../../../../evil.png` en fond de plan atterrit dans `backgrounds/evil.png` ; la gestion des pictogrammes utilise `os.path.basename` avec comparaison stricte au nom d'origine, contrôle d'extension et `normalize_pictogram_name` qui retire séparateurs et caractères de contrôle.
* **Secrets exposés au navigateur — AUCUN.** Seul `NEXT_PUBLIC_API_URL` est publié. Aucune clé OpenAI ou xAI n'est présente côté frontend.
* **Secrets dans les journaux — AUCUN.** Aucune journalisation de mot de passe, clé, jeton ou en-tête `Authorization`.
* **Git — PROPRE.** Aucun `.env`, `db.sqlite3`, `.pyc` ni `__pycache__` suivi. `backend/.env` n'a **jamais** figuré dans l'historique (`git log` sur ce chemin est vide).
* **Endpoints anonymes — UN SEUL.** `/api/auth/register/`, fermé par défaut (403). Tout le reste exige une authentification, y compris les 20 actions détaillées, qui passent toutes par `get_object()`.
* **Nginx — ABSENT DU DÉPÔT.** Un exemple durci a été fourni (voir Fichiers modifiés).

---

## Sécurité des uploads et SVG

Après correction, la chaîne complète pour un fond de plan :

```
fichier reçu
  ├─ taille ≤ 30 Mo                         sinon 400
  ├─ extension dans la liste blanche        sinon 400   (déduite du contenu si absente)
  ├─ contenu non vide                       sinon 400
  ├─ PDF  → magique %PDF-                   sinon 400
  ├─ SVG  → assainisseur complet            sinon 400   → stocké assaini
  └─ image → décodage Pillow + format cohérent avec l'extension
             + dimensions ≤ 20 000 px et ≤ 80 Mpx (vérifiées avant décodage)
  └─ nom normalisé, écrit sous media/backgrounds/
```

Pour les pictogrammes SVG : plafond 250 Ko, `DOCTYPE`/`ENTITY` refusés, liste blanche de 28 éléments, éléments hostiles refusés, éléments inconnus supprimés, gestionnaires `on*` refusés, `href`/`src` externes refusés, `javascript:` et `data:text/html` refusés, `url()` externe refusé dans les attributs **comme** dans `<style>`, CSS dangereux refusé.

---

## Authentification et permissions

| Élément | État |
|---|---|
| Connexion | JWT, limitée à 10/min par adresse |
| Rafraîchissement | limité, même compteur |
| Déconnexion | côté client (suppression du jeton) — **pas d'invalidation serveur**, voir ci-dessous |
| Durée du jeton d'accès | 1 jour |
| Durée du jeton de rafraîchissement | 7 jours, sans rotation |
| Mot de passe | validateurs Django appliqués à la création |
| Réinitialisation de mot de passe | **inexistante** — passe par l'admin |
| Inscription publique | fermée (403) |
| Compte désactivé | rejeté, y compris avec un jeton antérieur ✅ |
| Élévation de privilèges | impossible via l'API ✅ |

**Point ouvert — invalidation des jetons.** Sans l'application `token_blacklist`, un jeton d'accès volé reste valable jusqu'à un jour, et un jeton de rafraîchissement jusqu'à sept, même après déconnexion. La désactivation du compte, elle, prend effet **immédiatement** (testé). Activer `rest_framework_simplejwt.token_blacklist` avec rotation demande une migration et une modification du flux de déconnexion côté frontend : hors périmètre d'un audit qui ne doit pas casser l'authentification existante. Voir Recommandations.

---

## Sécurité des API OpenAI / Grok

* Les clés ne transitent **jamais** par le frontend : tous les appels partent de Django.
* La clé xAI de chaque utilisateur est chiffrée au repos (AES-like par flux + HMAC-SHA256, clés dérivées de `SECRET_KEY`) ; l'API expose uniquement un booléen `has_api_key`. **Vérifié par test** que la clé n'apparaît ni dans `/api/xai-settings/`, ni dans `/api/plans/`, ni en clair en base.
* Contrôle des coûts : `AiRateThrottle` à 30/h par utilisateur sur les 4 actions payantes.
* Délais d'attente configurés (`XAI_REQUEST_TIMEOUT_SECONDS`), travaux bloqués expirés (`GROK_JOB_STALE_SECONDS`).
* Réponses du modèle traitées en données non fiables : schéma JSON strict, validation des instructions générées, et depuis cet audit **restriction de schéma et d'adresse sur l'URL d'image renvoyée** (H-4).
* Aucune réponse d'IA ne peut déclencher d'exécution système, d'accès fichier arbitraire, de modification de permissions ni de SQL — aucune de ces primitives n'existe dans le code.
* **Injection de prompt :** les données utilisateur alimentant les prompts sont des images et des options énumérées, jamais du texte libre concaténé dans une instruction. Une réponse manipulée peut au pire produire un plan nettoyé incorrect — visible par l'utilisateur — sans franchir de frontière de sécurité.

---

## Sécurité SQLite

| Contrôle | État |
|---|---|
| Emplacement | `backend/db.sqlite3` — **hors** de `media/` et `static/` ✅ |
| Servie par Nginx | non ✅ ; règle de refus supplémentaire dans l'exemple fourni |
| Suivie par Git | non ✅ ; présente dans `.gitignore` |
| Permissions du fichier | **644 — à corriger** (M-7) |
| Injection SQL | aucune surface (ORM exclusivement) ✅ |
| Migrations | 20 appliquées, cohérentes ✅ |
| Transactions | `sync-*` en `transaction.atomic()` ✅ |
| Sauvegarde | **aucune procédure** — voir Recommandations |
| Concurrence en écriture | limite connue de SQLite : un seul écrivain. Acceptable pour un usage interne ; c'est le premier motif de migration ultérieure. |

**La base n'a été ni supprimée, ni recréée, ni vidée.** Seules les migrations en attente (`0019`, `0020`) ont été appliquées.

---

## Sécurité Next.js

* Aucun secret dans `NEXT_PUBLIC_*` — seule l'URL de l'API.
* Aucune route d'API Next, aucune Server Action, aucun middleware : la surface serveur du frontend est nulle. Toute autorisation est appliquée côté Django.
* `dangerouslySetInnerHTML` : 2 occurrences, alimentées par des constantes (L-1).
* Jeton en `localStorage` (L-2).
* CSP : à poser au niveau Nginx (exemple fourni, calibré pour ne pas casser Konva ni le rendu SVG).
* Dépendances : 0 vulnérabilité après correction.

---

## Sécurité Django

`manage.py check --deploy`, avec une vraie `SECRET_KEY` :

| Avant l'audit | Après |
|---|---|
| W004 HSTS absent | corrigé |
| W008 redirection SSL absente | corrigé |
| W009 SECRET_KEY faible | corrigé (garde au démarrage) |
| W012 cookie de session non `Secure` | corrigé |
| W016 cookie CSRF non `Secure` | corrigé |
| — | W021 préchargement HSTS — **choix délibéré** |

**5 avertissements → 1.**

**CSRF :** l'API est sans état et authentifiée par en-tête `Authorization` ; elle n'est donc pas exposée au CSRF (un site tiers ne peut pas forger cet en-tête). L'admin Django, lui, utilise des sessions et conserve `CsrfViewMiddleware` actif, avec cookies `Secure`, `SameSite=Lax` et `CSRF_TRUSTED_ORIGINS` en production.

---

## Dépendances

| | Avant | Après |
|---|---|---|
| Backend (`pip-audit`) | 46 vulnérabilités / 5 paquets | **0** |
| Frontend (`npm audit`) | 8 vulnérabilités (7 hautes) | **0** |

Aucune montée majeure n'a été faite à l'aveugle. `npm audit fix --force` n'a **jamais** été exécuté.

---

## Tests exécutés

| Commande | Résultat |
|---|---|
| `manage.py test evacuation_plans` | **97 tests, OK** (78 avant l'audit + 19 ajoutés) |
| `manage.py check` | 0 problème |
| `manage.py check --deploy` (production simulée) | 1 avertissement (W021, délibéré) |
| `bandit -r evacuation_plans config` | 6 signalements, tous analysés : 2 corrigés, 4 acceptés avec justification |
| `pip-audit --skip-editable` | *No known vulnerabilities found* |
| `npm audit` | *found 0 vulnerabilities* |
| `tsc --noEmit` | propre |
| `npm run build` | réussi, 10 routes générées |
| Vérification manuelle des 86 pictogrammes livrés | 86/86 acceptés |
| Sondes d'upload (12 charges) | toutes les charges hostiles → 400, les légitimes → 201 |
| Sondes SVG (12 charges) | toutes refusées ou nettoyées |
| Sondes SSRF (7 URL) | 6 refusées, 1 légitime acceptée |
| API en fonctionnement (`curl`) | `/api/plans/` → 401, `/admin/` → 302, en-têtes de sécurité présents |

**19 tests de sécurité ajoutés :** inscription publique fermée, mot de passe faible refusé, pas d'auto-promotion en administrateur, admin inaccessible à un utilisateur normal, admin accessible à un administrateur, clé API jamais renvoyée, clé API non stockée en clair, 5 tests SVG, 5 tests d'upload, SSRF, limitation de la force brute.

---

## Fichiers modifiés

| Fichier | Raison |
|---|---|
| `backend/config/settings.py` | `DEBUG` par défaut à `False` ; `ALLOWED_HOSTS` et CORS depuis l'environnement avec échec explicite ; `CORS_ALLOW_CREDENTIALS=False` ; en-têtes et cookies de production ; limitation de débit ; gestionnaire d'erreurs |
| `backend/evacuation_plans/upload_validation.py` | **nouveau** — validation complète des fichiers téléversés (C-1) |
| `backend/evacuation_plans/throttles.py` | **nouveau** — portées de limitation (connexion, IA, upload) |
| `backend/evacuation_plans/error_handling.py` | **nouveau** — pas de détail technique renvoyé sur erreur non gérée |
| `backend/evacuation_plans/serializers.py` | validation du fond de plan ; validation du mot de passe |
| `backend/evacuation_plans/views.py` | validation dans `change-background` ; liste blanche SVG ; limitation sur 6 actions ; périmètre partagé |
| `backend/evacuation_plans/models.py` | `is_internal_user`, `restrict_plans_to` — point de contrôle d'accès unique |
| `backend/evacuation_plans/grok_cleaning.py` | restriction de schéma et d'adresse sur `urlopen` ; lecture bornée (H-4) |
| `backend/evacuation_plans/urls.py` | connexion et rafraîchissement limités |
| `backend/evacuation_plans/tests.py` | 19 tests de sécurité ; 7 tests réalignés sur le modèle partagé |
| `backend/requirements.txt` | planchers excluant les versions vulnérables ; Pillow ajouté (il manquait) |
| `backend/.env.example` | documentation des variables obligatoires en production |
| `frontend/package.json` | `pdfjs-dist` 6.2.108, `next` 16.3.2, transitives corrigées |
| `deploy/nginx-evacstudio.conf.example` | **nouveau** — exemple durci : HTTPS, en-têtes, CSP, blocage `.env`/`.git`/SQLite, SVG en pièce jointe |

Aucun fichier de données n'a été supprimé ni modifié. `db.sqlite3` et `media/` sont intacts.

---

## Actions manuelles nécessaires

1. **Restreindre les permissions de la base** (M-7) :
   ```
   chown www-data:www-data backend/db.sqlite3 && chmod 600 backend/db.sqlite3
   chmod 750 backend/media
   ```
   Adapter l'utilisateur à celui qui exécute gunicorn.

2. **Rotation des secrets.** `SECRET_KEY` et `JWT_SECRET` de production doivent être générés et distincts. Aucun secret n'a été trouvé dans l'historique Git, mais la valeur de repli présente dans le code est publique : si un serveur a déjà tourné avec elle, tous les jetons émis sont forgeables et une rotation est **impérative**. Changer `JWT_SECRET` déconnecte tout le monde — à faire hors heures ouvrées.

3. **Variables d'environnement de production.** `SECRET_KEY`, `JWT_SECRET`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS` sont désormais **obligatoires** : le serveur refuse de démarrer sans elles quand `DEBUG=False`. C'est voulu — il vaut mieux un démarrage refusé qu'une mise en ligne silencieusement ouverte.

4. **Nginx et HTTPS.** Appliquer `deploy/nginx-evacstudio.conf.example`, obtenir un certificat, puis **vérifier la CSP dans l'éditeur** (Konva, pictogrammes, export) avant d'ouvrir aux utilisateurs.

5. **Pare-feu.** Les ports 3000 et 8000 ne doivent pas être joignables de l'extérieur :
   ```
   ss -tlnp | grep -E '3000|8000'
   ```
   doit montrer `127.0.0.1`, pas `0.0.0.0`.

6. **Protéger l'admin Django.** C'est le point de compromission unique du projet : URL devinable, mot de passe seul, ni double authentification ni blocage après échecs. Le restreindre par IP ou VPN (bloc prévu dans l'exemple Nginx), et n'accorder `is_staff` qu'aux personnes qui en ont besoin.

7. **Sauvegarde.** Aucune procédure n'existe. Pour SQLite :
   ```
   sqlite3 backend/db.sqlite3 ".backup '/srv/backups/evacstudio-$(date +%F).sqlite3'"
   ```
   `media/` doit être sauvegardé avec — les plans y sont, pas dans la base. Les sauvegardes ne doivent jamais être déposées dans un répertoire servi.

8. **Comptes existants.** Vérifier dans l'admin qu'aucun compte de test ne subsiste et qu'aucun `is_staff` n'est accordé par erreur.

---

## Recommandations avant déploiement

**Bloquant**

- [ ] `SECRET_KEY` et `JWT_SECRET` de production générés, distincts, hors du dépôt
- [ ] `ALLOWED_HOSTS` et `CORS_ALLOWED_ORIGINS` renseignés avec les domaines réels
- [ ] `DEBUG=False` confirmé sur le serveur
- [ ] HTTPS actif, redirection HTTP → HTTPS
- [ ] `chmod 600` sur `db.sqlite3`
- [ ] Ports 3000 et 8000 fermés à l'extérieur
- [ ] `manage.py check --deploy` relancé sur le serveur (attendu : W021 seul)
- [ ] `manage.py migrate` exécuté
- [ ] Sauvegarde en place et **restauration testée**

**Fortement conseillé**

- [ ] Admin restreint par IP ou VPN
- [ ] CSP validée en conditions réelles sur l'éditeur
- [ ] Décision sur M-8 : médias derrière authentification (`X-Accel-Redirect`) ou risque accepté par écrit
- [ ] `token_blacklist` de SimpleJWT activé, avec rotation et déconnexion serveur
- [ ] Durée du jeton d'accès ramenée de 1 jour à 15–60 minutes
- [ ] `pip-audit` et `npm audit` intégrés au processus de mise à jour
- [ ] Journalisation vers un fichier persistant (aujourd'hui : sortie standard)

**À planifier**

- [ ] Traçabilité des actions sensibles : connexion, création et désactivation de compte, changement de rôle, suppression de plan ou de pictogramme
- [ ] Pagination de `/api/plans/` (L-4)
- [ ] Migration SQLite → PostgreSQL — hors périmètre de cet audit, mais la concurrence en écriture est la limite qui se manifestera en premier
- [ ] Réinitialisation de mot de passe en libre-service (aujourd'hui : par l'administrateur)
- [ ] Gel complet des dépendances (`pip freeze`) pour des reconstructions reproductibles

---

## Portée et limites de cet audit

Cet audit et les correctifs appliqués **réduisent significativement le risque** : la vulnérabilité critique est fermée et vérifiée par des tests, les 6 vulnérabilités hautes sont corrigées, les 54 vulnérabilités de dépendances sont éliminées, et 19 tests de sécurité gardent désormais ces propriétés contre une régression future.

**Cela ne constitue pas une garantie de sécurité absolue.** Un audit conduit en lisant le code et en sondant l'application ne remplace pas :

* un test d'intrusion mené par un tiers sur l'infrastructure réelle ;
* une revue de la configuration serveur telle que déployée — la présente revue s'appuie sur un exemple Nginx, aucun fichier de déploiement ne figurant dans le dépôt ;
* une surveillance continue : de nouvelles vulnérabilités apparaîtront dans Django, Next.js et leurs dépendances après la date de ce rapport.

Neuf points restent ouverts, tous listés nominativement ci-dessus avec leur justification. Deux d'entre eux — les permissions de la base (M-7) et l'accès aux médias (M-8) — méritent une décision explicite avant la mise en production.

---
---

# Audit de finalisation avant déploiement

**Date :** 22 août 2026 — seconde passe
**Périmètre :** uniquement les points restés ouverts à l'issue de l'audit initial. Aucun réaudit complet.
**Rappel du modèle :** logiciel interne, ressources partagées entre utilisateurs internes, comptes créés par l'administrateur, SQLite conservée.

## Reprise des points ouverts

### M-8 — Médias accessibles sans authentification

**Ancien statut :** À TRAITER (décision d'architecture)

**Analyse préalable.** Le point bloquant n'était pas Django mais le navigateur :
les plans sont affichés par des balises `<img>` et par `new Image()` dans
l'éditeur Konva — **aucune de ces deux API ne permet d'ajouter un en-tête HTTP**,
et le jeton JWT vit dans `localStorage`, pas dans un cookie envoyé
automatiquement. Exiger `Authorization` sur `/media/` aurait cassé l'affichage de
tous les plans, de tous les pictogrammes et tous les exports.

Inventaire réalisé avant toute modification :

| Question | Réponse mesurée |
|---|---|
| Où les URL sont-elles produites ? | 3 endroits : `PlanOverlaySerializer`, `PlanCleaningHistorySerializer`, `build_plan_pictogram_url`, plus le `FileField` de DRF pour `background_file` |
| Comment sont-elles consommées ? | `<img src>`, `new Image()` (Konva), `<a href>` — jamais par `fetch` |
| Une URL est-elle renvoyée au backend ? | Non |
| Une URL est-elle persistée côté client ? | Non (vérifié sur tous les `localStorage.setItem`) |
| Que contient `media/` ? | 1 311 fichiers de plans (privés) + 86 pictogrammes (bibliothèque partagée) |

**Action réalisée.** URL signées (HMAC-SHA256 sur chemin + expiration, dérivée de
`SECRET_KEY` avec une étiquette dédiée) combinées à `X-Accel-Redirect`. La preuve
d'autorisation est dans l'URL, donc `<img>` fonctionne sans rien ajouter — c'est
le mécanisme des URL pré-signées S3. Deux voies d'accès sont acceptées : une
signature valide, ou une requête authentifiée.

En production Django ne lit pas le fichier : il répond `X-Accel-Redirect` et
Nginx sert depuis une `location internal`, inatteignable de l'extérieur. Django
décide, Nginx transporte.

Décisions annexes :
* `/media/` n'est plus servi **même en développement** — servir les deux ferait
  cohabiter une porte contrôlée et une porte ouverte, et le développement ne
  testerait plus ce que la production applique ;
* la bibliothèque de pictogrammes passe par le même chemin : deux régimes
  auraient multiplié les occasions d'erreur ;
* tout type non reconnu est servi en `application/octet-stream` avec
  `Content-Disposition: attachment` — un SVG rendu en ligne s'exécuterait sur
  l'origine de l'application ;
* `SignedFileField` ne redéfinit que `to_representation` : le nom du champ et le
  format attendu par le frontend sont inchangés, l'upload passe par le
  comportement d'origine.

**Fichiers :** `evacuation_plans/media_access.py` (nouveau),
`evacuation_plans/media_views.py` (nouveau), `evacuation_plans/serializers.py`,
`evacuation_plans/views.py`, `evacuation_plans/urls.py`, `config/settings.py`,
`config/urls.py`, `deploy/nginx-evacstudio.conf.example`

**Tests :** `ProtectedMediaTests`, 13 cas — URL signée émise par l'API ; anonyme
sans signature refusé (403) ; **URL signée acceptée sans aucun identifiant** (le
cas `<img>`) ; utilisateur authentifié accepté sans signature ; signature
falsifiée refusée ; signature expirée refusée ; signature non transposable à un
autre fichier ; 4 formes de path traversal refusées ; fichier absent → 404 pur ;
**aucun chemin serveur ni trace d'exécution dans les réponses** ; `db.sqlite3` et
`.env` inatteignables par cette route ; SVG servi en pièce jointe ;
`X-Accel-Redirect` émis en production avec un corps vide.

**Nouveau statut : CORRIGÉ DANS LE CODE** — la directive `internal` de Nginx
reste à appliquer sur le serveur (§5 de `deploy/DEPLOYMENT.md`). Sans elle les
médias redeviennent publics.

---

### Invalidation des jetons JWT

**Ancien statut :** À TRAITER (point ouvert de la section Authentification)

**Action réalisée.**
* `rest_framework_simplejwt.token_blacklist` activé ; **13 migrations appliquées**
  (`token_blacklist.0001` à `0013`) ;
* jeton d'accès : 1 jour → **30 minutes** ; rafraîchissement : 7 jours ;
* `ROTATE_REFRESH_TOKENS = True` et `BLACKLIST_AFTER_ROTATION = True` : chaque
  rafraîchissement émet un nouveau jeton et révoque l'ancien ;
* endpoint `POST /api/auth/logout/` qui met le jeton de rafraîchissement sur
  liste noire, avec vérification que le jeton appartient bien à l'appelant ;
* frontend : `logout()` envoie le jeton avant d'effacer la session locale.

**Régression évitée.** Le passage de 1 jour à 30 minutes aurait cassé les
sessions d'édition : l'éditeur émet **23 requêtes par `fetch` brut** contre 5 via
`authenticatedFetch` (qui seul sait rejouer un 401). Plutôt que de réécrire 23
appels — chantier risqué —, un renouvellement en arrière-plan toutes les 20
minutes a été ajouté dans `AuthContext` : un seul point, qui couvre tous les
appelants.

**Fichiers :** `config/settings.py`, `evacuation_plans/views.py`,
`evacuation_plans/urls.py`, `frontend/src/context/AuthContext.tsx`

**Tests :** `JwtSessionTests`, 8 cas — jeton valide accepté ; durée de vie ≤ 1 h
vérifiée ; déconnexion rendant le jeton inutilisable ; déconnexion exigeant le
jeton ; **jeton pivoté non rejouable, le nouveau restant valide** ; un
utilisateur ne peut pas révoquer la session d'un autre (403, et la session de la
victime reste utilisable) ; **compte désactivé refusé immédiatement, jeton
d'accès comme de rafraîchissement** ; double déconnexion sans erreur.

**Nouveau statut : CORRIGÉ DANS LE CODE**

---

### Protection de l'admin Django

**Ancien statut :** À TRAITER (recommandation)

**Analyse.** Le contrôle d'accès était déjà correct : Django exige `is_active` et
`is_staff`, ce que deux tests couvraient déjà. Le manque réel était la force
brute — `/admin/login/` est une vue Django ordinaire, hors de portée des
throttles de DRF, et acceptait un nombre illimité de tentatives.

**Action réalisée.** Middleware `AdminLoginRateLimitMiddleware` : 10 tentatives
par adresse et par fenêtre de 5 minutes, compteur en cache, remis à zéro par une
connexion réussie. Volontairement **sans dépendance** — `django-axes` aurait
apporté modèles, migrations et backend d'authentification pour un besoin que le
cache couvre en quelques lignes.

Limite documentée : avec le cache local par défaut, chaque worker compte
séparément ; la protection devient exacte dès que le cache est partagé (Redis,
Memcached).

Restriction par IP : **volontairement absente du code**, présente en option
commentée dans la configuration Nginx. C'est une décision d'exploitation, pas une
constante applicative.

**Fichiers :** `evacuation_plans/admin_protection.py` (nouveau),
`config/settings.py`, `deploy/nginx-evacstudio.conf.example`

**Tests :** `AdminBruteForceTests`, 2 cas — 14 tentatives déclenchent un 429 ;
une connexion réussie remet le compteur à zéro.

**Nouveau statut : CORRIGÉ DANS LE CODE** — restriction réseau à appliquer sur
le serveur.

---

### SECRET_KEY et JWT_SECRET

**Ancien statut :** À TRAITER (action manuelle)

**Analyse.** Les gardes existantes ont été testées en simulant un déploiement
sans `.env`. Deux écarts avec l'exigence :

| Cas | Avant | Après |
|---|---|---|
| `SECRET_KEY` absente | refusé | refusé |
| `SECRET_KEY` = valeur publique du dépôt | refusé | refusé |
| `JWT_SECRET` absente | **démarrait** (repli sur `SECRET_KEY`) | refusé |
| `JWT_SECRET` = `SECRET_KEY` | **démarrait** | refusé |
| `JWT_SECRET` = valeur publique du dépôt | refusé | refusé |
| `ALLOWED_HOSTS` / `CORS_ALLOWED_ORIGINS` absentes | refusé | refusé |
| Développement, rien de défini | démarre | démarre |

**Action réalisée.** En production, `JWT_SECRET` est obligatoire et doit différer
de `SECRET_KEY`. Raison : une clé unique signant à la fois les jetons d'API, les
sessions, les cookies CSRF et les liens de réinitialisation fait qu'une faiblesse
dans un domaine les compromet tous, et qu'aucune ne peut être renouvelée sans
renouveler l'autre. Le développement local reste inchangé.

Aucun secret réel n'a été généré ni écrit dans un fichier suivi par Git.

**Fichiers :** `config/settings.py`, `backend/.env.example`, `deploy/DEPLOYMENT.md`

**Nouveau statut : CORRIGÉ DANS LE CODE** — les valeurs de production restent à
générer sur le serveur.

---

### M-7 — Permissions de la base et sauvegarde

**Ancien statut :** À TRAITER (action serveur)

**Action réalisée.** `deploy/backup_evacstudio.sh`, non destructif :

* copie via `sqlite3 .backup` — une copie `cp` d'une base en cours d'écriture
  serait corrompue ;
* `PRAGMA integrity_check` sur la copie produite ;
* archive de `media/` — les plans sont dans les fichiers, pas dans la base :
  sauvegarder l'une sans l'autre ne permet pas de restaurer ;
* refus si `BACKUP_DIR` se trouve dans un répertoire servi publiquement ;
* noms datés, permissions 600, répertoire 700 ;
* **purge désactivée par défaut** : elle ne s'active qu'avec
  `BACKUP_RETENTION_DAYS`, et ne cible que les fichiers produits par ce script ;
* procédure de restauration en commentaire de fin.

**Vérification :** exécuté réellement dans un répertoire temporaire — base 55 Mo
et médias 94 Mo sauvegardés, intégrité vérifiée, rien supprimé. La base d'origine
a été contrôlée après coup : `integrity_check = ok`, 13 plans, taille inchangée.

`chown` / `chmod` **non exécutés** : l'utilisateur système de gunicorn n'est pas
connu depuis ce poste, et se tromper de propriétaire rendrait l'application
incapable d'écrire. Commandes fournies dans `deploy/DEPLOYMENT.md` §2.

**Fichiers :** `deploy/backup_evacstudio.sh` (nouveau), `deploy/DEPLOYMENT.md` (nouveau)

**Nouveau statut : CONFIGURATION PRÊTE, À APPLIQUER SUR LE SERVEUR**

---

### Nginx et Content-Security-Policy

**Ancien statut :** À TRAITER (configuration fournie, non appliquée)

**Action réalisée sur la configuration Nginx :** ajout de `location
/protected-media/ { internal; }`, fermeture explicite de `/media/`,
`proxy_buffering on` (nécessaire à `X-Accel-Redirect`), et note reliant
`client_max_body_size` à la limite Django.

**CSP — établie sur mesures, pas sur un modèle type.** Ce qui a été vérifié dans
le code et le build :

| Besoin | Mesure | Conséquence |
|---|---|---|
| `eval` / `new Function` | 0 dans le code applicatif ; 0 dans pdf.js v6 (le seul « résultat » était `new FunctionBasedShading`, faux positif) | **`'unsafe-eval'` non accordé** |
| Scripts en ligne | Next.js en émet dans le build | `script-src 'unsafe-inline'` requis |
| Origines externes | `fonts.googleapis.com` et `fonts.gstatic.com`, et rien d'autre | ajoutées explicitement |
| `toDataURL` | 22 occurrences | `img-src data:` |
| `createObjectURL` | 4 occurrences | `img-src blob:` |
| Worker pdf.js | présent | `worker-src 'self' blob:` |
| Styles en ligne | 22 fichiers | `style-src 'unsafe-inline'` |

La CSP de la première version aurait **cassé la typographie de l'application** :
elle omettait les deux hôtes Google Fonts. Corrigé.

Permissivités restantes, documentées dans le fichier : `script-src
'unsafe-inline'` (hydratation Next — la suppression propre demande des nonces,
donc un middleware Next) et `style-src 'unsafe-inline'` (Konva).

**Fichiers :** `deploy/nginx-evacstudio.conf.example`, `deploy/DEPLOYMENT.md`

**Nouveau statut : CONFIGURATION PRÊTE, À APPLIQUER SUR LE SERVEUR**

---

### Traçabilité des actions sensibles

**Ancien statut :** À PLANIFIER

**Action réalisée.** Journal d'audit dédié (`evacstudio.audit`), branché sur les
**signaux Django** plutôt que sur chaque vue : une suppression faite depuis
l'admin est ainsi tracée exactement comme une suppression faite par l'API, sans
code dupliqué ni oubli possible.

Événements tracés : connexion réussie et échouée (API et admin), déconnexion,
création de compte, activation/désactivation, changement de rôle
(`is_staff`/`is_superuser`), changement de mot de passe (le fait, jamais
l'empreinte), suppression de compte, suppression de plan, octroi et révocation
d'accès partagé, création/modification/suppression de clé API (le fait, jamais la
valeur), suppression de pictogramme.

Configuration `LOGGING` avec deux flux : `audit.log` (20 fichiers de rotation, la
piste d'audit se conserve) et `evacstudio.log`. Sans `LOG_DIR`, tout part sur la
sortie standard — ce que systemd capture déjà.

**Nuance relevée pendant l'implémentation :** les échecs de connexion par l'API
sont tracés par le signal `user_login_failed`, pas par la vue — SimpleJWT lève
une exception et le code placé après `super().post()` ne s'exécute jamais. La
branche correspondante, écrite d'abord puis constatée morte, a été retirée
plutôt que laissée en place.

**Fichiers :** `evacuation_plans/signals.py`, `evacuation_plans/urls.py`,
`evacuation_plans/views.py`, `config/settings.py`

**Tests :** `AuditLogTests`, 6 cas — création de compte, changement de rôle et
désactivation tracés ; suppression de plan tracée ; changement de clé API tracé
**sans la clé** ; échec de connexion tracé **sans le mot de passe** ; connexion
réussie tracée **sans les jetons émis** ; octroi et révocation d'accès tracés.
Chaque test vérifie en outre l'absence de tout marqueur sensible.

**Nouveau statut : CORRIGÉ DANS LE CODE**

---

### L-4 — Pagination de `/api/plans/`

**Ancien statut :** À TRAITER (dette, non urgente)

**Analyse.** Les deux consommateurs de la liste tolèrent bien le format paginé
(`Array.isArray(data) ? data : data.results || []`), mais la **sémantique**
casserait :

* `dashboard/page.tsx` compte `.length` du tableau reçu — il afficherait le
  nombre d'éléments de la première page, pas le total. Il devrait lire `count` ;
* `evacuation-plans/page.tsx` afficherait la première page **sans aucune
  navigation** : au-delà de la limite, des plans deviendraient invisibles sans
  que rien ne le signale.

Ajouter la pagination sans ces deux modifications reviendrait à masquer des
données — plus grave que le problème traité. Volume actuel : 13 plans.

**Action réalisée :** aucune, délibérément. Changements requis documentés
ci-dessus.

**Nouveau statut : À TRAITER (documenté, non urgent)**

---

## État final avant production

### Restant par sévérité

| | Nombre | Détail |
|---|---|---|
| **CRITICAL** | **0** | — |
| **HIGH** | **0** | — |
| **MEDIUM** | **0 dans le code** | M-7 et M-8 corrigés côté code ; leur application serveur figure ci-dessous |
| **LOW** | **4** | L-1 `dangerouslySetInnerHTML` (non exploitable, documenté) · L-2 JWT en `localStorage` (risque réduit à la source) · L-3 `ElementTree` (atténué et testé) · L-4 pagination (documenté) · L-5 `try/except/pass` (accepté) |

Aucune vulnérabilité CRITICAL, HIGH ou MEDIUM ne subsiste dans le code.

### Actions serveur encore manuelles

Rien de ce qui suit ne peut être fait depuis le dépôt.

| Action | Pourquoi elle ne peut pas être automatisée |
|---|---|
| **Variables d'environnement** — `SECRET_KEY`, `JWT_SECRET` (distinctes), `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS` | Générer un secret dans un fichier suivi par Git le rendrait public. Le démarrage est refusé sans elles. |
| **Permissions** — `chown`/`chmod 600` sur `db.sqlite3` et `.env`, `750` sur `media/` | L'utilisateur système de gunicorn est inconnu depuis ce poste ; se tromper rendrait l'application incapable d'écrire. |
| **Nginx** — installer la configuration, en particulier `location /protected-media/ { internal; }` | Sans `internal`, les médias redeviennent publics et tout le dispositif de signature devient inutile. |
| **Certificat SSL / DNS** | Dépend du domaine réel. |
| **Pare-feu** — 3000 et 8000 fermés, services liés à `127.0.0.1` | Sinon Nginx est contournable, en clair et sans en-têtes de sécurité. |
| **Restriction de l'admin par IP ou VPN** | Une plage d'adresses codée en dur n'a pas sa place dans le code. |
| **Cron de sauvegarde** et test de restauration | Le script est prêt ; la planification et le test relèvent du serveur. |
| **Rotation des secrets** si un serveur a déjà tourné avec la clé de repli publique | Tous les jetons émis seraient forgeables. |

### Checklist de déploiement

1. `git pull` sur le serveur, `pip install -r requirements.txt`, `npm ci && npm run build`
2. Créer `backend/.env` : `DEBUG=False`, `SECRET_KEY`, `JWT_SECRET` (distincte), `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS` — puis `chmod 600`
3. **Sauvegarder** la base et `media/` avant toute migration
4. `manage.py migrate` puis `manage.py collectstatic --noinput`
5. `manage.py createsuperuser` — premier administrateur
6. Permissions : `chown`/`chmod` sur `db.sqlite3`, `.env`, `media/` (§2 de `deploy/DEPLOYMENT.md`)
7. Services systemd liés à `127.0.0.1` ; vérifier avec `ss -tlnp | grep -E '3000|8000'`
8. Pare-feu : 80/443 ouverts, 3000 et 8000 refusés
9. Nginx : installer la configuration, vérifier `internal` sur `/protected-media/`, `nginx -t`, recharger
10. Certificat SSL (`certbot`), vérifier la redirection HTTP → HTTPS
11. `manage.py check --deploy` — attendu : `security.W021` seul
12. Restreindre `/admin/` par IP ou VPN
13. Cron de sauvegarde, puis **tester une restauration**
14. Vérification fonctionnelle connecté : ouverture d'un plan, pictogrammes, import PDF, export PNG et PDF, déconnexion — console du navigateur sans erreur CSP
15. Vérifier que `https://<domaine>/media/<fichier>` renvoie 404 et que les plans s'affichent malgré tout dans l'éditeur

### Tests exécutés lors de cette passe

| Commande | Résultat |
|---|---|
| `manage.py test evacuation_plans` | **126 tests, OK** (97 → 126, **29 ajoutés**) |
| `manage.py check` | 0 problème |
| `manage.py check --deploy` (production simulée) | 1 avertissement (`W021`, délibéré) |
| `manage.py migrate` | 13 migrations `token_blacklist` appliquées |
| `bandit -r evacuation_plans config` | 6 signalements, tous déjà analysés et acceptés lors de la passe initiale |
| `pip-audit --skip-editable` | *No known vulnerabilities found* |
| `npm audit` | *found 0 vulnerabilities* |
| `npx tsc --noEmit` | propre |
| `npm run build` | réussi |
| `deploy/backup_evacstudio.sh` | exécuté réellement : 55 Mo + 94 Mo, intégrité `ok`, base d'origine intacte |
| Gardes de secrets | 8 scénarios de démarrage vérifiés |

### Fichiers de cette passe

| Fichier | Raison |
|---|---|
| `evacuation_plans/media_access.py` | **nouveau** — signature HMAC des chemins média |
| `evacuation_plans/media_views.py` | **nouveau** — porte unique vers `MEDIA_ROOT`, `X-Accel-Redirect` |
| `evacuation_plans/admin_protection.py` | **nouveau** — force brute sur `/admin/login/` |
| `evacuation_plans/signals.py` | journal d'audit des actions sensibles |
| `evacuation_plans/serializers.py` | `SignedFileField`, URL signées |
| `evacuation_plans/views.py` | endpoint de déconnexion, pictogrammes signés, traces d'audit |
| `evacuation_plans/urls.py` | route `/api/media/`, `/api/auth/logout/`, trace de connexion |
| `evacuation_plans/tests.py` | 29 tests ajoutés |
| `config/settings.py` | blacklist JWT, rotation, réglages médias, `LOGGING`, garde `JWT_SECRET` |
| `config/urls.py` | `/media/` n'est plus servi directement |
| `frontend/src/context/AuthContext.tsx` | déconnexion serveur, renouvellement en arrière-plan |
| `deploy/nginx-evacstudio.conf.example` | `internal`, `/media/` fermé, CSP mesurée |
| `deploy/backup_evacstudio.sh` | **nouveau** — sauvegarde non destructive |
| `deploy/DEPLOYMENT.md` | **nouveau** — procédure serveur complète |
| `backend/.env.example` | nouvelles variables documentées |

Aucune donnée supprimée. `db.sqlite3` et `media/` intacts et vérifiés.

### Portée de cette passe

Les points bloquants et fortement conseillés de l'audit initial sont traités : la
protection des médias, l'invalidation des sessions, la protection de l'admin, les
secrets et la traçabilité sont **corrigés dans le code** et couverts par des
tests. La sauvegarde, Nginx et la CSP sont **prêts mais doivent être appliqués
sur le serveur** — ils ne peuvent pas l'être depuis le dépôt.

Le risque est significativement réduit, mais **ceci ne constitue pas une garantie
de sécurité absolue** : la configuration serveur réelle n'a pas été vérifiée
depuis ce poste, et de nouvelles vulnérabilités apparaîtront dans les
dépendances après la date de ce rapport. Un test d'intrusion sur l'infrastructure
déployée reste recommandé.
