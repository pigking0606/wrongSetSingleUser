#!/bin/bash
# Gitee WebHook 部署脚本
# 用途：git pull + 部署 + 同步到 GitHub
# 部署日志：/www/wwwroot/wrongset/deploy-webhook.log

set -e

REPO_DIR="/www/wwwroot/wrongset"
GIT_REMOTE="origin"  # Gitee remote
GITHUB_REMOTE="github"

cd "$REPO_DIR"

echo "=========================================="
echo "$(date '+%Y-%m-%d %H:%M:%S') 部署开始"

# 1. 丢弃本地改动（防止 npm install 改 package-lock 导致 git pull 失败）
echo "==> 丢弃本地改动..."
git checkout -- . 2>/dev/null || true

# 2. 从 Gitee 拉取最新代码
echo "==> git pull from Gitee..."
git pull $GIT_REMOTE main 2>&1

GIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
echo "当前 HEAD: $GIT_HASH"

# 3. 执行部署（wrong.sh 包含备份、npm ci、build、pm2 restart）
echo "==> 执行 wrong.sh..."
bash wrong.sh 2>&1

# 4. 同步到 GitHub
echo "==> 同步到 GitHub..."
GITHUB_TOKEN=$(grep -oP 'GITHUB_PAT=\K.*' .env 2>/dev/null || echo "")
if [ -n "$GITHUB_TOKEN" ]; then
  # 检查 GitHub remote 是否存在
  if ! git remote get-url $GITHUB_REMOTE &>/dev/null; then
    TOKEN=$(printf '%s' "$GITHUB_TOKEN" | tr -d '\r\n ')
    git remote add $GITHUB_REMOTE "https://pigking0606:${TOKEN}@github.com/pigking0606/wrongSetSingleUser.git"
  fi
  git push $GITHUB_REMOTE main 2>&1
  echo "GitHub 同步完成"
else
  echo "GITHUB_PAT 未配置，跳过 GitHub 同步"
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') 部署完成"
echo "=========================================="