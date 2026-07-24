import { NextRequest, NextResponse } from "next/server";
import { queryAll, runAndSave, queryOne } from "@/lib/db";
import { initSchema } from "@/lib/schema";
import { validateImageFile, saveUploadData, deleteUploadFile } from "@/lib/upload-utils";
import sharp from "sharp";

// GET /api/methods?chapter_id=1
// chapter_id 可为任意层级（科目/章节/知识点），后端会递归收集所有后代节点的 id
// 因为 solution_methods.chapter_id 存的是三级知识点 id，
// 若只精确匹配则传入一级/二级时会查不到数据
export async function GET(req: NextRequest) {
  await initSchema();
  const { searchParams } = new URL(req.url);
  const chapterId = searchParams.get("chapter_id");

  if (!chapterId) {
    const rows = await queryAll(`SELECT m.*, c.name as chapter_name, c2.name as subject_name
      FROM solution_methods m
      LEFT JOIN chapters c ON m.chapter_id = c.id
      LEFT JOIN chapters c2 ON c.parent_id = c2.id
      ORDER BY m.created_at DESC`, []);
    return NextResponse.json(rows);
  }

  // 递归收集所有后代（含自身）章节 id
  const rootId = parseInt(chapterId);
  const allChapters = await queryAll<{ id: number; parent_id: number | null }>(
    "SELECT id, parent_id FROM chapters", []
  );
  const idSet = new Set<number>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of allChapters) {
      if (c.parent_id !== null && idSet.has(c.parent_id) && !idSet.has(c.id)) {
        idSet.add(c.id);
        changed = true;
      }
    }
  }
  const idList = Array.from(idSet);

  const placeholders = idList.map(() => "?").join(",");
  const rows = await queryAll(
    `SELECT m.*, c.name as chapter_name, c2.name as subject_name
      FROM solution_methods m
      LEFT JOIN chapters c ON m.chapter_id = c.id
      LEFT JOIN chapters c2 ON c.parent_id = c2.id
      WHERE m.chapter_id IN (${placeholders})
      ORDER BY m.created_at DESC`,
    idList
  );
  return NextResponse.json(rows);
}

// POST /api/methods — multipart form
//   title, chapter_id, content
//   image_0, image_1, ...          → 解法流程图（image_path 字段，供 AI 解析）
//   example_image_0, example_image_1, ... → 例题图片（example_images 字段）
// (向后兼容：旧的裸 image 字段也接受，作为解法图)
// 两个字段都存为 JSON 数组字符串，如 '["/uploads/a.jpg"]'
export async function POST(req: NextRequest) {
  await initSchema();
  const formData = await req.formData();
  const title = (formData.get("title") as string || "").trim();
  const chapterId = formData.get("chapter_id") as string;
  const content = (formData.get("content") as string || "").trim();

  if (!title) return NextResponse.json({ error: "题型名称不能为空" }, { status: 400 });

  // 解法流程图：image_N
  const solutionUrls: string[] = await collectImages(formData, /^image_\d+$/);
  // 旧版兼容：接受裸 image 字段作为解法图
  if (solutionUrls.length === 0) {
    const legacyImage = formData.get("image") as File | null;
    if (legacyImage && legacyImage.size > 0) {
      solutionUrls.push(await processAndSaveImage(legacyImage));
    }
  }

  // 例题图片：example_image_N
  const exampleUrls: string[] = await collectImages(formData, /^example_image_\d+$/);
  // 结构化流程图数据（JSON 字符串，可选）
  const flowchartData = (formData.get("flowchart_data") as string | null);

  const imagePathJson = JSON.stringify(solutionUrls);
  const exampleImagesJson = JSON.stringify(exampleUrls);

  await runAndSave(
    "INSERT INTO solution_methods (title, chapter_id, content, image_path, example_images, flowchart_data) VALUES (?,?,?,?,?,?)",
    [title, chapterId ? parseInt(chapterId) : null, content, imagePathJson, exampleImagesJson, flowchartData || null]
  );

  const row = await queryOne<{ id: number }>("SELECT LAST_INSERT_ID() as id");
  return NextResponse.json({ ok: true, id: row?.id });
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
