import { NextRequest, NextResponse } from "next/server";
import { runAndSave, queryOne } from "@/lib/db";
import { initSchema } from "@/lib/schema";

// POST: Accept plan task JSON, create record, return task ID
// Required: task_date, title
// Optional: chapter_id, description, completion_pct, difficulty, time_spent, status, created_at, completed_at
export async function POST(req: NextRequest) {
  await initSchema();
  try {
    const body = await req.json();
    const {
      task_date, title, chapter_id, description,
      completion_pct, difficulty, time_spent, status,
      created_at, completed_at, external_id,
    } = body;

    if (!task_date || !title) {
      return NextResponse.json({ error: "task_date and title required" }, { status: 400 });
    }

    // Dedup by external_id
    if (external_id) {
      const dup = queryOne<{ id: number }>("SELECT id FROM plan_tasks WHERE external_id=?", [external_id]);
      if (dup) return NextResponse.json({ ok: true, id: dup.id, existed: true });
    }

    const maxSort = queryOne<{ m: number }>(
      "SELECT COALESCE(MAX(sort_order),0) as m FROM plan_tasks WHERE task_date=?",
      [task_date]
    );

    runAndSave(
      `INSERT INTO plan_tasks (task_date, title, chapter_id, description, completion_pct, difficulty, time_spent, status, sort_order, created_at, completed_at, external_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        task_date,
        title,
        chapter_id || null,
        description || "",
        completion_pct ?? 0,
        difficulty ?? 3,
        time_spent ?? 0,
        status || "pending",
        (maxSort?.m || 0) + 1,
        created_at || new Date().toISOString().replace("T", " ").slice(0, 19),
        completed_at || null,
        external_id || null,
      ]
    );

    const row = queryOne<{ id: number }>("SELECT last_insert_rowid() as id");
    return NextResponse.json({ ok: true, id: row?.id });
  } catch (err) {
    console.error("Import plan-task error:", err);
    return NextResponse.json({ error: "import failed" }, { status: 500 });
  }
}
