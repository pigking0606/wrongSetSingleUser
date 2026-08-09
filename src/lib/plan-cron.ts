// 应用内定时任务：每天凌晨 3 点自动触发 AI 计划推荐生成
// 通过 instrumentation.ts 在应用启动时注册，不依赖页面访问
// 在 PM2 管理的服务器环境下可靠运行

import { queryOne, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";
import { decrypt } from "@/lib/crypto-utils";

let cronStarted = false;
let lastTriggerDate = "";

// 每天 03:00 触发一次 AI 计划生成
export function startPlanCron() {
  if (cronStarted) return;
  cronStarted = true;
  console.log("[plan-cron] 定时任务已启动，每天 03:00 自动生成 AI 计划推荐");

  // 每 60 秒检查一次当前时间
  setInterval(async () => {
    try {
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

      // 凌晨 3:00-3:01 之间触发，且今天还没触发过
      if (hour === 3 && minute === 0 && lastTriggerDate !== today) {
        lastTriggerDate = today;
        console.log(`[plan-cron] 触发 ${today} 的 AI 计划生成`);
        await triggerAiPlan(today);
      }
    } catch (err) {
      console.error("[plan-cron] 检查失败:", err);
    }
  }, 60 * 1000);
}

// 幂等触发 AI 计划生成（与 /api/cron/ai-plan 逻辑一致）
async function triggerAiPlan(targetDate: string) {
  await initSchema();

  // 幂等检查：今天已有 pending 或 ready batch 则跳过
  const existing = await queryOne<{ id: string; status: string }>(
    "SELECT id, status FROM ai_suggestion_batches WHERE task_date=? ORDER BY created_at DESC LIMIT 1",
    [targetDate]
  );
  if (existing && (existing.status === "pending" || existing.status === "ready")) {
    console.log(`[plan-cron] ${targetDate} 已有 ${existing.status} batch，跳过`);
    return;
  }

  // 加载 API key
  async function loadSetting(key: string, envFallback = "") {
    try {
      const row = await queryOne<{ value: string }>("SELECT value FROM settings WHERE `key`=?", [key]);
      if (row?.value) return decrypt(row.value);
    } catch { /* */ }
    return process.env[envFallback] || "";
  }

  const apiKey = await loadSetting("text_key", "DEEPSEEK_API_KEY") || await loadSetting("vision_key", "DASHSCOPE_API_KEY");
  if (!apiKey) {
    console.error("[plan-cron] API key 未配置，跳过");
    return;
  }

  // 生成 batch_id 并插入占位记录
  const batchId = `bat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await runAndSave(
    "INSERT INTO ai_suggestion_batches (id, task_date, status) VALUES (?,?,'pending')",
    [batchId, targetDate]
  );

  // 后台 fire-and-forget 执行（不 await，避免阻塞定时器）
  // 动态导入避免循环依赖
  const { generateSuggestionsInBackground } = await import("@/lib/plan-suggest");
  generateSuggestionsInBackground(batchId, targetDate, apiKey).catch(err => {
    console.error("[plan-cron] 后台生成失败:", err);
    runAndSave(
      "UPDATE ai_suggestion_batches SET status='error', error_reason=? WHERE id=?",
      [String(err).slice(0, 300), batchId]
    ).catch(() => {});
  });

  console.log(`[plan-cron] ${targetDate} batch ${batchId} 已提交后台生成`);
}
