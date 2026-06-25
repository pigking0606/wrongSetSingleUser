import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  const filePath = join(process.cwd(), "public", "uploads", filename);

  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const buffer = readFileSync(filePath);
  const ext = filename.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", webp: "image/webp",
  };
  const contentType = mimeTypes[ext || ""] || "image/jpeg";

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
