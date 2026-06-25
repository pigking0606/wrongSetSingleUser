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

  const q = queryOne<{ id: number; image_path: string; user_answer: string | null }>(
    "SELECT id, image_path, user_answer FROM questions WHERE id=?", [questionId]
  );
  if (!q) {
    console.error("performAnalysis: question not found", questionId);
    return null;
  }

  const imgPath = join(process.cwd(), "public", q.image_path);
  if (!existsSync(imgPath)) {
    runAndSave("UPDATE questions SET status='error', ocr_text='图片文件丢失' WHERE id=?", [questionId]);
    return null;
  }

  const imgBuffer = readFileSync(imgPath);
  const base64 = imgBuffer.toString("base64");
  const ext = q.image_path.split(".").pop()?.toLowerCase() || "jpg";
  const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

  const chapterTree = queryAll<{ id: number; name: string; level: number; parent_id: number | null }>(
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

    runAndSave(
      `UPDATE questions SET chapter_id=?, ocr_text=?, question_type=?, correct_answer=?, explanation=?, ai_solutions=?, status='ready' WHERE id=?`,
      [cls.knowledge_point_id, ocrText, result.questionType, correctAnswer, explanation, JSON.stringify(solutions), questionId]
    );

    return cls;
  } catch (err) {
    console.error("performAnalysis error for question", questionId, err);
    const errMsg = err instanceof Error ? err.message : "AI 分析失败";
    runAndSave("UPDATE questions SET status='error', ocr_text=? WHERE id=?", [errMsg.slice(0, 200), questionId]);
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

  let s = l1.find(c => c.name === cls.subject) || l1.find(c => cls.subject.includes(c.name) || c.name.includes(cls.subject)) || l1[0]!;
  let ch = l2.find(c => c.parent_id === s.id && c.name === cls.chapter) || l2.find(c => c.parent_id === s.id && c.name.includes(cls.chapter.substring(0, 4))) || l2.filter(c => c.parent_id === s.id)[0]!;
  let kp = l3.find(c => c.parent_id === ch.id && c.name === cls.knowledgePoint) || l3.find(c => c.parent_id === ch.id && c.name.includes(cls.knowledgePoint.substring(0, 4))) || l3.filter(c => c.parent_id === ch.id)[0]!;

  return { subject_id: s.id, subject: s.name, chapter_id: ch.id, chapter: ch.name, knowledge_point_id: kp.id, knowledge_point: kp.name };
}
