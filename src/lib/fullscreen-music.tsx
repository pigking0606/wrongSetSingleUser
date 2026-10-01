"use client";

// 全屏页面背景音乐播放器
// 使用 Media Session API 接入 Windows 系统媒体控件 (SMTC)：
// - 系统媒体浮窗会显示当前歌曲元数据
// - 系统的 播放/暂停/上一首/下一首 媒体键可控制页面音乐
// - 音量：页内滑块控制 audio.volume（Media Session 不暴露系统音量滑块）
// 音乐来源：用户从本机选择音频文件（mp3/ogg/m4a/wav），多个文件构成播放列表

import { useRef, useState } from "react";

interface Track {
  url: string;      // objectURL
  name: string;     // 文件名（去掉扩展名）
}

const ICONS = {
  play: "M8 5v14l11-7z",
  pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
  next: "M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z",
  prev: "M18 18l-8.5-6L18 6v12zM6 6h2v12H6z",
  volume: "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z",
  mute: "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z",
  list: "M4 6h2v2H4V6zm1-4c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zm0 16c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zm5 2h12v2H10v-2zm0-8h12v2H10v-2zm0-10h12v2H10V2z",
};

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function displayName(fileName: string): string {
  // 去掉常见音频扩展名
  return fileName.replace(/\.(mp3|ogg|m4a|wav|flac|aac|opus)$/i, "") || fileName;
}

