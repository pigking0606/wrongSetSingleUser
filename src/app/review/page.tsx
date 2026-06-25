"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import MathText from "@/lib/math-text";
import { useAuth } from "@/lib/auth-gate";
import { exportQuestionsPdf, type PdfQuestion } from "@/lib/pdf-export";

interface ChapterNode { id: number; name: string; level: number; }
interface DueQuestion {
  id: number; ocr_text: string; chapter_id: number;
  correct_answer: string; explanation: string | null;
  ai_solutions: string | null; user_answer: string | null;
  question_type: string; image_path: string | null;
  last_review_date: string | null; next_review_date: string | null;
  ease_factor: number; interval_days: number; review_count: number;
  kp_name: string | null; chapter_name: string | null; subject_name: string | null;
}

export default function ReviewPage() {
  const { authed } = useAuth();
  const [questions, setQuestions] = useState<DueQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [showExplanation, setShowExplanation] = useState(false);
  const [showSolutions, setShowSolutions] = useState(false);
  const [showImage, setShowImage] = useState(false);
  const [answered, setAnswered] = useState(false);

  const [subjects, setSubjects] = useState<ChapterNode[]>([]);
  const [chapters, setChapters] = useState<ChapterNode[]>([]);
  const [kps, setKps] = useState<ChapterNode[]>([]);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [chapterL2Id, setChapterL2Id] = useState<number | null>(null);
  const [kpId, setKpId] = useState<number | null>(null);
  const [questionLimit, setQuestionLimit] = useState(10);

  useEffect(() => { fetch("/api/chapters?level=1").then(r => r.json()).then(setSubjects); }, []);

  useEffect(() => {
    if (!subjectId) { setChapters([]); setKps([]); return; }
    fetch(`/api/chapters?parent_id=${subjectId}`).then(r => r.json()).then(data => setChapters(data.filter((c: ChapterNode) => c.level === 2)));
  }, [subjectId]);

  useEffect(() => {
    if (!chapterL2Id) { setKps([]); return; }
    fetch(`/api/chapters?parent_id=${chapterL2Id}`).then(r => r.json()).then(data => setKps(data.filter((c: ChapterNode) => c.level === 3)));
  }, [chapterL2Id]);

  const fetchQuestions = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams(); params.set("limit", String(questionLimit));
    if (subjectId) params.set("subject_id", String(subjectId));
    if (chapterL2Id) params.set("chapter_l2_id", String(chapterL2Id));
    if (kpId) params.set("chapter_id", String(kpId));
    const res = await fetch(`/api/review?${params.toString()}`);
    setQuestions(await res.json());
    setCurrentIdx(0); setShowAnswer(false); setShowExplanation(false); setShowSolutions(false); setAnswered(false);
    setLoading(false);
  }, [questionLimit, subjectId, chapterL2Id, kpId]);

  useEffect(() => { fetchQuestions(); }, [fetchQuestions]);

  const handleResult = async (correct: boolean) => {
    const q = questions[currentIdx];
    await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question_id: q.id, correct }) });
    setFeedback(correct ? "正确！" : "已标记为遗忘，明天重新复习");
    setAnswered(true);
  };

  const nextQuestion = () => {
    setFeedback(""); setShowAnswer(false); setShowExplanation(false); setShowSolutions(false); setAnswered(false);
    if (currentIdx + 1 < questions.length) setCurrentIdx(currentIdx + 1);
    else setQuestions([]);
  };

  const filterBar = (
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
      <select value={questionLimit} onChange={e => setQuestionLimit(parseInt(e.target.value))}>
        {[5, 10, 15, 20, 30].map(n => <option key={n} value={n}>{n} 题</option>)}
      </select>
      <input type="number" min={1} max={100} value={questionLimit}
        onChange={e => { const v = parseInt(e.target.value); if (v >= 1 && v <= 100) setQuestionLimit(v); }}
        style={{ width: "60px", fontSize: ".8rem" }} title="自定义数量" />
    </div>
  );

  if (loading) return <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "3rem 0" }}>加载中...</p>;

  if (questions.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>每日复习</h1>
        {filterBar}
        <div className="card" style={{ textAlign: "center", padding: "2rem" }}>
          <p style={{ color: "var(--text-muted)", marginBottom: ".75rem" }}>今天没有需要复习的题目</p>
          <button className="btn btn-primary" onClick={fetchQuestions}>刷新</button>
        </div>
        <Link href="/" style={{ fontSize: ".875rem", color: "var(--text-muted)", textDecoration: "none" }}>← 返回首页</Link>
      </div>
    );
  }

  const current = questions[currentIdx];
  const solutions = (() => { if (!current.ai_solutions) return []; try { return JSON.parse(current.ai_solutions); } catch { return []; } })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>每日复习 ({currentIdx + 1}/{questions.length})</h1>
        <span style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>{questionLimit} 题/组</span>
      </div>

      {filterBar}

      {/* PDF Export */}
      {questions.length > 0 && (
        <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
          <span style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>导出PDF：</span>
          <button className="btn btn-primary" style={{ fontSize: ".75rem", padding: ".3rem .6rem" }} onClick={() => {
            const label = subjectId ? subjects.find(s => s.id === subjectId)?.name || "复习" : "复习";
            exportQuestionsPdf(questions as PdfQuestion[], `复习题_${label}.pdf`, true, `每日复习 · ${label}`);
          }}>含答案</button>
          <button className="btn" style={{ fontSize: ".75rem", padding: ".3rem .6rem" }} onClick={() => {
            const label = subjectId ? subjects.find(s => s.id === subjectId)?.name || "复习" : "复习";
            exportQuestionsPdf(questions as PdfQuestion[], `复习题_${label}_纯题目.pdf`, false, `每日复习（纯题目） · ${label}`);
          }}>纯题目</button>
        </div>
      )}

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
        {(current.subject_name || current.chapter_name || current.kp_name) && (
          <div style={{ display: "flex", alignItems: "center", gap: ".25rem", fontSize: ".75rem", color: "var(--text-muted)", flexWrap: "wrap" }}>
            {current.subject_name && <span className="tag">{current.subject_name}</span>}
            {current.chapter_name && <><span>›</span><span>{current.chapter_name}</span></>}
            {current.kp_name && <><span>›</span><span style={{ color: "var(--text-muted)" }}>{current.kp_name}</span></>}
            <span className="badge" style={{ marginLeft: ".5rem" }}>{current.question_type}</span>
          </div>
        )}

        <div style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>
          第 {current.review_count + 1} 次复习
          {current.last_review_date && <> · 上次：{current.last_review_date}</>}
        </div>

        <div style={{ fontSize: "1rem", lineHeight: 1.7, whiteSpace: "pre-wrap" }}><MathText text={current.ocr_text} /></div>

        {current.image_path && (
          <div>
            <button className="btn" style={{ fontSize: ".8rem" }} onClick={() => setShowImage(!showImage)}>
              {showImage ? "隐藏图片" : "显示图片"}
            </button>
            {showImage && (
              <div style={{ marginTop: ".5rem" }}>
                <img src={`/api/image/${current.image_path.replace('/uploads/', '')}`} alt="题目图" style={{ maxWidth: "100%", maxHeight: "16rem", borderRadius: "6px" }} />
              </div>
            )}
          </div>
        )}

        {current.user_answer && (
          <div style={{ padding: ".5rem .75rem", borderRadius: "6px", background: "var(--yellow-bg)", color: "var(--yellow-text)", fontSize: ".85rem" }}>
            你的答案：<MathText text={current.user_answer} />
          </div>
        )}

        {showAnswer && (
          <div style={{ padding: ".5rem .75rem", borderRadius: "6px", background: "var(--green-bg)", color: "var(--green-text)", fontSize: ".9rem" }}>
            正确答案：<MathText text={current.correct_answer} />
          </div>
        )}

        {!showAnswer ? (
          <button className="btn btn-primary" onClick={() => setShowAnswer(true)}>显示答案</button>
        ) : !answered ? (
          <div style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
            {authed ? <div style={{ display: "flex", gap: ".75rem" }}>
              <button className="btn btn-danger" style={{ flex: 1, padding: ".75rem" }} onClick={() => handleResult(false)}>错了</button>
              <button className="btn btn-success" style={{ flex: 1, padding: ".75rem" }} onClick={() => handleResult(true)}>对了</button>
            </div> : <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: ".85rem" }}>输入口令后可评分</p>}
            {current.explanation && (
              <div>
                <button className="btn" style={{ fontSize: ".85rem" }} onClick={() => setShowExplanation(!showExplanation)}>
                  {showExplanation ? "隐藏解析" : "显示解析"}
                </button>
                {showExplanation && (
                  <div style={{ marginTop: ".5rem", padding: ".75rem", borderRadius: "6px", background: "var(--bg-hover)", fontSize: ".85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    <MathText text={current.explanation || ""} />
                  </div>
                )}
              </div>
            )}
            {solutions.length > 0 && (
              <div>
                <button className="btn" style={{ fontSize: ".85rem" }} onClick={() => setShowSolutions(!showSolutions)}>
                  {showSolutions ? `隐藏解法 (${solutions.length})` : `显示解法 (${solutions.length})`}
                </button>
                {showSolutions && (
                  <div style={{ marginTop: ".5rem", display: "flex", flexDirection: "column", gap: ".5rem" }}>
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
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
            {feedback && <p style={{ fontSize: ".9rem", fontWeight: 500, textAlign: "center", color: feedback.startsWith("正确") ? "var(--green-text)" : "var(--red-text)" }}>{feedback}</p>}
            <button className="btn btn-primary" style={{ padding: ".75rem" }} onClick={nextQuestion}>
              {currentIdx + 1 < questions.length ? `下一题 (${currentIdx + 2}/${questions.length})` : "完成复习"}
            </button>
          </div>
        )}
      </div>

      <Link href="/" style={{ fontSize: ".875rem", color: "var(--text-muted)", textDecoration: "none" }}>← 返回首页</Link>
    </div>
  );
}
