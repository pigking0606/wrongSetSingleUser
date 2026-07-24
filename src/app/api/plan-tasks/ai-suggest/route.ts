import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryOne, runAndSave } from "@/lib/db";
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

// POST /api/plan-tasks/ai-suggest
// 改为后台 fire-and-forget 模式（与 /api/upload、/api/reanalyze 一致）：
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

// ---------------------------------------------------------------------------
// 后台 AI 生成逻辑（从原同步 POST 函数迁移，完成后写库）
// ---------------------------------------------------------------------------
async function generateSuggestionsInBackground(batchId: string, targetDate: string, apiKey: string) {
  // 查询上下文（与原逻辑一致）
  const chapters = await queryAll<{ id: number; name: string; level: number; parent_id: number | null }>(
    "SELECT id, name, level, parent_id FROM chapters ORDER BY level, id"
  );

  const todayIncomplete = await queryAll<{
    title: string; completion_pct: number; difficulty: number; chapter_id: number | null;
  }>(
    "SELECT title, completion_pct, difficulty, chapter_id FROM plan_tasks WHERE task_date=? AND completion_pct < 100 ORDER BY sort_order, id",
    [targetDate]
  );

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

  const allTitles = await queryAll<{ title: string; cnt: number }>(
    "SELECT title, COUNT(*) as cnt FROM plan_tasks GROUP BY title ORDER BY cnt DESC LIMIT 30"
  );

  const chapMap = new Map<number, string>();
  for (const c of chapters) chapMap.set(c.id, c.name);

  const summaryText = recentSummaries.length > 0
    ? recentSummaries.map(s => `[${s.summary_date}] ${s.content}`).join("\n")
    : "暂无近期小结";

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

  const todayIncompleteText = todayIncomplete.length > 0
    ? todayIncomplete.map(t => {
        const ch = t.chapter_id ? (chapMap.get(t.chapter_id) || "") : "";
        return `○ ${t.title}${ch ? ` (${ch})` : ""} — 已完成${t.completion_pct}%` + (t.completion_pct > 0 ? "，还剩" + (100 - t.completion_pct) + "%" : "");
      }).join("\n")
    : "";

  const patternText = allTitles.length > 0
    ? allTitles.map(t => `${t.title}（出现${t.cnt}次）`).join("\n")
    : "";

  const chapterList = chapters
    .filter(c => c.level >= 2)
    .map(c => `${c.id}:${c.name}`)
    .join(", ");

  // 调用 AI（与原逻辑一致）
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 120000);

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

学习闭环原则（必须遵循）：
- 学习应形成"学新知识 → 做题巩固 → 错题复习 → 阶段复盘"的闭环，不要每天都只安排"学习/看课"类任务
- 如果近期任务中有"学习/看课/听课"类的新知识学习任务，今天应优先安排对应的"做题巩固"任务（如对应章节的习题练习）
- 每3-5天应安排一次"复习/复盘"类任务（如：回顾本周错题、整理某章节笔记、重做错题本中高频错题）
- 如果今天已有学习类任务，建议补充一个做题或复习任务与之配套
- 任务标题应体现任务类型，如"做题：660题第5章选择题"、"复习：高数第一章错题复盘"、"学习：线代第三章行列式"

JSON格式：
{
  "tasks": [
    {"title": "具体任务描述", "chapter_id": 123, "description": "简短说明", "difficulty": 3},
    {"title": "...", "chapter_id": null, "description": "...", "difficulty": 2}
  ],
  "reason": "简短说明建议理由"
}`;

  const model = await loadSetting("text_model", "TEXT_MODEL") || "deepseek-chat";
  const apiUrl = await getTextApiUrl();
  console.log(`[ai-suggest][${batchId}] model=${model} url=${apiUrl} promptLen=${prompt.length}`);

  const body: any = {
    model,
    max_tokens: 8192,
    temperature: 0.3,
    messages: [
      { role: "system", content: "你是任务规划助手。思考过程可以内部进行，但输出的第一个字符必须是 `{`，最后一个字符必须是 `}`，中间是完整的 JSON。禁止在 JSON 前后输出任何文字、解释、推理、思考过程。" },
      { role: "user", content: prompt },
    ],
  };
  if (!model.startsWith("deepseek")) body.response_format = { type: "json_object" };
  const resp = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: ctrl.signal,
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`AI error: ${resp.status} ${errBody.slice(0, 200)}`);
  }
  const data = await resp.json();
  const rawFull = (data.choices?.[0]?.message?.content || "")
    .replace(/^```[\s\S]*?\n/, "").replace(/\n```\s*$/, "").trim();

  // JSON 提取（括号匹配，与原逻辑一致）
  let jsonStr = "";
  const tasksIdx = rawFull.lastIndexOf('"tasks"');
  if (tasksIdx >= 0) {
    let braceStart = rawFull.lastIndexOf("{", tasksIdx);
    if (braceStart >= 0) {
      let depth = 0, inStr = false, escape = false, end = -1;
      for (let i = braceStart; i < rawFull.length; i++) {
        const c = rawFull[i];
        if (escape) { escape = false; continue; }
        if (c === "\\") { escape = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) { end = i; break; }
        }
      }
      if (end > braceStart) jsonStr = rawFull.slice(braceStart, end + 1);
    }
  }
  if (!jsonStr) {
    const s = rawFull.lastIndexOf("{");
    const e = rawFull.lastIndexOf("}");
    if (s >= 0 && e > s) jsonStr = rawFull.slice(s, e + 1);
  }
  console.log(`[ai-suggest][${batchId}] rawFullLen=${rawFull.length} jsonLen=${jsonStr.length}`);
  if (!jsonStr) throw new Error("AI 未返回有效 JSON");
  const result = JSON.parse(jsonStr);

  const tasks: Array<{ title: string; chapter_id: number | null; description: string; difficulty: number }> = result.tasks || [];
  const reason: string = result.reason || "";

  // 批量 INSERT ai_suggestions + UPDATE batch status='ready'
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    await runAndSave(
      "INSERT INTO ai_suggestions (batch_id, task_date, title, chapter_id, description, difficulty, sort_order, status) VALUES (?,?,?,?,?,?,?,'ready')",
      [batchId, targetDate, String(t.title).slice(0, 500), t.chapter_id ?? null, t.description || "", t.difficulty || 3, i]
    );
  }
  await runAndSave(
    "UPDATE ai_suggestion_batches SET status='ready', reason=? WHERE id=?",
    [reason, batchId]
  );
  console.log(`[ai-suggest][${batchId}] completed, ${tasks.length} suggestions inserted`);
}
