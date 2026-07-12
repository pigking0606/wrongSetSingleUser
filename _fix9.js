const fs = require("fs");

// SETTINGS PAGE: add bank management UI
let f = "C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/app/settings/page.tsx";
let c = fs.readFileSync(f, "utf8");

// Add banks fetch to useEffect
c = c.replace(
  'useEffect(() => {\n    fetch("/api/settings")',
  'useEffect(() => {\n    fetch("/api/chapters?banks=1").then(r=>r.json()).then(d=>{if(d.banks)setBanks(d.banks)}).catch(()=>{});\n    fetch("/api/settings")'
);

// Add bank management section
c = c.replace(
  '      <Link href="/" style={{ fontSize: ".875rem", color: "var(--text-muted)", textDecoration: "none" }}>← 返回首页</Link>\n    </div>\n  );\n}',
  '      {/* Bank Management */}\n      {authed && <div className="card" style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>\n        <h2 style={{ fontSize: ".95rem", fontWeight: 600 }}>题库管理</h2>\n        {banks.map(b => (\n          <div key={b.id} style={{ display: "flex", alignItems: "center", gap: ".5rem", fontSize: ".85rem" }}>\n            <span style={{ flex: 1 }}>{b.name}</span>\n            <button className="btn" style={{ fontSize: ".7rem", color: "var(--red-text)" }}\n              onClick={async () => {\n                if (!await modal.confirm("删除题库", "确定删除题库「" + b.name + "」？")) return;\n                await fetch("/api/chapters", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bankId: b.id }) });\n                fetch("/api/chapters?banks=1").then(r=>r.json()).then(d=>{if(d.banks)setBanks(d.banks)});\n              }} >删除</button>\n          </div>\n        ))}\n        <div style={{ display: "flex", gap: ".5rem" }}>\n          <input value={newBankName} onChange={e=>setNewBankName(e.target.value)} placeholder="新题库名称"\n            style={{ flex: 1, fontSize: ".85rem" }} />\n          <button className="btn btn-primary" style={{ fontSize: ".8rem" }}\n            onClick={async () => {\n              if (!newBankName.trim()) return;\n              const r = await fetch("/api/chapters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bankName: newBankName.trim() }) });\n              if (r.ok) { setNewBankName(""); fetch("/api/chapters?banks=1").then(r=>r.json()).then(d=>{if(d.banks)setBanks(d.banks)}); }\n            }} >添加题库</button>\n        </div>\n      </div>}\n\n      <Link href="/" style={{ fontSize: ".875rem", color: "var(--text-muted)", textDecoration: "none" }}>← 返回首页</Link>\n    </div>\n  );\n}'
);

fs.writeFileSync(f, c, "utf8");
console.log("settings done");

// UPLOAD PAGE: add banks fetch + selector
f = "C:/Users/wkc/Desktop/reasonixWorkSpace/wrong-answer-review/src/app/upload/page.tsx";
c = fs.readFileSync(f, "utf8");

if (!c.includes("useEffect")) {
  c = c.replace('import { useState, useRef, useCallback } from "react"', 'import { useState, useRef, useCallback, useEffect } from "react"');
}

c = c.replace(
  '  // ---- File handling ----',
  '  useEffect(() => { fetch("/api/chapters?banks=1").then(r=>r.json()).then(d=>{if(d.banks)setBanks(d.banks)}).catch(()=>{}); }, []);\n\n  // ---- File handling ----'
);

c = c.replace(
  '      </div>\n\n      {mode === "twoPage"',
  '      </div>\n\n      <div style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>上传到题库：{" "}\n        <select value={bankId} onChange={e=>setBankId(parseInt(e.target.value))} style={{ fontSize: ".8rem" }}>\n          {banks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}\n        </select>\n      </div>\n\n      {mode === "twoPage"'
);

fs.writeFileSync(f, c, "utf8");
console.log("upload done");
console.log("ALL OK");
