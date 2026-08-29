# Déploiement EvacStudio — serveur Linux + Nginx

Ce document ne couvre que ce qui doit être fait **sur le serveur**. Tout ce qui
pouvait être réglé dans le code l'a été ; voir `SECURITY_AUDIT_REPORT.md`.

---

## 1. Variables d'environnement (obligatoires)

Le backend **refuse de démarrer** en production si l'une manque. C'est
volontaire : un démarrage refusé vaut mieux qu'une mise en ligne silencieusement
ouverte.

```bash
# backend/.env — jamais commité, permissions 600
DEBUG=False
SECRET_KEY=<50+ caractères aléatoires>
JWT_SECRET=<50+ caractères aléatoires, DIFFÉRENT de SECRET_KEY>
ALLOWED_HOSTS=evacstudio.example.fr
CORS_ALLOWED_ORIGINS=https://evacstudio.example.fr
```

Génération (à exécuter deux fois, une par clé) :

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

Pourquoi deux clés distinctes : `SECRET_KEY` signe les sessions, les cookies
CSRF et les liens de réinitialisation ; `JWT_SECRET` signe les jetons d'API. Une
clé unique fait qu'une faiblesse dans un domaine les compromet tous, et qu'aucune
ne peut être renouvelée sans renouveler l'autre. Le démarrage est refusé si elles
sont identiques.

Optionnel :

```bash
LOG_DIR=/var/log/evacstudio        # active les fichiers de log tournants
ACCESS_TOKEN_MINUTES=30            # défaut
REFRESH_TOKEN_DAYS=7               # défaut
MEDIA_SESSION_COOKIE_AGE_SECONDS=1800  # session HttpOnly des médias (30 min)
THROTTLE_LOGIN=10/min
ADMIN_LOGIN_MAX_ATTEMPTS=10
```

```bash
chmod 600 backend/.env
```

---

## 2. Permissions des fichiers

À adapter à l'utilisateur système qui exécute gunicorn (`www-data` ci-dessous —
**vérifiez le vôtre** avant d'exécuter).

```bash
sudo chown www-data:www-data backend/db.sqlite3
sudo chmod 600 backend/db.sqlite3

# SQLite écrit aussi -wal et -shm à côté de la base : le répertoire doit être
# accessible en écriture, pas seulement le fichier.
sudo chown www-data:www-data backend
sudo chmod 750 backend

sudo chown -R www-data:www-data backend/media
sudo chmod 750 backend/media

sudo chown www-data:www-data backend/.env
sudo chmod 600 backend/.env
```

Vérification :

```bash
ls -l backend/db.sqlite3     # attendu : -rw------- www-data www-data
```

---

## 3. Base de données

```bash
cd backend
./venv/bin/python manage.py migrate
./venv/bin/python manage.py collectstatic --noinput
./venv/bin/python manage.py createsuperuser     # premier administrateur
```

`migrate` applique notamment `token_blacklist`, indispensable à la déconnexion
côté serveur.

**Ne jamais supprimer ni recréer `db.sqlite3`.** Faites une sauvegarde avant
toute migration (voir §6).

---

## 4. Services : écouter sur la boucle locale uniquement

Nginx est le seul point d'entrée. Si gunicorn ou Next écoutent sur `0.0.0.0`,
ils restent joignables directement, en clair, sans aucun des en-têtes de
sécurité — Nginx devient contournable.

```ini
# /etc/systemd/system/evacstudio-django.service
[Service]
User=www-data
WorkingDirectory=/srv/evacstudio/backend
ExecStart=/srv/evacstudio/backend/venv/bin/gunicorn config.wsgi:application \
    --bind 127.0.0.1:8000 --workers 3 --timeout 300
Restart=always
```

```ini
# /etc/systemd/system/evacstudio-next.service
[Service]
User=www-data
WorkingDirectory=/srv/evacstudio/frontend
Environment=HOSTNAME=127.0.0.1
Environment=PORT=3000
ExecStart=/usr/bin/npm run start
Restart=always
```

Vérification — **doit** afficher `127.0.0.1`, jamais `0.0.0.0` :

```bash
ss -tlnp | grep -E '3000|8000'
```

Pare-feu :

```bash
sudo ufw allow 80,443/tcp
sudo ufw deny 8000
sudo ufw deny 3000
sudo ufw enable
```

---

## 5. Nginx et HTTPS

```bash
sudo cp deploy/nginx-evacstudio.conf.example /etc/nginx/sites-available/evacstudio
# adapter server_name et les chemins /srv/evacstudio/...
sudo ln -s /etc/nginx/sites-available/evacstudio /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d evacstudio.example.fr
```

### Médias : le point à ne pas manquer

`/media/` n'est plus servi publiquement. Les fichiers passent par `/api/media/`,
qui vérifie une signature ou une authentification, puis délègue le transfert à
Nginx par `X-Accel-Redirect`.

