export interface AiAnalysisResult {
  ocrText: string;
  questionType: "single_choice" | "multiple_choice" | "true_false" | "fill_blank" | "short_answer" | "comprehensive";
  classification: {
    subject: string;
    chapter: string;
    knowledgePoint: string;
  };
  correctAnswer: string;
  explanation: string;
  solutions: Array<{
    name: string;
    steps: string[];
    answer: string;
  }>;
  confidence: number;
  error_reason?: string;
}

export class AiTimeoutError extends Error { name = "AiTimeoutError"; }
export class AiApiError extends Error { name = "AiApiError"; constructor(msg: string, public status: number) { super(msg); } }
export class AiParseError extends Error { name = "AiParseError"; constructor(msg: string, public rawText: string) { super(msg); } }

// ---------------------------------------------------------------------------
// JSON parsing helpers
// ---------------------------------------------------------------------------

// Auto-wrap bare LaTeX fragments in $...$, even in mixed Chinese+math text.
// Handles: \frac{}{}, \lim_{}, \int_{}^{}, \int_0^1, \sqrt{}, \to, \infty, etc.
const LATEX_FRAGMENT = /\\[a-zA-Z]+(?:\{[^}]*\}|\{[^}]*\}\{[^}]*\}|_{[^}]*}|\^\{[^}]*\}|_[a-zA-Z0-9]|\^[a-zA-Z0-9])*/g;

// Match bare superscript/subscript patterns: x^2, a^{n+1}, S_n, x_{1}, e^{i\pi}, 2^{10}
// Also matches standalone ^{...} and _{...} when AI forgot the base character
const BARE_EXPONENT = /(?:[a-zA-Z0-9]+)?[\^_](?:\{[^}]+\}|[a-zA-Z0-9]+)/g;

// Same as MathText splitters — consistent two-level approach
const BLOCK_RE = /(\$\$[\s\S]+?\$\$)/g;
const INLINE_RE = /(\$[^$]+\$)/g;

// Match \begin{env}...\end{env} blocks (matrix, determinant, cases, aligned, etc.)
// Uses backreference \2 to ensure begin/end environment names match
const ENV_BLOCK = /(\\begin\{([^}]+)\}[\s\S]*?\\end\{\2\})/g;

export function autoWrapMathDelimiters(text: string) {
  if (!text) return text;

  // Step 1: split by display math blocks ($$...$$), preserve them untouched
  const parts = text.split(BLOCK_RE);
  return parts.map((part, i) => {
    if (part.startsWith("$$") && part.endsWith("$$") && i % 2 === 1) return part;

    // Step 2: within non-display-math text, split by inline math ($...$)
    const inlineParts = part.split(INLINE_RE);
    return inlineParts.map((ip, j) => {
      // Inline math block — keep as-is
      if (ip.startsWith("$") && ip.endsWith("$") && ip.length > 2 && j % 2 === 1) return ip;

      // Non-math segment — wrap bare LaTeX fragments
      // Pass 0: wrap \begin{...}...\end{...} blocks as a unit (matrix, determinant, etc.)
      let processed = ip.replace(ENV_BLOCK, (match) => `$${match}$`);
      // Pass 1: wrap LaTeX commands (\frac, \lim, etc.)
      processed = processed.replace(LATEX_FRAGMENT, (match) => {
        if (/^\\[bfnrt]$/.test(match)) return match;
        return `$${match}$`;
      });
      // Pass 2: re-split by newly-created $...$ blocks, then wrap bare exponents
      const subParts = processed.split(INLINE_RE);
      processed = subParts.map((sp, k) => {
        if (sp.startsWith("$") && sp.endsWith("$") && sp.length > 2 && k % 2 === 1) return sp;
        return sp.replace(BARE_EXPONENT, (match) => `$${match}$`);
      }).join("");
      return processed;
    }).join("");
  }).join("");
}

// ---------------------------------------------------------------------------
// AI dedup: remove self-debate/backtracking, keep only final conclusion
// ---------------------------------------------------------------------------

