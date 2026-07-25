import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { initSchema } from "@/lib/schema";

// POST /api/cron/ai-plan?token=xxx
// 可选的系统 cron 入口：每天凌晨 3 点由系统 cron 调用，触发当日 AI 计划生成
// 安全：通过 token 校验（环境变量 CRON_TOKEN 或默认值）
// 幂等：若今天已有 pending/ready batch 则跳过，避免重复生成
//
// 系统 cron 配置示例（Linux crontab）：
//   0 3 * * * curl -X POST "http://localhost:3000/api/cron/ai-plan?token=YOUR_TOKEN"
//
// 若不配置系统 cron，前端 plan 页面会在每天 3 点后首次访问时自动触发（lazy cron）
export async function POST(req: NextRequest) {
  await initSchema();
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  const expectedToken = process.env.CRON_TOKEN || "reasonix-cron-2026";
  if (token !== expectedToken) {
    return NextResponse.json({ error: "无效的 token" }, { status: 401 });
  }

  const d = new Date();
  const targetDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

  // 幂等检查：今天已有 pending 或 ready batch 则跳过
  const existing = await queryOne<{ id: string; status: string }>(
    "SELECT id, status FROM ai_suggestion_batches WHERE task_date=? ORDER BY created_at DESC LIMIT 1",
    [targetDate]
  );
  if (existing && (existing.status === "pending" || existing.status === "ready")) {
    return NextResponse.json({ ok: true, skipped: true, reason: `今天已有 ${existing.status} batch` });
  }

  // 触发 ai-suggest POST（内部 HTTP 调用，后台 fire-and-forget 生成）
  const baseUrl = req.nextUrl.origin;
  const resp = await fetch(`${baseUrl}/api/plan-tasks/ai-suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date: targetDate }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    return NextResponse.json({ error: data.error || "触发失败" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, batch_id: data.batch_id, date: targetDate });
}
