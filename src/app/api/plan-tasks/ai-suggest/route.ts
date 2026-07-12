import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryOne } from "@/lib/db";
import { initSchema } from "@/lib/schema";
import { decrypt } from "@/lib/crypto-utils";

async function loadSetting(key: string, envFallback = "") {
  try {
    const row = await queryOne<{ value: string }>("SELECT value FROM settings WHERE `key`=?", [key]);
    if (row?.value) return decrypt(row.value);
  } catch { /* */ }
  return process.env[envFallback] || "";
}

async function getTextApiUrl() {
  const custom = await loadSetting("text_url");
  if (custom) return custom.replace(/\/+$/, "") + "/chat/completions";
  const model = await loadSetting("text_model", "TEXT_MODEL") || "deepseek-chat";
  if (model.startsWith("deepseek")) return "https://api.deepseek.com/v1/chat/completions";
  return "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
}

export async function POST(req: NextRequest) {
  await initSchema();
  const { date } = await req.json();
  const d = new Date();
  const targetDate = date || `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

  // Get all chapters for reference
  const chapters = await queryAll<{ id: number; name: string; level: number; parent_id: number | null }>(
    "SELECT id, name, level, parent_id FROM chapters ORDER BY level, id"
  );

  // Get today's incomplete tasks (includes carried-over from yesterday)
  const todayIncomplete = await queryAll<{
    title: string; completion_pct: number; difficulty: number; chapter_id: number | null;
  }>(
    "SELECT title, completion_pct, difficulty, chapter_id FROM plan_tasks WHERE task_date=? AND completion_pct < 100 ORDER BY sort_order, id",
    [targetDate]
  );

  // Get recent 5 days of summaries + tasks
  const recentSummaries = await queryAll<{ summary_date: string; content: string }>(
    "SELECT summary_date, content FROM daily_summaries WHERE summary_date < ? ORDER BY summary_date DESC LIMIT 5",
    [targetDate]
  );

  const recentTasks = await queryAll<{
    task_date: string; title: string; status: string; chapter_id: number | null;
    completion_pct: number; difficulty: number;
  }>(
    "SELECT task_date, title, status, chapter_id, completion_pct, difficulty FROM plan_tasks WHERE task_date < ? ORDER BY task_date DESC LIMIT 80",
    [targetDate]
  );

  // Get distinct user-defined task titles (to learn user's study patterns)
  const allTitles = await queryAll<{ title: string; cnt: number }>(
    "SELECT title, COUNT(*) as cnt FROM plan_tasks GROUP BY title ORDER BY cnt DESC LIMIT 30"
  );

  // Build chapter map
  const chapMap = new Map<number, string>();
  for (const c of chapters) chapMap.set(c.id, c.name);

  // Build context for AI
  const summaryText = recentSummaries.length > 0
    ? recentSummaries.map(s => `[${s.summary_date}] ${s.content}`).join("\n")
    : "暂无近期小结";

  // Group tasks by date with completion/difficulty info
  const tasksByDate = new Map<string, string[]>();
  for (const t of recentTasks) {
    const ch = t.chapter_id ? (chapMap.get(t.chapter_id) || "") : "";
    const pct = t.completion_pct != null ? t.completion_pct : (t.status === "completed" ? 100 : 0);
    const diff = t.difficulty || 3;
    const mark = pct >= 100 ? "✓" : pct > 0 ? `◐${pct}%` : "○";
    const list = tasksByDate.get(t.task_date) || [];
    list.push(`${mark} ${t.title}${ch ? ` (${ch})` : ""} [难度:${diff}/5]`);
    tasksByDate.set(t.task_date, list);
  }
  const taskText = Array.from(tasksByDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([d, ts]) => `[${d}]\n${ts.join("\n")}`)
    .join("\n\n") || "暂无近期任务";

  // Today's incomplete tasks — critical context
  const todayIncompleteText = todayIncomplete.length > 0
    ? todayIncomplete.map(t => {
        const ch = t.chapter_id ? (chapMap.get(t.chapter_id) || "") : "";
        return `○ ${t.title}${ch ? ` (${ch})` : ""} — 已完成${t.completion_pct}%` + (t.completion_pct > 0 ? "，还剩" + (100 - t.completion_pct) + "%" : "");
      }).join("\n")
    : "";

  // User's common task patterns
  const patternText = allTitles.length > 0
    ? allTitles.map(t => `${t.title}（出现${t.cnt}次）`).join("\n")
    : "";

  const chapterList = chapters
    .filter(c => c.level >= 2)
    .map(c => `${c.id}:${c.name}`)
    .join(", ");

  const apiKey = await loadSetting("text_key", "DEEPSEEK_API_KEY") || await loadSetting("vision_key", "DASHSCOPE_API_KEY");
  if (!apiKey) {
    return NextResponse.json({ error: "API key 未配置" }, { status: 500 });
  }

  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 20000);

    const prompt = `你是考研备考规划助手。请根据学生的学习情况，为今天（${targetDate}）建议3-5个具体任务。

【今日已有但尚未完成的任务 — 需要继续推进】
${todayIncompleteText || "今天所有任务都已完成"}

【今日小结】
${summaryText}

【近期任务完成情况】
${taskText}

【用户常用任务模板】
${patternText || "暂无"}

【可用章节列表（id:名称）】
${chapterList}

要求：
- 返回纯JSON（不要markdown包裹）
- 今天已有但未完成的任务优先安排，可以直接复用原标题或细化
- 如果今天没有未完成任务，再根据学习进度推荐新任务
- 不要推荐过于宽泛的任务（如"复习数学"），必须具体到章节
- 任务粒度与用户历史模板保持一致
- 每个任务指定chapter_id（从章节列表中选最匹配的，找不到填null）
- 为每个任务建议预估difficulty（1简单-5困难）

JSON格式：
{
  "tasks": [
    {"title": "具体任务描述", "chapter_id": 123, "description": "简短说明", "difficulty": 3},
    {"title": "...", "chapter_id": null, "description": "...", "difficulty": 2}
  ],
  "reason": "简短说明建议理由"
}`;

    const model = await loadSetting("text_model", "TEXT_MODEL") || "deepseek-chat";
    const resp = await fetch(await getTextApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`AI error: ${resp.status}`);
    const data = await resp.json();
    const raw = (data.choices?.[0]?.message?.content || "")
      .replace(/^```[\s\S]*?\n/, "").replace(/\n```\s*$/, "").trim();
    const result = JSON.parse(raw.startsWith("{") ? raw : raw.slice(raw.indexOf("{")));
    return NextResponse.json(result);
  } catch (err) {
    console.error("AI suggest error:", err);
    return NextResponse.json({ error: "AI 建议生成失败" }, { status: 500 });
  }
}
