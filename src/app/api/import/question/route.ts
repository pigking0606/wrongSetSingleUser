import { NextRequest, NextResponse } from "next/server";
import { queryOne, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";

// POST: Accept question JSON, create record, return question ID
// Required: chapter_id, ocr_text
// Optional: image_path, question_type, correct_answer, explanation, ai_solutions, user_answer, created_at, status
export async function POST(req: NextRequest) {
  await initSchema();
  try {
    const body = await req.json();
    const {
      chapter_id, ocr_text, image_path, question_type,
      correct_answer, explanation, ai_solutions, user_answer,
      created_at, status, external_id,
    } = body;

    if (!chapter_id || !ocr_text) {
      return NextResponse.json({ error: "chapter_id and ocr_text required" }, { status: 400 });
    }

    // Dedup by external_id
    if (external_id) {
      const dup = queryOne<{ id: number }>("SELECT id FROM questions WHERE external_id=?", [external_id]);
      if (dup) return NextResponse.json({ ok: true, id: dup.id, existed: true });
    }

    runAndSave(
      `INSERT INTO questions (chapter_id, ocr_text, image_path, question_type, correct_answer, explanation, ai_solutions, user_answer, created_at, status, external_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        chapter_id,
        ocr_text,
        image_path || null,
        question_type || "single_choice",
        correct_answer || "",
        explanation || "",
        ai_solutions || null,
        user_answer || null,
        created_at || new Date().toISOString().replace("T", " ").slice(0, 19),
        status || "ready",
        external_id || null,
      ]
    );

    const row = queryOne<{ id: number }>("SELECT last_insert_rowid() as id");
    return NextResponse.json({ ok: true, id: row?.id });
  } catch (err) {
    console.error("Import question error:", err);
    return NextResponse.json({ error: "import failed" }, { status: 500 });
  }
}
