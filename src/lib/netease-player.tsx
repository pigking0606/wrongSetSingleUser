"use client";

import { useEffect, useRef, useState } from "react";

interface Song {
  id: number; name: string; artist: string; album: string; duration: number;
}

interface LyricLine { time: number; text: string; }

// 网易云试听直链（官方 outer/url，无需登录）
function songUrl(id: number): string {
  return `https://music.163.com/song/media/outer/url?id=${id}.mp3`;
}

function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split("\n")) {
    const timeMatches = [...raw.matchAll(/\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (timeMatches.length === 0) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of timeMatches) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const frac = m[3] ? parseInt(m[3], 10) / Math.pow(10, m[3].length) : 0;
      lines.push({ time: min * 60 + sec + frac, text });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

function fmtDur(s: number): string {
  if (!isFinite(s) || s <= 0) return "00:00";
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function NeteasePlayer() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Song[]>([]);
  const [searching, setSearching] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  const [current, setCurrent] = useState<Song | null>(null);
  const [playing, setPlaying] = useState(false);
  const [curTime, setCurTime] = useState(0);
  const [volume, setVolume] = useState(0.6);

  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const lyricScrollRef = useRef<HTMLDivElement | null>(null);

  const search = async (kw: string) => {
    if (!kw) return;
    setSearching(true);
    try {
      const j = await (await fetch(`/api/netease/search?kw=${encodeURIComponent(kw)}`)).json();
      setResults(Array.isArray(j.songs) ? j.songs : []);
      setListOpen(true);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const playSong = async (song: Song) => {
    if (current?.id === song.id) return;
    setCurrent(song);
    setPlaying(false);
    setLyrics([]);
    setCurTime(0);
    try {
      const j = await (await fetch(`/api/netease/lyric?id=${song.id}`)).json();
      setLyrics(Array.isArray(j.lines) ? j.lines : []);
    } catch {
      setLyrics([]);
    }
    setListOpen(false);
    // 等待 audio 加载后自动播放
    setTimeout(() => { audioRef.current?.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); }, 80);
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().then(() => setPlaying(true)).catch(() => {});
    else a.pause();
  };

  // 当前高亮歌词行
  const activeIdx = (() => {
    let idx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].time <= curTime + 0.1) idx = i; else break;
    }
    return idx;
  })();

  // 自动滚动歌词区，使当前行居中
  useEffect(() => {
    const box = lyricScrollRef.current;
    if (!box) return;
    const el = box.querySelector(`[data-lyric="${activeIdx}"]`) as HTMLElement | null;
    if (el) {
      box.scrollTo({ top: el.offsetTop - box.clientHeight / 2, behavior: "smooth" });
    }
  }, [activeIdx]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  return (
    <div style={{
      width: 320, maxHeight: 560, display: "flex", flexDirection: "column", gap: 8,
      background: "rgba(10,10,10,.78)", backdropFilter: "blur(14px)",
      border: "1px solid rgba(255,255,255,.12)", borderRadius: 14,
      padding: "1rem", color: "#eee", boxShadow: "0 8px 30px rgba(0,0,0,.45)",
      fontFamily: "inherit", fontSize: ".85rem",
    }}>
      {/* 搜索栏 */}
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && search(query)}
          placeholder="搜索歌曲 / 歌手"
          style={{ flex: 1, background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 8, padding: ".4rem .6rem", color: "#fff", fontSize: ".85rem", outline: "none" }}
        />
        <button onClick={() => search(query)} disabled={searching} style={{ background: "#ec4141", border: "none", color: "#fff", borderRadius: 8, padding: ".4rem .7rem", cursor: "pointer", fontSize: ".8rem", opacity: searching ? .6 : 1 }} title="搜索">
          {searching ? "…" : "搜索"}
        </button>
      </div>

      {/* 搜索结果 */}
      {listOpen && (
        <div ref={listRef} style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8 }}>
          {results.length === 0 ? (
            <div style={{ padding: ".6rem", color: "rgba(255,255,255,.5)" }}>无结果</div>
          ) : results.map(s => (
            <button key={s.id} onClick={() => playSong(s)}
              style={{ textAlign: "left", background: "transparent", border: "none", color: "#ccc", padding: ".45rem .6rem", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,.06)", fontSize: ".8rem", display: "flex", flexDirection: "column", gap: 2, width: "100%" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.06)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
              <span style={{ fontWeight: 600, color: current?.id === s.id ? "#ec4141" : "#eee", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
              <span style={{ fontSize: ".72rem", color: "rgba(255,255,255,.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.artist} · {fmtDur(s.duration)}</span>
            </button>
          ))}
        </div>
      )}

      {/* 当前播放控制条 */}
      {current && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={togglePlay} style={{ width: 34, height: 34, borderRadius: "50%", background: "#ec4141", color: "#fff", border: "none", cursor: "pointer", fontSize: ".95rem", flexShrink: 0 }}>
              {playing ? "❚❚" : "▶"}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: ".85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current.name}</div>
              <div style={{ fontSize: ".72rem", color: "rgba(255,255,255,.55)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current.artist}</div>
            </div>
            <span style={{ fontSize: ".7rem", color: "rgba(255,255,255,.5)", fontVariantNumeric: "tabular-nums" }}>{fmtDur(curTime)}/{fmtDur(current.duration)}</span>
          </div>
          {/* 音量 */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: ".7rem", color: "rgba(255,255,255,.5)" }}>音量</span>
            <input type="range" min={0} max={1} step={0.05} value={volume} onChange={e => setVolume(parseFloat(e.target.value))} style={{ flex: 1, accentColor: "#ec4141" }} />
          </div>

          {/* 歌词 */}
          <div ref={lyricScrollRef} style={{ height: 200, overflowY: "auto", borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: 8 }}>
            {lyrics.length === 0 ? (
              <div style={{ color: "rgba(255,255,255,.4)", textAlign: "center", paddingTop: "3rem", fontSize: ".78rem" }}>
                暂无歌词
              </div>
            ) : (
              lyrics.map((l, i) => (
                <div key={i} data-lyric={i}
                  style={{
                    textAlign: "center", padding: ".35rem .4rem", lineHeight: 1.5,
                    fontSize: i === activeIdx ? ".92rem" : ".8rem", fontWeight: i === activeIdx ? 600 : 400,
                    color: i === activeIdx ? "#fff" : "rgba(255,255,255,.45)",
                    transition: "color .3s, font-size .3s",
                  }}>
                  {l.text || "♪"}
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* 隐藏的 audio 元素 */}
      <audio
        ref={audioRef}
        src={current ? songUrl(current.id) : undefined}
        onTimeUpdate={e => setCurTime(e.currentTarget.currentTime)}
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        style={{ display: "none" }}
      />
    </div>
  );
}