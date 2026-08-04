import { NextRequest, NextResponse } from "next/server";
import { queryOne, runAndSave } from "@/lib/db";
import { initSchema } from "@/lib/schema";
import { encrypt, decrypt } from "@/lib/crypto-utils";

async function getRaw(key: string, envFallback = "") {
  const row = await queryOne<{ value: string }>("SELECT value FROM settings WHERE `key`=?", [key]);
  if (row?.value) return row.value;
  return process.env[envFallback] || "";
}

// For API keys: decrypt from DB
async function getKey(key: string, envFallback = "") {
  return decrypt(await getRaw(key, envFallback));
}

// For non-sensitive values: return as-is
async function getPlain(key: string, envFallback = "") {
  return await getRaw(key, envFallback);
}

const KEY_FIELDS = new Set(["vision_key", "text_key"]);

export async function GET() {
  await initSchema();
  // vision_allow_system：布尔型，默认 true（大多数 OpenAI 兼容模型支持 system role）
  // GLM-4.6V 等模型不支持 system role，用户可在设置中关闭
  const allowSystemRaw = (await getPlain("vision_allow_system")).trim().toLowerCase();
  const visionAllowSystem = allowSystemRaw ? (allowSystemRaw === "1" || allowSystemRaw === "true" || allowSystemRaw === "yes") : true;
  return NextResponse.json({
    visionKey: await getKey("vision_key", "DASHSCOPE_API_KEY"),
    visionModel: await getPlain("vision_model", "DASHSCOPE_MODEL") || "qwen-vl-plus",
    visionUrl: await getPlain("vision_url"),
    visionAllowSystem,
    textKey: (await getKey("text_key", "DEEPSEEK_API_KEY")) || (await getKey("vision_key", "DASHSCOPE_API_KEY")),
    textModel: await getPlain("text_model", "TEXT_MODEL") || "deepseek-chat",
    textUrl: await getPlain("text_url"),
  });
}

export async function POST(req: NextRequest) {
  await initSchema();
  const body = await req.json();

  const pairs: [string, string][] = [];
  if (body.visionKey !== undefined) pairs.push(["vision_key", body.visionKey]);
  if (body.visionModel !== undefined) pairs.push(["vision_model", body.visionModel]);
  if (body.visionUrl !== undefined) pairs.push(["vision_url", body.visionUrl]);
  // vision_allow_system：布尔型存储为 "1"/"0"
  if (body.visionAllowSystem !== undefined) pairs.push(["vision_allow_system", body.visionAllowSystem ? "1" : "0"]);
  if (body.textKey !== undefined) pairs.push(["text_key", body.textKey]);
  if (body.textModel !== undefined) pairs.push(["text_model", body.textModel]);
  if (body.textUrl !== undefined) pairs.push(["text_url", body.textUrl]);

  for (const [k, v] of pairs) {
    // Encrypt API key fields before storing; model/URL stay plain
    const stored = KEY_FIELDS.has(k) ? encrypt(v || "") : (v || "");
    // 必须 await：未 await 的 runAndSave 在 Next.js 生产环境中会被丢弃，
    // 导致用户更新的 key 没有写入数据库，AI 请求仍读取旧 key（已失效），
    // 两个 API 网关都返回 401 HTML 错误页 → OCR 报错、文本答案为空
    await runAndSave(
      "INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value=VALUES(value)",
      [k, stored]
    );
  }

  return NextResponse.json({ ok: true });
}
