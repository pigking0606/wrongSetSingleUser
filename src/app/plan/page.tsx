"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  IconFlame, IconChart, IconTrending, IconPencil, IconSparkle,
  IconCalendar, IconClipboard, IconTarget, IconStar, IconStarEmpty,
  IconChevronLeft, IconChevronRight, IconPlus, IconX, IconCheck, IconAlert,
} from "@/lib/icons";
import { useGlobalTimer, StudyFullscreen } from "@/lib/study-timer";
import { useAuth } from "@/lib/auth-gate";
import { globalTimer } from "@/lib/global-timer";

interface PlanTask {
  id: number; task_date: string; chapter_id: number | null;
  title: string; description: string; status: string;
  completion_pct: number; difficulty: number; time_spent: number;
  sort_order: number; completed_at: string | null;
  last_edited_date: string | null;
}

interface Chapter {
  id: number; name: string; level: number; parent_id: number | null;
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

export default function PlanPage() {
  const { authed } = useAuth();
  const [curDate, setCurDate] = useState(today());
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [yesterdayIncomplete, setYesterdayIncomplete] = useState<PlanTask[]>([]);
  const [summary, setSummary] = useState("");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const [showHistory, setShowHistory] = useState(false);
  const [historyData, setHistoryData] = useState<Map<string, { total: number; pctSum: number; timeSum: number; diffSum: number; pctDiffSum: number }>>(new Map());

  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiReason, setAiReason] = useState("");
  const [suggestedTasks, setSuggestedTasks] = useState<Array<{title: string; chapter_id: number|null; description: string; difficulty: number; adopted: boolean}>>([]);
  const [adoptingIdx, setAdoptingIdx] = useState<number | null>(null);
  const [stats, setStats] = useState({ streak: 0, totalTasks: 0, avgPct: 0, avgDifficulty: 0, todayMinutes: 0 });
  const [feedback, setFeedback] = useState("");
  const [toastType, setToastType] = useState<"success" | "error">("success");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Prevent double-submit
  const addingRef = useRef(false);

