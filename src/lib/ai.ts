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

  // Protect code blocks (```...```) from LaTeX wrapping — code blocks may contain
  // LaTeX-like content (V_1, a^2, \begin{vmatrix}...) that should NOT be wrapped in $...$
  const codeBlocks: string[] = [];
  const CB_PLACEHOLDER = (i: number) => `\u0000CB${i}\u0000`;
  text = text.replace(/```[a-zA-Z]*\n?([\s\S]*?)```/g, (full) => {
    const i = codeBlocks.length;
    codeBlocks.push(full);
    return CB_PLACEHOLDER(i);
  });

  // Step 1: split by display math blocks ($$...$$), preserve them untouched
  const parts = text.split(BLOCK_RE);
  let result = parts.map((part, i) => {
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

  // Restore code blocks
  for (let i = 0; i < codeBlocks.length; i++) {
    result = result.replace(CB_PLACEHOLDER(i), codeBlocks[i]);
  }

  return result;
}

// ---------------------------------------------------------------------------
// AI dedup: remove self-debate/backtracking, keep only final conclusion
// ---------------------------------------------------------------------------

// Get settings from DB (with env fallback), auto-decrypt encrypted values
import { queryOne } from "@/lib/db";
import { decrypt } from "@/lib/crypto-utils";
import { logAiResp } from "@/lib/ai-resp-log";
async function loadSetting(key: string, envFallback = "") {
  try {
    const row = await queryOne<{ value: string }>("SELECT value FROM settings WHERE `key`=?", [key]);
    if (row?.value) return decrypt(row.value);
  } catch { /* table may not exist yet */ }
  return process.env[envFallback] || "";
}

// 读取布尔型设置：值为 "1"/"true"/"yes" 视为 true，其余为 false
// 部分模型（如 GLM-4.6V）不支持 system role，需将 systemPrompt 合并到 user message
async function loadBoolSetting(key: string, defaultValue = false) {
  const v = (await loadSetting(key)).trim().toLowerCase();
  if (!v) return defaultValue;
  return v === "1" || v === "true" || v === "yes" || v === "on";
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

const DEDUP_PROMPT = `你是一个文本精简助手。输入一段AI生成的文本（可能是题目解析、答案或解题步骤），其中AI可能反复推翻自己的说法、写出多个版本的解答。

你的任务：删掉所有"自我推翻"的内容，只保留最终正确的解答。

规则：
1. 删除所有推翻前面内容的部分，只保留最后确定的结论
2. 识别并删除以下自我推翻标志词后的所有内容（包括这些词本身）：
   - "错误！"、"不对"、"不是"、"纠正后"、"重新分析"、"重新计算"、"再检查"
   - "但这与...矛盾"、"这与...不符"、"说明...有误"、"疑似有误"
   - "应为相反结论"、"实际应为"、"应当修正为"
   - "啊！"、"哦！"等感叹式自我纠正
   - "综上，正确答案应为"（如果前面已有结论，属于推翻重写）
3. 如果文中出现"参考答案"vs"我的分析"的冲突讨论，只保留与最终参考答案一致的分析部分
4. 不改变最终结论的任何内容（数学公式、文字、步骤全部保留）
5. 如果没有任何推翻，原样返回
6. 绝不新增任何内容
7. 直接返回精简后的文本，不要解释`;

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
    logAiResp("dedupWithAI", dedupModel, raw);
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
  // 跳过含代码块/表格的 ocrText — 结构化图片描述不应被 dedup AI 误删
  if (result.ocrText && result.ocrText.length > 30 && !result.ocrText.includes("```") && !result.ocrText.includes("|---|")) {
    fields["ocrText"] = result.ocrText;
  }
  // solutions 的 steps 是 AI 自我推翻的重灾区，必须处理
  for (let i = 0; i < result.solutions.length; i++) {
    const sol = result.solutions[i];
    for (let j = 0; j < sol.steps.length; j++) {
      const step = sol.steps[j];
      // 只处理含自我推翻标志的步骤（长度 > 30 且含推翻关键词）
      if (step && step.length > 30 && /错误！|不对|纠正后|重新分析|重新计算|再检查|但这与.*矛盾|这与.*不符|说明.*有误|应为相反结论|实际应为|应当修正为|综上.*正确答案应为/.test(step)) {
        fields[`sol_${i}_step_${j}`] = step;
      }
    }
  }
  const fixed = await dedupWithAI(fields, apiKey);
  // 修复：dedupWithAI 可能返回 undefined（解析失败或网络错误时），写回前必须检查
  // 否则 result.explanation = undefined 会让后续 SQL 报 "Bind parameters must not contain undefined"
  if (fixed["explanation"] && typeof fixed["explanation"] === "string") result.explanation = fixed["explanation"];
  if (fixed["correctAnswer"] && typeof fixed["correctAnswer"] === "string") result.correctAnswer = fixed["correctAnswer"];
  if (fixed["ocrText"] && typeof fixed["ocrText"] === "string") result.ocrText = fixed["ocrText"];
  // 写回 solutions steps
  for (let i = 0; i < result.solutions.length; i++) {
    for (let j = 0; j < result.solutions[i].steps.length; j++) {
      const key = `sol_${i}_step_${j}`;
      if (fixed[key] && typeof fixed[key] === "string") result.solutions[i].steps[j] = fixed[key];
    }
  }
}

// ---------------------------------------------------------------------------
// 答案一致性校验：用文本模型对比 correctAnswer 与 explanation/solutions
// 若不一致，以 explanation/solutions 为准返回修正后的 correctAnswer
// ---------------------------------------------------------------------------

const RECONCILE_PROMPT = `你是考研题目校对专家。你的任务是判断"答案"字段与"解析/解法"的最终结果是否一致。

规则：
- 以"解析"和"解法"中的推导结果为准
- 如果"答案"与推导结果不一致，返回修正后的答案（取推导结果）
- 如果一致，原样返回答案
- 答案可能是选项字母（A/B/C/D）、数值、表达式等，需归一化比较（忽略空格、大小写、$ 符号差异）

输出纯 JSON：
{"consistent": true/false, "correctedAnswer": "修正后的答案", "reason": "不一致原因（若一致则为空）"}

输出的第一个字符必须是 \`{\`，最后一个字符必须是 \`}\`。`;

export async function reconcileAnswerWithAI(result: AiAnalysisResult, apiKey: string): Promise<void> {
  if (!result.correctAnswer && !result.explanation && (!result.solutions || result.solutions.length === 0)) return;

  const model = await loadSetting("text_model", "TEXT_MODEL") || "qwen-plus";
  const solutionsText = (result.solutions || [])
    .map((s, i) => `解法${i + 1}「${s.name}」：步骤：${(s.steps || []).join(" | ")}；答案：${s.answer || "(无)"}`)
    .join("\n");

  const userText = `【答案字段】
${result.correctAnswer || "(空)"}

【解析字段】
${result.explanation || "(空)"}

【解法字段】
${solutionsText || "(无解法)"}

请判断答案字段与解析/解法的最终结果是否一致。`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const body: any = {
      model,
      max_tokens: 2048,
      temperature: 0,
      messages: [
        { role: "system", content: RECONCILE_PROMPT },
        { role: "user", content: userText },
      ],
    };
    if (!model.startsWith("deepseek")) body.response_format = { type: "json_object" };

    const resp = await fetch(await getApiUrl(model, "text_url"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) {
      console.warn("[reconcileAnswerWithAI] API error", resp.status);
      return;
    }
    const data = await resp.json();
    const rawText: string = data.choices?.[0]?.message?.content || "";
    logAiResp("reconcileAnswerWithAI", model, rawText);
    const jsonStr = stripThinkingBeforeJson(rawText);
    const parsed = parseAiJson(jsonStr) as AiAnalysisResult & { correctedAnswer?: string; reason?: string; consistent?: boolean };

    if (parsed && typeof parsed.correctedAnswer === "string" && parsed.correctedAnswer.trim()) {
      const original = (result.correctAnswer || "").trim();
      const corrected = parsed.correctedAnswer.trim();
      // 归一化比较：去 $、空格、统一大小写
      const norm = (s: string) => s.replace(/\$/g, "").replace(/\s+/g, "").toLowerCase();
      if (norm(original) !== norm(corrected)) {
        console.log(`[reconcileAnswerWithAI] 答案修正："${original}" → "${corrected}"，原因：${parsed.reason || "(未说明)"}`);
        result.correctAnswer = corrected;
      }
    }
  } catch (err) {
    console.warn("[reconcileAnswerWithAI] failed, keeping original answer:", err instanceof Error ? err.message : err);
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Layer 3: Post-process — fix common AI LaTeX mistakes that survived this far
// ---------------------------------------------------------------------------

// Unicode 数学符号 → LaTeX 命令映射
// AI 输出常含 Unicode 符号（→ ∞ ∑ √ 等），KaTeX 不识别需转换为 LaTeX
const UNICODE_MATH_MAP: Array<[RegExp, string]> = [
  [/\s*→\s*/g, " \\to "],          // 箭头
  [/∞/g, "\\infty"],                // 无穷
  [/∑/g, "\\sum"],                  // 求和
  [/∏/g, "\\prod"],                 // 求积
  [/∫/g, "\\int"],                  // 积分
  [/∮/g, "\\oint"],                 // 环路积分
  [/√(\[[^\]]*\])?\{([^}]*)\}/g, "\\sqrt$1{$2}"],  // √[n]{x} → \sqrt[n]{x}
  [/√([a-zA-Z0-9])/g, "\\sqrt $1"], // √x → \sqrt x（无花括号）
  [/≤/g, "\\leq"],                  // 小于等于
  [/≥/g, "\\geq"],                  // 大于等于
  [/≠/g, "\\neq"],                  // 不等于
  [/≈/g, "\\approx"],               // 约等于
  [/≡/g, "\\equiv"],                // 恒等于
  [/±/g, "\\pm"],                   // 正负
  [/∓/g, "\\mp"],                   // 负正
  [/×/g, "\\times"],                // 乘
  [/÷/g, "\\div"],                  // 除
  [/·/g, "\\cdot"],                 // 点乘
  [/∂/g, "\\partial"],              // 偏导
  [/∇/g, "\\nabla"],                // 梯度
  [/∈/g, "\\in"],                   // 属于
  [/∉/g, "\\notin"],                // 不属于
  [/⊂/g, "\\subset"],               // 真子集
  [/⊃/g, "\\supset"],               // 真超集
  [/⊆/g, "\\subseteq"],             // 子集
  [/⊇/g, "\\supseteq"],             // 超集
  [/∪/g, "\\cup"],                  // 并集
  [/∩/g, "\\cap"],                  // 交集
  [/∅/g, "\\emptyset"],             // 空集
  [/∀/g, "\\forall"],               // 全称
  [/∃/g, "\\exists"],               // 存在
  [/⇒/g, "\\Rightarrow"],           // 推出
  [/⇔/g, "\\Leftrightarrow"],       // 当且仅当
  [/α/g, "\\alpha"],
  [/β/g, "\\beta"],
  [/γ/g, "\\gamma"],
  [/δ/g, "\\delta"],
  [/ε/g, "\\epsilon"],
  [/θ/g, "\\theta"],
  [/λ/g, "\\lambda"],
  [/μ/g, "\\mu"],
  [/π/g, "\\pi"],
  [/σ/g, "\\sigma"],
  [/ω/g, "\\omega"],
  [/φ/g, "\\phi"],
  [/ρ/g, "\\rho"],
  [/τ/g, "\\tau"],
  [/η/g, "\\eta"],
  [/ζ/g, "\\zeta"],
  [/ν/g, "\\nu"],
  [/ξ/g, "\\xi"],
  [/κ/g, "\\kappa"],
  [/χ/g, "\\chi"],
  [/ψ/g, "\\psi"],
  [/Δ/g, "\\Delta"],
  [/Σ/g, "\\Sigma"],
  [/Ω/g, "\\Omega"],
  [/Φ/g, "\\Phi"],
  [/Γ/g, "\\Gamma"],
  [/Θ/g, "\\Theta"],
  [/Λ/g, "\\Lambda"],
  // Unicode 上下标数字（V₀ V₁ 等）→ _{0} _{1}
  [/₀/g, "_{0}"], [/₁/g, "_{1}"], [/₂/g, "_{2}"], [/₃/g, "_{3}"], [/₄/g, "_{4}"],
  [/₅/g, "_{5}"], [/₆/g, "_{6}"], [/₇/g, "_{7}"], [/₈/g, "_{8}"], [/₉/g, "_{9}"],
  // Unicode 上标数字（x² x³ 等）→ ^{2} ^{3}
  [/²/g, "^{2}"], [/³/g, "^{3}"], [/¹/g, "^{1}"], [/⁰/g, "^{0}"],
  [/⁴/g, "^{4}"], [/⁵/g, "^{5}"], [/⁶/g, "^{6}"], [/⁷/g, "^{7}"], [/⁸/g, "^{8}"], [/⁹/g, "^{9}"],
  // Unicode 上标字母（向量转置 ᵀ、上标 i ⁱ、上标 n ⁿ 等）→ ^{T} ^{i} ^{n}
  [/ᵀ/g, "^{T}"], [/ᵗ/g, "^{t}"], [/ⁱ/g, "^{i}"], [/ⁿ/g, "^{n}"], [/ʳ/g, "^{r}"], [/ᵃ/g, "^{a}"], [/ᵇ/g, "^{b}"], [/ᶜ/g, "^{c}"],
  [/ᵈ/g, "^{d}"], [/ᵉ/g, "^{e}"], [/ᶠ/g, "^{f}"], [/ᵍ/g, "^{g}"], [/ʰ/g, "^{h}"], [/ʲ/g, "^{j}"], [/ᵏ/g, "^{k}"], [/ˡ/g, "^{l}"],
  [/ᵐ/g, "^{m}"], [/ᵒ/g, "^{o}"], [/ᵖ/g, "^{p}"], [/ˢ/g, "^{s}"], [/ᵘ/g, "^{u}"], [/ᵛ/g, "^{v}"], [/ʷ/g, "^{w}"], [/ˣ/g, "^{x}"], [/ʸ/g, "^{y}"], [/ᶻ/g, "^{z}"],
  // Unicode 下标字母（xᵢ 等）→ _{i}
  [/ᵢ/g, "_{i}"], [/ₐ/g, "_{a}"], [/ₑ/g, "_{e}"], [/ₒ/g, "_{o}"], [/ₓ/g, "_{x}"], [/ᵤ/g, "_{u}"], [/ᵥ/g, "_{v}"], [/ₕ/g, "_{h}"], [/ₖ/g, "_{k}"], [/ₗ/g, "_{l}"], [/ₘ/g, "_{m}"], [/ₙ/g, "_{n}"], [/ₚ/g, "_{p}"], [/ₛ/g, "_{s}"], [/ₜ/g, "_{t}"],
  // Unicode 减号 U+2212 → ASCII 减号（KaTeX 文本模式不识别 Unicode 减号）
  [/\u2212/g, "-"],
  // Unicode 乘号 U+00D7 已在上方 × → \times 处理
  // 度/角/平行/垂直等几何符号
  [/°/g, "^{\\circ}"],              // 度
  [/∠/g, "\\angle"],               // 角
  [/⊥/g, "\\perp"],                // 垂直
  [/∥/g, "\\parallel"],            // 平行
  [/△/g, "\\triangle"],            // 三角形
  [/□/g, "\\square"],              // 方形
  // 取整/绝对值括号
  [/⌊/g, "\\lfloor"], [/⌋/g, "\\rfloor"],   // 下取整 ⌊x⌋
  [/⌈/g, "\\lceil"], [/⌉/g, "\\rceil"],     // 上取整 ⌈x⌉
  [/⟨/g, "\\langle"], [/⟩/g, "\\rangle"],   // 内积 ⟨x,y⟩
  // 撇号（导数标记）
  [/′/g, "'"], [/″/g, "''"], [/‴/g, "'''"],
  // 省略号
  [/…/g, "\\ldots"],               // 底省略号
  [/⋯/g, "\\cdots"],               // 中省略号
  [/⋮/g, "\\vdots"],               // 竖省略号
  [/⋱/g, "\\ddots"],               // 对角省略号
  // 集合运算补充
  [/⊖/g, "\\setminus"],            // 集合差
  // 逻辑符号
  [/¬/g, "\\neg"],                 // 非
  [/∧/g, "\\wedge"],               // 与
  [/∨/g, "\\vee"],                 // 或
  [/∴/g, "\\therefore"],          // 所以
  [/∵/g, "\\because"],            // 因为
  // 关系符号补充
  [/∝/g, "\\propto"],              // 正比
  [/≅/g, "\\cong"],                // 全等
  [/∼/g, "\\sim"],                 // 相似
  // 箭头补充
  [/←/g, "\\leftarrow"],           // 左箭头
  [/↔/g, "\\leftrightarrow"],      // 左右箭头
  [/⇐/g, "\\Leftarrow"],           // 双线左箭头
  [/↦/g, "\\mapsto"],              // 映射
  [/↑/g, "\\uparrow"],             // 上箭头
  [/↓/g, "\\downarrow"],           // 下箭头
  // 圆点运算
  [/∘/g, "\\circ"],                // 复合运算
  [/∙/g, "\\bullet"],              // 实心圆点
  // 二元运算补充
  [/⊕/g, "\\oplus"],               // 直和
  [/⊗/g, "\\otimes"],              // 张量积
  [/⊙/g, "\\odot"],                // Hadamard积
  [/⊘/g, "\\oslash"],              // 圈除
  [/⊛/g, "\\ast"],                 // 圈星
  // 空白/间距
  [/ /g, " "], [/ /g, " "], [/ /g, " "],  // 各种 Unicode 空格归一化
];

// 将 Unicode 数学符号替换为 LaTeX 命令
// 仅替换 $...$ 数学块"内"的 Unicode 符号；块外的中文叙述中 → 等保持原样
// 例外：√ 和 ∑ ∫ 等即使在外也该转（数学含义明确）
function replaceUnicodeMath(text: string): string {
  if (!text) return text;

  // 保护代码块（```...```）—— 不应转换代码块内的符号
  const codeBlocks: string[] = [];
  text = text.replace(/```[a-zA-Z]*\n?([\s\S]*?)```/g, (full) => {
    const i = codeBlocks.length;
    codeBlocks.push(full);
    return `\u0000CB${i}\u0000`;
  });

  // 分割为 $...$ 块和非数学文本
  const parts = text.split(/(\$\$?[\s\S]+?\$\$?)/g);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    // 跳过 $...$ 数学块（块内已应该是 LaTeX，但 AI 也可能在块内用 Unicode）
    // 实际上块内块外都要处理 Unicode 数学符号
    let p = part;
    for (const [re, replacement] of UNICODE_MATH_MAP) {
      p = p.replace(re, replacement);
    }
    parts[i] = p;
  }
  let result = parts.join("");

  // 修复裸 LaTeX 命令（缺反斜杠）：lim_, sin_, cos_, log_, ln, max, min 等
  // AI 常输出 $lim_{n}$ 而非 $\lim_{n}$
  const nakedCmds = ["lim", "sin", "cos", "tan", "cot", "sec", "csc", "log", "ln", "exp", "max", "min", "sup", "inf", "arg"];
  for (const cmd of nakedCmds) {
    // lim_(  或 lim{  或 lim_  后跟 { 或 ( —— 缺反斜杠
    const re = new RegExp(`(?<![\\\\a-zA-Z])${cmd}(_|\\{|\\()`, "g");
    result = result.replace(re, `\\${cmd}$1`);
  }

  // 修复 \n 混入命令名：\nlim → \lim, \nsin → \sin（AI 输出 \n 被误当作转义）
  // 典型："$f(x) = \nlim_{n \to \infty}" → "$f(x) = \lim_{n \to \infty}"
  for (const cmd of nakedCmds) {
    const re = new RegExp(`\\\\n${cmd}(?![a-zA-Z])`, "g");
    result = result.replace(re, `\\${cmd}`);
  }
  // 处理字面量 \n（反斜杠+n）：
  // 1. 如果 \n + 后续字母构成已知 LaTeX 命令（如 \nabla, \neq, \nu），保留不动
  // 2. 如果不是已知命令（如 \nA. \nB. 选项换行, \n2. 数字编号），\n 是字面量换行符 → 转为真正的换行
  const knownNCmds = new Set([
    "nabla", "neq", "nu", "ni", "not", "neg", "nearrow", "nwarrow",
    "newline", "nonumber", "noindent", "nolimits", "normalsize",
    "nsubseteq", "nsupseteq"
  ]);
  // 先处理 \n + 字母序列：已知命令保留，未知的 \n 转换为换行
  result = result.replace(/\\n([a-zA-Z]*)/g, (full, rest) => {
    if (rest && knownNCmds.has("n" + rest)) return full;  // \nabla \neq 等保留
    return "\n" + rest;  // \nA. → 换行+A.，\nB. → 换行+B.
  });

  // 再处理剩余的 \n（后跟数字/标点/空格/行尾）→ 换行
  // 典型："(n\geq3) \n \alpha_{1}=..." → "(n\geq3)\n\alpha_{1}=..."
  result = result.replace(/\\n/g, "\n");

  // 修复 OCR 字面量 "o" 被当作 \to —— 典型 "lim_{n o \infty}" → "lim_{n \to \infty}"
  // 这个问题源于 AI 输出 \to 时反斜杠丢失变成 "to"，再被 OCR 误识别为 "o"
  result = result.replace(/(?<=\b\w)\s+o\s+\\(infty|infty\b)/g, " \\to \\$1");

  // 修复 JSON.parse 破坏的 LaTeX 命令：
  // \frac 的 \f 被 JSON.parse 当作 form feed (U+000C) → 恢复为 \frac
  // \tan \theta \times 的 \t 被 JSON.parse 当作 tab (U+0009) → 恢复
  // \binom \bar \beta 的 \b 被当作 backspace (U+0008) → 恢复
  // \rho \right 的 \r 被当作回车 (U+000D) → 恢复
  // \nabla \neq \nu 的 \n 被当作换行 → 恢复
  // 规则：直接匹配 控制字符+完整命令名，替换为 \+完整命令名
  // 按命令长度降序排列，先匹配长命令再匹配短命令
  // 避免 \tan 中的 \t 先被匹配导致 \times 残缺
  const controlCharCmds: Array<[RegExp, string]> = [
    // \t 开头命令（tab U+0009）—— 按命令长度降序
    [/\x09theta(?![a-zA-Z])/g, "\\theta"],
    [/\x09times(?![a-zA-Z])/g, "\\times"],       // 原来缺失！
    [/\x09textbf(?![a-zA-Z])/g, "\\textbf"],
    [/\x09textit(?![a-zA-Z])/g, "\\textit"],
    [/\x09textrm(?![a-zA-Z])/g, "\\textrm"],
    [/\x09texttt(?![a-zA-Z])/g, "\\texttt"],
    [/\x09tfrac(?![a-zA-Z])/g, "\\tfrac"],
    [/\x09text(?![a-zA-Z])/g, "\\text"],
    [/\x09tan(?![a-zA-Z])/g, "\\tan"],
    [/\x09tau(?![a-zA-Z])/g, "\\tau"],
    [/\x09top(?![a-zA-Z])/g, "\\top"],
    [/\x09to(?![a-zA-Z])/g, "\\to"],
    // \n 开头命令（newline U+000A）—— 按命令长度降序
    [/\x0anonumber(?![a-zA-Z])/g, "\\nonumber"],
    [/\x0anewline(?![a-zA-Z])/g, "\\newline"],
    [/\x0anoindent(?![a-zA-Z])/g, "\\noindent"],
    [/\x0anormalsize(?![a-zA-Z])/g, "\\normalsize"],
    [/\x0anwarrow(?![a-zA-Z])/g, "\\nwarrow"],
    [/\x0anearrow(?![a-zA-Z])/g, "\\nearrow"],
    [/\x0anolimits(?![a-zA-Z])/g, "\\nolimits"],
    [/\x0anabla(?![a-zA-Z])/g, "\\nabla"],
    [/\x0aneq(?![a-zA-Z])/g, "\\neq"],
    [/\x0anot(?![a-zA-Z])/g, "\\not"],
    [/\x0aneg(?![a-zA-Z])/g, "\\neg"],
    [/\x0anu(?![a-zA-Z])/g, "\\nu"],
    [/\x0ani(?![a-zA-Z])/g, "\\ni"],
    // \r 开头命令（carriage return U+000D）
    [/\x0drangle(?![a-zA-Z])/g, "\\rangle"],
    [/\x0drfloor(?![a-zA-Z])/g, "\\rfloor"],
    [/\x0dright(?![a-zA-Z])/g, "\\right"],
    [/\x0drceil(?![a-zA-Z])/g, "\\rceil"],
    [/\x0droot(?![a-zA-Z])/g, "\\root"],
    [/\x0drho(?![a-zA-Z])/g, "\\rho"],
    // \b 开头命令（backspace U+0008）
    [/\x08boldsymbol(?![a-zA-Z])/g, "\\boldsymbol"],
    [/\x08binom(?![a-zA-Z])/g, "\\binom"],
    [/\x08beta(?![a-zA-Z])/g, "\\beta"],
    [/\x08bigl(?![a-zA-Z])/g, "\\bigl"],
    [/\x08bigr(?![a-zA-Z])/g, "\\bigr"],
    [/\x08bigg(?![a-zA-Z])/g, "\\bigg"],
    [/\x08big(?![a-zA-Z])/g, "\\big"],
    [/\x08bar(?![a-zA-Z])/g, "\\bar"],
    [/\x08bf(?![a-zA-Z])/g, "\\bf"],
    // \f 开头命令（form feed U+000C）
    [/\x0cforall(?![a-zA-Z])/g, "\\forall"],
    [/\x0cfrac(?![a-zA-Z])/g, "\\frac"],
    [/\x0cfont(?![a-zA-Z])/g, "\\font"],
  ];
  for (const [re, replacement] of controlCharCmds) {
    result = result.replace(re, replacement);
  }

  // 矩阵/行列式 Unicode 括号成对转换
  // AI OCR 经常输出 ⎛⎝1 0 1; 2 a 0; 1 1 -1⎞⎠ 这种 Unicode 矩阵括号
  // 转成标准 LaTeX \begin{pmatrix}...\end{pmatrix}
  // 括号类型：
  //   ⎛⎝...⎞⎠ / (... ) → pmatrix
  //   ⎡⎣...⎤⎦ / [...] → bmatrix
  //   ⎧⎩...⎫⎭ / {...} → Bmatrix
  //   ⎢⎥...⎥⎥ (单竖线) → vmatrix（行列式）
  //   ‖...‖ → Vmatrix（范数）
  // 分隔符：行间用 ; 或 ;; 或换行，列间用空格或 &
  result = convertUnicodeMatrixBrackets(result);

  // 还原代码块
  for (let i = 0; i < codeBlocks.length; i++) {
    result = result.replace(`\u0000CB${i}\u0000`, codeBlocks[i]);
  }

  return result;
}

