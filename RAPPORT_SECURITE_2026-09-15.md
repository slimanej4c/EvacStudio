# Rapport d’analyse de sécurité — EvacStudio / SecurPlan

**Date : 15 septembre 2026**  
**Révision examinée : `1d243c8` et fichiers présents dans le répertoire de travail.**  
**Intervention : analyse en lecture seule ; seul ce nouveau rapport a été créé. Aucun correctif appliqué.**

## 1. Conclusion

Le projet possède une base de sécurité utile : authentification obligatoire, permissions sur les plans, contrôle des médias, validation de nombreux imports et rotation des jetons. Cependant, plusieurs défauts restent à corriger avant de considérer son exposition en production comme suffisamment maîtrisée.

Les priorités concernent **les secrets de configuration, une ancienne base conservée dans Git, les dépendances, les restrictions de connexion, les droits de lecture seule et la validation des fichiers**. Le changement de mot de passe et la déconnexion ne ferment pas non plus toutes les possibilités de réutiliser une session compromise.

Ce rapport distingue les comportements confirmés du code, les vérifications isolées réalisées en mémoire et les risques conditionnés par le déploiement. Il ne constate pas une intrusion et ne constitue pas une validation du serveur de production, qui n’a pas été inspecté.

### Ordre de traitement recommandé

| Référence | Priorité | Point à corriger |
|---|---|---|
| F01 | P1 — élevée | Les secrets publics d’exemple restent acceptés en production |
| F02 | P1 — élevée | Une ancienne base contenant des données sensibles reste récupérable dans Git |
| F03 | P1 — élevée | Dépendances avec alertes connues, dont deux alertes critiques Next.js conditionnelles |
| F04 | P1 — élevée | Contournement des limites de connexion avec `X-Forwarded-For` |
| F05 | P1 — élevée | Un compte viewer peut provoquer des écritures dans les plans d’autrui |
| F06 | P1 — élevée | Un changement de mot de passe ne révoque pas les jetons JWT existants |
| F07 | P1 — élevée | Certains décodages PDF/image peuvent consommer une mémoire excessive |
| F08 | P1 — élevée | L’import ZIP contourne les validations appliquées aux imports ordinaires |
| F09 | P2 — moyenne | Déconnexion affichée même lorsque la révocation échoue |
| F10 | P2 — moyenne | Un import ZIP rejeté peut laisser des fichiers sur disque |
| F11 | P2 — moyenne | Le service Next.js documenté ne garantit pas l’écoute locale annoncée |
| F12 | P2 — moyenne | Presse-papiers applicatif persistant entre deux comptes |
| F13 | P2 — moyenne | Jetons lisibles par JavaScript et CSP autorisant les scripts en ligne |

**P1** : traiter avant une nouvelle exposition publique, ou rapidement si l’application est déjà accessible. **P2** : intégrer au prochain lot de sécurisation. La priorité tient compte de l’impact possible ; elle ne signifie pas que chaque scénario est exploitable dans l’environnement de production actuel.

## 2. Périmètre et méthode

### Architecture et données concernées

- **Frontend Next.js / React** : connexion, partage, éditeur Konva, imports, exports et stockage navigateur.
- **API Django / Django REST Framework** : comptes, JWT, plans, dossiers, bibliothèques, historique, archives et administration.
- **Stockage** : base SQL, fichiers média, ressources de projets, versions et paramètres contenant une clé xAI chiffrée.
- **Intégration xAI** : transfert d’images pour traitement et récupération des résultats.
- **Exploitation** : exemples Nginx, services, sauvegarde, variables d’environnement et historique Git.

Les données sensibles comprennent les plans et la topologie des bâtiments, les informations clients, les mots de passe hachés, les jetons et les clés de services externes. L’intégrité d’un plan exporté doit également être protégée contre une modification non autorisée.

Le modèle actuel isole les espaces et distingue les invités **viewer** et **editor**. Les bibliothèques réutilisables ont un partage bidirectionnel distinct. L’hypothèse d’un accès général entre utilisateurs internes, présente dans l’ancien rapport, ne décrit plus correctement tous les contrôles actuels.

### Vérifications effectuées

