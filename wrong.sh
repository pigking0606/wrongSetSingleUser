#!/bin/bash
set -e

BASE="/www/wwwroot/wrongset"
cd "$BASE" || { echo "wrongset not found"; exit 1; }

GIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

echo "==> 不备份数据库，直接部署..."

echo "==> npm ci (clean install, does not modify package-lock.json)..."
npm ci

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
