import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryOne } from "@/lib/db";
import { initSchema } from "@/lib/schema";
import { decrypt } from "@/lib/crypto-utils";

function loadSetting(key: string, envFallback = ""): string {
  try {
    const row = queryOne<{ value: string }>("SELECT value FROM settings WHERE key=?", [key]);
    if (row?.value) return decrypt(row.value);
  } catch { /* */ }
  return process.env[envFallback] || "";
}

function getTextApiUrl(): string {
  const custom = loadSetting("text_url");
  if (custom) return custom.replace(/\/+$/, "") + "/chat/completions";
  const model = loadSetting("text_model", "TEXT_MODEL") || "deepseek-chat";
  if (model.startsWith("deepseek")) return "https://api.deepseek.com/v1/chat/completions";
  return "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
}

export async function POST(req: NextRequest) {
  await initSchema();
  const { content, mode, summaryDate } = await req.json();
  const apiKey = loadSetting("text_key", "DEEPSEEK_API_KEY") || loadSetting("vision_key", "DASHSCOPE_API_KEY");
  if (!apiKey) return NextResponse.json({ error: "API key 未配置" }, { status: 500 });

  // mode: "optimize" = polish existing text, "update" = update based on daily summary
  let prompt: string;

  if (mode === "update" && summaryDate) {
    // Get all summaries + tasks since the last progress update
    const lastUpdate = queryOne<{ updated_at: string }>(
      "SELECT updated_at FROM learning_progress WHERE id=1"
    );
    // Take the EARLIER date so we cover everything since last update
    const lastUpdateDate = lastUpdate?.updated_at
      ? lastUpdate.updated_at.slice(0, 10)
      : summaryDate;
    const sinceDate = lastUpdateDate < summaryDate ? lastUpdateDate : summaryDate;

    const summaries = queryAll<{ summary_date: string; content: string }>(
      "SELECT summary_date, content FROM daily_summaries WHERE summary_date >= ? ORDER BY summary_date",
      [sinceDate]
    );
    const tasks = queryAll<{ task_date: string; title: string; completion_pct: number; difficulty: number }>(
      "SELECT task_date, title, completion_pct, difficulty FROM plan_tasks WHERE task_date >= ? ORDER BY task_date",
      [sinceDate]
    );

    const summaryText = summaries.map(s => `[${s.summary_date}] ${s.content}`).join("\n");
    const taskText = tasks.map(t => {
      const pct = t.completion_pct || 0;
      return `[${t.task_date}] ${pct >= 100 ? "✓" : pct > 0 ? "◐" : "○"} ${t.title} (完成${pct}%, 难度${t.difficulty || 3}/5)`;
    }).join("\n");

    prompt = `你是考研进度管理助手。请根据学生近期（${sinceDate} 至今）的学习情况，更新总进度概括。

当前进度概括：
${content || "暂无"}

近期每日小结：
${summaryText || "暂无"}

近期任务完成情况：
${taskText || "暂无"}

要求：
- 在原有进度概括基础上，融入这段时期的进展
- 更新已完成章节/习题的进度描述
- 保留原有格式和语气
- 如果近期没有明显进展，保持原内容不变
- 返回纯文本，不要JSON，不要解释`;
  } else {
    // Optimize/polish mode
    prompt = `你是考研进度管理助手。请优化以下学习进度描述，使其更清晰有条理。

当前进度描述：
${content || "暂无"}

要求：
- 按科目分段整理（数学/英语/专业课/政治）
- 保留具体进度数字和章节信息
- 补全不清晰的表述
- 返回纯文本，不要JSON，不要解释`;
  }

  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 20000);
    const model = loadSetting("text_model", "TEXT_MODEL") || "deepseek-chat";
    const resp = await fetch(getTextApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, max_tokens: 1536, temperature: 0.2,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`AI error: ${resp.status}`);
    const data = await resp.json();
    const result = (data.choices?.[0]?.message?.content || content).trim();
    return NextResponse.json({ content: result });
  } catch (err) {
    console.error("Learning progress AI error:", err);
    return NextResponse.json({ error: "AI 处理失败" }, { status: 500 });
  }
}
