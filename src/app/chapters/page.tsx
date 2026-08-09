"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { IconFolder, IconBook, IconFile, IconGrip } from "@/lib/icons";
import { useAuth } from "@/lib/auth-gate";
import { useModal } from "@/lib/modal";

interface ChapterNode {
  id: number; name: string; parent_id: number | null;
  level: number; sort_order: number;
  children: ChapterNode[];
}

export default function ChaptersPage() {
  const { authed } = useAuth();
  const modal = useModal();
  const [tree, setTree] = useState<ChapterNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [adding, setAdding] = useState<{ parent_id: number | null; level: number } | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");

  // 拖拽排序状态
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const dragOverIdRef = useRef<number | null>(null);
  dragOverIdRef.current = dragOverId;

  const loadTree = useCallback(async () => {
    const resp = await fetch("/api/chapters?tree=true");
    setTree(await resp.json());
  }, []);

  useEffect(() => { loadTree(); }, [loadTree]);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setLoading(true);
    const body: any = { name: newName.trim() };
    if (adding?.parent_id) body.parent_id = adding.parent_id;
    const resp = await fetch("/api/chapters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) { setError((await resp.json()).error || "添加失败"); setLoading(false); return; }
    setNewName(""); setAdding(null); setError("");
    await loadTree();
    setLoading(false);
  };

  const handleSave = async (id: number) => {
    if (!editName.trim()) return;
    setLoading(true);
    const resp = await fetch(`/api/chapters?id=${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim() }),
    });
    if (!resp.ok) { setError((await resp.json()).error || "保存失败"); setLoading(false); return; }
    setEditing(null); setError("");
    await loadTree();
    setLoading(false);
  };

  const handleDelete = async (node: ChapterNode) => {
    setError("");
    const label = node.level === 1 ? "科目" : node.level === 2 ? "章节" : "知识点";
    if (node.children.length > 0) { setError("内含子分类，不可删除"); return; }
    if (!await modal.confirm(`删除${label}`, `确定删除${label}「${node.name}」？`)) return;
    const resp = await fetch(`/api/chapters?id=${node.id}`, { method: "DELETE" });
    if (!resp.ok) { setError((await resp.json()).error || "删除失败"); return; }
    await loadTree();
  };

  // 在树中查找节点
  const findNode = (nodes: ChapterNode[], id: number): ChapterNode | null => {
    for (const n of nodes) {
      if (n.id === id) return n;
      const found = findNode(n.children, id);
      if (found) return found;
    }
    return null;
  };

  // 在树中查找同级兄弟节点数组（返回引用和父节点）
  const findSiblings = (nodes: ChapterNode[], id: number, parent: ChapterNode | null): { siblings: ChapterNode[]; parent: ChapterNode | null } | null => {
    for (const n of nodes) {
      if (n.id === id) return { siblings: nodes, parent };
      const found = findSiblings(n.children, id, n);
      if (found) return found;
    }
    return null;
  };

  // 深拷贝树
  const cloneTree = (nodes: ChapterNode[]): ChapterNode[] =>
    nodes.map(n => ({ ...n, children: cloneTree(n.children) }));

  // 拖拽放置：将 draggingNode 移动到 dragOverNode 的位置（同级重新排列）
  const handleDrop = async (targetNode: ChapterNode) => {
    const overId = dragOverIdRef.current;
    if (draggingId === null || overId === null) return;
    if (draggingId === targetNode.id) return;

    const dragNode = findNode(tree, draggingId);
    if (!dragNode) return;
    // 只允许同级拖拽（parent_id 相同）
    if (dragNode.parent_id !== targetNode.parent_id) return;

    // 乐观更新：先更新 UI
    const newTree = cloneTree(tree);
    const sibInfo = findSiblings(newTree, draggingId, null);
    if (!sibInfo) return;
    const siblings = sibInfo.siblings;

    const fromIdx = siblings.findIndex(s => s.id === draggingId);
    const toIdx = siblings.findIndex(s => s.id === targetNode.id);
    if (fromIdx === -1 || toIdx === -1) return;

    // 移除拖拽节点，插入到目标位置
    const [moved] = siblings.splice(fromIdx, 1);
    siblings.splice(toIdx, 0, moved);

    // 更新 sort_order
    const reorderItems = siblings.map((s, i) => ({ id: s.id, sort_order: i }));
    siblings.forEach((s, i) => { s.sort_order = i; });

    setTree(newTree);
    setDraggingId(null);
    setDragOverId(null);

    // 调用 API 批量更新
    try {
      await fetch("/api/chapters/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: reorderItems }),
      });
    } catch {
      // 失败时重新加载
      await loadTree();
    }
  };

  const startEdit = (node: ChapterNode) => { setEditing(node.id); setEditName(node.name); setAdding(null); };
  const startAdd = (parentId: number | null, level: number) => {
    setAdding({ parent_id: parentId, level });
    setNewName("");
    setEditing(null);
    setError("");
  };

  const levelLabel = (level: number) => level === 1 ? "科目" : level === 2 ? "章节" : "知识点";
  const levelStyle = (level: number): React.CSSProperties => ({
    fontSize: level === 1 ? "1.05rem" : level === 2 ? ".9rem" : ".8rem",
    fontWeight: level === 1 ? 700 : level === 2 ? 600 : 400,
    paddingLeft: `${(level - 1) * 1}rem`,
  });

  const renderNode = (node: ChapterNode) => {
    const isDragging = draggingId === node.id;
    const isDragOver = dragOverId === node.id;
    // 拖拽手柄只在登录后显示
    const showGrip = authed && editing !== node.id;

    return (
      <div key={node.id} style={{ padding: ".3rem 0" }}>
        <div
          style={{
            display: "flex", alignItems: "flex-start", flexWrap: "wrap", gap: ".3rem .5rem",
            ...levelStyle(node.level),
            opacity: isDragging ? 0.4 : 1,
            background: isDragOver ? "var(--bg-hover)" : "transparent",
            borderRadius: isDragOver ? ".25rem" : 0,
            transition: "background .15s, opacity .15s",
          }}
          onDragOver={(e) => {
            // 只允许同级拖拽放置
            if (draggingId !== null) {
              const dragNode = findNode(tree, draggingId);
              if (dragNode && dragNode.parent_id === node.parent_id && draggingId !== node.id) {
                e.preventDefault();
                setDragOverId(node.id);
              }
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            handleDrop(node);
          }}
        >
          {editing === node.id ? (
            <>
              <input value={editName} onChange={e => setEditName(e.target.value)}
                style={{ flex: "1 1 100%", fontSize: "inherit", minWidth: 0 }}
                onKeyDown={e => e.key === "Enter" && handleSave(node.id)}
                autoFocus
              />
              <button className="btn btn-primary" style={{ fontSize: ".7rem", padding: ".2rem .5rem" }} onClick={() => handleSave(node.id)} disabled={loading}>保存</button>
              <button className="btn" style={{ fontSize: ".7rem", padding: ".2rem .5rem" }} onClick={() => setEditing(null)}>取消</button>
            </>
          ) : (
            <>
              {showGrip && (
                <span
                  draggable
                  onDragStart={(e) => {
                    setDraggingId(node.id);
                    e.dataTransfer.effectAllowed = "move";
                    // Firefox 需要 setData 才能触发 drag
                    e.dataTransfer.setData("text/plain", String(node.id));
                  }}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDragOverId(null);
                  }}
                  style={{
                    cursor: "grab", flexShrink: 0, display: "flex", alignItems: "center",
                    color: "var(--text-muted)", padding: ".1rem", marginTop: ".15rem",
                  }}
                  title="拖拽排序"
                >
                  <IconGrip size={12} />
                </span>
              )}
              <span style={{ flex: "1 1 0", minWidth: 0, wordBreak: "break-word", lineHeight: 1.5 }}>
                <span style={{ color: "var(--text-muted)", marginRight: ".25rem" }}>
                  {node.level === 1 ? <IconFolder size={14} /> : node.level === 2 ? <IconBook size={14} /> : <IconFile size={14} />}
                </span>
                {node.name}
              </span>
              {authed && <div style={{ display: "flex", gap: ".3rem", flexWrap: "wrap" }}>
                <button className="btn" style={{ fontSize: ".65rem", padding: ".15rem .35rem" }} onClick={() => startEdit(node)}>重命名</button>
                {node.level < 3 && (
                  <button className="btn" style={{ fontSize: ".65rem", padding: ".15rem .35rem" }} onClick={() => startAdd(node.id, node.level + 1)}>
                    +{levelLabel(node.level + 1)}
                  </button>
                )}
                <button className="btn" style={{ fontSize: ".65rem", padding: ".15rem .35rem", color: "var(--red-text)" }} onClick={() => handleDelete(node)}>删除</button>
              </div>}
            </>
          )}
        </div>
        {node.children.length > 0 && (
          <div>{node.children.map(renderNode)}</div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: ".75rem" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, flex: 1 }}>科目章节管理</h1>
        {authed && <button className="btn btn-primary" style={{ fontSize: ".8rem" }} onClick={() => startAdd(null, 1)} disabled={!!adding}>
          + 添加科目
        </button>}
      </div>

      {authed && (
        <div style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>
          提示：拖拽 ⠶ 手柄可在同级分类间上下排序
        </div>
      )}

      {error && (
        <div className="card" style={{ borderColor: "var(--red-text)", background: "var(--red-bg)", color: "var(--red-text)", fontSize: ".875rem" }}>
          {error}
          <button className="btn" style={{ marginLeft: ".5rem", fontSize: ".8rem" }} onClick={() => setError("")}>关闭</button>
        </div>
      )}

      {/* Add new item form */}
      {adding && (
        <div className="card" style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: ".85rem", whiteSpace: "nowrap" }}>新增{levelLabel(adding.level)}：</span>
          <input value={newName} onChange={e => setNewName(e.target.value)}
            placeholder={`输入${levelLabel(adding.level)}名称`}
            style={{ flex: 1, minWidth: "120px" }}
            onKeyDown={e => e.key === "Enter" && handleAdd()}
            autoFocus
          />
          <button className="btn btn-primary" style={{ fontSize: ".8rem" }} onClick={handleAdd} disabled={loading}>添加</button>
          <button className="btn" style={{ fontSize: ".8rem" }} onClick={() => setAdding(null)}>取消</button>
        </div>
      )}

      <div className="card">
        {tree.length === 0 ? (
          <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "1rem 0" }}>暂无分类，请先添加科目</p>
        ) : (
          tree.map(renderNode)
        )}
      </div>

      <Link href="/" style={{ fontSize: ".875rem", color: "var(--text-muted)", textDecoration: "none" }}>← 返回首页</Link>
    </div>
  );
}
