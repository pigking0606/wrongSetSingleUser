const fs = require("fs");
const path = require("path");

const apiDir = "C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/app/api";

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(p));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(p);
  }
  return files;
}

const files = walk(apiDir);
let total = 0;

for (const f of files) {
  let c = fs.readFileSync(f, "utf8");
  let changed = false;

  // SQLite → MySQL date functions
  if (c.includes("datetime('now','localtime')")) {
    c = c.replace(/datetime\('now','localtime'\)/g, "NOW()");
    changed = true;
  }

  // julianday time diff
  if (c.includes("julianday")) {
    c = c.replace(
      /CAST\(\(julianday\('now','localtime'\) - julianday\(timer_started_at\)\) \* 86400 AS INTEGER\)/g,
      "TIMESTAMPDIFF(SECOND, timer_started_at, NOW())"
    );
    changed = true;
  }

  // last_insert_rowid
  if (c.includes("last_insert_rowid()")) {
    c = c.replace(/last_insert_rowid\(\)/g, "LAST_INSERT_ID()");
    changed = true;
  }

  // INSERT OR IGNORE
  if (c.includes("INSERT OR IGNORE")) {
    c = c.replace(/INSERT OR IGNORE/g, "INSERT IGNORE");
    changed = true;
  }

  // strftime time diff in plan-tasks route
  if (c.includes("strftime('%s'")) {
    c = c.replace(
      /strftime\('%s','now'\) - strftime\('%s', timer_started_at\)/g,
      "TIMESTAMPDIFF(SECOND, timer_started_at, NOW())"
    );
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(f, c, "utf8");
    console.log("Updated:", path.basename(f));
    total++;
  }
}

console.log("Total files updated:", total);
