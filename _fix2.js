const fs = require("fs");
const path = require("path");

const apiDir = "C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/app/api";
const libFiles = [
  "C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/lib/ai.ts",
  "C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/lib/analyze-pipeline.ts",
  "C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/lib/crypto-utils.ts",
];

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(p));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(p);
  }
  return files;
}

const allFiles = [...walk(apiDir), ...libFiles.filter(f => fs.existsSync(f))];

for (const f of allFiles) {
  let c = fs.readFileSync(f, "utf8");

  // Make any function that uses await into async
  // Pattern: function name(...) { ... await ... }
  // We need to find non-async, non-export functions that contain await
  
  // Find all function declarations (not already async, not already export)
  const funcRegex = /^(?!export\s)(?!.*async\s)(\s*)(?:static\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*\{/gm;
  let newC = c;
  let match;
  
  // Check each function body for await
  const lines = c.split(/\r?\n/);
  let modified = false;

  // Simple approach: for any function that's not async and contains await, add async
  const funcs = [];
  let braceDepth = 0;
  let inFunc = false;
  let funcStart = 0;
  let funcName = "";
  let funcIsAsync = false;
  let funcIsExport = false;
  let funcHasAwait = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check if this line starts a function
    const m = line.match(/^(\s*)(export\s+)?(async\s+)?function\s+(\w+)/);
    if (m && !inFunc) {
      funcStart = i;
      funcName = m[4];
      funcIsAsync = !!m[3];
      funcIsExport = !!m[2];
      funcHasAwait = false;
      braceDepth = 0;
      const openCount = (line.match(/\{/g) || []).length;
      const closeCount = (line.match(/\}/g) || []).length;
      braceDepth = openCount - closeCount;
      inFunc = braceDepth > 0 || line.includes("{");
    } else if (inFunc) {
      const openCount = (line.match(/\{/g) || []).length;
      const closeCount = (line.match(/\}/g) || []).length;
      braceDepth += openCount - closeCount;
      if (line.includes("await ") && !line.trim().startsWith("//")) {
        funcHasAwait = true;
      }
      if (braceDepth <= 0) {
        // Function ended
        if (funcHasAwait && !funcIsAsync && !funcIsExport) {
          // Make this function async
          lines[funcStart] = lines[funcStart].replace(/function\s+/, "async function ");
          modified = true;
        }
        inFunc = false;
      }
    }
  }

  if (modified) {
    fs.writeFileSync(f, lines.join("\n"), "utf8");
    console.log("Fixed async:", path.basename(f));
  }
}

// Also fix: any await inside a non-async arrow function in a non-async context
// This is harder to detect, so we'll do the main function fix first
console.log("Done");
