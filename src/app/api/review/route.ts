import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryOne, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";
import { calcNextReview } from "@/lib/ebbinghaus";

// GET /api/review?limit=10&subject_id=1&chapter_l2_id=5&bank_id=1
// 选题规则：
//   1. 优先取到期题目（next_review_date IS NULL OR <= today）
//   2. 若到期题目不足 limit，补充即将到期题目（next_review_date <= today+3天）
//   3. 排除"连续正确3次且最近一次在10天内"的题目（已掌握，短期无需复习）
//   4. 优先选择复习次数少的题目（review_count ASC）
//   5. 跨章节/知识点大体平均分布（按 chapter_id 轮询抽样，避免集中在同一知识点）
export async function GET(req: NextRequest) {
  await initSchema();
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") || "10");
  const subjectId = searchParams.get("subject_id");
  const chapterL2Id = searchParams.get("chapter_l2_id");
  const chapterId = searchParams.get("chapter_id");
  const bankId = searchParams.get("bank_id");

  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  // 用 setDate 计算 +3 天，避免 getDate()+3 在月末/年底产生如 "2026-08-34" 的无效日期
  const plus3 = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3);
  const todayPlus3 = `${plus3.getFullYear()}-${String(plus3.getMonth()+1).padStart(2,"0")}-${String(plus3.getDate()).padStart(2,"0")}`;
  const conditions: string[] = [];
  const condParams: (string | number)[] = [];

  if (subjectId) {
    conditions.push("c1.id = ?");
    condParams.push(parseInt(subjectId));
  }
  if (chapterL2Id) {
    conditions.push("c2.id = ?");
    condParams.push(parseInt(chapterL2Id));
  }
  if (chapterId) {
    conditions.push("c3.id = ?");
    condParams.push(parseInt(chapterId));
  }
  if (bankId) {
    conditions.push("q.bank_id = ?");
    condParams.push(parseInt(bankId));
  }

  const whereClause = conditions.length > 0
    ? `AND ${conditions.join(" AND ")}`
    : "";

  const safeLimit = Math.max(1, Math.floor(limit));

  // 查询到期 + 即将到期题目（含 review_count 用于优先级排序）
  // priority: 0=到期（今日及之前）, 1=即将到期（未来3天内）
  // 排除"连续正确3次且最近一次在10天内"的题目
  const eligibleRows = await queryAll<{
    id: number; chapter_id: number | null; review_count: number; priority: number;
  }>(
    `SELECT q.id, q.chapter_id,
       (SELECT COUNT(*) FROM review_records WHERE question_id = q.id) AS review_count,
       CASE WHEN r.next_review_date IS NULL OR r.next_review_date <= ? THEN 0 ELSE 1 END AS priority
     FROM questions q
     LEFT JOIN chapters c3 ON q.chapter_id = c3.id
     LEFT JOIN chapters c2 ON c3.parent_id = c2.id
     LEFT JOIN chapters c1 ON c2.parent_id = c1.id
     LEFT JOIN (
       SELECT question_id, review_date, next_review_date, ease_factor, interval_days
       FROM review_records
       WHERE id IN (SELECT MAX(id) FROM review_records GROUP BY question_id)
     ) r ON r.question_id = q.id
     LEFT JOIN (
       SELECT question_id,
         CASE WHEN COUNT(*) >= 3
              AND MAX(review_date) >= DATE_SUB(?, INTERVAL 10 DAY)
              AND SUM(CASE WHEN score = 5 THEN 1 ELSE 0 END) = COUNT(*)
              THEN 1 ELSE 0 END AS skip_review
       FROM (
         SELECT question_id, review_date, score,
           ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY id DESC) AS rn
         FROM review_records
       ) ranked
       WHERE rn <= 3
       GROUP BY question_id
     ) skip ON skip.question_id = q.id
     WHERE (r.next_review_date IS NULL OR r.next_review_date <= ?)
       AND (q.status IS NULL OR q.status = 'ready')
       AND NOT (r.next_review_date IS NULL AND date(q.created_at) = ?)
       AND COALESCE(skip.skip_review, 0) = 0
     ${whereClause}
     ORDER BY priority ASC, review_count ASC, RAND()`,
    [today, today, todayPlus3, today, ...condParams]
  );

  if (eligibleRows.length === 0) {
    return NextResponse.json([]);
  }

  // 按 chapter_id 分组，轮询抽样，保证跨知识点大体平均分布
  // 每组内已按 priority ASC, review_count ASC 排序，优先取到期且复习次数少的
  const byChapter = new Map<number | null, typeof eligibleRows>();
  for (const row of eligibleRows) {
    const key = row.chapter_id;
    const arr = byChapter.get(key) || [];
    arr.push(row);
    byChapter.set(key, arr);
  }
  const groups = Array.from(byChapter.values());
  const selectedIds: number[] = [];
  while (selectedIds.length < safeLimit && groups.some(g => g.length > 0)) {
    for (const g of groups) {
      if (g.length > 0 && selectedIds.length < safeLimit) {
        selectedIds.push(g.shift()!.id);
      }
    }
  }

  if (selectedIds.length === 0) {
    return NextResponse.json([]);
  }

  // 取选中题目的完整数据（按 selectedIds 顺序返回）
  const placeholders = selectedIds.map(() => "?").join(",");
  const fullQuestions = await queryAll<{
    id: number; ocr_text: string; chapter_id: number;
    correct_answer: string; explanation: string | null;
    ai_solutions: string | null; user_answer: string | null;
    question_type: string; image_path: string | null;
    last_review_date: string | null; next_review_date: string | null;
    ease_factor: number; interval_days: number; review_count: number;
    kp_name: string | null; chapter_name: string | null; subject_name: string | null;
  }>(
    `SELECT
       q.id, q.ocr_text, q.chapter_id, q.correct_answer, q.explanation,
       q.ai_solutions, q.user_answer, q.question_type, q.image_path,
       r.review_date AS last_review_date, r.next_review_date,
       COALESCE(r.ease_factor, 2.5) AS ease_factor,
       COALESCE(r.interval_days, 0) AS interval_days,
       (SELECT COUNT(*) FROM review_records WHERE question_id = q.id) AS review_count,
       c3.name AS kp_name, c2.name AS chapter_name, c1.name AS subject_name
     FROM questions q
     LEFT JOIN chapters c3 ON q.chapter_id = c3.id
     LEFT JOIN chapters c2 ON c3.parent_id = c2.id
     LEFT JOIN chapters c1 ON c2.parent_id = c1.id
     LEFT JOIN (
       SELECT question_id, review_date, next_review_date, ease_factor, interval_days
       FROM review_records
       WHERE id IN (SELECT MAX(id) FROM review_records GROUP BY question_id)
     ) r ON r.question_id = q.id
     WHERE q.id IN (${placeholders})`,
    selectedIds
  );

  // 保持 selectedIds 的轮询顺序
  const orderMap = new Map<number, number>();
  selectedIds.forEach((id, i) => orderMap.set(id, i));
  fullQuestions.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));

  return NextResponse.json(fullQuestions);
}

