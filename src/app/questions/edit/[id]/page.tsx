"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import MathText from "@/lib/math-text";
import { useAuth } from "@/lib/auth-gate";
import { useModal } from "@/lib/modal";

interface ChapterNode { id: number; name: string; level: number; }
interface Question {
  id: number; chapter_id: number; image_path: string | null;
  ocr_text: string; question_type: string; correct_answer: string;
  explanation: string | null; ai_solutions: string | null;
  user_answer: string | null; error_reason: string | null;
  subject_id: number | null; chapter_l2_id: number | null;
}

const QUESTION_TYPES = ["single_choice", "multiple_choice", "true_false", "fill_blank", "short_answer", "comprehensive"];

export default function QuestionEditPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { authed } = useAuth();
  const modal = useModal();

  const qid = parseInt(params.id || "", 10);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [imagePath, setImagePath] = useState<string | null>(null);

  const [form, setForm] = useState({
    ocr_text: "",
    correct_answer: "",
    question_type: "single_choice",
    explanation: "",
    ai_solutions: "",
    user_answer: "",
  });

  // 科目 / 章节 / 知识点选择
  const [subjects, setSubjects] = useState<ChapterNode[]>([]);
  const [chapters, setChapters] = useState<ChapterNode[]>([]);
  const [kps, setKps] = useState<ChapterNode[]>([]);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [chapterL2Id, setChapterL2Id] = useState<number | null>(null);
  const [kpId, setKpId] = useState<number>(0);

  // 加载题目数据 + 分类树
  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/questions?id=${qid}`);
        const data = await res.json();
        const q: Question | null = data.question || null;
        if (!q) { modal.alert("加载失败", "未找到该题目"); setLoading(false); return; }
        setImagePath(q.image_path);
        setForm({
          ocr_text: q.ocr_text || "",
          correct_answer: q.correct_answer || "",
          question_type: q.question_type || "single_choice",
          explanation: q.explanation || "",
          ai_solutions: typeof q.ai_solutions === "string" ? q.ai_solutions : JSON.stringify(q.ai_solutions ?? ""),
          user_answer: q.user_answer || "",
        });
        const subs: ChapterNode[] = await fetch("/api/chapters?level=1").then(r => r.json()).catch(() => []);
        setSubjects(subs);
        if (q.subject_id) {
          setSubjectId(q.subject_id);
          const chs = await fetch(`/api/chapters?parent_id=${q.subject_id}`).then(r => r.json()).catch(() => []);
          setChapters(chs);
        }
        if (q.chapter_l2_id) {
          setChapterL2Id(q.chapter_l2_id);
          const kpRes = await fetch(`/api/chapters?parent_id=${q.chapter_l2_id}`).then(r => r.json()).catch(() => []);
          setKps(kpRes);
        }
        setKpId(q.chapter_id || 0);
      } catch {
        modal.alert("加载失败", "加载编辑数据失败，请重试");
      } finally {
        setLoading(false);
      }
    })();
  }, [qid]);

  const onSubjectChange = async (sid: string) => {
    const id = sid ? parseInt(sid) : null;
    setSubjectId(id); setChapterL2Id(null); setKpId(0); setChapters([]); setKps([]);
    if (id) setChapters(await fetch(`/api/chapters?parent_id=${id}`).then(r => r.json()).catch(() => []));
  };
  const onChapterChange = async (cid: string) => {
    const id = cid ? parseInt(cid) : null;
    setChapterL2Id(id); setKpId(0); setKps([]);
    if (id) setKps(await fetch(`/api/chapters?parent_id=${id}`).then(r => r.json()).catch(() => []));
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      let aiSolutions: unknown;
      try { aiSolutions = JSON.parse(form.ai_solutions); } catch { aiSolutions = form.ai_solutions; }
      const resp = await fetch(`/api/questions?id=${qid}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ai_solutions: aiSolutions, chapter_id: kpId || undefined }),
      });
      if (!resp.ok) { modal.alert("保存失败", "保存失败，请重试"); return; }
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const parseSolutions = (raw: string) => { if (!raw.trim()) return []; try { return JSON.parse(raw); } catch { return []; } };
  const solutions = parseSolutions(form.ai_solutions);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: ".75rem", flexWrap: "wrap" }}>
        <button className="btn" style={{ fontSize: ".85rem" }} onClick={() => router.back()}>← 返回</button>
        <h1 style={{ fontSize: "1.2rem", fontWeight: 700, flex: 1 }}>题目编辑 #{qid}</h1>
        <button className="btn btn-primary" style={{ fontSize: ".85rem" }} onClick={save} disabled={saving}>
          保存
        </button>
      </div>

      {loading ? (
        <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "2rem 0" }}>加载中...</p>
      ) : (
        <div style={{ display: "flex", gap: "1.25rem", alignItems: "flex-start" }}>
          {/* 左侧：表单 */}
          <div className="card" style={{ flex: "1 1 46%", display: "flex", flexDirection: "column", gap: ".75rem", minWidth: 0 }}>
            <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
              <label style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>题型</label>
              <select value={form.question_type} onChange={e => setForm(f => ({ ...f, question_type: e.target.value }))} style={{ fontSize: ".85rem" }}>
                {QUESTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* 分类选择 */}
            <div>
              <label style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>分类（科目 / 章节 / 知识点）</label>
              <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", marginTop: ".35rem" }}>
                <select value={subjectId ?? ""} onChange={e => onSubjectChange(e.target.value)} style={{ fontSize: ".85rem", flex: 1 }}>
                  <option value="">选择科目</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select value={chapterL2Id ?? ""} onChange={e => onChapterChange(e.target.value)} style={{ fontSize: ".85rem", flex: 1 }} disabled={!subjectId}>
                  <option value="">选择章节</option>
                  {chapters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select value={kpId ?? ""} onChange={e => setKpId(e.target.value ? parseInt(e.target.value) : 0)} style={{ fontSize: ".85rem", flex: 1 }} disabled={!chapterL2Id}>
                  <option value="">选择知识点</option>
                  {kps.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>题干 (OCR)</label>
              <textarea value={form.ocr_text} onChange={e => setForm(f => ({ ...f, ocr_text: e.target.value }))} rows={6}
                style={{ width: "100%", boxSizing: "border-box", fontSize: ".85rem", fontFamily: "inherit", marginTop: ".35rem" }} />
            </div>

            <div style={{ display: "flex", gap: ".75rem" }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>正确答案</label>
                <input value={form.correct_answer} onChange={e => setForm(f => ({ ...f, correct_answer: e.target.value }))}
                  style={{ width: "100%", boxSizing: "border-box", fontSize: ".85rem", marginTop: ".35rem" }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>你的答案</label>
                <input value={form.user_answer} onChange={e => setForm(f => ({ ...f, user_answer: e.target.value }))}
                  style={{ width: "100%", boxSizing: "border-box", fontSize: ".85rem", marginTop: ".35rem" }} />
              </div>
            </div>

            <div>
              <label style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>解析（支持 Markdown/LaTeX）</label>
              <textarea value={form.explanation} onChange={e => setForm(f => ({ ...f, explanation: e.target.value }))} rows={6}
                style={{ width: "100%", boxSizing: "border-box", fontSize: ".85rem", fontFamily: "inherit", marginTop: ".35rem" }} />
            </div>

            <div>
              <label style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>解法 JSON</label>
              <textarea value={form.ai_solutions} onChange={e => setForm(f => ({ ...f, ai_solutions: e.target.value }))} rows={6}
                style={{ width: "100%", boxSizing: "border-box", fontSize: ".8rem", fontFamily: "monospace", marginTop: ".35rem" }} />
            </div>

            <div style={{ display: "flex", gap: ".5rem" }}>
              <button className="btn btn-primary" style={{ fontSize: ".85rem" }} onClick={save} disabled={saving}>{saving ? "保存中..." : "保存"}</button>
              <button className="btn" style={{ fontSize: ".85rem" }} onClick={() => router.back()}>取消</button>
            </div>
          </div>

          {/* 右侧：实时预览 */}
          <div className="card" style={{ flex: "1 1 50%", display: "flex", flexDirection: "column", gap: ".75rem", minWidth: 0, position: "sticky", top: "1rem" }}>
            <div style={{ fontSize: ".8rem", fontWeight: 600, color: "var(--text-muted)" }}>实时预览</div>

            {imagePath && (
              <img src={`/api/image/${imagePath.replace('/uploads/', '')}`} alt="题目图" style={{ maxHeight: "10rem", borderRadius: "6px", objectFit: "contain" }} />
            )}

            <div style={{ padding: ".5rem .6rem", borderRadius: "6px", background: "var(--bg-hover)" }}>
              <span className="badge" style={{ marginRight: ".4rem" }}>{form.question_type}</span>
            </div>

            <div style={{ fontSize: ".9rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              <MathText text={form.ocr_text} splitOptions />
            </div>

            {form.user_answer && (
              <div style={{ padding: ".5rem .75rem", borderRadius: "6px", background: "var(--yellow-bg)", color: "var(--yellow-text)", fontSize: ".85rem" }}>
                你的答案：<MathText text={form.user_answer} />
              </div>
            )}

            {form.correct_answer && (
              <div style={{ padding: ".5rem .75rem", borderRadius: "6px", background: "var(--green-bg)", color: "var(--green-text)", fontSize: ".875rem" }}>
                正确答案：<MathText text={form.correct_answer} />
              </div>
            )}

            {form.explanation && (
              <div style={{ padding: ".75rem", borderRadius: "6px", background: "var(--bg-hover)", fontSize: ".85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                <div style={{ fontWeight: 600, marginBottom: ".35rem" }}>解析</div>
                <MathText text={form.explanation} />
              </div>
            )}

            {solutions.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
                {solutions.map((sol: { name: string; steps: string[] }, i: number) => (
                  <details key={i} open>
                    <summary style={{ fontWeight: 500, cursor: "pointer", fontSize: ".85rem" }}>
                      <MathText text={sol.name} />
                    </summary>
                    <ul style={{ paddingLeft: "1.2rem", fontSize: ".85rem", lineHeight: 1.6, marginTop: ".35rem" }}>
                      {sol.steps.map((step, j) => <li key={j}><MathText text={step} /></li>)}
                    </ul>
                  </details>
                ))}
              </div>
            )}

            {saved && (
              <div style={{ padding: ".5rem .75rem", borderRadius: "6px", background: "var(--green-bg)", color: "var(--green-text)", fontSize: ".85rem" }}>
                已保存，修改可即时校对。
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}