export default function FullscreenMusic() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [idx, setIdx] = useState<number>(-1);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [showList, setShowList] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 保存 objectURL 以便释放
  const urlsRef = useRef<string[]>([]);

  const current: Track | undefined = idx >= 0 ? tracks[idx] : undefined;

  // 加载本机文件成播放列表
  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => /audio/i.test(f.type));
    if (files.length === 0) return;
    // 释放旧 URL
    urlsRef.current.forEach(u => URL.revokeObjectURL(u));
    urlsRef.current = [];
    const newTracks = files.map(f => {
      const url = URL.createObjectURL(f);
      urlsRef.current.push(url);
      return { url, name: displayName(f.name) };
    });
    setTracks(newTracks);
    setIdx(0);
    if (audioRef.current) {
      audioRef.current.src = newTracks[0].url;
      audioRef.current.load();
      // 用户主动点击选择文件，属于用户手势，允许播放
      audioRef.current.play().catch(() => {});
    }
    setShowList(false);
  };

  const playTrack = (i: number) => {
    const a = audioRef.current;
    if (!a || !tracks[i]) return;
    setIdx(i);
    a.src = tracks[i].url;
    a.load();
    a.play().catch(() => {});
    setPlaying(true);
  };

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play().catch(() => {}); setPlaying(true); }
    else { a.pause(); setPlaying(false); }
  };

  const next = () => {
    if (tracks.length === 0) return;
    playTrack((idx + 1) % tracks.length);
  };
  const prev = () => {
    if (tracks.length === 0) return;
    playTrack((idx - 1 + tracks.length) % tracks.length);
  };

  // Media Session API：接入系统 SMTC（Windows 媒体浮窗 + 媒体键）
  const setupMediaSession = () => {
    if (!("mediaSession" in navigator)) return;
    if (current) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.name,
        artist: "本地音乐",
        album: "全屏学习",
      });
    }
    navigator.mediaSession.setActionHandler("play", () => {
      audioRef.current?.play().catch(() => {});
      setPlaying(true);
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      audioRef.current?.pause();
      setPlaying(false);
    });
    navigator.mediaSession.setActionHandler("previoustrack", prev);
    navigator.mediaSession.setActionHandler("nexttrack", next);
    navigator.mediaSession.setActionHandler("seekto", (d) => {
      if (d.seekTime != null && audioRef.current) audioRef.current.currentTime = d.seekTime;
    });
    try { navigator.mediaSession.setActionHandler("seekbackward", () => {
      const a = audioRef.current; if (a) a.currentTime = Math.max(0, a.currentTime - 10);
    }); } catch { /* 可选动作 */ }
    try { navigator.mediaSession.setActionHandler("seekforward", () => {
      const a = audioRef.current; if (a) a.currentTime = Math.min(a.duration || 0, a.currentTime + 10);
    }); } catch { /* 可选动作 */ }
  };
  setupMediaSession();

  const onVolume = (v: number) => {
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  };

  return (
    <div style={{
      position: "absolute", bottom: "5.5rem", right: "1rem", zIndex: 3,
      display: "flex", flexDirection: "column", alignItems: "flex-end", gap: ".5rem",
    }}>
      {/* audio 元素（隐藏，由 Media Session/按钮控制） */}
      <audio ref={audioRef} preload="metadata"
        onTimeUpdate={() => setTime(audioRef.current?.currentTime || 0)}
        onDurationChange={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={next}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />

      {/* 播放器面板 */}
      <div style={{
        background: "rgba(0,0,0,.45)", backdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,.12)", borderRadius: "12px",
        padding: ".7rem .9rem", minWidth: "230px", maxWidth: "260px",
        color: "#eee", userSelect: "none",
      }}>
        {/* 歌曲名 */}
        <div style={{
          fontSize: ".75rem", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap", marginBottom: ".35rem",
        }} title={current?.name}>
          {current ? current.name : "未选择音乐"}
        </div>

        {/* 进度条 */}
        <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
          <input type="range" min={0} max={duration || 1} step={0.1} value={time}
            onChange={e => { if (audioRef.current) audioRef.current.currentTime = parseFloat(e.target.value); setTime(parseFloat(e.target.value)); }}
            style={{ flex: 1, accentColor: "#4caf50", height: "3px" }} title="进度" />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".6rem", opacity: .6, marginBottom: ".35rem" }}>
          <span>{fmtTime(time)}</span>
          <span>{fmtTime(duration)}</span>
        </div>

        {/* 主控制按钮 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: ".6rem" }}>
          <button onClick={prev} title="上一首" style={{ background: "none", border: "none", cursor: "pointer", color: "#ddd", padding: ".2rem", display: "flex" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d={ICONS.prev} /></svg>
          </button>
          <button onClick={toggle} title={playing ? "暂停" : "播放"} style={{ background: "rgba(255,255,255,.12)", border: "none", borderRadius: "50%", cursor: "pointer", color: "#fff", padding: ".35rem", display: "flex" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d={playing ? ICONS.pause : ICONS.play} /></svg>
          </button>
          <button onClick={next} title="下一首" style={{ background: "none", border: "none", cursor: "pointer", color: "#ddd", padding: ".2rem", display: "flex" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d={ICONS.next} /></svg>
          </button>
        </div>

        {/* 音量 + 列表 */}
        <div style={{ display: "flex", alignItems: "center", gap: ".5rem", marginTop: ".4rem" }}>
          <button onClick={() => onVolume(volume > 0 ? 0 : 0.8)} title="静音/恢复" style={{ background: "none", border: "none", cursor: "pointer", color: "#aaa", padding: ".1rem", display: "flex" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d={volume > 0 ? ICONS.volume : ICONS.mute} /></svg>
          </button>
          <input type="range" min={0} max={1} step={0.02} value={volume}
            onChange={e => onVolume(parseFloat(e.target.value))}
            style={{ flex: 1, accentColor: "#4caf50", height: "3px" }} title="音量" />
          <button onClick={() => setShowList(s => !s)} title="播放列表" style={{ background: "none", border: "none", cursor: "pointer", color: "#aaa", padding: ".1rem", display: "flex" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d={ICONS.list} /></svg>
          </button>
        </div>
      </div>

      {/* 播放列表折叠层 */}
      {showList && (
        <div style={{
          background: "rgba(0,0,0,.5)", backdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,.12)", borderRadius: "10px",
          padding: ".4rem", minWidth: "230px", maxWidth: "260px", maxHeight: "180px", overflowY: "auto", color: "#eee",
        }}>
          {tracks.length === 0 && (
            <div style={{ fontSize: ".7rem", opacity: .7, padding: ".3rem .4rem" }}>暂无歌曲，点击下方「选择音乐」</div>
          )}
          {tracks.map((t, i) => (
            <div key={i} onClick={() => (i === idx ? toggle() : playTrack(i))}
              style={{
                display: "flex", alignItems: "center", gap: ".4rem", padding: ".25rem .4rem", borderRadius: "6px", cursor: "pointer",
                fontSize: ".72rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                background: i === idx ? "rgba(255,255,255,.12)" : "transparent",
                color: i === idx ? "#fff" : "#ccc",
              }} title={t.name}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                <path d={i === idx && playing ? ICONS.pause : ICONS.play} />
              </svg>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
            </div>
          ))}
          <button onClick={() => fileRef.current?.click()} style={{
            width: "100%", marginTop: ".3rem", padding: ".35rem", borderRadius: "6px",
            background: "rgba(76,175,80,.25)", border: "1px solid rgba(76,175,80,.4)", color: "#c8e6c9",
            cursor: "pointer", fontSize: ".72rem",
          }}>选择音乐</button>
        </div>
      )}

      {/* 关闭音乐面板按钮 */}
      <button onClick={() => setShowList(false)}
        style={{
          background: "rgba(0,0,0,.35)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,.1)",
          borderRadius: "50%", color: "#ddd", cursor: "pointer", padding: ".28rem", display: "flex",
        }} title="音乐">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d={ICONS.play} /></svg>
      </button>

      {/* 隐藏的文件选择 input */}
      <input ref={fileRef} type="file" accept="audio/*" multiple style={{ display: "none" }} onChange={onPickFiles} />
    </div>
  );
}