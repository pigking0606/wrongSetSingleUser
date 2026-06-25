import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

async function main() {
  const initSqlJs = require("sql.js").default;

  const DB_PATH = path.join(__dirname, "..", "data", "app.db");

  if (!fs.existsSync(DB_PATH)) {
    console.error("Database not found. Run `npm run db:init` first.");
    process.exit(1);
  }

  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buffer);

  const chapters = [
    { name: "高等数学", parent_id: null },
    { name: "线性代数", parent_id: null },
    { name: "概率论与数理统计", parent_id: null },
    { name: "极限与连续", parent_id: 1 },
    { name: "导数与微分", parent_id: 1 },
    { name: "矩阵理论", parent_id: 2 },
    { name: "随机变量", parent_id: 3 },
  ];

  const insertChapter = db.prepare(
    "INSERT INTO chapters (name, parent_id) VALUES (?, ?)"
  );
  for (const c of chapters) {
    insertChapter.run([c.name, c.parent_id]);
  }
  insertChapter.free();

  const questions = [
    { chapter_id: 4, ocr_text: "求极限：lim(x→0) (sin x) / x = ?", correct_answer: "1", question_type: "fill_blank" },
    { chapter_id: 4, ocr_text: "判断：lim(x→∞) (1 + 1/x)^x = e", correct_answer: "True", question_type: "true_false" },
    { chapter_id: 5, ocr_text: "求导数：d/dx (x² sin x) = ?", correct_answer: "2x sin x + x² cos x", question_type: "fill_blank" },
    { chapter_id: 6, ocr_text: "若矩阵 A 可逆，则 |A| ≠ 0。判断正误。", correct_answer: "True", question_type: "true_false" },
    { chapter_id: 6, ocr_text: "求矩阵 [[1,2],[3,4]] 的行列式值。", correct_answer: "-2", question_type: "fill_blank" },
    { chapter_id: 7, ocr_text: "设 X~N(0,1)，求 P(X>0) = ?", correct_answer: "0.5", question_type: "single_choice" },
  ];

  const insertQ = db.prepare(
    `INSERT INTO questions (chapter_id, ocr_text, correct_answer, question_type)
     VALUES (?, ?, ?, ?)`
  );
  for (const q of questions) {
    insertQ.run([q.chapter_id, q.ocr_text, q.correct_answer, q.question_type]);
  }
  insertQ.free();

  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  db.close();

  console.log(`Seeded ${chapters.length} chapters and ${questions.length} questions.`);
}

main().catch(console.error);
