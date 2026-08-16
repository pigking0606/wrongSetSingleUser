import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db";
import { initSchema } from "@/lib/schema";

// GET /api/exam-paper?bank_id=1,2&subject_id=2&chapter_l2_id=5&chapter_id=9
// 错题拼好卷：系统从错题中自动选样，按考研试卷结构与难度比例拼卷。
//   - 考研卷结构（满分150）：选择题 10×5、填空题 6×5、解答题 6×~11.7（共70）
//   - 难度比例（易:中:难 = 3:5:2，即 30%:50%:20%）对应 difficulty 1-2 / 3 / 4-5
//   - 跨章节轮询抽样，保证知识点分布均匀；错题不足时按实际可用数量生成
//   - bank_id 支持逗号分隔多题库（如 bank_id=1,2,3）
interface PaperQuestion {
  id: number; ocr_text: string; chapter_id: number | null;
  correct_answer: string; explanation: string | null;
  ai_solutions: string | null; user_answer: string | null;
  question_type: string; image_path: string | null;
  difficulty: number;
  kp_name: string | null; chapter_name: string | null; subject_name: string | null;
}

const SECTIONS = [
  { type: "choice", label: "一、选择题", qTypes: ["single_choice", "multiple_choice", "true_false"], scorePerQ: 5, target: 10 },
  { type: "fill", label: "二、填空题", qTypes: ["fill_blank"], scorePerQ: 5, target: 6 },
  { type: "solve", label: "三、解答题", qTypes: ["short_answer", "comprehensive"], scorePerQ: 70 / 6, target: 6 },
];

const DIFF_LEVELS = [
  { key: "easy", label: "易", min: 1, max: 2, ratio: 0.3 },
  { key: "medium", label: "中", min: 3, max: 3, ratio: 0.5 },
  { key: "hard", label: "难", min: 4, max: 5, ratio: 0.2 },
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 跨章节轮询随机抽样，保证知识点分布大体均匀（与复习选题规则一致）
function sampleByChapter(questions: PaperQuestion[], count: number): PaperQuestion[] {
  if (count <= 0 || questions.length === 0) return [];
  const byChapter = new Map<number | null, PaperQuestion[]>();
  for (const q of questions) {
    const key = q.chapter_id;
    const arr = byChapter.get(key) || [];
    arr.push(q);
    byChapter.set(key, arr);
  }
  const groups = Array.from(byChapter.values());
  groups.forEach(g => shuffle(g));
  const selected: PaperQuestion[] = [];
  while (selected.length < count && groups.some(g => g.length > 0)) {
    for (const g of groups) {
      if (g.length > 0 && selected.length < count) {
        selected.push(g.shift()!);
      }
    }
  }
  return selected;
}

// 按考研难度比例（易:中:难 = 3:5:2）抽样；某难度不足时用其他难度补齐
function sampleByDifficulty(questions: PaperQuestion[], count: number): PaperQuestion[] {
  if (count <= 0 || questions.length === 0) return [];
  const groups: Record<string, PaperQuestion[]> = { easy: [], medium: [], hard: [] };
  for (const q of questions) {
    const d = q.difficulty || 3;
    if (d <= 2) groups.easy.push(q);
    else if (d === 3) groups.medium.push(q);
    else groups.hard.push(q);
  }

  let targets = DIFF_LEVELS.map(l => Math.round(count * l.ratio));
  let sum = targets.reduce((a, b) => a + b, 0);
  let diff = count - sum;
  if (diff !== 0) {
    targets[2] += diff; // 余量调整到难题组（难题池通常最充足）
    if (targets[2] < 0) { targets[1] += targets[2]; targets[2] = 0; }
  }

  const selected: PaperQuestion[] = [];
  for (let i = 0; i < DIFF_LEVELS.length; i++) {
    const level = DIFF_LEVELS[i];
    const pool = groups[level.key];
    const need = Math.min(targets[i], pool.length);
    selected.push(...sampleByChapter(pool, need));
  }

  // 总量不足时，从剩余题目补足
  if (selected.length < count) {
    const usedIds = new Set(selected.map(q => q.id));
    const rest = shuffle(questions.filter(q => !usedIds.has(q.id)));
    for (const q of rest) {
      if (selected.length >= count) break;
      selected.push(q);
    }
  }
  return selected;
}

export async function GET(req: NextRequest) {
  await initSchema();
  const { searchParams } = new URL(req.url);
  const bankId = searchParams.get("bank_id");
  const subjectId = searchParams.get("subject_id");
  const chapterL2Id = searchParams.get("chapter_l2_id");
  const chapterId = searchParams.get("chapter_id");

  const conditions: string[] = [];
  const params: (string | number)[] = [];
  // 拼卷仅支持单科目：必须选择科目，禁止跨科目补全（未选科目直接拒绝）
  if (!subjectId) {
    return NextResponse.json({ error: "请先选择科目（拼卷仅支持单科目生成）" }, { status: 400 });
  }
  // 错题判定：用户作答且与正确答案不同，或复习记录中标记为错（score<=1）
  conditions.push(`(q.user_answer IS NOT NULL AND q.user_answer != q.correct_answer)
    OR EXISTS (SELECT 1 FROM review_records rr WHERE rr.question_id = q.id AND rr.score <= 1)`);
  conditions.push("(q.status IS NULL OR q.status = 'ready')");
  if (bankId) {
    const ids = bankId.split(",").map(s => parseInt(s.trim())).filter(n => Number.isFinite(n));
    if (ids.length > 0) {
      conditions.push(`q.bank_id IN (${ids.map(() => "?").join(",")})`);
      params.push(...ids);
    }
  }
  if (subjectId) { conditions.push("c1.id = ?"); params.push(parseInt(subjectId)); }
  if (chapterL2Id) { conditions.push("c2.id = ?"); params.push(parseInt(chapterL2Id)); }
  if (chapterId) { conditions.push("c3.id = ?"); params.push(parseInt(chapterId)); }

  const rows = await queryAll<PaperQuestion>(
    `SELECT q.id, q.ocr_text, q.chapter_id, q.correct_answer, q.explanation,
       q.ai_solutions, q.user_answer, q.question_type, q.image_path,
       COALESCE(q.difficulty, 3) AS difficulty,
       c3.name AS kp_name, c2.name AS chapter_name, c1.name AS subject_name
     FROM questions q
     LEFT JOIN chapters c3 ON q.chapter_id = c3.id
     LEFT JOIN chapters c2 ON c3.parent_id = c2.id
     LEFT JOIN chapters c1 ON c2.parent_id = c1.id
     WHERE ${conditions.join(" AND ")}
     ORDER BY RAND()`,
    params
  );

  if (rows.length === 0) {
    return NextResponse.json({ sections: [], total: 0, totalScore: 0, hasEnough: false });
  }

  const resultSections = SECTIONS.map(section => {
    const pool = rows.filter(q => section.qTypes.includes(q.question_type));
    const count = Math.min(section.target, pool.length);
    const questions = sampleByDifficulty(pool, count);
    return {
      type: section.type,
      label: section.label,
      scorePerQ: section.scorePerQ,
      target: section.target,
      count: questions.length,
      questions,
    };
  });

  const totalCount = resultSections.reduce((a, s) => a + s.count, 0);
  const totalScore = resultSections.reduce((a, s) => a + s.count * s.scorePerQ, 0);

  return NextResponse.json({
    sections: resultSections,
    total: totalCount,
    totalScore: Math.round(totalScore),
    hasEnough: totalCount >= 10,
  });
}