// Get settings from DB (with env fallback), auto-decrypt encrypted values
import { queryOne } from "@/lib/db";
import { decrypt } from "@/lib/crypto-utils";
async function loadSetting(key: string, envFallback = "") {
  try {
    const row = await queryOne<{ value: string }>("SELECT value FROM settings WHERE `key`=?", [key]);
    if (row?.value) return decrypt(row.value);
  } catch { /* table may not exist yet */ }
  return process.env[envFallback] || "";
}

// Pick API endpoint based on model or DB setting
async function getApiUrl(model: string, settingKey: string) {
  const custom = await loadSetting(settingKey);
  if (custom) return custom.replace(/\/+$/, "") + "/chat/completions";
  if (model.startsWith("deepseek")) return "https://api.deepseek.com/v1/chat/completions";
  return "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
}
async function getVisionUrl() {
  const custom = await loadSetting("vision_url");
  if (custom) return custom.replace(/\/+$/, "") + "/chat/completions";
  return "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
}

const DEDUP_PROMPT = `你是一个文本精简助手。输入一段AI生成的文本（可能是题目解析或答案），其中AI可能反复推翻自己的说法、写出多个版本的解答。

你的任务：删掉所有"自我推翻"的内容（如"等等，不对，应该重新考虑..."之类），只保留最终正确的解答。

规则：
1. 删除所有推翻前面内容的部分，只保留最后确定的结论
2. 不改变最终结论的任何内容（数学公式、文字、步骤全部保留）
3. 如果没有任何推翻，原样返回
4. 绝不新增任何内容
5. 直接返回精简后的文本，不要解释`;

async function getTextApiKey() {
  return await loadSetting("text_key", "DEEPSEEK_API_KEY") || await loadSetting("vision_key", "DASHSCOPE_API_KEY") || "";
}

async function dedupWithAI(texts: Record<string, string>, _apiKey: string): Promise<Record<string, string>> {
  const apiKey = await getTextApiKey();
  if (!apiKey) return texts;
  const entries = Object.entries(texts).filter(([, v]) => v && v.length > 30);
  if (entries.length === 0) return texts;

  try {
    const dedupModel = await loadSetting("text_model", "TEXT_MODEL") || "qwen-plus";
    const resp = await fetch(
      await getApiUrl(dedupModel, "text_url"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: dedupModel,
          max_tokens: 8192,
          temperature: 0,
          messages: [
            { role: "system", content: DEDUP_PROMPT + "\n\n【绝对禁止】禁止输出思考过程，直接输出精简结果。" },
            { role: "user", content: `输入文本（可能需要精简）：\n\n${entries.map(([k, v]) => `【${k}】\n${v}`).join("\n\n")}\n\n请输出精简后的文本（保持【字段名】标记，直接输出结果）：` },
          ],
        }),
        signal: AbortSignal.timeout(30000),
      }
    );
    if (!resp.ok) return texts;
    const data = await resp.json();
    const raw: string = data.choices?.[0]?.message?.content || "";
    // Parse the response: extract text between 【field】 markers
    const result = { ...texts };
    for (const key of Object.keys(texts)) {
      const pattern = new RegExp(`【${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}】\\s*([\\s\\S]*?)(?=【|$)`, 'i');
      const m = raw.match(pattern);
      if (m?.[1]?.trim()) result[key] = m[1].trim();
    }
    return result;
  } catch {
    return texts;
  }
}

async function dedupResult(result: AiAnalysisResult, apiKey: string): Promise<void> {
  const fields: Record<string, string> = {};
  if (result.explanation && result.explanation.length > 30) fields["explanation"] = result.explanation;
  if (result.correctAnswer && result.correctAnswer.length > 30) fields["correctAnswer"] = result.correctAnswer;
  if (result.ocrText && result.ocrText.length > 30) fields["ocrText"] = result.ocrText;
  const fixed = await dedupWithAI(fields, apiKey);
  // 修复：dedupWithAI 可能返回 undefined（解析失败或网络错误时），写回前必须检查
  // 否则 result.explanation = undefined 会让后续 SQL 报 "Bind parameters must not contain undefined"
  if (fixed["explanation"] && typeof fixed["explanation"] === "string") result.explanation = fixed["explanation"];
  if (fixed["correctAnswer"] && typeof fixed["correctAnswer"] === "string") result.correctAnswer = fixed["correctAnswer"];
  if (fixed["ocrText"] && typeof fixed["ocrText"] === "string") result.ocrText = fixed["ocrText"];
}

