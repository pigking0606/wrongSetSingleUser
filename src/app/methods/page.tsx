"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  IconBook, IconPlus, IconPencil, IconTrash, IconX, IconImage, IconFileText, IconSparkle,
} from "@/lib/icons";
import { useAuth } from "@/lib/auth-gate";
import { useModal } from "@/lib/modal";
import MathText from "@/lib/math-text";
import FlowchartEditor, { type FlowNode, type FlowEdge } from "@/lib/flowchart-editor";
import FlowchartViewer from "@/lib/flowchart-viewer";

interface Chapter { id: number; name: string; level: number; parent_id: number | null; }
interface Method {
  id: number; title: string; chapter_id: number | null; content: string;
  image_path: string | null; example_images: string | null;
  flowchart_data: string | null;  // 新增
  created_at: string;
  chapter_name: string | null; subject_name: string | null;
}

// 解析 image_path / example_images 字段：可能是 JSON 数组字符串，也可能是旧版单 URL 字符串
function parseImages(raw: string | null): string[] {
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try { return JSON.parse(raw); } catch { return [raw]; }
  }
  return [raw];
}

// 将 /uploads/xxx.jpg 转为 /api/image/xxx.jpg，避免静态文件 404
function toImageUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("/uploads/")) return `/api/image/${url.replace("/uploads/", "")}`;
  return url;
}

type FormImage = { file: File | null; preview: string; url?: string };

