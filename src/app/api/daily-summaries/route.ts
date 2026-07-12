import { NextRequest, NextResponse } from "next/server";
import { queryOne, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export async function GET(req: NextRequest) {
  await initSchema();
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || today();
  const recent = parseInt(url.searchParams.get("recent") || "0");

  if (recent > 0) {
    // Inline LIMIT as integer literal — mysql2 prepared statements (pool.execute)
    // throw ER_WRONG_ARGUMENTS 1210 when LIMIT uses ? placeholder.
    const safeRecent = Math.max(1, Math.floor(recent));
    const rows = await queryOne<{ content: string }>(
      `SELECT GROUP_CONCAT(CONCAT(summary_date, ': ', content) SEPARATOR '\n---\n') as content
       FROM (
         SELECT summary_date, content FROM daily_summaries
         WHERE summary_date < ? ORDER BY summary_date DESC LIMIT ${safeRecent}
       ) AS t`,
      [date]
    );
    return NextResponse.json({ summaries: rows?.content || "" });
  }

  const row = await queryOne<{ content: string }>(
    "SELECT content FROM daily_summaries WHERE summary_date = ?", [date]
  );
  return NextResponse.json({ content: row?.content || "" });
}

export async function POST(req: NextRequest) {
  await initSchema();
  const { summary_date, content } = await req.json();
  const date = summary_date || today();
  if (!content && content !== "") {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }
  runAndSave(
    "INSERT INTO daily_summaries (summary_date, content) VALUES (?,?) ON DUPLICATE KEY UPDATE content=VALUES(content)",
    [date, content]
  );
  return NextResponse.json({ ok: true });
}
