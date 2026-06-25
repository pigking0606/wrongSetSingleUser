"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import MathText from "@/lib/math-text";
import { ExportPdfModal } from "@/lib/export-pdf-modal";
import type { PdfQuestion } from "@/lib/pdf-export";

interface ChapterNode { id: number; name: string; level: number; }
interface Question {
  id: number; chapter_id: number; image_path: string | null;
  ocr_text: string; question_type: string; correct_answer: string;
  explanation: string | null; ai_solutions: string | null;
  user_answer: string | null; error_reason: string | null;
  original_filename: string | null; created_at: string;
  status: string | null;
  kp_name: string | null; chapter_name: string | null;
  subject_name: string | null; subject_id: number | null; chapter_l2_id: number | null;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(y, m - 1, day);
  return `${m}月${day}日 周${["日","一","二","三","四","五","六"][dt.getDay()]}`;
}

function addDays(d: string, n: number): string {
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(y, m - 1, day + n);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
}

export default function DailyQuestionsPage() {
  const [curDate, setCurDate] = useState(today());
  const [subjects, setSubjects] = useState<ChapterNode[]>([]);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [chapters, setChapters] = useState<ChapterNode[]>([]);
  const [kps, setKps] = useState<ChapterNode[]>([]);
  const [chapterL2Id, setChapterL2Id] = useState<number | null>(null);
  const [kpId, setKpId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  const [shownAnswers, setShownAnswers] = useState<Set<number>>(new Set());
  const [shownExplanations, setShownExplanations] = useState<Set<number>>(new Set());
  const [shownImages, setShownImages] = useState<Set<number>>(new Set());
  const [showExport, setShowExport] = useState(false);

  useEffect(() => {
    fetch("/api/chapters?level=1").then(r => r.json()).then(setSubjects).catch(() => {});
  }, []);

  useEffect(() => {
    if (!subjectId) { setChapters([]); setKps([]); return; }
    fetch(`/api/chapters?parent_id=${subjectId}`).then(r => r.json()).then(data => setChapters(data.filter((c: ChapterNode) => c.level === 2)));
  }, [subjectId]);

  useEffect(() => {
    if (!chapterL2Id) { setKps([]); return; }
    fetch(`/api/chapters?parent_id=${chapterL2Id}`).then(r => r.json()).then(data => setKps(data.filter((c: ChapterNode) => c.level === 3)));
  }, [chapterL2Id]);

  const fetchQuestions = useCallback(async (date: string, sid: number | null, cid: number | null, kid: number | null) => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("from", date);
    params.set("to", date);
    params.set("pageSize", "200");
    if (sid) params.set("subject_id", String(sid));
    if (cid) params.set("chapter_l2_id", String(cid));
    if (kid) params.set("chapter_id", String(kid));
    try {
      const resp = await fetch(`/api/questions?${params.toString()}`);
      const data = await resp.json();
      setQuestions(data.questions || data);
    } catch { setQuestions([]); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchQuestions(curDate, subjectId, chapterL2Id, kpId); }, [curDate, subjectId, chapterL2Id, kpId, fetchQuestions]);

  const toggle = (set: Set<number>, setter: (s: Set<number>) => void, id: number) => {
    const next = new Set(set); next.has(id) ? next.delete(id) : next.add(id); setter(next);
  };

  const isToday = curDate === today();
  const countBySubject: Record<string, number> = {};
  for (const q of questions) {
    const s = q.subject_name || "未分类";
    countBySubject[s] = (countBySubject[s] || 0) + 1;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: ".75rem", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, flex: 1 }}>每日新题</h1>
        <Link href="/" className="btn" style={{ fontSize: ".8rem", textDecoration: "none" }}>← 返回首页</Link>
      </div>

      {/* Date navigation */}
      <div style={{ display: "flex", alignItems: "center", gap: ".5rem", justifyContent: "center" }}>
        <button className="btn" onClick={() => setCurDate(addDays(curDate, -1))} style={{ padding: ".35rem .5rem" }}>
          ←
        </button>
        <span style={{ fontWeight: 600, fontSize: ".9rem", minWidth: "10rem", textAlign: "center" }}>
          {fmtDate(curDate)} {isToday ? "(今天)" : ""}
        </span>
        <button className="btn" onClick={() => setCurDate(addDays(curDate, 1))} style={{ padding: ".35rem .5rem" }} disabled={isToday}>
          →
        </button>
      </div>

      {/* Subject filter */}
      <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "center" }}>
        <select value={subjectId ?? ""} onChange={e => { const v = e.target.value ? parseInt(e.target.value) : null; setSubjectId(v); setChapterL2Id(null); setKpId(null); }}>
          <option value="">全部科目</option>
          {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={chapterL2Id ?? ""} onChange={e => { const v = e.target.value ? parseInt(e.target.value) : null; setChapterL2Id(v); setKpId(null); }} disabled={!subjectId}>
          <option value="">全部章节</option>
          {chapters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={kpId ?? ""} onChange={e => setKpId(e.target.value ? parseInt(e.target.value) : null)} disabled={!chapterL2Id}>
          <option value="">全部知识点</option>
          {kps.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
        {Object.keys(countBySubject).length > 0 && (
          <span style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>
            {Object.entries(countBySubject).map(([k, v]) => `${k}:${v}题`).join(" · ")}
          </span>
        )}
      </div>

      {/* PDF Export */}
      {questions.length > 0 && (
        <div>
          <button className="btn btn-primary" style={{ fontSize: ".8rem", padding: ".35rem .8rem" }} onClick={() => setShowExport(true)}>
            📄 导出 PDF
          </button>
          {showExport && (
            <ExportPdfModal
              questions={questions as PdfQuestion[]}
              label={subjectId ? subjects.find(s => s.id === subjectId)?.name || curDate : curDate}
              defaultTitle={`每日新题 · ${fmtDate(curDate)}`}
              onClose={() => setShowExport(false)}
            />
          )}
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "2rem 0" }}>加载中...</p>
      ) : questions.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "2rem" }}>
          <p style={{ color: "var(--text-muted)" }}>{fmtDate(curDate)} 没有新增题目</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
          <p style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>共 {questions.length} 道题目</p>
          {questions.map(q => (
            <div key={q.id} className="card" style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: ".25rem", fontSize: ".75rem", color: "var(--text-muted)", flexWrap: "wrap" }}>
                {q.subject_name && <span className="tag">{q.subject_name}</span>}
                {q.chapter_name && <><span>›</span><span>{q.chapter_name}</span></>}
                {q.kp_name && <><span>›</span><span style={{ color: "var(--text-muted)" }}>{q.kp_name}</span></>}
                <span className="badge" style={{ marginLeft: ".5rem" }}>{q.question_type}</span>
                {q.status && q.status !== "ready" && (
                  <span className="badge" style={{
                    background: q.status === "pending" ? "var(--yellow-bg)" : "var(--red-bg)",
                    color: q.status === "pending" ? "var(--yellow-text)" : "var(--red-text)",
                    marginLeft: ".25rem",
                  }}>
                    {q.status === "pending" ? "分析中" : q.status}
                  </span>
                )}
                <span style={{ marginLeft: "auto", fontSize: ".7rem" }}>{q.created_at?.slice(11, 19)}</span>
              </div>

              {q.image_path && shownImages.has(q.id) && (
                <img src={`/api/image/${q.image_path.replace('/uploads/', '')}`} alt="题目图" style={{ maxHeight: "10rem", borderRadius: "6px" }} />
              )}

              <div style={{ fontSize: ".9rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}><MathText text={q.ocr_text} /></div>

              {q.user_answer && (
                <div style={{ padding: ".4rem .6rem", borderRadius: "6px", background: "var(--yellow-bg)", color: "var(--yellow-text)", fontSize: ".8rem" }}>
                  你的答案：<MathText text={q.user_answer} />
                </div>
              )}

              <div style={{ display: "flex", gap: ".75rem", flexWrap: "wrap", alignItems: "center" }}>
                <button className="btn" style={{ fontSize: ".8rem" }} onClick={() => toggle(shownAnswers, setShownAnswers, q.id)}>
                  {shownAnswers.has(q.id) ? "隐藏答案" : "显示答案"}
                </button>
                {q.explanation && (
                  <button className="btn" style={{ fontSize: ".8rem" }} onClick={() => toggle(shownExplanations, setShownExplanations, q.id)}>
                    {shownExplanations.has(q.id) ? "隐藏解析" : "显示解析"}
                  </button>
                )}
                {q.image_path && (
                  <button className="btn" style={{ fontSize: ".8rem" }} onClick={() => toggle(shownImages, setShownImages, q.id)}>
                    {shownImages.has(q.id) ? "隐藏图片" : "显示图片"}
                  </button>
                )}
              </div>

              {shownAnswers.has(q.id) && (
                <div style={{ padding: ".5rem .75rem", borderRadius: "6px", background: "var(--green-bg)", color: "var(--green-text)", fontSize: ".875rem" }}>
                  正确答案：<MathText text={q.correct_answer} />
                </div>
              )}

              {shownExplanations.has(q.id) && q.explanation && (
                <div style={{ padding: ".75rem", borderRadius: "6px", background: "var(--bg-hover)", fontSize: ".85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                  <MathText text={q.explanation} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}