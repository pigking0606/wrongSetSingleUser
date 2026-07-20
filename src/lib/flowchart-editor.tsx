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

// 固定画布尺寸 —— 选中状态用 boxShadow 不撑大画布
const CANVAS_W = 800;
const CANVAS_H = 500;

export default function FlowchartEditor({ onClose, onSave }: Props) {
  const [nodes, setNodes] = useState<FlowNode[]>([
    { id: newId(), x: 330, y: 30, w: 140, h: 50, text: "开始", shape: "ellipse", color: "#70ad47" },
  ]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  // 连线交互：先选起点 → 点"设为起点" → 再点终点节点自动连线
  const [edgeStart, setEdgeStart] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [editingEdgeLabel, setEditingEdgeLabel] = useState<string | null>(null);
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
    setEdgeStart(null);
  }, []);

  const deleteSelected = useCallback(() => {
    if (selectedNode) {
      setNodes(prev => prev.filter(n => n.id !== selectedNode));
      setEdges(prev => prev.filter(e => e.from !== selectedNode && e.to !== selectedNode));
      setSelectedNode(null);
      setEdgeStart(null);
    } else if (selectedEdge) {
      setEdges(prev => prev.filter(e => e.id !== selectedEdge));
      setSelectedEdge(null);
    }
  }, [selectedNode, selectedEdge]);

  // 连线交互：点击"设为起点"后，再点任意节点作为终点自动连线
  const startEdgeFrom = useCallback(() => {
    if (!selectedNode) return;
    setEdgeStart(selectedNode);
    setSelectedEdge(null);
  }, [selectedNode]);

  const finishEdgeTo = useCallback((targetId: string) => {
    if (!edgeStart || edgeStart === targetId) {
      setEdgeStart(null);
      return;
    }
    const fromNode = nodes.find(n => n.id === edgeStart);
    // 菱形出线默认标"是"，用户可双击连线改为"否"
    const defaultLabel = fromNode?.shape === "diamond" ? "是" : "";
    setEdges(prev => [...prev, {
      id: `e${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      from: edgeStart,
      to: targetId,
      label: defaultLabel,
    }]);
    setEdgeStart(null);
  }, [edgeStart, nodes]);

  // 节点拖动 —— 用 mousedown 触发，click 单独处理选中
  const onNodeMouseDown = (e: React.MouseEvent, node: FlowNode) => {
    e.stopPropagation();
    // 如果处于连线起点已设状态，点击节点 = 作为终点完成连线
    if (edgeStart) {
      finishEdgeTo(node.id);
      return;
    }
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

  // 节点 click：阻止冒泡到 canvas（canvas click 会清空选中）
  const onNodeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const onNodeDoubleClick = (e: React.MouseEvent, node: FlowNode) => {
    e.stopPropagation();
    setSelectedNode(node.id);
    setEditingText(node.id);
  };

  // 边 click：选中边
  const onEdgeClick = (e: React.MouseEvent, edgeId: string) => {
    e.stopPropagation();
    setSelectedEdge(edgeId);
    setSelectedNode(null);
    setEdgeStart(null);
  };

  // 边双击：编辑 label
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
        // 不在输入框中才响应
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        e.preventDefault();
        deleteSelected();
      }
      if (e.key === "Escape") {
        setEdgeStart(null);
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
      case "rect":
        return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
      case "diamond":
        return `M ${w/2} 0 L ${w} ${h/2} L ${w/2} ${h} L 0 ${h/2} Z`;
      case "ellipse":
        return `M ${w/2} 0 Q ${w} 0 ${w} ${h/2} Q ${w} ${h} ${w/2} ${h} Q 0 ${h} 0 ${h/2} Q 0 0 ${w/2} 0 Z`;
      case "parallelogram":
        return `M 20 0 L ${w} 0 L ${w-20} ${h} L 0 ${h} Z`;
    }
  };

  // 导出 PNG —— 临时移除所有选中状态，避免红色 boxShadow 入图
  const exportPng = useCallback(async () => {
    const html2canvas = (await import("html2canvas")).default;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // 临时清空选中状态
    const prevSel = selectedNode;
    const prevEdge = selectedEdge;
    setSelectedNode(null);
    setSelectedEdge(null);
    setEdgeStart(null);
    setEditingText(null);
    setEditingEdgeLabel(null);
    // 等下一帧渲染
    await new Promise(r => requestAnimationFrame(() => r(null)));
    const renderCanvas = await html2canvas(canvas, {
      backgroundColor: "#ffffff",
      scale: 2,
      logging: false,
    });
    const blob: Blob = await new Promise((resolve) =>
      renderCanvas.toBlob(b => resolve(b as Blob), "image/png")
    );
    // 恢复选中状态（其实马上要关了，无所谓）
    setSelectedNode(prevSel);
    setSelectedEdge(prevEdge);
    onSave(blob);
  }, [onSave, selectedNode, selectedEdge]);

  // 连线路径：从 from 底部到 to 顶部
  const edgePath = (from: FlowNode, to: FlowNode): string => {
    const x1 = from.x + from.w / 2;
    const y1 = from.y + from.h;
    const x2 = to.x + to.w / 2;
    const y2 = to.y;
    const midY = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
  };

  const edgeStartNode = nodes.find(n => n.id === edgeStart);

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
          <span style={{ width: "1px", height: "16px", background: "var(--border)", margin: "0 .3rem" }} />
          <button
            className={edgeStart ? "btn btn-primary" : "btn"}
            onClick={startEdgeFrom}
            disabled={!selectedNode || !!edgeStart}
            style={{ fontSize: ".7rem", padding: ".2rem .45rem" }}
          >
            {edgeStart ? `起点已设：${edgeStartNode?.text || "?"}，请点终点节点` : "设为连线起点"}
          </button>
          {edgeStart && (
            <button className="btn" onClick={() => setEdgeStart(null)} style={{ fontSize: ".7rem", padding: ".2rem .45rem" }}>
              取消连线
            </button>
          )}
        </div>

        {/* 画布 —— 固定尺寸，overflow hidden */}
        <div style={{ flex: 1, overflow: "auto", padding: "1rem", background: "var(--bg)" }}>
          <div
            ref={canvasRef}
            // 点击空白处清空选中
            onMouseDown={() => {
              setSelectedNode(null);
              setSelectedEdge(null);
              setEdgeStart(null);
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
            {/* SVG 层：连线 */}
            <svg style={{ position: "absolute", inset: 0, pointerEvents: "none" }} width={CANVAS_W} height={CANVAS_H}>
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#444" />
                </marker>
              </defs>
              {edges.map(edge => {
                const from = nodes.find(n => n.id === edge.from);
                const to = nodes.find(n => n.id === edge.to);
                if (!from || !to) return null;
                const path = edgePath(from, to);
                const midX = (from.x + from.w/2 + to.x + to.w/2) / 2;
                const midY = (from.y + from.h + to.y) / 2;
                const isSel = selectedEdge === edge.id;
                return (
                  <g key={edge.id}>
                    {/* 透明粗线作为点击区 */}
                    <path d={path} fill="none" stroke="transparent" strokeWidth="12"
                      style={{ pointerEvents: "stroke", cursor: "pointer" }}
                      onClick={(e) => onEdgeClick(e, edge.id)}
                      onDoubleClick={(e) => onEdgeDoubleClick(e, edge)} />
                    {/* 可见线 */}
                    <path d={path} fill="none" stroke={isSel ? "#ff6b6b" : "#444"}
                      strokeWidth="2" markerEnd="url(#arrow)" style={{ pointerEvents: "none" }} />
                    {/* label 背景 */}
                    {edge.label && (
                      <rect x={midX - 14} y={midY - 12} width="28" height="16" rx="3"
                        fill="#ffffff" stroke={isSel ? "#ff6b6b" : "#888"} strokeWidth="1"
                        style={{ pointerEvents: "none" }} />
                    )}
                    {edge.label && (
                      <text x={midX} y={midY} textAnchor="middle" dominantBaseline="middle"
                        fontSize="11" fill="#1a1a1a" style={{ pointerEvents: "none", userSelect: "none" }}>
                        {edge.label}
                      </text>
                    )}
                    {/* 编辑 label 输入框（覆盖在 SVG 上） */}
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
            </svg>

            {/* 节点层 */}
            {nodes.map(node => {
              const isSel = selectedNode === node.id;
              const isStart = edgeStart === node.id;
              return (
                <div
                  key={node.id}
                  onMouseDown={(e) => onNodeMouseDown(e, node)}
                  onClick={onNodeClick}
                  onDoubleClick={(e) => onNodeDoubleClick(e, node)}
                  style={{
                    position: "absolute",
                    left: `${node.x}px`,
                    top: `${node.y}px`,
                    width: `${node.w}px`,
                    height: `${node.h}px`,
                    cursor: dragging?.id === node.id ? "grabbing" : (edgeStart ? "crosshair" : "grab"),
                    // 用 boxShadow 代替 outline，不撑大画布
                    boxShadow: isSel ? "0 0 0 2px #ff6b6b" : (isStart ? "0 0 0 2px #70ad47" : "none"),
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
              提示：拖动移动 · 双击编辑文字 · Delete 删除 · 菱形出线默认标"是"，双击连线可改"否"
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
