"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import MathText from "@/lib/math-text";
import { getImageUrl } from "@/lib/image-url";

interface ChapterNode { id: number; name: string; level: number; }
interface PaperQuestion {
  id: number; ocr_text: string; chapter_id: number | null;
  correct_answer: string; explanation: string | null;
  ai_solutions: string | null; user_answer: string | null;
  question_type: string; image_path: string | null;
  difficulty: number;
  kp_name: string | null; chapter_name: string | null; subject_name: string | null;
}
interface PaperSection {
  type: string; label: string; scorePerQ: number; target: number; count: number;
  questions: PaperQuestion[];
}
interface Paper { sections: PaperSection[]; total: number; totalScore: number; hasEnough: boolean; }

export default function ExamPaperPage() {
  const [banks, setBanks] = useState<{ id: number; name: string }[]>([]);
  const [selectedBankIds, setSelectedBankIds] = useState<Set<number>>(new Set());
  const [subjects, setSubjects] = useState<ChapterNode[]>([]);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [paper, setPaper] = useState<Paper | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAllAnswers, setShowAllAnswers] = useState(false);
  const [shownImages, setShownImages] = useState<Set<number>>(new Set());
  const [shownExplanations, setShownExplanations] = useState<Set<number>>(new Set());
  const [savingPaper, setSavingPaper] = useState(false);
  const [savedPaperId, setSavedPaperId] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/chapters?level=1").then(r => r.json()).then(setSubjects).catch(() => {});
    fetch("/api/chapters?banks=1").then(r => r.json()).then(d => { if (d.banks) setBanks(d.banks); }).catch(() => {});
  }, []);

  const toggleBank = (id: number) => {
    setSelectedBankIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 保存生成的试卷快照，供打印后校对
  const savePaper = async () => {
    if (!paper || savingPaper) return;
    setSavingPaper(true);
    setSavedPaperId(null);
    try {
      const subName = subjects.find(s => s.id === subjectId)?.name || "";
      const label = [subName, Array.from(selectedBankIds)
        .map(id => banks.find(b => b.id === id)?.name)
        .filter(Boolean).join(",")].filter(Boolean).join(" · ");
      const d = new Date();
      const title = `错题模拟卷 ${subName} · ${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      const resp = await fetch("/api/mock-papers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, subject_id: subjectId, subject_name: subName || null,
          label: label || null, total: paper.total, total_score: paper.totalScore,
          sections: paper.sections,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || "保存失败");
      setSavedPaperId(data.id);
    } catch {
      alert("保存试卷失败，请重试");
    } finally {
      setSavingPaper(false);
    }
  };

  // 首次进入不自动生成，由用户点击"生成试卷"按钮触发
  const generate = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedBankIds.size > 0) params.set("bank_id", Array.from(selectedBankIds).join(","));
      if (subjectId) params.set("subject_id", String(subjectId));
      const res = await fetch(`/api/exam-paper?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setPaper(null);
        setError(data?.error || "生成失败，请重试");
        return;
      }
      setError(null);
      setPaper(data);
      setShowAllAnswers(false);
      setShownImages(new Set());
      setShownExplanations(new Set());
    } catch {
      setPaper(null);
      setError("网络错误，生成失败");
    } finally {
      setLoading(false);
    }
  }, [selectedBankIds, subjectId]);

  const toggleSet = (set: Set<number>, setter: (s: Set<number>) => void, id: number) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  // 全局连续题号
  let qNo = 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>错题拼好卷</h1>
        <p style={{ color: "var(--text-muted)", fontSize: ".85rem", marginTop: ".25rem" }}>
          系统从错题中自动选样，按考研结构与难度比例（易:中:难 = 3:5:2）拼成一张模拟卷
        </p>
      </div>

      {/* 筛选 + 生成 */}
      <div className="card" style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "center", padding: ".75rem" }}>
        <div style={{ display: "flex", gap: ".25rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>题库：</span>
          {banks.map(b => (
            <label key={b.id} style={{ display: "flex", alignItems: "center", gap: ".25rem", fontSize: ".8rem", cursor: "pointer" }}>
              <input type="checkbox" checked={selectedBankIds.has(b.id)} onChange={() => toggleBank(b.id)} style={{ width: "15px", height: "15px", cursor: "pointer" }} />
              {b.name}
            </label>
          ))}
        </div>
        <select value={subjectId ?? ""} onChange={e => setSubjectId(e.target.value ? parseInt(e.target.value) : null)} style={{ fontSize: ".8rem" }}>
          <option value="" disabled>请选择科目（必选）</option>
          {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="btn btn-primary" style={{ fontSize: ".85rem" }} onClick={generate} disabled={loading || !subjectId} title={!subjectId ? "请先选择科目" : undefined}>
          {loading ? "生成中..." : "生成试卷"}
        </button>
        {!subjectId && <span style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>拼卷仅支持单科目，请先选择科目</span>}
        {paper && paper.total > 0 && (
          <>
          <button className="btn" style={{ fontSize: ".85rem" }} onClick={() => setShowAllAnswers(a => !a)}>
            {showAllAnswers ? "隐藏全部答案" : "显示全部答案"}
          </button>
          <button className="btn btn-primary" style={{ fontSize: ".85rem" }} onClick={savePaper} disabled={savingPaper}>
            {savingPaper ? "保存中..." : "保存试卷"}
          </button>
          {savedPaperId && (
            <span style={{ fontSize: ".8rem", color: "var(--green-text)", display: "inline-flex", alignItems: "center", gap: ".35rem" }}>
              已保存 <Link href={`/mock-papers/${savedPaperId}`} style={{ color: "inherit" }}>去打印/校对 →</Link>
            </span>
          )}
          </>
        )}
      </div>

      {loading ? (
        <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "2rem 0" }}>正在从错题中选样拼卷...</p>
      ) : error ? (
        <div className="card" style={{ textAlign: "center", padding: "2rem", color: "var(--red-text)" }}>
          {error}
        </div>
      ) : !paper || paper.total === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "2rem" }}>
          <p style={{ color: "var(--text-muted)", marginBottom: ".75rem" }}>当前范围内没有可用的错题，请先上传并作答错题</p>
          <Link href="/upload" style={{ fontSize: ".875rem" }}>去上传错题 →</Link>
        </div>
      ) : (
        <>
          {/* 试卷头部 */}
          <div className="card" style={{ textAlign: "center", padding: "1.25rem" }}>
            <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>错题模拟卷 · 考研结构</div>
            <div style={{ fontSize: ".8rem", color: "var(--text-muted)", marginTop: ".25rem" }}>
              共 {paper.total} 题 · 满分 {paper.totalScore} 分
              {!paper.hasEnough && <span style={{ color: "var(--yellow-text)" }}>（错题不足，已按实际数量出卷）</span>}
            </div>
          </div>

          {paper.sections.map(section => {
            if (section.count === 0) return null;
            return (
              <div key={section.type} className="card" style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 700, fontSize: "1rem" }}>{section.label}</span>
                  <span style={{ fontSize: ".78rem", color: "var(--text-muted)" }}>
                    {section.count} 题 {section.type === "solve"
                      ? `· 共 ${Math.round(section.count * section.scorePerQ)} 分`
                      : `· 每题 ${section.scorePerQ} 分`}
                  </span>
                </div>

                {section.questions.map(q => {
                  qNo += 1;
                  const showAnswer = showAllAnswers;
                  return (
                    <div key={q.id} style={{ borderTop: "1px solid var(--border)", paddingTop: ".75rem", display: "flex", flexDirection: "column", gap: ".6rem" }}>
                      {/* 题干（题号内联，符合考研试卷排版） */}
                      <div style={{ fontSize: ".95rem", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                        <span style={{ fontWeight: 600, marginRight: ".25rem" }}>{qNo}.</span>
                        <MathText text={q.ocr_text} splitOptions />
                      </div>

                      {/* 图片 */}
                      {q.image_path && (
                        <div>
                          <button className="btn" style={{ fontSize: ".78rem" }} onClick={() => toggleSet(shownImages, setShownImages, q.id)}>
                            {shownImages.has(q.id) ? "隐藏图片" : "显示图片"}
                          </button>
                          {shownImages.has(q.id) && (
                            <div style={{ marginTop: ".5rem" }}>
                              <img src={getImageUrl(q.image_path) || ""} alt="题目图" style={{ maxWidth: "100%", maxHeight: "16rem", borderRadius: "6px" }} />
                            </div>
                          )}
                        </div>
                      )}

                      {/* 答案 */}
                      {showAnswer && (
                        <div style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
                          <div style={{ padding: ".5rem .75rem", borderRadius: "6px", background: "var(--green-bg)", color: "var(--green-text)", fontSize: ".875rem" }}>
                            答案：<MathText text={q.correct_answer} />
                            {q.user_answer && (
                              <span style={{ marginLeft: ".5rem", fontSize: ".75rem", color: "var(--red-text)" }}>
                                (你答：<MathText text={q.user_answer} />)
                              </span>
                            )}
                          </div>
                          {q.explanation && (
                            <div>
                              <button className="btn" style={{ fontSize: ".78rem" }} onClick={() => toggleSet(shownExplanations, setShownExplanations, q.id)}>
                                {shownExplanations.has(q.id) ? "隐藏解析" : "显示解析"}
                              </button>
                              {shownExplanations.has(q.id) && (
                                <div style={{ marginTop: ".5rem", padding: ".75rem", borderRadius: "6px", background: "var(--bg-hover)", fontSize: ".85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                                  <MathText text={q.explanation} />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </>
      )}

      <Link href="/" style={{ fontSize: ".875rem", color: "var(--text-muted)", textDecoration: "none" }}>← 返回首页</Link>
    </div>
  );
}
