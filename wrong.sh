#!/bin/bash
set -e

BASE="/www/wwwroot/wrongset"
cd "$BASE" || { echo "wrongset not found"; exit 1; }

GIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BACKUP_DIR="/www/backup/wrongset"
mkdir -p "$BACKUP_DIR"

echo "==> backing up database..."
cp data/app.db "$BACKUP_DIR/app.db.$(date +%Y%m%d-%H%M%S)-${GIT_HASH}" 2>/dev/null || true

echo "==> backing up source (git: ${GIT_HASH})..."
BACKUP_NAME="wrongset-src-$(date +%Y%m%d-%H%M%S)-${GIT_HASH}.tar.gz"
tar -czf "$BACKUP_DIR/$BACKUP_NAME" --exclude=node_modules --exclude=.next --exclude=public/uploads --exclude=.git . 2>/dev/null || true
echo "==> source backup: $BACKUP_DIR/$BACKUP_NAME"

echo "==> npm install..."
npm install

echo "==> db:init..."
npm run db:init

echo "==> seed:408..."
npm run seed:408

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