// 将 Unicode 矩阵括号转换为 LaTeX \begin{env}...\end{env}
// 支持的括号对（可成对出现，也可单个）：
//   ⎛ U+239B  ⎞ U+239E  ⎝ U+239D  ⎠ U+239A  → pmatrix
//   ⎡ U+23A1  ⎤ U+23A4  ⎢ U+23A2  ⎥ U+23A5  ⎣ U+23A3  ⎦ U+23A6 → bmatrix
//   ⎧ U+23A7  ⎫ U+23AD  ⎨ U+23A8  ⎬ U+23AC  ⎩ U+23A9  ⎭ U+23AB → Bmatrix
//   | ... | (ASCII 单竖线) → vmatrix（仅当内部含 ; 或 ;; 或 & 时识别为矩阵）
function convertUnicodeMatrixBrackets(text: string): string {
  if (!text) return text;

  // 成对括号：⎛...⎞ + ⎝...⎠ 或合并 ⎛⎝...⎞⎠
  // 用 [sS] 非贪婪匹配括号内内容
  const pairs: Array<[RegExp, string]> = [
    // pmatrix: ⎛⎝ ... ⎞⎠ 或 ⎛ ... ⎞ （允许成对或单层）
    [/⎛\s*⎝([\s\S]*?)⎞\s*⎠/g, "\\begin{pmatrix}$1\\end{pmatrix}"],
    [/⎛([\s\S]*?)⎞/g, "\\begin{pmatrix}$1\\end{pmatrix}"],
    [/⎝([\s\S]*?)⎠/g, "\\begin{pmatrix}$1\\end{pmatrix}"],
    // bmatrix: ⎡⎣ ... ⎤⎦
    [/⎡\s*⎣([\s\S]*?)⎤\s*⎦/g, "\\begin{bmatrix}$1\\end{bmatrix}"],
    [/⎡([\s\S]*?)⎤/g, "\\begin{bmatrix}$1\\end{bmatrix}"],
    [/⎣([\s\S]*?)⎦/g, "\\begin{bmatrix}$1\\end{bmatrix}"],
    // Bmatrix: ⎧⎩ ... ⎫⎭
    [/⎧\s*⎩([\s\S]*?)⎫\s*⎭/g, "\\begin{Bmatrix}$1\\end{Bmatrix}"],
    [/⎧([\s\S]*?)⎫/g, "\\begin{Bmatrix}$1\\end{Bmatrix}"],
    [/⎩([\s\S]*?)⎭/g, "\\begin{Bmatrix}$1\\end{Bmatrix}"],
  ];
  for (const [re, replacement] of pairs) {
    text = text.replace(re, replacement);
  }

  // 规范化矩阵内容分隔符：
  //   行分隔：; 或 ;; 或换行 → \\
  //   列分隔：单空格或逗号 → &（矩阵元素必须用 & 分隔，每行内处理）
  text = text.replace(/(\\begin\{(?:p|b|B|v|V)matrix\})([\s\S]*?)(\\end\{(?:p|b|B|v|V)matrix\})/g,
    (full, begin, body, end) => {
      let b = body;
      // 行分隔：;; ; 换行（含多个换行）统一为 " \\ "
      b = b.replace(/\s*;;\s*/g, " \\\\ ");
      b = b.replace(/\s*;\s*/g, " \\\\ ");
      b = b.replace(/\s*\n\s*/g, " \\\\ ");
      // 按 \\ 切分每一行，每行内独立处理列分隔
      const rows = b.split(/\s*\\\\\s*/).filter((r: string) => r.trim().length > 0);
      const normalizedRows = rows.map((row: string) => {
        let r = row.trim();
        // 若行内已有 &，保留不动
        if (r.includes("&")) return r;
        // 逗号转 &
        r = r.replace(/,\s*/g, " & ");
        // 单空格（两个非空 token 之间）转 &，但避免破坏 $...$ 内部的空格
        // 简化处理：把两个非空白字符之间的单空格转成 &
        r = r.replace(/(\S)\s+(?=\S)/g, "$1 & ");
        // 合并多余空格
        r = r.replace(/\s+/g, " ").trim();
        return r;
      });
      b = normalizedRows.join(" \\\\ ");
      return begin + " " + b + " " + end;
    }
  );

  return text;
}

