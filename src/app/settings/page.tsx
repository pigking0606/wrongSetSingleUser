"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { IconEye, IconSparkle } from "@/lib/icons";
import { useAuth } from "@/lib/auth-gate";
import { useModal } from "@/lib/modal";

export default function SettingsPage() {
  const { authed } = useAuth();
  const modal = useModal();
  const [visionKey, setVisionKey] = useState("");
  const [visionModel, setVisionModel] = useState("");
  const [visionUrl, setVisionUrl] = useState("");
  const [textKey, setTextKey] = useState("");
  const [textModel, setTextModel] = useState("");
  const [textUrl, setTextUrl] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(d => {
      setVisionKey(d.visionKey || "");
      setVisionModel(d.visionModel || "qwen-vl-plus");
      setVisionUrl(d.visionUrl || "");
      setTextKey(d.textKey || "");
      setTextModel(d.textModel || "deepseek-chat");
      setTextUrl(d.textUrl || "");
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
        textKey: textKey.trim(), textModel: textModel.trim(), textUrl: textUrl.trim(),
      }),
    });
    if (resp.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    else modal.alert("保存失败", "保存设置失败，请重试");
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
        </div>
      </div>

      {authed && <button className="btn btn-primary" onClick={save} style={{ alignSelf: "flex-start", padding: ".6rem 1.5rem" }}>
        {saved ? "✓ 已保存到服务器" : "保存设置"}
      </button>}
      <p style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>
        输入口令后可修改设置。
      </p>

      <Link href="/" style={{ fontSize: ".875rem", color: "var(--text-muted)", textDecoration: "none" }}>← 返回首页</Link>
    </div>
  );
}
