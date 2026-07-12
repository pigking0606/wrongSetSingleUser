const fs=require("fs");
let f,c;

// settings/route.ts
f="C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/app/api/settings/route.ts";
c=fs.readFileSync(f,"utf8");
c=c.replace("function getRaw","async function getRaw");
c=c.replace("function getKey","async function getKey");
c=c.replace("function getPlain","async function getPlain");
c=c.replace("return getRaw(","return await getRaw(");
c=c.replace("return decrypt(getRaw","return decrypt(await getRaw");
fs.writeFileSync(f,c,"utf8");

// learning-progress/ai/route.ts
f="C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/app/api/learning-progress/ai/route.ts";
c=fs.readFileSync(f,"utf8");
c=c.replace("function loadSetting","async function loadSetting");
c=c.replace("function getTextApiUrl","async function getTextApiUrl");
c=c.replace("getTextApiUrl()","await getTextApiUrl()");
fs.writeFileSync(f,c,"utf8");

// ai-suggest
f="C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/app/api/plan-tasks/ai-suggest/route.ts";
c=fs.readFileSync(f,"utf8");
c=c.replace("function loadSetting","async function loadSetting");
fs.writeFileSync(f,c,"utf8");

// reanalyze
f="C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/app/api/reanalyze/route.ts";
c=fs.readFileSync(f,"utf8");
c=c.replace("function loadSetting","async function loadSetting");
c=c.replace("function getReanalyzeUrl","async function getReanalyzeUrl");
fs.writeFileSync(f,c,"utf8");

// ai.ts - find non-async functions with await and make them async
f="C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/lib/ai.ts";
c=fs.readFileSync(f,"utf8");
c=c.replace("export function buildSystemPrompt","export async function buildSystemPrompt");
c=c.replace("export function fixLatexWithAI","export async function fixLatexWithAI");
fs.writeFileSync(f,c,"utf8");

console.log("ALL FIXED");
