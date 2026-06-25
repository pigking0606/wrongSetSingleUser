import { NextRequest, NextResponse } from "next/server";
import { queryOne, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";
import { encrypt, decrypt } from "@/lib/crypto-utils";

function getRaw(key: string, envFallback = ""): string {
  const row = queryOne<{ value: string }>("SELECT value FROM settings WHERE key=?", [key]);
  if (row?.value) return row.value;
  return process.env[envFallback] || "";
}

// For API keys: decrypt from DB
function getKey(key: string, envFallback = ""): string {
  return decrypt(getRaw(key, envFallback));
}

// For non-sensitive values: return as-is
function getPlain(key: string, envFallback = ""): string {
  return getRaw(key, envFallback);
}

const KEY_FIELDS = new Set(["vision_key", "text_key"]);

export async function GET() {
  await initSchema();
  return NextResponse.json({
    visionKey: getKey("vision_key", "DASHSCOPE_API_KEY"),
    visionModel: getPlain("vision_model", "DASHSCOPE_MODEL") || "qwen-vl-plus",
    visionUrl: getPlain("vision_url"),
    textKey: getKey("text_key", "DEEPSEEK_API_KEY") || getKey("vision_key", "DASHSCOPE_API_KEY"),
    textModel: getPlain("text_model", "TEXT_MODEL") || "deepseek-chat",
    textUrl: getPlain("text_url"),
  });
}

export async function POST(req: NextRequest) {
  await initSchema();
  const body = await req.json();

  const pairs: [string, string][] = [];
  if (body.visionKey !== undefined) pairs.push(["vision_key", body.visionKey]);
  if (body.visionModel !== undefined) pairs.push(["vision_model", body.visionModel]);
  if (body.visionUrl !== undefined) pairs.push(["vision_url", body.visionUrl]);
  if (body.textKey !== undefined) pairs.push(["text_key", body.textKey]);
  if (body.textModel !== undefined) pairs.push(["text_model", body.textModel]);
  if (body.textUrl !== undefined) pairs.push(["text_url", body.textUrl]);

  for (const [k, v] of pairs) {
    // Encrypt API key fields before storing; model/URL stay plain
    const stored = KEY_FIELDS.has(k) ? encrypt(v || "") : (v || "");
    runAndSave(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [k, stored]
    );
  }

  return NextResponse.json({ ok: true });
}