La configuration fournie contient donc :

```nginx
location /protected-media/ {
    internal;                                   # ← inatteignable de l'extérieur
    alias /srv/evacstudio/backend/media/;
}
location /media/ { deny all; return 404; }      # ancienne URL publique
```

`internal` est ce qui rend le dispositif étanche. **Sans cette directive, les
médias redeviennent publics** — le reste du mécanisme ne sert alors à rien.

Vérification après mise en service :

```bash
curl -I https://evacstudio.example.fr/media/backgrounds/<un-fichier>.png   # → 404
curl -I https://evacstudio.example.fr/protected-media/backgrounds/<idem>   # → 404
# et dans l'application, connecté : les plans s'affichent normalement.
```

### Restreindre l'admin

L'admin permet de créer d'autres administrateurs : c'est le point de
compromission unique du projet. Décommentez dans la configuration :

```nginx
location /admin/ {
    allow 10.0.0.0/8;         # réseau interne ou plage VPN
    allow 192.168.0.0/16;
    deny all;
    ...
}
```

Aucune adresse n'est codée en dur dans l'application : la restriction est une
décision d'exploitation, elle appartient à la configuration serveur.

### Content-Security-Policy

La CSP fournie a été dimensionnée sur ce que le frontend utilise réellement
(vérifié dans le build, pas supposé). Deux permissivités subsistent, chacune
justifiée en commentaire dans le fichier :

* `script-src 'unsafe-inline'` — Next.js App Router injecte des `<script>` en
  ligne pour l'hydratation. La supprimer proprement demande des nonces, donc un
  middleware Next et une lecture du nonce dans le layout : un chantier frontend
  à part entière. `'unsafe-eval'` n'est **pas** accordé et n'est pas nécessaire.
* `style-src 'unsafe-inline'` — Konva pose des styles en ligne sur le canvas.

Après activation, ouvrez l'éditeur et vérifiez la console : chargement d'un
plan, ajout de pictogrammes, import PDF, export PNG et PDF.

---

## 6. Sauvegarde

```bash
sudo mkdir -p /srv/backups/evacstudio        # HORS de tout répertoire servi
sudo chmod 700 /srv/backups/evacstudio
sudo -u www-data BACKUP_DIR=/srv/backups/evacstudio \
    /srv/evacstudio/deploy/backup_evacstudio.sh
```

Cron quotidien :

```cron
30 2 * * * BACKUP_DIR=/srv/backups/evacstudio BACKUP_RETENTION_DAYS=30 \
  /srv/evacstudio/deploy/backup_evacstudio.sh >> /var/log/evacstudio-backup.log 2>&1
```

Le script sauvegarde la base **et** `media/` : les plans sont dans les fichiers,
pas dans la base — sauvegarder l'une sans l'autre ne permet pas de restaurer.
Il vérifie l'intégrité de la copie SQLite, et ne supprime rien tant que
`BACKUP_RETENTION_DAYS` n'est pas défini explicitement.

**Testez une restauration** sur un serveur de test. Une sauvegarde jamais relue
n'est pas une sauvegarde.

---

## 7. Journaux

Avec `LOG_DIR` défini, deux fichiers tournants sont écrits :

| Fichier | Contenu |
|---|---|
| `audit.log` | connexions, déconnexions, création/désactivation de compte, changement de rôle, suppression de plan ou de pictogramme, modification de clé API, accès partagés |
| `evacstudio.log` | erreurs applicatives, rejets d'upload, exceptions non gérées |

Aucun mot de passe, jeton, clé API ni en-tête `Authorization` n'y figure — c'est
vérifié par des tests automatisés (`AuditLogTests`).

```bash
sudo mkdir -p /var/log/evacstudio
sudo chown www-data:www-data /var/log/evacstudio
sudo chmod 750 /var/log/evacstudio
```

---

## 8. Comptes

L'inscription publique est fermée (`PUBLIC_REGISTRATION_ENABLED=False`). Les
comptes se créent dans l'admin Django. Après le premier démarrage :

* vérifier qu'aucun compte de test ne subsiste ;
* n'accorder `is_staff` qu'aux personnes qui administrent réellement ;
* pour retirer l'accès à quelqu'un : **décocher « Actif »**. L'effet est
  immédiat, y compris pour un jeton émis avant la désactivation.

---

## 9. Vérification finale

```bash
cd backend && ./venv/bin/python manage.py check --deploy
```

Attendu : un seul avertissement, `security.W021` (préchargement HSTS, choix
délibéré — c'est un engagement difficilement réversible).

Puis, dans l'application connectée : connexion, ouverture d'un plan, ajout d'un
pictogramme, import d'un PDF, export PNG et PDF, déconnexion.
