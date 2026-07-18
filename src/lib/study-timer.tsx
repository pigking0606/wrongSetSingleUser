"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { globalTimer } from "@/lib/global-timer";

const STUDY_PHOTOS = [
  "https://picsum.photos/id/1015/1920/1080",
  "https://picsum.photos/id/1016/1920/1080",
  "https://picsum.photos/id/1018/1920/1080",
  "https://picsum.photos/id/1020/1920/1080",
  "https://picsum.photos/id/1025/1920/1080",
  "https://picsum.photos/id/1035/1920/1080",
  "https://picsum.photos/id/1039/1920/1080",
  "https://picsum.photos/id/1043/1920/1080",
  "https://picsum.photos/id/1045/1920/1080",
  "https://picsum.photos/id/1051/1920/1080",
];

function fmtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function useTimer(initElapsed = 0) {
  const [elapsed, setElapsed] = useState(initElapsed);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const accumulatedRef = useRef<number>(0);
  const initRef = useRef<number>(initElapsed);

  const clearTimer = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  const start = useCallback((fromSec = 0) => {
    clearTimer();
    startTimeRef.current = Date.now();
    accumulatedRef.current = fromSec;
    initRef.current = fromSec;
    setElapsed(fromSec);
    setRunning(true);
    setPaused(false);
    intervalRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000) + accumulatedRef.current);
    }, 200);
  }, [clearTimer]);

  const pause = useCallback(() => {
    clearTimer();
    accumulatedRef.current += Math.floor((Date.now() - startTimeRef.current) / 1000);
    setPaused(true);
    setRunning(false);
  }, [clearTimer]);

  const resume = useCallback(() => {
    clearTimer();
    startTimeRef.current = Date.now();
    setRunning(true);
    setPaused(false);
    intervalRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000) + accumulatedRef.current);
    }, 200);
  }, [clearTimer]);

  const stop = useCallback(() => {
    clearTimer();
    const total = accumulatedRef.current + (startTimeRef.current ? Math.floor((Date.now() - startTimeRef.current) / 1000) : 0);
    setRunning(false);
    setPaused(false);
    setElapsed(0);
    accumulatedRef.current = 0;
    startTimeRef.current = 0;
    return total;
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return { elapsed, running, paused, start, pause, resume, stop };
}

// Hook that reads from the global timer — survives page navigation
// Exposes BOTH segment (current session) and total (task's accumulated time_spent)
export function useGlobalTimer() {
  const [segmentElapsed, setSegmentElapsed] = useState(0);
  const [totalElapsed, setTotalElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [taskTitle, setTaskTitle] = useState("");

  useEffect(() => {
    setSegmentElapsed(globalTimer.segmentElapsed);
    setTotalElapsed(globalTimer.totalElapsed);
    setRunning(globalTimer.running);
    setPaused(globalTimer.paused);
    setTaskId(globalTimer.taskId);
    setTaskTitle(globalTimer.taskTitle);
    return globalTimer.subscribe(() => {
      setSegmentElapsed(globalTimer.segmentElapsed);
      setTotalElapsed(globalTimer.totalElapsed);
      setRunning(globalTimer.running);
      setPaused(globalTimer.paused);
      setTaskId(globalTimer.taskId);
      setTaskTitle(globalTimer.taskTitle);
    });
  }, []);

  // Backward compat: elapsed = segmentElapsed (for code that hasn't migrated)
  return { elapsed: segmentElapsed, segmentElapsed, totalElapsed, running, paused, taskId, taskTitle };
}

export function StudyFullscreen({ taskTitle, segmentElapsed, totalElapsed, running, paused, onPause, onResume, onEndSegment, onStop }: {
  taskTitle: string;
  segmentElapsed: number;
  totalElapsed: number;
  running: boolean;
  paused: boolean;
  onPause: () => void;
  onResume: () => void;
  // onEndSegment: save current segment to backend, reset segment to 0, enter paused state
  // User must click "开始新段"(resume) to start the next segment
  onEndSegment: () => void;
  // onStop: fully stop the timer and exit fullscreen
  onStop: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [photoIdx, setPhotoIdx] = useState(() => Math.floor(Math.random() * STUDY_PHOTOS.length));
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false); // guard against double-stop

  const poke = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  const handleStop = useCallback(() => {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    // Exit fullscreen first to prevent fullscreenchange from re-firing onStop
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    onStop();
  }, [onStop]);

  useEffect(() => { poke(); }, [poke]);

  // Request fullscreen on mount
  useEffect(() => {
    const el = containerRef.current;
    if (el?.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  // ESC exits fullscreen → stop timer via onStop (guarded against double-fire)
  useEffect(() => {
    const onFsChange = () => {
      // Only fire if we actually exited fullscreen AND haven't already stopped
      if (!document.fullscreenElement && !stoppedRef.current) {
        stoppedRef.current = true;
        onStop();
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => { document.removeEventListener("fullscreenchange", onFsChange); };
  }, [onStop]);

  const nextPhoto = () => {
    setImgLoaded(false);
    setImgFailed(false);
    setPhotoIdx((photoIdx + 1) % STUDY_PHOTOS.length);
    poke();
  };

  return (
    <div ref={containerRef} style={{
      position: "fixed", inset: 0, zIndex: 9999, background: "#111",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', sans-serif",
    }}
      onMouseMove={poke} onTouchStart={poke}>

      {/* Background photo — bright and clear */}
      {!imgFailed && (
        <img
          src={STUDY_PHOTOS[photoIdx]}
          alt=""
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgFailed(true)}
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover", opacity: imgLoaded ? 0.9 : 0,
            transition: "opacity 1.2s ease-in-out",
          }}
        />
      )}

      {/* Dark vignette for text readability (subtle) */}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,.35) 100%)",
        pointerEvents: "none",
      }} />

      {/* Top-left small transparent total timer — always visible */}
      <div style={{
        position: "absolute", top: "1rem", left: "1rem", zIndex: 3,
        background: "rgba(0,0,0,.35)", backdropFilter: "blur(8px)",
        padding: ".4rem .7rem", borderRadius: "8px",
        border: "1px solid rgba(255,255,255,.1)",
        color: "rgba(255,255,255,.75)", fontSize: ".75rem",
        fontVariantNumeric: "tabular-nums",
        fontFamily: "'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace",
        letterSpacing: ".02em", userSelect: "none",
        textShadow: "0 1px 3px rgba(0,0,0,.5)",
      }}>
        <div style={{ fontSize: ".6rem", opacity: 0.65, marginBottom: ".1rem", letterSpacing: ".08em" }}>总计时</div>
        <div>{fmtTime(totalElapsed)}</div>
      </div>

      {/* Content — floating in the scene */}
      <div style={{
        position: "relative", zIndex: 1, textAlign: "center", color: "#fff",
        padding: "2rem", maxWidth: "85vw",
      }}>
        {/* Task title — small, elegant, above the timer */}
        <p style={{
          fontSize: "clamp(.85rem, 1.6vw, 1.1rem)", fontWeight: 300,
          opacity: showControls ? 0.9 : 0.55, marginBottom: "1rem", lineHeight: 1.5,
          textShadow: "0 1px 4px rgba(0,0,0,.5)",
          letterSpacing: ".02em", transition: "opacity .6s",
        }}>
          {taskTitle}
        </p>

        {/* Label: 本段计时 */}
        <div style={{
          fontSize: ".7rem", fontWeight: 300, letterSpacing: ".15em",
          opacity: showControls ? 0.7 : 0.4, marginBottom: ".5rem",
          textTransform: "uppercase", transition: "opacity .6s",
        }}>
          本段计时
        </div>

        {/* Segment timer — large, centered, the focal point */}
        <div style={{
          fontSize: "clamp(4rem, 11vw, 8rem)", fontWeight: 200,
          fontVariantNumeric: "tabular-nums",
          fontFamily: "'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace",
          letterSpacing: ".03em", marginBottom: "1.5rem", userSelect: "none",
          textShadow: "0 2px 12px rgba(0,0,0,.45)",
          transition: "opacity .6s",
        }}>
          {fmtTime(segmentElapsed)}
        </div>

        {/* Subtle state indicator (always visible) */}
        <div style={{
          fontSize: ".7rem", fontWeight: 300, letterSpacing: ".08em",
          opacity: paused ? 0.6 : 0.25, transition: "opacity .6s",
          textShadow: "0 1px 3px rgba(0,0,0,.4)",
        }}>
          {paused ? "已暂停" : running ? "专注中" : segmentElapsed > 0 ? "已暂停" : ""}
        </div>
      </div>

      {/* Controls bar — slides up from bottom, auto-hides */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        display: "flex", justifyContent: "center", gap: "1.5rem",
        padding: "1.5rem 1.5rem 2.5rem",
        background: "linear-gradient(transparent, rgba(0,0,0,.35))",
        transform: showControls ? "translateY(0)" : "translateY(100%)",
        opacity: showControls ? 1 : 0,
        transition: "transform .4s ease, opacity .4s ease",
        zIndex: 2,
      }}>
        {running ? (
          <button onClick={onPause} style={{
            padding: ".6rem 2rem", fontSize: ".9rem", borderRadius: "10px",
            border: "1px solid rgba(255,255,255,.2)", background: "rgba(255,255,255,.06)",
            color: "#ddd", cursor: "pointer", backdropFilter: "blur(10px)",
            letterSpacing: ".05em",
          }}>暂停</button>
        ) : paused ? (
          <button onClick={onResume} style={{
            padding: ".6rem 2rem", fontSize: ".9rem", borderRadius: "10px",
            border: "1px solid rgba(255,255,255,.2)", background: "rgba(255,255,255,.06)",
            color: "#ddd", cursor: "pointer", backdropFilter: "blur(10px)",
            letterSpacing: ".05em",
          }}>{segmentElapsed === 0 ? "开始新段" : "继续"}</button>
        ) : null}
        {/* 结束本段：保存当前段时长到后端，本段归零，进入暂停态等待用户开始新段 */}
        <button onClick={onEndSegment} style={{
          padding: ".6rem 2rem", fontSize: ".9rem", borderRadius: "10px",
          border: "1px solid rgba(255,255,255,.2)", background: "rgba(255,255,255,.08)",
          color: "#ddd", cursor: "pointer", backdropFilter: "blur(10px)",
          letterSpacing: ".05em",
        }}>结束本段</button>
        {/* 完全结束：停止计时并退出全屏 */}
        <button onClick={handleStop} style={{
          padding: ".6rem 2rem", fontSize: ".9rem", borderRadius: "10px",
          border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.03)",
          color: "rgba(255,255,255,.5)", cursor: "pointer", backdropFilter: "blur(10px)",
          letterSpacing: ".05em",
        }}>完全结束</button>
        <button onClick={nextPhoto} style={{
          padding: ".6rem 1.2rem", fontSize: ".9rem", borderRadius: "10px",
          border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.03)",
          color: "rgba(255,255,255,.4)", cursor: "pointer", backdropFilter: "blur(10px)",
          letterSpacing: ".05em",
        }}>换图</button>
      </div>
    </div>
  );
}
