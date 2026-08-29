import { join } from "path";
import { analyzeImageTwoStep, autoWrapMathDelimiters, normalizeDifficulty, AiAnalysisResult } from "@/lib/ai";
import { queryOne, queryAll, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";

export interface ClassificationResult {
  subject_id: number;
  subject: string;
  chapter_id: number;
  chapter: string;
  knowledge_point_id: number;
  knowledge_point: string;
}

export async function performAnalysis(questionId: number): Promise<ClassificationResult | null> {
  await initSchema();

  const q = await queryOne<{ id: number; image_path: string; user_answer: string | null; bank_id: number | null }>(
    "SELECT id, image_path, user_answer, bank_id FROM questions WHERE id=?", [questionId]
  );
  if (!q) {
    console.error("performAnalysis: question not found", questionId);
    return null;
  }

  const imageUrl = q.image_path.startsWith("http") ? q.image_path : `${join(process.cwd(), "public", q.image_path)}`;
  const imgResp = await fetch(imageUrl);
  if (!imgResp.ok) {
    await runAndSave("UPDATE questions SET status='error', error_reason='图片无法访问' WHERE id=?", [questionId]);
    return null;
  }
  const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
  const base64 = imgBuffer.toString("base64");
  const ext = q.image_path.split(".").pop()?.toLowerCase() || "jpg";
  const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

  const chapterTree = await queryAll<{ id: number; name: string; level: number; parent_id: number | null }>(
    "SELECT id, name, level, parent_id FROM chapters ORDER BY level, id"
  );

  // 查询题库名称作为分类辅助依据（题库名称通常反映题目类别，如"660题"、"真题"等）
  let bankName: string | null = null;
  if (q.bank_id) {
    const bank = await queryOne<{ name: string }>("SELECT name FROM banks WHERE id=?", [q.bank_id]);
    bankName = bank?.name || null;
  }

  try {
    let result: AiAnalysisResult;
    try {
      // 新版两步拆分：视觉模型做 OCR+分类 → 文本模型做答案+解析
      console.log(`[performAnalysis] question=${questionId} 开始分析 imageBytes=${imgBuffer.length} bank=${bankName || "(无)"}`);
      result = await analyzeImageTwoStep(base64, mimeType, chapterTree, q.user_answer || undefined, bankName || undefined);
      console.log(`[performAnalysis] question=${questionId} 分析完成 ocrText长度=${(result.ocrText || "").length} answer=${result.correctAnswer} error_reason=${result.error_reason || "(无)"}`);
    } catch (err) {
      // 兜底：两步中任意一步失败，都进入错误流程，记录错误原因
      console.error(`[performAnalysis] question=${questionId} analyzeImageTwoStep failed:`, err instanceof Error ? err.message : err);
      throw err;
    }

    // analyzeImageTwoStep 已对 ocrText 做过 autoWrapMathDelimiters + sanitizeLatex 处理
    // 此处不再重复调用 autoWrapMathDelimiters，避免破坏代码块（```...```）和表格结构
    const ocrText = result.ocrText || "";
    const correctAnswer = autoWrapMathDelimiters(result.correctAnswer || "");
    const explanation = autoWrapMathDelimiters(result.explanation || "");
    const solutions = (result.solutions || []).map(s => ({
      ...s,
      answer: autoWrapMathDelimiters(s.answer || ""),
      steps: (s.steps || []).map(st => autoWrapMathDelimiters(st || "")),
    }));

    const cls = matchChapters(chapterTree, result.classification);

    // 兜底：所有字符串字段为 ""，防止 undefined 传给 SQL 报 "Bind parameters must not contain undefined"
    const safeOcr = ocrText || "";
    const safeAnswer = correctAnswer || "";
    const safeExpl = explanation || "";
    const safeSolutions = JSON.stringify(solutions || []);
    const safeType = result.questionType || "single_choice";
    const difficulty = normalizeDifficulty(result.difficulty);

    // 第二步失败但第一步成功：保留 OCR 入库，标记 error_reason 供前端触发重解析
    // 第一步+第二步都成功：正常入库
    if (result.error_reason) {
      console.warn("[performAnalysis] Step 2 failed for question", questionId, "— saving OCR only:", result.error_reason);
      await runAndSave(
        `UPDATE questions SET chapter_id=?, ocr_text=?, question_type=?, correct_answer=?, explanation=?, ai_solutions=?, difficulty=?, status='error', error_reason=? WHERE id=?`,
        [cls.knowledge_point_id, safeOcr, safeType, safeAnswer, safeExpl, safeSolutions, difficulty, result.error_reason.slice(0, 200), questionId]
      );
    } else {
      // OCR 文本为空但答案/解析非空：说明 OCR 步骤异常（含图题目可能 JSON 解析失败）
      // 记录警告便于排查，但仍入库（答案/解析有效）
      if (!safeOcr && (safeAnswer || safeExpl)) {
        console.warn("[performAnalysis] question", questionId, "— OCR text is empty but answer/explanation exist (likely image-heavy question OCR failed)");
      }
      await runAndSave(
        `UPDATE questions SET chapter_id=?, ocr_text=?, question_type=?, correct_answer=?, explanation=?, ai_solutions=?, difficulty=?, status='ready', error_reason=NULL WHERE id=?`,
        [cls.knowledge_point_id, safeOcr, safeType, safeAnswer, safeExpl, safeSolutions, difficulty, questionId]
      );
    }

    return cls;
  } catch (err) {
    console.error(`[performAnalysis] question=${questionId} error:`, err instanceof Error ? err.message : err);
    const errMsg = err instanceof Error ? err.message : "AI 分析失败";
    // 429 限流错误：不保存 "error" 状态（避免覆盖已有 OCR 数据），重新抛出让队列重试
    if (errMsg.includes("429") || errMsg.includes("1302") || errMsg.includes("rate limit") || errMsg.includes("限流") || errMsg.includes("频率")) {
      console.warn(`[performAnalysis] question=${questionId} 触发限流(429)，不标记 error，让队列等待后重试`);
      throw err;
    }
    await runAndSave("UPDATE questions SET status='error', error_reason=? WHERE id=?", [errMsg.slice(0, 200), questionId]);
    return null;
  }
}

function matchChapters(
  allChapters: Array<{ id: number; name: string; level: number; parent_id: number | null }>,
  cls: { subject: string; chapter: string; knowledgePoint: string }
): ClassificationResult {
  const l1 = allChapters.filter(c => c.level === 1);
  const l2 = allChapters.filter(c => c.level === 2);
  const l3 = allChapters.filter(c => c.level === 3);

  // Normalize: remove whitespace, parentheses variations
  const norm = (s: string) => s.replace(/\s+/g, "").replace(/[（(]/g, "(").replace(/[）)]/g, ")");

  // Step 1: Match subject — exact first, then fuzzy
  let s = l1.find(c => c.name === cls.subject)
    || l1.find(c => norm(c.name) === norm(cls.subject))
    || l1.find(c => cls.subject.includes(c.name) || c.name.includes(cls.subject));

  // If subject not found, try keyword matching
  if (!s) {
    if (cls.subject.includes("408") || cls.subject.includes("计算机") || cls.subject.includes("数据结构") || cls.subject.includes("计组") || cls.subject.includes("操作系统") || cls.subject.includes("网络")) {
      s = l1.find(c => c.name === "408")!;
    } else if (cls.subject.includes("数学") || cls.subject.includes("高数") || cls.subject.includes("线代")) {
      s = l1.find(c => c.name === "数学二")!;
    } else if (cls.subject.includes("英语")) {
      s = l1.find(c => c.name === "英语二")!;
    } else if (cls.subject.includes("政治") || cls.subject.includes("马原") || cls.subject.includes("毛中特") || cls.subject.includes("史纲") || cls.subject.includes("思修") || cls.subject.includes("时政")) {
      s = l1.find(c => c.name === "政治")!;
    }
  }

  // Fallback
  if (!s) s = l1[0]!;

  // Step 2: Match chapter under subject — exact first, then fuzzy substring overlap
  let ch = l2.find(c => c.parent_id === s.id && c.name === cls.chapter)
    || l2.find(c => c.parent_id === s.id && norm(c.name) === norm(cls.chapter));

  if (!ch) {
    const candidates = l2.filter(c => c.parent_id === s.id);
    let best = 0;
    for (const c of candidates) {
      const overlap = [...cls.chapter].filter(ch0 => c.name.includes(ch0)).length;
      const score = overlap / Math.max(c.name.length, cls.chapter.length);
      if (score > best) { best = score; ch = c; }
    }
    // Fallback: pick first chapter under subject if no good match
    if (best < 0.15) ch = l2.filter(c => c.parent_id === s.id)[0]!;
  }

  if (!ch) ch = l2.filter(c => c.parent_id === s.id)[0]!;

  // Step 3: Match knowledge point under chapter — same fuzzy logic
  let kp = l3.find(c => c.parent_id === ch!.id && c.name === cls.knowledgePoint)
    || l3.find(c => c.parent_id === ch!.id && norm(c.name) === norm(cls.knowledgePoint));

  if (!kp) {
    const candidates = l3.filter(c => c.parent_id === ch!.id);
    let best = 0;
    for (const c of candidates) {
      const overlap = [...cls.knowledgePoint].filter(ch0 => c.name.includes(ch0)).length;
      const score = overlap / Math.max(c.name.length, cls.knowledgePoint.length);
      if (score > best) { best = score; kp = c; }
    }
    if (best < 0.15) kp = l3.filter(c => c.parent_id === ch!.id)[0]!;
  }

  if (!kp) kp = l3.filter(c => c.parent_id === ch!.id)[0]!;

  return { subject_id: s!.id, subject: s!.name, chapter_id: ch!.id, chapter: ch!.name, knowledge_point_id: kp!.id, knowledge_point: kp!.name };
}
