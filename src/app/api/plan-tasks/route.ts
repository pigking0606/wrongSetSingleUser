import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryOne, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function yesterday(ofDate: string): string {
  const [y, m, day] = ofDate.split("-").map(Number);
  const d = new Date(y, m - 1, day - 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

type TaskRow = {
  id: number; task_date: string; chapter_id: number | null;
  title: string; description: string; status: string;
  completion_pct: number; difficulty: number; time_spent: number;
  sort_order: number; completed_at: string | null;
};

export async function GET(req: NextRequest) {
  await initSchema();
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || today();
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const externalId = url.searchParams.get("external_id");

  // Lookup by external_id for cross-project sync
  if (externalId) {
    const row = queryOne<TaskRow>("SELECT * FROM plan_tasks WHERE external_id=?", [externalId]);
    return NextResponse.json({ task: row || null });
  }

  if (from && to) {
    const rows = queryAll<TaskRow>(
      "SELECT * FROM plan_tasks WHERE task_date >= ? AND task_date <= ? ORDER BY task_date, sort_order, id",
      [from, to]
    );
    return NextResponse.json({ tasks: rows });
  }

  // Tasks for the requested date
  const rows = queryAll<TaskRow>(
    "SELECT * FROM plan_tasks WHERE task_date = ? ORDER BY sort_order, id",
    [date]
  );

  // If viewing today, also return yesterday's incomplete tasks as a read-only notification
  if (date === today()) {
    const prev = yesterday(date);
    const yesterdayIncomplete = queryAll<TaskRow>(
      "SELECT * FROM plan_tasks WHERE task_date = ? AND completion_pct < 100 ORDER BY sort_order, id",
      [prev]
    );
    return NextResponse.json({ tasks: rows, yesterdayIncomplete });
  }

  return NextResponse.json({ tasks: rows });
}

export async function POST(req: NextRequest) {
  await initSchema();
  const body = await req.json();
  const { task_date, title, chapter_id, description, difficulty, external_id } = body;
  if (!task_date || !title) {
    return NextResponse.json({ error: "task_date and title required" }, { status: 400 });
  }

  // Dedup by external_id: if already exists, return existing
  if (external_id) {
    const dup = queryOne<{ id: number }>("SELECT id FROM plan_tasks WHERE external_id=?", [external_id]);
    if (dup) return NextResponse.json({ ok: true, id: dup.id, existed: true });
  }

  const maxSort = queryOne<{ m: number }>(
    "SELECT COALESCE(MAX(sort_order),0) as m FROM plan_tasks WHERE task_date=?",
    [task_date]
  );
  runAndSave(
    "INSERT INTO plan_tasks (task_date, title, chapter_id, description, difficulty, completion_pct, external_id, sort_order) VALUES (?,?,?,?,?,0,?,?)",
    [task_date, title, chapter_id || null, description || "", difficulty || 3, external_id || null, (maxSort?.m || 0) + 1]
  );
  const row = queryOne<{ id: number }>("SELECT last_insert_rowid() as id");
  return NextResponse.json({ ok: true, id: row?.id });
}

export async function PUT(req: NextRequest) {
  await initSchema();
  const body = await req.json();
  const { id, title, chapter_id, description, completion_pct, difficulty, time_spent, sort_order } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const sets: string[] = [];
  const vals: any[] = [];
  if (title !== undefined) { sets.push("title=?"); vals.push(title); }
  if (chapter_id !== undefined) { sets.push("chapter_id=?"); vals.push(chapter_id); }
  if (description !== undefined) { sets.push("description=?"); vals.push(description); }
  if (difficulty !== undefined) { sets.push("difficulty=?"); vals.push(difficulty); }
  if (time_spent !== undefined) { sets.push("time_spent=?"); vals.push(time_spent); }
  if (sort_order !== undefined) { sets.push("sort_order=?"); vals.push(sort_order); }
  if (completion_pct !== undefined) {
    sets.push("completion_pct=?");
    vals.push(completion_pct);
    // Auto-set status based on completion_pct
    if (completion_pct >= 100) {
      sets.push("status=?, completed_at=?");
      vals.push("completed");
      vals.push(new Date().toISOString());
    } else if (completion_pct > 0) {
      sets.push("status=?, completed_at=?");
      vals.push("in_progress");
      vals.push(null);
    } else {
      sets.push("status=?, completed_at=?");
      vals.push("pending");
      vals.push(null);
    }
  }
  if (!sets.length) return NextResponse.json({ error: "no fields" }, { status: 400 });

  vals.push(id);
  runAndSave(`UPDATE plan_tasks SET ${sets.join(",")} WHERE id=?`, vals);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  await initSchema();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  runAndSave("DELETE FROM plan_tasks WHERE id=?", [parseInt(id)]);
  return NextResponse.json({ ok: true });
}
