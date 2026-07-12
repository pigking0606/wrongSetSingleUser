const fs = require("fs");
const f = "C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/app/plan/page.tsx";
let c = fs.readFileSync(f, "utf8");

// The actual text is: : ""}` followed by newline and spaces and {isToday
// I need to add } to close the outer JSX expression
// Target: : ""}` newline spaces {isToday
// Replace: : ""}`} newline spaces {isToday

// Use the known character positions from the file
let i = c.indexOf('isToday && t.time_spent');
if (i > 0) {
  // The character just before {isToday should be }
  let before = c.substring(i - 20, i);
  console.log("Before isToday:", JSON.stringify(before));
  
  // Insert } before {isToday
  c = c.substring(0, i) + "}" + c.substring(i);
  console.log("INSERTED } at position", i);
} else {
  console.log("not found");
}

fs.writeFileSync(f, c, "utf8");
