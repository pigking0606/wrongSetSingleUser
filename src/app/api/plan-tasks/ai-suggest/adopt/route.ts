import { NextRequest, NextResponse } from "next/server";
import { queryOne, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";

// POST /api/plan-tasks/ai-suggest/adopt
// body: { suggestion_id: number }
// 将 AI 建议采纳为正式 plan_tasks 记录，并标记 ai_suggestions.status='adopted'
export async function POST(req: NextRequest) {
  await initSchema();
  const { suggestion_id } = await req.json();
  if (!suggestion_id) {
    return NextResponse.json({ error: "缺少 suggestion_id" }, { status: 400 });
  }

  const sug = await queryOne<{
    id: number; task_date: string; title: string; chapter_id: number | null;
    description: string | null; difficulty: number; status: string;
  }>(
    "SELECT id, task_date, title, chapter_id, description, difficulty, status FROM ai_suggestions WHERE id=?",
    [suggestion_id]
  );
  if (!sug) {
    return NextResponse.json({ error: "建议不存在" }, { status: 404 });
  }
  if (sug.status === "adopted") {
    return NextResponse.json({ error: "该建议已采纳" }, { status: 400 });
  }

  // 查询当天最大 sort_order，新任务排在末尾
  const maxSort = await queryOne<{ m: number }>(
    "SELECT MAX(sort_order) as m FROM plan_tasks WHERE task_date=?",
    [sug.task_date]
  );

  // INSERT plan_tasks（与 plan-tasks/route.ts POST 逻辑一致）
  const result = await runAndSave(
    "INSERT INTO plan_tasks (task_date, title, chapter_id, description, difficulty, completion_pct, sort_order) VALUES (?,?,?,?,?,0,?)",
    [sug.task_date, sug.title, sug.chapter_id, sug.description || "", sug.difficulty || 3, (maxSort?.m || 0) + 1]
  );

  // runAndSave 在 mysql2 下返回的结果无 insertId 类型，用 LAST_INSERT_ID() 兜底
  const newTask = await queryOne<{ id: number }>("SELECT LAST_INSERT_ID() as id");
  const taskId = newTask?.id || 0;

  // 标记建议已采纳
  await runAndSave(
    "UPDATE ai_suggestions SET status='adopted', adopted_task_id=? WHERE id=?",
    [taskId, sug.id]
  );

  return NextResponse.json({ ok: true, task_id: taskId });
}
