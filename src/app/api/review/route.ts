import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryOne, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";
import { calcNextReview } from "@/lib/ebbinghaus";

// GET /api/review?limit=10&subject_id=1&chapter_l2_id=5
export async function GET(req: NextRequest) {
  await initSchema();
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") || "10");
  const subjectId = searchParams.get("subject_id");
  const chapterL2Id = searchParams.get("chapter_l2_id");
  const chapterId = searchParams.get("chapter_id");

  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const params: (string | number)[] = [today];
  const conditions: string[] = [];

  if (subjectId) {
    conditions.push("c1.id = ?");
    params.push(parseInt(subjectId));
  }
  if (chapterL2Id) {
    conditions.push("c2.id = ?");
    params.push(parseInt(chapterL2Id));
  }
  if (chapterId) {
    conditions.push("c3.id = ?");
    params.push(parseInt(chapterId));
  }

  const whereClause = conditions.length > 0
    ? `AND ${conditions.join(" AND ")}`
    : "";

  const dueQuestions = await queryAll<{
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
     WHERE (r.next_review_date IS NULL OR r.next_review_date <= ?) AND (q.status IS NULL OR q.status = 'ready')
       AND NOT (r.next_review_date IS NULL AND date(q.created_at) = ?)
     ${whereClause}
     ORDER BY RAND()
     LIMIT ?`,
    [...params, today, limit]
  );

  return NextResponse.json(dueQuestions);
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

  runAndSave(
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
