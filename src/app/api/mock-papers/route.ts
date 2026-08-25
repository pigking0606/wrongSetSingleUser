import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryOne, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";

export async function GET(req: NextRequest) {
  await initSchema();
  const { searchParams } = new URL(req.url);
  const idRaw = searchParams.get("id");
  const id = idRaw ? parseInt(idRaw) : 0;

  if (id && !isNaN(id)) {
    const row = await queryOne("SELECT * FROM mock_papers WHERE id=?", [id]);
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    let sections = [];
    let answerRecords = {};
    try { sections = JSON.parse((row as any).sections_data || "[]"); } catch { sections = []; }
    try { answerRecords = JSON.parse((row as any).answer_records || "{}"); } catch { answerRecords = {}; }
    return NextResponse.json({ paper: { ...row, sections, answerRecords } });
  }

  const rows = await queryAll(
    "SELECT id, title, subject_name, label, total, total_score, created_at FROM mock_papers ORDER BY created_at DESC"
  );
  return NextResponse.json({ papers: rows });
}

export async function POST(req: NextRequest) {
  await initSchema();
  const body = await req.json();
  const { title, subject_id, subject_name, label, total, total_score, sections } = body;
  if (!Array.isArray(sections)) {
    return NextResponse.json({ error: "sections is required" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const result: any = await runAndSave(
    `INSERT INTO mock_papers (title, subject_id, subject_name, label, total, total_score, sections_data, answer_records)
     VALUES (?, ?, ?, ?, ?, ?, ?, '{}')`,
    [title, subject_id || null, subject_name || null, label || null, total || 0, total_score || 0, JSON.stringify(sections)]
  );
  return NextResponse.json({ ok: true, id: result?.insertId ?? null });
}

export async function PUT(req: NextRequest) {
  await initSchema();
  const { searchParams } = new URL(req.url);
  const id = parseInt(searchParams.get("id") || "");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const body = await req.json();
  const sets: string[] = [];
  const params: any[] = [];

  if (typeof body.answer_records === "object" && body.answer_records !== null) {
    sets.push("answer_records = ?");
    params.push(JSON.stringify(body.answer_records));
  }
  if (typeof body.title === "string" && body.title) {
    sets.push("title = ?");
    params.push(body.title);
  }

  if (sets.length === 0) return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  params.push(id);
  await runAndSave(`UPDATE mock_papers SET ${sets.join(", ")} WHERE id=?`, params);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  await initSchema();
  const { searchParams } = new URL(req.url);
  const id = parseInt(searchParams.get("id") || "");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await runAndSave("DELETE FROM mock_papers WHERE id=?", [id]);
  return NextResponse.json({ ok: true });
}