import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { initSchema } from "@/lib/schema";

// GET /api/plan-tasks/ai-suggest/latest?date=YYYY-MM-DD
// 返回指定日期最新的 batch（任意状态），供前端判断：
//  - status='ready' → 直接加载建议
//  - status='pending' → 轮询
//  - 无 batch 或 status='error' → 若已过凌晨 3 点，自动触发新一次生成（lazy cron）
export async function GET(req: NextRequest) {
  await initSchema();
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  if (!date) {
    return NextResponse.json({ error: "缺少 date 参数" }, { status: 400 });
  }

  const batch = await queryOne<{ id: string; status: string }>(
    "SELECT id, status FROM ai_suggestion_batches WHERE task_date=? ORDER BY created_at DESC LIMIT 1",
    [date]
  );

  return NextResponse.json({
    batch_id: batch?.id || null,
    status: batch?.status || null,
  });
}