- Lecture et rapprochement des parcours sensibles du backend et du frontend, de leurs tests existants et de la configuration de déploiement.
- `npm audit --package-lock-only --ignore-scripts --json` : **5 paquets signalés**, répartis par npm en **1 critique, 3 élevés et 1 modéré**. Il s’agit de paquets, pas de cinq exploits démontrés.
- `pip-audit` sur l’environnement Python installé : **2 avis concernant Django REST Framework 3.17.1**.
- Bandit sur le backend hors tests et migrations : **6 alertes brutes**, relues manuellement. Elles ne sont pas assimilées automatiquement à six vulnérabilités.
- Diagnostics Django incluant les contrôles de déploiement : **6 avertissements avec les paramètres locaux de développement** (`W004`, `W008`, `W009`, `W012`, `W016`, `W018`).
- Vérification en mémoire de l’acceptation des secrets d’exemple avec `DEBUG=False`, de l’identification IP utilisée par les limites de connexion et de deux parcours de validation d’import.
- Lecture d’une ancienne base Git désérialisée en mémoire, limitée au comptage des enregistrements sensibles ; aucun secret ni contenu de plan extrait dans ce rapport.
- Vérification des avis de sécurité et de la documentation des éditeurs.

**Limites :** aucun test de charge, aucune exploitation réseau, aucun appel IA payant, aucune migration, aucune installation ou mise à jour, aucun build et aucune exécution de la suite complète de tests. Les exemples Nginx et systemd ont été examinés comme des fichiers, sans présumer qu’ils sont appliqués sur un serveur. Le contrôle de l’historique ne constitue pas un scan exhaustif de chaque secret possible dans tous les objets Git.

## 3. Constats prioritaires

### F01 — Les secrets publics d’exemple sont acceptés en production

**Gravité : élevée ; critique si ces valeurs signent réellement les sessions d’un service exposé.**

**Preuves :** [contrôle de SECRET_KEY](/Users/studio/Documents/planevacuation/backend/config/settings.py:23), [contrôle de JWT_SECRET](/Users/studio/Documents/planevacuation/backend/config/settings.py:221), [fichier d’exemple](/Users/studio/Documents/planevacuation/backend/.env.example:2).

Le démarrage refuse une valeur de repli précise et exige deux clés distinctes. Il ne refuse pas les deux autres valeurs publiques présentes dans `.env.example`, contrairement à ce qu’annonce ce fichier. Une vérification isolée a chargé la configuration avec **ces deux valeurs d’exemple et `DEBUG=False` sans refus de démarrage**.

Une clé de signature JWT connue permet de fabriquer des jetons pour un compte existant. La clé Django intervient aussi dans la protection des sessions et le chiffrement des clés xAI. Aucune tentative d’usurpation n’a été effectuée.

**À corriger :** rejeter toutes les valeurs d’exemple et les clés manifestement faibles ; imposer des secrets distincts générés aléatoirement. Si des clés publiques/faibles ont servi sur un serveur, renouveler les secrets et les sessions concernées. Prévoir la migration des clés xAI chiffrées avant de changer leur clé de protection.

**Validation attendue :** tests de démarrage en production couvrant clés absentes, publiques, identiques et trop faibles ; démarrage accepté uniquement avec la configuration conforme.

### F02 — Une ancienne base sensible reste dans l’historique Git

**Gravité : élevée ; exposition externe non déterminée.**

**Preuve :** le fichier `backend/db.sqlite3`, absent du suivi actuel, reste présent dans des commits antérieurs. Le commit **`7a1b5b7`** contient une base d’environ **22,7 Mo** avec **2 comptes et leurs hachages de mots de passe utilisables, 5 plans et 1 enregistrement de paramètres xAI**. La présence et les comptes ont été vérifiés en mémoire, sans afficher d’identité ni de clé.

Retirer une base de la version courante et l’ajouter à `.gitignore` ne la retire pas de l’historique. Toute personne disposant de cet historique peut récupérer cette copie et tenter, notamment, de retrouver les mots de passe hors ligne. Le caractère privé ou public du dépôt distant et la validité actuelle de ces données restent à établir.

**À corriger :** identifier les personnes et copies ayant reçu cet historique ; renouveler les mots de passe et clés encore pertinents ; organiser une purge coordonnée de la base dans l’historique et les artefacts. Vérifier également les anciens médias et sauvegardes. Une purge Git ne rappelle pas les clones déjà distribués.

**Validation attendue :** absence des données dans l’historique destiné à être distribué et confirmation de la rotation des accès concernés. **Aucune réécriture Git ni rotation n’a été réalisée pendant cet audit.**

