#!/bin/bash
set -e

BASE="/www/wwwroot/wrongset"
cd "$BASE" || { echo "wrongset not found"; exit 1; }

echo "==> npm install..."
npm install

echo "==> db:init..."
npm run db:init

echo "==> seed:408..."
npm run seed:408

# Preserve uploaded images before build (Next.js only serves files present at build time)
echo "==> preserving uploads..."
UPLOAD_BACKUP="/tmp/wrongset-uploads-backup"
rm -rf "$UPLOAD_BACKUP"
if [ -d public/uploads ]; then
  cp -r public/uploads "$UPLOAD_BACKUP" 2>/dev/null || true
fi

echo "==> clean build (clear all caches)..."
rm -rf .next node_modules/.cache
npm run build

# Restore uploaded images after build
echo "==> restoring uploads..."
mkdir -p public/uploads
if [ -d "$UPLOAD_BACKUP" ]; then
  cp -r "$UPLOAD_BACKUP"/* public/uploads/ 2>/dev/null || true
  rm -rf "$UPLOAD_BACKUP"
fi
chmod -R 755 public/uploads

echo "==> restart pm2..."
if pm2 list | grep -q wrongset; then
  pm2 restart wrongset
else
  pm2 start npm --name wrongset -- start
fi
pm2 save

echo "==> done"
