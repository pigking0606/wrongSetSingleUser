import { NextRequest, NextResponse } from "next/server";
import { queryOne, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";
import { validateImageFile, saveUploadData, deleteUploadFile } from "@/lib/upload-utils";
import sharp from "sharp";

// PUT /api/methods/[id] — multipart: title?, chapter_id?, content?, image?
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  await initSchema();
  const id = parseInt(params.id);
  const formData = await req.formData();
  const title = formData.get("title") as string | null;
  const chapterId = formData.get("chapter_id") as string | null;
  const content = formData.get("content") as string | null;
  const image = formData.get("image") as File | null;

  const sets: string[] = [];
  const vals: any[] = [];
  if (title !== null) { sets.push("title=?"); vals.push(title.trim()); }
  if (chapterId !== null) { sets.push("chapter_id=?"); vals.push(chapterId ? parseInt(chapterId) : null); }
  if (content !== null) { sets.push("content=?"); vals.push(content.trim()); }
  if (image && image.size > 0) {
    validateImageFile(image);
    // Delete old image
    const old = await queryOne<{ image_path: string }>("SELECT image_path FROM solution_methods WHERE id=?", [id]);
    if (old?.image_path) deleteUploadFile(old.image_path);
    const imageBuffer = Buffer.from(await image.arrayBuffer());
    const finalBuffer = await sharp(imageBuffer)
      .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer() as unknown as Buffer;
    const saved = saveUploadData(finalBuffer as Buffer, ".jpg");
    sets.push("image_path=?"); vals.push(saved.publicUrl);
  }
  if (!sets.length) return NextResponse.json({ error: "no fields" }, { status: 400 });

  vals.push(id);
  await runAndSave(`UPDATE solution_methods SET ${sets.join(",")} WHERE id=?`, vals);
  return NextResponse.json({ ok: true });
}

// DELETE /api/methods/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await initSchema();
  const id = parseInt(params.id);
  const row = await queryOne<{ image_path: string }>("SELECT image_path FROM solution_methods WHERE id=?", [id]);
  if (row?.image_path) deleteUploadFile(row.image_path);
  await runAndSave("DELETE FROM solution_methods WHERE id=?", [id]);
  return NextResponse.json({ ok: true });
}
