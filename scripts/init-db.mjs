import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

async function main() {
  const initSqlJs = require("sql.js").default;

  const DATA_DIR = path.join(__dirname, "..", "data");
  const DB_PATH = path.join(DATA_DIR, "app.db");

  const SQL = await initSqlJs();

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Load existing DB if present, otherwise create new
  let db;
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA foreign_keys=ON");

  db.run(`
    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      level INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
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
      user_answer TEXT,
      ai_raw_response TEXT,
      original_filename TEXT,
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

  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  db.close();

  console.log("Database initialized:", DB_PATH);
}

main().catch(console.error);
