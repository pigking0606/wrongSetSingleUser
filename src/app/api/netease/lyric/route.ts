import { NextRequest, NextResponse } from "next/server";

const NETEASE_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
  Referer: "https://music.163.com/",
  Cookie: "appver=8.2.40",
};

function parseLrc(lrc: string): Array<{ time: number; text: string }> {
  const lines: Array<{ time: number; text: string }> = [];
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    const url = `https://music.163.com/api/song/lyric?id=${encodeURIComponent(id)}&lv=-1&kv=-1&tv=-1`;
    const resp = await fetch(url, { headers: NETEASE_HEADERS, signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return NextResponse.json({ error: `http ${resp.status}` }, { status: 502 });
    const data = await resp.json();
    const lrc = data?.lrc?.lyric || data?.tlyric?.lyric || "";
    return NextResponse.json({ lines: parseLrc(lrc) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "lyric failed" }, { status: 502 });
  }
}