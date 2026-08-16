// AI 计划推荐生成逻辑（从 ai-suggest/route.ts 提取，供 route 和 plan-cron 共用）
// 优化点：
// 1. 新增错题统计（每章节错题数、高频错题知识点）
// 2. 新增学习时长统计（近 7 天每日学习时长）
// 3. 新增复习进度（review_records 掌握情况）
// 4. 优化 prompt：更具体的推荐指引、避免空洞任务

import { queryAll, runAndSave } from "@/lib/db";
import { logAiResp } from "@/lib/ai-resp-log";

export async function generateSuggestionsInBackground(batchId: string, targetDate: string, apiKey: string) {
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
    completion_pct: number; difficulty: number; time_spent: number;
  }>(
    "SELECT task_date, title, status, chapter_id, completion_pct, difficulty, time_spent FROM plan_tasks WHERE task_date < ? ORDER BY task_date DESC LIMIT 80",
    [targetDate]
  );

  const allTitles = await queryAll<{ title: string; cnt: number }>(
    "SELECT title, COUNT(*) as cnt FROM plan_tasks GROUP BY title ORDER BY cnt DESC LIMIT 30"
  );

  // 章节题目数量
  const questionCounts = await queryAll<{ chapter_id: number; cnt: number }>(
    "SELECT chapter_id, COUNT(*) as cnt FROM questions WHERE chapter_id IS NOT NULL GROUP BY chapter_id"
  );
  const qCountMap = new Map<number, number>();
  for (const q of questionCounts) qCountMap.set(q.chapter_id, q.cnt);

  // 新增：错题统计 — 每个章节的错题数量（user_answer 与 correct_answer 不一致的题目）
  const wrongCounts = await queryAll<{ chapter_id: number; cnt: number }>(
    `SELECT q.chapter_id, COUNT(*) as cnt FROM questions q
     WHERE q.chapter_id IS NOT NULL AND q.user_answer IS NOT NULL AND q.user_answer != '' AND q.user_answer != q.correct_answer
     GROUP BY q.chapter_id`
  );
  const wrongCountMap = new Map<number, number>();
  for (const w of wrongCounts) wrongCountMap.set(w.chapter_id, w.cnt);

  // 新增：复习进度 — 每个章节的复习次数和平均掌握度
  const reviewStats = await queryAll<{ chapter_id: number; review_cnt: number; avg_score: number }>(
    `SELECT q.chapter_id, COUNT(r.id) as review_cnt, AVG(r.score) as avg_score
     FROM questions q JOIN review_records r ON q.id = r.question_id
     WHERE q.chapter_id IS NOT NULL
     GROUP BY q.chapter_id`
  );
  const reviewMap = new Map<number, { review_cnt: number; avg_score: number }>();
  for (const r of reviewStats) reviewMap.set(r.chapter_id, { review_cnt: r.review_cnt, avg_score: r.avg_score });

  // 新增：近 7 天学习时长统计
  const recent7Days = await queryAll<{ task_date: string; total_minutes: number; task_count: number; completed: number }>(
    `SELECT task_date, SUM(time_spent) as total_minutes, COUNT(*) as task_count,
     SUM(CASE WHEN completion_pct >= 100 THEN 1 ELSE 0 END) as completed
     FROM plan_tasks WHERE task_date >= DATE_SUB(?, INTERVAL 7 DAY) AND task_date < ?
     GROUP BY task_date ORDER BY task_date DESC`,
    [targetDate, targetDate]
  );

  // 新增：待复习题目（next_review_date <= 今天）
  const dueReviewCount = await queryAll<{ chapter_id: number; cnt: number }>(
    `SELECT q.chapter_id, COUNT(*) as cnt FROM questions q
     JOIN review_records r ON q.id = r.question_id
     WHERE q.chapter_id IS NOT NULL AND r.next_review_date <= ?
     GROUP BY q.chapter_id`,
    [targetDate]
  );
  const dueReviewMap = new Map<number, number>();
  for (const d of dueReviewCount) dueReviewMap.set(d.chapter_id, d.cnt);

  const chapMap = new Map<number, string>();
  for (const c of chapters) chapMap.set(c.id, c.name);

  // 构建章节内容摘要：level 1（学科）→ level 2（章）→ level 3（知识点）+ 题目数量 + 错题数
  const subjectChapters = new Map<number, typeof chapters>();
  const chapterKps = new Map<number, typeof chapters>();
  for (const c of chapters) {
    if (c.level === 2 && c.parent_id != null) {
      const arr = subjectChapters.get(c.parent_id) || [];
      arr.push(c); subjectChapters.set(c.parent_id, arr);
    } else if (c.level === 3 && c.parent_id != null) {
      const arr = chapterKps.get(c.parent_id) || [];
      arr.push(c); chapterKps.set(c.parent_id, arr);
    }
  }

  const chapterContentLines: string[] = [];
  for (const subj of chapters.filter(c => c.level === 1)) {
    const l2list = subjectChapters.get(subj.id) || [];
    if (l2list.length === 0) continue;
    const subjTotal = l2list.reduce((s, ch) => s + (qCountMap.get(ch.id) || 0), 0);
    const subjWrong = l2list.reduce((s, ch) => s + (wrongCountMap.get(ch.id) || 0), 0);
    chapterContentLines.push(`【${subj.name}】（共 ${subjTotal} 题，错题 ${subjWrong} 题）`);
    for (const l2 of l2list) {
      const l2Cnt = qCountMap.get(l2.id) || 0;
      const l2Wrong = wrongCountMap.get(l2.id) || 0;
      const due = dueReviewMap.get(l2.id) || 0;
      const rev = reviewMap.get(l2.id);
      const wrongRate = l2Cnt > 0 ? Math.round(l2Wrong / l2Cnt * 100) : 0;
      const dueTag = due > 0 ? `，待复习${due}题` : "";
      const revTag = rev ? `，已复习${rev.review_cnt}次均分${rev.avg_score.toFixed(1)}` : "";
      const kps = chapterKps.get(l2.id) || [];
      if (kps.length === 0) {
        chapterContentLines.push(`  - ${l2.name}（${l2Cnt}题，错题${l2Wrong}题错误率${wrongRate}%${dueTag}${revTag}）`);
      } else {
        const kpText = kps.map(kp => {
          const kpCnt = qCountMap.get(kp.id) || 0;
          const kpWrong = wrongCountMap.get(kp.id) || 0;
          const kpDue = dueReviewMap.get(kp.id) || 0;
          const kpDueTag = kpDue > 0 ? `待复习${kpDue}` : "";
          return `${kp.name}(${kpCnt}题错${kpWrong}${kpDueTag})`;
        }).join("、");
        chapterContentLines.push(`  - ${l2.name}（${l2Cnt}题，错题${l2Wrong}题错误率${wrongRate}%${dueTag}${revTag}）：${kpText}`);
      }
    }
  }
  const chapterContentText = chapterContentLines.join("\n") || "暂无章节题目数据";

  const summaryText = recentSummaries.length > 0
    ? recentSummaries.map(s => `[${s.summary_date}] ${s.content}`).join("\n")
    : "暂无近期小结";

  const tasksByDate = new Map<string, string[]>();
  for (const t of recentTasks) {
    const ch = t.chapter_id ? (chapMap.get(t.chapter_id) || "") : "";
    const pct = t.completion_pct != null ? t.completion_pct : (t.status === "completed" ? 100 : 0);
    const diff = t.difficulty || 3;
    const minutes = t.time_spent || 0;
    const mark = pct >= 100 ? "✓" : pct > 0 ? `◐${pct}%` : "○";
    const timeTag = minutes > 0 ? ` ${Math.floor(minutes/60)}h${minutes%60}m` : "";
    const list = tasksByDate.get(t.task_date) || [];
    list.push(`${mark} ${t.title}${ch ? ` (${ch})` : ""} [难度:${diff}/5${timeTag}]`);
    tasksByDate.set(t.task_date, list);
  }
  const taskText = Array.from(tasksByDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([d, ts]) => `[${d}]\n${ts.join("\n")}`)
    .join("\n\n") || "暂无近期任务";

  // 近 7 天学习时长统计
  const studyStatsText = recent7Days.length > 0
    ? recent7Days.map(d => {
        const h = Math.floor(d.total_minutes / 60);
        const m = d.total_minutes % 60;
        return `[${d.task_date}] ${d.task_count}个任务，完成${d.completed}个，学习${h}h${m}m`;
      }).join("\n")
    : "暂无近 7 天学习数据";

  const todayIncompleteText = todayIncomplete.length > 0
    ? todayIncomplete.map(t => {
        const ch = t.chapter_id ? (chapMap.get(t.chapter_id) || "") : "";
        return `○ ${t.title}${ch ? ` (${ch})` : ""} — 已完成${t.completion_pct}%` + (t.completion_pct > 0 ? "，还剩" + (100 - t.completion_pct) + "%" : "");
      }).join("\n")
    : "";

  const patternText = allTitles.length > 0
    ? allTitles.map(t => `${t.title}（出现${t.cnt}次）`).join("\n")
    : "";

  // 可用章节 id 对照：供 AI 制定任务时准确引用真实存在的章节/知识点
  const chapterList = chapters
    .filter(c => c.level >= 2)
    .map(c => `${c.id}:${c.name}`)
    .join(", ");

  // 优化后的 prompt：增加错题统计、学习时长、复习进度，强调推荐要切合实际
  // 目标学习时长 6-8 小时 → 推荐 8-12 个任务、更高难度
  const prompt = `你是考研备考规划助手。请根据学生的学习数据（含错题统计、学习时长、复习进度），为今天（${targetDate}）推荐 8-12 个具体可执行的任务，总计学习时长约 6-8 小时。

【今日尚未完成的任务 — 优先继续推进】
${todayIncompleteText || "今天所有任务都已完成"}

【近期学习时长统计（近 7 天）】
${studyStatsText}

【近期每日小结】
${summaryText}

【近期任务完成情况（含学习时长）】
${taskText}

【用户常用任务模板】
${patternText || "暂无"}

【章节内容分布（学科 → 章 → 知识点 + 题目数/错题数/错误率/复习进度）】
${chapterContentText}

【可用章节 id 对照（供制定任务时参考）】
${chapterList}

推荐原则（务必遵循，否则推荐不切实际）：
1. 只推荐有实际题目支撑的章节（题目数 ≥ 1），禁止推荐 0 题章节的"做题"任务
2. 优先推荐错误率高的章节（错误率 ≥ 40%）进行错题复习或重做
3. 优先推荐有"待复习"题目的章节进行间隔复习（基于遗忘曲线）
4. 如果近期某章节连续 3+ 天出现且完成率低，说明难度大，建议拆分为更小的子任务
5. 任务标题必须具体到知识点或题号，禁止"复习数学""做题"等空洞标题
6. 标题格式参考：「做题：高数第三章中值定理 660题」「复习：线代行列式错题5道」「学习：数据结构二叉树遍历」
7. 目标每天学习 6-8 小时：任务数量 8-12 个，每项任务预估 40-60 分钟（高难度/做题任务可 60-90 分钟），全部任务合计约 6-8 小时。若近 7 天日均学习不足 2 小时，可适当减少到 5-7 个任务（总量 4-5 小时）作为过渡，但要逐步向 6-8 小时靠拢
8. 学习闭环：如果近期都是"学习/看课"类任务，今天必须安排"做题"或"错题复习"任务；如果近期都是"做题"，今天安排一次"复盘/整理笔记"任务
9. 任务难度可以更高：多数任务 difficulty 给 3-5（中等偏难），依据章节历史难度和用户目标学习时长，不要整体都给低难度
10. 严格基于用户当前进度：任务内容必须来自【章节内容分布】【近期小结】【近期任务】中真实存在的学科/章节/知识点，且与用户最近的进度衔接（例如用户最近在学线性代数，就不要推荐还没接触的高数积分专题）；禁止凭空编造用户没学过的内容

JSON格式（chapter_id 一律填 null，系统统一置空，不按章节分类）：
{
  "tasks": [
    {"title": "具体任务描述", "chapter_id": null, "description": "简短说明推荐理由", "difficulty": 4}
  ],
  "reason": "简短说明今天推荐的整体策略"
}`;

  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 300000);

  // 读取模型和 URL 配置
  async function loadSetting(key: string, envFallback = "") {
    try {
      const { queryOne } = await import("@/lib/db");
      const { decrypt } = await import("@/lib/crypto-utils");
      const row = await queryOne<{ value: string }>("SELECT value FROM settings WHERE `key`=?", [key]);
      if (row?.value) return decrypt(row.value);
    } catch { /* */ }
    return process.env[envFallback] || "";
  }

  const model = await loadSetting("text_model", "TEXT_MODEL") || "deepseek-chat";
  const customUrl = await loadSetting("text_url");
  const apiUrl = customUrl
    ? customUrl.replace(/\/+$/, "") + "/chat/completions"
    : model.startsWith("deepseek")
      ? "https://api.deepseek.com/v1/chat/completions"
      : "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

  console.log(`[ai-suggest][${batchId}] model=${model} url=${apiUrl} promptLen=${prompt.length}`);

  const body: any = {
    model,
    max_tokens: 16384,
    temperature: 0.3,
    messages: [
      { role: "system", content: "你是任务规划助手。思考过程可以内部进行。输出的第一个字符必须是 `{`，最后一个字符必须是 `}`，中间是完整的 JSON。禁止在 JSON 前后输出任何文字。" },
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
  logAiResp("plan-tasks/ai-suggest", model, rawFull,
    `finish_reason=${data.choices?.[0]?.finish_reason} usage=${JSON.stringify(data.usage || {})}`);

  // JSON 提取（括号匹配）
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

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    await runAndSave(
      "INSERT INTO ai_suggestions (batch_id, task_date, title, chapter_id, description, difficulty, sort_order, status) VALUES (?,?,?,?,?,?,?,'ready')",
      // chapter_id 一律置 null：取消 AI 对任务的章节分类，避免章节对应错误
      [batchId, targetDate, String(t.title).slice(0, 500), null, t.description || "", t.difficulty || 3, i]
    );
  }
  await runAndSave(
    "UPDATE ai_suggestion_batches SET status='ready', reason=? WHERE id=?",
    [reason, batchId]
  );
  console.log(`[ai-suggest][${batchId}] completed, ${tasks.length} suggestions inserted`);
}
