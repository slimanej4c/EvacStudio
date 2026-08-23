#!/usr/bin/env bash
#
# Sauvegarde EvacStudio — base SQLite + fichiers média.
#
# Ce script ne supprime RIEN par défaut. La purge des anciennes sauvegardes est
# désactivée tant que BACKUP_RETENTION_DAYS n'est pas défini explicitement :
# une rotation activée par défaut est le meilleur moyen de perdre la seule
# copie qui restait.
#
# Usage :
#   ./deploy/backup_evacstudio.sh
#   BACKUP_DIR=/srv/backups/evacstudio ./deploy/backup_evacstudio.sh
#   BACKUP_RETENTION_DAYS=30 ./deploy/backup_evacstudio.sh
#
# Cron (tous les jours à 2 h 30, journal séparé) :
#   30 2 * * * BACKUP_DIR=/srv/backups/evacstudio BACKUP_RETENTION_DAYS=30 \
#     /srv/evacstudio/deploy/backup_evacstudio.sh >> /var/log/evacstudio-backup.log 2>&1
#
# IMPORTANT : BACKUP_DIR doit être HORS de tout répertoire servi par Nginx.
# Une sauvegarde déposée sous media/ ou static/ serait téléchargeable par
# n'importe qui — elle contient les empreintes de mots de passe et les clés API
# chiffrées.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="${BACKEND_DIR:-$PROJECT_DIR/backend}"
DB_PATH="${DB_PATH:-$BACKEND_DIR/db.sqlite3}"
MEDIA_DIR="${MEDIA_DIR:-$BACKEND_DIR/media}"
BACKUP_DIR="${BACKUP_DIR:-/srv/backups/evacstudio}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-}"

STAMP="$(date +%Y-%m-%d_%H%M%S)"
DB_TARGET="$BACKUP_DIR/db-$STAMP.sqlite3"
MEDIA_TARGET="$BACKUP_DIR/media-$STAMP.tar.gz"

log()  { printf '[%s] %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { log "ERREUR : $*" >&2; exit 1; }

# ── Vérifications préalables ────────────────────────────────────────────────
[ -f "$DB_PATH" ]   || fail "base introuvable : $DB_PATH"
[ -d "$MEDIA_DIR" ] || fail "répertoire média introuvable : $MEDIA_DIR"

case "$BACKUP_DIR" in
  "$MEDIA_DIR"*|*/static/*|*/staticfiles/*)
    fail "BACKUP_DIR est dans un répertoire servi publiquement : $BACKUP_DIR"
    ;;
esac

mkdir -p "$BACKUP_DIR" || fail "impossible de créer $BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || log "note : chmod 700 sur $BACKUP_DIR a échoué"

# ── Base de données ─────────────────────────────────────────────────────────
# `.backup` de sqlite3 prend une copie cohérente même si l'application écrit
# pendant ce temps. Copier le fichier avec cp donnerait une base corrompue si
# une transaction était en cours.
log "sauvegarde de la base -> $DB_TARGET"
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".backup '$DB_TARGET'" || fail "la sauvegarde SQLite a échoué"
else
  log "sqlite3 absent : repli sur une copie fichier (arrêtez l'application avant)"
  cp -p "$DB_PATH" "$DB_TARGET" || fail "la copie de la base a échoué"
fi

# Vérification d'intégrité : une sauvegarde jamais relue n'est pas une sauvegarde.
if command -v sqlite3 >/dev/null 2>&1; then
  INTEGRITY="$(sqlite3 "$DB_TARGET" 'PRAGMA integrity_check;' 2>&1 || echo failed)"
  [ "$INTEGRITY" = "ok" ] || fail "la sauvegarde est corrompue : $INTEGRITY"
  log "intégrité vérifiée : ok"
fi

# ── Fichiers média ──────────────────────────────────────────────────────────
# Les plans sont ici, pas dans la base : sauvegarder l'une sans l'autre ne
# permet pas de restaurer l'application.
log "sauvegarde des médias -> $MEDIA_TARGET"
tar -czf "$MEDIA_TARGET" -C "$(dirname "$MEDIA_DIR")" "$(basename "$MEDIA_DIR")" \
  || fail "l'archive des médias a échoué"

chmod 600 "$DB_TARGET" "$MEDIA_TARGET" 2>/dev/null || true

DB_SIZE="$(du -h "$DB_TARGET" | cut -f1)"
MEDIA_SIZE="$(du -h "$MEDIA_TARGET" | cut -f1)"
log "terminé — base $DB_SIZE, médias $MEDIA_SIZE"

# ── Purge (désactivée par défaut) ───────────────────────────────────────────
if [ -n "$BACKUP_RETENTION_DAYS" ]; then
  if ! [ "$BACKUP_RETENTION_DAYS" -gt 0 ] 2>/dev/null; then
    fail "BACKUP_RETENTION_DAYS doit être un entier positif"
  fi
  log "purge des sauvegardes de plus de $BACKUP_RETENTION_DAYS jours"
  # Restreint aux fichiers que ce script produit : jamais un motif large.
  find "$BACKUP_DIR" -maxdepth 1 -type f \
    \( -name 'db-*.sqlite3' -o -name 'media-*.tar.gz' \) \
    -mtime "+$BACKUP_RETENTION_DAYS" -print -delete
else
  log "purge non configurée (BACKUP_RETENTION_DAYS absent) — rien n'est supprimé"
fi

# ── Restauration ────────────────────────────────────────────────────────────
# 1. arrêter l'application :  systemctl stop evacstudio-django evacstudio-next
# 2. sauvegarder l'état actuel avant d'écraser quoi que ce soit
# 3. cp db-<date>.sqlite3   backend/db.sqlite3
# 4. tar -xzf media-<date>.tar.gz -C backend/
# 5. chown/chmod (voir DEPLOYMENT.md), puis redémarrer
#
# Une restauration jamais testée n'est pas une sauvegarde : essayez-la une fois
# sur un serveur de test avant de compter dessus.
