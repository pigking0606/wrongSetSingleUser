const fs = require("fs");
const f = "C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/app/plan/page.tsx";
let c = fs.readFileSync(f, "utf8");

// Fix: add missing } at end of line 496 (close outer JSX expression)
c = c.replace(
  ': ""}`\'\n                        {isToday',
  ': ""}`}\n                        {isToday'
);

fs.writeFileSync(f, c, "utf8");
console.log("syntax fix applied");
