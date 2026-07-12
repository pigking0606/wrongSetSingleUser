const fs = require("fs");
const f = "C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/lib/schema.ts";
let c = fs.readFileSync(f, "utf8");

// SQLite stays. Just add redundant fields to plan_tasks, questions, and banks
c = c.replace(
  "ALTER TABLE questions ADD COLUMN bank_id INTEGER DEFAULT 1",
  "ALTER TABLE plan_tasks ADD COLUMN extra_text_1 TEXT,\n    ALTER TABLE plan_tasks ADD COLUMN extra_text_2 TEXT,\n    ALTER TABLE plan_tasks ADD COLUMN extra_int_1 INTEGER DEFAULT 0,\n    ALTER TABLE plan_tasks ADD COLUMN extra_int_2 INTEGER DEFAULT 0,\n    ALTER TABLE questions ADD COLUMN extra_text_1 TEXT,\n    ALTER TABLE questions ADD COLUMN extra_text_2 TEXT,\n    ALTER TABLE questions ADD COLUMN extra_int_1 INTEGER DEFAULT 0,\n    ALTER TABLE questions ADD COLUMN extra_int_2 INTEGER DEFAULT 0,\n    ALTER TABLE banks ADD COLUMN extra_text_1 TEXT,\n    ALTER TABLE banks ADD COLUMN extra_text_2 TEXT,\n    ALTER TABLE banks ADD COLUMN extra_int_1 INTEGER DEFAULT 0,\n    ALTER TABLE questions ADD COLUMN bank_id INTEGER DEFAULT 1"
);
fs.writeFileSync(f, c, "utf8");
console.log("redundant fields added to SQLite schema");
