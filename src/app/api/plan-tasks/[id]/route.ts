import { NextRequest, NextResponse } from "next/server";
import { queryOne, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";

// PUT — update plan task fields (all optional)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await initSchema();
  const { id } = await params;
  const body = await req.json();
  const taskId = parseInt(id);

  const existing = await queryOne<{ id: number }>("SELECT id FROM plan_tasks WHERE id=?", [taskId]);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const allowed = ["completion_pct", "difficulty", "time_spent", "status", "title", "description", "completed_at"];
  const updates: string[] = [];
  const values: any[] = [];

  for (const key of allowed) {
    if (body[key] !== undefined) {
      updates.push(`${key} = ?`);
      values.push(body[key]);
    }
  }

  if (updates.length > 0) {
    values.push(taskId);
    runAndSave(`UPDATE plan_tasks SET ${updates.join(", ")} WHERE id=?`, values);
  }

  const task = await queryOne("SELECT * FROM plan_tasks WHERE id=?", [taskId]);
  return NextResponse.json({ ok: true, task });
}

// DELETE
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await initSchema();
  const { id } = await params;
  runAndSave("DELETE FROM plan_tasks WHERE id=?", [parseInt(id)]);
  return NextResponse.json({ ok: true });
}
