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
    console.log(`[ai-suggest] model=${model} url=${apiUrl} promptLen=${prompt.length}`);

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

    // Strip thinking content — deepseek-v4-pro / agnes 等思考模型会把推理写进 content
    // 找最后一个含 "tasks" 的顶层 { 位置，然后用括号匹配提取完整 JSON
    let jsonStr = "";
    const tasksIdx = rawFull.lastIndexOf('"tasks"');
    if (tasksIdx >= 0) {
      // 往前找最近的 { 作为起点
      let braceStart = rawFull.lastIndexOf("{", tasksIdx);
      if (braceStart >= 0) {
        // 括号匹配找终点（考虑字符串内的 { } 需要跳过）
        let depth = 0;
        let inStr = false;
        let escape = false;
        let end = -1;
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
      // 兜底：取最后一个 { 到最后一个 }
      const s = rawFull.lastIndexOf("{");
      const e = rawFull.lastIndexOf("}");
      if (s >= 0 && e > s) jsonStr = rawFull.slice(s, e + 1);
    }
    console.log(`[ai-suggest] rawFullLen=${rawFull.length} jsonLen=${jsonStr.length} jsonFirst200=${jsonStr.slice(0, 200)}`);
    if (!jsonStr) throw new Error("AI 未返回有效 JSON");
    const result = JSON.parse(jsonStr);
    return NextResponse.json(result);
  } catch (err) {
    console.error("AI suggest error:", err);
    return NextResponse.json({ error: "AI 建议生成失败" }, { status: 500 });
  }
}
