"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// 流程图节点类型
type NodeShape = "rect" | "diamond" | "ellipse" | "parallelogram";

interface FlowNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  shape: NodeShape;
  color: string;
}

interface FlowEdge {
  id: string;
  from: string;
  to: string;
  label: string;
}

interface Props {
  onClose: () => void;
  onSave: (pngBlob: Blob) => void;
}

const SHAPES: { value: NodeShape; label: string }[] = [
  { value: "rect", label: "矩形（流程）" },
  { value: "diamond", label: "菱形（判断）" },
  { value: "ellipse", label: "椭圆（起止）" },
  { value: "parallelogram", label: "平行四边形（输入）" },
];

let nodeCounter = 0;
const newId = () => `n${++nodeCounter}_${Date.now()}`;

// 固定画布尺寸
const CANVAS_W = 800;
const CANVAS_H = 500;

// 锚点位置（节点4个边的中点）
type AnchorPos = "top" | "bottom" | "left" | "right";

export default function FlowchartEditor({ onClose, onSave }: Props) {
  const [nodes, setNodes] = useState<FlowNode[]>([
    { id: newId(), x: 330, y: 30, w: 140, h: 50, text: "开始", shape: "ellipse", color: "#70ad47" },
  ]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [editingEdgeLabel, setEditingEdgeLabel] = useState<string | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  // 普通鼠标 hover（非拉线时）—— 用于显示锚点
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);

  // 拉线状态：从某节点的某锚点开始，当前鼠标位置
  const [drawingEdge, setDrawingEdge] = useState<{
    fromId: string;
    fromX: number;
    fromY: number;
    curX: number;
    curY: number;
  } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);

  const addNode = useCallback((shape: NodeShape) => {
    const id = newId();
    setNodes(prev => [...prev, {
      id,
      x: 60 + Math.random() * 200,
      y: 120 + Math.random() * 200,
      w: 140,
      h: shape === "diamond" ? 80 : 50,
      text: shape === "diamond" ? "判断" : shape === "ellipse" ? "新节点" : "流程",
      shape,
      color: shape === "diamond" ? "#ffc000" : "#5b9bd5",
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

  // 获取节点某锚点的绝对坐标
  const getAnchorPos = (node: FlowNode, pos: AnchorPos): { x: number; y: number } => {
    switch (pos) {
      case "top": return { x: node.x + node.w / 2, y: node.y };
      case "bottom": return { x: node.x + node.w / 2, y: node.y + node.h };
      case "left": return { x: node.x, y: node.y + node.h / 2 };
      case "right": return { x: node.x + node.w, y: node.y + node.h / 2 };
    }
  };

  // 锚点 mousedown：开始拉线
  const onAnchorMouseDown = (e: React.MouseEvent, node: FlowNode, pos: AnchorPos) => {
    e.stopPropagation();
    e.preventDefault();
    const { x, y } = getAnchorPos(node, pos);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDrawingEdge({
      fromId: node.id,
      fromX: x,
      fromY: y,
      curX: e.clientX - rect.left,
      curY: e.clientY - rect.top,
    });
    setSelectedNode(null);
    setSelectedEdge(null);
  };

  // 全局 mousemove：更新拉线当前点
  useEffect(() => {
    if (!drawingEdge) return;
    const onMove = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(0, Math.min(CANVAS_W, e.clientX - rect.left));
      const y = Math.max(0, Math.min(CANVAS_H, e.clientY - rect.top));
      setDrawingEdge(prev => prev ? { ...prev, curX: x, curY: y } : null);
      // 检测当前 hover 的节点（用 elementFromPoint）
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const nodeEl = el?.closest("[data-node-id]") as HTMLElement | null;
      setHoverNode(nodeEl?.dataset.nodeId || null);
    };
    const onUp = (e: MouseEvent) => {
      // 松开时检测目标节点
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const nodeEl = el?.closest("[data-node-id]") as HTMLElement | null;
      const targetId = nodeEl?.dataset.nodeId || null;
      if (targetId && targetId !== drawingEdge.fromId) {
        const fromNode = nodes.find(n => n.id === drawingEdge.fromId);
        const defaultLabel = fromNode?.shape === "diamond" ? "是" : "";
        setEdges(prev => [...prev, {
          id: `e${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          from: drawingEdge.fromId,
          to: targetId,
          label: defaultLabel,
        }]);
      }
      setDrawingEdge(null);
      setHoverNode(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drawingEdge, nodes]);

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

  const onNodeClick = (e: React.MouseEvent) => { e.stopPropagation(); };
  const onNodeDoubleClick = (e: React.MouseEvent, node: FlowNode) => {
    e.stopPropagation();
    setSelectedNode(node.id);
    setEditingText(node.id);
  };
  const onEdgeClick = (e: React.MouseEvent, edgeId: string) => {
    e.stopPropagation();
    setSelectedEdge(edgeId);
    setSelectedNode(null);
  };
  const onEdgeDoubleClick = (e: React.MouseEvent, edge: FlowEdge) => {
    e.stopPropagation();
    setSelectedEdge(edge.id);
    setEditingEdgeLabel(edge.id);
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

  // 键盘删除
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && (selectedNode || selectedEdge)) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
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

  // 导出 PNG
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
    onSave(blob);
  }, [onSave, selectedNode, selectedEdge]);

  // 智能连线路径：根据两节点相对位置自动选择最近的边
  const edgePath = (from: FlowNode, to: FlowNode): { path: string; midX: number; midY: number } => {
    const fcx = from.x + from.w / 2, fcy = from.y + from.h / 2;
    const tcx = to.x + to.w / 2, tcy = to.y + to.h / 2;
    const dx = tcx - fcx, dy = tcy - fcy;
    let fromX: number, fromY: number, toX: number, toY: number;
    if (Math.abs(dx) >= Math.abs(dy)) {
      // 水平为主
      if (dx >= 0) { fromX = from.x + from.w; fromY = fcy; toX = to.x; toY = tcy; }
      else { fromX = from.x; fromY = fcy; toX = to.x + to.w; toY = tcy; }
    } else {
      // 垂直为主
      if (dy >= 0) { fromX = fcx; fromY = from.y + from.h; toX = tcx; toY = to.y; }
      else { fromX = fcx; fromY = from.y; toX = tcx; toY = to.y + to.h; }
    }
    const midX = (fromX + toX) / 2, midY = (fromY + toY) / 2;
    const path = `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;
    return { path, midX, midY };
  };

  const anchors: AnchorPos[] = ["top", "bottom", "left", "right"];

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
    }}>
      <div style={{
        background: "var(--bg-card)", borderRadius: "8px", width: "100%", maxWidth: "1100px",
        maxHeight: "95vh", display: "flex", flexDirection: "column", overflow: "hidden",
        boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
      }}>
        {/* 顶部栏 */}
        <div style={{
          display: "flex", alignItems: "center", gap: ".5rem", padding: ".6rem .8rem",
          borderBottom: "1px solid var(--border)",
        }}>
          <span style={{ fontWeight: 600, fontSize: ".9rem", flex: 1 }}>绘制流程图</span>
          <button className="btn" onClick={onClose} style={{ fontSize: ".75rem", padding: ".25rem .5rem" }}>取消</button>
          <button className="btn btn-primary" onClick={exportPng} style={{ fontSize: ".75rem", padding: ".25rem .6rem" }}>保存为图片并使用</button>
        </div>

        {/* 工具栏 */}
        <div style={{
          display: "flex", gap: ".4rem", padding: ".4rem .8rem", flexWrap: "wrap",
          borderBottom: "1px solid var(--border)", background: "var(--bg-hover)",
          fontSize: ".75rem", alignItems: "center",
        }}>
          <span style={{ color: "var(--text-muted)" }}>添加节点：</span>
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
            拖动节点移动 · 从节点边缘圆点拉线到另一节点 · 双击节点/连线编辑 · Delete 删除
          </span>
        </div>

        {/* 画布 */}
        <div style={{ flex: 1, overflow: "auto", padding: "1rem", background: "var(--bg)" }}>
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
              background: "#ffffff", border: "1px solid var(--border)",
              backgroundImage: "linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)",
              backgroundSize: "20px 20px",
              flexShrink: 0,
            }}
          >
            {/* SVG 层：连线 + 拉线预览 */}
            <svg style={{ position: "absolute", inset: 0, pointerEvents: "none" }} width={CANVAS_W} height={CANVAS_H}>
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#444" />
                </marker>
                <marker id="arrow-preview" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#ff6b6b" />
                </marker>
              </defs>
              {edges.map(edge => {
                const from = nodes.find(n => n.id === edge.from);
                const to = nodes.find(n => n.id === edge.to);
                if (!from || !to) return null;
                const { path, midX, midY } = edgePath(from, to);
                const isSel = selectedEdge === edge.id;
                return (
                  <g key={edge.id}>
                    <path d={path} fill="none" stroke="transparent" strokeWidth="12"
                      style={{ pointerEvents: "stroke", cursor: "pointer" }}
                      onClick={(e) => onEdgeClick(e, edge.id)}
                      onDoubleClick={(e) => onEdgeDoubleClick(e, edge)} />
                    <path d={path} fill="none" stroke={isSel ? "#ff6b6b" : "#444"}
                      strokeWidth="2" markerEnd="url(#arrow)" style={{ pointerEvents: "none" }} />
                    {edge.label && (
                      <>
                        <rect x={midX - 14} y={midY - 12} width="28" height="16" rx="3"
                          fill="#ffffff" stroke={isSel ? "#ff6b6b" : "#888"} strokeWidth="1"
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
                            fontSize: "11px", border: "1px solid #ff6b6b", borderRadius: "3px",
                            padding: "0 2px", fontFamily: "inherit",
                          }}
                        />
                      </foreignObject>
                    )}
                  </g>
                );
              })}
              {/* 拉线预览（虚线） */}
              {drawingEdge && (
                <line x1={drawingEdge.fromX} y1={drawingEdge.fromY}
                  x2={drawingEdge.curX} y2={drawingEdge.curY}
                  stroke="#ff6b6b" strokeWidth="2" strokeDasharray="6 4"
                  markerEnd="url(#arrow-preview)" style={{ pointerEvents: "none" }} />
              )}
            </svg>

            {/* 节点层 */}
            {nodes.map(node => {
              const isSel = selectedNode === node.id;
              const isHover = hoverNode === node.id && drawingEdge !== null;
              return (
                <div
                  key={node.id}
                  data-node-id={node.id}
                  onMouseDown={(e) => onNodeMouseDown(e, node)}
                  onMouseEnter={() => setHoverNodeId(node.id)}
                  onMouseLeave={() => setHoverNodeId(null)}
                  onClick={onNodeClick}
                  onDoubleClick={(e) => onNodeDoubleClick(e, node)}
                  style={{
                    position: "absolute",
                    left: `${node.x}px`,
                    top: `${node.y}px`,
                    width: `${node.w}px`,
                    height: `${node.h}px`,
                    cursor: dragging?.id === node.id ? "grabbing" : "grab",
                    boxShadow: isSel ? "0 0 0 2px #ff6b6b" : (isHover ? "0 0 0 2px #70ad47" : "none"),
                    borderRadius: node.shape === "ellipse" ? "50%" : "2px",
                  }}
                >
                  <svg width={node.w} height={node.h} style={{ overflow: "visible", display: "block" }}>
                    <path d={shapePath(node.shape, node.w, node.h)}
                      fill={node.color} fillOpacity="0.2"
                      stroke={node.color} strokeWidth="2" />
                  </svg>
                  {editingText === node.id ? (
                    <input
                      autoFocus
                      defaultValue={node.text}
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
                  {/* 4个锚点（连接点）—— 从这里 mousedown 开始拉线 */}
                  {anchors.map(pos => {
                    const a = getAnchorPos(node, pos);
                    const left = a.x - node.x, top = a.y - node.y;
                    return (
                      <div
                        key={pos}
                        onMouseDown={(e) => onAnchorMouseDown(e, node, pos)}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "scale(1.6)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = "scale(1)"; }}
                        style={{
                          position: "absolute",
                          left: `${left - 5}px`,
                          top: `${top - 5}px`,
                          width: "10px",
                          height: "10px",
                          borderRadius: "50%",
                          background: "#fff",
                          border: "2px solid " + node.color,
                          cursor: "crosshair",
                          transition: "transform .1s",
                          // 鼠标 hover 节点、选中节点、或正在拉线时显示锚点
                          opacity: (isSel || isHover || hoverNodeId === node.id || drawingEdge) ? 1 : 0,
                          pointerEvents: (isSel || isHover || hoverNodeId === node.id || drawingEdge) ? "auto" : "none",
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* 底部：选中节点属性编辑 */}
        {selectedNode && (
          <div style={{
            borderTop: "1px solid var(--border)", padding: ".5rem .8rem",
            background: "var(--bg-hover)", display: "flex", gap: ".6rem",
            alignItems: "center", fontSize: ".75rem", flexWrap: "wrap",
          }}>
            <span style={{ color: "var(--text-muted)" }}>选中节点：</span>
            <label style={{ display: "flex", alignItems: "center", gap: ".25rem" }}>
              文字：
              <input
                value={nodes.find(n => n.id === selectedNode)?.text || ""}
                onChange={e => setNodes(prev => prev.map(n => n.id === selectedNode ? { ...n, text: e.target.value } : n))}
                style={{ fontSize: ".75rem", padding: ".15rem .3rem", width: "120px" }}
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: ".25rem" }}>
              颜色：
              <input
                type="color"
                value={nodes.find(n => n.id === selectedNode)?.color || "#5b9bd5"}
                onChange={e => setNodes(prev => prev.map(n => n.id === selectedNode ? { ...n, color: e.target.value } : n))}
                style={{ width: "30px", height: "24px", padding: 0, border: "none", cursor: "pointer" }}
              />
            </label>
            <span style={{ color: "var(--text-muted)", fontSize: ".7rem" }}>
              选中节点后，从边缘圆点拖拽到另一节点即可连线 · 菱形出线默认"是"，双击连线可改
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
