import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import crypto from "crypto";

// POST: Accept base64 image or multipart upload, save to public/uploads/, return image_path
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    // multipart upload
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("image") as File | null;
      if (!file) return NextResponse.json({ error: "no image file" }, { status: 400 });

      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const filename = `${crypto.randomUUID()}.${ext}`;
      const uploadsDir = join(process.cwd(), "public", "uploads");
      if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

      const buffer = Buffer.from(await file.arrayBuffer());
      writeFileSync(join(uploadsDir, filename), buffer);

      return NextResponse.json({ image_path: `/uploads/${filename}` });
    }

    // JSON with base64
    const body = await req.json();
    const { base64, filename: fname } = body;
    if (!base64) return NextResponse.json({ error: "base64 required" }, { status: 400 });

    // Strip data URI prefix if present
    const b64 = base64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(b64, "base64");
    const ext = fname?.split(".").pop() || "jpg";
    const filename = `${crypto.randomUUID()}.${ext}`;

    const uploadsDir = join(process.cwd(), "public", "uploads");
    if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
    writeFileSync(join(uploadsDir, filename), buffer);

    return NextResponse.json({ image_path: `/uploads/${filename}` });
  } catch (err) {
    console.error("Import image error:", err);
    return NextResponse.json({ error: "import failed" }, { status: 500 });
  }
}