export function sanitizeLatex(text: string) {
  if (!text) return text;

  // 0. 先转换 Unicode 数学符号 → LaTeX 命令（新增）
  text = replaceUnicodeMath(text);

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

  // 2. Merge adjacent inline blocks: $ $ → space
  //    只处理 $ + 至少1个空格 + $ 的情况，不处理 $$（display math 定界符）
  //    避免 $$x^2$$ 被破坏
  text = text.replace(/\$\s+\$/g, " ");

  // 3. Merge single-command blocks into following text:
  //    $\ln$ y → $\ln y$  |  $\cdot$ ( → $\cdot ($
  text = text.replace(/\$(\\[a-zA-Z]+)\$\s+([a-zA-Z0-9(])/g, (_, cmd, next) => `$${cmd} ${next}$`);
  //    x =$ $\frac → x = $\frac  (merge text before $cmd$ into block)
  text = text.replace(/([a-zA-Z0-9)])\s+\$(\\[a-zA-Z]+)\$/g, (_, prev, cmd) => `$${prev} ${cmd}$`);

  // 4. Remove empty math blocks (4+ consecutive $ only)
  //    不删除 $$ —— 它是 display math 定界符 $$...$$
  text = text.replace(/\${4,}/g, "");

  // 5. Fix leading/trailing space inside $...$ blocks
  //    只处理 $ + 空格（单个$），不处理 $$ + 空格（display math）
  text = text.replace(/(?<!\$)\$\s+/g, "$");
  text = text.replace(/\s+\$(?!\$)/g, "$");

  // 6. det / \det → 行列式值形式 |A|
  //    det(A) → |A|, \det A → |A|, $\det(A)$ → |A|（去 $ 包裹，|A| 为纯文本）
  //    顺序：先处理带 $ 包裹的整个 math block，再处理块内/纯文本
  //    $\det(X)$ → |X|
  text = text.replace(/\$\\det\s*\(\s*([^)]+?)\s*\)\$/g, "|$1|");
  //    $\det X$ → |X|（单个大写字母变量）
  text = text.replace(/\$\\det\s+([A-Z])\$/g, "|$1|");
  //    \det(X) → |X|（LaTeX 命令，数学块内）
  text = text.replace(/\\det\s*\(\s*([^)]+?)\s*\)/g, "|$1|");
  //    \det X → |X|（LaTeX 命令，单个大写字母）
  text = text.replace(/\\det\s+([A-Z])(?![a-zA-Z0-9])/g, "|$1|");
  //    det(X) → |X|（纯文本 det，\b 边界避免误匹配 determinant）
  text = text.replace(/\bdet\s*\(\s*([^)]+?)\s*\)/g, "|$1|");
  //    det X → |X|（纯文本，单个大写字母变量）
  text = text.replace(/\bdet\s+([A-Z])(?![a-zA-Z0-9])/g, "|$1|");

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
// line that starts with { or the last {"<knownKey>" occurrence)
function stripThinkingBeforeJson(text: string): string {
  // Strategy 1+2: try multiple known first-key markers — whichever appears LAST wins.
  // 第一步输出首字段是 ocrText，第二步是 correctAnswer，都要覆盖。
  const markers = [
    '{"ocrText"',
    '{ "ocrText"',
    '{"correctAnswer"',
    '{ "correctAnswer"',
  ];
  let bestIdx = -1;
  for (const m of markers) {
    const idx = text.lastIndexOf(m);
    if (idx > bestIdx) bestIdx = idx;
  }
  if (bestIdx >= 0) {
    return text.slice(bestIdx);
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
7. 【关键】JSON 内所有 LaTeX 反斜杠必须写成双反斜杠 \\\\。例如 \\\\frac \\\\lim \\\\tan \\\\theta。
   单反斜杠会被 JSON 解析器当作转义符破坏命令（\\\\f→换页 \\\\t→制表符），导致 \\frac 变 rac、\\tan 变 an。

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
    logAiResp("fixLatexWithAI", ltxModel, raw);
    try {
      // 关键：AI 返回的 JSON 中 \frac \tan \theta 等可能只有单反斜杠，
      // 直接 JSON.parse 会把 \f 当 form feed、\t 当 tab，破坏 LaTeX 命令。
      // 必须先用 fixLatexEscapes 修复反斜杠，再解析。
      const safeRaw = fixLatexEscapes(raw);
      const fixed = JSON.parse(safeRaw);
      const result: Record<string, string> = {};
      for (const key of Object.keys(texts)) {
        result[key] = typeof fixed[key] === "string" ? fixed[key] : texts[key];
      }
      return result;
    } catch {
      // 解析失败，尝试从 raw 中逐字段正则提取（兜底）
      try {
        const result: Record<string, string> = {};
        for (const key of Object.keys(texts)) {
          const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "s");
          const m = raw.match(re);
          if (m?.[1]) {
            try {
              result[key] = JSON.parse(`"${m[1]}"`);
            } catch {
              result[key] = m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
            }
          } else {
            result[key] = texts[key];
          }
        }
        return result;
      } catch {
        return texts;
      }
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
  // 跳过含代码块/表格的 ocrText — 结构化图片描述不应被 LaTeX fixer AI 修改或破坏
  if (result.ocrText && !result.ocrText.includes("```") && !result.ocrText.includes("|---|")) {
    fields["ocrText"] = result.ocrText;
  }
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
  const timeout = setTimeout(() => controller.abort(), 300000);

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

// ===========================================================================
// Two-step split (new pipeline, replaces realAnalyze for first analysis)
//
// 第一步：视觉模型 + 图片 → OCR + 分类（输出 {ocrText, questionType, classification}）
// 第二步：文本模型 + 纯文本 OCR（不传图）→ 推导答案 + 解析（输出 {correctAnswer, explanation, solutions}）
//
// 拆分动机：agnes-2.0-flash 是思考型模型，单次任务过重时思考会外溢污染 JSON。
// 重解析效果好就是因为 prompt 短、字段少；首次解析失败是因为一次要做 7 字段+分类+200字解析。
// 拆成两步后，每步的 prompt 都短、字段都少，思考外溢概率大幅下降。
// 第二步用纯文本模型还能彻底消除"看图猜答案"——模型根本看不到图片，无法被手写笔迹误导。
// ===========================================================================

interface OcrClassifyResult {
  ocrText: string;
  questionType: AiAnalysisResult["questionType"];
  classification: { subject: string; chapter: string; knowledgePoint: string };
}

async function buildOcrClassifyPrompt(chapterTree: ChapterRow[], bankName?: string): Promise<string> {
  const l1 = chapterTree.filter(c => c.level === 1);
  const l2 = chapterTree.filter(c => c.level === 2);
  const l3 = chapterTree.filter(c => c.level === 3);

  const lines: string[] = [];
  for (const s of l1) {
    const chs = l2.filter(c => c.parent_id === s.id);
    lines.push(`【${s.name}】`);
    for (const ch of chs) {
      const kps = l3.filter(k => k.parent_id === ch.id).map(k => k.name);
      lines.push(`  ${ch.name}：${kps.join("、")}`);
    }
  }
  const tree = lines.join("\n");

  // 题库名称作为分类辅助依据（题库名称通常反映题目类别，如"数学660题"、"408真题"等）
  const bankHint = bankName
    ? `\n## 题库信息（重要分类依据）\n本题来自题库「${bankName}」。题库名称通常反映题目所属学科类别，请在分类时优先参考：\n- 含"数学/高数/线代/660/880/1000/1800"等 → 大概率为数学二\n- 含"408/计组/数据结构/操作系统/网络/真题"等 → 大概率为408\n- 含"英语/阅读/翻译/完形"等 → 大概率为英语二\n- 含"政治/马原/毛中特/史纲/思修"等 → 大概率为政治\n题库名称仅作辅助参考，最终分类仍以题目内容关键词为准。\n`
    : "";

  return `你是题目OCR识别与分类专家。本轮只需完成两件事：1) 精准 OCR 题干 2) 归类到考研科目。
不要推导答案，不要写解析。

思考过程可以内部进行，但输出的必须是最终 JSON，不要把思考过程写进任何字段。
输出的第一个字符必须是 \`{\`，最后一个字符必须是 \`}\`。
${bankHint}
## 科目体系（必须严格使用以下名称，不得修改、缩写、自创）
${tree}

## 图片关联性判断（OCR 前必须先执行）
1. **首先判断图片是否包含一道完整的题目**：图片中应有清晰的印刷体题干文字（题目描述+可选的选项/条件）
2. **如果图片不包含题目内容**（如纯手写演算、纯答案、空白、无关图片），ocrText 输出"[图片非当前题目，跳过解析]"，classification 各字段留空字符串，questionType 设为 "short_answer"
3. **如果图片包含多道题目**（如截图含上下两题），只识别第一道题（最上方/最上方的完整题目），忽略其余题目。不要把下一题的文字混入当前 ocrText
4. **如果图片主要是下一题的内容**（当前题目文字被截断或不完整，图片主体是下一题），同样输出"[图片非当前题目，跳过解析]"
5. 判断依据：题号是否连贯、题干是否完整、选项是否属于当前题目

## 分类规则（必须严格遵守，违反为严重错误）

### 第一步：确定 subject（科目级，这一步通常可靠）
- 408：题目涉及计算机、数据结构、计组、OS、网络
- 数学二：题目含数学公式、计算、证明
- 英语二：题目为英文阅读/翻译/完形/写作
- 政治：题目为政治理论/时政/哲学/历史

### 第二步：确定 chapter（章节级，最容易出错，必须用关键词判定）
**【数学二 — 必须区分高数 vs 线代，这是最常见的分类错误】**
- chapter="线性代数" 当且仅当题目出现以下任一关键词：
  行列式、矩阵、向量、线性方程组、特征值、特征向量、二次型、秩（rank）、逆矩阵、转置、对角化、正交矩阵、线性相关、线性无关、增广矩阵、伴随矩阵、初等变换、基、维数、子空间、$\\begin{vmatrix}$、$\\begin{bmatrix}$、$A^{T}$、$A^{-1}$、$A^{*}$
- chapter="高等数学" 当且仅当题目出现以下任一关键词：
  极限、导数、微分、积分、级数、多元函数、重积分、微分方程、连续、中值定理、洛必达、泰勒、偏导数、$\\lim$、$\\int$、$\\frac{d}{dx}$、$\\frac{\\partial}{\\partial x}$、$\\sum$
- **常见错误：把线代题分到高数。判定规则：只要题目含矩阵/行列式/向量符号 → 必为"线性代数"，即使题目也含计算**

**【408 — 必须按内容精确分到二级学科】**
- chapter="数据结构"：线性表、栈、队列、树、二叉树、图、查找、排序、哈希、递归、时间复杂度
- chapter="计算机组成原理"：计算机系统、数据表示、运算器、存储器、指令系统、CPU、总线、I/O、浮点数、补码
- chapter="操作系统"：进程、线程、内存管理、文件系统、I/O管理、死锁、调度、分页、分段、虚拟内存
- chapter="计算机网络"：体系结构、物理层、数据链路层、网络层、IP、子网掩码、传输层、TCP、UDP、应用层、HTTP、DNS

### 第三步：确定 knowledgePoint（知识点级，取最接近的）
- 从该 chapter 下的知识点列表中选最匹配的
- 如果不确定，选该 chapter 下第一个知识点，**禁止留空，禁止跨 chapter 选**

### 常见错误示例（禁止再犯）
- ❌ 题目含 $\\begin{vmatrix}$ 行列式 → 分到"高等数学"（正确：线性代数）
- ❌ 题目含矩阵 $A$ 求逆 → 分到"高等数学"（正确：线性代数）
- ❌ 题目含 $\\int$ 积分 → 分到"线性代数"（正确：高等数学）
- ❌ 含 TCP/IP 的题目 → 分到"数据结构"（正确：计算机网络）
- ❌ 含进程/调度的题目 → 分到"计算机组成原理"（正确：操作系统）

## ocrText 规范
- 完整逐字识别题目，只保留印刷体题干正文和选项
- **必须去除题号前缀**：如 '32.'、'33、'、'(1)'、'一、'、'二、' 等一律删掉
- **必须去除真题/来源信息**：如 '【2021统考真题】'、'【2019年408真题】'、'（考研真题）'、'来源：xxx' 等一律删掉
- **必须忽略所有手写笔迹**：手写答案（如红笔写的 A/B/C/D、数字、√、×）、手写演算过程、手写批注一律不识别、不输出
- **区分印刷体 vs 手写体**：只识别印刷体（机器印刷/电子排版）的文字；手写体（含红笔/蓝笔/铅笔的手写字迹）一律忽略
- 选择题选项每行一个：\\nA. xxx\\nB. xxx\\nC. xxx\\nD. xxx
- 行列式/矩阵识别为整体 LaTeX：$\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}$
- **含图的题目（数据结构图/网络拓扑图/AOE图/有向图/无向图/二叉树/哈夫曼树等）必须用结构化文字完整描述图，格式要求如下**：
  - **二叉树/树**：用缩进列表表示层级，每行一个节点，标注左右子节点。示例：
    \\n\`\`\`
    \\n根节点: A
    \\n  左子: B
    \\n    左子: D
    \\n    右子: E
    \\n  右子: C
    \\n    左子: F
    \\n\`\`\`
  - **有向图/无向图/带权图**：用边列表描述，每行一条边，格式"起点 → 终点 (权值)"。无权图省略权值。示例：
    \\n\`\`\`
    \\n边集:
    \\nA → B (3)
    \\nA → C (5)
    \\nB → D (2)
    \\nC → D (1)
    \\n\`\`\`
  - **AOE/AOV网**：分别列出顶点（含事件）和边（含活动+权值）。示例：
    \\n\`\`\`
    \\n顶点: V1(开始), V2, V3, V4, V5(结束)
    \\n边(活动):
    \\nV1→V2 a1=3
    \\nV1→V3 a2=2
    \\nV2→V4 a3=4
    \\nV3→V4 a4=1
    \\nV4→V5 a5=2
    \\n\`\`\`
  - **邻接矩阵**：用 Markdown 表格表示。示例：
    \\n| | A | B | C |
    \\n|---|---|---|---|
    \\n| A | 0 | 1 | 1 |
    \\n| B | 0 | 0 | 1 |
    \\n| C | 0 | 0 | 0 |
  - **散列表/哈希表**：用表格列出槽位和值。示例：
    \\n| 槽位 | 0 | 1 | 2 | 3 | 4 |
    \\n|---|---|---|---|---|---|
    \\n| 值 | 12 | 25 | | 38 | 41 |
  - **网络拓扑/IP分配**：用结构化列表列出节点、接口、IP、子网掩码。示例：
    \\n\`\`\`
    \\n路由器R1:
    \\n  接口E0: 192.168.1.1/24
    \\n  接口S0: 10.0.0.1/30
    \\n路由器R2:
    \\n  接口S0: 10.0.0.2/30
    \\n  接口E0: 192.168.2.1/24
    \\n\`\`\`
  - **其他复杂图**：用 ASCII art 或结构化文字描述，确保节点、连接、权值、方向等关键信息完整
  - 描述必须放在 ocrText 中对应位置（通常在题干文字之后、选项之前），用 \\n\`\`\` 包裹 ASCII/边列表
  - 即使图很复杂也要完整描述，缺失会导致后续无法解题
- JSON 内 LaTeX 反斜杠写成双反斜杠 \\\\frac
- JSON 内换行用 \\n，代码块内的换行也用 \\n
- **ocrText 绝不能为空字符串**：即使题目主要是图，也要输出图的文字描述

输出纯 JSON（不含 markdown 包裹）：
{"ocrText":"题干","questionType":"single_choice","classification":{"subject":"","chapter":"","knowledgePoint":""}}`;
}

// ---------------------------------------------------------------------------
// OCR 文本净化：去除题号前缀、真题标签、残留手写标记
// AI 虽被要求去除这些内容，但实际输出可能仍包含，这里做兜底清理
// ---------------------------------------------------------------------------
export function sanitizeOcrText(text: string): string {
  if (!text) return text;
  let result = text;

  // 1. 去除开头的题号前缀：'32.' '33、' '(1)' '一、' '二、' '第3题' 等
  //    反复去除直到开头不再是题号
  let changed = true;
  while (changed) {
    changed = false;
    // 阿拉伯数字题号：'32.' '32、' '32) ' '32、 '
    const m1 = result.match(/^\s*(\d{1,3})[\.、\)）]\s*/);
    if (m1) { result = result.slice(m1[0].length); changed = true; continue; }
    // 中文数字题号：'一、' '二、' '（一）' '(一)'
    const m2 = result.match(/^\s*[（(]?[一二三四五六七八九十]{1,3}[）)、]\s*/);
    if (m2) { result = result.slice(m2[0].length); changed = true; continue; }
    // '第X题' '第X章'
    const m3 = result.match(/^\s*第[一二三四五六七八九十0-9]+[题章]\s*/);
    if (m3) { result = result.slice(m3[0].length); changed = true; continue; }
    // '(1)' '(2)' 开头
    const m4 = result.match(/^\s*[（(]\d{1,2}[）)]\s*/);
    if (m4) { result = result.slice(m4[0].length); changed = true; continue; }
  }

  // 2. 去除真题/来源标签：【2021统考真题】【2019年408真题】（考研真题）来源：xxx
  result = result.replace(/【[^】]*?(?:真题|统考|考研|来源)[^】]*?】/g, "");
  result = result.replace(/[（(][^）)]*?(?:真题|统考|考研|来源)[^）)]*?[）)]/g, "");
  result = result.replace(/来源[:：]\s*[^\n]*/g, "");

  // 3. 去除残留的手写答案标记（行首或选项后的红笔标记）
  //    如 '答案：A' '我的答案：B' '√' '×' 等（仅清理明显的答案标记行）
  result = result.replace(/^\s*(?:我的)?答案[:：]\s*[A-F√×对错]\s*$/gm, "");

  // 4. 清理首尾多余空白
  result = result.trim();

  return result;
}

