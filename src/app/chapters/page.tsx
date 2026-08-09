"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { IconFolder, IconBook, IconFile, IconGrip, IconChevronDown, IconChevronRight } from "@/lib/icons";
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

  // 展开/折叠状态（按节点 id 记录，默认全部展开）
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  // 动态拖拽状态
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<"before" | "after">("before");
  const dragIdRef = useRef<number | null>(null);
  const dragOverIdRef = useRef<number | null>(null);
  const dragPosRef = useRef<"before" | "after">("before");
  dragIdRef.current = dragId;
  dragOverIdRef.current = dragOverId;
  dragPosRef.current = dragPos;

  const loadTree = useCallback(async () => {
    const resp = await fetch("/api/chapters?tree=true");
    setTree(await resp.json());
  }, []);

  useEffect(() => { loadTree(); }, [loadTree]);

  const toggleCollapse = (id: number) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  const startEdit = (node: ChapterNode) => { setEditing(node.id); setEditName(node.name); setAdding(null); };
  const startAdd = (parentId: number | null, level: number) => {
    setAdding({ parent_id: parentId, level });
    setNewName("");
    setEditing(null);
    setError("");
  };

  const levelLabel = (level: number) => level === 1 ? "科目" : level === 2 ? "章节" : "知识点";

  // 树工具函数
  const findNode = (nodes: ChapterNode[], id: number): ChapterNode | null => {
    for (const n of nodes) {
      if (n.id === id) return n;
      const found = findNode(n.children, id);
      if (found) return found;
    }
    return null;
  };

  const findSiblings = (nodes: ChapterNode[], id: number): ChapterNode[] | null => {
    for (const n of nodes) {
      if (n.id === id) return nodes;
      const found = findSiblings(n.children, id);
      if (found) return found;
    }
    return null;
  };

  const cloneTree = (nodes: ChapterNode[]): ChapterNode[] =>
    nodes.map(n => ({ ...n, children: cloneTree(n.children) }));

  // 拖拽结束：重新排列同级节点
  const handleReorder = async (targetId: number, pos: "before" | "after") => {
    const srcId = dragIdRef.current;
    if (srcId === null || srcId === targetId) {
      setDragId(null); setDragOverId(null);
      return;
    }
    const dragNode = findNode(tree, srcId);
    const targetNode = findNode(tree, targetId);
    if (!dragNode || !targetNode || dragNode.parent_id !== targetNode.parent_id) {
      setDragId(null); setDragOverId(null);
      return;
    }

    const newTree = cloneTree(tree);
    const siblings = findSiblings(newTree, srcId);
    if (!siblings) { setDragId(null); setDragOverId(null); return; }

    const fromIdx = siblings.findIndex(s => s.id === srcId);
    const [moved] = siblings.splice(fromIdx, 1);
    let toIdx = siblings.findIndex(s => s.id === targetId);
    const insertIdx = pos === "before" ? toIdx : toIdx + 1;
    siblings.splice(insertIdx, 0, moved);

    const reorderItems = siblings.map((s, i) => ({ id: s.id, sort_order: i }));
    siblings.forEach((s, i) => { s.sort_order = i; });

    setTree(newTree);
    setDragId(null);
    setDragOverId(null);

    try {
      await fetch("/api/chapters/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: reorderItems }),
      });
    } catch {
      await loadTree();
    }
  };

  // 拖拽手柄 onPointerDown → 进入自定义拖拽模式
  const onGripPointerDown = (e: React.PointerEvent, nodeId: number) => {
    if (!authed) return;
    e.preventDefault();
    e.stopPropagation();
    setDragId(nodeId);
  };

  // 全局 pointerup 完成放置
  useEffect(() => {
    if (dragId === null) return;
    const handleUp = () => {
      const overId = dragOverIdRef.current;
      const pos = dragPosRef.current;
      if (overId !== null && overId !== dragId) {
        handleReorder(overId, pos);
      } else {
        setDragId(null);
        setDragOverId(null);
      }
    };
    window.addEventListener("pointerup", handleUp);
    return () => { window.removeEventListener("pointerup", handleUp); };
  }, [dragId]);

  // 卡片 onPointerMove：判断鼠标是否在此卡片上，并计算 before/after
  const onCardPointerMove = (e: React.PointerEvent, node: ChapterNode) => {
    if (dragId === null || dragId === node.id) return;
    const dragNode = findNode(tree, dragId);
    if (!dragNode || dragNode.parent_id !== node.parent_id) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const pos: "before" | "after" = offsetX < rect.width / 2 ? "before" : "after";
    setDragOverId(node.id);
    setDragPos(pos);
  };

  // 层级图标（科目/章节/知识点）
  const LevelIcon = ({ level }: { level: number }) =>
    level === 1 ? <IconFolder size={15} /> : level === 2 ? <IconBook size={15} /> : <IconFile size={15} />;

  // 统一卡片渲染（无缩进，靠左）
  const renderCard = (node: ChapterNode): React.ReactNode => {
    const isDrag = dragId === node.id;
    const isOver = dragOverId === node.id;
    const overPos = isOver ? dragPos : "before";
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.id);

    // 卡片样式：横向圆角长方形，内容居左
    const cardStyle: React.CSSProperties = {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-start", // 居左
      gap: ".4rem",
      padding: ".5rem .75rem",
      margin: ".3rem 0",
      borderRadius: "12px",
      background: isOver ? "var(--bg-hover)" : "var(--bg-card)",
      border: "1px solid var(--border)",
      boxShadow: "var(--shadow)",
      transition: "background .15s, opacity .15s, border-color .15s",
      opacity: isDrag ? 0.4 : 1,
      borderLeftWidth: isOver && overPos === "before" ? "3px" : "1px",
      borderRightWidth: isOver && overPos === "after" ? "3px" : "1px",
      borderLeftColor: isOver && overPos === "before" ? "var(--accent)" : "var(--border)",
      borderRightColor: isOver && overPos === "after" ? "var(--accent)" : "var(--border)",
    };

    return (
      <div key={node.id}>
        <div
          style={cardStyle}
          onPointerMove={(e) => onCardPointerMove(e, node)}
        >
          {/* 拖拽手柄 */}
          {authed && editing !== node.id && (
            <span
              onPointerDown={(e) => onGripPointerDown(e, node.id)}
              style={{
                cursor: dragId !== null ? "grabbing" : "grab",
                flexShrink: 0, display: "flex", alignItems: "center",
                color: "var(--text-muted)", touchAction: "none",
              }}
              title="拖拽排序"
            >
              <IconGrip size={14} />
            </span>
          )}

          {/* 展开/折叠按钮（仅有子节点时显示） */}
          {hasChildren ? (
            <span
              onClick={() => toggleCollapse(node.id)}
              style={{ cursor: "pointer", display: "flex", alignItems: "center", flexShrink: 0, color: "var(--text-muted)" }}
              title={isCollapsed ? "展开" : "折叠"}
            >
              {isCollapsed ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
            </span>
          ) : (
            <span style={{ width: "14px", flexShrink: 0 }} />
          )}

          {/* 编辑模式 */}
          {editing === node.id ? (
            <div style={{ display: "flex", gap: ".4rem", flex: 1, flexWrap: "wrap", alignItems: "center" }}>
              <input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                style={{
                  flex: "1 1 150px", minWidth: "120px", fontSize: ".9rem",
                  padding: ".3rem .5rem", borderRadius: "8px",
                  border: "1px solid var(--accent)", background: "var(--bg-card)", color: "var(--text)",
                }}
                onKeyDown={e => e.key === "Enter" && handleSave(node.id)}
                autoFocus
              />
              <button className="btn btn-primary" style={{ fontSize: ".75rem", padding: ".3rem .6rem" }} onClick={() => handleSave(node.id)} disabled={loading}>保存</button>
              <button className="btn" style={{ fontSize: ".75rem", padding: ".3rem .6rem" }} onClick={() => setEditing(null)}>取消</button>
            </div>
          ) : (
            <>
              {/* 图标 */}
              <span style={{ color: "var(--text-muted)", display: "flex", alignItems: "center", flexShrink: 0 }}>
                <LevelIcon level={node.level} />
              </span>
              {/* 名称 */}
              <span style={{
                flex: "0 1 auto", minWidth: 0, wordBreak: "break-word", lineHeight: 1.4,
                fontSize: node.level === 1 ? ".95rem" : node.level === 2 ? ".85rem" : ".8rem",
                fontWeight: node.level === 1 ? 600 : node.level === 2 ? 500 : 400,
                marginRight: ".5rem",
              }}>
                {node.name}
              </span>
              {/* 子项数标签 */}
              {hasChildren && (
                <span style={{
                  fontSize: ".7rem", color: "var(--text-muted)",
                  background: "var(--bg-hover)", padding: ".1rem .4rem", borderRadius: "6px",
                  flexShrink: 0,
                }}>
                  {node.children.length}
                </span>
              )}
              {/* 操作按钮 */}
              {authed && (
                <div style={{ display: "flex", gap: ".25rem", flexShrink: 0, flexWrap: "wrap", marginLeft: "auto" }}>
                  <button className="btn" style={{ fontSize: ".7rem", padding: ".2rem .45rem", borderRadius: "6px" }} onClick={() => startEdit(node)}>重命名</button>
                  {node.level < 3 && (
                    <button className="btn" style={{ fontSize: ".7rem", padding: ".2rem .45rem", borderRadius: "6px" }} onClick={() => startAdd(node.id, node.level + 1)}>
                      +{levelLabel(node.level + 1)}
                    </button>
                  )}
                  <button className="btn" style={{ fontSize: ".7rem", padding: ".2rem .45rem", borderRadius: "6px", color: "var(--red-text)" }} onClick={() => handleDelete(node)}>删除</button>
                </div>
              )}
            </>
          )}
        </div>

        {/* 子节点列表（展开时显示，无缩进） */}
        {hasChildren && !isCollapsed && (
          <div>{node.children.map(renderCard)}</div>
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
          提示：拖拽 ⠶ 手柄可在同级分类间排序；点击 ▼/▶ 可展开/折叠子分类
        </div>
      )}

      {error && (
        <div className="card" style={{ borderColor: "var(--red-text)", background: "var(--red-bg)", color: "var(--red-text)", fontSize: ".875rem" }}>
          {error}
          <button className="btn" style={{ marginLeft: ".5rem", fontSize: ".8rem" }} onClick={() => setError("")}>关闭</button>
        </div>
      )}

      {adding && (
        <div className="card" style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: ".85rem", whiteSpace: "nowrap" }}>新增{levelLabel(adding.level)}：</span>
          <input value={newName} onChange={e => setNewName(e.target.value)}
            placeholder={`输入${levelLabel(adding.level)}名称`}
            style={{
              flex: 1, minWidth: "120px", fontSize: ".9rem",
              padding: ".3rem .5rem", borderRadius: "8px",
              border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text)",
            }}
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
          tree.map(renderCard)
        )}
      </div>

      <Link href="/" style={{ fontSize: ".875rem", color: "var(--text-muted)", textDecoration: "none" }}>← 返回首页</Link>
    </div>
  );
}
