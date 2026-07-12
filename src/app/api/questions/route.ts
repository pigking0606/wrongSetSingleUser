import { NextRequest, NextResponse } from "next/server";
import { getDb, queryAll, queryOne, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";
import { deleteUploadFile } from "@/lib/upload-utils";

export async function GET(req: NextRequest) {
  await initSchema();
  const { searchParams } = new URL(req.url);
  const externalId = searchParams.get("external_id");

  // Lookup by external_id for cross-project sync
  if (externalId) {
    const row = await queryOne("SELECT * FROM questions WHERE external_id=?", [externalId]);
    return NextResponse.json({ question: row || null });
  }

  const chapterId = searchParams.get("chapter_id");
  const bankId = searchParams.get("bank_id");
  const subjectId = searchParams.get("subject_id");
  const chapterL2Id = searchParams.get("chapter_l2_id");
  const dateFrom = searchParams.get("from");
  const dateTo = searchParams.get("to");
  const page = parseInt(searchParams.get("page") || "0");
  const pageSize = parseInt(searchParams.get("pageSize") || "0");

  let sql = `SELECT
    q.*,
    kp.name AS kp_name,
    ch.name AS chapter_name,
    sub.name AS subject_name,
    sub.id AS subject_id,
    ch.id AS chapter_l2_id
  FROM questions q
  LEFT JOIN chapters kp ON q.chapter_id = kp.id
  LEFT JOIN chapters ch ON kp.parent_id = ch.id
  LEFT JOIN chapters sub ON ch.parent_id = sub.id`;

  const params: any[] = [];
  const conditions: string[] = [];

  // Support new hierarchical filters
  if (subjectId) {
    conditions.push("sub.id = ?");
    params.push(parseInt(subjectId));
  }
  if (chapterL2Id) {
    conditions.push("ch.id = ?");
    params.push(parseInt(chapterL2Id));
  }

  // Bank filter
  if (bankId) {
    conditions.push("q.bank_id = ?");
    params.push(parseInt(bankId));
  }

  // Backward compat: old chapter_id = knowledge_point_id
  if (chapterId) {
    conditions.push("q.chapter_id = ?");
    params.push(parseInt(chapterId));
  }
  if (dateFrom) {
    conditions.push("q.created_at >= ?");
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push("q.created_at <= ?");
    params.push(dateTo + " 23:59:59");
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  sql += " ORDER BY q.created_at DESC";

  if (pageSize > 0) {
    sql += " LIMIT ? OFFSET ?";
    params.push(pageSize, page * pageSize);
  }

  const questions = await queryAll(sql, params);

  // If paginated, also return total count
  if (pageSize > 0) {
    const countSql = `SELECT COUNT(*) as total FROM questions q
      LEFT JOIN chapters kp ON q.chapter_id = kp.id
      LEFT JOIN chapters ch ON kp.parent_id = ch.id
      LEFT JOIN chapters sub ON ch.parent_id = sub.id
      ${conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : ""}`;
    const countResult = await queryAll<{ total: number }>(countSql, params.length > 2 ? params.slice(0, params.length - 2) : undefined); // exclude LIMIT/OFFSET params
    return NextResponse.json({ questions, total: countResult[0]?.total || 0 });
  }

  return NextResponse.json(questions);
}

export async function POST(req: NextRequest) {
  await initSchema();
  const body = await req.json();
  const {
    chapter_id,
    image_path,
    ocr_text,
    question_type,
    correct_answer,
    explanation,
    ai_solutions,
    user_answer,
    ai_raw_response,
    original_filename,
    error_reason,
  } = body;

  if (!chapter_id) {
    return NextResponse.json(
      { error: "chapter_id is required" },
      { status: 400 }
    );
  }

  runAndSave(
    `INSERT INTO questions (chapter_id, image_path, ocr_text, question_type, correct_answer, explanation, ai_solutions, user_answer, ai_raw_response, original_filename, error_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      chapter_id,
      image_path || null,
      ocr_text || null,
      question_type || "single_choice",
      correct_answer || null,
      explanation || null,
      ai_solutions ? JSON.stringify(ai_solutions) : null,
      user_answer || null,
      ai_raw_response || null,
      original_filename || null,
      error_reason || null,
    ]
  );

  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest) {
  await initSchema();
  const { searchParams } = new URL(req.url);
  const id = parseInt(searchParams.get("id") || "");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const body = await req.json();
  const fields: string[] = [];
  const params: any[] = [];

  const settable = ["ocr_text", "correct_answer", "question_type", "explanation", "ai_solutions", "user_answer", "chapter_id"];
  for (const key of settable) {
    if (body[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(key === "ai_solutions" ? JSON.stringify(body[key]) : body[key]);
    }
  }

  if (fields.length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  params.push(id);
  runAndSave(`UPDATE questions SET ${fields.join(", ")} WHERE id = ?`, params);

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  await initSchema();
  const { searchParams } = new URL(req.url);
  const id = parseInt(searchParams.get("id") || "");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Clean up image file
  const q = await queryOne<{ image_path: string | null }>("SELECT image_path FROM questions WHERE id=?", [id]);
  if (q?.image_path) {
    try { deleteUploadFile(q.image_path); } catch { /* ignore */ }
  }

  runAndSave("DELETE FROM review_records WHERE question_id=?", [id]);
  runAndSave("DELETE FROM questions WHERE id=?", [id]);

  return NextResponse.json({ ok: true });
}
