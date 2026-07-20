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

const COLORS = ["#5b9bd5", "#70ad47", "#ffc000", "#ed7d31", "#a5a5a5", "#7030a0"];

let nodeCounter = 0;
const newId = () => `n${++nodeCounter}_${Date.now()}`;

export default function FlowchartEditor({ onClose, onSave }: Props) {
  const [nodes, setNodes] = useState<FlowNode[]>([
    { id: newId(), x: 320, y: 40, w: 140, h: 50, text: "开始", shape: "ellipse", color: "#70ad47" },
  ]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [edgeFrom, setEdgeFrom] = useState<string>("");
  const [dragging, setDragging] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [editingText, setEditingText] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 500 });

  // 添加节点
  const addNode = useCallback((shape: NodeShape) => {
    const id = newId();
    setNodes(prev => [...prev, {
      id,
      x: 60 + Math.random() * 200,
      y: 120 + Math.random() * 200,
      w: 140,
      h: shape === "diamond" ? 80 : 50,
      text: "新节点",
      shape,
      color: "#5b9bd5",
    }]);
    setSelectedNode(id);
    setSelectedEdge(null);
  }, []);

  // 删除选中
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

  // 添加连线
  const addEdge = useCallback(() => {
    if (!edgeFrom || !selectedNode || edgeFrom === selectedNode) return;
    setEdges(prev => [...prev, {
      id: `e${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      from: edgeFrom,
      to: selectedNode,
      label: "",
    }]);
    setEdgeFrom("");
  }, [edgeFrom, selectedNode]);

  // 节点拖动
  const onNodeMouseDown = (e: React.MouseEvent, node: FlowNode) => {
    e.stopPropagation();
    setSelectedNode(node.id);
    setSelectedEdge(null);
    setEditingText(false);
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
      const x = Math.max(0, Math.min(canvasSize.w - 40, e.clientX - rect.left - dragging.offsetX));
      const y = Math.max(0, Math.min(canvasSize.h - 40, e.clientY - rect.top - dragging.offsetY));
      setNodes(prev => prev.map(n => n.id === dragging.id ? { ...n, x, y } : n));
    };
    const onUp = () => setDragging(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, canvasSize]);

  // 渲染节点形状的 SVG path
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

  // 导出为 PNG
  const exportPng = useCallback(async () => {
    // 动态加载 html2canvas（已安装）
    const html2canvas = (await import("html2canvas")).default;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // 临时去掉选择框样式
    const selected = canvas.querySelector("[data-selected='true']") as HTMLElement | null;
    if (selected) selected.removeAttribute("data-selected");
    const renderCanvas = await html2canvas(canvas, {
      backgroundColor: "#ffffff",
      scale: 2,
      logging: false,
    });
    const blob: Blob = await new Promise((resolve) =>
      renderCanvas.toBlob(b => resolve(b as Blob), "image/png")
    );
    onSave(blob);
  }, [onSave]);

  // 计算连线路径（从 from 节点底部到 to 节点顶部）
  const edgePath = (from: FlowNode, to: FlowNode): string => {
    const x1 = from.x + from.w / 2;
    const y1 = from.y + from.h;
    const x2 = to.x + to.w / 2;
    const y2 = to.y;
    const midY = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
  };

  // 双击节点编辑文字
  const onNodeDoubleClick = (node: FlowNode) => {
    setSelectedNode(node.id);
    setEditingText(true);
  };

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
          <span style={{ color: "var(--text-muted)" }}>连线：</span>
          <select
            value={edgeFrom}
            onChange={e => setEdgeFrom(e.target.value)}
            style={{ fontSize: ".7rem", padding: ".15rem .3rem", maxWidth: "150px" }}
          >
            <option value="">选择起点</option>
            {nodes.map(n => <option key={n.id} value={n.id}>{n.text || n.id}</option>)}
          </select>
          <span style={{ color: "var(--text-muted)" }}>→ 选中的节点为终点</span>
          <button className="btn" onClick={addEdge} disabled={!edgeFrom || !selectedNode || edgeFrom === selectedNode}
            style={{ fontSize: ".7rem", padding: ".2rem .45rem" }}>
            添加连线
          </button>
        </div>

        {/* 画布 */}
        <div style={{ flex: 1, overflow: "auto", padding: "1rem", background: "var(--bg)" }}>
          <div
            ref={canvasRef}
            onClick={() => { setSelectedNode(null); setSelectedEdge(null); setEditingText(false); }}
            style={{
              position: "relative", width: `${canvasSize.w}px`, height: `${canvasSize.h}px`,
              background: "#ffffff", border: "1px solid var(--border)",
              backgroundImage: "linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)",
              backgroundSize: "20px 20px",
            }}
          >
            {/* SVG 层：连线 */}
            <svg style={{ position: "absolute", inset: 0, pointerEvents: "none" }} width={canvasSize.w} height={canvasSize.h}>
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
                return (
                  <g key={edge.id} style={{ pointerEvents: "auto", cursor: "pointer" }}
                    onClick={(e) => { e.stopPropagation(); setSelectedEdge(edge.id); setSelectedNode(null); }}>
                    <path d={path} fill="none" stroke={selectedEdge === edge.id ? "#ff6b6b" : "#444"}
                      strokeWidth="2" markerEnd="url(#arrow)" />
                    {edge.label && (
                      <text x={midX} y={midY - 4} textAnchor="middle" fontSize="11" fill="#444"
                        style={{ pointerEvents: "none" }}>
                        {edge.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* 节点层 */}
            {nodes.map(node => (
              <div
                key={node.id}
                onMouseDown={(e) => onNodeMouseDown(e, node)}
                onDoubleClick={() => onNodeDoubleClick(node)}
                data-selected={selectedNode === node.id}
                style={{
                  position: "absolute",
                  left: `${node.x}px`,
                  top: `${node.y}px`,
                  width: `${node.w}px`,
                  height: `${node.h}px`,
                  cursor: dragging?.id === node.id ? "grabbing" : "grab",
                  outline: selectedNode === node.id ? "2px solid #ff6b6b" : "none",
                  outlineOffset: "2px",
                }}
              >
                <svg width={node.w} height={node.h} style={{ overflow: "visible" }}>
                  <path d={shapePath(node.shape, node.w, node.h)}
                    fill={node.color} fillOpacity="0.2"
                    stroke={node.color} strokeWidth="2" />
                </svg>
                {editingText && selectedNode === node.id ? (
                  <input
                    autoFocus
                    defaultValue={node.text}
                    onBlur={(e) => {
                      setNodes(prev => prev.map(n => n.id === node.id ? { ...n, text: e.target.value } : n));
                      setEditingText(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setEditingText(false);
                    }}
                    style={{
                      position: "absolute", inset: 0, textAlign: "center",
                      border: "none", background: "rgba(255,255,255,0.9)",
                      fontSize: ".8rem", fontFamily: "inherit", color: "var(--text)",
                      padding: "0 .3rem",
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
            ))}
          </div>
        </div>

        {/* 底部：节点属性编辑 */}
        {selectedNode && (
          <div style={{
            borderTop: "1px solid var(--border)", padding: ".5rem .8rem",
            background: "var(--bg-hover)", display: "flex", gap: ".6rem",
            alignItems: "center", fontSize: ".75rem", flexWrap: "wrap",
          }}>
            <span style={{ color: "var(--text-muted)" }}>选中节点属性：</span>
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
              提示：拖动节点移动位置 · 双击节点编辑文字
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
