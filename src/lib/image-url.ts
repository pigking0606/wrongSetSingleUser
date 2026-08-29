/**
 * 将数据库中的 image_path 转为前端可用的图片 URL
 * - OSS 完整 URL（以 http 开头）→ 直接返回
 * - 相对路径（如 uploads/uuid.jpg）→ 转为 /api/image/uuid.jpg
 */
export function getImageUrl(imagePath: string | null | undefined): string | null {
  if (!imagePath) return null;
  if (imagePath.startsWith("http")) return imagePath;
  if (imagePath.startsWith("uploads/")) {
    return `/api/image/${imagePath.replace("uploads/", "")}`;
  }
  return `/api/image/${imagePath}`;
}