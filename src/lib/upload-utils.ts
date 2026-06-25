import fs from "fs";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"];

export class UploadError extends Error {
  name = "UploadError";
  constructor(msg: string, public status: number) { super(msg); }
}

export function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

export function validateImageFile(file: File) {
  if (!file || file.size === 0) {
    throw new UploadError("No file provided", 400);
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new UploadError(
      `Invalid file type: ${file.type}. Allowed: PNG, JPG, GIF, WebP`,
      400
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new UploadError("File too large (max 10 MB)", 400);
  }
}

export async function saveUploadFile(file: File): Promise<{
  filePath: string;
  publicUrl: string;
}> {
  return saveUploadData(Buffer.from(await file.arrayBuffer()), path.extname(file.name));
}

export function saveUploadData(data: Buffer, ext?: string): { filePath: string; publicUrl: string } {
  ensureUploadDir();

  const actualExt = ext || ".jpg";
  const uuid = crypto.randomUUID();
  const filename = `${uuid}${actualExt}`;
  const filePath = path.join(UPLOAD_DIR, filename);

  fs.writeFileSync(filePath, data);

  const publicUrl = `/uploads/${filename}`;
  return { filePath, publicUrl };
}

export async function fileToBase64(file: File): Promise<{
  base64: string;
  mimeType: string;
}> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");
  return { base64, mimeType: file.type || "image/png" };
}

export function deleteUploadFile(publicUrl: string) {
  const filename = path.basename(publicUrl);
  const filePath = path.join(UPLOAD_DIR, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
