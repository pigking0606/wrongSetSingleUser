/**
 * Ebbinghaus-based spaced repetition scheduler.
 *
 * Intervals (days): 1, 2, 4, 7, 15, 30, 60, 120
 * Matches the classic forgetting curve review points.
 *
 * Scoring: true = remembered correctly, false = forgot
 */

const INTERVALS = [1, 2, 4, 7, 15, 30, 60, 120];

function nextDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function calcNextReview(
  reviewCount: number,
  correct: boolean,
  currentEase: number
): { intervalDays: number; easeFactor: number; nextReviewDate: string } {
  let ease = currentEase;

  if (correct) {
    ease = Math.min(3.0, ease + 0.1);
  } else {
    // Forgot — reset: review again tomorrow, lower ease
    ease = Math.max(1.3, ease - 0.3);
    return { intervalDays: 1, easeFactor: ease, nextReviewDate: nextDate(1) };
  }

  const intervalIdx = Math.min(reviewCount, INTERVALS.length - 1);
  const intervalDays = Math.round(INTERVALS[intervalIdx] * ease);

  return { intervalDays, easeFactor: ease, nextReviewDate: nextDate(intervalDays) };
}

/**
 * Get questions due for review today (up to `limit`).
 */
export function getDueQuestions(
  questionIds: number[],
  limit: number
): number[] {
  // Shuffle and pick `limit` — actual filtering by due date
  // happens in SQL query via review_records.next_review_date
  const shuffled = [...questionIds].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, limit);
}
