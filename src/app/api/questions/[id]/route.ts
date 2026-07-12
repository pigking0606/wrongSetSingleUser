import { NextRequest, NextResponse } from "next/server";
import { queryOne, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";
import { deleteUploadFile } from "@/lib/upload-utils";

// PUT — update question fields (all optional)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await initSchema();
  const { id } = await params;
  const body = await req.json();
  const qId = parseInt(id);

  const existing = await queryOne<{ id: number }>("SELECT id FROM questions WHERE id=?", [qId]);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const allowed = [
    "ocr_text", "question_type", "correct_answer", "explanation",
    "ai_solutions", "user_answer", "chapter_id", "error_reason", "status", "image_path",
  ];
  const updates: string[] = [];
  const values: any[] = [];

  for (const key of allowed) {
    if (body[key] !== undefined) {
      updates.push(`${key} = ?`);
      values.push(body[key]);
    }
  }

  if (updates.length > 0) {
    values.push(qId);
    runAndSave(`UPDATE questions SET ${updates.join(", ")} WHERE id=?`, values);
  }

  const q = await queryOne("SELECT * FROM questions WHERE id=?", [qId]);
  return NextResponse.json({ ok: true, question: q });
}

// DELETE
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await initSchema();
  const { id } = await params;
  const qId = parseInt(id);

  const q = await queryOne<{ image_path: string | null }>("SELECT image_path FROM questions WHERE id=?", [qId]);
  if (q?.image_path) deleteUploadFile(q.image_path);

  runAndSave("DELETE FROM questions WHERE id=?", [qId]);
  return NextResponse.json({ ok: true });
}