export default function MethodsPage() {
  const { authed } = useAuth();
  const modal = useModal();
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
  // 解法流程图（供 AI 解析生成 content）
  const [formSolutionImages, setFormSolutionImages] = useState<FormImage[]>([]);
  // 例题图片（与解法图分离，独立展示）
  const [formExampleImages, setFormExampleImages] = useState<FormImage[]>([]);
  const [saving, setSaving] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [showFlowchart, setShowFlowchart] = useState(false);
  const [aiFlowchartData, setAiFlowchartData] = useState<{ nodes: FlowNode[]; edges: FlowEdge[] } | null>(null);
  const [aiGenerated, setAiGenerated] = useState(false);
  const [flowchartData, setFlowchartData] = useState<{ nodes: FlowNode[]; edges: FlowEdge[] } | null>(null);

  const toast = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(""), 3500); };

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

  // 挂载时检查 sessionStorage 是否有 AI 预填数据（从 questions 页面跳转过来）
  useEffect(() => {
    const stored = sessionStorage.getItem("aiGeneratedMethod");
    if (stored) {
      try {
        const data = JSON.parse(stored);
        setFormTitle(data.title || "");
        setFormContent(data.content || "");
        if (data.flowchart && Array.isArray(data.flowchart.nodes) && data.flowchart.nodes.length > 0) {
          const fc = { nodes: data.flowchart.nodes, edges: data.flowchart.edges || [] };
          setAiFlowchartData(fc);    // 传给编辑器作 initialNodes/initialEdges
          setFlowchartData(fc);      // 同步到可保存状态，避免用户不打开编辑器就丢失流程图数据
        }
        setAiGenerated(true);
        setShowForm(true); // 显示表单以展示预填数据
        sessionStorage.removeItem("aiGeneratedMethod");
      } catch { /* ignore */ }
    }
  }, []);

  const resetForm = () => {
    setEditId(null); setFormTitle(""); setFormSubject(null); setFormL2(null);
    setFormKp(null); setFormContent("");
    setFormSolutionImages([]); setFormExampleImages([]);
    setFormChaptersL2([]); setFormKps([]);
    setAiFlowchartData(null); setFlowchartData(null); setAiGenerated(false);
  };

  const startEdit = (m: Method) => {
    setEditId(m.id); setFormTitle(m.title); setFormContent(m.content || "");
    // 解法图
    const solImgs = parseImages(m.image_path);
    setFormSolutionImages(solImgs.map(url => ({ file: null, preview: toImageUrl(url), url })));
    // 例题图
    const exImgs = parseImages(m.example_images);
    setFormExampleImages(exImgs.map(url => ({ file: null, preview: toImageUrl(url), url })));
    // 章节预填：仅设置 kp，父级链不展开（简单处理，用户可手动改）
    setFormSubject(null); setFormL2(null); setFormKp(m.chapter_id || null);
    // 加载现有 flowchart_data
    setFlowchartData(m.flowchart_data ? JSON.parse(m.flowchart_data) : null);
    setAiFlowchartData(null); setAiGenerated(false);
    setShowForm(true);
  };

  // 通用：添加本地文件到指定图片列表
  const addImagesToList = (
    setList: React.Dispatch<React.SetStateAction<FormImage[]>>,
    files: FileList | null,
    max: number,
    label: string
  ) => {
    if (!files || files.length === 0) return;
    setList(prev => {
      const remaining = max - prev.length;
      if (remaining <= 0) { toast(`最多 ${max} 张${label}`); return prev; }
      const arr = Array.from(files).slice(0, remaining);
      const newItems = arr.map(file => ({
        file,
        preview: URL.createObjectURL(file),
        url: undefined,
      }));
      return [...prev, ...newItems];
    });
  };

  const removeImageFromList = (
    setList: React.Dispatch<React.SetStateAction<FormImage[]>>,
    idx: number
  ) => {
    setList(prev => {
      const next = [...prev];
      const item = next[idx];
      if (item.file && item.preview.startsWith("blob:")) URL.revokeObjectURL(item.preview);
      next.splice(idx, 1);
      return next;
    });
  };

  const addSolutionImages = (files: FileList | null) =>
    addImagesToList(setFormSolutionImages, files, 5, "解法流程图");
  const addExampleImages = (files: FileList | null) =>
    addImagesToList(setFormExampleImages, files, 10, "例题图片");

  // 流程图编辑器保存的 PNG blob 加入解法流程图列表，同时保存结构化数据
  const handleFlowchartSave = useCallback((pngBlob: Blob, data?: { nodes: FlowNode[]; edges: FlowEdge[] }) => {
    setFormSolutionImages(prev => {
      if (prev.length >= 5) { toast("解法流程图最多 5 张，请先删除一张"); return prev; }
      const file = new File([pngBlob], `flowchart-${Date.now()}.png`, { type: "image/png" });
      const preview = URL.createObjectURL(pngBlob);
      return [...prev, { file, preview, url: undefined }];
    });
    if (data) setFlowchartData(data);
    setShowFlowchart(false);
    setAiFlowchartData(null); // 清空初始数据，避免重复
    toast("流程图已加入解法流程图");
  }, []);
  const removeSolutionImage = (idx: number) => removeImageFromList(setFormSolutionImages, idx);
  const removeExampleImage = (idx: number) => removeImageFromList(setFormExampleImages, idx);

  // AI 解析：只发送解法流程图，让 AI 生成 title + content
  const runAiAnalyze = async () => {
    if (formSolutionImages.length === 0) {
      toast("请先上传至少一张解法流程图再使用 AI 解析");
      return;
    }
    setAiAnalyzing(true);
    try {
      const fd = new FormData();
      let idx = 0;
      for (const img of formSolutionImages) {
        let blob: Blob;
        if (img.file) {
          blob = img.file;
        } else if (img.url) {
          const r = await fetch(toImageUrl(img.url));
          if (!r.ok) { toast(`第 ${idx + 1} 张解法图加载失败`); setAiAnalyzing(false); return; }
          blob = await r.blob();
        } else { continue; }
        fd.append(`image_${idx}`, blob, `image_${idx}.jpg`);
        idx++;
      }
      const resp = await fetch("/api/methods/ai-analyze", { method: "POST", body: fd });
      const data = await resp.json();
      if (!resp.ok) { toast(data.error || "AI 解析失败"); setAiAnalyzing(false); return; }
      if (data.title && !formTitle.trim()) setFormTitle(data.title);
      if (data.content) setFormContent(data.content);
      toast("AI 解析完成，已填入解法说明（可继续编辑）");
    } catch (err) {
      toast("AI 解析失败：" + (err instanceof Error ? err.message : "未知错误"));
    }
    setAiAnalyzing(false);
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

      // 解法图：保留的旧图 + 新上传
      const keepSol = formSolutionImages.filter(it => !it.file && it.url).map(it => it.url!);
      fd.append("keep_images", JSON.stringify(keepSol));
      let solIdx = 0;
      for (const it of formSolutionImages) {
        if (it.file) { fd.append(`image_${solIdx}`, it.file); solIdx++; }
      }

      // 例题图：保留的旧图 + 新上传
      const keepEx = formExampleImages.filter(it => !it.file && it.url).map(it => it.url!);
      fd.append("keep_example_images", JSON.stringify(keepEx));
      let exIdx = 0;
      for (const it of formExampleImages) {
        if (it.file) { fd.append(`example_image_${exIdx}`, it.file); exIdx++; }
      }

      // 结构化流程图数据（JSON 字符串）
      if (flowchartData) {
        fd.append("flowchart_data", JSON.stringify(flowchartData));
      }

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
    if (!await modal.confirm("删除题型解法", "确定删除这个题型解法？此操作不可恢复。")) return;
    const r = await fetch(`/api/methods/${id}`, { method: "DELETE" });
    if (!r.ok) { toast("删除失败"); return; }
    await loadMethods();
    toast("已删除");
  };

  // 通用图片网格渲染（用于表单内）
  const renderImageGrid = (
    list: FormImage[],
    onAdd: (files: FileList | null) => void,
    onRemove: (idx: number) => void,
    max: number,
    label: string
  ) => (
    <div style={{ display: "flex", flexDirection: "column", gap: ".4rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>{label}（最多 {max} 张）</span>
        <span style={{ fontSize: ".75rem", color: list.length >= max ? "var(--red-text)" : "var(--text-muted)" }}>{list.length}/{max}</span>
      </div>
      <div style={{ display: "flex", gap: ".4rem", flexWrap: "wrap" }}>
        {list.map((it, i) => (
          <div key={i} style={{ position: "relative", width: "72px", height: "72px" }}>
            <img src={it.preview} alt={`${label}${i+1}`} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "4px" }} />
            <button onClick={() => onRemove(i)} style={{
              position: "absolute", top: "-6px", right: "-6px", width: "20px", height: "20px",
              borderRadius: "50%", background: "var(--red-text)", color: "#fff", border: "none",
              cursor: "pointer", fontSize: ".7rem", lineHeight: 1, display: "flex",
              alignItems: "center", justifyContent: "center",
            }}>×</button>
          </div>
        ))}
        {list.length < max && (
          <label style={{
            width: "72px", height: "72px", borderRadius: "4px", border: "1px dashed var(--border)",
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            color: "var(--text-muted)", background: "var(--bg-hover)",
          }}>
            <IconPlus size={20} />
            <input type="file" accept="image/*" multiple onChange={e => onAdd(e.target.files)} style={{ display: "none" }} />
          </label>
        )}
      </div>
    </div>
  );

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

          {/* 题型名称 */}
          <input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="题型名称，如：极限的等价无穷小替换"
            style={{ fontSize: ".85rem", padding: ".4rem .5rem" }} autoFocus />

          {/* 章节选择 */}
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

          {/* 栏目 1：题型通用解法（图 + 文字 + AI 按钮） */}
          <div style={{ borderTop: "1px dashed var(--border)", paddingTop: ".6rem", marginTop: ".2rem" }}>
            <div style={{ fontSize: ".85rem", fontWeight: 600, marginBottom: ".4rem", color: "var(--text)" }}>
              ① 题型通用解法
            </div>
            {renderImageGrid(formSolutionImages, addSolutionImages, removeSolutionImage, 5, "解法流程图")}
            {/* 已有流程图数据（AI 生成或手动绘制）时展示只读预览，点击可放大 */}
            {flowchartData && flowchartData.nodes.length > 0 && (
              <div style={{ marginTop: ".3rem" }}>
                <div style={{ fontSize: ".7rem", color: "var(--text-muted)", marginBottom: ".2rem" }}>
                  {aiFlowchartData ? "AI 生成的流程图（可直接保存，或点击下方按钮编辑）" : "当前流程图"}
                </div>
                <FlowchartViewer data={flowchartData} maxHeight={240} />
              </div>
            )}
            <div style={{ display: "flex", gap: ".4rem", marginTop: ".3rem", flexWrap: "wrap" }}>
              <button className="btn" onClick={() => setShowFlowchart(true)}
                style={{ fontSize: ".75rem", padding: ".3rem .6rem", display: "flex", alignItems: "center", gap: ".25rem" }}>
                <IconImage size={13} /> {flowchartData ? "编辑流程图" : "绘制流程图"}
              </button>
            </div>
            <p style={{ fontSize: ".7rem", color: "var(--text-muted)", margin: ".3rem 0" }}>
              上传解题流程图，AI 会据此自动生成下方解法文字。要求简洁、与图片流程一致。
            </p>
            <button className="btn btn-primary" onClick={runAiAnalyze} disabled={aiAnalyzing || formSolutionImages.length === 0}
              style={{ fontSize: ".8rem", padding: ".4rem .75rem", display: "flex", alignItems: "center", gap: ".3rem", justifyContent: "center", width: "100%" }}>
              <IconSparkle size={14} /> {aiAnalyzing ? "AI 解析中（约 1-2 分钟）..." : "AI 按图片解析解法"}
            </button>
            <textarea value={formContent} onChange={e => setFormContent(e.target.value)} placeholder="解法文字说明 — 可点击上方「AI 按图片解析解法」自动生成"
              rows={8} style={{ width: "100%", boxSizing: "border-box", fontSize: ".82rem", lineHeight: 1.6, fontFamily: "inherit", marginTop: ".4rem" }} />
          </div>

          {/* 栏目 2：例题（独立图片栏） */}
          <div style={{ borderTop: "1px dashed var(--border)", paddingTop: ".6rem" }}>
            <div style={{ fontSize: ".85rem", fontWeight: 600, marginBottom: ".4rem", color: "var(--text)" }}>
              ② 例题（独立于解法图）
            </div>
            {renderImageGrid(formExampleImages, addExampleImages, removeExampleImage, 10, "例题图片")}
            <p style={{ fontSize: ".7rem", color: "var(--text-muted)", margin: ".3rem 0" }}>
              上传属于该题型的例题图片，与上方解法流程图分开存储和展示。
            </p>
          </div>

          <div style={{ display: "flex", gap: ".5rem", justifyContent: "flex-end" }}>
            <button className="btn btn-primary" onClick={save} disabled={saving || !formTitle.trim()}
              style={{ fontSize: ".8rem", padding: ".35rem .8rem" }}>{saving ? "保存中..." : "保存"}</button>
          </div>
        </div>
      )}

      {/* 流程图绘制模态框 */}
      {showFlowchart && (
        <FlowchartEditor
          onClose={() => setShowFlowchart(false)}
          onSave={handleFlowchartSave}
          initialNodes={aiFlowchartData?.nodes}
          initialEdges={aiFlowchartData?.edges}
        />
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
            const solImgs = parseImages(m.image_path);
            const exImgs = parseImages(m.example_images);
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
                  <div style={{ fontSize: ".82rem", lineHeight: 1.7, whiteSpace: "pre-wrap", color: "var(--text)" }}>
                    <MathText text={m.content} />
                  </div>
                )}
                {/* 结构化流程图（优先于 PNG 展示，可点击放大） */}
                {m.flowchart_data && (() => {
                  try {
                    const parsed = JSON.parse(m.flowchart_data);
                    if (parsed.nodes && Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: ".25rem" }}>
                          <div style={{ fontSize: ".7rem", color: "var(--text-muted)", fontWeight: 600 }}>流程图</div>
                          <FlowchartViewer data={{ nodes: parsed.nodes, edges: parsed.edges || [] }} />
                        </div>
                      );
                    }
                  } catch { /* ignore malformed JSON */ }
                  return null;
                })()}
                {/* 题型通用解法图 */}
                {solImgs.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: ".25rem" }}>
                    <div style={{ fontSize: ".7rem", color: "var(--text-muted)", fontWeight: 600 }}>解法流程图</div>
                    <div style={{ display: "flex", gap: ".4rem", flexWrap: "wrap" }}>
                      {solImgs.map((url, i) => (
                        <a key={i} href={toImageUrl(url)} target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>
                          <img src={toImageUrl(url)} alt={`${m.title} 解法图${i+1}`}
                            style={{ height: "100px", borderRadius: "6px", cursor: "zoom-in", objectFit: "cover" }} />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                {/* 例题图（独立栏） */}
                {exImgs.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: ".25rem", borderTop: "1px dashed var(--border)", paddingTop: ".4rem" }}>
                    <div style={{ fontSize: ".7rem", color: "var(--text-muted)", fontWeight: 600 }}>例题（{exImgs.length} 题）</div>
                    <div style={{ display: "flex", gap: ".4rem", flexWrap: "wrap" }}>
                      {exImgs.map((url, i) => (
                        <a key={i} href={toImageUrl(url)} target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>
                          <img src={toImageUrl(url)} alt={`${m.title} 例题${i+1}`}
                            style={{ height: "100px", borderRadius: "6px", cursor: "zoom-in", objectFit: "cover" }} />
                        </a>
                      ))}
                    </div>
                  </div>
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