async function analyzeOcrAndClassify(
  imageBase64: string,
  mimeType: string,
  chapterTree: ChapterRow[],
  bankName?: string,
): Promise<OcrClassifyResult> {
  const systemPrompt = await buildOcrClassifyPrompt(chapterTree, bankName);
  const apiKey = await loadSetting("vision_key", "DASHSCOPE_API_KEY");
  if (!apiKey) throw new AiApiError("vision_key 未配置，请在设置页面填写", 500);

  const visionModel = await loadSetting("vision_model", "DASHSCOPE_MODEL") || "qwen-vl-plus";
  const visionUrl = await getVisionUrl();
  // 部分视觉模型（如 GLM-4.6V）不支持 system role，会忽略 system message 导致 prompt 丢失
  // 默认允许 system role；用户可在设置中关闭，此时 systemPrompt 会合并到 user message
  const allowSystem = await loadBoolSetting("vision_allow_system", true);
  console.log(`[analyzeOcrAndClassify] 请求 model=${visionModel} url=${visionUrl} imageBytes=${Math.round(imageBase64.length * 0.75)} systemPrompt长度=${systemPrompt.length} allowSystem=${allowSystem}`);
  logAiResp("analyzeOcrAndClassify[REQ]", visionModel, systemPrompt.slice(0, 500), `完整 systemPrompt 长度=${systemPrompt.length} 字符 | allowSystem=${allowSystem}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);

  // 构造 messages：allowSystem=true 时用标准 system+user 结构；
  // allowSystem=false 时把 systemPrompt 合并到 user message 的 text 部分
  const messages = allowSystem
    ? [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            { type: "text", text: "请识别题目文字并归类，返回纯 JSON。" },
          ],
        },
      ]
    : [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            { type: "text", text: `${systemPrompt}\n\n请识别题目文字并归类，返回纯 JSON。` },
          ],
        },
      ];

  try {
    const resp = await fetch(
      visionUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: visionModel,
          max_tokens: 16384,
          response_format: { type: "json_object" },
          temperature: 0,
          messages,
        }),
        signal: controller.signal,
      }
    );

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error(`[analyzeOcrAndClassify] API error status=${resp.status} body=${errText.slice(0, 500)}`);
      throw new AiApiError(`OCR+分类 API error ${resp.status}: ${errText}`, resp.status);
    }

    const data = await resp.json();
    const rawText: string = data.choices?.[0]?.message?.content || "";
    logAiResp("analyzeOcrAndClassify", visionModel, rawText);
    console.log(`[analyzeOcrAndClassify] 响应长度=${rawText.length} 前200字=${rawText.slice(0, 200)}`);
    // AI 返回空响应时直接报错，不用空值假装成功
    if (!rawText || rawText.trim().length === 0) {
      console.error("[analyzeOcrAndClassify] AI 返回空响应，完整响应体:", JSON.stringify(data).slice(0, 500));
      throw new AiApiError("AI 返回空响应（可能被限流或超时）", 503);
    }
    const jsonStr = stripThinkingBeforeJson(rawText);
    const parsed = parseAiJson(jsonStr);
    console.log(`[analyzeOcrAndClassify] 解析成功 questionType=${parsed.questionType} subject=${parsed.classification?.subject} ocrText长度=${(parsed.ocrText || "").length}`);

    // 净化 OCR 文本：去除题号前缀、真题标签、残留手写标记
    let ocrText = (parsed.ocrText || "").replace(/\\n/g, "\n").replace(/\\t/g, " ");

    // 兜底恢复：若 ocrText 为空（含图题目 JSON 解析可能截断 ocrText 字段），
    // 尝试用正则从原始响应中提取 "ocrText":"..." 的值
    if (!ocrText || ocrText.trim().length === 0) {
      const m = rawText.match(/"ocrText"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m && m[1]) {
        ocrText = m[1].replace(/\\n/g, "\n").replace(/\\t/g, " ").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
        console.warn("[analyzeOcrAndClassify] ocrText was empty, recovered via regex extraction:", ocrText.slice(0, 100));
      }
    }

    ocrText = sanitizeOcrText(ocrText);

    return {
      ocrText,
      questionType: parsed.questionType || "single_choice",
      classification: parsed.classification || { subject: "", chapter: "", knowledgePoint: "" },
    };
  } catch (err) {
    if (err instanceof AiApiError || err instanceof AiParseError) throw err;
    if ((err as Error).name === "AbortError") throw new AiTimeoutError("OCR+分类步骤超时");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

const ANSWER_EXPLAIN_PROMPT = `你是考研命题专家。基于已 OCR 的题干文本，推导正确答案并撰写解析。

【重要】最终答案必须基于严格的数学/逻辑推导，禁止凭感觉猜答案。
思考过程可以内部进行，但输出的必须是最终 JSON，不要把思考过程写进任何字段。
输出的第一个字符必须是 \`{\`，最后一个字符必须是 \`}\`。

## 考研数学适配性要求（数学题必须遵守）
- 解法必须符合考研数学大纲范围，禁止使用超纲方法（如数学二不考概率统计、级数等内容）
- 优先使用考研通用教材（同济高数/线代、浙大概率等）中的标准方法和符号体系
- 解题步骤的深度和严谨度应匹配考研要求：关键步骤不可跳过，中间结论需有依据
- 若题目有多种解法，优先给出考研考场最实用的方法（计算量小、不易出错、适用面广）

## 解题技巧性与方法复用性
- explanation 末尾应用一句话点出本题考查的**核心题型**和**通用解题套路**（如"本题属于特征值反求参数，通用方法是利用特征多项式=0列方程"）
- solutions 中的每种解法应标注其适用场景（如"适用于对称矩阵"、"适用于选择题快速排除"）
- 若存在秒杀技巧/特殊值法/排除法等应试技巧，应作为单独解法给出并在 name 中标注"技巧法"
- 解法应注重可迁移性：提炼出可复用到同类题目的关键步骤，而非仅针对本题的特例计算

## 输出字段
- correctAnswer：只给出该题的正确答案
- explanation：100-200 字解析，包含 ①关键知识点 ②分步推导 ③易错点 ④核心题型与通用套路
- solutions：1-2 种解法，每种含 name（含适用场景/技巧标注）/ steps[] / answer

## 数学公式规范
- 必须统一使用 $...$ 作为行内公式分隔符，禁止使用 \\( ... \\) 或 \\[ ... \\]
- 完整公式必须一个 $...$ 块包裹，禁止拆成 $a = $b 形式（$ 必须成对，有开有闭）
- ^{...} 和 _{...} 内部绝对不能有 $ 符号
- 所有 LaTeX 命令必须在 $...$ 内部
- JSON 内 LaTeX 反斜杠写成双反斜杠 \\\\frac
- 行列式和矩阵必须用 \\begin{vmatrix}...\\end{vmatrix} 等整体表示
- 行列式记号 |A| 写成纯文本，不要包进 $...$；只有含 LaTeX 命令的表达式才用 $...$
- 上标下标必须用花括号：x^{2} 而非 x^2，x_{1} 而非 x_1

输出纯 JSON：
{"correctAnswer":"","explanation":"","solutions":[{"name":"","steps":[],"answer":""}],"confidence":0.95}`;

async function analyzeAnswerAndExplain(
  ocrText: string,
  userAnswer?: string,
): Promise<{ correctAnswer: string; explanation: string; solutions: AiAnalysisResult["solutions"]; confidence: number }> {
  const apiKey = await getTextApiKey();
  if (!apiKey) throw new AiApiError("text_key / vision_key 都未配置，请在设置页面填写", 500);

  const model = await loadSetting("text_model", "TEXT_MODEL") || "qwen-plus";
  const apiUrl = await getApiUrl(model, "text_url");
  console.log(`[analyzeAnswerAndExplain] 请求 model=${model} url=${apiUrl} ocrText长度=${ocrText.length}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);

  try {
    const userText = userAnswer
      ? `请基于以下题干文本推导答案。我的答案是「${userAnswer}」（仅供参考，可能错误，请独立推导）。\n\n题干：\n${ocrText}`
      : `请基于以下题干文本推导答案。\n\n题干：\n${ocrText}`;

    const body: any = {
      model,
      max_tokens: 16384,
      temperature: 0,
      messages: [
        { role: "system", content: ANSWER_EXPLAIN_PROMPT },
        { role: "user", content: userText },
      ],
    };
    if (!model.startsWith("deepseek")) body.response_format = { type: "json_object" };

    const resp = await fetch(
      apiUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error(`[analyzeAnswerAndExplain] API error status=${resp.status} body=${errText.slice(0, 500)}`);
      throw new AiApiError(`答案推导 API error ${resp.status}: ${errText}`, resp.status);
    }

    const data = await resp.json();
    const rawText: string = data.choices?.[0]?.message?.content || "";
    const finishReason: string = data.choices?.[0]?.finish_reason || "";
    logAiResp("analyzeAnswerAndExplain", model, rawText, `finish_reason=${finishReason}, usage=${JSON.stringify(data.usage)}`);
    console.log(`[analyzeAnswerAndExplain] 响应长度=${rawText.length} finish=${finishReason} 前200字=${rawText.slice(0, 200)}`);
    if (finishReason === "length") {
      // 思考型模型 reasoning_content 占用 max_tokens 配额，导致 content 被截断
      // 截断的 JSON 无法解析，应明确报错触发重试，而不是保存残缺数据
      console.error(`[analyzeAnswerAndExplain] 输出被 max_tokens 截断(finish_reason=length)，请增大 max_tokens 或换非思考型模型`);
      throw new AiApiError("AI 输出被 max_tokens 截断（思考型模型 reasoning 占用配额），请重试或换模型", 503);
    }
    if (!rawText || rawText.trim().length === 0) {
      console.error("[analyzeAnswerAndExplain] AI 返回空响应，完整响应体:", JSON.stringify(data).slice(0, 500));
      throw new AiApiError("AI 返回空响应（答案推导步骤，可能被限流或超时）", 503);
    }
    // 文本模型通常不思考外溢，但保险起见也 strip 一下
    const jsonStr = stripThinkingBeforeJson(rawText);
    const parsed = parseAiJson(jsonStr);
    console.log(`[analyzeAnswerAndExplain] 解析成功 answer=${parsed.correctAnswer} solutions=${parsed.solutions?.length || 0} explanation长度=${(parsed.explanation || "").length}`);

    return {
      correctAnswer: parsed.correctAnswer || "",
      explanation: parsed.explanation || "",
      solutions: Array.isArray(parsed.solutions) ? parsed.solutions : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.8,
    };
  } catch (err) {
    if (err instanceof AiApiError || err instanceof AiParseError) throw err;
    if ((err as Error).name === "AbortError") throw new AiTimeoutError("答案推导步骤超时");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Two-step orchestrator — replaces realAnalyze for the first-analysis pipeline
// ---------------------------------------------------------------------------

export async function analyzeImageTwoStep(
  imageBase64: string,
  mimeType: string,
  chapterTree: ChapterRow[],
  userAnswer?: string,
  bankName?: string,
): Promise<AiAnalysisResult> {
  if (!await loadSetting("vision_key", "DASHSCOPE_API_KEY") && !await loadSetting("text_key", "DEEPSEEK_API_KEY")) {
    throw new AiApiError("API key 未配置，请在设置页面填写", 500);
  }

  // Step 1: OCR + classify (vision model + image)
  // 第一步失败 = 整体失败（OCR 是后续所有步骤的前提，没有 OCR 无法解题）
  console.log("[analyzeImageTwoStep] Step 1: OCR + classify");
  const ocrResult = await analyzeOcrAndClassify(imageBase64, mimeType, chapterTree, bankName);

  // Step 2: Answer + explain (text model, NO image — eliminates "看图猜答案")
  // 第二步失败 = 只丢答案/解析，OCR 和分类仍可用，标记 error_reason 供前端触发重解析
  console.log("[analyzeImageTwoStep] Step 2: Answer + explain (text-only)");
  let answerResult: { correctAnswer: string; explanation: string; solutions: AiAnalysisResult["solutions"]; confidence: number };
  let step2Error: string | null = null;
  try {
    answerResult = await analyzeAnswerAndExplain(ocrResult.ocrText, userAnswer);
  } catch (err) {
    console.warn("[analyzeImageTwoStep] Step 2 failed, saving OCR only:", err);
    answerResult = { correctAnswer: "", explanation: "", solutions: [], confidence: 0 };
    step2Error = err instanceof Error ? err.message : "答案推导步骤失败";
  }

  // Combine into AiAnalysisResult
  const result: AiAnalysisResult = {
    ocrText: ocrResult.ocrText,
    questionType: ocrResult.questionType,
    classification: ocrResult.classification,
    correctAnswer: answerResult.correctAnswer,
    explanation: answerResult.explanation,
    solutions: answerResult.solutions,
    confidence: answerResult.confidence,
    error_reason: step2Error || undefined,
  };

  const apiKey = await loadSetting("vision_key", "DASHSCOPE_API_KEY") || await loadSetting("text_key", "DEEPSEEK_API_KEY");

  // Layer 1+3: auto-wrap bare LaTeX, then sanitize
  result.ocrText = sanitizeLatex(autoWrapMathDelimiters(result.ocrText));
  result.correctAnswer = sanitizeLatex(autoWrapMathDelimiters(result.correctAnswer));
  result.explanation = sanitizeLatex(autoWrapMathDelimiters(result.explanation));
  if (result.solutions) for (const sol of result.solutions) {
    sol.name = sanitizeLatex(autoWrapMathDelimiters(sol.name || ""));
    if (sol.steps) sol.steps = sol.steps.map(s => sanitizeLatex(autoWrapMathDelimiters(s)));
    sol.answer = sanitizeLatex(autoWrapMathDelimiters(sol.answer || ""));
  }

  // Layer 2: AI LaTeX fixer (best-effort)
  try {
    await applyLatexFixer(result, apiKey);
    // Final sanitize after AI fixer
    result.ocrText = sanitizeLatex(result.ocrText);
    result.correctAnswer = sanitizeLatex(result.correctAnswer);
    result.explanation = sanitizeLatex(result.explanation);
    if (result.solutions) for (const sol of result.solutions) {
      sol.name = sanitizeLatex(sol.name || "");
      if (sol.steps) sol.steps = sol.steps.map(sanitizeLatex);
      sol.answer = sanitizeLatex(sol.answer || "");
    }
  } catch (err) {
    console.warn("[analyzeImageTwoStep] LaTeX fixer failed, keeping raw:", err);
  }

  // AI dedup (best-effort)
  try {
    await dedupResult(result, apiKey);
  } catch (err) {
    console.warn("[analyzeImageTwoStep] dedup failed, keeping raw:", err);
  }

  // 答案一致性校验：若 correctAnswer 与 explanation/solutions 不一致，以解析为准修正
  try {
    await reconcileAnswerWithAI(result, apiKey);
  } catch (err) {
    console.warn("[analyzeImageTwoStep] answer reconciliation failed:", err);
  }

  // Strip question numbers from OCR text (e.g. "32. ", "【2021统考真题】")
  if (result.ocrText) {
    result.ocrText = result.ocrText
      .replace(/^\d+\s*[\.\、\s]\s*/, "")
      .replace(/^【[^】]*】\s*/, "")
      .replace(/^\[[^\]]*\]\s*/, "")
      .trim();
  }

  return result;
}
