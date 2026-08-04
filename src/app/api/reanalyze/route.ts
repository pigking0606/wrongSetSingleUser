import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { queryOne, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";
import { autoWrapMathDelimiters, sanitizeLatex, sanitizeOcrText, fixLatexWithAI, reconcileAnswerWithAI } from "@/lib/ai";
import { enqueue } from "@/lib/analysis-queue";

import { decrypt } from "@/lib/crypto-utils";
async function loadSetting(key: string, envFallback = "") {
  try {
    const row = await queryOne<{ value: string }>("SELECT value FROM settings WHERE `key`=?", [key]);
    if (row?.value) return decrypt(row.value);
  } catch { /* */ }
  return process.env[envFallback] || "";
}

async function getReanalyzeUrl(model: string, isText: boolean) {
  const custom = await loadSetting(isText ? "text_url" : "vision_url");
  if (custom) return custom.replace(/\/+$/, "") + "/chat/completions";
  if (model.startsWith("deepseek")) return "https://api.deepseek.com/v1/chat/completions";
  return "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
}

const REANALYZE_PROMPT = `你是考研命题专家。请重新分析以下题目，严格返回纯JSON：

{
  "ocrText": "净化后的题干",
  "questionType": "single_choice|multiple_choice|true_false|fill_blank|short_answer|comprehensive",
  "correctAnswer": "正确答案",
  "explanation": "解析（100-200字）",
  "solutions": [{"name":"解法（含适用场景/技巧标注）","steps":["..."],"answer":"..."}],
  "confidence": 0.95
}

【考研数学适配性要求（数学题必须遵守）】
- 解法必须符合考研数学大纲范围，禁止使用超纲方法（如数学二不考概率统计、级数等内容）
- 优先使用考研通用教材中的标准方法和符号体系
- 解题步骤的深度和严谨度应匹配考研要求：关键步骤不可跳过，中间结论需有依据
- 若题目有多种解法，优先给出考研考场最实用的方法（计算量小、不易出错、适用面广）

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
- **含图的题目（数据结构图/网络拓扑图/AOE图/有向图/无向图/二叉树等）必须用结构化文字完整描述图**：
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

const REANALYZE_ANSWER_PROMPT = `你是考研命题专家。请根据已有题干OCR文本重新生成答案解析，严格返回纯JSON：

{
  "correctAnswer": "正确答案",
  "explanation": "解析（100-200字）",
  "solutions": [{"name":"解法（含适用场景/技巧标注）","steps":["..."],"answer":"..."}],
  "confidence": 0.95
}

注意：不要输出ocrText字段，只更新correctAnswer、explanation和solutions。

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
        const imgFullPath = join(process.cwd(), "public", imagePath);
        if (existsSync(imgFullPath)) {
          const imgBuffer = readFileSync(imgFullPath);
          const base64 = imgBuffer.toString("base64");
          const ext = imagePath.split(".").pop()?.toLowerCase() || "jpg";
          const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
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
            console.error("Reanalyze: no image file and no ocr text for question", questionId);
            runAndSave("UPDATE questions SET status='error', error_reason=? WHERE id=?", ["图片文件丢失且无OCR文本", questionId]);
            return;
          }
        }
      } else if (ocrText && ocrText.length > 5) {
        userMsg = { role: "user" as const, content: `请重新分析这道错题：\n\n${ocrText}` };
      } else {
        console.error("Reanalyze: no image and no ocr text for question", questionId);
        runAndSave("UPDATE questions SET status='error', error_reason=? WHERE id=?", ["无图片路径且无OCR文本", questionId]);
        return;
      }
    }

    const rModel = answerOnly
      ? (await loadSetting("text_model", "TEXT_MODEL") || "qwen-plus")
      : (await loadSetting("vision_model", "DASHSCOPE_MODEL") || "qwen-vl-plus");
    const rApiKey = rModel.startsWith("deepseek")
      ? (await loadSetting("text_key", "DEEPSEEK_API_KEY") || apiKey)
      : (await loadSetting("vision_key", "DASHSCOPE_API_KEY") || apiKey);
    const rBody: any = { model: rModel, max_tokens: 8192, temperature: 0, messages: [systemMsg, userMsg] };
    if (!rModel.startsWith("deepseek")) rBody.response_format = { type: "json_object" };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);

    let resp: any;
    try {
      resp = await fetch(await getReanalyzeUrl(rModel, answerOnly), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${rApiKey}` },
        body: JSON.stringify(rBody),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!resp.ok) throw new Error(`AI error: ${resp.status}`);

    const data = await resp.json();
    const rawText: string = data.choices?.[0]?.message?.content || "";
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
        // Last resort: build a minimal result from raw text
        console.warn(`Reanalyze: JSON parse failed for question ${questionId}, raw: ${rawText.slice(0, 200)}`);
        result = {
          ocrText: ocrText || rawText.slice(0, 500),
          questionType: "single_choice",
          correctAnswer: "",
          explanation: rawText.slice(0, 500),
          solutions: [],
          confidence: 0.5,
        };
      }
    }

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
    if (answerOnly) {
      await runAndSave(
        `UPDATE questions SET correct_answer=?, explanation=?, ai_solutions=?, status='ready', error_reason=NULL WHERE id=?`,
        [result.correctAnswer, result.explanation, JSON.stringify(result.solutions || []), questionId]
      );
    } else {
      await runAndSave(
        `UPDATE questions SET ocr_text=?, question_type=?, correct_answer=?, explanation=?, ai_solutions=?, status='ready', error_reason=NULL WHERE id=?`,
        [result.ocrText, result.questionType || "single_choice", result.correctAnswer, result.explanation, JSON.stringify(result.solutions || []), questionId]
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
          `UPDATE questions SET correct_answer=?, explanation=?, ai_solutions=? WHERE id=?`,
          [result.correctAnswer, result.explanation, JSON.stringify(result.solutions || []), questionId]
        );
      } else {
        await runAndSave(
          `UPDATE questions SET ocr_text=?, question_type=?, correct_answer=?, explanation=?, ai_solutions=? WHERE id=?`,
          [result.ocrText, result.questionType || "single_choice", result.correctAnswer, result.explanation, JSON.stringify(result.solutions || []), questionId]
        );
      }
    } catch { /* Layer 2 failed — DB already saved with raw result, that's fine */ }

    console.log(`Reanalyze OK: question ${questionId} mode=${answerOnly ? "answer" : "full"}`);
  } catch (err) {
    console.error("Reanalyze background error:", err);
    const errMsg = err instanceof Error ? err.message : String(err);
    runAndSave("UPDATE questions SET status='error', error_reason=? WHERE id=?", [errMsg.slice(0, 200), questionId]);
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
  runAndSave("UPDATE questions SET status='pending', error_reason=NULL WHERE id=?", [q.id]);

  // 重解析任务进入队列：最多并发 2 个，每题完成后等待 1s 再继续
  enqueue(async () => {
    await processReanalyze(q.id, q.ocr_text, q.image_path, apiKey, isAnswerOnly, reason);
  }).catch(err => {
    console.error("Reanalyze failed:", err);
    runAndSave("UPDATE questions SET status='error', error_reason=? WHERE id=?", [String(err).slice(0, 200), q.id]);
  });

  return NextResponse.json({ ok: true });
}
