#!/bin/bash
set -e

BASE="/www/wwwroot/wrongset"
cd "$BASE" || { echo "wrongset not found"; exit 1; }

GIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BACKUP_DIR="/www/backup/wrongset"
mkdir -p "$BACKUP_DIR"

echo "==> backing up MySQL database..."
# Project uses MySQL (mysql2 + initSchema), not SQLite.
# mysqldump backup is entirely optional and must never block deploy.
# Credentials are read from PM2's env (already exported in the deploy environment).
# If .env exists, source it in a subshell; any failure is swallowed.
( set +e; [ -f .env ] && { set -a; . ./.env 2>/dev/null; set +a; }; \
  mysqldump -h"${DB_HOST:-127.0.0.1}" -P"${DB_PORT:-3306}" -u"${DB_USER:-root}" -p"${DB_PASSWORD}" "${DB_NAME:-wrongset}" \
    > "$BACKUP_DIR/mysql-$(date +%Y%m%d-%H%M%S)-${GIT_HASH}.sql" 2>/dev/null \
  && echo "    MySQL backup OK" \
  || { rm -f "$BACKUP_DIR/mysql-"*.sql 2>/dev/null; echo "    (MySQL backup skipped — safe to continue)"; }
) || echo "    (backup block skipped)"

echo "==> backing up source (git: ${GIT_HASH})..."
BACKUP_NAME="wrongset-src-$(date +%Y%m%d-%H%M%S)-${GIT_HASH}.tar.gz"
tar -czf "$BACKUP_DIR/$BACKUP_NAME" --exclude=node_modules --exclude=.next --exclude=public/uploads --exclude=.git . 2>/dev/null || true
echo "==> source backup: $BACKUP_DIR/$BACKUP_NAME"

echo "==> npm install..."
npm install

# Note: MySQL schema is auto-created by initSchema() on app startup (CREATE TABLE IF NOT EXISTS).
# The old SQLite-based db:init and seed:408 scripts are removed from deploy — they operated on
# data/app.db (SQLite) which is no longer used after the MySQL migration.

echo "==> stopping pm2..."
pm2 stop wrongset 2>/dev/null || true
sleep 1

echo "==> preserving uploads..."
UPLOAD_BACKUP="/tmp/wrongset-uploads-backup"
rm -rf "$UPLOAD_BACKUP"
if [ -d public/uploads ]; then cp -r public/uploads "$UPLOAD_BACKUP" 2>/dev/null || true; fi

echo "==> clean build..."
rm -rf .next node_modules/.cache
sleep 1
npm run build

echo "==> restoring uploads..."
mkdir -p public/uploads
if [ -d "$UPLOAD_BACKUP" ]; then cp -r "$UPLOAD_BACKUP"/* public/uploads/ 2>/dev/null || true; rm -rf "$UPLOAD_BACKUP"; fi
chmod -R 755 public/uploads

echo "==> restart pm2..."
pm2 restart wrongset 2>/dev/null || pm2 start npm --name wrongset -- start
pm2 save

echo "==> done (git: ${GIT_HASH})"
