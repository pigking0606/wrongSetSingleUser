import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { queryOne, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";
import { autoWrapMathDelimiters, sanitizeLatex, sanitizeOcrText, fixLatexWithAI, reconcileAnswerWithAI, normalizeDifficulty, inferQuestionType, getTextEndpoints, getVisionEndpoints } from "@/lib/ai";
import { enqueue } from "@/lib/analysis-queue";
import { logAiResp } from "@/lib/ai-resp-log";
import { aiFetch } from "@/lib/ai-fetch";

import { decrypt } from "@/lib/crypto-utils";
async function loadSetting(key: string, envFallback = "") {
  try {
    const row = await queryOne<{ value: string }>("SELECT value FROM settings WHERE `key`=?", [key]);
    if (row?.value) return decrypt(row.value);
  } catch { /* */ }
  return process.env[envFallback] || "";
}

const REANALYZE_PROMPT = `你是考研命题审查专家，正在对之前解析结果进行复审修正。请重新分析以下题目，严格返回纯JSON：

{
  "ocrText": "净化后的题干",
  "questionType": "single_choice|multiple_choice|true_false|fill_blank|short_answer|comprehensive",
  "correctAnswer": "正确答案",
  "explanation": "解析（100-200字）",
  "solutions": [
    {"name":"标准解法（标注适用场景）","steps":["..."],"answer":"..."},
    {"name":"技巧法/秒杀法（如有）","steps":["..."],"answer":"..."}
  ],
  "confidence": 0.95,
  "difficulty": 3
}

【重要】最终答案必须基于严格推导，禁止看图猜答案；图片手写笔迹不得作为依据；推导与手写冲突时以推导为准。
输出的第一个字符必须是 \`{\`，最后一个字符必须是 \`}\`，禁止 JSON 前后输出任何推理文字。

【重解析与初始解析的区别】
- 这是重解析，意味着之前的解析可能存在错误，你需要以批判视角重新审视
- solutions 必须给出 2-3 种不同解法（初始解析只要求1-2种，重解析要求更多视角）
- 至少包含一种与之前不同的解题思路或方法
- 若题目本身只有唯一解法（如定义题），可给出1种但需在 explanation 中说明为何只有一种解法

【难度评估】
- difficulty：整数 1-5，按考研标准评估本题难度：
  1=送分题 2=基础题 3=中等题 4=难题 5=压轴题
  考研试卷难度比例参考：易(1-2)约30%、中(3)约50%、难(4-5)约20%

【考研数学适配性要求（数学题必须遵守）】
- 解法必须符合考研数学大纲范围，禁止使用超纲方法（如数学二不考概率统计、级数等内容）
- 优先使用考研通用教材中的标准方法和符号体系
- 解题步骤的深度和严谨度应匹配考研要求：关键步骤不可跳过，中间结论需有依据

【解题技巧性与方法复用性】
- explanation 末尾应用一句话点出本题考查的核心题型和通用解题套路
- solutions 中的每种解法应标注其适用场景（如"适用于对称矩阵"、"适用于选择题快速排除"）
- 若存在秒杀技巧/特殊值法/排除法等应试技巧，应作为单独解法给出并在 name 中标注"技巧法"
- 解法应注重可迁移性：提炼出可复用到同类题目的关键步骤

【ocrText规范】
- 必须去掉所有题号前缀（如"32."、"【2021统考真题】"、"一、选择题"）
- 只保留印刷体的题干正文和选项，忽略图片中的手写笔迹（手写答案/演算/批注一律不识别）
- 选择题选项必须每行一个：\\nA. xxx\\nB. xxx\\nC. xxx\\nD. xxx
- **图片关联性判断**：如果图片不包含题目内容（如纯手写演算、空白、无关图片），或图片主要是下一题的内容，ocrText 输出"[图片非当前题目，跳过解析]"
- **含图的题目必须用结构化文字完整描述图**：
  - 二叉树/树：用缩进列表表示层级，标注左右子节点
  - 有向图/无向图/带权图：用边列表 "起点 → 终点 (权值)"
  - 邻接矩阵/散列表：用 Markdown 表格表示
  - 网络拓扑/IP分配：用结构化列表列出节点、接口、IP
  - 所有 ASCII/边列表用 \`\`\` 代码块包裹，表格用 Markdown 表格语法
  - 描述放在 ocrText 中对应位置（题干文字之后、选项之前）

【数学公式规范】
- 必须统一使用 $...$ 作为行内公式分隔符，禁止使用 \\( ... \\) 或 \\[ ... \\]
- 完整公式必须一个 $...$ 块包裹，禁止拆成 $a = $b 形式（$ 必须成对，有开有闭）
- ^{...} 和 _{...} 内部绝对不能有 $ 符号
- 所有 LaTeX 命令必须在 $...$ 内部
- JSON 内 LaTeX 反斜杠写成双反斜杠 \\\\frac
- 行列式和矩阵必须用 \\begin{vmatrix}...\\end{vmatrix} 等整体表示
- 行列式记号 |A| 写成纯文本，不要包进 $...$；只有含 LaTeX 命令的表达式才用 $...$
- 上标下标必须用花括号：x^{2} 而非 x^2，x_{1} 而非 x_1`;

const REANALYZE_ANSWER_PROMPT = `你是考研命题审查专家，正在对之前解析结果进行复审修正。请根据已有题干OCR文本重新生成答案解析，严格返回纯JSON：

{
  "correctAnswer": "正确答案",
  "explanation": "解析（100-200字）",
  "solutions": [
    {"name":"标准解法（标注适用场景）","steps":["..."],"answer":"..."},
    {"name":"技巧法/秒杀法（如有）","steps":["..."],"answer":"..."}
  ],
  "confidence": 0.95,
  "difficulty": 3
}

【重要】最终答案必须基于严格推导，禁止看图猜答案；图片手写笔迹不得作为依据；推导与手写冲突时以推导为准。
输出的第一个字符必须是 \`{\`，最后一个字符必须是 \`}\`，禁止 JSON 前后输出任何推理文字。

注意：不要输出ocrText字段，只更新correctAnswer、explanation、solutions和difficulty。

【重解析与初始解析的区别】
- 这是重解析，意味着之前的解析可能存在错误，你需要以批判视角重新审视
- solutions 必须给出 2-3 种不同解法（初始解析只要求1-2种，重解析要求更多视角）
- 至少包含一种与之前不同的解题思路或方法
- 若题目本身只有唯一解法（如定义题），可给出1种但需在 explanation 中说明为何只有一种解法

【考研数学适配性要求（数学题必须遵守）】
- 解法必须符合考研数学大纲范围，禁止使用超纲方法
- 优先使用考研通用教材中的标准方法和符号体系
- 解题步骤的深度和严谨度应匹配考研要求：关键步骤不可跳过

【解题技巧性与方法复用性】
- explanation 末尾应用一句话点出本题考查的核心题型和通用解题套路
- solutions 中的每种解法应标注其适用场景
- 若存在秒杀技巧/特殊值法/排除法等应试技巧，应作为单独解法给出并在 name 中标注"技巧法"
- 解法应注重可迁移性：提炼出可复用到同类题目的关键步骤

【数学公式规范】
- 必须统一使用 $...$ 作为行内公式分隔符，禁止使用 \\( ... \\) 或 \\[ ... \\]
- 完整公式必须一个 $...$ 块包裹，禁止拆成 $a = $b 形式（$ 必须成对，有开有闭）
- ^{...} 和 _{...} 内部绝对不能有 $ 符号
- 所有 LaTeX 命令必须在 $...$ 内部
- JSON 内 LaTeX 反斜杠写成双反斜杠 \\\\frac
- 行列式和矩阵必须用 \\begin{vmatrix}...\\end{vmatrix} 等整体表示
- 行列式记号 |A| 写成纯文本，不要包进 $...$；只有含 LaTeX 命令的表达式才用 $...$
- 上标下标必须用花括号：x^{2} 而非 x^2，x_{1} 而非 x_1`;

/**
 * 从 OSS 完整 URL 下载图片并转 base64（兼容阿里云 OSS 存储的 image_path）
 * 返回 null 表示获取失败（网络错误 / 非 2xx / 非图片）。
 */
async function fetchImageFromUrl(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error(`[Reanalyze] fetch image failed: ${url} status=${resp.status}`);
      return null;
    }
    const contentType = resp.headers.get("content-type") || "";
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length === 0) return null;
    // 从 content-type 推断 mimeType；无法确定时按 URL 扩展名兜底
    let mimeType = contentType.includes("image") ? contentType.split(";")[0] : "";
    if (!mimeType) {
      const ext = (url.split("?")[0].split(".").pop() || "").toLowerCase();
      mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    }
    return { base64: buf.toString("base64"), mimeType };
  } catch (err) {
    console.error(`[Reanalyze] fetch image error: ${url}`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * 读取服务器本地的相对路径图片（如 uploads/xxx.jpg），兼容旧数据。
 * 返回 null 表示文件不存在。
 */
function readLocalImage(imagePath: string): { base64: string; mimeType: string } | null {
  try {
    const full = join(process.cwd(), "public", imagePath);
    if (!existsSync(full)) return null;
    const buf = readFileSync(full);
    const ext = imagePath.split(".").pop()?.toLowerCase() || "jpg";
    const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return { base64: buf.toString("base64"), mimeType };
  } catch (err) {
    console.error(`[Reanalyze] read local image error: ${imagePath}`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function processReanalyze(
  questionId: number, ocrText: string, imagePath: string | null,
  apiKey: string, answerOnly: boolean, reason?: string
) {
  try {
    const systemMsg = { role: "system" as const, content: answerOnly ? REANALYZE_ANSWER_PROMPT : REANALYZE_PROMPT };
    let userMsg: any;
    const reasonHint = reason ? `\n\n【重解析原因/用户反馈】${reason}\n请特别注意以上反馈并修正之前的错误。` : "";

    if (answerOnly) {
      userMsg = { role: "user" as const, content: `请重新分析这道题目的答案和解析：${reasonHint}\n\n${ocrText}` };
    } else {
      // Full reanalyze: always send the image if available, so the vision model re-OCRs the actual picture
      if (imagePath) {
        // 支持 OSS 完整 URL（https://...）或本地相对路径（uploads/xxx.jpg）
        const imgData = imagePath.startsWith("http")
          ? await fetchImageFromUrl(imagePath)
          : readLocalImage(imagePath);
        if (imgData) {
          const base64 = imgData.base64;
          const mimeType = imgData.mimeType;
          const ocrContext = (ocrText && ocrText.length > 5 && !ocrText.includes("分析失败"))
            ? `题目的参考文本（可能存在格式错误，以图片为准）：\n${ocrText}`
            : "请分析图片中的题目，按 JSON 格式返回。";
          userMsg = {
            role: "user" as const,
            content: [
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
              { type: "text", text: ocrContext },
            ],
          };
        } else {
          // Image file missing, fall back to text-only
          if (ocrText && ocrText.length > 5) {
            userMsg = { role: "user" as const, content: `请重新分析这道错题：\n\n${ocrText}` };
          } else {
            console.error(`[Reanalyze] question=${questionId} 图片无法读取且无OCR文本`);
            await runAndSave("UPDATE questions SET status='error', error_reason=? WHERE id=?", ["图片文件丢失且无OCR文本", questionId]);
            return;
          }
        }
      } else if (ocrText && ocrText.length > 5) {
        userMsg = { role: "user" as const, content: `请重新分析这道错题：\n\n${ocrText}` };
      } else {
        console.error(`[Reanalyze] question=${questionId} 无图片路径且无OCR文本`);
        await runAndSave("UPDATE questions SET status='error', error_reason=? WHERE id=?", ["无图片路径且无OCR文本", questionId]);
        return;
      }
    }

    const rModel = answerOnly
      ? (await loadSetting("text_model", "TEXT_MODEL") || "qwen-plus")
      : (await loadSetting("vision_model", "DASHSCOPE_MODEL") || "qwen-vl-plus");
    console.log(`[Reanalyze] question=${questionId} mode=${answerOnly ? "answer" : "full"} model=${rModel}`);

    // 统一走 aiFetch：限流(429)自动退避重试 + 多 key 自动轮换 + DashScope 备用通道
    const endpoints = answerOnly
      ? await getTextEndpoints(rModel)
      : await getVisionEndpoints(rModel);
    const res = await aiFetch({
      label: `Reanalyze[q${questionId}]`,
      endpoints,
      timeoutMs: 300000,
      buildBody: (m) => {
        const body: any = { model: m, max_tokens: 16384, temperature: 0, messages: [systemMsg, userMsg] };
        if (!m.startsWith("deepseek")) body.response_format = { type: "json_object" };
        return body;
      },
    });
    if (!res.ok) {
      const errBody = JSON.stringify(res.json || {}).slice(0, 500);
      console.error(`[Reanalyze] question=${questionId} API error status=${res.status} body=${errBody}`);
      throw new Error(`AI error: ${res.status}`);
    }

    const data = res.json;
    const rawText: string = data.choices?.[0]?.message?.content || "";
    logAiResp(`Reanalyze[q${questionId}/${answerOnly ? "answer" : "full"}]`, rModel, rawText);
    console.log(`[Reanalyze] question=${questionId} 响应长度=${rawText.length} 前200字=${rawText.slice(0, 200)}`);
    // AI 返回空响应时直接报错，不用兜底值假装成功
    if (!rawText || rawText.trim().length === 0) {
      console.error(`[Reanalyze] question=${questionId} AI 返回空响应，完整响应体:`, JSON.stringify(data).slice(0, 500));
      throw new Error("AI 返回空响应（可能被限流或超时）");
    }
    let result: any;
    // Multi-strategy JSON extraction
    const clean = rawText
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?\s*```\s*$/, "")
      .trim();
    try {
      result = JSON.parse(clean);
    } catch {
      try {
        const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
        if (s !== -1 && e !== -1) result = JSON.parse(clean.slice(s, e + 1));
        else throw new Error("no braces");
      } catch {
        // JSON 解析失败：保存原始响应到 ai_raw_response 供排查，标记 error
        console.warn(`[Reanalyze] question=${questionId} JSON parse failed, raw(500字)=${rawText.slice(0, 500)}`);
        await runAndSave(
          `UPDATE questions SET status='error', error_reason='AI响应JSON解析失败', ai_raw_response=? WHERE id=?`,
          [rawText.slice(0, 5000), questionId]
        );
        return;
      }
    }
    console.log(`[Reanalyze] question=${questionId} JSON 解析成功 answer=${result.correctAnswer} solutions=${result.solutions?.length || 0}`);

    // Layer 1: basic sanitize — apply to result in-place
    try {
      if (!answerOnly) {
        // 净化 OCR 文本：去除题号前缀、真题标签、残留手写标记
        const rawOcr = result.ocrText || ocrText || "";
        result.ocrText = sanitizeOcrText(sanitizeLatex(autoWrapMathDelimiters(rawOcr)));
      }
      result.correctAnswer = sanitizeLatex(autoWrapMathDelimiters(result.correctAnswer || ""));
      result.explanation = sanitizeLatex(autoWrapMathDelimiters(result.explanation || ""));
      if (result.solutions) {
        for (const sol of result.solutions) {
          sol.name = sanitizeLatex(autoWrapMathDelimiters(sol.name || ""));
          sol.answer = sanitizeLatex(autoWrapMathDelimiters(sol.answer || ""));
          if (sol.steps) sol.steps = sol.steps.map((s: string) => sanitizeLatex(autoWrapMathDelimiters(s)));
        }
      }
    } catch { /* Layer 1 is best-effort, proceed with raw result */ }

    // 答案一致性校验：若 correctAnswer 与 explanation/solutions 不一致，以解析为准修正
    try {
      await reconcileAnswerWithAI(result, apiKey);
    } catch (err) {
      console.warn("Reanalyze: answer reconciliation failed:", err);
    }

    // Save to DB first (before risky Layer 2), so we don't lose the AI output
    const difficulty = normalizeDifficulty(result.difficulty);
    // 后端兜底题型判定：选择题必须有选项，填空/综合/解答相互纠错
    const inferredType = inferQuestionType(result.ocrText || "", result.questionType || "single_choice");
    if (answerOnly) {
      await runAndSave(
        `UPDATE questions SET correct_answer=?, explanation=?, ai_solutions=?, difficulty=?, status='ready', error_reason=NULL WHERE id=?`,
        [result.correctAnswer, result.explanation, JSON.stringify(result.solutions || []), difficulty, questionId]
      );
    } else {
      await runAndSave(
        `UPDATE questions SET ocr_text=?, question_type=?, correct_answer=?, explanation=?, ai_solutions=?, difficulty=?, status='ready', error_reason=NULL WHERE id=?`,
        [result.ocrText, inferredType, result.correctAnswer, result.explanation, JSON.stringify(result.solutions || []), difficulty, questionId]
      );
    }

    // Layer 2: AI LaTeX fix — best-effort, update DB again if successful
    try {
      const fields: Record<string, string> = {};
      // 跳过含代码块/表格的 ocrText — 结构化图片描述不应被 LaTeX fixer AI 修改或破坏
      if (!answerOnly && result.ocrText && !result.ocrText.includes("```") && !result.ocrText.includes("|---|")) {
        fields["ocrText"] = result.ocrText;
      }
      if (result.correctAnswer) fields["correctAnswer"] = result.correctAnswer;
      if (result.explanation) fields["explanation"] = result.explanation;
      if (result.solutions) {
        for (let i = 0; i < result.solutions.length; i++) {
          const sol = result.solutions[i];
          if (sol.name) fields[`sol_${i}_name`] = sol.name;
          if (sol.answer) fields[`sol_${i}_answer`] = sol.answer;
          if (sol.steps) {
            for (let j = 0; j < sol.steps.length; j++)
              if (sol.steps[j]) fields[`sol_${i}_step_${j}`] = sol.steps[j];
          }
        }
      }
      const fixed = await fixLatexWithAI(fields, apiKey);

      if (!answerOnly && fixed["ocrText"]) result.ocrText = fixed["ocrText"];
      if (fixed["correctAnswer"]) result.correctAnswer = fixed["correctAnswer"];
      if (fixed["explanation"]) result.explanation = fixed["explanation"];
      if (result.solutions) {
        for (let i = 0; i < result.solutions.length; i++) {
          if (fixed[`sol_${i}_name`]) result.solutions[i].name = fixed[`sol_${i}_name`];
          if (fixed[`sol_${i}_answer`]) result.solutions[i].answer = fixed[`sol_${i}_answer`];
          if (result.solutions[i].steps) {
            for (let j = 0; j < result.solutions[i].steps.length; j++)
              if (fixed[`sol_${i}_step_${j}`]) result.solutions[i].steps[j] = fixed[`sol_${i}_step_${j}`];
          }
        }
      }

      // Layer 3: final sanitize after fix
      try {
        if (!answerOnly) result.ocrText = sanitizeLatex(result.ocrText || "");
        result.correctAnswer = sanitizeLatex(result.correctAnswer || "");
        result.explanation = sanitizeLatex(result.explanation || "");
        if (result.solutions) {
          for (const sol of result.solutions) {
            sol.name = sanitizeLatex(sol.name || "");
            sol.answer = sanitizeLatex(sol.answer || "");
            if (sol.steps) sol.steps = sol.steps.map(sanitizeLatex);
          }
        }
      } catch { /* Layer 3 is best-effort */ }

      // Re-save with fixed LaTeX
      if (answerOnly) {
        await runAndSave(
          `UPDATE questions SET correct_answer=?, explanation=?, ai_solutions=?, difficulty=? WHERE id=?`,
          [result.correctAnswer, result.explanation, JSON.stringify(result.solutions || []), difficulty, questionId]
        );
      } else {
        await runAndSave(
          `UPDATE questions SET ocr_text=?, question_type=?, correct_answer=?, explanation=?, ai_solutions=?, difficulty=? WHERE id=?`,
          [result.ocrText, inferredType, result.correctAnswer, result.explanation, JSON.stringify(result.solutions || []), difficulty, questionId]
        );
      }
    } catch { /* Layer 2 failed — DB already saved with raw result, that's fine */ }

    console.log(`Reanalyze OK: question ${questionId} mode=${answerOnly ? "answer" : "full"}`);
  } catch (err) {
    console.error(`[Reanalyze] question=${questionId} background error:`, err instanceof Error ? err.message : err);
    const errMsg = err instanceof Error ? err.message : String(err);
    // 429 限流错误：不标记 error，重新抛出让队列等待后重试
    if (errMsg.includes("429") || errMsg.includes("1302") || errMsg.includes("rate limit") || errMsg.includes("限流") || errMsg.includes("频率")) {
      console.warn(`[Reanalyze] question=${questionId} 触发限流(429)，不标记 error，让队列等待后重试`);
      throw err;
    }
    await runAndSave("UPDATE questions SET status='error', error_reason=? WHERE id=?", [errMsg.slice(0, 200), questionId]);
  }
}

export async function POST(req: NextRequest) {
  await initSchema();
  const { question_id, mode, reason } = await req.json();
  const isAnswerOnly = mode === "answer";
  if (!question_id) {
    return NextResponse.json({ error: "question_id required" }, { status: 400 });
  }

  const q = await queryOne<{ ocr_text: string; image_path: string | null; id: number }>(
    "SELECT id, ocr_text, image_path FROM questions WHERE id=?", [question_id]
  );
  if (!q) return NextResponse.json({ error: "question not found" }, { status: 404 });

  const apiKey = await loadSetting("vision_key", "DASHSCOPE_API_KEY") || await loadSetting("text_key", "DEEPSEEK_API_KEY");
  if (!apiKey) return NextResponse.json({ error: "API key 未配置" }, { status: 500 });

  // Set status to pending, clear old error_reason
  await runAndSave("UPDATE questions SET status='pending', error_reason=NULL WHERE id=?", [q.id]);
  console.log(`[Reanalyze] question=${q.id} 入队 mode=${isAnswerOnly ? "answer" : "full"} reason=${reason || "(无)"}`);

  // 重解析任务进入队列：最多并发 2 个，每题完成后等待 1s 再继续
  enqueue(async () => {
    await processReanalyze(q.id, q.ocr_text, q.image_path, apiKey, isAnswerOnly, reason);
  }, `reanalyze-q${q.id}`).catch(async err => {
    console.error(`[Reanalyze] question=${q.id} queue error:`, err instanceof Error ? err.message : err);
    await runAndSave("UPDATE questions SET status='error', error_reason=? WHERE id=?", [String(err).slice(0, 200), q.id]);
  });

  return NextResponse.json({ ok: true });
}
