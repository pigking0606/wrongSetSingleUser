#!/bin/bash
# 清理服务器多余图片 — 仅保留数据库中引用的图片
# 引用来源：
#   1. questions.image_path
#   2. solution_methods.image_path (JSON 数组字符串，如 ["/uploads/a.jpg","/uploads/b.jpg"])
#   3. solution_methods.example_images (JSON 数组字符串)
# 安全措施：先备份所有图片到 /tmp/uploads-cleanup-backup-<时间戳>/，再删除孤儿文件
# 幂等：可重复执行，已删除的不会重复处理

set -uo pipefail

UPLOADS_DIR="/www/wwwroot/wrongset/public/uploads"
TS=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/tmp/uploads-cleanup-backup-${TS}"
MYSQL_CMD="mysql -uwrongset -pwrongset123 -P6603 wrongset -N -B"

echo "==> [1/5] 检查上传目录..."
if [ ! -d "$UPLOADS_DIR" ]; then
  echo "ERROR: 上传目录不存在: $UPLOADS_DIR"
  exit 1
fi

FILE_COUNT_BEFORE=$(ls -1 "$UPLOADS_DIR" 2>/dev/null | wc -l)
SIZE_BEFORE=$(du -sh "$UPLOADS_DIR" 2>/dev/null | awk '{print $1}')
echo "    上传目录: $UPLOADS_DIR"
echo "    文件数: $FILE_COUNT_BEFORE"
echo "    占用空间: $SIZE_BEFORE"

echo "==> [2/5] 备份所有图片到 $BACKUP_DIR ..."
mkdir -p "$BACKUP_DIR"
cp -r "$UPLOADS_DIR"/* "$BACKUP_DIR"/ 2>/dev/null || true
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR" 2>/dev/null | wc -l)
echo "    已备份 $BACKUP_COUNT 个文件"

echo "==> [3/5] 查询数据库中所有引用的图片..."
# 提取 /uploads/xxx.jpg 中的文件名
REFERENCED_FILE=$(
  {
    # questions.image_path
    $MYSQL_CMD -e "SELECT image_path FROM questions WHERE image_path IS NOT NULL AND image_path != ''" 2>/dev/null
    # solution_methods.image_path (JSON 数组字符串)
    $MYSQL_CMD -e "SELECT image_path FROM solution_methods WHERE image_path IS NOT NULL AND image_path != ''" 2>/dev/null
    # solution_methods.example_images (JSON 数组字符串)
    $MYSQL_CMD -e "SELECT example_images FROM solution_methods WHERE example_images IS NOT NULL AND example_images != ''" 2>/dev/null
  } | grep -oE '[a-f0-9-]+\.(jpg|jpeg|png|webp|gif)' | sort -u
)
REFERENCED_COUNT=$(echo "$REFERENCED_FILE" | grep -c . 2>/dev/null || echo 0)
echo "    数据库引用图片数: $REFERENCED_COUNT"

echo "==> [4/5] 扫描并删除孤儿图片..."
DELETED_COUNT=0
KEPT_COUNT=0
ORPHAN_LIST="/tmp/orphan-images-${TS}.txt"
> "$ORPHAN_LIST"

# 遍历上传目录中的每个文件
while IFS= read -r filepath; do
  [ -z "$filepath" ] && continue
  filename=$(basename "$filepath")
  # 跳过 .gitkeep 等非图片文件
  case "$filename" in
    .gitkeep|*.md|*.txt) continue ;;
  esac
  # 检查文件名是否在引用列表中
  if echo "$REFERENCED_FILE" | grep -qFx "$filename"; then
    KEPT_COUNT=$((KEPT_COUNT + 1))
  else
    echo "$filepath" >> "$ORPHAN_LIST"
    DELETED_COUNT=$((DELETED_COUNT + 1))
  fi
done < <(find "$UPLOADS_DIR" -type f 2>/dev/null)

# 实际删除孤儿文件
if [ "$DELETED_COUNT" -gt 0 ]; then
  while IFS= read -r filepath; do
    rm -f "$filepath"
  done < "$ORPHAN_LIST"
  echo "    删除孤儿图片: $DELETED_COUNT 个"
  echo "    孤儿列表已保存: $ORPHAN_LIST"
else
  echo "    没有孤儿图片需要删除"
  rm -f "$ORPHAN_LIST"
fi
echo "    保留图片: $KEPT_COUNT 个"

echo "==> [5/5] 清理结果"
FILE_COUNT_AFTER=$(ls -1 "$UPLOADS_DIR" 2>/dev/null | wc -l)
SIZE_AFTER=$(du -sh "$UPLOADS_DIR" 2>/dev/null | awk '{print $1}')
echo "    清理前: $FILE_COUNT_BEFORE 个文件, $SIZE_BEFORE"
echo "    清理后: $FILE_COUNT_AFTER 个文件, $SIZE_AFTER"
echo "    删除: $DELETED_COUNT 个"
echo "    备份位置: $BACKUP_DIR （如确认无误可手动 rm -rf 删除）"
echo "==> 完成"
