import crypto from "crypto";

const ENC_PREFIX = "enc:";

function getKey(): Buffer {
  // Derive 32-byte AES key from APP_PASSWORD
  const pw = process.env.APP_PASSWORD || "wrongset-default";
  return crypto.createHash("sha256").update(pw).digest();
}

export function encrypt(plaintext: string): string {
  if (!plaintext) return "";
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("base64")}:${encrypted.toString("base64")}:${tag.toString("base64")}`;
}

export function decrypt(value: string): string {
  if (!value) return "";
  // Backward compat: plaintext values without the prefix
  if (!value.startsWith(ENC_PREFIX)) return value;
  try {
    const parts = value.slice(ENC_PREFIX.length).split(":");
    if (parts.length !== 3) return value; // malformed, return as-is
    const iv = Buffer.from(parts[0], "base64");
    const encrypted = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const key = getKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    // Decryption failed — probably a legacy plaintext value
    return value;
  }
}
