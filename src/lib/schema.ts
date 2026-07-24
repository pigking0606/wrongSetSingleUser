import { getDb } from "./db";
import { queryAll } from "./db";

export async function initSchema() {
  const db = await getDb();

  const tables = [
    `CREATE TABLE IF NOT EXISTS banks (
      id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      extra_text_1 TEXT, extra_text_2 TEXT, extra_int_1 INT DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS chapters (
      id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(500) NOT NULL,
      parent_id INT, level INT NOT NULL DEFAULT 1, sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      extra_text_1 TEXT, extra_text_2 TEXT, extra_int_1 INT DEFAULT 0,
      FOREIGN KEY (parent_id) REFERENCES chapters(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    // chapter_id 允许 NULL：上传时用户未选章节，由 AI 分析后回填；外键 ON DELETE SET NULL：删章节不级联删题目
    `CREATE TABLE IF NOT EXISTS questions (
      id INT AUTO_INCREMENT PRIMARY KEY, chapter_id INT, bank_id INT DEFAULT 1,
      image_path TEXT, ocr_text LONGTEXT, question_type VARCHAR(50) DEFAULT 'single_choice',
      correct_answer TEXT, explanation LONGTEXT, ai_solutions LONGTEXT,
      user_answer TEXT, ai_raw_response LONGTEXT, original_filename VARCHAR(500),
      error_reason TEXT, status VARCHAR(50) DEFAULT 'ready', external_id VARCHAR(255),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      extra_text_1 TEXT, extra_text_2 TEXT, extra_int_1 INT DEFAULT 0, extra_int_2 INT DEFAULT 0,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS review_records (
      id INT AUTO_INCREMENT PRIMARY KEY, question_id INT NOT NULL,
      review_date DATE NOT NULL, score INT NOT NULL DEFAULT 0,
      ease_factor DOUBLE NOT NULL DEFAULT 2.5, interval_days INT NOT NULL DEFAULT 0,
      next_review_date DATE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      extra_text_1 TEXT, extra_int_1 INT DEFAULT 0,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS tags (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE, extra_text_1 TEXT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS question_tags (question_id INT NOT NULL, tag_id INT NOT NULL, PRIMARY KEY (question_id, tag_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS settings (\`key\` VARCHAR(255) PRIMARY KEY, value TEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS plan_tasks (
      id INT AUTO_INCREMENT PRIMARY KEY, task_date DATE NOT NULL, chapter_id INT,
      title VARCHAR(500) NOT NULL, description TEXT, completion_pct INT DEFAULT 0,
      difficulty INT DEFAULT 3, time_spent INT DEFAULT 0, status VARCHAR(50) DEFAULT 'pending',
      sort_order INT DEFAULT 0, last_edited_date DATE, timer_started_at DATETIME,
      external_id VARCHAR(255), completed_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      extra_text_1 TEXT, extra_text_2 TEXT, extra_int_1 INT DEFAULT 0, extra_int_2 INT DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS daily_summaries (
      id INT AUTO_INCREMENT PRIMARY KEY, summary_date DATE NOT NULL UNIQUE,
      content LONGTEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, extra_text_1 TEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS learning_progress (
      id INT PRIMARY KEY, content LONGTEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS solution_methods (
      id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(500) NOT NULL,
      chapter_id INT, content LONGTEXT, image_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      extra_text_1 TEXT, extra_text_2 TEXT, extra_int_1 INT DEFAULT 0, extra_int_2 INT DEFAULT 0,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    // AI 生成计划建议的批次表：一次 AI 生成对应一个 batch，后台执行，状态 pending→ready/error
    `CREATE TABLE IF NOT EXISTS ai_suggestion_batches (
      id VARCHAR(64) PRIMARY KEY,
      task_date DATE NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      reason TEXT,
      error_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    // AI 建议的具体任务条目：归属某个 batch，采纳后 adopted_task_id 指向 plan_tasks.id
    `CREATE TABLE IF NOT EXISTS ai_suggestions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      batch_id VARCHAR(64) NOT NULL,
      task_date DATE NOT NULL,
      title VARCHAR(500) NOT NULL,
      chapter_id INT,
      description TEXT,
      difficulty INT DEFAULT 3,
      sort_order INT DEFAULT 0,
      status VARCHAR(50) DEFAULT 'ready',
      adopted_task_id INT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (batch_id) REFERENCES ai_suggestion_batches(id) ON DELETE CASCADE,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  ];

  for (const sql of tables) {
    try { await db.execute(sql); } catch(e) { console.error("table create error:", (e as Error).message); }
  }

  // Migrations: add columns to existing tables (idempotent — fails silently if column exists)
  // 例题与解法图分离：image_path 存解法流程图（供 AI 解析），example_images 存例题图片
  const migrations: Array<{ sql: string; desc: string }> = [
    { sql: "ALTER TABLE solution_methods ADD COLUMN example_images TEXT", desc: "solution_methods.example_images" },
    { sql: "ALTER TABLE solution_methods ADD COLUMN flowchart_data LONGTEXT", desc: "solution_methods.flowchart_data (结构化流程图 JSON)" },
  ];
  for (const m of migrations) {
    try { await db.execute(m.sql); } catch (e) {
      const msg = (e as Error).message || "";
      // MySQL error code 1060: Duplicate column name — expected, safe to ignore
      if (!/Duplicate column|1060/i.test(msg)) console.error("migration error:", m.desc, msg);
    }
  }

  // questions.chapter_id 迁移：NOT NULL → NULL + 外键 ON DELETE CASCADE → ON DELETE SET NULL
  // 上传时 chapter_id 暂为 NULL（用户未选章节），AI 分析后回填；删除章节时题目保留不被级联删除
  // 步骤：1. 查现有外键 2. DROP 外键 3. MODIFY 允许 NULL 4. ADD 新外键（ON DELETE SET NULL）
  try {
    const fks = await queryAll<{ CONSTRAINT_NAME: string; DELETE_RULE: string }>(
      `SELECT rc.CONSTRAINT_NAME, rc.DELETE_RULE
       FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
       WHERE rc.CONSTRAINT_SCHEMA = DATABASE() AND rc.TABLE_NAME = 'questions'`
    );
    for (const fk of fks) {
      try {
        await db.execute(`ALTER TABLE questions DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
      } catch (e) { /* 静默：外键可能已不存在 */ }
    }
    try { await db.execute("ALTER TABLE questions MODIFY COLUMN chapter_id INT NULL"); } catch (e) { /* 静默 */ }
    try {
      await db.execute("ALTER TABLE questions ADD CONSTRAINT questions_chapter_fk FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL");
    } catch (e) {
      const msg = (e as Error).message || "";
      // 1826 = Duplicate foreign key constraint exists — 期望，可忽略
      if (!/Duplicate foreign key|1826/i.test(msg)) console.error("[migration] questions FK add error:", msg);
    }
  } catch (e) {
    console.error("[migration] questions FK migration error:", (e as Error).message);
  }

  await db.execute("INSERT IGNORE INTO learning_progress (id, content) VALUES (1, '')");
  await db.execute("INSERT IGNORE INTO banks (id, name) VALUES (1, '默认题库')");
}
