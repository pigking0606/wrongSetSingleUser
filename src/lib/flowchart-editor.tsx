"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export type NodeShape = "rect" | "diamond" | "ellipse" | "parallelogram";
export type AnchorPos = "top" | "bottom" | "left" | "right";

export interface FlowNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  shape: NodeShape;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  fromAnchor: AnchorPos;  // 用户拖拽起点锚点
  toAnchor: AnchorPos;    // 目标节点上离松开位置最近的锚点
}

export interface FlowchartData {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

interface Props {
  onClose: () => void;
  onSave: (pngBlob: Blob, data: FlowchartData) => void;
  initialNodes?: FlowNode[];
  initialEdges?: FlowEdge[];
}

const SHAPES: { value: NodeShape; label: string }[] = [
  { value: "rect", label: "矩形" },
  { value: "diamond", label: "菱形" },
  { value: "ellipse", label: "椭圆" },
  { value: "parallelogram", label: "平行四边形" },
];

let nodeCounter = 0;
const newId = () => `n${++nodeCounter}_${Date.now()}`;

const CANVAS_W = 900;
const CANVAS_H = 520;

export default function FlowchartEditor({ onClose, onSave, initialNodes, initialEdges }: Props) {
  const [nodes, setNodes] = useState<FlowNode[]>(initialNodes && initialNodes.length > 0 ? initialNodes : [
    { id: newId(), x: 380, y: 30, w: 140, h: 50, text: "开始", shape: "ellipse" },
  ]);
  const [edges, setEdges] = useState<FlowEdge[]>(initialEdges || []);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [editingEdgeLabel, setEditingEdgeLabel] = useState<string | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<{ nodeId: string; pos: AnchorPos } | null>(null);

  // 拉线状态
  const [drawingEdge, setDrawingEdge] = useState<{
    fromId: string;
    fromAnchor: AnchorPos;  // 用户拖拽起点的锚点
    fromX: number;
    fromY: number;
    curX: number;
    curY: number;
  } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const drawingEdgeRef = useRef(drawingEdge);
  drawingEdgeRef.current = drawingEdge;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const addNode = useCallback((shape: NodeShape) => {
    const id = newId();
    setNodes(prev => [...prev, {
      id,
      x: 80 + Math.random() * 300,
      y: 140 + Math.random() * 200,
      w: 140,
      h: shape === "diamond" ? 80 : 50,
      text: shape === "diamond" ? "判断" : shape === "ellipse" ? "节点" : "流程",
      shape,
    }]);
    setSelectedNode(id);
    setSelectedEdge(null);
  }, []);

  const deleteSelected = useCallback(() => {
    if (selectedNode) {
      setNodes(prev => prev.filter(n => n.id !== selectedNode));
      setEdges(prev => prev.filter(e => e.from !== selectedNode && e.to !== selectedNode));
      setSelectedNode(null);
    } else if (selectedEdge) {
      setEdges(prev => prev.filter(e => e.id !== selectedEdge));
      setSelectedEdge(null);
    }
  }, [selectedNode, selectedEdge]);

  const getAnchorPos = (node: FlowNode, pos: AnchorPos): { x: number; y: number } => {
    switch (pos) {
      case "top": return { x: node.x + node.w / 2, y: node.y };
      case "bottom": return { x: node.x + node.w / 2, y: node.y + node.h };
      case "left": return { x: node.x, y: node.y + node.h / 2 };
      case "right": return { x: node.x + node.w, y: node.y + node.h / 2 };
    }
  };

  // 计算节点上离给定坐标最近的锚点
  const nearestAnchor = (node: FlowNode, x: number, y: number): AnchorPos => {
    const list: { pos: AnchorPos; x: number; y: number }[] = (["top", "bottom", "left", "right"] as AnchorPos[]).map(p => {
      const a = getAnchorPos(node, p);
      return { pos: p, x: a.x, y: a.y };
    });
    let best = list[0], bestD = Infinity;
    for (const a of list) {
      const d = (a.x - x) ** 2 + (a.y - y) ** 2;
      if (d < bestD) { bestD = d; best = a; }
    }
    return best.pos;
  };

  // 锚点按下：开始拉线
  const onAnchorMouseDown = (e: React.MouseEvent, node: FlowNode, pos: AnchorPos) => {
    e.stopPropagation();
    e.preventDefault();
    const { x, y } = getAnchorPos(node, pos);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDrawingEdge({
      fromId: node.id,
      fromAnchor: pos,
      fromX: x,
      fromY: y,
      curX: e.clientX - rect.left,
      curY: e.clientY - rect.top,
    });
  };

  // 全局 mousemove + mouseup（拉线期间）
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drawingEdgeRef.current;
      if (!d) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(0, Math.min(CANVAS_W, e.clientX - rect.left));
      const y = Math.max(0, Math.min(CANVAS_H, e.clientY - rect.top));
      setDrawingEdge({ ...d, curX: x, curY: y });
    };
    const onUp = (e: MouseEvent) => {
      const d = drawingEdgeRef.current;
      if (!d) return;
      // 检测松开位置下的节点
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const nodeEl = el?.closest("[data-node-id]") as HTMLElement | null;
      const targetId = nodeEl?.dataset.nodeId || null;
      if (targetId && targetId !== d.fromId) {
        const targetNode = nodesRef.current.find(n => n.id === targetId);
        if (targetNode) {
          const fromNode = nodesRef.current.find(n => n.id === d.fromId);
          const defaultLabel = fromNode?.shape === "diamond" ? "是" : "";
          // 目标节点上离松开位置最近的锚点
          const toAnchor = nearestAnchor(targetNode, d.curX, d.curY);
          setEdges(prev => [...prev, {
            id: `e${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            from: d.fromId,
            to: targetId,
            label: defaultLabel,
            fromAnchor: d.fromAnchor,
            toAnchor,
          }]);
        }
      }
      setDrawingEdge(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // 节点拖动
  const onNodeMouseDown = (e: React.MouseEvent, node: FlowNode) => {
    if (drawingEdge) return;
    e.stopPropagation();
    setSelectedNode(node.id);
    setSelectedEdge(null);
    setEditingText(null);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDragging({
      id: node.id,
      offsetX: e.clientX - rect.left - node.x,
      offsetY: e.clientY - rect.top - node.y,
    });
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(0, Math.min(CANVAS_W - 40, e.clientX - rect.left - dragging.offsetX));
      const y = Math.max(0, Math.min(CANVAS_H - 40, e.clientY - rect.top - dragging.offsetY));
      setNodes(prev => prev.map(n => n.id === dragging.id ? { ...n, x, y } : n));
    };
    const onUp = () => setDragging(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && (selectedNode || selectedEdge)) {
        const t = e.target as HTMLElement;
        if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
        e.preventDefault();
        deleteSelected();
      }
      if (e.key === "Escape") {
        setDrawingEdge(null);
        setSelectedNode(null);
        setSelectedEdge(null);
        setEditingText(null);
        setEditingEdgeLabel(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedNode, selectedEdge, deleteSelected]);

  const shapePath = (shape: NodeShape, w: number, h: number): string => {
    switch (shape) {
      case "rect": return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
      case "diamond": return `M ${w/2} 0 L ${w} ${h/2} L ${w/2} ${h} L 0 ${h/2} Z`;
      case "ellipse": return `M ${w/2} 0 Q ${w} 0 ${w} ${h/2} Q ${w} ${h} ${w/2} ${h} Q 0 ${h} 0 ${h/2} Q 0 0 ${w/2} 0 Z`;
      case "parallelogram": return `M 20 0 L ${w} 0 L ${w-20} ${h} L 0 ${h} Z`;
    }
  };

  const exportPng = useCallback(async () => {
    const html2canvas = (await import("html2canvas")).default;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const prevSel = selectedNode, prevEdge = selectedEdge;
    setSelectedNode(null); setSelectedEdge(null);
    setEditingText(null); setEditingEdgeLabel(null);
    await new Promise(r => requestAnimationFrame(() => r(null)));
    const renderCanvas = await html2canvas(canvas, { backgroundColor: "#ffffff", scale: 2, logging: false });
    const blob: Blob = await new Promise((resolve) =>
      renderCanvas.toBlob(b => resolve(b as Blob), "image/png")
    );
    setSelectedNode(prevSel); setSelectedEdge(prevEdge);
    onSave(blob, { nodes, edges });
  }, [onSave, selectedNode, selectedEdge, nodes, edges]);

  // 连线路径：使用用户选择的起止锚点
  const edgePath = (
    from: FlowNode,
    to: FlowNode,
    fromAnchor: AnchorPos,
    toAnchor: AnchorPos,
  ): { path: string; midX: number; midY: number } => {
    const fp = getAnchorPos(from, fromAnchor);
    const tp = getAnchorPos(to, toAnchor);
    const fromX = fp.x, fromY = fp.y, toX = tp.x, toY = tp.y;
    const midX = (fromX + toX) / 2, midY = (fromY + toY) / 2;
    const path = `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;
    return { path, midX, midY };
  };

  const anchors: AnchorPos[] = ["top", "bottom", "left", "right"];
  const selectedNodeObj = nodes.find(n => n.id === selectedNode);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
    }}>
      <div style={{
        background: "var(--bg-card)", borderRadius: "8px", width: "100%", maxWidth: "1100px",
        height: "90vh", display: "flex", flexDirection: "column", overflow: "hidden",
        boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
      }}>
        {/* 顶部栏 —— 固定高度 */}
        <div style={{
          flexShrink: 0, display: "flex", alignItems: "center", gap: ".5rem",
          padding: ".6rem .8rem", borderBottom: "1px solid var(--border)",
        }}>
          <span style={{ fontWeight: 600, fontSize: ".9rem", flex: 1 }}>绘制流程图</span>
          <button className="btn" onClick={onClose} style={{ fontSize: ".75rem", padding: ".25rem .5rem" }}>取消</button>
          <button className="btn btn-primary" onClick={exportPng} style={{ fontSize: ".75rem", padding: ".25rem .6rem" }}>保存为图片并使用</button>
        </div>

        {/* 工具栏 —— 固定高度 */}
        <div style={{
          flexShrink: 0, display: "flex", gap: ".4rem", padding: ".4rem .8rem", flexWrap: "wrap",
          borderBottom: "1px solid var(--border)", background: "var(--bg-hover)",
          fontSize: ".75rem", alignItems: "center",
        }}>
          <span style={{ color: "var(--text-muted)" }}>添加：</span>
          {SHAPES.map(s => (
            <button key={s.value} className="btn" onClick={() => addNode(s.value)}
              style={{ fontSize: ".7rem", padding: ".2rem .45rem" }}>
              {s.label}
            </button>
          ))}
          <span style={{ width: "1px", height: "16px", background: "var(--border)", margin: "0 .3rem" }} />
          <button className="btn" onClick={deleteSelected} disabled={!selectedNode && !selectedEdge}
            style={{ fontSize: ".7rem", padding: ".2rem .45rem" }}>
            删除选中
          </button>
          <span style={{ color: "var(--text-muted)", fontSize: ".7rem", marginLeft: "auto" }}>
            从节点圆点拖到另一节点连线 · 双击编辑 · Delete 删除
          </span>
        </div>

        {/* 画布区 —— flex:1 自适应，内部滚动 */}
        <div style={{ flex: 1, overflow: "auto", padding: "1rem", background: "var(--bg)", minHeight: 0 }}>
          <div
            ref={canvasRef}
            onMouseDown={() => {
              if (drawingEdge) return;
              setSelectedNode(null);
              setSelectedEdge(null);
              setEditingText(null);
              setEditingEdgeLabel(null);
            }}
            style={{
              position: "relative", width: `${CANVAS_W}px`, height: `${CANVAS_H}px`,
              background: "#ffffff", border: "1px solid #d0d0d0",
              backgroundImage: "linear-gradient(to right, #f0f0f0 1px, transparent 1px), linear-gradient(to bottom, #f0f0f0 1px, transparent 1px)",
              backgroundSize: "20px 20px", flexShrink: 0,
            }}
          >
            {/* SVG 连线层 */}
            <svg style={{ position: "absolute", inset: 0, pointerEvents: "none" }} width={CANVAS_W} height={CANVAS_H}>
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#1a1a1a" />
                </marker>
                <marker id="arrow-preview" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#666" />
                </marker>
              </defs>
              {edges.map(edge => {
                const from = nodes.find(n => n.id === edge.from);
                const to = nodes.find(n => n.id === edge.to);
                if (!from || !to) return null;
                const { path, midX, midY } = edgePath(from, to, edge.fromAnchor, edge.toAnchor);
                const isSel = selectedEdge === edge.id;
                return (
                  <g key={edge.id}>
                    <path d={path} fill="none" stroke="transparent" strokeWidth="14"
                      style={{ pointerEvents: "stroke", cursor: "pointer" }}
                      onClick={(e) => { e.stopPropagation(); setSelectedEdge(edge.id); setSelectedNode(null); }}
                      onDoubleClick={(e) => { e.stopPropagation(); setSelectedEdge(edge.id); setEditingEdgeLabel(edge.id); }} />
                    <path d={path} fill="none" stroke={isSel ? "#1a1a1a" : "#1a1a1a"}
                      strokeWidth={isSel ? "2.5" : "1.5"} markerEnd="url(#arrow)" style={{ pointerEvents: "none" }} />
                    {edge.label && (
                      <>
                        <rect x={midX - 14} y={midY - 12} width="28" height="16" rx="3"
                          fill="#ffffff" stroke="#1a1a1a" strokeWidth="1"
                          style={{ pointerEvents: "none" }} />
                        <text x={midX} y={midY} textAnchor="middle" dominantBaseline="middle"
                          fontSize="11" fill="#1a1a1a" style={{ pointerEvents: "none", userSelect: "none" }}>
                          {edge.label}
                        </text>
                      </>
                    )}
                    {editingEdgeLabel === edge.id && (
                      <foreignObject x={midX - 30} y={midY - 12} width="60" height="24">
                        <input
                          autoFocus
                          defaultValue={edge.label}
                          onBlur={(e) => {
                            setEdges(prev => prev.map(ed => ed.id === edge.id ? { ...ed, label: e.target.value } : ed));
                            setEditingEdgeLabel(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") setEditingEdgeLabel(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          style={{
                            width: "100%", height: "100%", textAlign: "center",
                            fontSize: "11px", border: "1px solid #1a1a1a", borderRadius: "3px",
                            padding: "0 2px", fontFamily: "inherit",
                          }}
                        />
                      </foreignObject>
                    )}
                  </g>
                );
              })}
              {drawingEdge && (
                <line x1={drawingEdge.fromX} y1={drawingEdge.fromY}
                  x2={drawingEdge.curX} y2={drawingEdge.curY}
                  stroke="#666" strokeWidth="1.5" strokeDasharray="6 4"
                  markerEnd="url(#arrow-preview)" style={{ pointerEvents: "none" }} />
              )}
            </svg>

            {/* 节点层 */}
            {nodes.map(node => {
              const isSel = selectedNode === node.id;
              return (
                <div
                  key={node.id}
                  data-node-id={node.id}
                  onMouseDown={(e) => onNodeMouseDown(e, node)}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => { e.stopPropagation(); setSelectedNode(node.id); setEditingText(node.id); }}
                  style={{
                    position: "absolute", left: `${node.x}px`, top: `${node.y}px`,
                    width: `${node.w}px`, height: `${node.h}px`,
                    cursor: dragging?.id === node.id ? "grabbing" : "grab",
                    boxShadow: isSel ? "0 0 0 1px #1a1a1a" : "none",
                    borderRadius: node.shape === "ellipse" ? "50%" : "2px",
                  }}
                >
                  <svg width={node.w} height={node.h} style={{ overflow: "visible", display: "block" }}>
                    <path d={shapePath(node.shape, node.w, node.h)}
                      fill="#ffffff" stroke="#1a1a1a"
                      strokeWidth={isSel ? "2.5" : "1.5"} />
                  </svg>
                  {editingText === node.id ? (
                    <input
                      autoFocus defaultValue={node.text}
                      onBlur={(e) => {
                        setNodes(prev => prev.map(n => n.id === node.id ? { ...n, text: e.target.value } : n));
                        setEditingText(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setEditingText(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{
                        position: "absolute", inset: 0, textAlign: "center",
                        border: "none", background: "rgba(255,255,255,0.95)",
                        fontSize: ".8rem", fontFamily: "inherit", color: "#1a1a1a",
                        padding: "0 .3rem", outline: "none",
                      }}
                    />
                  ) : (
                    <div style={{
                      position: "absolute", inset: 0, display: "flex",
                      alignItems: "center", justifyContent: "center",
                      textAlign: "center", fontSize: ".8rem", fontWeight: 500,
                      color: "#1a1a1a", padding: "0 .3rem", userSelect: "none",
                      pointerEvents: "none",
                    }}>
                      {node.text}
                    </div>
                  )}
                  {/* 4个锚点：始终可见，hover 放大 */}
                  {anchors.map(pos => {
                    const a = getAnchorPos(node, pos);
                    const left = a.x - node.x, top = a.y - node.y;
                    const isHover = hoverAnchor?.nodeId === node.id && hoverAnchor?.pos === pos;
                    return (
                      <div
                        key={pos}
                        onMouseDown={(e) => onAnchorMouseDown(e, node, pos)}
                        onMouseEnter={() => setHoverAnchor({ nodeId: node.id, pos })}
                        onMouseLeave={() => setHoverAnchor(null)}
                        style={{
                          position: "absolute",
                          left: `${left - 4}px`, top: `${top - 4}px`,
                          width: "8px", height: "8px", borderRadius: "50%",
                          background: "#fff", border: "2px solid #1a1a1a",
                          cursor: "crosshair",
                          transform: isHover ? "scale(1.8)" : "scale(1)",
                          transition: "transform .1s",
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* 底部属性栏 —— 固定高度占位，内容空时也占位，不撑大页面 */}
        <div style={{
          flexShrink: 0, height: "44px", borderTop: "1px solid var(--border)",
          padding: "0 .8rem", background: "var(--bg-hover)",
          display: "flex", gap: ".6rem", alignItems: "center", fontSize: ".75rem",
          overflow: "hidden",
        }}>
          {selectedNodeObj ? (
            <>
              <span style={{ color: "var(--text-muted)" }}>节点：</span>
              <label style={{ display: "flex", alignItems: "center", gap: ".25rem" }}>
                文字
                <input
                  value={selectedNodeObj.text}
                  onChange={e => setNodes(prev => prev.map(n => n.id === selectedNodeObj.id ? { ...n, text: e.target.value } : n))}
                  style={{ fontSize: ".75rem", padding: ".15rem .3rem", width: "120px" }}
                />
              </label>
            </>
          ) : selectedEdge ? (
            <span style={{ color: "var(--text-muted)" }}>选中了连线，双击可编辑标签（菱形默认"是"，可改"否"）</span>
          ) : (
            <span style={{ color: "var(--text-muted)" }}>未选中 · 点击节点/连线选中 · 从节点圆点拖到另一节点连线</span>
          )}
        </div>
      </div>
    </div>
  );
}
