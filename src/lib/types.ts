// ---------------------------------------------------------------------------
// Database entity types
// ---------------------------------------------------------------------------

export interface Chapter {
  id: number;
  name: string;
  parent_id: number | null;
  level: number;
  sort_order: number;
  created_at: string;
}

export interface ChapterNode extends Chapter {
  children: ChapterNode[];
}

export type QuestionType =
  | "single_choice"
  | "multiple_choice"
  | "true_false"
  | "fill_blank"
  | "short_answer"
  | "comprehensive";

export interface Question {
  id: number;
  chapter_id: number;
  image_path: string | null;
  ocr_text: string;
  question_type: QuestionType;
  correct_answer: string;
  explanation: string | null;
  ai_solutions: string | null;
  user_answer: string | null;
  ai_raw_response: string | null;
  original_filename: string | null;
  error_reason: string | null;
  created_at: string;
}

export interface QuestionWithChapters extends Question {
  kp_name: string | null;
  chapter_name: string | null;
  subject_name: string | null;
  subject_id: number | null;
  chapter_l2_id: number | null;
}

export interface ReviewRecord {
  id: number;
  question_id: number;
  review_date: string;
  score: number;
  ease_factor: number;
  interval_days: number;
  next_review_date: string | null;
  created_at: string;
}

export interface ReviewWithQuestion extends ReviewRecord {
  ocr_text: string;
  chapter_id: number;
  correct_answer: string;
  explanation: string | null;
  ai_solutions: string | null;
  user_answer: string | null;
  question_type: string;
  image_path: string | null;
  kp_name: string | null;
  chapter_name: string | null;
  subject_name: string | null;
}

export interface Tag {
  id: number;
  name: string;
}

export interface QuestionTag {
  question_id: number;
  tag_id: number;
}

export interface Solution {
  name: string;
  steps: string[];
  answer: string;
}

export interface AiAnalysisResult {
  ocrText: string;
  questionType: QuestionType;
  classification: {
    subject: string;
    chapter: string;
    knowledgePoint: string;
  };
  correctAnswer: string;
  explanation: string;
  solutions: Solution[];
  confidence: number;
  error_reason?: string;
}

export interface DbStats {
  chapterCount: number;
  questionCount: number;
  reviewCount: number;
  subjectCount: number;
}
