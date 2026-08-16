"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { IconEye, IconSparkle, IconCheck, IconRefresh, IconX, IconCalendar } from "@/lib/icons";
import { useAuth } from "@/lib/auth-gate";
import { useModal } from "@/lib/modal";

export default function SettingsPage() {
  const { authed } = useAuth();
  const modal = useModal();
  const [visionKey, setVisionKey] = useState("");
  const [visionModel, setVisionModel] = useState("");
  const [visionUrl, setVisionUrl] = useState("");
  // 是否允许 system role：部分视觉模型（如 GLM-4.6V）不支持 system message，
  // 关闭后 systemPrompt 会合并到 user message，确保 prompt 完整传递
  const [visionAllowSystem, setVisionAllowSystem] = useState(true);
  const [textKey, setTextKey] = useState("");
  const [textModel, setTextModel] = useState("");
  const [textUrl, setTextUrl] = useState("");
  // 阿里云 DashScope 备用文本通道（独立配置，限流时自动切换，不影响主通道）
  const [dashscopeKey, setDashscopeKey] = useState("");
  const [dashscopeModel, setDashscopeModel] = useState("");
  const [dashscopeUrl, setDashscopeUrl] = useState("");
  // 自动解析时段设置
  const [schedEnabled, setSchedEnabled] = useState(false);
  const [schedWindows, setSchedWindows] = useState<Array<{ start: string; end: string }>>([]);
  const [schedExcludes, setSchedExcludes] = useState<Array<{ start: string; end: string }>>([]);
  const [banks, setBanks] = useState<{id:number;name:string}[]>([]);
  const [newBankName, setNewBankName] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  // 测试连接状态：每个模型独立。result 为 null=未测，{ok,message,error,detail,elapsed}=已测
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResult, setTestResult] = useState<Record<string, null | { ok: boolean; message?: string; error?: string; detail?: string; elapsed?: number }>>({});

  useEffect(() => {
    fetch("/api/chapters?banks=1").then(r=>r.json()).then(d=>{if(d.banks)setBanks(d.banks)}).catch(()=>{});
    fetch("/api/settings").then(r => r.json()).then(d => {
      setVisionKey(d.visionKey || "");
      setVisionModel(d.visionModel || "qwen-vl-plus");
      setVisionUrl(d.visionUrl || "");
      setVisionAllowSystem(d.visionAllowSystem !== false);
      setTextKey(d.textKey || "");
      setTextModel(d.textModel || "deepseek-chat");
      setTextUrl(d.textUrl || "");
      setDashscopeKey(d.dashscopeKey || "");
      setDashscopeModel(d.dashscopeModel || "");
      setDashscopeUrl(d.dashscopeUrl || "");
      setSchedEnabled(!!d.analyzeScheduleEnabled);
      setSchedWindows(Array.isArray(d.analyzeScheduleWindows) ? d.analyzeScheduleWindows : []);
      setSchedExcludes(Array.isArray(d.analyzeScheduleExcludes) ? d.analyzeScheduleExcludes : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaved(false);
    const resp = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visionKey: visionKey.trim(), visionModel: visionModel.trim(), visionUrl: visionUrl.trim(),
        visionAllowSystem,
        textKey: textKey.trim(), textModel: textModel.trim(), textUrl: textUrl.trim(),
        dashscopeKey: dashscopeKey.trim(), dashscopeModel: dashscopeModel.trim(), dashscopeUrl: dashscopeUrl.trim(),
        analyzeScheduleEnabled: schedEnabled,
        analyzeScheduleWindows: schedWindows,
        analyzeScheduleExcludes: schedExcludes,
      }),
    });
    if (resp.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    else modal.alert("保存失败", "保存设置失败，请重试");
  };

  // 测试连接：用当前表单填写的值（不读数据库），验证 key/url/model 是否可用
  const testConn = async (kind: "vision" | "text") => {
    const key = (kind === "vision" ? visionKey : textKey).trim();
    const url = (kind === "vision" ? visionUrl : textUrl).trim();
    const model = (kind === "vision" ? visionModel : textModel).trim();
    if (!key) { modal.alert("无法测试", "请先填写 API Key"); return; }
    if (!model) { modal.alert("无法测试", "请先填写模型名"); return; }

    setTesting(s => ({ ...s, [kind]: true }));
    setTestResult(s => ({ ...s, [kind]: null }));
    try {
      const r = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: kind, key, url, model }),
      });
      const d = await r.json();
      setTestResult(s => ({ ...s, [kind]: d }));
    } catch (err) {
      setTestResult(s => ({ ...s, [kind]: { ok: false, error: err instanceof Error ? err.message : String(err) } }));
    } finally {
      setTesting(s => ({ ...s, [kind]: false }));
    }
  };

  if (loading) return <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "3rem 0" }}>加载中...</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>API 设置</h1>

      {/* OCR / Vision Model */}
      <div className="card">
        <h2 style={{ fontSize: ".95rem", fontWeight: 600, marginBottom: ".75rem", display: "flex", alignItems: "center", gap: ".3rem" }}>
            <IconEye size={18} /> OCR识别模型</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
          <div>
            <label style={{ fontSize: ".8rem", display: "block", marginBottom: ".2rem" }}>API Key</label>
            <input type="password" value={visionKey} onChange={e => setVisionKey(e.target.value)} readOnly={!authed}
              placeholder="sk-..." style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".5rem" }}>
            <div>
              <label style={{ fontSize: ".8rem", display: "block", marginBottom: ".2rem" }}>API 地址</label>
              <input value={visionUrl} onChange={e => setVisionUrl(e.target.value)} readOnly={!authed}
                placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" style={{ width: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: ".8rem", display: "block", marginBottom: ".2rem" }}>模型</label>
              <input value={visionModel} onChange={e => setVisionModel(e.target.value)} readOnly={!authed}
                placeholder="qwen-vl-plus" style={{ width: "100%", boxSizing: "border-box" }} />
            </div>
          </div>
          {/* 是否允许 system role：GLM-4.6V 等模型不支持 system message，关闭后 prompt 合并到 user message */}
          <label style={{ fontSize: ".8rem", display: "flex", alignItems: "center", gap: ".4rem", cursor: authed ? "pointer" : "default", color: "var(--text-muted)" }}>
            <input type="checkbox" checked={visionAllowSystem} disabled={!authed}
              onChange={e => setVisionAllowSystem(e.target.checked)} />
            允许 system role
            <span style={{ fontSize: ".7rem" }}>
              （不支持的模型如 GLM-4.6V 请关闭，否则 prompt 会被忽略）
            </span>
          </label>
          {authed && <div style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap" }}>
            <button className="btn" onClick={() => testConn("vision")} disabled={!!testing.vision}
              style={{ fontSize: ".8rem", padding: ".35rem .8rem" }}>
              {testing.vision
                ? <span style={{ display: "flex", alignItems: "center", gap: ".25rem" }}><IconRefresh size={13} /> 测试中...</span>
                : "测试连接"}
            </button>
            {testResult.vision && (
              <span style={{ fontSize: ".75rem", display: "flex", alignItems: "center", gap: ".25rem",
                color: testResult.vision.ok ? "var(--green-text)" : "var(--red-text)" }}>
                {testResult.vision.ok ? <IconCheck size={13} /> : <IconX size={13} />}
                <span>
                  {testResult.vision.ok
                    ? testResult.vision.message
                    : testResult.vision.error}
                  {typeof testResult.vision.elapsed === "number" && ` · ${testResult.vision.elapsed}ms`}
                </span>
              </span>
            )}
          </div>}
          {testResult.vision && !testResult.vision.ok && testResult.vision.detail && (
            <pre style={{ fontSize: ".7rem", color: "var(--text-muted)", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all",
              background: "var(--bg-hover)", padding: ".4rem .5rem", borderRadius: ".25rem", maxHeight: "8rem", overflow: "auto" }}>
              {testResult.vision.detail}
            </pre>
          )}
        </div>
      </div>

      {/* Text Model */}
      <div className="card">
        <h2 style={{ fontSize: ".95rem", fontWeight: 600, marginBottom: ".75rem", display: "flex", alignItems: "center", gap: ".3rem" }}>
            <IconSparkle size={18} /> 解题/文本模型</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
          <div>
            <label style={{ fontSize: ".8rem", display: "block", marginBottom: ".2rem" }}>API Key</label>
            <input type="password" value={textKey} onChange={e => setTextKey(e.target.value)} readOnly={!authed}
              placeholder="与识别相同则留空" style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".5rem" }}>
            <div>
              <label style={{ fontSize: ".8rem", display: "block", marginBottom: ".2rem" }}>API 地址</label>
              <input value={textUrl} onChange={e => setTextUrl(e.target.value)} readOnly={!authed}
                placeholder="https://api.deepseek.com/v1" style={{ width: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: ".8rem", display: "block", marginBottom: ".2rem" }}>模型</label>
              <input value={textModel} onChange={e => setTextModel(e.target.value)} readOnly={!authed}
                placeholder="deepseek-chat" style={{ width: "100%", boxSizing: "border-box" }} />
            </div>
          </div>
          {authed && <div style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap" }}>
            <button className="btn" onClick={() => testConn("text")} disabled={!!testing.text}
              style={{ fontSize: ".8rem", padding: ".35rem .8rem" }}>
              {testing.text
                ? <span style={{ display: "flex", alignItems: "center", gap: ".25rem" }}><IconRefresh size={13} /> 测试中...</span>
                : "测试连接"}
            </button>
            {testResult.text && (
              <span style={{ fontSize: ".75rem", display: "flex", alignItems: "center", gap: ".25rem",
                color: testResult.text.ok ? "var(--green-text)" : "var(--red-text)" }}>
                {testResult.text.ok ? <IconCheck size={13} /> : <IconX size={13} />}
                <span>
                  {testResult.text.ok
                    ? testResult.text.message
                    : testResult.text.error}
                  {typeof testResult.text.elapsed === "number" && ` · ${testResult.text.elapsed}ms`}
                </span>
              </span>
            )}
          </div>}
          {testResult.text && !testResult.text.ok && testResult.text.detail && (
            <pre style={{ fontSize: ".7rem", color: "var(--text-muted)", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all",
              background: "var(--bg-hover)", padding: ".4rem .5rem", borderRadius: ".25rem", maxHeight: "8rem", overflow: "auto" }}>
              {testResult.text.detail}
            </pre>
          )}
        </div>
      </div>

      {/* 阿里云 DashScope 备用文本通道 */}
      <div className="card">
        <h2 style={{ fontSize: ".95rem", fontWeight: 600, marginBottom: ".75rem", display: "flex", alignItems: "center", gap: ".3rem" }}>
            <IconSparkle size={18} /> 阿里云 DashScope 备用文本通道</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
          <p style={{ fontSize: ".75rem", color: "var(--text-muted)", margin: 0 }}>
            独立配置，不影响上方主文本通道。当主通道触发限流（429）时自动切换到本通道重试；配置模型后即启用。
          </p>
          <div>
            <label style={{ fontSize: ".8rem", display: "block", marginBottom: ".2rem" }}>API Key</label>
            <input type="password" value={dashscopeKey} onChange={e => setDashscopeKey(e.target.value)} readOnly={!authed}
              placeholder="留空则使用识别模型的 Key" style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".5rem" }}>
            <div>
              <label style={{ fontSize: ".8rem", display: "block", marginBottom: ".2rem" }}>API 地址</label>
              <input value={dashscopeUrl} onChange={e => setDashscopeUrl(e.target.value)} readOnly={!authed}
                placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" style={{ width: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: ".8rem", display: "block", marginBottom: ".2rem" }}>模型</label>
              <input value={dashscopeModel} onChange={e => setDashscopeModel(e.target.value)} readOnly={!authed}
                placeholder="如 qwen-plus（留空则禁用备用通道）" style={{ width: "100%", boxSizing: "border-box" }} />
            </div>
          </div>
        </div>
      </div>

      {/* 自动解析时段设置 */}
      <div className="card">
        <h2 style={{ fontSize: ".95rem", fontWeight: 600, marginBottom: ".75rem", display: "flex", alignItems: "center", gap: ".3rem" }}>
          <IconCalendar size={18} /> 自动解析时段
        </h2>
        <label style={{ fontSize: ".8rem", display: "flex", alignItems: "center", gap: ".4rem", cursor: authed ? "pointer" : "default", color: "var(--text-muted)", marginBottom: ".5rem" }}>
          <input type="checkbox" checked={schedEnabled} disabled={!authed}
            onChange={e => setSchedEnabled(e.target.checked)} />
          启用时段限制
          <span style={{ fontSize: ".7rem" }}>
            （开启后上传的题目仅在允许时段内自动解析，其余时间排队等待）
          </span>
        </label>

        {schedEnabled && (
          <div style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
            {/* 允许时段 */}
            <div>
              <div style={{ fontSize: ".8rem", fontWeight: 600, marginBottom: ".3rem", color: "var(--green-text)" }}>允许时段（仅这些时段执行解析）</div>
              {schedWindows.map((w, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: ".4rem", marginBottom: ".3rem" }}>
                  <input type="time" value={w.start} disabled={!authed}
                    onChange={e => setSchedWindows(prev => prev.map((x, j) => j === i ? { ...x, start: e.target.value } : x))}
                    style={{ fontSize: ".8rem" }} />
                  <span style={{ color: "var(--text-muted)" }}>—</span>
                  <input type="time" value={w.end} disabled={!authed}
                    onChange={e => setSchedWindows(prev => prev.map((x, j) => j === i ? { ...x, end: e.target.value } : x))}
                    style={{ fontSize: ".8rem" }} />
                  <button className="btn" style={{ fontSize: ".7rem", color: "var(--red-text)", padding: ".2rem .4rem" }}
                    onClick={() => setSchedWindows(prev => prev.filter((_, j) => j !== i))}>删除</button>
                </div>
              ))}
              {authed && <button className="btn" style={{ fontSize: ".75rem", padding: ".3rem .6rem" }}
                onClick={() => setSchedWindows(prev => [...prev, { start: "00:00", end: "06:00" }])}>+ 添加允许时段</button>}
            </div>

            {/* 排除时段 */}
            <div>
              <div style={{ fontSize: ".8rem", fontWeight: 600, marginBottom: ".3rem", color: "var(--red-text)" }}>排除时段（允许时段内不执行的时段）</div>
              {schedExcludes.map((w, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: ".4rem", marginBottom: ".3rem" }}>
                  <input type="time" value={w.start} disabled={!authed}
                    onChange={e => setSchedExcludes(prev => prev.map((x, j) => j === i ? { ...x, start: e.target.value } : x))}
                    style={{ fontSize: ".8rem" }} />
                  <span style={{ color: "var(--text-muted)" }}>—</span>
                  <input type="time" value={w.end} disabled={!authed}
                    onChange={e => setSchedExcludes(prev => prev.map((x, j) => j === i ? { ...x, end: e.target.value } : x))}
                    style={{ fontSize: ".8rem" }} />
                  <button className="btn" style={{ fontSize: ".7rem", color: "var(--red-text)", padding: ".2rem .4rem" }}
                    onClick={() => setSchedExcludes(prev => prev.filter((_, j) => j !== i))}>删除</button>
                </div>
              ))}
              {authed && <button className="btn" style={{ fontSize: ".75rem", padding: ".3rem .6rem" }}
                onClick={() => setSchedExcludes(prev => [...prev, { start: "03:00", end: "03:30" }])}>+ 添加排除时段</button>}
            </div>
            <p style={{ fontSize: ".7rem", color: "var(--text-muted)", margin: 0 }}>
              结束时间为排他（不包含），如 00:00—06:00 表示 00:00 至 05:59。跨天请拆分为两段。
            </p>
          </div>
        )}
      </div>

      {authed && <button className="btn btn-primary" onClick={save} style={{ alignSelf: "flex-start", padding: ".6rem 1.5rem" }}>
        {saved ? <span style={{ display: "flex", alignItems: "center", gap: ".25rem" }}><IconCheck size={14} /> 已保存到服务器</span> : "保存设置"}
      </button>}
      <p style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>
        输入口令后可修改设置。
      </p>

      <Link href="/" style={{ fontSize: ".875rem", color: "var(--text-muted)", textDecoration: "none" }}>← 返回首页</Link>
    {/* 题库管理 */}
    {authed && <div className="card" style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
      <h2 style={{ fontSize: ".95rem", fontWeight: 600 }}>题库管理</h2>
      {banks.map(b => (
        <div key={b.id} style={{ display: "flex", alignItems: "center", gap: ".5rem", fontSize: ".85rem" }}>
          <span style={{ flex: 1 }}>{b.name}</span>
          <button className="btn" style={{ fontSize: ".7rem", color: "var(--red-text)" }}
            onClick={async () => {
              if (!await modal.confirm("删除题库", "确定删除题库「" + b.name + "」？")) return;
              const r = await fetch("/api/chapters", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bankId: b.id }) });
              if (!r.ok) {
                const d = await r.json().catch(() => ({}));
                modal.alert("删除失败", d.error || "请稍后重试");
                return;
              }
              fetch("/api/chapters?banks=1").then(r=>r.json()).then(d=>{if(d.banks)setBanks(d.banks)});
            }} >删除</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: ".5rem" }}>
        <input value={newBankName} onChange={e=>setNewBankName(e.target.value)} placeholder="新题库名称"
          style={{ flex: 1, fontSize: ".85rem" }} />
        <button className="btn btn-primary" style={{ fontSize: ".8rem" }}
          onClick={async () => {
            if (!newBankName.trim()) return;
            const r = await fetch("/api/chapters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bankName: newBankName.trim() }) });
            if (r.ok) { setNewBankName(""); fetch("/api/chapters?banks=1").then(r=>r.json()).then(d=>{if(d.banks)setBanks(d.banks)}); }
          }} >添加题库</button>
      </div>
    </div>}

    <Link href="/" style={{ fontSize: ".875rem", color: "var(--text-muted)", textDecoration: "none" }}>← 返回首页</Link>
    </div>
  );
}