// ---------------------------------------------------------------------------
// Layer 3: Post-process — fix common AI LaTeX mistakes that survived this far
// ---------------------------------------------------------------------------

export function sanitizeLatex(text: string) {
  if (!text) return text;

  // 1. Strip $ inside ^{$...$} and _{$...$} — AI wrongly nests math blocks
  text = text.replace(/\^\{(\s*)\$([^$]+)\$(\s*)\}/g, "^{$1$2$3}");
  text = text.replace(/_\{(\s*)\$([^$]+)\$(\s*)\}/g, "_{$1$2$3}");

  // 1b. Fix double-wrapped matrix environments: $\begin{vmatrix}...\end{vmatrix}$
  //     (display math around an environment that's already math mode) → single $...$
  text = text.replace(/\$\$(\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\})\$\$/g, "$$1$");

  // 1c. Strip stray $ signs INSIDE \begin{...}...\end{...} blocks
  //     AI sometimes outputs \begin{pmatrix} $a & b$ \\ c & d \end{pmatrix}
  //     The content is already math mode — any $ inside is a formatting error
  text = text.replace(
    /(\\begin\{[^}]+\})([\s\S]*?)(\\end\{[^}]+\})/g,
    (full, begin, body, end) => {
      // Remove $/$ inside the body — it's already in math mode
      body = body.replace(/\$\$/g, "");
      body = body.replace(/\$/g, "");
      return begin + body + end;
    }
  );

  // 2. Merge adjacent inline blocks: $a$b$ → $ab$
  text = text.replace(/\$(\s*)\$/g, (_, space) => space || " ");

  // 3. Merge single-command blocks into following text:
  //    $\ln$ y → $\ln y$  |  $\cdot$ ( → $\cdot ($
  text = text.replace(/\$(\\[a-zA-Z]+)\$\s+([a-zA-Z0-9(])/g, (_, cmd, next) => `$${cmd} ${next}$`);
  //    x =$ $\frac → x = $\frac  (merge text before $cmd$ into block)
  text = text.replace(/([a-zA-Z0-9)])\s+\$(\\[a-zA-Z]+)\$/g, (_, prev, cmd) => `$${prev} ${cmd}$`);

  // 4. Remove empty math blocks
  text = text.replace(/\$\$/g, "");

  // 5. Fix leading/trailing space inside $...$ blocks
  text = text.replace(/\$\s+/g, "$");
  text = text.replace(/\s+\$/g, "$");

  return text;
}

function fixLatexEscapes(raw: string) {
  // AI 经常在 JSON 字符串里写 `3\times3` 这种，JSON.parse 会把 `\t` 当成制表符
  // 导致 `3<tab>imes3`。修复：单字母 \t \n \r \b \f 后跟字母的，转成 \\t \\n 等
  // 这样 JSON.parse 后得到 `\times3`（正确的 LaTeX）
  // 注意：必须先处理单字母转义，再处理 2+ 字母命令
  let s = raw.replace(/(?<!\\)\\([tnrbf])([a-zA-Z])/g, "\\\\$1$2");
  // Replace single \ followed by 2+ letters with \\ (LaTeX commands like \frac, \lim).
  // Single-letter \ escapes (\n, \t, \r, \b, \f) that are NOT followed by a letter
  // are legitimate JSON escapes — leave them alone.
  s = s.replace(/(?<!\\)\\([a-zA-Z]{2,})/g, "\\\\$1");
  return s;
}

