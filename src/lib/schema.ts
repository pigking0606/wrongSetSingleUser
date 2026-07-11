import { getDb, saveDb } from "./db";

export async function initSchema() {
  const db = await getDb();

  db.run(`
    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (parent_id) REFERENCES chapters(id) ON DELETE SET NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_id INTEGER NOT NULL,
      image_path TEXT,
      ocr_text TEXT,
      question_type TEXT DEFAULT 'single_choice',
      correct_answer TEXT,
      explanation TEXT,
      ai_solutions TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS review_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      review_date TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      ease_factor REAL NOT NULL DEFAULT 2.5,
      interval_days INTEGER NOT NULL DEFAULT 0,
      next_review_date TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS question_tags (
      question_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (question_id, tag_id),
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )
  `);

  // Key-value settings table (API keys, models, etc.)
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Plan tasks - user-managed daily study tasks
  db.run(`
    CREATE TABLE IF NOT EXISTS plan_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_date TEXT NOT NULL,
      chapter_id INTEGER,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      completion_pct INTEGER DEFAULT 0,
      difficulty INTEGER DEFAULT 3,
      time_spent INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      completed_at TEXT,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
    )
  `);

  // Daily summaries
  db.run(`
    CREATE TABLE IF NOT EXISTS daily_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      summary_date TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Learning progress (single-row, user-editable with AI assist)
  db.run(`
    CREATE TABLE IF NOT EXISTS learning_progress (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      content TEXT NOT NULL DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  // Ensure row exists
  db.run("INSERT OR IGNORE INTO learning_progress (id, content) VALUES (1, '')");

  // Phase 2: add new columns (ignore if already exist)
  const alterStatements = [
    "ALTER TABLE chapters ADD COLUMN level INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE chapters ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE questions ADD COLUMN user_answer TEXT",
    "ALTER TABLE questions ADD COLUMN ai_raw_response TEXT",
    "ALTER TABLE questions ADD COLUMN original_filename TEXT",
    "ALTER TABLE questions ADD COLUMN error_reason TEXT",
    "ALTER TABLE questions ADD COLUMN status TEXT DEFAULT 'ready'",
    "ALTER TABLE plan_tasks ADD COLUMN completion_pct INTEGER DEFAULT 100",
    "ALTER TABLE plan_tasks ADD COLUMN difficulty INTEGER DEFAULT 3",
    "ALTER TABLE plan_tasks ADD COLUMN time_spent INTEGER DEFAULT 0",
    "ALTER TABLE plan_tasks ADD COLUMN last_edited_date TEXT",
    "ALTER TABLE plan_tasks ADD COLUMN timer_started_at TEXT",
    "ALTER TABLE plan_tasks ADD COLUMN external_id TEXT",
    "ALTER TABLE questions ADD COLUMN external_id TEXT",
    "ALTER TABLE questions ADD COLUMN bank_id INTEGER DEFAULT 1",
  ];
  // Insert default bank if not exists
  try { db.run("INSERT INTO banks (id, name) SELECT 1, '默认题库' WHERE NOT EXISTS (SELECT 1 FROM banks WHERE id=1)"); } catch { /* */ }
  // Create index for external_id lookups
  try { db.run("CREATE INDEX IF NOT EXISTS idx_plan_tasks_external ON plan_tasks(external_id)"); } catch { /* */ }
  try { db.run("CREATE INDEX IF NOT EXISTS idx_questions_external ON questions(external_id)"); } catch { /* */ }

  for (const sql of alterStatements) {
    try { db.run(sql); } catch { /* column already exists */ }
  }

  saveDb();
}
