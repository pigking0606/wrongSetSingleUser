const fs = require("fs");

// Fix review page - add banks fetch
let f = "C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/app/review/page.tsx";
let c = fs.readFileSync(f, "utf8");

c = c.replace(
  '    fetch("/api/chapters").then(r => r.json()).then(data => setSubjects(data.filter((c: ChapterNode) => c.level === 1)))',
  '    fetch("/api/chapters").then(r => r.json()).then(data => setSubjects(data.filter((c: ChapterNode) => c.level === 1)));\n    fetch("/api/chapters?banks=1").then(r=>r.json()).then(d=>{if(d.banks)setBanks(d.banks)})'
);

fs.writeFileSync(f, c, "utf8");
console.log("review fixed");
