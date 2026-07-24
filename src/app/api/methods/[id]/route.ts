import { NextRequest, NextResponse } from "next/server";
import { queryOne, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";
import { validateImageFile, saveUploadData, deleteUploadFile } from "@/lib/upload-utils";
import sharp from "sharp";

// PUT /api/methods/[id] — multipart form
//   title?, chapter_id?, content?
//   image_0, image_1, ...                   → 新解法流程图
//   keep_images: JSON array of solution image URLs to retain
//   example_image_0, example_image_1, ...   → 新例题图片
//   keep_example_images: JSON array of example image URLs to retain
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await initSchema();
  const { id: idStr } = await params;
  const id = parseInt(idStr);
  const formData = await req.formData();
  const title = formData.get("title") as string | null;
  const chapterId = formData.get("chapter_id") as string | null;
  const content = formData.get("content") as string | null;
  const keepImagesRaw = formData.get("keep_images") as string | null;
  const keepExampleRaw = formData.get("keep_example_images") as string | null;
  const flowchartData = formData.get("flowchart_data") as string | null;

  // 解析保留的旧解法图 URL 列表
  let keepImages: string[] = [];
  if (keepImagesRaw) {
    try { keepImages = JSON.parse(keepImagesRaw); } catch { /* ignore */ }
  }
  // 解析保留的旧例题图 URL 列表
  let keepExampleImages: string[] = [];
  if (keepExampleRaw) {
    try { keepExampleImages = JSON.parse(keepExampleRaw); } catch { /* ignore */ }
  }

  // 读取现有记录
  const old = await queryOne<{ image_path: string | null; example_images: string | null }>(
    "SELECT image_path, example_images FROM solution_methods WHERE id=?",
    [id]
  );

  // ---- 解法图：旧图 - 保留 = 待删除 ----
  const oldSolution = parseImagePaths(old?.image_path ?? null);
  const deleteSolution = oldSolution.filter(u => !keepImages.includes(u));
  for (const url of deleteSolution) {
    try { deleteUploadFile(url); } catch { /* ignore */ }
  }
  // 新上传的解法图
  const newSolution: string[] = await collectImages(formData, /^image_\d+$/);
  const finalSolution = [...keepImages, ...newSolution];

  // ---- 例题图：旧图 - 保留 = 待删除 ----
  const oldExample = parseImagePaths(old?.example_images ?? null);
  const deleteExample = oldExample.filter(u => !keepExampleImages.includes(u));
  for (const url of deleteExample) {
    try { deleteUploadFile(url); } catch { /* ignore */ }
  }
  // 新上传的例题图
  const newExample: string[] = await collectImages(formData, /^example_image_\d+$/);
  const finalExample = [...keepExampleImages, ...newExample];

  const sets: string[] = [];
  const vals: any[] = [];
  if (title !== null) { sets.push("title=?"); vals.push(title.trim()); }
  if (chapterId !== null) { sets.push("chapter_id=?"); vals.push(chapterId ? parseInt(chapterId) : null); }
  if (content !== null) { sets.push("content=?"); vals.push(content.trim()); }
  // 始终更新这两个字段（即使没有图片也写成空数组，确保删除生效）
  sets.push("image_path=?"); vals.push(JSON.stringify(finalSolution));
  sets.push("example_images=?"); vals.push(JSON.stringify(finalExample));
  // 结构化流程图数据（可选；传 null 清空，传 JSON 字符串更新）
  if (flowchartData !== null) { sets.push("flowchart_data=?"); vals.push(flowchartData || null); }

  vals.push(id);
  await runAndSave(`UPDATE solution_methods SET ${sets.join(",")} WHERE id=?`, vals);
  return NextResponse.json({ ok: true });
}

function parseImagePaths(raw: string | null): string[] {
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try { return JSON.parse(raw); } catch { return [raw]; }
  }
  return [raw];
}

// 按字段名正则收集图片，按索引排序后保存
async function collectImages(formData: FormData, keyPattern: RegExp): Promise<string[]> {
  const urls: string[] = [];
  const keys = Array.from(formData.keys())
    .filter(k => keyPattern.test(k))
    .sort((a, b) => {
      const ai = parseInt(a.split("_").pop() || "0");
      const bi = parseInt(b.split("_").pop() || "0");
      return ai - bi;
    });
  for (const key of keys) {
    const file = formData.get(key) as File | null;
    if (file && file.size > 0) {
      urls.push(await processAndSaveImage(file));
    }
  }
  return urls;
}

async function processAndSaveImage(file: File): Promise<string> {
  validateImageFile(file);
  const imageBuffer = Buffer.from(await file.arrayBuffer());
  const finalBuffer = await sharp(imageBuffer)
    .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer() as unknown as Buffer;
  const saved = saveUploadData(finalBuffer as Buffer, ".jpg");
  return saved.publicUrl;
}

// DELETE /api/methods/[id] — 删除记录并清理两类图片
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await initSchema();
  const { id: idStr } = await params;
  const id = parseInt(idStr);
  const row = await queryOne<{ image_path: string | null; example_images: string | null }>(
    "SELECT image_path, example_images FROM solution_methods WHERE id=?",
    [id]
  );
  // 清理解法图
  if (row?.image_path) {
    for (const url of parseImagePaths(row.image_path)) {
      try { deleteUploadFile(url); } catch { /* ignore */ }
    }
  }
  // 清理例题图
  if (row?.example_images) {
    for (const url of parseImagePaths(row.example_images)) {
      try { deleteUploadFile(url); } catch { /* ignore */ }
    }
  }
  await runAndSave("DELETE FROM solution_methods WHERE id=?", [id]);
  return NextResponse.json({ ok: true });
}