// Strip "thinking" content that agnes-2.0-flash leaks into the output
// These models output thousands of chars of "等等" "再思考" "如果...那么..." before the JSON
// We strip everything before the LAST top-level JSON object (heuristic: find the last
// line that starts with { or the last {"ocrText" occurrence)
function stripThinkingBeforeJson(text: string): string {
  // Strategy 1: find the last occurrence of {"ocrText" — the start of the actual JSON
  // (this is robust because AI's thinking rarely contains this exact key name)
  const markerIdx = text.lastIndexOf('{"ocrText"');
  if (markerIdx >= 0) {
    return text.slice(markerIdx);
  }
  // Strategy 2: find the last {"ocrText with whitespace — sometimes AI adds space
  const markerIdx2 = text.lastIndexOf('{ "ocrText"');
  if (markerIdx2 >= 0) {
    return text.slice(markerIdx2);
  }
  // Strategy 3: find the last line starting with { (assuming thinking is prose, not JSON)
  const lines = text.split("\n");
  let lastBraceLine = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("{") && trimmed.includes(":")) {
      lastBraceLine = i;
      break;
    }
  }
  if (lastBraceLine >= 0) {
    return lines.slice(lastBraceLine).join("\n");
  }
  return text;
}

function parseAiJson(rawText: string): AiAnalysisResult {
  let jsonStr = rawText.trim();

  // Strip leading ``` fences (```json, ```, etc.)
  jsonStr = jsonStr.replace(/^```[\s\S]*?\n/, "").replace(/\n```\s*$/, "");

  // NEW: agnes-2.0-flash leaks thinking content before the JSON — strip it
  jsonStr = stripThinkingBeforeJson(jsonStr);

  // Fix LaTeX backslashes that AI forgot to double-escape
  jsonStr = fixLatexEscapes(jsonStr);

  // Try direct parse
  try { return JSON.parse(jsonStr); } catch { /* fall through */ }

  // Extract between first { and last }
  const start = jsonStr.indexOf("{");
  const end = jsonStr.lastIndexOf("}");
  if (start !== -1 && end !== -1 && start < end) {
    try { return JSON.parse(jsonStr.slice(start, end + 1)); } catch { /* fall through */ }
  }

  // Last resort: re-fix escapes on the extracted slice and retry
  if (start !== -1 && end !== -1) {
    try {
      return JSON.parse(fixLatexEscapes(jsonStr.slice(start, end + 1)));
    } catch {
      throw new AiParseError("Failed to parse AI response as JSON", rawText);
    }
  }

  throw new AiParseError("Failed to parse AI response as JSON", rawText);
}

// ---------------------------------------------------------------------------
// Prompt builder — reads chapter tree from DB to give AI the complete hierarchy
// ---------------------------------------------------------------------------

interface ChapterRow { id: number; name: string; level: number; parent_id: number | null; }

export async function buildSystemPrompt(subjects: ChapterRow[]) {
  const l1 = subjects.filter(c => c.level === 1);
  const l2 = subjects.filter(c => c.level === 2);
  const l3 = subjects.filter(c => c.level === 3);

  const lines: string[] = [];
  for (const s of l1) {
    const chs = l2.filter(c => c.parent_id === s.id);
    lines.push(`\n【${s.name}】`);
    for (const ch of chs) {
      const kps = l3.filter(k => k.parent_id === ch.id).map(k => k.name);
      lines.push(`  ${ch.name}：${kps.join("、")}`);
    }
  }

  const chapterTree = lines.join("\n");

  return `你是考研命题专家，擅长将题目精准归类到考研科目体系中。

【重要】最终答案必须基于严格的数学/逻辑推导，禁止"看图猜答案"。
图片中的手写笔迹（答案、批改勾叉、演算）一律不得作为正确答案的依据。
如果推导结果与图片手写答案冲突，以推导结果为准，在 explanation 中说明冲突点。
思考过程可以内部进行，但输出的必须是最终 JSON，不要把思考过程写进任何字段。
输出的第一个字符必须是 \`{\`，最后一个字符必须是 \`}\`。

## 科目体系（必须严格使用以下名称，不得修改、缩写、自创）

${chapterTree}

## 分类规则 — 必须遵守！

- subject：从上述4个科目（408/数学二/英语二/政治）中选，不得自创
- chapter：必须从该 subject 下的章节名中选，使用完全相同的中文名称（包括括号、标点符号）
- knowledgePoint：必须从该 chapter 下的知识点中选，使用完全相同的中文名称
- 如果题目涉及计算机课程（数据结构、计组、操作系统、网络）→ subject="408"
- 如果题目是数学公式/计算/证明题 → subject="数学二"，再根据内容判断高数还是线代
- 如果题目是英语阅读/翻译/完形/写作 → subject="英语二"
- 如果题目是政治理论/时政/哲学/历史 → subject="政治"
- 无法确定最细粒度的 knowledgePoint 时，选最接近的一个，禁止留空

输出纯 JSON（不含任何 markdown 包裹，不含解释文字）：
{"ocrText":"题干","questionType":"single_choice","classification":{"subject":"","chapter":"","knowledgePoint":""},"correctAnswer":"","explanation":"","solutions":[{"name":"","steps":[],"answer":""}],"confidence":0.95}`;
}

