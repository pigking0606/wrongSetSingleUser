"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import MathText from "@/lib/math-text";
import { useAuth } from "@/lib/auth-gate";
import { ExportPdfModal } from "@/lib/export-pdf-modal";
import { IconFileText, IconCheck, IconX } from "@/lib/icons";
import { useModal } from "@/lib/modal";
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
  const [reviewed, setReviewed] = useState<Record<number, "correct" | "wrong">>({});
  const [shownSolutions, setShownSolutions] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editForm, setEditForm] = useState({ ocr_text: "", correct_answer: "", question_type: "single_choice", explanation: "", ai_solutions: "", user_answer: "" });
  const [editChapterId, setEditChapterId] = useState<number>(0);
  const [editSubjectId, setEditSubjectId] = useState<number | null>(null);
  const [editChapterL2Id, setEditChapterL2Id] = useState<number | null>(null);
  const [editChapters, setEditChapters] = useState<ChapterNode[]>([]);
  const [editKps, setEditKps] = useState<ChapterNode[]>([]);

  const { authed } = useAuth();
  const modal = useModal();
  const QUESTION_TYPES = ["single_choice", "multiple_choice", "true_false", "fill_blank", "short_answer", "comprehensive"];
  const parseSolutions = (raw: string | null) => { if (!raw) return []; try { return JSON.parse(raw); } catch { return []; } };

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

  // 标记对错：调用 /api/review，按复习入库方式记录
  const handleReview = async (q: Question, correct: boolean) => {
    try {
      await fetch("/api/review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question_id: q.id, correct }),
      });
      setReviewed(prev => ({ ...prev, [q.id]: correct ? "correct" : "wrong" }));
    } catch { /* ignore */ }
  };

  const handleReanalyze = async (id: number, mode: "full" | "answer") => {
    const label = mode === "full" ? "重解析全部（题干+答案+解析）" : "重解析答案（保留题干，重新生成答案解析）";
    const reason = await modal.prompt("重解析原因", "如之前的解析有错误，请填写原因（可选，帮助AI修正）：", "如：解析错误、分类不对");
    if (reason === null) return; // user cancelled
    const ok = await modal.confirm("确认重解析", `${label}${reason ? "（原因：" + reason + "）" : ""}，将在后台运行。继续？`);
    if (!ok) return;
    fetch("/api/reanalyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question_id: id, mode, reason: reason || "" }) })
      .then(() => {
        setQuestions(prev => prev.map(qq => qq.id === id ? { ...qq, status: "pending", error_reason: null } : qq));
      });
  };

  const startEdit = async (q: Question) => {
    setEditLoading(true);
    try {
      let chs: ChapterNode[] = [];
      let kpsData: ChapterNode[] = [];
      let subId: number | null = null;
      let chL2Id: number | null = null;
      if (q.subject_id) {
        subId = q.subject_id;
        const chRes = await fetch(`/api/chapters?parent_id=${q.subject_id}`).then(r => r.json()).catch(() => []);
        chs = Array.isArray(chRes) ? chRes : [];
        if (q.chapter_l2_id) {
          chL2Id = q.chapter_l2_id;
          const kpRes = await fetch(`/api/chapters?parent_id=${q.chapter_l2_id}`).then(r => r.json()).catch(() => []);
          kpsData = Array.isArray(kpRes) ? kpRes : [];
        }
      }
      setEditForm({
        ocr_text: q.ocr_text || "",
        correct_answer: q.correct_answer || "",
        question_type: q.question_type || "single_choice",
        explanation: q.explanation || "",
        ai_solutions: q.ai_solutions || "",
        user_answer: q.user_answer || "",
      });
      setEditChapterId(q.chapter_id);
      setEditSubjectId(subId);
      setEditChapterL2Id(chL2Id);
      setEditChapters(chs);
      setEditKps(kpsData);
      setEditingId(q.id);
    } catch {
      modal.alert("编辑失败", "加载编辑数据失败，请重试");
    } finally {
      setEditLoading(false);
    }
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (id: number) => {
    let aiSolutions;
    try { aiSolutions = JSON.parse(editForm.ai_solutions); } catch { aiSolutions = editForm.ai_solutions; }
    const resp = await fetch(`/api/questions?id=${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...editForm, ai_solutions: aiSolutions, chapter_id: editChapterId || undefined }),
    });
    if (!resp.ok) { modal.alert("保存失败", "保存失败，请重试"); return; }
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, ...editForm, ai_solutions: editForm.ai_solutions, chapter_id: editChapterId || q.chapter_id } : q));
    setEditingId(null);
  };

  const handleEditSubjectChange = async (sid: string) => {
    if (!sid) { setEditSubjectId(null); setEditChapters([]); setEditChapterL2Id(null); setEditKps([]); setEditChapterId(0); return; }
    const id = parseInt(sid);
    setEditSubjectId(id);
    setEditChapterL2Id(null); setEditKps([]); setEditChapterId(0);
    setEditChapters(await fetch(`/api/chapters?parent_id=${id}`).then(r => r.json()));
  };
  const handleEditChapterChange = async (cid: string) => {
    if (!cid) { setEditChapterL2Id(null); setEditKps([]); setEditChapterId(0); return; }
    const id = parseInt(cid);
    setEditChapterL2Id(id);
    setEditKps([]); setEditChapterId(0);
    setEditKps(await fetch(`/api/chapters?parent_id=${id}`).then(r => r.json()));
  };
  const handleEditKpChange = (kid: string) => {
    if (!kid) { setEditChapterId(0); return; }
    setEditChapterId(parseInt(kid));
  };

  const handleDelete = async (id: number) => {
    if (!authed) return;
    if (!await modal.confirm("删除题目", "确定删除？此操作不可恢复。")) return;
    await fetch(`/api/questions?id=${id}`, { method: "DELETE" });
    setQuestions(prev => prev.filter(q => q.id !== id));
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
            <span style={{ display: "flex", alignItems: "center", gap: ".25rem" }}><IconFileText size={14} /> 导出 PDF</span>
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
          {questions.map(q => {
            const solutions = parseSolutions(q.ai_solutions);
            const isEditing = editingId === q.id;
            if (isEditing) {
              return (
                <div key={q.id} className="card" style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
                  <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
                    <span style={{ fontSize: ".8rem", fontWeight: 600 }}>编辑题目 #{q.id}</span>
                    <select value={editForm.question_type} onChange={e => setEditForm(f => ({ ...f, question_type: e.target.value }))} style={{ fontSize: ".8rem", marginLeft: "auto" }}>
                      {QUESTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
                    <select value={editSubjectId ?? ""} onChange={e => handleEditSubjectChange(e.target.value)} style={{ fontSize: ".8rem", flex: 1 }}>
                      <option value="">选择科目</option>
                      {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <select value={editChapterL2Id ?? ""} onChange={e => handleEditChapterChange(e.target.value)} style={{ fontSize: ".8rem", flex: 1 }} disabled={!editSubjectId}>
                      <option value="">选择章节</option>
                      {editChapters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <select value={editChapterId ?? ""} onChange={e => handleEditKpChange(e.target.value)} style={{ fontSize: ".8rem", flex: 1 }} disabled={!editChapterL2Id}>
                      <option value="">选择知识点</option>
                      {editKps.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                    </select>
                  </div>
                  <label style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>题干 (OCR)</label>
                  <textarea value={editForm.ocr_text} onChange={e => setEditForm(f => ({ ...f, ocr_text: e.target.value }))} rows={4} style={{ width: "100%", boxSizing: "border-box", fontSize: ".85rem", fontFamily: "inherit" }} />
                  <div style={{ display: "flex", gap: ".5rem" }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>正确答案</label>
                      <input value={editForm.correct_answer} onChange={e => setEditForm(f => ({ ...f, correct_answer: e.target.value }))} style={{ width: "100%", boxSizing: "border-box", fontSize: ".85rem" }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>你的答案</label>
                      <input value={editForm.user_answer} onChange={e => setEditForm(f => ({ ...f, user_answer: e.target.value }))} style={{ width: "100%", boxSizing: "border-box", fontSize: ".85rem" }} />
                    </div>
                  </div>
                  <label style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>解析</label>
                  <textarea value={editForm.explanation} onChange={e => setEditForm(f => ({ ...f, explanation: e.target.value }))} rows={4} style={{ width: "100%", boxSizing: "border-box", fontSize: ".85rem", fontFamily: "inherit" }} />
                  <label style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>解法 JSON</label>
                  <textarea value={editForm.ai_solutions} onChange={e => setEditForm(f => ({ ...f, ai_solutions: e.target.value }))} rows={5} style={{ width: "100%", boxSizing: "border-box", fontSize: ".8rem", fontFamily: "monospace" }} />
                  <div style={{ display: "flex", gap: ".5rem" }}>
                    <button className="btn btn-primary" style={{ fontSize: ".85rem" }} onClick={() => saveEdit(q.id)}>保存</button>
                    <button className="btn" style={{ fontSize: ".85rem" }} onClick={cancelEdit}>取消</button>
                  </div>
                </div>
              );
            }
            return (
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

              <div style={{ fontSize: ".9rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}><MathText text={q.ocr_text} splitOptions /></div>

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
                {solutions.length > 0 && (
                  <button className="btn" style={{ fontSize: ".8rem" }} onClick={() => toggle(shownSolutions, setShownSolutions, q.id)}>
                    {shownSolutions.has(q.id) ? `隐藏解法(${solutions.length})` : `显示解法(${solutions.length})`}
                  </button>
                )}
                {q.image_path && (
                  <button className="btn" style={{ fontSize: ".8rem" }} onClick={() => toggle(shownImages, setShownImages, q.id)}>
                    {shownImages.has(q.id) ? "隐藏图片" : "显示图片"}
                  </button>
                )}
                {reviewed[q.id] ? (
                  <span style={{
                    display: "inline-flex", alignItems: "center",
                    color: reviewed[q.id] === "correct" ? "var(--green-text)" : "var(--red-text)",
                  }}>
                    {reviewed[q.id] === "correct" ? <IconCheck size={16} /> : <IconX size={16} />}
                  </span>
                ) : (
                  <>
                    <button className="btn" style={{ fontSize: ".8rem", display: "inline-flex", alignItems: "center" }}
                      onClick={() => handleReview(q, false)} title="答错">
                      <IconX size={16} />
                    </button>
                    <button className="btn" style={{ fontSize: ".8rem", display: "inline-flex", alignItems: "center" }}
                      onClick={() => handleReview(q, true)} title="答对">
                      <IconCheck size={16} />
                    </button>
                  </>
                )}
                {authed && <button className="btn" style={{ fontSize: ".8rem", color: "var(--text-muted)" }} onClick={() => handleReanalyze(q.id, "full")}>重解析全部</button>}
                {authed && <button className="btn" style={{ fontSize: ".8rem" }} onClick={() => handleReanalyze(q.id, "answer")}>重解析答案</button>}
                {authed && <button className="btn" style={{ fontSize: ".8rem" }} onClick={() => startEdit(q)} disabled={editLoading}>编辑</button>}
                {authed && <button className="btn" style={{ fontSize: ".8rem", color: "var(--red-text)", marginLeft: "auto" }} onClick={() => handleDelete(q.id)}>删除</button>}
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

              {shownSolutions.has(q.id) && solutions.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
                  {solutions.map((sol: { name: string; steps: string[] }, i: number) => (
                    <details key={i} open style={{ fontSize: ".85rem" }}>
                      <summary style={{ fontWeight: 500, cursor: "pointer", padding: ".25rem 0" }}>{i + 1}. <MathText text={sol.name} /></summary>
                      <ol style={{ margin: ".25rem 0 0 1.25rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                        {sol.steps.map((step: string, j: number) => <li key={j}><MathText text={step} /></li>)}
                      </ol>
                    </details>
                  ))}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}