// POST /api/review — record a review result (correct=true/false)
export async function POST(req: NextRequest) {
  await initSchema();
  const { question_id, correct } = await req.json();

  if (!question_id || correct === undefined) {
    return NextResponse.json(
      { error: "question_id and correct are required" },
      { status: 400 }
    );
  }

  const current = await queryOne<{ review_count: number; ease_factor: number }>(
    `SELECT
       COUNT(rr.id) AS review_count,
       COALESCE(
         (SELECT ease_factor FROM review_records WHERE question_id = ? ORDER BY id DESC LIMIT 1),
         2.5
       ) AS ease_factor
     FROM review_records rr
     WHERE rr.question_id = ?`,
    [question_id, question_id]
  );

  if (!current) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  const { intervalDays, easeFactor, nextReviewDate } = calcNextReview(
    current.review_count,
    !!correct,
    current.ease_factor
  );

  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

  // 必须 await runAndSave，防止未捕获异常导致静默数据丢失
  await runAndSave(
    `INSERT INTO review_records (question_id, review_date, score, ease_factor, interval_days, next_review_date)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [question_id, today, correct ? 5 : 1, easeFactor, intervalDays, nextReviewDate]
  );

  return NextResponse.json({
    ok: true,
    next_review_date: nextReviewDate,
    interval_days: intervalDays,
    ease_factor: easeFactor,
  });
}