// ---------------------------------------------------------------------------
// Layer 2: AI LaTeX fixer — second AI pass to repair formatting mistakes
// ---------------------------------------------------------------------------

const LATEX_FIXER_PROMPT = `你是 LaTeX 格式化专家。你会收到一个 JSON，包含多个需要修复的文本字段。
你的唯一任务：修复每个字段中所有数学公式的 LaTeX 格式错误。

严格规则：
1. 每个完整数学表达式必须包裹在一个 \$...\$ 中。禁止拆成 \$\ln\$ \$y\$ 这种碎片，正确写法是 \$\ln y\$
2. \^{} 和 \_{} 内部绝对不能出现 \$ 符号。x^{\$\\frac{1}{2}\$} 是错误的，正确是 x^{\\frac{1}{2}}
3. \\left 和 \\right 必须成对出现在同一个 \$...\$ 内，禁止拆开
4. \$ 必须成对出现，有开就有闭
5. 所有 LaTeX 命令（\\frac \\lim \\int \\sum \\sqrt \\ln \\cdot \\left \\right \\to \\infty \\sim 等）必须在 \$...\$ 内部，禁止 \$\ln\$ 这种单独命令块
6. 只修复 LaTeX 格式，不改变题目含义、文字内容、公式内容

输出：直接返回修复后的 JSON，字段结构与输入完全一致，不要添加任何解释。`;

export async function fixLatexWithAI(
  texts: Record<string, string>,
  _apiKey: string
): Promise<Record<string, string>> {
  const apiKey = await getTextApiKey();
  if (!apiKey) return texts;

  const entries = Object.entries(texts);
  const totalLen = entries.reduce((s, [, v]) => s + (v || "").length, 0);
  if (totalLen < 20) return texts;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const ltxModel = await loadSetting("text_model", "TEXT_MODEL") || "qwen-plus";
    const resp = await fetch(
      await getApiUrl(ltxModel, "text_url"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: ltxModel,
          max_tokens: 8192,
          temperature: 0,
          messages: [
            { role: "system", content: LATEX_FIXER_PROMPT },
            { role: "user", content: `请修复以下 JSON 中每个字段的 LaTeX 格式，返回相同结构的 JSON：\n\n${JSON.stringify(texts, null, 2)}` },
          ],
        }),
        signal: controller.signal,
      }
    );

    if (!resp.ok) return texts;
    const data = await resp.json();
    const raw: string = data.choices?.[0]?.message?.content || "";
    try {
      const fixed = JSON.parse(raw);
      const result: Record<string, string> = {};
      for (const key of Object.keys(texts)) {
        result[key] = typeof fixed[key] === "string" ? fixed[key] : texts[key];
      }
      return result;
    } catch {
      return texts;
    }
  } catch {
    return texts;
  } finally {
    clearTimeout(timeout);
  }
}

