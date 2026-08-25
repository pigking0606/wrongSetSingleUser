import { NextRequest, NextResponse } from "next/server";

const NETEASE_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
  Referer: "https://music.163.com/",
  Cookie: "appver=8.2.40",
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const kw = (searchParams.get("kw") || "").trim();
  if (!kw) return NextResponse.json({ error: "kw is required" }, { status: 400 });

  try {
    const url = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(kw)}&type=1&offset=0&limit=20`;
    const resp = await fetch(url, { headers: NETEASE_HEADERS, signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return NextResponse.json({ error: `netesea http ${resp.status}` }, { status: 502 });
    const data = await resp.json();
    const songs = (data?.result?.songs || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      artist: (s.artists || []).map((a: any) => a.name).join(" / "),
      album: s.album?.name || "",
      duration: Math.floor((s.duration || 0) / 1000),
    }));
    return NextResponse.json({ songs });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "search failed" }, { status: 502 });
  }
}