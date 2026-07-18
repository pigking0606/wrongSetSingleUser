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
    const bankId = parseInt(formData.get("bank_id") as string || "1") || 1;

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

    // chapter_id 用 NULL：用户上传时未选章节，由 AI 分析后回填（performAnalysis 中 UPDATE chapter_id=?）
    // 之前硬编码 chapter_id=1 但服务器 chapters 表无 id=1，触发外键约束失败 ER_NO_REFERENCED_ROW_2
    const insertResult = await runAndSave(
      `INSERT INTO questions (chapter_id, image_path, ocr_text, question_type, correct_answer, explanation, ai_solutions, user_answer, bank_id, status, original_filename)
       VALUES (NULL, ?, '', '', '', '', '[]', ?, ?, 'pending', ?)`,
      [publicUrl, userAnswer || null, bankId, image.name || null]
    );

    const row = await queryOne<{ id: number }>("SELECT LAST_INSERT_ID() as id");
    const questionId = row?.id ?? 0;
    if (!questionId) {
      // INSERT 失败的兜底（理论上 runAndSave 抛异常会进 catch，此处以防万一）
      if (publicUrl) try { deleteUploadFile(publicUrl); } catch { /* ignore */ }
      return NextResponse.json({ error: "入库失败" }, { status: 500 });
    }

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
