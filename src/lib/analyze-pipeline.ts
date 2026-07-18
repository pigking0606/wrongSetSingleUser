import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { analyzeWrongAnswerImage, autoWrapMathDelimiters } from "@/lib/ai";
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

  const q = await queryOne<{ id: number; image_path: string; user_answer: string | null }>(
    "SELECT id, image_path, user_answer FROM questions WHERE id=?", [questionId]
  );
  if (!q) {
    console.error("performAnalysis: question not found", questionId);
    return null;
  }

  const imgPath = join(process.cwd(), "public", q.image_path);
  if (!existsSync(imgPath)) {
    await runAndSave("UPDATE questions SET status='error', ocr_text='图片文件丢失' WHERE id=?", [questionId]);
    return null;
  }

  const imgBuffer = readFileSync(imgPath);
  const base64 = imgBuffer.toString("base64");
  const ext = q.image_path.split(".").pop()?.toLowerCase() || "jpg";
  const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

  const chapterTree = await queryAll<{ id: number; name: string; level: number; parent_id: number | null }>(
    "SELECT id, name, level, parent_id FROM chapters ORDER BY level, id"
  );

  try {
    const result = await analyzeWrongAnswerImage(base64, mimeType, chapterTree, q.user_answer || undefined);

    const ocrText = autoWrapMathDelimiters(result.ocrText);
    const correctAnswer = autoWrapMathDelimiters(result.correctAnswer);
    const explanation = autoWrapMathDelimiters(result.explanation);
    const solutions = (result.solutions || []).map(s => ({
      ...s,
      answer: autoWrapMathDelimiters(s.answer),
      steps: s.steps.map(autoWrapMathDelimiters),
    }));

    const cls = matchChapters(chapterTree, result.classification);

    // 修复：所有字符串字段兜底为 ""，防止 undefined 传给 SQL 报 "Bind parameters must not contain undefined"
    // 根因：agnes-2.0-flash 思考外溢时 JSON 可能缺字段或字段值为 undefined
    const safeOcr = ocrText || "";
    const safeAnswer = correctAnswer || "";
    const safeExpl = explanation || "";
    const safeSolutions = JSON.stringify(solutions || []);
    const safeType = result.questionType || "single_choice";

    runAndSave(
      `UPDATE questions SET chapter_id=?, ocr_text=?, question_type=?, correct_answer=?, explanation=?, ai_solutions=?, status='ready' WHERE id=?`,
      [cls.knowledge_point_id, safeOcr, safeType, safeAnswer, safeExpl, safeSolutions, questionId]
    ).catch(err => console.error("Failed to save AI analysis for question", questionId, err));

    return cls;
  } catch (err) {
    console.error("performAnalysis error for question", questionId, err);
    const errMsg = err instanceof Error ? err.message : "AI 分析失败";
    runAndSave("UPDATE questions SET status='error', ocr_text=? WHERE id=?", [errMsg.slice(0, 200), questionId])
      .catch(e => console.error("Failed to save error status for question", questionId, e));
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
