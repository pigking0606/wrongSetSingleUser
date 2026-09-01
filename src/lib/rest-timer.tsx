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
const BUBBLE_SIZE = 52;

const FONT =
  "'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', 'PingFang SC', 'Microsoft YaHei', monospace";

// ─── 主题化图标（继承 currentColor，适配亮/暗/护眼主题）───────────────────────
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

  // 切换模式时重置
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

  // ── 状态指示色（主题化） ────────────────────────────────────────────────────
  const stateColor = running
    ? "var(--green-text)"
    : paused
      ? "var(--yellow-text)"
      : "var(--accent)";
  const bubbleBg = running
    ? "var(--green-bg)"
    : paused
      ? "var(--yellow-bg)"
      : "var(--tag-bg)";

  // ── 全屏模式 ───────────────────────────────────────────────────────────────
  const fullscreenOverlay = showFullscreen ? (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 40,
        color: "var(--text)",
        fontFamily: "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
      }}
    >
      <div style={{ fontSize: 96, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: 2, fontFamily: FONT }}>
        {fmtTime(displayTime)}
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        {!running ? (
          <button
            onClick={startTimer}
            className="btn btn-success"
            style={{ width: 64, height: 64, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}
            aria-label="开始"
          >
            <PlayIcon size={28} />
          </button>
        ) : (
          <button
            onClick={pauseTimer}
            className="btn"
            style={{ width: 64, height: 64, borderRadius: "50%", color: "var(--yellow-text)", display: "flex", alignItems: "center", justifyContent: "center" }}
            aria-label="暂停"
          >
            <PauseIcon size={28} />
          </button>
        )}
        <button
          onClick={resetTimer}
          className="btn"
          style={{ width: 64, height: 64, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}
          aria-label="重置"
        >
          <ResetIcon size={28} />
        </button>
        <button
          onClick={() => setShowFullscreen(false)}
          className="btn"
          style={{ width: 64, height: 64, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}
          aria-label="退出全屏"
        >
          <CloseIcon size={28} />
        </button>
      </div>
      <div style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>
        {mode === "countdown" ? "倒计时 · 休息中" : "正计时"}
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
            background: bubbleBg,
            border: "1px solid var(--border)",
            color: stateColor,
            boxShadow: "var(--shadow)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "grab",
            zIndex: 1000,
            userSelect: "none",
            fontSize: 13,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            fontFamily: FONT,
          }}
          title="休息计时器（拖动移动，点击展开）"
        >
          {fmtTime(displayTime)}
        </div>
      </>
    );
  }

  // ── 展开面板模式（复用 .card 视觉风格 + 主题变量）──────────────────────────
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
          width: 230,
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "var(--shadow)",
          padding: 14,
          userSelect: "none",
          cursor: "grab",
          fontFamily: "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
          color: "var(--text)",
        }}
      >
        {/* 标题栏 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text)", fontWeight: 600, fontSize: 13 }}>
            <ClockIcon size={16} />
            休息计时
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>{mode === "countdown" ? "倒计时" : "正计时"}</span>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => setShowFullscreen(true)}
              style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-muted)", padding: 2, display: "flex" }}
              title="全屏"
            >
              <FullscreenIcon size={15} />
            </button>
            <button
              onClick={() => { pauseTimer(); setExpanded(false); }}
              style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-muted)", padding: 2, display: "flex" }}
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
            fontFamily: FONT,
            color: stateColor,
            margin: "8px 0 12px",
          }}
        >
          {fmtTime(displayTime)}
        </div>

        {/* 进度条（倒计时） */}
        {progress !== null && (
          <div style={{ height: 6, background: "var(--bg-hover)", borderRadius: 3, overflow: "hidden", marginBottom: 12 }}>
            <div
              style={{
                width: `${progress * 100}%`,
                height: "100%",
                background: "var(--accent)",
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
            className="btn"
            style={{
              flex: 1, fontSize: 12, borderRadius: 8, cursor: running ? "not-allowed" : "pointer",
              background: mode === "countdown" ? "var(--tag-bg)" : "var(--bg-card)",
              color: mode === "countdown" ? "var(--text)" : "var(--text-muted)",
            }}
          >
            倒计时
          </button>
          <button
            onClick={() => setMode("countup")}
            disabled={running}
            className="btn"
            style={{
              flex: 1, fontSize: 12, borderRadius: 8, cursor: running ? "not-allowed" : "pointer",
              background: mode === "countup" ? "var(--tag-bg)" : "var(--bg-card)",
              color: mode === "countup" ? "var(--text)" : "var(--text-muted)",
            }}
          >
            正计时
          </button>
        </div>

        {/* 时长设置（倒计时模式） */}
        {mode === "countdown" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>时长(分)</span>
            <input
              type="number"
              min={1}
              max={180}
              value={durationMinutes}
              disabled={running}
              onChange={handleDurationChange}
              style={{
                width: 60, padding: "4px 6px", borderRadius: 8, fontSize: 13, textAlign: "center",
                color: "var(--text)", background: "var(--bg-card)", border: "1px solid var(--border)",
              }}
            />
          </div>
        )}

        {/* 控制按钮 */}
        <div style={{ display: "flex", gap: 8 }}>
          {!running ? (
            <button
              onClick={startTimer}
              className="btn btn-success"
              style={{ flex: 1, fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            >
              <PlayIcon size={14} /> {paused ? "继续" : "开始"}
            </button>
          ) : (
            <button
              onClick={pauseTimer}
              className="btn"
              style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "var(--yellow-text)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            >
              <PauseIcon size={14} /> 暂停
            </button>
          )}
          <button
            onClick={resetTimer}
            className="btn"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}
            title="重置"
          >
            <ResetIcon size={14} />
          </button>
        </div>
      </div>
    </>
  );
}