async function applyLatexFixer(result: AiAnalysisResult, apiKey: string): Promise<void> {
  // Collect all text fields into a flat map
  const fields: Record<string, string> = {};
  if (result.ocrText) fields["ocrText"] = result.ocrText;
  if (result.correctAnswer) fields["correctAnswer"] = result.correctAnswer;
  if (result.explanation) fields["explanation"] = result.explanation;
  for (let i = 0; i < result.solutions.length; i++) {
    const sol = result.solutions[i];
    if (sol.name) fields[`sol_${i}_name`] = sol.name;
    if (sol.answer) fields[`sol_${i}_answer`] = sol.answer;
    for (let j = 0; j < sol.steps.length; j++) {
      if (sol.steps[j]) fields[`sol_${i}_step_${j}`] = sol.steps[j];
    }
  }

  // Single API call fixes all fields
  const fixed = await fixLatexWithAI(fields, apiKey);

  // Write back
  if (fixed["ocrText"]) result.ocrText = fixed["ocrText"];
  if (fixed["correctAnswer"]) result.correctAnswer = fixed["correctAnswer"];
  if (fixed["explanation"]) result.explanation = fixed["explanation"];
  for (let i = 0; i < result.solutions.length; i++) {
    if (fixed[`sol_${i}_name`]) result.solutions[i].name = fixed[`sol_${i}_name`];
    if (fixed[`sol_${i}_answer`]) result.solutions[i].answer = fixed[`sol_${i}_answer`];
    for (let j = 0; j < result.solutions[i].steps.length; j++) {
      if (fixed[`sol_${i}_step_${j}`]) result.solutions[i].steps[j] = fixed[`sol_${i}_step_${j}`];
    }
  }
}

// ---------------------------------------------------------------------------
// Real AI mode (千问 Qwen-VL / DashScope)
// ---------------------------------------------------------------------------

