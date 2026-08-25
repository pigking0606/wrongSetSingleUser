"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface PaperItem {
  id: number; title: string; subject_name: string | null; label: string | null;
  total: number; total_score: number; created_at: string;
}

export default function MockPapersPage() {
  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [delId, setDelId] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    fetch("/api/mock-papers").then(r => r.json()).then(d => {
      setPapers(Array.isArray(d.papers) ? d.papers : []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const remove = async (id: number) => {
    if (!confirm("确定删除这张试卷的存储记录？(原始错题不受影响)")) return;
    setDelId(id);
    await fetch(`/api/mock-papers?id=${id}`, { method: "DELETE" }).catch(() => {});
    setPapers(prev => prev.filter(p => p.id !== id));
    setDelId(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: ".75rem", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>已存试卷</h1>
        <span style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>打印后逐题校对，更新作答正确与否</span>
        <Link href="/exam-paper" style={{ marginLeft: "auto", fontSize: ".85rem" }}>去拼新卷 →</Link>
      </div>

      {loading ? (
        <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "2rem 0" }}>加载中...</p>
      ) : papers.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "2rem" }}>
          <p style={{ color: "var(--text-muted)", marginBottom: ".75rem" }}>还没有保存的试卷</p>
          <Link href="/exam-paper" style={{ fontSize: ".875rem" }}>去拼一张卷并保存 →</Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
          {papers.map(p => (
            <div key={p.id} className="card" style={{ display: "flex", gap: ".75rem", alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flexGrow: 1, minWidth: "10rem" }}>
                <div style={{ fontWeight: 600, fontSize: ".95rem" }}>
                  <Link href={`/mock-papers/${p.id}`} style={{ color: "inherit", textDecoration: "none" }}>{p.title}</Link>
                </div>
                <div style={{ fontSize: ".78rem", color: "var(--text-muted)", marginTop: ".2rem" }}>
                  {p.total} 题 · 满分 {p.total_score} 分
                  {p.subject_name && <span> · {p.subject_name}</span>}
                  <span> · {p.created_at?.slice(0, 10)}</span>
                </div>
              </div>
              <Link className="btn" style={{ fontSize: ".82rem" }} href={`/mock-papers/${p.id}`}>打印/校对</Link>
              <button className="btn" style={{ fontSize: ".82rem", color: "var(--red-text)" }} onClick={() => remove(p.id)} disabled={delId === p.id}>
                {delId === p.id ? "删除中..." : "删除"}
              </button>
            </div>
          ))}
        </div>
      )}

      <Link href="/" style={{ fontSize: ".875rem", color: "var(--text-muted)", textDecoration: "none" }}>← 返回首页</Link>
    </div>
  );
}