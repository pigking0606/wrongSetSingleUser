import { NextRequest, NextResponse } from "next/server";
import { runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";

// POST /api/chapters/reorder
// 批量更新章节排序
// body: { items: [{ id: number, sort_order: number }] }
// 仅更新 sort_order，不改变 parent_id / level
export async function POST(req: NextRequest) {
  await initSchema();
  const { items } = await req.json();

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "items 不能为空" }, { status: 400 });
  }

  // 逐条更新 sort_order（每条用 await 确保顺序写入）
  for (const item of items) {
    if (typeof item.id !== "number" || typeof item.sort_order !== "number") continue;
    await runAndSave(
      "UPDATE chapters SET sort_order=? WHERE id=?",
      [item.sort_order, item.id]
    );
  }

  return NextResponse.json({ ok: true, updated: items.length });
}
