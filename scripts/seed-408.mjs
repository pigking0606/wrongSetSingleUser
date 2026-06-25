import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const hierarchy = [
  {
    name: "408", sort_order: 1, children: [
      {
        name: "数据结构", sort_order: 1, children: [
          { name: "线性表", sort_order: 1 },
          { name: "栈和队列", sort_order: 2 },
          { name: "树与二叉树", sort_order: 3 },
          { name: "图", sort_order: 4 },
          { name: "查找", sort_order: 5 },
          { name: "排序", sort_order: 6 },
        ]
      },
      {
        name: "计算机组成原理", sort_order: 2, children: [
          { name: "计算机系统概述", sort_order: 1 },
          { name: "数据的表示和运算", sort_order: 2 },
          { name: "存储器层次结构", sort_order: 3 },
          { name: "指令系统", sort_order: 4 },
          { name: "中央处理器（CPU）", sort_order: 5 },
          { name: "总线", sort_order: 6 },
          { name: "输入输出系统", sort_order: 7 },
        ]
      },
      {
        name: "操作系统", sort_order: 3, children: [
          { name: "操作系统概述", sort_order: 1 },
          { name: "进程管理", sort_order: 2 },
          { name: "内存管理", sort_order: 3 },
          { name: "文件管理", sort_order: 4 },
          { name: "输入输出管理", sort_order: 5 },
        ]
      },
      {
        name: "计算机网络", sort_order: 4, children: [
          { name: "计算机网络体系结构", sort_order: 1 },
          { name: "物理层", sort_order: 2 },
          { name: "数据链路层", sort_order: 3 },
          { name: "网络层", sort_order: 4 },
          { name: "传输层", sort_order: 5 },
          { name: "应用层", sort_order: 6 },
        ]
      },
    ]
  },
  {
    name: "数学二", sort_order: 5, children: [
      {
        name: "高等数学", sort_order: 1, children: [
          { name: "函数、极限、连续", sort_order: 1 },
          { name: "一元函数微分学", sort_order: 2 },
          { name: "一元函数积分学", sort_order: 3 },
          { name: "多元函数微分学", sort_order: 4 },
          { name: "常微分方程", sort_order: 5 },
          { name: "二重积分", sort_order: 6 },
        ]
      },
      {
        name: "线性代数", sort_order: 7, children: [
          { name: "行列式", sort_order: 1 },
          { name: "矩阵", sort_order: 2 },
          { name: "向量", sort_order: 3 },
          { name: "线性方程组", sort_order: 4 },
          { name: "矩阵的特征值和特征向量", sort_order: 5 },
          { name: "二次型", sort_order: 6 },
        ]
      },
    ]
  },
  {
    name: "英语二", sort_order: 7, children: [
      {
        name: "完形填空", sort_order: 1, children: [
          { name: "词汇辨析", sort_order: 1 },
          { name: "语法结构", sort_order: 2 },
          { name: "上下文逻辑", sort_order: 3 },
        ]
      },
      {
        name: "阅读理解", sort_order: 2, children: [
          { name: "主旨大意题", sort_order: 1 },
          { name: "细节理解题", sort_order: 2 },
          { name: "推理判断题", sort_order: 3 },
          { name: "词义猜测题", sort_order: 4 },
        ]
      },
      {
        name: "翻译", sort_order: 3, children: [
          { name: "英译汉技巧", sort_order: 1 },
          { name: "长难句处理", sort_order: 2 },
        ]
      },
      {
        name: "写作", sort_order: 4, children: [
          { name: "小作文（应用文）", sort_order: 1 },
          { name: "大作文（图表作文）", sort_order: 2 },
        ]
      },
    ]
  },
  {
    name: "政治", sort_order: 8, children: [
      {
        name: "马克思主义基本原理", sort_order: 1, children: [
          { name: "唯物辩证法", sort_order: 1 },
          { name: "认识论", sort_order: 2 },
          { name: "唯物史观", sort_order: 3 },
          { name: "政治经济学", sort_order: 4 },
        ]
      },
      {
        name: "毛泽东思想和中国特色社会主义理论体系概论", sort_order: 2, children: [
          { name: "毛泽东思想", sort_order: 1 },
          { name: "邓小平理论", sort_order: 2 },
          { name: "习近平新时代中国特色社会主义思想", sort_order: 3 },
        ]
      },
      {
        name: "中国近现代史纲要", sort_order: 3, children: [
          { name: "鸦片战争至五四运动", sort_order: 1 },
          { name: "新民主主义革命时期", sort_order: 2 },
          { name: "社会主义革命与建设时期", sort_order: 3 },
          { name: "改革开放时期", sort_order: 4 },
        ]
      },
      {
        name: "思想道德修养与法律基础", sort_order: 4, children: [
          { name: "理想信念", sort_order: 1 },
          { name: "道德规范", sort_order: 2 },
          { name: "法律基础", sort_order: 3 },
        ]
      },
      {
        name: "形势与政策", sort_order: 5, children: [
          { name: "国内时政", sort_order: 1 },
          { name: "国际形势", sort_order: 2 },
        ]
      },
    ]
  },
];

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

  // Skip if chapters already exist (preserve existing data and questions)
  const existing = db.exec("SELECT count(*) FROM chapters");
  if (existing[0]?.values[0][0] > 0) {
    console.log("Chapters already seeded, skipping.");
    db.close();
    return;
  }

  let total = 0;

  const insertStmt = db.prepare(
    "INSERT INTO chapters (name, parent_id, level, sort_order) VALUES (?, ?, ?, ?)"
  );

  for (const subject of hierarchy) {
    db.run("BEGIN");
    // Level 1: subject
    insertStmt.run([subject.name, null, 1, subject.sort_order]);
    const subjectId = db.exec("SELECT last_insert_rowid()")[0].values[0][0];
    total++;

    for (const chapter of subject.children) {
      // Level 2: chapter
      insertStmt.run([chapter.name, subjectId, 2, chapter.sort_order]);
      const chapterId = db.exec("SELECT last_insert_rowid()")[0].values[0][0];
      total++;

      for (const kp of chapter.children) {
        // Level 3: knowledge point
        insertStmt.run([kp.name, chapterId, 3, kp.sort_order]);
        total++;
      }
    }
    db.run("COMMIT");
  }

  insertStmt.free();

  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  db.close();

  console.log(`Seeded ${hierarchy.length} subjects with ${total} total chapters/knowledge points.`);
}

main().catch(console.error);
