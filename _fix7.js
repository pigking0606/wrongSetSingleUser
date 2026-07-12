const fs = require("fs");
const f = "C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/app/plan/page.tsx";
let c = fs.readFileSync(f, "utf8");

// === 1. Stats grid: 3 cols → 4 cols ===
c = c.replace('gridTemplateColumns: "1fr 1fr 1fr"', 'gridTemplateColumns: "1fr 1fr 1fr 1fr"');

// === 2. Add todayMinutes card before stats closing </div> ===
c = c.replace(
  '        </div>\n      </div>\n\n      {/* Yesterday incomplete notification */}',
  '        </div>\n        <div className="card" style={{ textAlign: "center", padding: ".6rem .5rem" }}>\n          <div style={{ display: "flex", justifyContent: "center", marginBottom: ".1rem" }}><IconTarget size={20} /></div>\n          <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--accent)" }}>{stats.todayMinutes}</div>\n          <div style={{ fontSize: ".7rem", color: "var(--text-muted)" }}>今日学习(分)</div>\n        </div>\n      </div>\n\n      {/* Yesterday incomplete notification */}'
);

// === 3. Add todayMinutes to stats state ===
c = c.replace(
  'useState({ streak: 0, totalTasks: 0, avgPct: 0, avgDifficulty: 0 })',
  'useState({ streak: 0, totalTasks: 0, avgPct: 0, avgDifficulty: 0, todayMinutes: 0 })'
);

// === 4. Compute todayMinutes in loadStats ===
c = c.replace(
  'setStats({ streak, totalTasks: all.length, avgPct, avgDifficulty: avgDiff });',
  'const todayMin = all.filter(t=>t.task_date===today()).reduce((s,t)=>s+(t.time_spent||0),0);\n      setStats({ streak, totalTasks: all.length, avgPct, avgDifficulty: avgDiff, todayMinutes: Math.floor(todayMin/60) });'
);

// === 5. Fix streak: count days with any tasks, not just 100% ===
c = c.replace(
  'let streak = 0, d = today();\n      while (true) {\n        const dayTasks = all.filter(t => t.task_date === d);\n        if (dayTasks.length === 0) break;\n        if (dayTasks.every(t => (t.completion_pct || 0) >= 100)) { streak++; d = addDays(d, -1); }\n        else break;\n      }',
  'let streak = 0, d = today();\n      while (true) {\n        const dayTasks = all.filter(t => t.task_date === d);\n        if (dayTasks.length === 0) break;\n        streak++; d = addDays(d, -1);\n      }'
);

// === 6. Add editTime state ===
c = c.replace(
  'const [editSaving, setEditSaving] = useState(false);',
  'const [editSaving, setEditSaving] = useState(false);\n  const [editTimeId, setEditTimeId] = useState<number | null>(null);\n  const [editTimeVal, setEditTimeVal] = useState("");'
);

// === 7. Add saveTime function ===
c = c.replace(
  '  const saveEdit = async () => {\n    if (!editingId || !editTitle.trim()) return;',
  '  const saveTime = async (id: number, minutes: number) => {\n    await fetch("/api/plan-tasks", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, time_spent: minutes * 60 }) });\n    setEditTimeId(null);\n    await loadTasks(curDate);\n    loadStats();\n    toast("计时已更新");\n  };\n\n  const saveEdit = async () => {\n    if (!editingId || !editTitle.trim()) return;'
);

// === 8. Change timer display to show current + total ===
c = c.replace(
  '{String(Math.floor(timer.elapsed / 60)).padStart(2, "0")}:{String(timer.elapsed % 60).padStart(2, "0")}',
  '当前 {String(Math.floor(timer.elapsed / 60)).padStart(2,"0")}:{String(timer.elapsed % 60).padStart(2,"0")}<span style={{color:"var(--text-muted)",fontWeight:400}}> / 总计 {Math.floor(((t.time_spent||0)+timer.elapsed)/60)}分</span>'
);

// === 9. Add edit time inline UI before Timer row ===
c = c.replace(
  '{/* Timer row */}\n                {isToday && authed && (',
  '{editTimeId === t.id && (\n                  <div style={{ display: "flex", alignItems: "center", gap: ".4rem", borderTop: "1px solid var(--border)", paddingTop: ".4rem" }}>\n                    <span style={{ fontSize: ".75rem" }}>修改计时(分)：</span>\n                    <input type="number" value={editTimeVal} onChange={e=>setEditTimeVal(e.target.value)}\n                      style={{ width: "60px", fontSize: ".8rem", textAlign: "center" }}\n                      onKeyDown={e=>{if(e.key==="Enter")saveTime(t.id,parseInt(editTimeVal)||0)}} autoFocus />\n                    <button className="btn btn-primary" style={{ fontSize: ".7rem", padding: ".15rem .4rem" }} onClick={()=>saveTime(t.id,parseInt(editTimeVal)||0)}>保存</button>\n                    <button className="btn" style={{ fontSize: ".7rem", padding: ".15rem .4rem" }} onClick={()=>setEditTimeId(null)}>取消</button>\n                  </div>\n                )}\n                {/* Timer row */}\n                {isToday && authed && ('
);

// === 10. Add edit icon next to start button ===
c = c.replace(
  '`开始计时${t.time_spent > 0 ? ` (${Math.floor(t.time_spent/60)}分)` : ""}`}',
  '`开始计时${t.time_spent > 0 ? ` (总计${Math.floor(t.time_spent/60)}分)` : ""}`}\n                        {isToday && t.time_spent > 0 && <button onClick={(e)=>{e.stopPropagation();setEditTimeId(t.id);setEditTimeVal(String(Math.floor(t.time_spent/60)));}} style={{color:"var(--text-muted)",background:"none",border:"none",cursor:"pointer",padding:"0 .2rem"}} title="修改计时"><IconPencil size={12}/></button>}'
);

fs.writeFileSync(f, c, "utf8");
console.log("ALL OK");
