"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import MathText from "@/lib/math-text";
import { useAuth } from "@/lib/auth-gate";
import { useModal } from "@/lib/modal";

interface ChapterNode { id: number; name: string; level: number; }
interface ErrorQuestion {
  id: number; ocr_text: string; question_type: string;
  correct_answer: string; explanation: string | null;
  ai_solutions: string | null; user_answer: string | null;
  error_reason: string | null; image_path: string | null;
  status: string | null; created_at: string;
  kp_name: string | null; chapter_name: string | null; subject_name: string | null;
  subject_id: number | null; chapter_l2_id: number | null;
}

export default function AnalysisErrorsPage() {
  const { authed } = useAuth();
  const modal = useModal();
  const [banks, setBanks] = useState<{id:number;name:string}[]>([]);
  const [bankId, setBankId] = useState<number | null>(null);
  const [subjects, setSubjects] = useState<ChapterNode[]>([]);
  const [chapters, setChapters] = useState<ChapterNode[]>([]);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [chapterL2Id, setChapterL2Id] = useState<number | null>(null);
  const [questions, setQuestions] = useState<ErrorQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [batchReanalyzing, setBatchReanalyzing] = useState(false);
  const [shownImages, setShownImages] = useState<Set<number>>(new Set());
  const reanalyzingIds = useRef<Set<number>>(new Set());

  useEffect(() => {
    fetch("/api/chapters?level=1").then(r => r.json()).then(setSubjects);
    fetch("/api/chapters?banks=1").then(r => r.json()).then(d => { if (d.banks) setBanks(d.banks); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!subjectId) { setChapters([]); return; }
    fetch(`/api/chapters?parent_id=${subjectId}`).then(r => r.json()).then(data => setChapters(data.filter((c: ChapterNode) => c.level === 2)));
  }, [subjectId]);

  const fetchErrors = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ status: "error", pageSize: "9999" });
    if (bankId) params.set("bank_id", String(bankId));
    if (subjectId) params.set("subject_id", String(subjectId));
    if (chapterL2Id) params.set("chapter_l2_id", String(chapterL2Id));
    const res = await fetch(`/api/questions?${params.toString()}`);
    const data = await res.json();
    setQuestions(data.questions || data);
    setLoading(false);
  }, [bankId, subjectId, chapterL2Id]);

  useEffect(() => { fetchErrors(); }, [fetchErrors]);

  const handleReanalyze = async (id: number, mode: "full" | "answer") => {
    if (reanalyzingIds.current.has(id)) return;
    const label = mode === "full" ? "重解析全部（题干+答案+解析）" : "重解析答案（保留题干）";
    const ok = await modal.confirm("确认重解析", `${label}，将在后台运行。继续？`);
    if (!ok) return;
    reanalyzingIds.current.add(id);
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, status: "pending", error_reason: null } : q));
    fetch("/api/reanalyze", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_id: id, mode, reason: "" }),
    }).then(() => {
      modal.alert("已提交", "重解析任务已在后台运行，可稍后刷新查看结果。");
    }).finally(() => { reanalyzingIds.current.delete(id); });
  };

  const handleBatchReanalyze = async () => {
    if (questions.length === 0) return;
    if (!await modal.confirm("一键重解析", `将对 ${questions.length} 道失败题目全部执行重解析（完整模式），在后台运行。继续？`)) return;
    setBatchReanalyzing(true);
    let count = 0;
    for (const q of questions) {
      await fetch("/api/reanalyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question_id: q.id, mode: "full", reason: "" }),
      }).catch(() => {});
      count++;
      setQuestions(prev => prev.map(qq => qq.id === q.id ? { ...qq, status: "pending", error_reason: null } : qq));
      // 队列已有并发限制和冷却，这里间隔500ms避免瞬时大量入队
      if (count % 5 === 0) await new Promise(r => setTimeout(r, 500));
    }
    setBatchReanalyzing(false);
    modal.alert("已提交", `已将 ${count} 道题目提交重解析，后台运行中，可稍后刷新查看结果。`);
  };

  const toggleImage = (id: number) => {
    setShownImages(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: ".75rem", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>解析失败</h1>
        <span style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>
          {questions.length > 0 ? `${questions.length} 道题目解析失败` : ""}
        </span>
        {authed && questions.length > 0 && (
          <button className="btn btn-primary" style={{ fontSize: ".8rem", marginLeft: "auto" }} onClick={handleBatchReanalyze} disabled={batchReanalyzing}>
            {batchReanalyzing ? "提交中..." : "一键重解析全部"}
          </button>
        )}
      </div>

      {/* 筛选栏 */}
      <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "center" }}>
        <select value={bankId ?? ""} onChange={e => { setBankId(e.target.value ? parseInt(e.target.value) : null); }}>
          <option value="">全部题库</option>
          {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={subjectId ?? ""} onChange={e => { const v = e.target.value ? parseInt(e.target.value) : null; setSubjectId(v); setChapterL2Id(null); }}>
          <option value="">全部科目</option>
          {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={chapterL2Id ?? ""} onChange={e => setChapterL2Id(e.target.value ? parseInt(e.target.value) : null)} disabled={!subjectId}>
          <option value="">全部章节</option>
          {chapters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn" style={{ fontSize: ".75rem" }} onClick={fetchErrors}>刷新</button>
      </div>

      {loading ? (
        <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "2rem 0" }}>加载中...</p>
      ) : questions.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "2rem" }}>
          <p style={{ color: "var(--green-text)", fontWeight: 600, marginBottom: ".5rem" }}>没有解析失败的题目</p>
          <p style={{ color: "var(--text-muted)", fontSize: ".85rem" }}>所有题目解析状态正常</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
          {questions.map(q => (
            <div key={q.id} className="card" style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
              {/* 面包屑 + 状态 */}
              <div style={{ display: "flex", alignItems: "center", gap: ".25rem", fontSize: ".75rem", color: "var(--text-muted)", flexWrap: "wrap" }}>
                <span className="badge" style={{ background: "var(--red-bg)", color: "var(--red-text)" }}>
                  {q.status === "pending" ? "重解析中" : "失败"}
                </span>
                {q.subject_name && <span className="tag">{q.subject_name}</span>}
                {q.chapter_name && <><span>›</span><span>{q.chapter_name}</span></>}
                {q.kp_name && <><span>›</span><span>{q.kp_name}</span></>}
                <span style={{ marginLeft: "auto" }}>{q.created_at?.slice(0, 10)}</span>
              </div>

              {/* 错误原因 */}
              {q.error_reason && (
                <div style={{ padding: ".4rem .6rem", borderRadius: "6px", background: "var(--red-bg)", color: "var(--red-text)", fontSize: ".8rem" }}>
                  失败原因：{q.error_reason}
                </div>
              )}

              {/* 题干预览 */}
              <div style={{ fontSize: ".85rem", lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--text-muted)" }}>
                <MathText text={q.ocr_text || "(无OCR文本)"} splitOptions />
              </div>

              {/* 图片 */}
              {q.image_path && shownImages.has(q.id) && (
                <img src={`/api/image/${q.image_path.replace('/uploads/', '')}`} alt="题目图" style={{ maxHeight: "10rem", borderRadius: "6px" }} />
              )}

              {/* 操作 */}
              <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
                {q.image_path && (
                  <button className="btn" style={{ fontSize: ".8rem" }} onClick={() => toggleImage(q.id)}>
                    {shownImages.has(q.id) ? "隐藏图片" : "显示图片"}
                  </button>
                )}
                {authed && q.status !== "pending" && (
                  <>
                    <button className="btn btn-primary" style={{ fontSize: ".8rem" }} onClick={() => handleReanalyze(q.id, "full")}>重解析全部</button>
                    <button className="btn" style={{ fontSize: ".8rem" }} onClick={() => handleReanalyze(q.id, "answer")}>重解析答案</button>
                  </>
                )}
                {q.status === "pending" && (
                  <span style={{ fontSize: ".8rem", color: "var(--yellow-text)" }}>重解析中...</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Link href="/" style={{ fontSize: ".875rem", color: "var(--text-muted)", textDecoration: "none" }}>← 返回首页</Link>
    </div>
  );
}
