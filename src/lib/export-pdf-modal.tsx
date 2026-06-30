"use client";

import { useState } from "react";
import { exportQuestionsPdf, type PdfQuestion } from "@/lib/pdf-export";

interface ExportPdfModalProps {
  questions: PdfQuestion[];
  label: string;
  defaultTitle: string;
  onClose: () => void;
}

export function ExportPdfModal({ questions, label, defaultTitle, onClose }: ExportPdfModalProps) {
  const [count, setCount] = useState(questions.length);
  const [includeAnswers, setIncludeAnswers] = useState(true);

  const handleExport = () => {
    const slice = questions.slice(0, count);
    const suffix = includeAnswers ? "" : "_纯题目";
    const title = includeAnswers ? defaultTitle : `${defaultTitle}（纯题目）`;
    exportQuestionsPdf(slice, `错题_${label}${suffix}.pdf`, includeAnswers, `${title} · ${slice.length}题`);
    onClose();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 10000,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,.45)", backdropFilter: "blur(2px)",
    }} onClick={onClose}>
      <div className="card" style={{
        maxWidth: "400px", width: "90%", padding: "1.25rem 1.5rem",
        display: "flex", flexDirection: "column", gap: ".75rem",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>导出 PDF</div>
        <div style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>
          共 {questions.length} 道题目可选
        </div>

        {/* Count */}
        <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
          <label style={{ fontSize: ".85rem", fontWeight: 500, minWidth: "4rem" }}>导出数量</label>
          <input type="number" min={1} max={questions.length} value={count}
            onChange={e => { const v = parseInt(e.target.value); if (v >= 1 && v <= questions.length) setCount(v); }}
            style={{ width: "70px", boxSizing: "border-box", fontSize: ".85rem", padding: ".3rem" }} />
          <span style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>/ {questions.length} 题</span>
        </div>

        {/* Include answers */}
        <label style={{ display: "flex", alignItems: "center", gap: ".5rem", cursor: "pointer", fontSize: ".85rem" }}>
          <input type="checkbox" checked={includeAnswers} onChange={e => setIncludeAnswers(e.target.checked)}
            style={{ width: "16px", height: "16px", cursor: "pointer" }} />
          包含答案和解析
        </label>

        {/* Buttons */}
        <div style={{ display: "flex", gap: ".5rem", justifyContent: "flex-end", marginTop: ".25rem" }}>
          <button className="btn" style={{ fontSize: ".85rem", padding: ".4rem 1rem" }} onClick={onClose}>取消</button>
          <button className="btn btn-primary" style={{ fontSize: ".85rem", padding: ".4rem 1rem" }} onClick={handleExport}>
            确认导出 {count} 题
          </button>
        </div>
      </div>
    </div>
  );
}