async function realAnalyze(
  imageBase64: string,
  mimeType: string,
  chapterTree: ChapterRow[],
  userAnswer?: string
): Promise<AiAnalysisResult> {
  const systemPrompt = await buildSystemPrompt(chapterTree);
  const apiKey = await loadSetting("vision_key", "DASHSCOPE_API_KEY");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);

  try {
    const resp = await fetch(
      await getVisionUrl(),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey!}`,
        },
        body: JSON.stringify({
          model: await loadSetting("vision_model", "DASHSCOPE_MODEL") || "qwen-vl-plus",
          max_tokens: 16384,
          response_format: { type: "json_object" },
          temperature: 0,
          // 保留思考能力（agnes-2.0-flash 是思考型模型，对复杂数学题推理重要）
          // 但用 stripThinkingBeforeJson 在解析前剥离思考内容，只提取最终 JSON
          // 强化 prompt 禁止"看图猜答案"
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mimeType};base64,${imageBase64}`,
                  },
                },
                {
                  type: "text",
                  text: userAnswer
                    ? `请分析这道错题。我的答案是「${userAnswer}」。

严格要求：
1. ocrText：完整逐字识别题目，必须去掉题号前缀（如'32.'、'【2021统考真题】'），只保留印刷体题干正文。忽略图片中的手写笔迹（手写答案/演算/批注一律不识别到ocrText中）。
   【行列式/矩阵识别】图片中的多行行列式或矩阵必须识别为一个整体LaTeX表达式，禁止拆成多行。
   - 行列式：$\begin{vmatrix} a & b \\ c & d \end{vmatrix}$
   - 矩阵：$\begin{pmatrix} a & b \\ c & d \end{pmatrix}$ 或 $\begin{bmatrix} a & b \\ c & d \end{bmatrix}$
   - 用 & 分隔列，用 \\\\ 分隔行
   【图表/拓扑图识别】如果题目中包含图表、网络拓扑图、流程图、架构图等，必须在 ocrText 中用文字详细描述图中所有关键信息：
   - 节点/设备名称与数量、连接关系（谁连谁）、链路速率/带宽/延迟
   - IP 地址、MAC 地址、接口编号、VLAN ID 等所有数字标注
   - 用结构化的文字呈现，例如：
     「网络拓扑：路由器 R1(eth0: 10.0.0.1/24) --100Mbps-- 交换机 S1(端口1-3) -- 服务器 A(10.0.0.10)、B(10.0.0.11)、C(10.0.0.12)」
     「流程图：开始 → 输入n → 判断n>0？→ [是]输出正数 → 结束；[否]输出负数 → 结束」
   - 图表信息是解题的必要条件，缺失会导致题目无法作答
2. classification：必须严格使用 system prompt 中的准确的章节名称（包含括号、标点等全部字符），一字不差。不得缩写（如不可写"毛中特"替代"毛泽东思想和中国特色社会主义理论体系概论"），不得自创名称。按以下顺序判断：①先判科目（408/数学二/英语二/政治）②再判章节 ③最后选最精确的知识点
3. correctAnswer：只给出该题的正确答案
4. explanation：至少200字详细解析，必须包含：①知识点回顾 ②分步解题过程 ③易错点提醒。
   【数学公式规范】
   - 所有数学符号和公式必须完整包裹在一个 $...$ 中，禁止写成 $a = $b 形式（必须一个 $...$ 包裹完整公式），也禁止 x^{$...$}（$ 不能嵌套在 ^{} 内），禁止 $_{x=1}$（下标不能孤悬）
   - 所有上标下标必须用花括号：x^{2} 而非 x^2，x_{1} 而非 x_1
   - 分数必须用 \\\\frac{}{} ，积分用 \\\\int，极限用 \\\\lim
   - 每个 $...$ 必须成对出现，有开必须有闭
5. solutions：至少2种解法，每种解法含步骤列表和答案。解法步骤中数学用 LaTeX（同上述规范）
6. 【关键】JSON 内所有 LaTeX 反斜杠写成双反斜杠 \\\\，例如：
   - 正确：$\\\\frac{1}{2}$ $\\\\lim_{x \\\\to 0}$ $\\\\int_0^1$
   - 错误：$\\frac{1}{2}$（缺少双反斜杠会破坏 JSON）`
                    : `请分析这道题目。

严格要求：
1. ocrText：完整逐字识别题目文字，必须去掉题号前缀（如'32.'、'【2021统考真题】'），只保留印刷体题干正文。忽略图片中的手写笔迹（手写答案/演算/批注一律不识别到ocrText中）。选择题选项必须每行一个，用 \\n 分隔：\\nA. xxx\\nB. xxx\\nC. xxx\\nD. xxx。
   【行列式/矩阵识别】图片中的多行行列式或矩阵必须识别为一个整体LaTeX表达式，禁止拆成多行。
   - 行列式：$\begin{vmatrix} a & b \\ c & d \end{vmatrix}$
   - 矩阵：$\begin{pmatrix} a & b \\ c & d \end{pmatrix}$ 或 $\begin{bmatrix} a & b \\ c & d \end{bmatrix}$
   - 用 & 分隔列，用 \\\\ 分隔行
   【图表/拓扑图识别】如果题目中包含图表、网络拓扑图、流程图、架构图等，必须在 ocrText 中用文字详细描述图中所有关键信息：
   - 节点/设备名称与数量、连接关系（谁连谁）、链路速率/带宽/延迟
   - IP 地址、MAC 地址、接口编号、VLAN ID 等所有数字标注
   - 用结构化的文字呈现，例如：
     「网络拓扑：路由器 R1(eth0: 10.0.0.1/24) --100Mbps-- 交换机 S1(端口1-3) -- 服务器 A(10.0.0.10)、B(10.0.0.11)、C(10.0.0.12)」
     「流程图：开始 → 输入n → 判断n>0？→ [是]输出正数 → 结束；[否]输出负数 → 结束」
   - 图表信息是解题的必要条件，缺失会导致题目无法作答
2. classification：必须严格使用 system prompt 中的准确的章节名称（包含括号、标点等全部字符），一字不差。不得缩写（如不可写"毛中特"替代"毛泽东思想和中国特色社会主义理论体系概论"），不得自创名称。按以下顺序判断：①先判科目（408/数学二/英语二/政治）②再判章节 ③最后选最精确的知识点
3. correctAnswer：只给出该题的正确答案
4. explanation：至少200字详细解析，必须包含：①知识点回顾 ②分步解题过程 ③易错点提醒。
   【数学公式规范】
   - 所有数学符号和公式必须完整包裹在一个 $...$ 中，禁止写成 $a = $b 形式（必须一个 $...$ 包裹完整公式），也禁止 x^{$...$}（$ 不能嵌套在 ^{} 内），禁止 $_{x=1}$（下标不能孤悬）
   - 所有上标下标必须用花括号：x^{2} 而非 x^2，x_{1} 而非 x_1
   - 分数必须用 \\\\frac{}{} ，积分用 \\\\int，极限用 \\\\lim
   - 每个 $...$ 必须成对出现，有开必须有闭
5. solutions：至少2种不同解法，每种含步骤列表和最终答案。步骤中的数学公式用 LaTeX（同上述规范）
6. 【关键】JSON 内所有 LaTeX 反斜杠必须写成双反斜杠 \\\\。例如：
   正确：$\\\\frac{1}{2}$、$\\\\lim_{x \\\\to 0}$、$\\\\int_0^1 x^2 dx$、$\\\\sum_{i=1}^n$
   错误：$\\frac{1}{2}$ ← 单反斜杠 = 格式错误
   矩阵：$$\\\\begin{pmatrix} a & b \\\\\\\\ c & d \\\\end{pmatrix}$$`,
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      }
    );

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new AiApiError(`AI API error ${resp.status}: ${errText}`, resp.status);
    }

    const data = await resp.json();
    // qwen3.6-flash returns reasoning_content separately, but just in case
    const msg = data.choices?.[0]?.message || {};
    const rawText: string = msg.content || "";
    // If AI put reasoning inline, extract just the JSON part
    const cleanText = rawText.includes("{") ? rawText.slice(rawText.indexOf("{")) : rawText;
    const parsed = parseAiJson(cleanText);

    // Fix literal \n (backslash-n text) before LaTeX processing
    parsed.ocrText = parsed.ocrText.replace(/\\n/g, "\n").replace(/\\t/g, " ");

    // ---- Layer 1+3: auto-wrap bare LaTeX, then sanitize ----
    parsed.ocrText = sanitizeLatex(autoWrapMathDelimiters(parsed.ocrText));
    parsed.correctAnswer = sanitizeLatex(autoWrapMathDelimiters(parsed.correctAnswer));
    parsed.explanation = sanitizeLatex(autoWrapMathDelimiters(parsed.explanation));
    if (parsed.solutions) for (const sol of parsed.solutions) {
      sol.name = sanitizeLatex(autoWrapMathDelimiters(sol.name));
      if (sol.steps) sol.steps = sol.steps.map(s => sanitizeLatex(autoWrapMathDelimiters(s)));
      sol.answer = sanitizeLatex(autoWrapMathDelimiters(sol.answer));
    }

    // ---- Layer 2: second AI pass to fix remaining LaTeX mistakes ----
    await applyLatexFixer(parsed, apiKey!);

    // ---- Final sanitize after AI fixer ----
    parsed.ocrText = sanitizeLatex(parsed.ocrText);
    parsed.correctAnswer = sanitizeLatex(parsed.correctAnswer);
    parsed.explanation = sanitizeLatex(parsed.explanation);
    if (parsed.solutions) for (const sol of parsed.solutions) {
      sol.name = sanitizeLatex(sol.name);
      if (sol.steps) sol.steps = sol.steps.map(sanitizeLatex);
      sol.answer = sanitizeLatex(sol.answer);
    }

    // ---- AI dedup: remove self-debate before formatting ----
    await dedupResult(parsed, apiKey!);

    // Strip question numbers from OCR text (e.g. "32. ", "【2021统考真题】")
    if (parsed.ocrText) {
      parsed.ocrText = parsed.ocrText
        .replace(/^\d+\s*[\.\、\s]\s*/, "")        // "32. " or "32、"
        .replace(/^【[^】]*】\s*/, "")               // "【2021统考真题】"
        .replace(/^\[[^\]]*\]\s*/, "")              // "[2021统考真题]"
        .trim();
    }

    return parsed;
  } catch (err) {
    if (err instanceof AiApiError || err instanceof AiParseError) throw err;
    if ((err as Error).name === "AbortError") throw new AiTimeoutError("AI analysis timed out");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function analyzeWrongAnswerImage(
  imageBase64: string,
  mimeType: string,
  chapterTree: ChapterRow[],
  userAnswer?: string
): Promise<AiAnalysisResult> {
  if (!await loadSetting("vision_key", "DASHSCOPE_API_KEY") && !await loadSetting("text_key", "DEEPSEEK_API_KEY")) {
    throw new AiApiError("API key 未配置，请在设置页面填写", 500);
  }
  return realAnalyze(imageBase64, mimeType, chapterTree, userAnswer);
}
