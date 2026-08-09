// Next.js instrumentation hook — 在应用启动时执行（仅服务端）
// 注册凌晨 3 点自动触发 AI 计划推荐的定时任务
// 无需配置系统 crontab，应用启动后自动运行

export async function register() {
  // 只在 nodejs 运行时执行（非 edge、非构建）
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPlanCron } = await import("@/lib/plan-cron");
    startPlanCron();
  }
}
