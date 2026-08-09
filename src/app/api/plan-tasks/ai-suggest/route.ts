import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryOne, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";
import { decrypt } from "@/lib/crypto-utils";
import { generateSuggestionsInBackground } from "@/lib/plan-suggest";

async function loadSetting(key: string, envFallback = "") {
  try {
    const row = await queryOne<{ value: string }>("SELECT value FROM settings WHERE `key`=?", [key]);
    if (row?.value) return decrypt(row.value);
  } catch { /* */ }
  return process.env[envFallback] || "";
}

// POST /api/plan-tasks/ai-suggest
// 后台 fire-and-forget 模式：
// 1. 生成 batch_id，INSERT ai_suggestion_batches (status='pending')，立即返回 { batch_id }
// 2. 后台 Promise 跑 AI，完成后批量 INSERT ai_suggestions + UPDATE batch status='ready'
// 3. 失败时 UPDATE batch status='error' + error_reason
export async function POST(req: NextRequest) {
  await initSchema();
  const { date } = await req.json();
  const d = new Date();
  const targetDate = date || `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

  const apiKey = await loadSetting("text_key", "DEEPSEEK_API_KEY") || await loadSetting("vision_key", "DASHSCOPE_API_KEY");
  if (!apiKey) {
    return NextResponse.json({ error: "API key 未配置" }, { status: 500 });
  }

  // 生成 batch_id 并插入占位记录
  const batchId = `bat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await runAndSave(
    "INSERT INTO ai_suggestion_batches (id, task_date, status) VALUES (?,?,'pending')",
    [batchId, targetDate]
  );

  // 后台 fire-and-forget 执行 AI 生成（不 await）
  generateSuggestionsInBackground(batchId, targetDate, apiKey).catch(err => {
    console.error("[ai-suggest] background generation failed:", err);
    runAndSave(
      "UPDATE ai_suggestion_batches SET status='error', error_reason=? WHERE id=?",
      [String(err).slice(0, 300), batchId]
    ).catch(() => {});
  });

  // 立即返回 batch_id，前端轮询 GET 获取结果
  return NextResponse.json({ ok: true, batch_id: batchId });
}

// GET /api/plan-tasks/ai-suggest?batch_id=xxx
// 前端轮询接口：返回 batch 状态 + 建议列表
export async function GET(req: NextRequest) {
  await initSchema();
  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batch_id");
  if (!batchId) {
    return NextResponse.json({ error: "缺少 batch_id 参数" }, { status: 400 });
  }

  const batch = await queryOne<{ id: string; status: string; reason: string | null; error_reason: string | null }>(
    "SELECT id, status, reason, error_reason FROM ai_suggestion_batches WHERE id=?",
    [batchId]
  );
  if (!batch) {
    return NextResponse.json({ error: "batch 不存在" }, { status: 404 });
  }

  const suggestions = await queryAll<{
    id: number; title: string; chapter_id: number | null; description: string | null;
    difficulty: number; status: string; adopted_task_id: number | null;
  }>(
    "SELECT id, title, chapter_id, description, difficulty, status, adopted_task_id FROM ai_suggestions WHERE batch_id=? ORDER BY sort_order, id",
    [batchId]
  );

  return NextResponse.json({
    status: batch.status,
    reason: batch.reason,
    error_reason: batch.error_reason,
    suggestions: suggestions.map(s => ({
      id: s.id,
      title: s.title,
      chapter_id: s.chapter_id,
      description: s.description,
      difficulty: s.difficulty,
      adopted: s.status === "adopted",
      adopted_task_id: s.adopted_task_id,
    })),
  });
}
