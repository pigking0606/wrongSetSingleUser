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

// Also check src/lib files
const allFiles = [...walk(apiDir), 
  "C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/lib/ai.ts",
  "C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/lib/analyze-pipeline.ts",
  "C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/lib/crypto-utils.ts",
];

let total = 0;
for (const f of allFiles) {
  if (!fs.existsSync(f)) continue;
  let c = fs.readFileSync(f, "utf8");
  let changed = false;

  // Add await before queryAll( if not already awaited
  c = c.replace(/(?<![aA]wait )queryAll</g, "await queryAll<");
  c = c.replace(/(?<![aA]wait )queryOne</g, "await queryOne<");
  c = c.replace(/(?<![aA]wait )queryAll\(/g, "await queryAll(");
  c = c.replace(/(?<![aA]wait )queryOne\(/g, "await queryOne(");

  if (c !== fs.readFileSync(f, "utf8")) {
    fs.writeFileSync(f, c, "utf8");
    console.log("Updated:", path.basename(f));
    total++;
  }
}
console.log("Total:", total);
