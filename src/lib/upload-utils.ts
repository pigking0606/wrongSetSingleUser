import path from "path";
import crypto from "crypto";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"];

const OSS_ACCESS_KEY_ID = process.env.OSS_ACCESS_KEY_ID || "";
const OSS_ACCESS_KEY_SECRET = process.env.OSS_ACCESS_KEY_SECRET || "";
const OSS_BUCKET = "wrongset066112";
const OSS_REGION = "oss-cn-beijing";
const OSS_BASE_URL = `https://${OSS_BUCKET}.${OSS_REGION}.aliyuncs.com`;

/** 计算 OSS 请求签名 */
function ossSign(verb: string, resource: string, headers: Record<string, string>): string {
  const stringToSign = [
    verb,
    headers["Content-MD5"] || "",
    headers["Content-Type"] || "",
    headers["Date"] || "",
    ...Object.entries(headers)
      .filter(([k]) => k.startsWith("x-oss-"))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k.toLowerCase()}:${v}`),
    resource,
  ].join("\n");
  const signature = crypto.createHmac("sha1", OSS_ACCESS_KEY_SECRET).update(stringToSign).digest("base64");
  return `OSS ${OSS_ACCESS_KEY_ID}:${signature}`;
}

/** 上传 Buffer 到 OSS */
async function ossPut(filename: string, data: Buffer): Promise<void> {
  const date = new Date().toUTCString();
  const contentMD5 = crypto.createHash("md5").update(data).digest("base64");
  const resource = `/${OSS_BUCKET}/${filename}`;
  const headers: Record<string, string> = {
    Date: date,
    "Content-Type": "application/octet-stream",
    "Content-MD5": contentMD5,
  };
  headers["Authorization"] = ossSign("PUT", resource, headers);

  const url = `${OSS_BASE_URL}/${filename}`;
  const resp = await fetch(url, {
    method: "PUT",
    headers,
    body: data as unknown as BodyInit,
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`OSS PUT failed: ${resp.status} ${resp.statusText} — ${body}`);
  }
}

/** 从 OSS 删除文件 */
async function ossDelete(filename: string): Promise<void> {
  const date = new Date().toUTCString();
  const resource = `/${OSS_BUCKET}/${filename}`;
  const headers: Record<string, string> = { Date: date };
  headers["Authorization"] = ossSign("DELETE", resource, headers);

  const url = `${OSS_BASE_URL}/${filename}`;
  const resp = await fetch(url, {
    method: "DELETE",
    headers,
  });
  if (!resp.ok && resp.status !== 404) {
    const body = await resp.text().catch(() => "");
    throw new Error(`OSS DELETE failed: ${resp.status} ${resp.statusText} — ${body}`);
  }
}

export class UploadError extends Error {
  name = "UploadError";
  constructor(msg: string, public status: number) { super(msg); }
}

export function ensureUploadDir() {
  // OSS mode: no local upload dir needed
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

export async function saveUploadData(data: Buffer, ext?: string): Promise<{ filePath: string; publicUrl: string }> {
  const actualExt = ext || ".jpg";
  const uuid = crypto.randomUUID();
  const filename = `${uuid}${actualExt}`;

  // Upload to OSS (await to ensure upload completes before returning)
  await ossPut(filename, data);

  const publicUrl = `${OSS_BASE_URL}/${filename}`;
  return { filePath: filename, publicUrl };
}

export async function fileToBase64(file: File): Promise<{
  base64: string;
  mimeType: string;
}> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");
  return { base64, mimeType: file.type || "image/png" };
}

export async function deleteUploadFile(publicUrl: string) {
  const filename = path.basename(publicUrl);
  // Delete from OSS (await to ensure delete completes)
  await ossDelete(filename);
}
