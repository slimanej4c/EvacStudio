# Plan : 3 options de nettoyage (local plan / local murs / IA Grok) — suppression totale d'OpenAI

## Décisions confirmées
- **Modèle d'analyse** : `grok-4.5` (au lieu de `grok-4` du script, qui n'est plus documenté). Surchargeable via `XAI_ANALYSIS_MODEL`.
- **Bouton IA Grok** : simple, sans options, port fidèle du script fourni.
- **DB** : réécriture propre (suppression de `db.sqlite3` + migrations, régénération `makemigrations`).
- **Le lieu de configuration de la clé API** est conservé (dans la modale de nettoyage), mais basculé de OpenAI → xAI.

---

## A. BACKEND — Suppressions

### A.1. Fichiers à SUPPRIMER (entièrement OpenAI)
- `pipeline.py`, `plan_analyzer.py`, `plan_type_detector.py`, `plan_image_generator.py`, `image_generator.py`
- `openai_analysis.py`, `openai_image_service.py`, `openai_pricing.py`
- `cleaning_profiles.py` (ne sert qu'aux prompts OpenAI)
- `prompt_builder.py`, `verifier.py` (orphelins, appelés uniquement par les tests OpenAI)

### A.2. Dossier media à SUPPRIMER
- `backend/media/backgrounds_cleaned/openai/` (29 fichiers)

### A.3. Migrations à SUPPRIMER (réécriture propre)
- Toutes les migrations `backend/evacuation_plans/migrations/0001` → `0014` + `db.sqlite3`. Régénération via `makemigrations`.

---

## B. BACKEND — Nouveau module Grok (`grok_cleaning.py`)

Port fidèle du script fourni, adapté au backend (entrée = bytes PNG, sortie = bytes PNG nettoyés).

- Constantes : `DEFAULT_ANALYSIS_MODEL = "grok-4.5"`, `DEFAULT_EDIT_MODEL = "grok-imagine-image-quality"`, `DEFAULT_RESOLUTION = "2k"`, `MAX_EDIT_PROMPT_LENGTH = 7500`.
- La grande `ANALYSIS_INSTRUCTION` (règles de préservation architecture / retrait évacuation / schema JSON de sortie avec `compact_edit_prompt`) → reprise **verbatim** du script.
- `image_to_data_url(image_bytes)` → depuis les bytes (pas un chemin fichier).
- `clean_json_response(text)` → retire fences ```json.
- `analyze_and_clean_plan(image_bytes, api_key) -> GrokCleaningResult` :
  1. `client = Client(api_key=...)` (sync).
  2. `chat = client.chat.create(model=ANALYSIS_MODEL)` ; `chat.append(user(ANALYSIS_INSTRUCTION, image(dataetection_url, detail="high")))` ; `analysis_response = chat.sample()`.
  3. Parse JSON → extrait `compact_edit_prompt` (vérifie longueur ≤ 7500).
  4. `edit_response = client.image.sample(prompt=..., model=EDIT_MODEL, image_url=source_data_url, resolution="2k")`.
  5. Télécharge l'image depuis `edit_response.url` via `urllib.request` (stdlib, fidèle au script).
  - Retourne `dataclass` : `analysis: dict`, `generation_prompt: str`, `cleaned_image_bytes: bytes`, `analysis_model: str`, `image_model: str`, `warnings: list`.
- **Gestion d'erreurs** : catch `grpc.RpcError` → mapper les codes : `UNAUTHENTICATED`/`PERMISSION_DENIED` → `XAI_KEY_INVALID`, `RESOURCE_EXHAUSTED` → `XAI_RATE_LIMIT`, `DEADLINE_EXCEEDED` → `XAI_TIMEOUT`, autres → `XAI_FAILED`. Classe `GrokCleaningError(user_message, diagnostic, error_code)`.

---

## C. BACKEND — Modèles (`models.py`)

### À SUPPRIMER
- `_derive_openai_settings_keys`, `_build_keystream`, `encrypt_openai_api_key`, `decrypt_openai_api_key`
- `UserOpenAISettings`, `OpenAIPlanCleaningJob`

### À AJOUTER
- Fonctions crypto renommées : `_derive_xai_settings_keys` (labels `:xai-settings:enc/auth`), `encrypt_xai_api_key`, `decrypt_xai_api_key` (même schéma v1:nonce+tag+ciphertext).
- `UserXaiSettings` : `OneToOne(User, related_name='xai_settings')`, `encrypted_api_key`, timestamps, `set_api_key`/`get_api_key`.
- `GrokCleaningJob` (minimal) : `user`, `plan` FK ; `status` choices `pending/analyzing/generating/completed/failed` ; `error_code`, `error_message`, `diagnostic` ; `before_image_data`, `after_image_data` (base64 data URL pour preview) ; `analysis` JSON ; `generation_prompt` ; `model_used` ; timestamps. Méthodes `mark_status`, `mark_failed`.

### À MODIFIER — `PlanCleaningHistory`
- Supprimer `METHOD_OPENAI_SKETCH/_EXISTING/_APPLIED`, la FK `openai_job`.
- Ajouter `METHOD_GROK = 'grok'`.
- `METHOD_CHOICES` = `local`, `local_walls`, `grok`, `manual_edit`.

---

## D. BACKEND — Vues (`views.py`)

### À SUPPRIMER
- Imports OpenAI (lignes 19-46 ciblées).
- `TERMINAL_OPENAI_CLEANING_STATUSES`, `serialize_openai_cleaning_job`, `serialize_openai_cleaning_history_item`, `run_openai_cleaning_job`.
- Vues `UserOpenAISettingsView`, `SaveUserOpenAISettingsView`, `DeleteUserOpenAISettingsView`, `TestOpenAIKeyView`, `AnalyzePlanImageView`.
- `@action` : `detect_plan_type_action`, `openai_clean_cost_estimate`, `openai_clean`, `openai_clean_status`, `use_openai_cleaned`.
- `create_cleaning_history` : retirer le paramètre `openai_job`.

### À AJOUTER (en miroir du pattern OpenAI existant)
- `serialize_grok_cleaning_job(job)` (status, error, before/after images, analysis, prompt).
- `run_grok_cleaning_job(job_id)` : mark `analyzing` → `analyze_and_clean_plan` → mark `generating` → (inclut déjà la génération) → auto-applique via `save_cleaned_plan_bytes(METHOD_GROK)` + `create_cleaning_history` → stocke `after_image_data` → mark `completed`. Sur erreur → `mark_failed`. Ferme les connexions DB.
- Vues clé xAI : `UserXaiSettingsView` (GET), `SaveUserXaiSettingsView` (POST), `DeleteUserXaiSettingsView` (DELETE), `TestXaiKeyView` (POST — valide via un mini `chat.sample` grok-4.5, catch `UNAUTHENTICATED` → "invalide").
- `@action grok_clean` (POST) : vérifie clé xAI, crée `GrokCleaningJob`, stocke `before_image_data` (data URL du fond courant), lance thread daemon, renvoie 202 + job sérialisé.
- `@action grok_clean_status` (GET, `?job_id=`) : renvoie le job sérialisé.

### À RENOMMER
- `openai_clean_history` → `cleaning_history` (url `cleaning-history`).
- `use_openai_clean_history` → `use_cleaning_history` (url `use-cleaning-history`).

### À GARDER (inchangés)
- Tout le nettoyage local : `clean_plan_image`, `clean_walls_image`, `keep_wall_components`, `load_plan_image`, `save_cleaned_plan`, `save_cleaned_plan_bytes`, `encode_image_to_png_bytes`, `image_bytes_to_data_url`.
- Endpoints `clean`, `clean-walls`, `apply-manual-edit`, `revert`, `sync-*`, `pictograms`, CRUD.

---

## E. BACKEND — Serializers (`serializers.py`)
- Supprimer : `UserOpenAISettingsSerializer`, `SaveUserOpenAISettingsSerializer`, `TestOpenAIKeySerializer`, `AnalyzePlanImageSerializer`, `OpenAICleanPlanSerializer`, `OpenAICleanCostEstimateSerializer`, `UseOpenAICleanedPlanSerializer`.
- Renommer `MAX_OPENAI_IMAGE_DATA_LENGTH` → `MAX_IMAGE_DATA_LENGTH`.
- Ajouter : `UserXaiSettingsSerializer`, `SaveUserXaiSettingsSerializer`, `TestXaiKeySerializer` (miroir).

---

## F. BACKEND — URLs (`urls.py`)
- Remplacer les 5 routes `openai-*` / `openai/*` par : `xai-settings/`, `xai-settings/save/`, `xai-settings/delete/`, `xai/test-key/`.

---

## G. BACKEND — Dépendances & config
- `requirements.txt` + `requirement.txt` : retirer `openai`, ajouter `xai-sdk` (tire déjà `grpcio`, `requests`).
- Supprimer le fichier dupliqué `requirement.txt` (coquille, ne garder que `requirements.txt`).

---

## H. BACKEND — Tests (`tests.py`)
- Supprimer tous les tests OpenAI / `prompt_builder` / `verifier` / `image_generator` / `plan_analyzer` / `ai_flow`.
- Garder : auth, CRUD plans, PDF, `test_clean_and_revert_plan`, `test_clean_walls_plan`, `test_local_clean_creates_cleaning_history_entry`, tests historique (adaptés aux nouveaux noms `cleaning-history`/`use-cleaning-history`).
- Ajouter : tests sérialiseurs xAI (save/get/delete clé, sans live API).

---

## I. FRONTEND — Suppressions & réécriture

### I.1. SUPPRIMER le fichier
- `frontend/src/components/AiCleaningFlow.tsx` (entièrement OpenAI).

### I.2. RÉÉCRIRE `editor/page.tsx`
- **Retirer import** `AiCleaningFlow` (ligne 11).
- **Types** : supprimer `OpenAICleanResult/Status/CostEstimate/JobStatus/HistoryItem`. Étendre `CleanMethod = "local_plan" | "local_walls" | "grok"`.
- **State à supprimer** : tout le bloc `openai*` (370-389, 402-410) et `existing*` (390-401). `openaiHistory*` → renommés en `cleaningHistory*`.
- **Nouveau state Grok** : `xaiApiKey`, `xaiHasSavedKey`, `xaiSettingsLoading`, `xaiKeySaving`, `xaiKeyDeleting`, `xaiKeyStatus`, `xaiKeyConfigOpen`, `grokCleaning`, `grokJobId`, `grokStatus`, `grokError`.
- **Fonctions à supprimer** : `handleTestOpenAIKey`, `handleSaveOpenAIKey`, `handleDeleteOpenAIKey`, `formatOpenAISettingsDate`, `openaiStepLabels/Order`, `getOpenAIStepState`, `formatOpenAIBackendError`, `formatEstimatedCost`, `getCostPayload`, `fetchOpenAICostEstimate`, `saveOpenAIKeyForCleaning`, `clearOpenAIKeyInput`, `handleUseOpenAIPlan`.
- **Fonctions à renommer** : `fetchOpenAIHistory` → `fetchCleaningHistory` (vers `/cleaning-history/`), `handleUseOpenAIHistory` → `handleUseHistory` (vers `/use-cleaning-history/`).
- **Retirer** l'appel `fetchOpenAIHistory()` dans `handleCleanPlan`/`handleCleanWalls` → le remplacer par `fetchCleaningHistory()`.
- **Nouvelles fonctions Grok** : `fetchXaiSettings` (GET `/xai-settings/`), `handleSaveXaiKey`, `handleDeleteXaiKey`, `handleTestXaiKey` (POST `/xai/test-key/`), `launchGrokCleaning` (POST `/grok-clean/` → lance + poll), `pollGrokJob` (GET `/grok-clean-status/?job_id=` toutes 2 s, affiche l'étape : analyse → génération → terminé).
- **useEffect** : remplacer les 2 effets OpenAI par un seul qui, à l'ouverture de la modale, charge `cleaningHistory` + (si méthode Grok) `xaiSettings`.
- **Modale de nettoyage réécrite** (3 cartes `sm:grid-cols-3`) :
  1. **Nettoyage local du plan** → panneau bouton « Nettoyer le plan » (`handleCleanPlan`).
  2. **Nettoyage local des murs** → panneau bouton « Nettoyer murs uniquement » (`handleCleanWalls`).
  3. **Vider avec l'IA (Grok)** → panneau : état clé API xAI + bouton « Configurer la clé API » (champ saisie + Tester/Enregistrer/Supprimer) + bouton « Vider le plan avec l'IA » (`launchGrokCleaning`, désactivé si pas de clé). Affichage progression par étapes et erreurs.
- **`costEstimatePanel`** : remplacer la partie OpenAI par une note fixe pour Grok (« ≈ 0,05 $/image · modèle grok-imagine-image-quality 2K ») ; branche « Gratuit » conservée pour le local.
- **`cleaningHistoryPanel`** : conservé, branché sur `cleaningHistory`/`handleUseHistory` (montre les nettoyages locaux + Grok).
- **Bouton « Nettoyer » barre du haut** + bouton fermer modale : `disabled` passe de `cleaning || openaiCleaning || openaiApplying` à `cleaning || grokCleaning`.
- **Modale de réversion** : corriger le texte (retirer la mention OpenAI, évoquer l'historique générique).

---

## J. Vérification finale
1. `cd backend && python manage.py makemigrations evacuation_plans` → migration initiale propre.
2. `python manage.py migrate` → DB vierge.
3. `python manage.py test evacuation_plans` → suite verte (sans live API).
4. `grep -ri openai backend/ frontend/ --exclude-dir=node_modules --exclude-dir=__pycache__` → **0 occurrence** (hors migrations supprimées et media).
5. Frontend build sans erreur de types/lint.

## Risques & notes
- Le script utilise `grok-4` (non documenté) → remplacé par `grok-4.5`. Si vous voulez absolument `grok-4`, c'est réversible via `XAI_ANALYSIS_MODEL`.
- L'appel Grok (analyse + génération 2K) dure ~1-3 min → tour asynchrone via `GrokCleaningJob` + polling (préserve l'UX de progression existante).
- La clé xAI est stockée chiffrée par utilisateur (même schéma crypto que avant), jamais en clair.