  // Show feedback toast — clears previous before showing new one
  const toast = (msg: string, type?: "success" | "error", duration?: number) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastType(type || "success");
    setFeedback(msg);
    toastTimer.current = setTimeout(() => setFeedback(""), duration || 3000);
  };

  // Timer state — one active timer at a time, persists across page navigation
  const timer = useGlobalTimer();
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editTimeId, setEditTimeId] = useState<number | null>(null);
  const [editTimeVal, setEditTimeVal] = useState("");

  const [progress, setProgress] = useState("");
  const [progressUpdated, setProgressUpdated] = useState("");
  const [showProgress, setShowProgress] = useState(false);
  const [optimizing, setOptimizing] = useState(false);

  useEffect(() => {
    fetch("/api/chapters").then(r => r.json()).then(d => setChapters(Array.isArray(d) ? d : (d.chapters || []))).catch(() => {});
    fetch("/api/learning-progress").then(r => r.json()).then(d => {
      setProgress(d.content || "");
      setProgressUpdated(d.updated_at || "");
    }).catch(() => {});
  }, []);

  // Set timer save callback — server computes duration from timestamps
  useEffect(() => {
    globalTimer.setSaveCallback(async (taskId, action) => {
      try {
        const resp = await fetch('/api/plan-tasks', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: taskId, timer_action: action }) });
        const data = await resp.json();
        if (data.ok && data.time_spent !== undefined) {
          setTasks(prev => prev.map(tt => tt.id === taskId ? { ...tt, time_spent: data.time_spent } : tt));
        }
      } catch { /* */ }
    });
    return () => { globalTimer.setSaveCallback(null); };
  }, []);

  const loadTasks = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const [tRes, sRes] = await Promise.all([
        fetch(`/api/plan-tasks?date=${date}`),
        fetch(`/api/daily-summaries?date=${date}`),
      ]);
      const tData = await tRes.json();
      setTasks(tData.tasks || []);
      setYesterdayIncomplete(tData.yesterdayIncomplete || []);
      setSummary((await sRes.json()).content || "");
    } catch { /* */ }
    setLoading(false);
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/plan-tasks?from=2025-01-01&to=${today()}`);
      const all: PlanTask[] = ((await res.json()).tasks || []);
      // Completion rate: difficulty-weighted average — harder tasks completed contribute more
      const diffSum = all.reduce((s, t) => s + (t.difficulty || 3), 0);
      const avgPct = diffSum > 0 ? Math.round(all.reduce((s, t) => s + (t.completion_pct || 0) * (t.difficulty || 3), 0) / diffSum) : 0;
      const avgDiff = all.length > 0 ? Math.round(all.reduce((s, t) => s + (t.difficulty || 3), 0) / all.length * 10) / 10 : 0;
      // Streak: consecutive past days (including today) with at least one task completion_pct > 0
      let streak = 0, d = today();
      while (true) {
        const dayTasks = all.filter(t => t.task_date === d);
        if (!dayTasks.some(t => (t.completion_pct || 0) > 0)) break;
        streak++; d = addDays(d, -1);
      }
      const todayMinutes = all.filter(t=>t.task_date===today()).reduce((s,t)=>s+(t.time_spent||0),0);
      setStats({ streak, totalTasks: all.length, avgPct, avgDifficulty: avgDiff, todayMinutes: Math.floor(todayMinutes/60) });
    } catch { /* */ }
  }, []);

  // Only reload when date changes (functions are stable via useCallback([]))
  useEffect(() => { loadTasks(curDate); loadStats(); }, [curDate]);
  // eslint-disable-next-line react-hooks/exhaustive-deps

  const loadHistory = async () => {
    const from = addDays(today(), -30);
    const data = await (await fetch(`/api/plan-tasks?from=${from}&to=${today()}`)).json();
    const map = new Map<string, { total: number; pctSum: number; timeSum: number; diffSum: number; pctDiffSum: number }>();
    for (const t of (data.tasks || []) as PlanTask[]) {
      const e = map.get(t.task_date) || { total: 0, pctSum: 0, timeSum: 0, diffSum: 0, pctDiffSum: 0 };
      const diff = t.difficulty || 3;
      e.total++; e.pctSum += t.completion_pct || 0; e.timeSum += t.time_spent || 0;
      e.diffSum += diff; e.pctDiffSum += (t.completion_pct || 0) * diff;
      map.set(t.task_date, e);
    }
    setHistoryData(map);
    setShowHistory(!showHistory);
  };

  const setCompletion = async (task: PlanTask, pct: number) => {
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, completion_pct: pct } : t));
    await fetch("/api/plan-tasks", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: task.id, completion_pct: pct }) });
    loadStats();
    // Auto-stop timer if task is completed while being timed
    if (pct >= 100 && globalTimer.taskId === task.id && (globalTimer.running || globalTimer.paused)) {
      const sec = globalTimer.stop();
      toast(`任务完成，计时 ${Math.floor(sec/60)}分${sec%60}秒 已保存`);
    }
  };

  const setDifficulty = async (task: PlanTask, diff: number) => {
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, difficulty: diff } : t));
    await fetch("/api/plan-tasks", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: task.id, difficulty: diff }) });
  };

  const addTask = async () => {
    if (!newTitle.trim() || addingRef.current) return;
    addingRef.current = true;
    setSaving(true);
    try {
      await fetch("/api/plan-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task_date: curDate, title: newTitle.trim() }) });
      setNewTitle(""); setShowAdd(false);
      await loadTasks(curDate);
      loadStats();
      toast("任务已添加");
    } catch { toast("添加失败"); }
    setSaving(false);
    addingRef.current = false;
  };

  const deleteTask = async (id: number) => { await fetch(`/api/plan-tasks?id=${id}`, { method: "DELETE" }); loadTasks(curDate); loadStats(); toast("任务已删除"); };

  const saveTime = async (id: number, minutes: number) => {
    await fetch("/api/plan-tasks", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, time_spent: minutes * 60 }) });
    setEditTimeId(null);
    await loadTasks(curDate);
    loadStats();
    toast("计时已更新");
  };

  const saveEdit = async () => {
    if (!editingId || !editTitle.trim()) return;
    setEditSaving(true);
    try {
      const resp = await fetch("/api/plan-tasks", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editingId, title: editTitle.trim() }) });
      const data = await resp.json();
      if (!resp.ok) { toast(data.error || "修改失败"); setEditSaving(false); return; }
      // Local update only — avoid loadTasks which would overwrite time_spent with stale DB value
      // (DB time_spent excludes the currently-running timer session that hasn't been autosaved yet)
      setTasks(prev => prev.map(t => t.id === editingId ? { ...t, title: editTitle.trim(), last_edited_date: today() } : t));
      setEditingId(null);
      toast("任务已修改");
    } catch { toast("修改失败"); }
    setEditSaving(false);
  };

  const saveSummary = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/daily-summaries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ summary_date: curDate, content: summary }) });
      if (!res.ok) { const d = await res.json(); toast(d.error || "小结保存失败", "error", 5000); setSaving(false); return; }
      toast("小结已保存", "success", 5000);
    } catch { toast("小结保存失败", "error", 5000); }
    setSaving(false);
  };

  const saveProgress = async (content: string) => {
    const res = await fetch("/api/learning-progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
    if (res.ok) { setProgress(content); setProgressUpdated(new Date().toLocaleString()); toast("进度已保存"); }
    else toast("保存失败");
  };

  const aiOptimize = async () => {
    if (!progress.trim()) return;
    setOptimizing(true);
    try {
      const res = await fetch("/api/learning-progress/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: progress, mode: "optimize" }) });
      const data = await res.json();
      if (data.content && data.content !== progress) { setProgress(data.content); toast("AI 优化完成，满意后请点击保存进度"); }
      else { toast("AI 优化完成，内容未变化"); }
    } catch { toast("AI 优化失败"); }
    setOptimizing(false);
  };

  const aiUpdateProgress = async () => {
    setOptimizing(true);
    try {
      const res = await fetch("/api/learning-progress/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: progress, mode: "update", summaryDate: curDate }) });
      const data = await res.json();
      if (data.content && data.content !== progress) { setProgress(data.content); toast("AI 已根据今日小结更新总进度"); }
      else { toast("AI 更新完成，内容未变化"); }
    } catch { toast("AI 更新失败"); }
    setOptimizing(false);
  };

  const aiSuggest = async () => {
    setAiSuggesting(true); setAiReason(""); setSuggestedTasks([]);
    try {
      const res = await fetch("/api/plan-tasks/ai-suggest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: curDate }) });
      const data = await res.json();
      if (data.tasks && Array.isArray(data.tasks)) {
        setSuggestedTasks(data.tasks.map((t: any) => ({ ...t, adopted: false })));
        setAiReason(data.reason || "");
        toast(`AI 已生成 ${data.tasks.length} 条今日建议`);
      }
    } catch { toast("AI 建议生成失败"); }
    setAiSuggesting(false);
  };

  const adoptSuggestion = async (idx: number) => {
    setAdoptingIdx(idx);
    const t = suggestedTasks[idx];
    try {
      await fetch("/api/plan-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task_date: curDate, title: t.title, chapter_id: t.chapter_id, description: t.description, difficulty: t.difficulty }) });
      setSuggestedTasks(prev => prev.map((s, i) => i === idx ? { ...s, adopted: true } : s));
      await loadTasks(curDate);
      loadStats();
      toast("已添加到今日计划");
    } catch { toast("采纳失败"); }
    setAdoptingIdx(null);
  };

  const chapterName = (cid: number | null) => cid ? (chapters.find(c => c.id === cid)?.name || "") : "";

  const avgPctToday = tasks.length > 0 ? Math.round(tasks.reduce((s, t) => s + (t.completion_pct || 0) * (t.difficulty || 3), 0) / tasks.reduce((s, t) => s + (t.difficulty || 3), 0)) : 0;
  const isToday = curDate === today();
  const isPast = curDate < today();
  const dayTotalSeconds = tasks.reduce((s, t) => s + (t.time_spent || 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>每日学习计划</h1>

      {/* Toast feedback */}
      {feedback && (
        <div style={{
          textAlign: "center", fontSize: ".8rem",
          color: toastType === "error" ? "var(--red-text)" : "var(--green-text)",
          background: toastType === "error" ? "var(--red-bg)" : "var(--green-bg)",
          padding: ".4rem .75rem", borderRadius: "6px", transition: "opacity .3s",
        }}>{feedback}</div>
      )}

      {/* Stats bar */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: ".5rem" }}>
        <div className="card" style={{ textAlign: "center", padding: ".6rem .5rem" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: ".1rem" }}><IconFlame size={20} /></div>
          <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{stats.streak}</div>
          <div style={{ fontSize: ".7rem", color: "var(--text-muted)" }}>连续天数</div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: ".6rem .5rem" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: ".1rem" }}><IconChart size={20} /></div>
          <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{stats.avgPct}%</div>
          <div style={{ fontSize: ".7rem", color: "var(--text-muted)" }}>平均完成度</div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: ".6rem .5rem" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: ".1rem" }}><IconTrending size={20} /></div>
          <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{stats.avgDifficulty}</div>
          <div style={{ fontSize: ".7rem", color: "var(--text-muted)" }}>平均难度</div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: ".6rem .5rem" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: ".1rem" }}><IconTarget size={20} /></div>
          <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--accent)" }}>{stats.todayMinutes}</div>
          <div style={{ fontSize: ".7rem", color: "var(--text-muted)" }}>今日学习(分)</div>
        </div>
      </div>

      {/* Yesterday incomplete notification */}
      {isToday && yesterdayIncomplete.length > 0 && (
        <div style={{
          padding: ".5rem .75rem", borderRadius: "8px",
          background: "var(--yellow-bg)", color: "var(--yellow-text)",
          fontSize: ".8rem", lineHeight: 1.5, display: "flex", alignItems: "flex-start", gap: ".5rem",
        }}>
          <span style={{ fontSize: "1rem", flexShrink: 0 }}><IconAlert size={14} /></span>
          <div>
            <span style={{ fontWeight: 600 }}>昨日未完成：</span>
            {yesterdayIncomplete.map((t, i) => (
              <span key={t.id}>
                {t.title}{t.completion_pct > 0 ? ` (${t.completion_pct}%)` : ""}
                {i < yesterdayIncomplete.length - 1 ? " · " : ""}
              </span>
            ))}
            <div style={{ fontSize: ".7rem", opacity: 0.7, marginTop: ".15rem" }}>
              切换到昨天可编辑这些任务
            </div>
          </div>
        </div>
      )}

      {/* Date navigation */}
      <div style={{ display: "flex", alignItems: "center", gap: ".5rem", justifyContent: "center" }}>
        <button className="btn" onClick={() => setCurDate(addDays(curDate, -1))} style={{ padding: ".35rem .5rem", display: "flex" }}>
          <IconChevronLeft size={18} />
        </button>
        <span style={{ fontWeight: 600, fontSize: ".9rem", minWidth: "10rem", textAlign: "center" }}>
          {fmtDate(curDate)} {isToday ? "(今天)" : ""}
        </span>
        <button className="btn" onClick={() => setCurDate(addDays(curDate, 1))} style={{ padding: ".35rem .5rem", display: "flex" }} disabled={isToday}>
          <IconChevronRight size={18} />
        </button>
        <button className="btn" onClick={() => setCurDate(today())} style={{ fontSize: ".75rem", padding: ".35rem .6rem" }} disabled={isToday}>今天</button>
      </div>

      {/* Progress bar */}
      {tasks.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
          <div style={{ flex: 1, height: "6px", background: "var(--bg-hover)", borderRadius: "3px" }}>
            <div style={{ height: "100%", width: `${avgPctToday}%`, background: "var(--green-text)", borderRadius: "3px", transition: "width .3s" }} />
          </div>
          <span style={{ fontSize: ".75rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{avgPctToday}%</span>
          {dayTotalSeconds > 0 && <span style={{ fontSize: ".7rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>· 总时长 {Math.floor(dayTotalSeconds/60)}分</span>}
        </div>
      )}

      {/* Learning Progress Summary */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: ".4rem", cursor: "pointer" }} onClick={() => setShowProgress(!showProgress)}>
          <IconTarget size={18} />
          <span style={{ fontWeight: 600, fontSize: ".9rem", flex: 1 }}>总进度概括</span>
          {progressUpdated && <span style={{ fontSize: ".65rem", color: "var(--text-muted)" }}>{progressUpdated}</span>}
        </div>
        {showProgress && (
          <>
            <textarea value={progress} onChange={e => setProgress(e.target.value)} readOnly={!authed}
              placeholder={"描述各科当前进度，如：\n数学：高数一轮完成，线代第三章，660题做到第5章\n英语：单词背了3000，阅读真题5年\n专业课：数据结构完成，计组看到存储器\n政治：还没开始"}
              rows={5}
              style={{ width: "100%", boxSizing: "border-box", fontSize: ".82rem", lineHeight: 1.6, fontFamily: "inherit" }} />
            {authed && <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={() => saveProgress(progress)} disabled={optimizing} style={{ fontSize: ".8rem", padding: ".35rem .8rem" }}>保存进度</button>
              <button className="btn" onClick={aiOptimize} disabled={optimizing || !progress.trim()} style={{ fontSize: ".8rem", padding: ".35rem .6rem" }}>
                <span style={{ display: "flex", alignItems: "center", gap: ".25rem" }}><IconSparkle size={14} /> {optimizing ? "处理中..." : "AI 优化排版"}</span>
              </button>
            </div>}
            {authed && <p style={{ fontSize: ".7rem", color: "var(--text-muted)", margin: 0 }}>AI 优化仅整理格式，不会自动保存。满意后点击保存进度。</p>}
          </>
        )}
      </div>

      {/* Task list */}
      <div style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
        {loading ? (
          <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "2rem 0" }}>加载中...</p>
        ) : tasks.length === 0 ? (
          <div className="card" style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: ".5rem" }}><IconClipboard size={36} /></div>
            <p>{isPast ? "这天没有任务记录" : "还没有任务，点击下方按钮添加"}</p>
          </div>
        ) : (
          tasks.map(t => {
            const chName = chapterName(t.chapter_id);
            const pct = t.completion_pct || 0;
            const diff = t.difficulty || 3;
            return (
              <div key={t.id} className="card" style={{ display: "flex", flexDirection: "column", gap: ".4rem", padding: ".75rem .85rem", opacity: pct >= 100 ? 0.55 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
                  {editingId === t.id ? (
                    <>
                      <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
                        style={{ flex: 1, fontSize: ".85rem", fontWeight: 500 }}
                        onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                        autoFocus />
                      <button className="btn btn-primary" onClick={saveEdit} disabled={editSaving || !editTitle.trim()} style={{ fontSize: ".7rem", padding: ".15rem .5rem" }}>保存</button>
                      <button className="btn" onClick={() => setEditingId(null)} style={{ fontSize: ".7rem", padding: ".15rem .5rem" }}>取消</button>
                    </>
                  ) : (
                    <>
                      <span style={{ flex: 1, fontSize: ".85rem", fontWeight: 500, textDecoration: pct >= 100 ? "line-through" : "none" }}>{t.title}</span>
                      {t.last_edited_date === today() && <span style={{ fontSize: ".65rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>今日已修改</span>}
                      {chName && <span style={{ fontSize: ".7rem", background: "var(--tag-bg)", color: "var(--tag-text)", padding: ".15rem .4rem", borderRadius: "4px", whiteSpace: "nowrap" }}>{chName}</span>}
                      {authed && isToday && t.last_edited_date !== today() && <button onClick={() => { setEditingId(t.id); setEditTitle(t.title); }} style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: ".1rem", lineHeight: 1 }} title="编辑">
                        <IconPencil size={14} />
                      </button>}
                      {authed && isToday && <button onClick={() => deleteTask(t.id)} style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: ".1rem", lineHeight: 1 }} title="删除">
                        <IconX size={14} />
                      </button>}
                    </>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
                  <span style={{ fontSize: ".7rem", color: "var(--text-muted)", minWidth: "2.2rem" }}>完成</span>
                  <input type="range" min={0} max={100} step={10} value={pct} disabled={!authed || !isToday}
                    onChange={e => setCompletion(t, parseInt(e.target.value))}
                    style={{ flex: 1, accentColor: pct >= 100 ? "var(--green-text)" : "var(--accent)", height: "4px" }} />
                  <span style={{ fontSize: ".75rem", fontWeight: 600, minWidth: "2.5rem", textAlign: "right", color: pct >= 100 ? "var(--green-text)" : pct > 0 ? "var(--text)" : "var(--text-muted)" }}>{pct}%</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
                  <span style={{ fontSize: ".7rem", color: "var(--text-muted)", minWidth: "2.2rem" }}>难度</span>
                  <input type="range" min={1} max={5} step={1} value={diff} disabled={!authed || !isToday}
                    onChange={e => setDifficulty(t, parseInt(e.target.value))}
                    style={{ flex: 1, accentColor: diff >= 4 ? "var(--red-text)" : diff <= 2 ? "var(--green-text)" : "var(--accent)", height: "4px" }} />
                  <span style={{ display: "flex", gap: "2px", minWidth: "3rem", justifyContent: "flex-end" }}>
                    {[1,2,3,4,5].map(i => i <= diff ? <IconStar key={i} size={12} /> : <IconStarEmpty key={i} size={12} />)}
                  </span>
                </div>
                {editTimeId === t.id && (
                  <div style={{ display: "flex", alignItems: "center", gap: ".4rem", borderTop: "1px solid var(--border)", paddingTop: ".4rem" }}>
                    <span style={{ fontSize: ".75rem" }}>修改计时(分)：</span>
                    <input type="number" value={editTimeVal} onChange={e=>setEditTimeVal(e.target.value)}
                      style={{ width: "60px", fontSize: ".8rem", textAlign: "center" }}
                      onKeyDown={e=>{if(e.key==="Enter")saveTime(t.id,parseInt(editTimeVal)||0)}} autoFocus />
                    <button className="btn btn-primary" style={{ fontSize: ".7rem", padding: ".15rem .4rem" }} onClick={()=>saveTime(t.id,parseInt(editTimeVal)||0)}>保存</button>
                    <button className="btn" style={{ fontSize: ".7rem", padding: ".15rem .4rem" }} onClick={()=>setEditTimeId(null)}>取消</button>
                  </div>
                )}
                {/* Timer row — today: interactive; past: read-only time_spent display */}
                {isPast && t.time_spent > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: ".4rem", borderTop: "1px solid var(--border)", paddingTop: ".4rem", marginTop: ".1rem" }}>
                    <span style={{ fontSize: ".7rem", color: "var(--text-muted)" }}>学习时长</span>
                    <span style={{ fontSize: ".8rem", fontVariantNumeric: "tabular-nums", fontWeight: 600, fontFamily: "monospace" }}>
                      {Math.floor(t.time_spent/60)}分{t.time_spent%60 > 0 ? `${t.time_spent%60}秒` : ""}
                    </span>
                  </div>
                )}
                {/* Timer row */}
                {isToday && authed && (
                  <div style={{ display: "flex", alignItems: "center", gap: ".4rem", borderTop: "1px solid var(--border)", paddingTop: ".4rem", marginTop: ".1rem" }}>
                    {timer.taskId === t.id ? (
                      <>
                        {/* 本段计时（主显示） */}
                        <span style={{ fontSize: ".8rem", fontVariantNumeric: "tabular-nums", fontWeight: 600, fontFamily: "monospace", minWidth: "3.5rem" }} title="本段计时">
                          {String(Math.floor(timer.segmentElapsed / 60)).padStart(2, "0")}:{String(timer.segmentElapsed % 60).padStart(2, "0")}
                        </span>
                        {/* 总计时（次显示，小号） */}
                        <span style={{ fontSize: ".65rem", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums", fontFamily: "monospace" }} title="总计时">
                          / 总{String(Math.floor(timer.totalElapsed / 60)).padStart(2, "0")}:{String(timer.totalElapsed % 60).padStart(2, "0")}
                        </span>
                        {timer.running ? (
                          <button className="btn" onClick={globalTimer.pause} style={{ fontSize: ".7rem", padding: ".15rem .5rem" }}>暂停</button>
                        ) : (
                          <button className="btn" onClick={globalTimer.resume} style={{ fontSize: ".7rem", padding: ".15rem .5rem" }}>
                            {timer.segmentElapsed === 0 ? "开始新段" : "继续"}
                          </button>
                        )}
                        <button className="btn" onClick={() => setShowFullscreen(true)}
                          style={{ fontSize: ".7rem", padding: ".15rem .5rem", marginLeft: "auto" }}>
                          全屏
                        </button>
                        {/* 结束本段：保存当前段时长到后端，本段归零，进入暂停态等待用户开始新段 */}
                        <button className="btn" onClick={async () => {
                          const sec = await globalTimer.endSegment();
                          toast(`本段 ${Math.floor(sec/60)}分${sec%60}秒 已保存，点击「开始新段」继续`);
                        }}
                          style={{ fontSize: ".7rem", padding: ".15rem .5rem" }}>
                          结束本段
                        </button>
                        {/* 完全结束：停止计时，保存总时长 */}
                        <button className="btn" onClick={() => {
                          const sec = globalTimer.stop();
                          toast(`累计 ${Math.floor(sec/60)}分${sec%60}秒 已保存`);
                        }}
                          style={{ fontSize: ".7rem", padding: ".15rem .5rem", color: "var(--text-muted)" }}>
                          完全结束
                        </button>
                      </>
                    ) : (
                      <button className="btn" onClick={async () => { await fetch('/api/plan-tasks', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id, timer_action: "start" }) }); globalTimer.start(t.time_spent || 0); globalTimer.setTask(t.id, t.title); }}
                        disabled={timer.taskId !== null || pct >= 100}
                        style={{ fontSize: ".7rem", padding: ".15rem .5rem", opacity: (timer.taskId !== null || pct >= 100) ? 0.4 : 1 }}>
                        {pct >= 100 ? `已完成 ${t.time_spent > 0 ? `${Math.floor(t.time_spent/60)}分` : ""}` : `开始计时${t.time_spent > 0 ? ` (总计${Math.floor(t.time_spent/60)}分)` : ""}`}
                        {isToday && t.time_spent > 0 && <button onClick={(e)=>{e.stopPropagation();setEditTimeId(t.id);setEditTimeVal(String(Math.floor(t.time_spent/60)));}} style={{color:"var(--text-muted)",background:"none",border:"none",cursor:"pointer",padding:"0 .2rem"}} title="修改计时"><IconPencil size={12}/></button>}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Add task */}
      {isToday && authed && (
        <div style={{ display: "flex", flexDirection: "column", gap: ".4rem" }}>
          {showAdd ? (
            <div className="card" style={{ display: "flex", gap: ".5rem", padding: ".75rem", alignItems: "center" }}>
              <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="任务描述，如：完成660题第5章选择题"
                style={{ flex: 1, boxSizing: "border-box", fontSize: ".85rem" }}
                onKeyDown={e => { if (e.key === "Enter") addTask(); }} />
              <button className="btn btn-primary" onClick={addTask} disabled={saving || !newTitle.trim()} style={{ fontSize: ".8rem", padding: ".35rem .8rem", whiteSpace: "nowrap" }}>添加</button>
              <button className="btn" onClick={() => setShowAdd(false)} style={{ fontSize: ".8rem", padding: ".35rem .6rem" }}>取消</button>
            </div>
          ) : (
            <button className="btn" onClick={() => setShowAdd(true)} style={{ textAlign: "center", color: "var(--text-muted)", fontSize: ".85rem", padding: ".6rem", borderStyle: "dashed" }}>
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: ".3rem" }}><IconPlus size={16} /> 添加任务</span>
            </button>
          )}
        </div>
      )}

      {/* Daily summary */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
        <label style={{ fontWeight: 600, fontSize: ".9rem", display: "flex", alignItems: "center", gap: ".3rem" }}>
          <IconPencil size={16} /> {isToday ? "今日小结" : "历史小结"}
        </label>
        {isToday ? (
          <textarea value={summary} onChange={e => setSummary(e.target.value)} readOnly={!authed} placeholder="今天学了什么？遇到什么困难？明天计划调整什么？"
            rows={3} style={{ width: "100%", boxSizing: "border-box", fontSize: ".85rem", lineHeight: 1.6, fontFamily: "inherit" }} />
        ) : (
          summary ? (
            <div style={{ fontSize: ".85rem", lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--text)", padding: ".5rem 0" }}>{summary}</div>
          ) : (
            <div style={{ fontSize: ".85rem", color: "var(--text-muted)", padding: ".5rem 0" }}>暂无小结</div>
          )
        )}
        <div style={{ display: "flex", gap: ".5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
          {isToday && authed && (
            <>
              <button className="btn" onClick={aiUpdateProgress} disabled={optimizing || !summary.trim()} style={{ fontSize: ".8rem", padding: ".35rem .6rem" }}>
                <span style={{ display: "flex", alignItems: "center", gap: ".25rem" }}><IconSparkle size={14} /> {optimizing ? "更新中..." : "AI 更新总进度"}</span>
              </button>
              <button className="btn btn-primary" onClick={saveSummary} disabled={saving} style={{ fontSize: ".8rem" }}>{saving ? "保存中..." : "保存小结"}</button>
            </>
          )}
        </div>
      </div>

      {/* AI Suggest */}
      {isToday && authed && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
            <span style={{ fontWeight: 600, fontSize: ".9rem", flex: 1, display: "flex", alignItems: "center", gap: ".3rem" }}>
              <IconSparkle size={18} /> AI 建议今日任务
            </span>
            <button className="btn btn-primary" onClick={aiSuggest} disabled={aiSuggesting} style={{ fontSize: ".8rem", padding: ".4rem .8rem" }}>
              {aiSuggesting ? "生成中..." : "生成建议"}
            </button>
          </div>
          <p style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>AI 将根据近期小结和昨日未完成任务，为今天推荐具体到章节的学习任务</p>
          {aiReason && <p style={{ fontSize: ".8rem", color: "var(--green-text)", background: "var(--green-bg)", padding: ".5rem", borderRadius: "6px" }}>{aiReason}</p>}
          {/* Adoptable suggestion cards */}
          {suggestedTasks.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: ".4rem", marginTop: ".25rem" }}>
              {suggestedTasks.map((t, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: ".5rem", padding: ".5rem .7rem",
                  borderRadius: "6px", background: "var(--bg-hover)", fontSize: ".82rem",
                  opacity: t.adopted ? 0.4 : 1,
                }}>
                  <span style={{ flex: 1, textDecoration: t.adopted ? "line-through" : "none" }}>{t.title}</span>
                  {t.difficulty && <span style={{ fontSize: ".7rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>难度 {t.difficulty}</span>}
                  {t.adopted ? (
                    <span style={{ fontSize: ".75rem", color: "var(--green-text)", fontWeight: 600, whiteSpace: "nowrap" }}>已采纳</span>
                  ) : (
                    <button className="btn btn-primary" onClick={() => adoptSuggestion(i)} disabled={adoptingIdx === i}
                      style={{ fontSize: ".75rem", padding: ".25rem .55rem", whiteSpace: "nowrap" }}>
                      {adoptingIdx === i ? "..." : "采纳"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* History */}
      <div>
        <button className="btn" onClick={loadHistory} style={{ width: "100%", fontSize: ".85rem", display: "flex", alignItems: "center", justifyContent: "center", gap: ".3rem" }}>
          <IconCalendar size={16} /> {showHistory ? "收起历史" : "查看历史记录"}
        </button>
        {showHistory && (
          <div style={{ display: "flex", flexDirection: "column", gap: ".3rem", marginTop: ".5rem" }}>
            {Array.from(historyData.entries()).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 30).map(([date, { total, pctSum, timeSum, diffSum, pctDiffSum }]) => {
              const pct = diffSum > 0 ? Math.round(pctDiffSum / diffSum) : (total > 0 ? Math.round(pctSum / total) : 0);
              const timeMin = timeSum > 0 ? Math.floor(timeSum / 60) : 0;
              const timeStr = timeMin >= 60 ? `${Math.floor(timeMin/60)}h${timeMin%60}m` : timeMin > 0 ? `${timeMin}分` : "";
              return (
                <div key={date} className="card" style={{ display: "flex", alignItems: "center", gap: ".5rem", padding: ".5rem .75rem", cursor: "pointer", background: date === today() ? "var(--bg-hover)" : undefined }}
                  onClick={() => { setCurDate(date); setShowHistory(false); }}>
                  <span style={{ fontWeight: date === today() ? 700 : 400, fontSize: ".8rem", minWidth: "5.5rem" }}>{fmtDate(date)}{date === today() ? " 今天" : ""}</span>
                  <div style={{ flex: 1, height: "4px", background: "var(--bg-hover)", borderRadius: "2px" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: pct >= 90 ? "var(--green-text)" : "var(--accent)", borderRadius: "2px" }} />
                  </div>
                  {timeStr && <span style={{ fontSize: ".7rem", color: "var(--text-muted)", minWidth: "2.5rem", textAlign: "right" }}>{timeStr}</span>}
                  <span style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>{total}项</span>
                  <span style={{ fontSize: ".75rem", fontWeight: 600, color: pct >= 90 ? "var(--green-text)" : "var(--text)", minWidth: "2.5rem", textAlign: "right" }}>{pct}%</span>
                </div>
              );
            })}
            {historyData.size === 0 && <p style={{ color: "var(--text-muted)", textAlign: "center", fontSize: ".85rem", padding: "1rem 0" }}>暂无历史记录</p>}
          </div>
        )}
      </div>

      <Link href="/" style={{ fontSize: ".875rem", color: "var(--text-muted)", textDecoration: "none", textAlign: "center", paddingBottom: "1rem" }}>
        &larr; 返回首页
      </Link>

      {/* Fullscreen study timer */}
      {showFullscreen && (
        <StudyFullscreen
          taskTitle={timer.taskTitle}
          segmentElapsed={timer.segmentElapsed}
          totalElapsed={timer.totalElapsed}
          running={timer.running}
          paused={timer.paused}
          onPause={globalTimer.pause}
          onResume={globalTimer.resume}
          onEndSegment={async () => {
            const sec = await globalTimer.endSegment();
            toast(`本段 ${Math.floor(sec/60)}分${sec%60}秒 已保存，点击「开始新段」继续`);
          }}
          onStop={() => {
            const sec = globalTimer.stop();
            toast(`累计 ${Math.floor(sec/60)}分${sec%60}秒 已保存`);
            setShowFullscreen(false);
          }}
        />
      )}
    </div>
  );
}
