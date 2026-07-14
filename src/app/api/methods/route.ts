import { NextRequest, NextResponse } from "next/server";
import { queryAll, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";
import { validateImageFile, saveUploadData } from "@/lib/upload-utils";
import sharp from "sharp";

// GET /api/methods?chapter_id=1
export async function GET(req: NextRequest) {
  await initSchema();
  const { searchParams } = new URL(req.url);
  const chapterId = searchParams.get("chapter_id");

  const sql = `SELECT m.*, c.name as chapter_name, c2.name as subject_name
    FROM solution_methods m
    LEFT JOIN chapters c ON m.chapter_id = c.id
    LEFT JOIN chapters c2 ON c.parent_id = c2.id
    ${chapterId ? "WHERE m.chapter_id = ?" : ""}
    ORDER BY m.created_at DESC`;
  const rows = await queryAll(sql, chapterId ? [parseInt(chapterId)] : []);
  return NextResponse.json(rows);
}

// POST /api/methods — multipart: title, chapter_id, content, image?
export async function POST(req: NextRequest) {
  await initSchema();
  const formData = await req.formData();
  const title = (formData.get("title") as string || "").trim();
  const chapterId = formData.get("chapter_id") as string;
  const content = (formData.get("content") as string || "").trim();
  const image = formData.get("image") as File | null;

  if (!title) return NextResponse.json({ error: "题型名称不能为空" }, { status: 400 });

  let imagePath = "";
  if (image && image.size > 0) {
    validateImageFile(image);
    const imageBuffer = Buffer.from(await image.arrayBuffer());
    const finalBuffer = await sharp(imageBuffer)
      .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer() as unknown as Buffer;
    const saved = saveUploadData(finalBuffer as Buffer, ".jpg");
    imagePath = saved.publicUrl;
  }

  await runAndSave(
    "INSERT INTO solution_methods (title, chapter_id, content, image_path) VALUES (?,?,?,?)",
    [title, chapterId ? parseInt(chapterId) : null, content, imagePath]
  );
  return NextResponse.json({ ok: true });
}