### F03 — Les dépendances ne sont plus exemptes d’alertes connues

**Priorité : élevée ; applicabilité détaillée ci-dessous.**

Versions établies dans le [verrou npm](/Users/studio/Documents/planevacuation/frontend/package-lock.json:5540) et les métadonnées de l’environnement Python installé. Le [fichier Python](/Users/studio/Documents/planevacuation/backend/requirements.txt:7) ne fixe actuellement aucun plancher corrigé pour DRF.

| Paquet examiné | Résultat au 15/09/2026 | Action minimale indiquée par les avis |
|---|---|---|
| Next.js 16.3.2 | Deux avis critiques : hébergement Windows et optimisation d’images AVIF | Passer à une version corrigée, au minimum 16.3.3 pour ces avis |
| sharp 0.35.3 | Alerte élevée sur libheif | Mettre à jour la chaîne de dépendances vers sharp 0.35.4 ou version corrigée ultérieure |
| Django REST Framework 3.17.1 | Deux avis : limites de requêtes et AdminRenderer | Passer au minimum à 3.17.2 |
| browserslist 4.28.2 | Deux avis élevés ; dépendance de développement dans ce verrou | Sortir de la plage affectée `<=4.28.6` |
| js-yaml 4.3.1 | Alerte élevée sur la consommation CPU ; dépendance de développement | Passer au minimum à 4.3.2 |
| baseline-browser-mapping 2.10.33 | Alerte modérée de terminaison de processus | Passer au minimum à 2.11.0 |

**Applicabilité au projet :**

