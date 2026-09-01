#!/bin/bash
# 手动部署脚本
# 用途：每次 push 到 git 后，SSH 到服务器执行此脚本即可拉取最新代码并部署
# 用法：ssh root@117.72.207.156 "bash /www/wwwroot/wrongset/deploy.sh"

set -e

REPO_DIR="/www/wwwroot/wrongset"

cd "$REPO_DIR"

echo "=========================================="
echo "$(date '+%Y-%m-%d %H:%M:%S') 部署开始"

# 1. 丢弃本地改动（防止 npm install 改 package-lock 导致 git pull 失败）
echo "==> 丢弃本地改动..."
git checkout -- . 2>/dev/null || true

# 2. 拉取最新代码
echo "==> git pull..."
git pull origin main 2>&1

GIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
echo "当前 HEAD: $GIT_HASH"

# 3. 执行部署（wrong.sh 包含备份、npm ci、build、pm2 restart）
echo "==> 执行 wrong.sh..."
bash wrong.sh 2>&1

echo "$(date '+%Y-%m-%d %H:%M:%S') 部署完成"
echo "=========================================="