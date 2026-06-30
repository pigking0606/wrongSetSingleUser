"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import MathText from "@/lib/math-text";
import { useAuth } from "@/lib/auth-gate";
import { ExportPdfModal } from "@/lib/export-pdf-modal";
import { IconFileText } from "@/lib/icons";
import { useModal } from "@/lib/modal";

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

const QUESTION_TYPES = ["single_choice", "multiple_choice", "true_false", "fill_blank", "short_answer", "comprehensive"];

export default function QuestionsPage() {
  const { authed, login } = useAuth();
  const [subjects, setSubjects] = useState<ChapterNode[]>([]);
  const [chapters, setChapters] = useState<ChapterNode[]>([]);
  const [kps, setKps] = useState<ChapterNode[]>([]);
  const [filter, setFilter] = useState({ subjectId: null as number | null, subjectName: "", chapterId: null as number | null, chapterName: "", kpId: null as number | null, kpName: "" });
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 20;
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  const [shownImages, setShownImages] = useState<Set<number>>(new Set());
  const [shownAnswers, setShownAnswers] = useState<Set<number>>(new Set());
  const [shownExplanations, setShownExplanations] = useState<Set<number>>(new Set());
  const [shownSolutions, setShownSolutions] = useState<Set<number>>(new Set());
  const [pdfCount, setPdfCount] = useState(20);
  const [showExport, setShowExport] = useState(false);
  const [exportQuestions, setExportQuestions] = useState<Question[]>([]);
  const [exportLoading, setExportLoading] = useState(false);
  const modal = useModal();

  // Edit mode
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editForm, setEditForm] = useState({ ocr_text: "", correct_answer: "", question_type: "single_choice", explanation: "", ai_solutions: "", user_answer: "" });
  const [editChapterId, setEditChapterId] = useState<number>(0);
  const [editSubjectId, setEditSubjectId] = useState<number | null>(null);
  const [editChapterL2Id, setEditChapterL2Id] = useState<number | null>(null);
  const [editChapters, setEditChapters] = useState<ChapterNode[]>([]);
  const [editKps, setEditKps] = useState<ChapterNode[]>([]);

  // Initial load — fetch all questions + subjects
  useEffect(() => {
    fetch("/api/chapters?level=1").then(r => r.json()).then(setSubjects);
    fetchQuestions(null, null, null);
  }, []);

  const handleSubjectChange = useCallback(async (subjectId: string) => {
    if (!subjectId) { setFilter(f => ({ ...f, subjectId: null, subjectName: "", chapterId: null, chapterName: "", kpId: null, kpName: "" })); setChapters([]); setKps([]); fetchQuestions(null, null, null); return; }
    const id = parseInt(subjectId);
    const name = subjects.find(s => s.id === id)?.name || "";
    setFilter(f => ({ ...f, subjectId: id, subjectName: name, chapterId: null, chapterName: "", kpId: null, kpName: "" }));
    setKps([]);
    setChapters(await fetch(`/api/chapters?parent_id=${id}`).then(r => r.json()));
    fetchQuestions(id, null, null);
  }, [subjects]);

  const handleChapterChange = useCallback(async (chapterId: string) => {
    if (!chapterId) { setFilter(f => ({ ...f, chapterId: null, chapterName: "", kpId: null, kpName: "" })); fetchQuestions(filter.subjectId, null, null); return; }
    const id = parseInt(chapterId);
    const name = chapters.find(c => c.id === id)?.name || "";
    setFilter(f => ({ ...f, chapterId: id, chapterName: name, kpId: null, kpName: "" }));
    setKps(await fetch(`/api/chapters?parent_id=${id}`).then(r => r.json()));
    fetchQuestions(filter.subjectId, id, null);
  }, [chapters, filter.subjectId]);

  const handleKpChange = useCallback(async (kpId: string) => {
    if (!kpId) { setFilter(f => ({ ...f, kpId: null, kpName: "" })); fetchQuestions(filter.subjectId, filter.chapterId, null); return; }
    const id = parseInt(kpId);
    const name = kps.find(k => k.id === id)?.name || "";
    setFilter(f => ({ ...f, kpId: id, kpName: name }));
    fetchQuestions(filter.subjectId, filter.chapterId, id);
  }, [kps, filter.subjectId, filter.chapterId]);

  const fetchQuestions = async (sid: number | null, cid: number | null, kid: number | null, pg = 0) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (kid) params.set("chapter_id", String(kid));
    else if (cid) params.set("chapter_l2_id", String(cid));
    else if (sid) params.set("subject_id", String(sid));
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    params.set("page", String(pg));
    params.set("pageSize", String(PAGE_SIZE));
    try {
      const resp = await fetch(`/api/questions?${params.toString()}`);
      const data = await resp.json();
      if (data.questions) { setQuestions(data.questions); setTotal(data.total); }
      else { setQuestions(data); setTotal(data.length); }
    } catch { setQuestions([]); setTotal(0); }
    setLoading(false);
  };

  const handleDelete = async (id: number) => {
    if (!authed) return;
    if (!await modal.confirm("删除题目", "确定删除？此操作不可恢复。")) return;
    await fetch(`/api/questions?id=${id}`, { method: "DELETE" });
    setQuestions(prev => prev.filter(q => q.id !== id));
    setTotal(prev => Math.max(0, prev - 1));
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

  // Edit handlers
  const startEdit = async (q: Question) => {
    setEditLoading(true);
    try {
      // Load full ancestor chain before showing the form
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
      // Set all state at once — form only appears after data is ready
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

  const toggle = (set: Set<number>, setter: (s: Set<number>) => void, id: number) => {
    const next = new Set(set); next.has(id) ? next.delete(id) : next.add(id); setter(next);
  };
  const removeFilter = (level: "subject" | "chapter" | "kp") => {
    if (level === "kp") handleKpChange("");
    else if (level === "chapter") handleChapterChange("");
    else handleSubjectChange("");
  };
  const parseSolutions = (raw: string | null) => { if (!raw) return []; try { return JSON.parse(raw); } catch { return []; } };

  const hasFilter = filter.subjectId || filter.chapterId || filter.kpId || dateFrom || dateTo;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>题库浏览</h1>

      {/* Filters */}
      <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "center" }}>
        <select value={filter.subjectId ?? ""} onChange={e => handleSubjectChange(e.target.value)}>
          <option value="">全部科目</option>
          {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filter.chapterId ?? ""} onChange={e => handleChapterChange(e.target.value)} disabled={!filter.subjectId}>
          <option value="">全部章节</option>
          {chapters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filter.kpId ?? ""} onChange={e => handleKpChange(e.target.value)} disabled={!filter.chapterId}>
          <option value="">全部知识点</option>
          {kps.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); }} style={{ fontSize: ".8rem", width: "130px" }} title="开始日期" />
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); }} style={{ fontSize: ".8rem", width: "130px" }} title="结束日期" />
        {(dateFrom || dateTo) && <button className="btn" style={{ fontSize: ".75rem" }} onClick={() => { setDateFrom(""); setDateTo(""); }}>清除日期</button>}
      </div>

      {hasFilter && (
        <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "center" }}>
          {filter.subjectId && <span className="tag">{filter.subjectName} <button onClick={() => removeFilter("subject")} style={{ border: "none", background: "none", cursor: "pointer", color: "inherit" }}>×</button></span>}
          {filter.chapterId && <span className="tag">{filter.chapterName} <button onClick={() => removeFilter("chapter")} style={{ border: "none", background: "none", cursor: "pointer", color: "inherit" }}>×</button></span>}
          {filter.kpId && <span className="tag">{filter.kpName} <button onClick={() => removeFilter("kp")} style={{ border: "none", background: "none", cursor: "pointer", color: "inherit" }}>×</button></span>}
          <button className="btn" style={{ fontSize: ".75rem" }} onClick={() => handleSubjectChange("")}>清除全部</button>
        </div>
      )}

      {/* PDF Export */}
      {questions.length > 0 && (
        <div>
          <button className="btn btn-primary" style={{ fontSize: ".8rem", padding: ".35rem .8rem" }} onClick={async () => {
            setExportLoading(true);
            const p = new URLSearchParams();
            if (filter.kpId) p.set("chapter_id", String(filter.kpId));
            else if (filter.chapterId) p.set("chapter_l2_id", String(filter.chapterId));
            else if (filter.subjectId) p.set("subject_id", String(filter.subjectId));
            if (dateFrom) p.set("from", dateFrom);
            if (dateTo) p.set("to", dateTo);
            p.set("pageSize", "9999");
            const r = await fetch(`/api/questions?${p.toString()}`);
            const d = await r.json();
            setExportQuestions(d.questions || d);
            setExportLoading(false);
            setShowExport(true);
          }} disabled={exportLoading}>
            {exportLoading ? "加载中..." : <span style={{ display: "flex", alignItems: "center", gap: ".25rem" }}><IconFileText size={14} /> 导出 PDF</span>}
          </button>
          {showExport && (
            <ExportPdfModal
              questions={(exportQuestions.length > 0 ? exportQuestions : questions) as any[]}
              label={[filter.subjectName, filter.chapterName, filter.kpName, dateFrom, dateTo].filter(Boolean).join("_") || "全部"}
              defaultTitle={`错题导出 · ${[filter.subjectName, filter.chapterName, filter.kpName, dateFrom, dateTo].filter(Boolean).join("_") || "全部"}`}
              onClose={() => setShowExport(false)}
            />
          )}
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "2rem 0" }}>加载中...</p>
      ) : questions.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "2rem" }}>
          <p style={{ color: "var(--text-muted)" }}>暂无题目</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
          <p style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>共 {questions.length} 道题目</p>
          {editLoading && (
            <div className="card" style={{ textAlign: "center", padding: "1rem", background: "var(--bg-hover)" }}>
              <span style={{ fontSize: ".85rem", color: "var(--text-muted)" }}>加载编辑数据...</span>
            </div>
          )}
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
                  {/* Classification selector — fix AI misclassification */}
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
              <div key={q.id} className="card" style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
                {/* Breadcrumb */}
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
                      {q.status === "pending" ? "分析中" : q.status === "error" ? "失败" : q.status}
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", fontSize: ".7rem" }}>{q.created_at?.slice(0, 10)}</span>
                </div>

                {q.image_path && shownImages.has(q.id) && <img src={`/api/image/${q.image_path.replace('/uploads/', '')}`} alt="题目图" style={{ maxHeight: "10rem", borderRadius: "6px" }} />}

                <div style={{ fontSize: ".9rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}><MathText text={q.ocr_text} /></div>

                {q.user_answer && (
                  <div style={{ padding: ".5rem .75rem", borderRadius: "6px", background: "var(--yellow-bg)", color: "var(--yellow-text)", fontSize: ".8rem" }}>
                    你的答案：<MathText text={q.user_answer} />
                  </div>
                )}
                {q.error_reason && (
                  <div style={{ padding: ".5rem .75rem", borderRadius: "6px", background: "var(--red-bg)", color: "var(--red-text)", fontSize: ".8rem" }}>
                    错误原因：{q.error_reason}
                  </div>
                )}

                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
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
                  {authed && <button className="btn" style={{ fontSize: ".8rem", color: "var(--text-muted)" }} onClick={() => handleReanalyze(q.id, "full")}>重解析全部</button>}
                  {authed && <button className="btn" style={{ fontSize: ".8rem" }} onClick={() => handleReanalyze(q.id, "answer")}>重解析答案</button>}
                  {authed && <button className="btn" style={{ fontSize: ".8rem" }} onClick={() => startEdit(q)} disabled={editLoading}>编辑</button>}
                  {authed && <button className="btn" style={{ fontSize: ".8rem", color: "var(--red-text)", marginLeft: "auto" }} onClick={() => handleDelete(q.id)}>删除</button>}
                </div>

                {shownAnswers.has(q.id) && (
                  <div style={{ padding: ".5rem .75rem", borderRadius: "6px", background: "var(--green-bg)", color: "var(--green-text)", fontSize: ".875rem" }}>
                    正确答案：<MathText text={q.correct_answer} />
                    {q.user_answer && (
                      <span style={{ marginLeft: ".5rem", fontSize: ".75rem", color: q.user_answer.trim().toLowerCase() === q.correct_answer.trim().toLowerCase() ? "var(--green-text)" : "var(--red-text)" }}>
                        {q.user_answer.trim().toLowerCase() === q.correct_answer.trim().toLowerCase() ? "(回答正确)" : "(回答错误)"}
                      </span>
                    )}
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

      {total > PAGE_SIZE && (
        <div style={{ display: "flex", gap: ".75rem", justifyContent: "center", alignItems: "center" }}>
          <button className="btn" style={{ fontSize: ".85rem" }} disabled={page === 0} onClick={() => { setPage(p => p - 1); fetchQuestions(filter.subjectId, filter.chapterId, filter.kpId, page - 1); }}>
            ← 上一页
          </button>
          <span style={{ fontSize: ".85rem", color: "var(--text-muted)" }}>
            {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, total)} / {total}
          </span>
          <button className="btn" style={{ fontSize: ".85rem" }} disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => { setPage(p => p + 1); fetchQuestions(filter.subjectId, filter.chapterId, filter.kpId, page + 1); }}>
            下一页 →
          </button>
        </div>
      )}

      <Link href="/" style={{ fontSize: ".875rem", color: "var(--text-muted)", textDecoration: "none" }}>← 返回首页</Link>
    </div>
  );
}