- L’avis Next.js lié au système de fichiers Windows ne correspond ni au poste macOS examiné ni au déploiement Linux documenté. L’hôte réel reste inconnu. [Avis de l’éditeur — Windows](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36).
- L’autre avis concerne l’optimisation AVIF. Aucun usage applicatif de `next/image` n’a été trouvé, mais cela ne prouve pas à lui seul que le service d’optimisation est inaccessible. Aucun envoi d’AVIF malveillant n’a été tenté. [Avis de l’éditeur — AVIF](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4).
- L’avis DRF relatif à `request.data` concerne le contournement de la limite mémoire Django pour certains corps JSON/formulaires. Le plafond Nginx de 32 Mo atténue ce risque s’il est effectivement appliqué, sans remplacer la correction. [Avis DRF — taille des requêtes](https://github.com/encode/django-rest-framework/security/advisories/GHSA-2m8g-3cmr-wg3w).
- L’avis DRF concernant `AdminRenderer` n’a pas de chemin identifié ici : les renderers effectifs sont `JSONRenderer` et `BrowsableAPIRenderer`. Il ne faut donc pas annoncer une fuite de données démontrée par cet avis. [Avis DRF — AdminRenderer](https://github.com/encode/django-rest-framework/security/advisories/GHSA-g47c-3xmw-q6m2).
- Les alertes des outils de développement ne prouvent pas une attaque distante contre l’application ; elles concernent aussi la construction et l’analyse du projet.

**À corriger :** actualiser les versions et le verrou npm de manière contrôlée ; définir un ensemble Python reproductible, avec versions corrigées et empreintes ; auditer aussi les dépendances transitives. Les numéros ci-dessus sont des minima pour les avis observés, pas une garantie générale de sécurité.

**Validation attendue :** refaire les audits sur l’installation effectivement déployée, puis vérifier connexion, éditeur, traitement d’images/PDF, archives et exports après mise à jour.

### F04 — Les limitations de connexion sont contournables par un en-tête

**Gravité : élevée si la configuration Nginx fournie est utilisée.**

**Preuves :** [Nginx API](/Users/studio/Documents/planevacuation/deploy/nginx-evacstudio.conf.example:116), [Nginx admin](/Users/studio/Documents/planevacuation/deploy/nginx-evacstudio.conf.example:135), [identification admin](/Users/studio/Documents/planevacuation/backend/evacuation_plans/admin_protection.py:29), [throttles](/Users/studio/Documents/planevacuation/backend/evacuation_plans/throttles.py:10).

Nginx ajoute l’adresse réelle à la valeur `X-Forwarded-For` reçue du client. L’admin fait confiance à la première adresse ; DRF, avec `NUM_PROXIES=None`, utilise la chaîne transmise. Modifier sa partie contrôlée par le client change donc l’identité utilisée pour compter les tentatives, même quand l’adresse réseau réelle reste identique.

Une vérification en mémoire a confirmé deux identités de quota différentes pour une même adresse réelle. Par ailleurs, le cache effectif est `LocMemCache` : les compteurs sont séparés entre processus, alors que le guide prévoit trois workers.

**À corriger :** établir une chaîne de proxies de confiance ; au point d’entrée, remplacer les en-têtes fournis par le client par une valeur fiable ; configurer DRF en conséquence. Utiliser des compteurs partagés, une limite au niveau du proxy et une protection adaptée des comptes sensibles. Pour l’admin, ajouter une restriction réseau et/ou une authentification multifacteur.

**Validation attendue :** changer un en-tête client ne change plus le compteur ; la limite reste cohérente entre plusieurs workers. La documentation DRF précise elle-même les limites de ses throttles comme protection contre les attaques. [DRF — throttling](https://www.django-rest-framework.org/api-guide/throttling/), [Nginx — en-têtes proxy](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#var_proxy_add_x_forwarded_for).

### F05 — Un viewer peut déclencher des écritures dans un plan d’autrui

**Gravité : élevée — atteinte à l’intégrité et au modèle de permissions.**

**Preuves :** [sélection et mutation des plans](/Users/studio/Documents/planevacuation/backend/evacuation_plans/views.py:609), [déclenchement lors de la suppression de versions](/Users/studio/Documents/planevacuation/backend/evacuation_plans/views.py:1694), [identifiant fourni par le client](/Users/studio/Documents/planevacuation/backend/evacuation_plans/serializers.py:1226), [unicité par utilisateur](/Users/studio/Documents/planevacuation/backend/evacuation_plans/models.py:576).

`freeze_template_versions_for_projects()` utilise les droits de lecture de bibliothèque pour sélectionner des plans, puis appelle des opérations d’écriture sans vérifier `user_can_edit_plan()`. La comparaison des versions repose sur un identifiant que deux utilisateurs peuvent choisir identique.

**Scénario :** un invité viewer crée dans sa bibliothèque une version portant l’identifiant `custom:…` d’un plan du propriétaire, puis supprime sa propre version. Le traitement peut créer une révision et intervenir sur les ressources du plan du propriétaire. Si le snapshot de ce plan n’a pas déjà cet identifiant, sa composition est également remplacée par les blocs contrôlés par l’invité.

**Limite :** chemin établi par lecture du code ; aucune modification de plan effectuée pour le reproduire. Le remplacement de composition dépend de l’état antérieur du snapshot ; l’appel de création de révision n’en dépend pas.

**À corriger :** identifier une version avec son propriétaire ou une référence globale non ambiguë ; vérifier les droits d’édition avant chaque mutation ; éviter qu’une suppression de bibliothèque puisse modifier un plan extérieur sans autorisation.

**Validation attendue :** un viewer ne provoque aucune écriture dans un plan partagé ; le propriétaire d’un espace ne peut pas davantage modifier les plans privés d’un invité par cette voie.

### F06 — Un changement de mot de passe laisse les JWT utilisables

**Gravité : élevée lorsqu’il s’agit de reprendre le contrôle d’un compte compromis.**

**Preuves :** [paramètres JWT](/Users/studio/Documents/planevacuation/backend/config/settings.py:236), [signal de changement de mot de passe](/Users/studio/Documents/planevacuation/backend/evacuation_plans/signals.py:147), [renouvellement](/Users/studio/Documents/planevacuation/backend/evacuation_plans/urls.py:33), [émission du cookie média](/Users/studio/Documents/planevacuation/backend/evacuation_plans/urls.py:20).

La valeur effective de `CHECK_REVOKE_TOKEN` est `False`. Le changement de mot de passe est journalisé, mais aucune invalidation globale des JWT n’est appliquée. Un refresh token volé peut donc encore obtenir des jetons après ce changement. La rotation réinitialise son expiration ; les sept jours configurés ne constituent pas une durée absolue de session si le renouvellement continue.

Le cookie média est bien lié à l’état du mot de passe, mais le chemin de refresh peut en recréer un avec le nouvel état : sa protection ne corrige pas ce défaut à elle seule.

**À corriger :** révoquer toutes les sessions concernées au changement de mot de passe et contrôler une version de sécurité/session lors de l’accès, du refresh et de l’émission du cookie média. Prévoir une durée absolue de session et une fonction de fermeture de toutes les sessions.

**Validation attendue :** après changement de mot de passe, aucun ancien access token, refresh token ou cookie média ne permet de retrouver l’accès, y compris via les renouvellements.

### F07 — Des parcours PDF/image évitent les limites de décodage

**Gravité : élevée — risque de déni de service par un compte authentifié.**

**Preuves :** [validation PDF](/Users/studio/Documents/planevacuation/backend/evacuation_plans/upload_validation.py:151), [rasterisation PDF](/Users/studio/Documents/planevacuation/backend/evacuation_plans/views.py:675), [décodage des retouches](/Users/studio/Documents/planevacuation/backend/evacuation_plans/views.py:819), [validation de la data URL](/Users/studio/Documents/planevacuation/backend/evacuation_plans/serializers.py:1326).

- Le PDF est accepté sur son préfixe `%PDF-`, puis sa première page peut être rendue sans borne sur le nombre de pixels résultant du DPI choisi.
- La retouche manuelle contrôle surtout la forme et la longueur du base64, puis appelle `cv2.imdecode` avant de vérifier les dimensions de l’image.

Une petite taille compressée ne garantit pas une faible consommation mémoire. Une page PDF immense ou une image très compressée peut monopoliser ou faire tomber un worker. Des limites de dimensions existent dans d’autres parcours, mais ne couvrent pas ceux-ci.

**Vérification :** le validateur PDF réel a accepté en mémoire un faux PDF de 28 octets portant le préfixe attendu. Ce contrôle confirme une validation insuffisante ; aucun rendu lourd ni épuisement mémoire n’a été tenté.

**À corriger :** centraliser les validations avant chaque décodage ; borner dimensions, pixels, format et complexité du PDF ; calculer la taille raster avant rendu ; limiter mémoire, durée et concurrence des processus de conversion.

**Validation attendue :** rejeter sans allocation massive les fichiers invalides ou surdimensionnés, quel que soit le chemin d’import, de retouche ou de nettoyage.

### F08 — Les archives ZIP contournent les validations ordinaires

**Gravité : élevée — contrôle d’entrée incomplet.**

**Preuves :** [construction des modèles depuis le manifeste](/Users/studio/Documents/planevacuation/backend/evacuation_plans/project_archives.py:856), [lecture et stockage du fond](/Users/studio/Documents/planevacuation/backend/evacuation_plans/project_archives.py:875), [stockage des autres ressources](/Users/studio/Documents/planevacuation/backend/evacuation_plans/project_archives.py:895), [restauration de l’état](/Users/studio/Documents/planevacuation/backend/evacuation_plans/project_archives.py:626).

L’import vérifie les empreintes SHA-256 et plusieurs limites ZIP, mais ne repasse pas systématiquement par les validateurs de fichiers et serializers employés dans les autres endpoints. Un auteur d’archive peut fournir à la fois les octets malveillants et leur empreinte correcte.

Un faux fichier image, un SVG non assaini ou un état hors limites peut ainsi atteindre le stockage puis les traitements du projet. **Une XSS n’est pas démontrée** : les protections de réponse média, notamment la CSP des SVG, limitent ce scénario.

**Vérification :** exécution isolée de la fonction d’import avec stockage simulé : une fausse image PNG de 20 octets de texte atteint bien l’appel d’écriture. Aucun fichier ni objet de base créé.

**À corriger :** valider toutes les ressources selon leur rôle et leur contenu ; assainir les SVG ; appliquer les contraintes de schéma, taille, géométrie et références à l’état courant et aux anciennes révisions avant toute écriture. Le hachage doit rester un contrôle d’intégrité, sans être traité comme une preuve d’innocuité ou d’authenticité de l’expéditeur.

**Validation attendue :** tout contenu refusé par un import direct est également refusé dans une archive, y compris lorsqu’il se trouve uniquement dans l’historique.

## 4. Corrections complémentaires

### F09 — Déconnexion incomplète ou concurrente avec un renouvellement

**Gravité : moyenne.** [Déconnexion frontend](/Users/studio/Documents/planevacuation/frontend/src/context/AuthContext.tsx:233), [renouvellement](/Users/studio/Documents/planevacuation/frontend/src/context/AuthContext.tsx:65), [permission backend](/Users/studio/Documents/planevacuation/backend/evacuation_plans/views.py:3235).

Le frontend attend `fetch()` mais ne vérifie pas le statut de la réponse avant d’afficher la déconnexion. Si l’access token est expiré, le backend refuse la requête avant la mise en liste noire. Une copie du refresh token reste alors utilisable. Un renouvellement déjà en cours peut également réécrire les jetons après leur suppression locale.

Même après une déconnexion réussie, une copie du cookie média n’est pas invalidée côté serveur : elle reste valable jusqu’à expiration, 30 minutes par défaut. [Cookie média](/Users/studio/Documents/planevacuation/backend/evacuation_plans/media_access.py:130).

**À corriger :** gérer le résultat réel de la révocation, permettre la fermeture sûre d’une session dont l’accès a expiré, neutraliser les renouvellements en cours et rattacher les médias à une session révocable. Fermer localement l’interface reste nécessaire en cas de panne réseau, mais ne doit pas être confondu avec une révocation confirmée.

**Validation attendue :** logout avec token expiré, panne réseau et refresh concurrent ; impossibilité de réutiliser les identifiants révoqués.

### F10 — Des fichiers restent après l’échec d’un import ZIP

**Gravité : moyenne — consommation de stockage.** [Écritures de fichiers](/Users/studio/Documents/planevacuation/backend/evacuation_plans/project_archives.py:883), [restauration tardive et nettoyage final](/Users/studio/Documents/planevacuation/backend/evacuation_plans/project_archives.py:943), [suppression par signaux](/Users/studio/Documents/planevacuation/backend/evacuation_plans/signals.py:19).

Une transaction SQL entoure l’import, mais elle ne rend pas les écritures de fichiers transactionnelles. Si une référence d’overlay invalide fait échouer la restauration après l’enregistrement du fond et des ressources, le rollback annule les lignes SQL, sans supprimer automatiquement les fichiers déjà créés. Des échecs répétés peuvent remplir le stockage.

**À corriger :** valider l’archive entièrement avant stockage ; utiliser une zone temporaire et un nettoyage explicite des nouveaux fichiers en cas d’échec ; ajouter quotas et détection d’orphelins.

**Validation attendue :** après chaque import rejeté, ni nouvelle ligne ni nouveau fichier persistant. Constat établi statiquement, sans import sur la base réelle.

### F11 — L’exemple de service Next.js peut exposer le port 3000

**Gravité : moyenne ; élevée si le port est accessible et permet de contourner des restrictions réseau.** [Service documenté](/Users/studio/Documents/planevacuation/deploy/DEPLOYMENT.md:115), [commande de démarrage](/Users/studio/Documents/planevacuation/frontend/package.json:9), [proxy de l’admin](/Users/studio/Documents/planevacuation/frontend/next.config.ts:11).

Le guide définit `HOSTNAME=127.0.0.1`, mais lance `npm run start`, soit `next start` sans `--hostname`. Dans la CLI installée, cette option n’est pas liée à la variable `HOSTNAME` ; la valeur par défaut annoncée est `0.0.0.0`. La documentation officielle confirme l’option explicite. [CLI Next.js](https://nextjs.org/docs/app/api-reference/cli/next).

Le frontend peut donc écouter au-delà de la boucle locale malgré l’intention du guide. Un accès direct contournerait les protections Nginx et exposerait aussi la réécriture `/admin/`. Le pare-feu documenté peut atténuer cela, mais son application n’a pas été vérifiée.

**À corriger :** passer explicitement l’adresse d’écoute au processus ; fermer 3000/8000 depuis l’extérieur ; appliquer la restriction de l’admin sur tous ses chemins d’accès.

**Validation attendue :** vérifier les sockets réelles et l’inaccessibilité externe des ports applicatifs. Aucun serveur n’a été démarré ou reconfiguré durant l’audit.

### F12 — Le presse-papiers persiste entre comptes

**Gravité : moyenne sur un poste ou profil navigateur partagé.** [Clés de stockage](/Users/studio/Documents/planevacuation/frontend/src/app/evacuation-plans/[id]/editor/page.tsx:666), [lecture](/Users/studio/Documents/planevacuation/frontend/src/app/evacuation-plans/[id]/editor/page.tsx:8076), [copie des blocs](/Users/studio/Documents/planevacuation/frontend/src/app/evacuation-plans/[id]/editor/page.tsx:8160), [effacement de session](/Users/studio/Documents/planevacuation/frontend/src/context/AuthContext.tsx:55).

Le presse-papiers de blocs/icônes utilise des clés globales dans `localStorage`. Il peut conserver du texte, des libellés et des positions d’équipements. La déconnexion ne supprime que les jetons. Un second utilisateur du même profil navigateur peut coller les éléments copiés par le premier, sans disposer d’un accès à son plan.

**À corriger :** associer le stockage au compte ; vérifier son propriétaire à la lecture ; purger lors de la déconnexion et du changement de compte ; limiter la durée de conservation. Étendre cette revue aux caches de templates et logos.

**Validation attendue :** après passage du compte A au compte B, aucun élément privé de A n’est récupérable par le collage applicatif.

### F13 — Les jetons persistants sont accessibles à JavaScript

**Gravité : moyenne ; facteur aggravant si une injection de script apparaît.** [Stockage des deux jetons](/Users/studio/Documents/planevacuation/frontend/src/context/AuthContext.tsx:188), [CSP Nginx](/Users/studio/Documents/planevacuation/deploy/nginx-evacstudio.conf.example:68).

Access et refresh tokens sont conservés dans `localStorage`. Tout script exécuté dans l’origine peut les lire. La CSP d’exemple conserve `script-src 'unsafe-inline'`, ce qui réduit sa capacité à contenir une injection de script en ligne. **Aucune XSS exploitable n’a été établie dans les sources frontend examinées.**

**À corriger :** envisager une session serveur ou une couche serveur intermédiaire avec cookie `HttpOnly`, `Secure` et `SameSite` adapté ; au minimum retirer le refresh token du stockage JavaScript persistant. Adapter les protections CSRF à ce changement. Déployer une CSP avec nonces ou hachages compatibles avec Next.js. [OWASP — gestion des sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

**Validation attendue :** les scripts de page ne peuvent pas lire le secret de renouvellement ; connexion, renouvellement, déconnexion et CSRF restent correctement gérés.

## 5. Autres points à cadrer

Ces observations ne sont pas présentées comme des compromissions démontrées.

| Sujet | Observation et action recommandée |
|---|---|
| Configuration locale | Le `.env` local utilise `DEBUG=True`, `ALLOWED_HOSTS=*` et des clés d’apparence illustrative. Cela explique les avertissements Django et peut convenir à un poste isolé ; ne pas réutiliser cet environnement sur un service exposé. |
| Permissions locales | `backend/.env` et `backend/db.sqlite3` ont le mode `0644`. Leur lecture effective dépend aussi des permissions des répertoires parents. Restreindre secrets, base et sauvegardes au compte de service et aux administrateurs autorisés. Aucun changement de permissions effectué. |
| Téléchargement xAI | Le [contrôle d’URL](/Users/studio/Documents/planevacuation/backend/evacuation_plans/grok_cleaning.py:524) rejette des adresses IP privées explicites mais accepte les noms DNS sans résolution ; `urlopen` suit les redirections. Si une URL de réponse fournisseur est détournée, un accès au réseau interne devient possible. Aucun contrôle utilisateur direct de cette URL n’a été trouvé. Restreindre les domaines, adresses et redirections, et les sorties réseau. |
| Chiffrement des clés xAI | La [construction cryptographique spécifique au projet](/Users/studio/Documents/planevacuation/backend/evacuation_plans/models.py:18) dépend de `SECRET_KEY`. Aucune cassure cryptographique démontrée, mais préférer un chiffrement authentifié standard avec clé dédiée, versionnement et procédure de rotation. |
| Invitations | L’[acceptation](/Users/studio/Documents/planevacuation/backend/evacuation_plans/views.py:3180) ne vérifie pas que l’adresse du compte correspond au destinataire. Clarifier si le lien doit être transférable. S’il doit être nominatif, exiger une adresse vérifiée correspondante. |
| Sauvegardes | Le [script](/Users/studio/Documents/planevacuation/deploy/backup_evacstudio.sh:59) se rabat sur `cp` si SQLite CLI manque, sans imposer l’arrêt des écritures. Il reste spécifique à SQLite alors que MySQL/PostgreSQL sont configurables. Supprimer le repli non sûr, adapter au moteur réel, protéger les sauvegardes et tester une restauration cohérente base + médias. La conservation hors serveur et le chiffrement des sauvegardes n’ont pas été vérifiés. |
| Traçabilité | Les [signaux d’audit](/Users/studio/Documents/planevacuation/backend/evacuation_plans/signals.py:157) ne portent pas toujours l’identité de l’acteur : le propriétaire d’un plan n’est pas nécessairement celui qui le supprime. Journaliser acteur, ressource et résultat des écritures sensibles ; prévoir rétention et accès restreint aux journaux. |
| Traitements IA | Les plans transmis au fournisseur peuvent révéler des informations de bâtiment. Formaliser quels documents peuvent être envoyés, avec quel compte fournisseur et quelle conservation applicable. Les conditions du compte xAI et le réseau du serveur sont hors périmètre. |
| Documentation de sécurité | L’ancien [rapport](/Users/studio/Documents/planevacuation/SECURITY_AUDIT_REPORT.md:1) annonce notamment zéro vulnérabilité de dépendance et un modèle d’accès différent. Le [guide](/Users/studio/Documents/planevacuation/deploy/DEPLOYMENT.md:3) affirme que tout le travail de code est réglé. Réviser ces conclusions après correction et nouvelle validation ; ce nouvel audit laisse ces fichiers intacts. |

## 6. Protections déjà présentes à conserver

- Authentification exigée par défaut sur l’API ; inscription publique fermée par défaut.
- Filtrage des plans et dossiers par espace autorisé ; contrôle des droits d’édition sur les opérations usuelles et de la cible lors de l’ajout/déplacement d’icônes.
- Médias soumis à un contrôle d’accès en base ; retrait de partage pris en compte ; normalisation des chemins et interdiction de cache privé persistant dans les réponses.
- Rotation des refresh tokens et liste noire, utiles lorsque les parcours de révocation aboutissent.
- Invitations aléatoires, hachées, expirantes et à usage unique.
- Contrôle de contenu et de dimensions sur de nombreux imports ; assainissement SVG ; protections contre la traversée de chemins ZIP et plusieurs limites de taille.
- Paramètres HTTPS/cookies durcis lorsque `DEBUG=False`, à condition que le serveur et le proxy soient configurés correctement.
- Aucun usage de `dangerouslySetInnerHTML` ou d’exécution dynamique de code identifié dans les sources frontend ; ne pas assimiler automatiquement l’affichage SVG en image à une XSS.

Ces protections sont établies dans le code et les configurations examinés. Elles ne valent pas confirmation de leur application sur un serveur distant.

## 7. Plan de correction et critères de clôture

### Lot 1 — Secrets, exposition et composants

Traiter F01 à F04, vérifier l’exposition des ports décrite en F11 et l’accès à l’admin. Examiner l’historique Git et organiser les rotations nécessaires. Mettre à jour les dépendances dans un environnement de validation.

**Clôture :** secrets conformes, données historiques traitées, audits réexécutés, ports privés inaccessibles de l’extérieur, quotas indépendants des en-têtes contrôlés par le client.

### Lot 2 — Permissions et sessions

Corriger F05, F06 et F09. Revoir F12 et F13 dans le même chantier de session navigateur. Clarifier la règle des invitations.

**Clôture :** aucun effet d’écriture depuis un viewer ; anciens identifiants inutilisables après révocation ; logout fiable malgré expiration et concurrence ; aucune donnée copiée transmise au compte suivant.

### Lot 3 — Imports, traitements et stockage

Corriger F07, F08 et F10 ; appliquer les mêmes validations à toutes les entrées ; isoler les conversions ; vérifier quotas, stockage temporaire, nettoyage et restauration des sauvegardes.

**Clôture :** corpus de fichiers invalides refusé sans consommation excessive ; aucune persistance après import rejeté ; restauration de test réussie.

### Lot 4 — Validation réelle du déploiement

Avec la configuration de production effective : vérifier HTTPS, en-têtes, cookies, restrictions de l’admin, fermeture de `/media/` et de `/protected-media/` depuis l’extérieur, permissions système, journaux et réseau sortant. Exécuter les tests métier et sécurité après les corrections, puis actualiser la documentation et dater les résultats.

**État à la livraison de ce rapport : aucune correction appliquée ; les points ci-dessus restent à traiter ou à vérifier.**
