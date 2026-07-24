"use client";

import { useState, useId } from "react";
import type { FlowNode, FlowEdge, NodeShape, AnchorPos } from "./flowchart-editor";

interface Props {
  data: { nodes: FlowNode[]; edges: FlowEdge[] };
  maxHeight?: number;  // 列表内展示的最大高度（px）
}

// 复用 flowchart-editor 的纯渲染函数（节点形状路径 / 锚点坐标 / 连线路径）
function getAnchorPos(node: FlowNode, pos: AnchorPos): { x: number; y: number } {
  switch (pos) {
    case "top": return { x: node.x + node.w / 2, y: node.y };
    case "bottom": return { x: node.x + node.w / 2, y: node.y + node.h };
    case "left": return { x: node.x, y: node.y + node.h / 2 };
    case "right": return { x: node.x + node.w, y: node.y + node.h / 2 };
  }
}

function shapePath(shape: NodeShape, w: number, h: number): string {
  switch (shape) {
    case "rect": return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
    case "diamond": return `M ${w/2} 0 L ${w} ${h/2} L ${w/2} ${h} L 0 ${h/2} Z`;
    case "ellipse": return `M ${w/2} 0 Q ${w} 0 ${w} ${h/2} Q ${w} ${h} ${w/2} ${h} Q 0 ${h} 0 ${h/2} Q 0 0 ${w/2} 0 Z`;
    case "parallelogram": return `M 20 0 L ${w} 0 L ${w-20} ${h} L 0 ${h} Z`;
  }
}

function edgePath(from: FlowNode, to: FlowNode, fromAnchor: AnchorPos, toAnchor: AnchorPos) {
  const fp = getAnchorPos(from, fromAnchor);
  const tp = getAnchorPos(to, toAnchor);
  const midX = (fp.x + tp.x) / 2, midY = (fp.y + tp.y) / 2;
  const path = `M ${fp.x} ${fp.y} C ${fp.x} ${midY}, ${tp.x} ${midY}, ${tp.x} ${tp.y}`;
  return { path, midX, midY };
}

// 根据所有节点计算 SVG viewBox 边界，让流程图自适应展示
function computeBounds(nodes: FlowNode[]) {
  if (nodes.length === 0) return { minX: 0, minY: 0, width: 900, height: 520 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  const pad = 20;
  return { minX: minX - pad, minY: minY - pad, width: (maxX - minX) + pad * 2, height: (maxY - minY) + pad * 2 };
}

export default function FlowchartViewer({ data, maxHeight = 280 }: Props) {
  const [zoomed, setZoomed] = useState(false);
  // useId 在 SSR 下生成含冒号的 id（如 ":r1:"），SVG marker 引用不能含冒号，需剔除
  const markerId = useId().replace(/[:]/g, "");
  const bounds = computeBounds(data.nodes);

  const renderSvg = (isZoomed: boolean) => (
    <svg
      viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
      style={{
        width: "100%",
        height: "auto",
        maxHeight: isZoomed ? "none" : maxHeight,
        display: "block",
        cursor: isZoomed ? "default" : "zoom-in",
      }}
      preserveAspectRatio="xMidYMid meet"
      onClick={isZoomed ? undefined : () => setZoomed(true)}
    >
      <defs>
        <marker id={`viewer-arrow-${markerId}`} viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="8" markerHeight="8" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#1a1a1a" />
        </marker>
      </defs>
      {/* 连线层 */}
      {data.edges.map(edge => {
        const from = data.nodes.find(n => n.id === edge.from);
        const to = data.nodes.find(n => n.id === edge.to);
        if (!from || !to) return null;
        const { path, midX, midY } = edgePath(from, to, edge.fromAnchor, edge.toAnchor);
        return (
          <g key={edge.id}>
            <path d={path} fill="none" stroke="#1a1a1a" strokeWidth="1.5"
              markerEnd={`url(#viewer-arrow-${markerId})`} />
            {edge.label && (
              <>
                <rect x={midX - 14} y={midY - 12} width="28" height="16" rx="3"
                  fill="#ffffff" stroke="#1a1a1a" strokeWidth="1" />
                <text x={midX} y={midY} textAnchor="middle" dominantBaseline="middle"
                  fontSize="11" fill="#1a1a1a" style={{ userSelect: "none" }}>
                  {edge.label}
                </text>
              </>
            )}
          </g>
        );
      })}
      {/* 节点层 */}
      {data.nodes.map(node => (
        <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
          <path d={shapePath(node.shape, node.w, node.h)}
            fill="#ffffff" stroke="#1a1a1a" strokeWidth="1.5" />
          <text x={node.w / 2} y={node.h / 2} textAnchor="middle" dominantBaseline="middle"
            fontSize="12" fill="#1a1a1a" style={{ userSelect: "none" }}>
            {node.text}
          </text>
        </g>
      ))}
    </svg>
  );

  return (
    <>
      <div style={{
        background: "#ffffff", borderRadius: "6px", border: "1px solid #d0d0d0",
        padding: ".4rem", overflow: "hidden",
      }}>
        {renderSvg(false)}
      </div>
      {zoomed && (
        <div
          onClick={() => setZoomed(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "2rem", cursor: "zoom-out",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: "8px", padding: "1rem",
              maxWidth: "95vw", maxHeight: "90vh", overflow: "auto",
            }}
          >
            {renderSvg(true)}
          </div>
        </div>
      )}
    </>
  );
}
