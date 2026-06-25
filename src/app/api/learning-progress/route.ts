import { NextRequest, NextResponse } from "next/server";
import { queryOne, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";

export async function GET() {
  await initSchema();
  const row = queryOne<{ content: string; updated_at: string }>(
    "SELECT content, updated_at FROM learning_progress WHERE id=1"
  );
  return NextResponse.json({ content: row?.content || "", updated_at: row?.updated_at || "" });
}

export async function POST(req: NextRequest) {
  await initSchema();
  const { content } = await req.json();
  if (content === undefined) {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }
  runAndSave(
    "UPDATE learning_progress SET content=?, updated_at=datetime('now','localtime') WHERE id=1",
    [content || ""]
  );
  return NextResponse.json({ ok: true });
}
