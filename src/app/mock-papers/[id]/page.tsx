"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import MathText from "@/lib/math-text";

interface PaperQuestion {
  id: number; ocr_text: string; correct_answer: string; explanation: string | null;
  user_answer: string | null; question_type: string; image_path: string | null;
}
interface PaperSection { type: string; label: string; scorePerQ: number; count: number; questions: PaperQuestion[]; }
interface AnswerRec {
  myAnswer: string;
  correctness: "correct" | "wrong" | null;
}

export default function MockPaperDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const pid = parseInt(params.id || "", 10);

  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [subjectName, setSubjectName] = useState<string | null>(null);
  const [totalScore, setTotalScore] = useState(0);
  const [sections, setSections] = useState<PaperSection[]>([]);
  const [answers, setAnswers] = useState<Record<number, AnswerRec>>({});
  const [showAnswers, setShowAnswers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/mock-papers?id=${pid}`);
      const data = await res.json();
      if (!res.ok || !data.paper) { setLoading(false); return; }
      const p = data.paper;
      setTitle(p.title || "");
      setSubjectName(p.subject_name || null);
      setTotalScore(p.total_score || 0);
      setSections(p.sections || []);
      setAnswers(p.answerRecords && typeof p.answerRecords === "object" ? p.answerRecords : {});
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [pid]);

  const setAns = (qid: number, patch: Partial<AnswerRec>) => {
    setSaved(false);
    setAnswers(prev => {
      const base: AnswerRec = prev[qid] || { myAnswer: "", correctness: null };
      return { ...prev, [qid]: { ...base, ...patch } };
    });
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const resp = await fetch(`/api/mock-papers?id=${pid}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer_records: answers }),
      });
      if (resp.ok) setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const counts = useMemo(() => {
    let correct = 0, wrong = 0, blank = 0;
    Object.values(answers).forEach(a => {
      if (a.correctness === "correct") correct++;
      else if (a.correctness === "wrong") wrong++;
      else blank++;
    });
    return { correct, wrong, blank };
  }, [answers]);

  // 全局连续题号
  let qNo = 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* 工具栏（打印时隐藏） */}
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: ".75rem", flexWrap: "wrap" }}>
        <button className="btn" style={{ fontSize: ".85rem" }} onClick={() => router.back()}>← 返回</button>
        <button className="btn btn-primary" style={{ fontSize: ".85rem" }} onClick={() => window.print()}>打印试卷</button>
        <button className="btn" style={{ fontSize: ".85rem" }} onClick={() => setShowAnswers(a => !a)}>
          {showAnswers ? "隐藏答案" : "显示答案"}
        </button>
        <button className="btn" style={{ fontSize: ".85rem" }} onClick={save} disabled={saving}>
          {saving ? "保存中..." : "保存校对"}
        </button>
        {saved && <span style={{ fontSize: ".8rem", color: "var(--green-text)" }}>已保存校对记录</span>}
        <span style={{ marginLeft: "auto", fontSize: ".8rem", color: "var(--text-muted)" }}>
          已对 {counts.correct + counts.wrong}/{Object.keys(answers).length} 题 ·
          <span style={{ color: "var(--green-text)" }}> 对 {counts.correct}</span>
          <span style={{ color: "var(--red-text)" }}> · 错 {counts.wrong}</span>
        </span>
      </div>

      {loading ? (
        <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "2rem 0" }}>加载中...</p>
      ) : sections.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "2rem" }}>
          <p style={{ color: "var(--text-muted)" }}>试卷不存在或已被删除</p>
          <button className="btn" style={{ fontSize: ".85rem" }} onClick={() => router.push("/mock-papers")}>返回已存试卷</button>
        </div>
      ) : (
        <>
          {/* 试卷头 */}
          <div className="card" style={{ textAlign: "center", padding: "1.25rem" }}>
            <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{title || "错题模拟卷"}</div>
            <div style={{ fontSize: ".8rem", color: "var(--text-muted)", marginTop: ".25rem" }}>
              共 {sections.reduce((s, x) => s + x.questions.length, 0)} 题 · 满分 {totalScore} 分
              {subjectName && <span> · {subjectName}</span>}
            </div>
          </div>

          {sections.map(section => {
            if (section.questions.length === 0) return null;
            return (
              <div key={section.type} className="card print-area" style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
                <div style={{ fontWeight: 700, fontSize: "1rem" }}>{section.label}</div>

                {section.questions.map(q => {
                  qNo += 1;
                  const rec = answers[q.id] || { myAnswer: "", correctness: null };
                  return (
                    <div key={q.id} style={{ borderTop: "1px solid var(--border)", paddingTop: ".75rem", display: "flex", flexDirection: "column", gap: ".5rem" }}>
                      {/* 题干（打印内容） */}
                      <div style={{ fontSize: ".95rem", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                        <span style={{ fontWeight: 600, marginRight: ".25rem" }}>{qNo}.</span>
                        <MathText text={q.ocr_text} splitOptions />
                      </div>

                      {q.image_path && (
                        <div>
                          <img src={`/api/image/${q.image_path.replace('/uploads/', '')}`} alt="题目图" style={{ maxWidth: "100%", maxHeight: "14rem", borderRadius: "6px" }} />
                        </div>
                      )}

                      {/* 答题空间（打印专用） */}
                      {section.type === "solve" && (
                        <div style={{ minHeight: "6rem", border: "1px dashed var(--border)", borderRadius: "6px", marginTop: ".25rem" }} />
                      )}

                      {/* 答案+对错标记（打印时隐藏） */}
                      <div className="no-print" style={{ display: "flex", flexDirection: "column", gap: ".4rem", marginTop: ".25rem" }}>
                        {showAnswers && (
                          <div style={{ padding: ".5rem .75rem", borderRadius: "6px", background: "var(--green-bg)", color: "var(--green-text)", fontSize: ".875rem" }}>
                            答案：<MathText text={q.correct_answer} />
                            {q.user_answer && <span style={{ marginLeft: ".5rem", fontSize: ".75rem", color: "var(--text-muted)" }}>(你曾答：<MathText text={q.user_answer} />)</span>}
                          </div>
                        )}
                        <div style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap", background: "var(--bg-hover)", padding: ".5rem .75rem", borderRadius: "6px" }}>
                          <label style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>在校对答案</label>
                          <input
                            value={rec.myAnswer}
                            onChange={e => setAns(q.id, { myAnswer: e.target.value })}
                            placeholder="本题作答"
                            style={{ flex: 1, minWidth: "6rem", fontSize: ".85rem", boxSizing: "border-box" }}
                          />
                          <button className="btn" style={{ fontSize: ".8rem", color: rec.correctness === "wrong" ? "var(--red-text)" : "var(--text-muted)", border: rec.correctness === "wrong" ? "1px solid var(--red-text)" : undefined }} onClick={() => setAns(q.id, { correctness: "wrong" })}>答错</button>
                          <button className="btn" style={{ fontSize: ".8rem", color: rec.correctness === "correct" ? "var(--green-text)" : "var(--text-muted)", border: rec.correctness === "correct" ? "1px solid var(--green-text)" : undefined }} onClick={() => setAns(q.id, { correctness: "correct" })}>答对</button>
                          {(rec.correctness || rec.myAnswer) && (
                            <button className="btn" style={{ fontSize: ".8rem" }} onClick={() => setAns(q.id, { myAnswer: "", correctness: null })}>清除</button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </>
      )}

      <style>{`
        @media print {
          body { background: #fff; }
          .no-print { display: none !important; }
          .card { box-shadow: none !important; border: none !important; break-inside: avoid; }
          .print-area { padding: 0 !important; }
        }
      `}</style>
    </div>
  );
}