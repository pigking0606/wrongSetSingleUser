import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryOne, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";

export async function GET(req: NextRequest) {
  await initSchema();
  const { searchParams } = new URL(req.url);
  const banks = searchParams.get("banks");
  if (banks) {
    const rows = queryAll("SELECT id, name FROM banks ORDER BY id");
    return NextResponse.json({ banks: rows });
  }
  const level = searchParams.get("level");
  const parentId = searchParams.get("parent_id");
  const tree = searchParams.get("tree");

  if (tree === "true") {
    const all = queryAll<{ id: number; name: string; parent_id: number | null; level: number; sort_order: number }>(
      "SELECT id, name, parent_id, level, sort_order FROM chapters ORDER BY level, sort_order, id"
    );
    return NextResponse.json(buildTree(all));
  }

  let sql = "SELECT * FROM chapters WHERE 1=1";
  const params: any[] = [];

  if (level) {
    sql += " AND level=?";
    params.push(parseInt(level));
  }
  if (parentId) {
    sql += " AND parent_id=?";
    params.push(parseInt(parentId));
  }
  sql += " ORDER BY level, sort_order, id";

  return NextResponse.json(queryAll(sql, params));
}

function buildTree(rows: { id: number; name: string; parent_id: number | null; level: number; sort_order: number }[]) {
  const map = new Map<number, any>();
  const roots: any[] = [];

  for (const row of rows) {
    map.set(row.id, { ...row, children: [] });
  }
  for (const row of rows) {
    const node = map.get(row.id)!;
    if (row.parent_id && map.has(row.parent_id)) {
      map.get(row.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export async function POST(req: NextRequest) {
  await initSchema();
  const { name, parent_id, sort_order, bankName } = await req.json();

  // Bank creation
  if (bankName?.trim()) {
    runAndSave("INSERT INTO banks (name) VALUES (?)", [bankName.trim()]);
    return NextResponse.json({ ok: true });
  }

  if (!name?.trim()) {
    return NextResponse.json({ error: "名称不能为空" }, { status: 400 });
  }

  // Auto-calculate level based on parent
  let level = 1;
  if (parent_id) {
    const parent = queryOne<{ level: number }>("SELECT level FROM chapters WHERE id=?", [parent_id]);
    if (!parent) return NextResponse.json({ error: "父级不存在" }, { status: 404 });
    level = parent.level + 1;
    if (level > 3) return NextResponse.json({ error: "最多三级" }, { status: 400 });
  }

  runAndSave(
    "INSERT INTO chapters (name, parent_id, level, sort_order) VALUES (?, ?, ?, ?)",
    [name.trim(), parent_id || null, level, sort_order || 0]
  );

  const row = queryOne<{ id: number }>("SELECT MAX(id) as id FROM chapters");
  return NextResponse.json({ ok: true, id: row?.id, level });
}

export async function PUT(req: NextRequest) {
  await initSchema();
  const { searchParams } = new URL(req.url);
  const id = parseInt(searchParams.get("id") || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { name, parent_id, sort_order } = await req.json();

  const existing = queryOne<{ id: number; level: number }>("SELECT id, level FROM chapters WHERE id=?", [id]);
  if (!existing) return NextResponse.json({ error: "章节不存在" }, { status: 404 });

  const updates: string[] = [];
  const params: any[] = [];

  if (name !== undefined) {
    if (!name.trim()) return NextResponse.json({ error: "名称不能为空" }, { status: 400 });
    updates.push("name = ?");
    params.push(name.trim());
  }

  if (parent_id !== undefined) {
    let level = 1;
    if (parent_id) {
      const parent = queryOne<{ level: number }>("SELECT level FROM chapters WHERE id=?", [parent_id]);
      if (!parent) return NextResponse.json({ error: "父级不存在" }, { status: 404 });
      level = parent.level + 1;
      if (level > 3) return NextResponse.json({ error: "最多三级" }, { status: 400 });
    }
    updates.push("parent_id = ?");
    params.push(parent_id || null);
    updates.push("level = ?");
    params.push(level);
  }

  if (sort_order !== undefined) {
    updates.push("sort_order = ?");
    params.push(sort_order);
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  params.push(id);
  runAndSave(`UPDATE chapters SET ${updates.join(", ")} WHERE id=?`, params);

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  await initSchema();
  const body = await req.json().catch(() => ({}));
  // Bank deletion via JSON body
  if (body.bankId) {
    runAndSave("DELETE FROM banks WHERE id=?", [body.bankId]);
    return NextResponse.json({ ok: true });
  }
  // Chapter deletion via query param
  const { searchParams } = new URL(req.url);
  const id = parseInt(searchParams.get("id") || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = queryOne<{ id: number }>("SELECT id FROM chapters WHERE id=?", [id]);
  if (!existing) return NextResponse.json({ error: "章节不存在" }, { status: 404 });

  // Check for children
  const childCount = queryOne<{ cnt: number }>("SELECT COUNT(*) as cnt FROM chapters WHERE parent_id=?", [id]);
  if (childCount && childCount.cnt > 0) {
    return NextResponse.json({ error: "该分类下还有子分类，请先删除子分类" }, { status: 400 });
  }

  // Check for questions using this chapter
  const questionCount = queryOne<{ cnt: number }>("SELECT COUNT(*) as cnt FROM questions WHERE chapter_id=?", [id]);
  if (questionCount && questionCount.cnt > 0) {
    return NextResponse.json({ error: `该分类下有 ${questionCount.cnt} 道题目，请先迁移或删除这些题目` }, { status: 400 });
  }

  runAndSave("DELETE FROM chapters WHERE id=?", [id]);
  return NextResponse.json({ ok: true });
}
