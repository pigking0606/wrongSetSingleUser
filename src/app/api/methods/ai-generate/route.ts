import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryAll } from "@/lib/db";
import { initSchema } from "@/lib/schema";
import { autoWrapMathDelimiters, sanitizeLatex } from "@/lib/ai";

// POST /api/methods/ai-generate
// Input: { question_ids: number[] }
// Output: { title, content, flowchart: { nodes: FlowNode[], edges: FlowEdge[] } }
// AI 根据用户选中的多道同类题，生成题型解法 + 结构化流程图数据
export async function POST(req: NextRequest) {
  await initSchema();
  try {
    const { question_ids } = await req.json();
    if (!Array.isArray(question_ids) || question_ids.length < 2) {
      return NextResponse.json({ error: "请至少选择 2 道题目" }, { status: 400 });
    }
    if (question_ids.length > 10) {
      return NextResponse.json({ error: "最多支持 10 道题目" }, { status: 400 });
    }

    // 拉取题目数据
    const ids = question_ids.slice(0, 10);
    const placeholders = ids.map(() => "?").join(",");
    const questions = await queryAll<{
      id: number; ocr_text: string; correct_answer: string;
      explanation: string | null; ai_solutions: string | null;
    }>(
      `SELECT id, ocr_text, correct_answer, explanation, ai_solutions FROM questions WHERE id IN (${placeholders})`,
      ids
    );

    if (questions.length === 0) {
      return NextResponse.json({ error: "未找到指定题目" }, { status: 404 });
    }

    const apiKey = await loadSetting("text_key", "DEEPSEEK_API_KEY") || await loadSetting("vision_key", "DASHSCOPE_API_KEY");
    if (!apiKey) {
      return NextResponse.json({ error: "未配置 AI API Key，请在设置页面填写" }, { status: 500 });
    }

    const result = await generateMethod(questions, apiKey);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI 生成失败";
    console.error("[methods/ai-generate] error:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Setting loader (mirrors ai.ts but kept local)
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

async function getApiUrl(model: string) {
  if (model.startsWith("deepseek")) {
    const custom = await loadSetting("text_url");
    if (custom) return custom.replace(/\/+$/, "") + "/chat/completions";
    return "https://api.deepseek.com/chat/completions";
  }
  const custom = await loadSetting("vision_url");
  if (custom) return custom.replace(/\/+$/, "") + "/chat/completions";
  return "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
}

// ---------------------------------------------------------------------------
// AI prompt
// ---------------------------------------------------------------------------
const GENERATE_METHOD_PROMPT = `你是题型解法整理专家。用户会提供几道同类题目的题干和答案解析，你的任务是提炼出该题型的通用解法，并绘制解题流程图。

【重要】思考过程可以内部进行，但输出的必须是最终 JSON，不要把思考过程写进任何字段。
输出的第一个字符必须是 \`{\`，最后一个字符必须是 \`}\`。

## 输出格式（纯 JSON）

{
  "title": "题型名称（简洁，如：极限的等价无穷小替换）",
  "content": "解题方法说明，按【题型识别】/【解题步骤】/【关键易错点】三段式组织",
  "flowchart": {
    "nodes": [
      {"id": "n1", "x": 380, "y": 30, "w": 140, "h": 50, "text": "开始", "shape": "ellipse"},
      {"id": "n2", "x": 380, "y": 120, "w": 140, "h": 50, "text": "步骤1说明", "shape": "rect"},
      {"id": "n3", "x": 380, "y": 220, "w": 160, "h": 80, "text": "判断条件", "shape": "diamond"},
      {"id": "n4", "x": 200, "y": 340, "w": 140, "h": 50, "text": "分支A", "shape": "rect"},
      {"id": "n5", "x": 560, "y": 340, "w": 140, "h": 50, "text": "分支B", "shape": "rect"},
      {"id": "n6", "x": 380, "y": 430, "w": 140, "h": 50, "text": "结束", "shape": "ellipse"}
    ],
    "edges": [
      {"id": "e1", "from": "n1", "to": "n2", "label": "", "fromAnchor": "bottom", "toAnchor": "top"},
      {"id": "e2", "from": "n2", "to": "n3", "label": "", "fromAnchor": "bottom", "toAnchor": "top"},
      {"id": "e3", "from": "n3", "to": "n4", "label": "是", "fromAnchor": "left", "toAnchor": "top"},
      {"id": "e4", "from": "n3", "to": "n5", "label": "否", "fromAnchor": "right", "toAnchor": "top"},
      {"id": "e5", "from": "n4", "to": "n6", "label": "", "fromAnchor": "bottom", "toAnchor": "left"},
      {"id": "e6", "from": "n5", "to": "n6", "label": "", "fromAnchor": "bottom", "toAnchor": "right"}
    ]
  }
}

## 流程图规范
- shape 可选：rect（矩形/流程）、diamond（菱形/判断）、ellipse（椭圆/开始结束）、parallelogram（平行四边形/输入输出）
- 坐标 x/y 为左上角坐标，画布大小 900x520，节点宽 140 左右，高 50（菱形 80）
- fromAnchor/toAnchor 可选：top/bottom/left/right（节点四边中点）
- 判断节点（diamond）的出边必须有"是"/"否" label
- 节点间用 fromAnchor→toAnchor 直接连接，不要自动计算最近边
- 流程图要能清晰反映 content 中的解题步骤

## content 规范
- 按"【题型识别】/【解题步骤】/【关键易错点】"三段式组织
- 步骤要与流程图节点对应
- 数学公式用 $...$ 包裹，反斜杠在 JSON 中写成双反斜杠 \\\\
- 简洁直接，禁止"可能"、"或者"、"等等"这种不确定表述`;

async function generateMethod(
  questions: { id: number; ocr_text: string; correct_answer: string; explanation: string | null; ai_solutions: string | null }[],
  apiKey: string
): Promise<{ title: string; content: string; flowchart: { nodes: any[]; edges: any[] } }> {
  const model = await loadSetting("text_model", "TEXT_MODEL") || "qwen-plus";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);

  try {
    // 拼接题目文本
    const questionsText = questions.map((q, i) => {
      let solText = "";
      try {
        const sols = JSON.parse(q.ai_solutions || "[]");
        if (Array.isArray(sols) && sols.length > 0) {
          solText = sols.map((s: any, j: number) => `  解法${j + 1}：${s.name || ""}，步骤：${(s.steps || []).join("→")}`).join("\n");
        }
      } catch { /* ignore */ }
      return `【题目 ${i + 1}】
题干：${q.ocr_text}
正确答案：${q.correct_answer}
解析：${q.explanation || "(无)"}
${solText}`;
    }).join("\n\n");

    const body: any = {
      model,
      max_tokens: 8192,
      temperature: 0,
      messages: [
        { role: "system", content: GENERATE_METHOD_PROMPT },
        { role: "user", content: `以下是 ${questions.length} 道同类题目，请提炼题型解法并绘制流程图：\n\n${questionsText}` },
      ],
    };
    if (!model.startsWith("deepseek")) body.response_format = { type: "json_object" };

    const resp = await fetch(await getApiUrl(model), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`AI API ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    const rawText: string = data.choices?.[0]?.message?.content || "";

    // 提取 JSON
    let parsed: any;
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      try {
        parsed = JSON.parse(rawText.slice(start, end + 1));
      } catch {
        throw new Error("AI 返回 JSON 解析失败");
      }
    } else {
      throw new Error("AI 返回内容无 JSON");
    }

    const title = (parsed.title || "").trim();
    let content = (parsed.content || "").trim();
    if (!content) throw new Error("AI 返回 content 为空");
    content = sanitizeLatex(autoWrapMathDelimiters(content));

    // 校验 flowchart 结构
    const flowchart = parsed.flowchart || { nodes: [], edges: [] };
    if (!Array.isArray(flowchart.nodes)) flowchart.nodes = [];
    if (!Array.isArray(flowchart.edges)) flowchart.edges = [];

    // 为每个 node 补全默认字段
    flowchart.nodes = flowchart.nodes.map((n: any, i: number) => ({
      id: n.id || `n${i + 1}`,
      x: typeof n.x === "number" ? n.x : 80 + (i % 3) * 200,
      y: typeof n.y === "number" ? n.y : 80 + Math.floor(i / 3) * 120,
      w: typeof n.w === "number" ? n.w : 140,
      h: typeof n.h === "number" ? n.h : (n.shape === "diamond" ? 80 : 50),
      text: n.text || "",
      shape: ["rect", "diamond", "ellipse", "parallelogram"].includes(n.shape) ? n.shape : "rect",
    }));

    // 为每个 edge 补全默认字段
    flowchart.edges = flowchart.edges.map((e: any, i: number) => ({
      id: e.id || `e${i + 1}`,
      from: e.from || "",
      to: e.to || "",
      label: e.label || "",
      fromAnchor: ["top", "bottom", "left", "right"].includes(e.fromAnchor) ? e.fromAnchor : "bottom",
      toAnchor: ["top", "bottom", "left", "right"].includes(e.toAnchor) ? e.toAnchor : "top",
    })).filter((e: any) => e.from && e.to);

    return { title, content, flowchart };
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new Error("AI 生成超时（3 分钟）");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
