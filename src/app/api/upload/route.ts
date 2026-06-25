import { NextRequest, NextResponse } from "next/server";
import { validateImageFile, saveUploadData, deleteUploadFile, UploadError } from "@/lib/upload-utils";
import { queryOne, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";
import { performAnalysis } from "@/lib/analyze-pipeline";
import sharp from "sharp";

export async function POST(req: NextRequest) {
  await initSchema();
  let publicUrl = "";

  try {
    const formData = await req.formData();
    const image = formData.get("image") as File | null;
    const userAnswer = (formData.get("user_answer") as string) || undefined;

    if (!image) {
      return NextResponse.json({ error: "未提供图片" }, { status: 400 });
    }

    validateImageFile(image);
    const imageBuffer = Buffer.from(await image.arrayBuffer());
    console.log(`[UPLOAD] size=${(image.size / 1024).toFixed(0)}KB`);

    // Resize to keep reasonable size for storage and AI
    const finalBuffer = await sharp(imageBuffer)
      .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer() as unknown as Buffer;

    console.log(`[UPLOAD] resized=${(finalBuffer.length / 1024).toFixed(0)}KB`);

    const saved = saveUploadData(finalBuffer as Buffer, ".jpg");
    publicUrl = saved.publicUrl;

    runAndSave(
      `INSERT INTO questions (chapter_id, image_path, ocr_text, question_type, correct_answer, explanation, ai_solutions, user_answer, status, original_filename)
       VALUES (1, ?, '', 'pending', '', '', '[]', ?, 'pending', ?)`,
      [publicUrl, userAnswer || null, image.name || null]
    );

    const row = queryOne<{ id: number }>("SELECT MAX(id) as id FROM questions");
    const questionId = row?.id ?? 0;

    performAnalysis(questionId).catch(err => {
      console.error("Background analysis failed for question", questionId, err);
    });

    return NextResponse.json({ ok: true, question_id: questionId });
  } catch (err) {
    if (publicUrl) try { deleteUploadFile(publicUrl); } catch { /* ignore */ }
    if (err instanceof UploadError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("Upload error:", err);
    return NextResponse.json({ error: "上传失败" }, { status: 500 });
  }
}
