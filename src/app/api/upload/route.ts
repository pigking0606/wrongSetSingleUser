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

    // BUGFIX: 之前 VALUES 列数与列名不匹配（11列10值），且把 'pending' 写入 question_type/bank_id、
    // bankId 写入 status、丢失 original_filename。加上 runAndSave 未 await，SQL 异常被吞，
    // 前端收到 200 OK 但实际未入库 → 题库永远为空。
    const insertResult = await runAndSave(
      `INSERT INTO questions (chapter_id, image_path, ocr_text, question_type, correct_answer, explanation, ai_solutions, user_answer, bank_id, status, original_filename)
       VALUES (1, ?, '', '', '', '', '[]', ?, ?, 'pending', ?)`,
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
