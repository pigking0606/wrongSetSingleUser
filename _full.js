const fs = require("fs");
const path = require("path");
const q = String.fromCharCode(34);

// ============================================================
// 1. Install mysql2 locally
// ============================================================
require("child_process").execSync("npm install mysql2", { cwd: "C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review", stdio: "inherit" });

// ============================================================
// 2. Write MySQL db.ts
// ============================================================
const dbTs = `import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "6603"),
  user: process.env.DB_USER || "wrongset",
  password: process.env.DB_PASSWORD || "wrongset123",
  database: process.env.DB_NAME || "wrongset",
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4",
});

export async function getDb() { return pool; }
export async function saveDb() {}
export async function runAndSave(sql: string, params?: any[]) { await pool.execute(sql, params); }
export async function queryAll<T = any>(sql: string, params?: any[]): Promise<T[]> { const [rows] = await pool.execute(sql, params); return rows as T[]; }
export async function queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> { const rows = await queryAll<T>(sql, params); return rows[0] || null; }
`;
fs.writeFileSync("C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/lib/db.ts", dbTs);

// ============================================================
// 3. Write MySQL schema.ts
// ============================================================
const schemaTs = `import { getDb } from "./db";

export async function initSchema() {
  const db = await getDb();

  const tables = [
    \`CREATE TABLE IF NOT EXISTS banks (
      id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      extra_text_1 TEXT, extra_text_2 TEXT, extra_int_1 INT DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4\`,
    \`CREATE TABLE IF NOT EXISTS chapters (
      id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(500) NOT NULL,
      parent_id INT, level INT NOT NULL DEFAULT 1, sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      extra_text_1 TEXT, extra_text_2 TEXT, extra_int_1 INT DEFAULT 0,
      FOREIGN KEY (parent_id) REFERENCES chapters(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4\`,
    \`CREATE TABLE IF NOT EXISTS questions (
      id INT AUTO_INCREMENT PRIMARY KEY, chapter_id INT NOT NULL, bank_id INT DEFAULT 1,
      image_path TEXT, ocr_text LONGTEXT, question_type VARCHAR(50) DEFAULT 'single_choice',
      correct_answer TEXT, explanation LONGTEXT, ai_solutions LONGTEXT,
      user_answer TEXT, ai_raw_response LONGTEXT, original_filename VARCHAR(500),
      error_reason TEXT, status VARCHAR(50) DEFAULT 'ready', external_id VARCHAR(255),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      extra_text_1 TEXT, extra_text_2 TEXT, extra_int_1 INT DEFAULT 0, extra_int_2 INT DEFAULT 0,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4\`,
    \`CREATE TABLE IF NOT EXISTS review_records (
      id INT AUTO_INCREMENT PRIMARY KEY, question_id INT NOT NULL,
      review_date DATE NOT NULL, score INT NOT NULL DEFAULT 0,
      ease_factor DOUBLE NOT NULL DEFAULT 2.5, interval_days INT NOT NULL DEFAULT 0,
      next_review_date DATE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      extra_text_1 TEXT, extra_int_1 INT DEFAULT 0,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4\`,
    \`CREATE TABLE IF NOT EXISTS tags (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE, extra_text_1 TEXT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4\`,
    \`CREATE TABLE IF NOT EXISTS question_tags (question_id INT NOT NULL, tag_id INT NOT NULL, PRIMARY KEY (question_id, tag_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4\`,
    \`CREATE TABLE IF NOT EXISTS settings (\\\`key\\\` VARCHAR(255) PRIMARY KEY, value TEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4\`,
    \`CREATE TABLE IF NOT EXISTS plan_tasks (
      id INT AUTO_INCREMENT PRIMARY KEY, task_date DATE NOT NULL, chapter_id INT,
      title VARCHAR(500) NOT NULL, description TEXT, completion_pct INT DEFAULT 0,
      difficulty INT DEFAULT 3, time_spent INT DEFAULT 0, status VARCHAR(50) DEFAULT 'pending',
      sort_order INT DEFAULT 0, last_edited_date DATE, timer_started_at DATETIME,
      external_id VARCHAR(255), completed_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      extra_text_1 TEXT, extra_text_2 TEXT, extra_int_1 INT DEFAULT 0, extra_int_2 INT DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4\`,
    \`CREATE TABLE IF NOT EXISTS daily_summaries (
      id INT AUTO_INCREMENT PRIMARY KEY, summary_date DATE NOT NULL UNIQUE,
      content LONGTEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, extra_text_1 TEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4\`,
    \`CREATE TABLE IF NOT EXISTS learning_progress (
      id INT PRIMARY KEY, content LONGTEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4\`,
  ];

  for (const sql of tables) {
    try { await db.execute(sql); } catch(e) { console.error("table create error:", e.message); }
  }

  await db.execute("INSERT IGNORE INTO learning_progress (id, content) VALUES (1, '')");
  await db.execute("INSERT IGNORE INTO banks (id, name) VALUES (1, '默认题库')");
}
`;
fs.writeFileSync("C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/lib/schema.ts", schemaTs);

// ============================================================
// 4. Add await to all queryAll/queryOne in API routes
// ============================================================
function walk(dir) {
  let files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(p));
    else if (entry.name.endsWith(".ts")) files.push(p);
  }
  return files;
}

const libFiles = ["ai.ts", "analyze-pipeline.ts"].map(f => 
  path.join("C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/lib", f)
).filter(f => fs.existsSync(f));

const allFiles = [
  ...walk("C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/app/api"),
  ...libFiles,
];

let count = 0;
for (const f of allFiles) {
  let c = fs.readFileSync(f, "utf8");
  const orig = c;
  
  // Only replace actual function calls, not import declarations
  // queryAll( -> await queryAll(   (but not "import { ... queryAll")
  c = c.replace(/(?<!import \{)queryAll\(/g, (m) => m.includes("await") ? m : "await queryAll(");
  c = c.replace(/(?<!import \{)queryOne\(/g, (m) => m.includes("await") ? m : "await queryOne(");
  // Fix double await
  c = c.replace(/await await /g, "await ");
  
  if (c !== orig) {
    fs.writeFileSync(f, c, "utf8");
    count++;
  }
}
console.log("Files fixed:", count);

// ============================================================
// 5. Fix known TypeScript issues — remove return type annotations from async functions
// ============================================================
const asyncReturnFixFiles = [
  "C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/app/api/learning-progress/ai/route.ts",
  "C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/app/api/plan-tasks/ai-suggest/route.ts",
  "C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/app/api/reanalyze/route.ts",
  "C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/app/api/settings/route.ts",
];

for (const f of asyncReturnFixFiles) {
  if (!fs.existsSync(f)) continue;
  let c = fs.readFileSync(f, "utf8");
  // Remove : string return type from async functions
  c = c.replace(/(async function \w+\([^)]*\)): string/g, "$1");
  c = c.replace(/(async function \w+\([^)]*\)): Promise<string>/g, "$1");
  fs.writeFileSync(f, c, "utf8");
  console.log("Return type fixed:", path.basename(f));
}

console.log("ALL DONE");
