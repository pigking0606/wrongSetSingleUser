"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─── helpers ────────────────────────────────────────────────────────────────
function fmtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const STORAGE_KEY = "wrongset:restTimer:pos";
const DURATION_KEY = "wrongset:restTimer:duration";
const MODE_KEY = "wrongset:restTimer:mode";
const DEFAULT_MINUTES = 5;
const BUBBLE_SIZE = 48;

// ─── icons ───────────────────────────────────────────────────────────────────
function ClockIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function PlayIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="6,4 20,12 6,20" />
    </svg>
  );
}

function PauseIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function ResetIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

function FullscreenIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

function CloseIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ─── component ───────────────────────────────────────────────────────────────
export default function RestTimer() {
  // ── state ──────────────────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* */ }
    return { x: 20, y: 80 };
  });
  const [durationMinutes, setDurationMinutes] = useState(() => {
    try {
      const saved = localStorage.getItem(DURATION_KEY);
      return saved ? parseInt(saved, 10) : DEFAULT_MINUTES;
    } catch { return DEFAULT_MINUTES; }
  });
  const [mode, setMode] = useState<"countdown" | "countup">(() => {
    try {
      const saved = localStorage.getItem(MODE_KEY);
      return saved === "countup" ? "countup" : "countdown";
    } catch { return "countdown"; }
  });
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0); // 剩余秒数（倒计时）或已计秒数（正计时）
  const [showFullscreen, setShowFullscreen] = useState(false);

  // ── refs ───────────────────────────────────────────────────────────────────
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const movedRef = useRef(false);

  // ── 拖拽 ───────────────────────────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent) => {
    draggingRef.current = true;
    movedRef.current = false;
    dragOffsetRef.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      movedRef.current = true;
      const maxX = window.innerWidth - BUBBLE_SIZE;
      const maxY = window.innerHeight - BUBBLE_SIZE;
      setPos({
        x: Math.min(Math.max(e.clientX - dragOffsetRef.current.x, 0), maxX),
        y: Math.min(Math.max(e.clientY - dragOffsetRef.current.y, 0), maxY),
      });
    };
    const handleMouseUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)); } catch { /* */ }
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [pos]);

  // ── 计时逻辑 ───────────────────────────────────────────────────────────────
  const stopInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopInterval();
    setRunning(true);
    setPaused(false);
    intervalRef.current = setInterval(() => {
      setElapsed(prev => {
        if (mode === "countdown") {
          if (prev <= 1) {
            stopInterval();
            setRunning(false);
            return 0;
          }
          return prev - 1;
        }
        return prev + 1;
      });
    }, 1000);
  }, [mode, stopInterval]);

  const pauseTimer = useCallback(() => {
    stopInterval();
    setRunning(false);
    setPaused(true);
  }, [stopInterval]);

  const resetTimer = useCallback(() => {
    stopInterval();
    setRunning(false);
    setPaused(false);
    setElapsed(mode === "countdown" ? durationMinutes * 60 : 0);
  }, [durationMinutes, mode, stopInterval]);

  // 切换模式 / 修改时长时重置
  useEffect(() => {
    resetTimer();
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* */ }
  }, [mode, resetTimer]);

  useEffect(() => {
    try { localStorage.setItem(DURATION_KEY, String(durationMinutes)); } catch { /* */ }
  }, [durationMinutes]);

  // 卸载清理
  useEffect(() => () => stopInterval(), [stopInterval]);

  const handleDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value, 10);
    if (!Number.isNaN(v) && v >= 1 && v <= 180) setDurationMinutes(v);
  };

  const displayTime = elapsed;
  const progress =
    mode === "countdown" && durationMinutes > 0
      ? Math.max(0, Math.min(1, elapsed / (durationMinutes * 60)))
      : null;

  // 气泡点击（非拖拽时展开）
  const handleBubbleClick = () => {
    if (!movedRef.current) setExpanded(true);
  };

  // ── 全屏模式 ───────────────────────────────────────────────────────────────
  const fullscreenOverlay = showFullscreen ? (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "rgba(15,23,42,0.95)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 32,
        color: "#fff",
      }}
    >
      <div style={{ fontSize: 96, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: 2 }}>
        {fmtTime(displayTime)}
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        {!running ? (
          <button
            onClick={startTimer}
            style={{
              width: 64, height: 64, borderRadius: "50%", border: "none", cursor: "pointer",
              background: "#22c55e", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            }}
            aria-label="开始"
          >
            <PlayIcon size={28} />
          </button>
        ) : (
          <button
            onClick={pauseTimer}
            style={{
              width: 64, height: 64, borderRadius: "50%", border: "none", cursor: "pointer",
              background: "#eab308", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            }}
            aria-label="暂停"
          >
            <PauseIcon size={28} />
          </button>
        )}
        <button
          onClick={resetTimer}
          style={{
            width: 64, height: 64, borderRadius: "50%", border: "none", cursor: "pointer",
            background: "#64748b", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
          }}
          aria-label="重置"
        >
          <ResetIcon size={28} />
        </button>
        <button
          onClick={() => setShowFullscreen(false)}
          style={{
            width: 64, height: 64, borderRadius: "50%", border: "none", cursor: "pointer",
            background: "#475569", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
          }}
          aria-label="退出全屏"
        >
          <CloseIcon size={28} />
        </button>
      </div>
    </div>
  ) : null;

  if (!expanded) {
    // ── 气泡模式 ───────────────────────────────────────────────────────────
    return (
      <>
        {fullscreenOverlay}
        <div
          ref={panelRef}
          onMouseDown={handleMouseDown}
          onClick={handleBubbleClick}
          style={{
            position: "fixed",
            left: `${pos.x}px`,
            top: `${pos.y}px`,
            width: BUBBLE_SIZE,
            height: BUBBLE_SIZE,
            borderRadius: "50%",
            background: running
              ? "linear-gradient(135deg,#22c55e,#16a34a)"
              : paused
                ? "linear-gradient(135deg,#eab308,#ca8a04)"
                : "linear-gradient(135deg,#6366f1,#4f46e5)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "grab",
            zIndex: 1000,
            boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
            userSelect: "none",
            fontSize: 12,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
          }}
          title="休息计时器（拖动移动，点击展开）"
        >
          {fmtTime(displayTime)}
        </div>
      </>
    );
  }

  // ── 展开面板模式 ──────────────────────────────────────────────────────────
  return (
    <>
      {fullscreenOverlay}
      <div
        ref={panelRef}
        onMouseDown={handleMouseDown}
        style={{
          position: "fixed",
          left: `${pos.x}px`,
          top: `${pos.y}px`,
          zIndex: 1000,
          width: 220,
          background: "#fff",
          borderRadius: 14,
          boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
          padding: 14,
          userSelect: "none",
          cursor: "grab",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* 标题栏 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#475569", fontWeight: 600, fontSize: 13 }}>
            <ClockIcon size={16} />
            休息计时
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => setShowFullscreen(true)}
              style={{ border: "none", background: "transparent", cursor: "pointer", color: "#64748b", padding: 2, display: "flex" }}
              title="全屏"
            >
              <FullscreenIcon size={15} />
            </button>
            <button
              onClick={() => { pauseTimer(); setExpanded(false); }}
              style={{ border: "none", background: "transparent", cursor: "pointer", color: "#64748b", padding: 2, display: "flex" }}
              title="收起"
            >
              <CloseIcon size={15} />
            </button>
          </div>
        </div>

        {/* 时间显示 */}
        <div
          style={{
            textAlign: "center",
            fontSize: 40,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            color: running ? "#16a34a" : paused ? "#ca8a04" : "#334155",
            margin: "8px 0 12px",
          }}
        >
          {fmtTime(displayTime)}
        </div>

        {/* 进度条（倒计时） */}
        {progress !== null && (
          <div style={{ height: 6, background: "#e2e8f0", borderRadius: 3, overflow: "hidden", marginBottom: 12 }}>
            <div
              style={{
                width: `${progress * 100}%`,
                height: "100%",
                background: "linear-gradient(90deg,#6366f1,#22c55e)",
                transition: "width 1s linear",
              }}
            />
          </div>
        )}

        {/* 模式切换 */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <button
            onClick={() => setMode("countdown")}
            disabled={running}
            style={{
              flex: 1, padding: "5px 0", fontSize: 12, borderRadius: 8, cursor: running ? "not-allowed" : "pointer",
              border: mode === "countdown" ? "1px solid #6366f1" : "1px solid #e2e8f0",
              background: mode === "countdown" ? "#eef2ff" : "#fff",
              color: mode === "countdown" ? "#4f46e5" : "#64748b",
            }}
          >
            倒计时
          </button>
          <button
            onClick={() => setMode("countup")}
            disabled={running}
            style={{
              flex: 1, padding: "5px 0", fontSize: 12, borderRadius: 8, cursor: running ? "not-allowed" : "pointer",
              border: mode === "countup" ? "1px solid #6366f1" : "1px solid #e2e8f0",
              background: mode === "countup" ? "#eef2ff" : "#fff",
              color: mode === "countup" ? "#4f46e5" : "#64748b",
            }}
          >
            正计时
          </button>
        </div>

        {/* 时长设置（倒计时模式） */}
        {mode === "countdown" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: "#64748b" }}>时长(分)</span>
            <input
              type="number"
              min={1}
              max={180}
              value={durationMinutes}
              disabled={running}
              onChange={handleDurationChange}
              style={{
                width: 60, padding: "4px 6px", borderRadius: 8, border: "1px solid #e2e8f0",
                fontSize: 13, color: "#334155", textAlign: "center",
              }}
            />
          </div>
        )}

        {/* 控制按钮 */}
        <div style={{ display: "flex", gap: 8 }}>
          {!running ? (
            <button
              onClick={startTimer}
              style={{
                flex: 1, padding: "8px 0", borderRadius: 10, border: "none", cursor: "pointer",
                background: "linear-gradient(135deg,#22c55e,#16a34a)", color: "#fff",
                fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <PlayIcon size={14} /> {paused ? "继续" : "开始"}
            </button>
          ) : (
            <button
              onClick={pauseTimer}
              style={{
                flex: 1, padding: "8px 0", borderRadius: 10, border: "none", cursor: "pointer",
                background: "linear-gradient(135deg,#eab308,#ca8a04)", color: "#fff",
                fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <PauseIcon size={14} /> 暂停
            </button>
          )}
          <button
            onClick={resetTimer}
            style={{
              padding: "8px 12px", borderRadius: 10, border: "1px solid #e2e8f0", cursor: "pointer",
              background: "#fff", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center",
            }}
            title="重置"
          >
            <ResetIcon size={14} />
          </button>
        </div>
      </div>
    </>
  );
}
