import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { queryOne } from "@/lib/db";
import { initSchema } from "@/lib/schema";
import { validateImageFile } from "@/lib/upload-utils";
import { autoWrapMathDelimiters, sanitizeLatex } from "@/lib/ai";

// POST /api/methods/ai-analyze
// Input: FormData with one or more images (image_0, image_1, ... up to image_9)
// Output: { title, content } — AI-generated solving method description
export async function POST(req: NextRequest) {
  await initSchema();
  try {
    const formData = await req.formData();
    const images: { base64: string; mimeType: string }[] = [];

    // Collect all image_N fields (sorted by index)
    const keys = Array.from(formData.keys())
      .filter(k => /^image_\d+$/.test(k))
      .sort((a, b) => parseInt(a.split("_")[1]) - parseInt(b.split("_")[1]));

    for (const key of keys) {
      const file = formData.get(key) as File | null;
      if (!file || file.size === 0) continue;
      validateImageFile(file);
      const buf = Buffer.from(await file.arrayBuffer());
      images.push({
        base64: buf.toString("base64"),
        mimeType: file.type || "image/jpeg",
      });
    }

    if (images.length === 0) {
      return NextResponse.json({ error: "请至少上传一张图片" }, { status: 400 });
    }
    if (images.length > 5) {
      return NextResponse.json({ error: "最多支持 5 张例题图片" }, { status: 400 });
    }

    const apiKey = await loadSetting("vision_key", "DASHSCOPE_API_KEY");
    if (!apiKey) {
      return NextResponse.json({ error: "未配置 AI API Key，请在设置页面填写" }, { status: 500 });
    }

    const result = await analyzeMethodImages(images, apiKey);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI 解析失败";
    console.error("[methods/ai-analyze] error:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Setting loader (mirrors ai.ts but kept local to avoid export churn)
// ---------------------------------------------------------------------------
async function loadSetting(key: string, envFallback = "") {
  try {
    const row = await queryOne<{ value: string }>("SELECT value FROM settings WHERE `key`=?", [key]);
    if (row?.value) {
      const { decrypt } = await import("@/lib/crypto-utils");
      return decrypt(row.value);
    }
  } catch { /* table may not exist yet */ }
  return process.env[envFallback] || "";
}

async function getVisionUrl() {
  const custom = await loadSetting("vision_url");
  if (custom) return custom.replace(/\/+$/, "") + "/chat/completions";
  return "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
}

// ---------------------------------------------------------------------------
// AI prompt — concise, no self-contradiction, match image flow
// ---------------------------------------------------------------------------
const METHOD_SYSTEM_PROMPT = `你是题型解法整理专家。用户会上传一道或多道同一题型的例题图片，你的任务是总结出该题型的通用解法。

【重要】思考过程可以内部进行，但输出的必须是最终 JSON，不要把思考过程写进任何字段。
输出的第一个字符必须是 \`{\`，最后一个字符必须是 \`}\`。

## 严格要求（违反任意一条即为失败）

1. **简洁明了**：直接给出解法，不要反复思考、不要"等等不对"、不要自我推翻。只保留最终结论。
2. **通俗易懂**：用学生能理解的语言，避免空泛术语。每个步骤要说清楚"做什么、为什么这么做"。
3. **流程一致**：解法步骤必须与图片中的解题流程严格一致，不能凭空发明图片中没有的步骤。
4. **结构化输出**：按"识别特征 → 解题步骤 → 关键易错点"三段式组织。
5. **数学公式规范**：所有公式用 LaTeX 包裹在 \$...\$ 内，反斜杠在 JSON 中写成双反斜杠 \\\\。

## 输出格式（纯 JSON，不要 markdown 包裹）

{
  "title": "题型名称（简洁，如：极限的等价无穷小替换）",
  "content": "解题方法说明，结构如下：\n\n【题型识别】\n什么样的题目属于这种题型（1-2 句）\n\n【解题步骤】\n1. 第一步：...\n2. 第二步：...\n3. 第三步：...\n\n【关键易错点】\n- 易错点 1\n- 易错点 2"
}`;

async function analyzeMethodImages(
  images: { base64: string; mimeType: string }[],
  apiKey: string
): Promise<{ title: string; content: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);

  try {
    const userContent: any[] = [];
    for (const img of images) {
      userContent.push({
        type: "image_url",
        image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
      });
    }
    userContent.push({
      type: "text",
      text: `这是 ${images.length} 道属于同一题型的例题图片。请总结该题型的通用解法。

要求：
1. title：给题型起一个简洁准确的名字（不超过 15 字）
2. content：按"题型识别 / 解题步骤 / 关键易错点"三段式整理，步骤必须与图片中的解题流程一致
3. 不要逐题复述图片内容，要提炼出通用方法
4. 简洁直接，禁止"可能"、"或者"、"等等"这种不确定表述`,
    });

    const model = await loadSetting("vision_model", "DASHSCOPE_MODEL") || "qwen-vl-plus";
    const resp = await fetch(await getVisionUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        response_format: { type: "json_object" },
        temperature: 0,
        // 保留思考能力，用 stripThinkingBeforeJson 清理
        messages: [
          { role: "system", content: METHOD_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`AI API ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    const rawText: string = data.choices?.[0]?.message?.content || "";
    const cleanText = rawText.includes("{") ? rawText.slice(rawText.indexOf("{")) : rawText;

    let parsed: { title?: string; content?: string };
    try {
      parsed = JSON.parse(cleanText);
    } catch {
      // Try extracting between first { and last }
      const start = cleanText.indexOf("{");
      const end = cleanText.lastIndexOf("}");
      if (start !== -1 && end !== -1) {
        parsed = JSON.parse(cleanText.slice(start, end + 1));
      } else {
        throw new Error("AI 返回内容无法解析");
      }
    }

    const title = (parsed.title || "").trim();
    let content = (parsed.content || "").trim();
    if (!content) throw new Error("AI 返回内容为空");

    // Apply LaTeX sanitization (consistent with question analysis pipeline)
    content = sanitizeLatex(autoWrapMathDelimiters(content));

    return { title, content };
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new Error("AI 解析超时（3 分钟）");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
