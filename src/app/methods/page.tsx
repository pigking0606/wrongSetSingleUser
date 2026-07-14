"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  IconBook, IconPlus, IconPencil, IconTrash, IconX, IconImage, IconFileText,
} from "@/lib/icons";
import { useAuth } from "@/lib/auth-gate";

interface Chapter { id: number; name: string; level: number; parent_id: number | null; }
interface Method {
  id: number; title: string; chapter_id: number | null; content: string;
  image_path: string | null; created_at: string;
  chapter_name: string | null; subject_name: string | null;
}

export default function MethodsPage() {
  const { authed } = useAuth();
  const [methods, setMethods] = useState<Method[]>([]);
  const [subjects, setSubjects] = useState<Chapter[]>([]);
  // Filter selectors (separate state from form selectors to avoid interference)
  const [filterChaptersL2, setFilterChaptersL2] = useState<Chapter[]>([]);
  const [filterKps, setFilterKps] = useState<Chapter[]>([]);
  const [filterSubject, setFilterSubject] = useState<number | null>(null);
  const [filterL2, setFilterL2] = useState<number | null>(null);
  const [filterKp, setFilterKp] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state (independent chapter selectors)
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formSubject, setFormSubject] = useState<number | null>(null);
  const [formL2, setFormL2] = useState<number | null>(null);
  const [formKp, setFormKp] = useState<number | null>(null);
  const [formChaptersL2, setFormChaptersL2] = useState<Chapter[]>([]);
  const [formKps, setFormKps] = useState<Chapter[]>([]);
  const [formContent, setFormContent] = useState("");
  const [formImage, setFormImage] = useState<File | null>(null);
  const [formImagePreview, setFormImagePreview] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");

  const toast = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(""), 3000); };

  useEffect(() => {
    fetch("/api/chapters?level=1").then(r => r.json()).then(setSubjects).catch(() => {});
  }, []);

  useEffect(() => {
    if (filterSubject) fetch(`/api/chapters?parent_id=${filterSubject}`).then(r => r.json()).then(setFilterChaptersL2).catch(() => {});
    else setFilterChaptersL2([]);
    setFilterL2(null); setFilterKps([]);
  }, [filterSubject]);

  useEffect(() => {
    if (filterL2) fetch(`/api/chapters?parent_id=${filterL2}`).then(r => r.json()).then(setFilterKps).catch(() => {});
    else setFilterKps([]);
    setFilterKp(null);
  }, [filterL2]);

  // Form chapter selectors (independent from filter selectors)
  useEffect(() => {
    if (formSubject) fetch(`/api/chapters?parent_id=${formSubject}`).then(r => r.json()).then((d: Chapter[]) => setFormChaptersL2(d.filter(c => c.level === 2))).catch(() => {});
    else setFormChaptersL2([]);
    setFormL2(null); setFormKps([]);
  }, [formSubject]);

  useEffect(() => {
    if (formL2) fetch(`/api/chapters?parent_id=${formL2}`).then(r => r.json()).then((d: Chapter[]) => setFormKps(d.filter(c => c.level === 3))).catch(() => {});
    else setFormKps([]);
    setFormKp(null);
  }, [formL2]);

  const loadMethods = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterKp) params.set("chapter_id", String(filterKp));
    else if (filterL2) params.set("chapter_id", String(filterL2));
    else if (filterSubject) params.set("chapter_id", String(filterSubject));
    const res = await fetch(`/api/methods?${params}`);
    const data = await res.json();
    setMethods(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [filterSubject, filterL2, filterKp]);

  useEffect(() => { loadMethods(); }, [loadMethods]);

  const resetForm = () => {
    setEditId(null); setFormTitle(""); setFormSubject(null); setFormL2(null);
    setFormKp(null); setFormContent(""); setFormImage(null); setFormImagePreview("");
    setFormChaptersL2([]); setFormKps([]);
  };

  const startEdit = (m: Method) => {
    setEditId(m.id); setFormTitle(m.title); setFormContent(m.content || "");
    setFormImage(null); setFormImagePreview(m.image_path || "");
    // Pre-fill chapter selectors based on method's chapter_id
    if (m.chapter_id) {
      // We need to find the chapter chain — for simplicity just set kp
      setFormKp(m.chapter_id);
      // Load the parent chain lazily
      fetch(`/api/chapters?parent_id=${m.chapter_id}`).then(() => {}).catch(() => {});
    }
    setShowForm(true);
  };

  const onImageChange = (file: File | null) => {
    if (file) {
      setFormImage(file);
      const reader = new FileReader();
      reader.onload = e => setFormImagePreview(e.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setFormImage(null); setFormImagePreview("");
    }
  };

  const save = async () => {
    if (!formTitle.trim()) { toast("题型名称不能为空"); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("title", formTitle.trim());
      fd.append("content", formContent.trim());
      const chapterId = formKp || formL2 || formSubject;
      fd.append("chapter_id", chapterId ? String(chapterId) : "");
      if (formImage) fd.append("image", formImage);

      const url = editId ? `/api/methods/${editId}` : "/api/methods";
      const method = editId ? "PUT" : "POST";
      const res = await fetch(url, { method, body: fd });
      const data = await res.json();
      if (!res.ok) { toast(data.error || "保存失败"); setSaving(false); return; }
      resetForm(); setShowForm(false);
      await loadMethods();
      toast(editId ? "已更新" : "已添加");
    } catch { toast("保存失败"); }
    setSaving(false);
  };

  const del = async (id: number) => {
    if (!confirm("确定删除这个题型解法？")) return;
    await fetch(`/api/methods/${id}`, { method: "DELETE" });
    await loadMethods();
    toast("已删除");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h1 style={{ fontSize: "1.25rem", fontWeight: 700, display: "flex", alignItems: "center", gap: ".4rem" }}>
        <IconBook size={22} /> 题型解法
      </h1>

      {feedback && (
        <div style={{ textAlign: "center", fontSize: ".8rem", color: "var(--green-text)", background: "var(--green-bg)", padding: ".4rem .75rem", borderRadius: "6px" }}>{feedback}</div>
      )}

      {/* Filter */}
      <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "center" }}>
        <select value={filterSubject ?? ""} onChange={e => setFilterSubject(e.target.value ? parseInt(e.target.value) : null)}
          style={{ fontSize: ".8rem", padding: ".3rem .4rem" }}>
          <option value="">全部科目</option>
          {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {filterChaptersL2.length > 0 && (
          <select value={filterL2 ?? ""} onChange={e => setFilterL2(e.target.value ? parseInt(e.target.value) : null)}
            style={{ fontSize: ".8rem", padding: ".3rem .4rem" }}>
            <option value="">全部章节</option>
            {filterChaptersL2.filter(c => c.level === 2).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {filterKps.length > 0 && (
          <select value={filterKp ?? ""} onChange={e => setFilterKp(e.target.value ? parseInt(e.target.value) : null)}
            style={{ fontSize: ".8rem", padding: ".3rem .4rem" }}>
            <option value="">全部知识点</option>
            {filterKps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      {/* Add button */}
      {authed && !showForm && (
        <button className="btn" onClick={() => { resetForm(); setShowForm(true); }}
          style={{ textAlign: "center", color: "var(--text-muted)", fontSize: ".85rem", padding: ".6rem", borderStyle: "dashed" }}>
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: ".3rem" }}><IconPlus size={16} /> 添加题型解法</span>
        </button>
      )}

      {/* Form */}
      {authed && showForm && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: ".6rem", padding: ".85rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
            <span style={{ fontWeight: 600, fontSize: ".9rem", flex: 1 }}>{editId ? "编辑解法" : "新增解法"}</span>
            <button className="btn" onClick={() => { setShowForm(false); resetForm(); }} style={{ fontSize: ".7rem", padding: ".15rem .4rem" }}>
              <IconX size={14} />
            </button>
          </div>
          <input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="题型名称，如：极限的等价无穷小替换"
            style={{ fontSize: ".85rem", padding: ".4rem .5rem" }} autoFocus />
          {/* Chapter selectors */}
          <div style={{ display: "flex", gap: ".4rem", flexWrap: "wrap" }}>
            <select value={formSubject ?? ""} onChange={e => setFormSubject(e.target.value ? parseInt(e.target.value) : null)}
              style={{ fontSize: ".8rem", padding: ".3rem .4rem", flex: 1, minWidth: "100px" }}>
              <option value="">选择科目</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {formChaptersL2.length > 0 && (
              <select value={formL2 ?? ""} onChange={e => setFormL2(e.target.value ? parseInt(e.target.value) : null)}
                style={{ fontSize: ".8rem", padding: ".3rem .4rem", flex: 1, minWidth: "100px" }}>
                <option value="">选择章节</option>
                {formChaptersL2.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            {formKps.length > 0 && (
              <select value={formKp ?? ""} onChange={e => setFormKp(e.target.value ? parseInt(e.target.value) : null)}
                style={{ fontSize: ".8rem", padding: ".3rem .4rem", flex: 1, minWidth: "100px" }}>
                <option value="">选择知识点</option>
                {formKps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>
          <textarea value={formContent} onChange={e => setFormContent(e.target.value)} placeholder="解法文字说明，如：当x→0时，sinx~x, tanx~x, ln(1+x)~x ..."
            rows={4} style={{ width: "100%", boxSizing: "border-box", fontSize: ".82rem", lineHeight: 1.6, fontFamily: "inherit" }} />
          {/* Image upload */}
          <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
            <label style={{ fontSize: ".8rem", display: "flex", alignItems: "center", gap: ".3rem", cursor: "pointer", color: "var(--accent)" }}>
              <IconImage size={16} /> 选择图片
              <input type="file" accept="image/*" onChange={e => onImageChange(e.target.files?.[0] || null)}
                style={{ display: "none" }} />
            </label>
            {formImagePreview && (
              <img src={formImagePreview} alt="预览" style={{ maxHeight: "80px", borderRadius: "4px", objectFit: "cover" }}
                onClick={() => onImageChange(null)} title="点击移除" />
            )}
          </div>
          <div style={{ display: "flex", gap: ".5rem", justifyContent: "flex-end" }}>
            <button className="btn btn-primary" onClick={save} disabled={saving || !formTitle.trim()}
              style={{ fontSize: ".8rem", padding: ".35rem .8rem" }}>{saving ? "保存中..." : "保存"}</button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "2rem 0" }}>加载中...</p>
      ) : methods.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: ".5rem" }}><IconFileText size={36} /></div>
          <p>暂无题型解法记录</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: ".6rem" }}>
          {methods.map(m => {
            const tag = m.subject_name ? (m.chapter_name ? `${m.subject_name} / ${m.chapter_name}` : m.subject_name) : (m.chapter_name || "");
            return (
              <div key={m.id} className="card" style={{ padding: ".85rem", display: "flex", flexDirection: "column", gap: ".5rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
                  <span style={{ flex: 1, fontSize: ".9rem", fontWeight: 600 }}>{m.title}</span>
                  {tag && <span style={{ fontSize: ".7rem", background: "var(--tag-bg)", color: "var(--tag-text)", padding: ".15rem .4rem", borderRadius: "4px", whiteSpace: "nowrap" }}>{tag}</span>}
                  {authed && (
                    <>
                      <button onClick={() => startEdit(m)} style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: ".1rem" }} title="编辑">
                        <IconPencil size={14} />
                      </button>
                      <button onClick={() => del(m.id)} style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: ".1rem" }} title="删除">
                        <IconTrash size={14} />
                      </button>
                    </>
                  )}
                </div>
                {m.content && (
                  <div style={{ fontSize: ".82rem", lineHeight: 1.7, whiteSpace: "pre-wrap", color: "var(--text)" }}>{m.content}</div>
                )}
                {m.image_path && (
                  <a href={m.image_path} target="_blank" rel="noopener noreferrer">
                    <img src={m.image_path} alt={m.title} style={{ maxWidth: "100%", borderRadius: "6px", cursor: "zoom-in" }} />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Link href="/" style={{ fontSize: ".875rem", color: "var(--text-muted)", textDecoration: "none", textAlign: "center", paddingBottom: "1rem" }}>
        &larr; 返回首页
      </Link>
    </div>
  );
}
