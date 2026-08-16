"use client";

import { memo, useEffect, useRef } from "react";
import katex from "katex";

interface MathTextProps {
  text: string;
  className?: string;
  block?: boolean;
  splitOptions?: boolean;  // 选择题选项自动每行一个
}

// ---------------------------------------------------------------------------
// MathAtom — renders one LaTeX segment via ref + KaTeX, zero React children
// ---------------------------------------------------------------------------

const MathAtom = memo(function MathAtom({ math, block }: { math: string; block?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = ""; // katex.render appends — clear first
    try {
      katex.render(math, el, { throwOnError: false, displayMode: !!block });
    } catch {
      el.textContent = math;
    }
  }, [math, block]);

  return <span ref={ref} className={block ? "block my-2 text-center" : ""} />;
});

// ---------------------------------------------------------------------------
// TextAtom — plain text, memoised
// ---------------------------------------------------------------------------

const TextAtom = memo(function TextAtom({ text }: { text: string }) {
  return <>{text}</>;
});

// ---------------------------------------------------------------------------
// Split helpers
// ---------------------------------------------------------------------------

const LATEX_CMD = /\\(?:frac|lim|sum|int|prod|sqrt|sin|cos|tan|log|ln|to|infty|partial|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|omega|phi|rho|tau|cdot|cdots|ldots|times|div|pm|mp|geq|leq|neq|approx|equiv|sim|propto|Rightarrow|Leftrightarrow|rightarrow|leftarrow|forall|exists|in|notin|subset|supset|cup|cap|emptyset|nabla|int|oint|bigcup|bigcap|begin|end|left|right|langle|rangle|mathbf|mathrm|mathcal|mathbb|boldsymbol|underline|overline|hat|tilde|vec|dot|ddot|widehat|widetilde|bar|displaystyle|textstyle|dfrac|tfrac|cfrac|xrightarrow|xleftarrow|choose|binom|dbinom|tbinom|brace|brack|vmatrix|bmatrix|pmatrix|Vmatrix|Bmatrix|matrix|array|cases|aligned|gathered|split|smallmatrix)\b/;

function looksLikeMath(text: string): boolean {
  if (/[一-鿿]/.test(text)) return false;
  return LATEX_CMD.test(text);
}

const BLOCK_RE = /(\$\$[\s\S]+?\$\$)/g;
const INLINE_RE = /(\$[^$]+\$)/g;

function removeOrphanDollars(text: string): string {
  // Scan left-to-right, tracking $-state and pairing $ signs.
  // Remove any $ that cannot be paired with another $.
  const chars = [...text];
  const remove = new Set<number>();
  let i = 0;
  while (i < chars.length) {
    if (chars[i] === "$" && chars[i + 1] === "$") {
      // Display math opener: find closing $
      let j = i + 2;
      while (j < chars.length - 1 && !(chars[j] === "$" && chars[j + 1] === "$")) j++;
      if (j < chars.length - 1) {
        // Paired $...$
        i = j + 2;
      } else {
        // Unclosed $ — remove both
        remove.add(i); remove.add(i + 1);
        i += 2;
      }
    } else if (chars[i] === "$") {
      // Inline math opener: find next $
      let j = i + 1;
      while (j < chars.length && chars[j] !== "$") j++;
      if (j < chars.length) {
        // Paired $...$
        i = j + 1;
      } else {
        // Unpaired $ — remove it
        remove.add(i);
        i++;
      }
    } else {
      i++;
    }
  }
  if (remove.size === 0) return text;
  return chars.filter((_, idx) => !remove.has(idx)).join("");
}

// 归一化 AI 输出的 $$ 误用（兼容历史已存数据）：
//   $$x_{1}$$ → $x_{1}$；$A$$^{2}$ → $A^{2}$；$A$$B$ → $A B$
// 与服务端 sanitizeLatex 的处理规则保持一致
function normalizeDollarMisuse(text: string): string {
  // $$...$$ → $...$（短单行、不含环境/换行/对齐符；真正块级公式保持不变）
  text = text.replace(/\$\$([^$\n&]+)\$\$/g, (full, body: string) => {
    const b = body.trim();
    if (!b || b.includes("\\begin") || b.includes("\\end") || b.includes("\\\\") || b.length > 60) return full;
    return "$" + b + "$";
  });
  // 合并相邻数学块：$A$$^{...}$ / $A$$_{...}$ → 单个行内块
  text = text.replace(/\$([^$]+)\$\$(\^|\_)\{([^}]*)\}\$/g, (_, a, op, b) => `$${a}${op}{${b}}$`);
  // 一般相邻：$A$$B$ → $A B$
  text = text.replace(/\$([^$]+)\$\$([^$]+)\$/g, (full, a, b) => {
    if (b.includes("\\begin") || b.includes("\\end") || b.includes("\\\\") || b.length > 60) return full;
    return `$${a} ${b}$`;
  });
  return text;
}

function tokenize(text: string): Array<{ type: "block" | "inline" | "auto" | "text"; value: string }> {
  // Strip orphan $ signs (unmatched singles) before processing
  text = removeOrphanDollars(text);
  // 归一化 $$ 误用，避免把 x_{1} 与上标 2 分开渲染
  text = normalizeDollarMisuse(text);

  const tokens: Array<{ type: "block" | "inline" | "auto" | "text"; value: string }> = [];
  const parts = text.split(BLOCK_RE);

  for (const part of parts) {
    if (part.startsWith("$$") && part.endsWith("$$")) {
      tokens.push({ type: "block", value: part.slice(2, -2).trim() });
    } else {
      const inlineParts = part.split(INLINE_RE);
      for (const ip of inlineParts) {
        if (ip.startsWith("$") && ip.endsWith("$") && ip.length > 2) {
          tokens.push({ type: "inline", value: ip.slice(1, -1) });
        } else if (looksLikeMath(ip)) {
          tokens.push({ type: "auto", value: ip });
        } else if (ip.length > 0) {
          tokens.push({ type: "text", value: ip });
        }
      }
    }
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// 选择题选项自动换行：在 A./B./C./D./E./F. 等选项标识符前插入 \n
// 仅当检测到至少 3 个不同字母（A-F）的选项标识符时才处理，避免误伤"图 A. xxx"
// ---------------------------------------------------------------------------

function applySplitOptions(text: string): string {
  if (!text) return text;
  const re = /([A-F])[\.、）)]/g;
  const matches = [...text.matchAll(re)];
  if (matches.length < 3) return text;
  const letters = new Set(matches.map(m => m[1]));
  if (letters.size < 3) return text;
  // 把选项标识符前的空白替换为单个换行；前面是非空白字符则插入换行
  let result = text.replace(/\s+([A-F][\.、）)])/g, "\n$1");
  result = result.replace(/([^\n\s])([A-F][\.、）)])/g, "$1\n$2");
  // 标准化选项标识符后的空白为单空格
  result = result.replace(/([A-F][\.、）)])\s+/g, "$1 ");
  return result;
}

// ---------------------------------------------------------------------------
// CodeBlock — 渲染 ```代码块```，等宽字体 + 保留换行
// ---------------------------------------------------------------------------

const CodeBlock = memo(function CodeBlock({ code }: { code: string }) {
  return (
    <pre style={{
      fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
      fontSize: ".85rem",
      lineHeight: 1.5,
      whiteSpace: "pre-wrap",
      wordBreak: "break-all",
      background: "var(--bg-hover, #f5f5f5)",
      padding: ".6rem .75rem",
      borderRadius: "6px",
      margin: ".5rem 0",
      overflowX: "auto",
    }}>
      {code}
    </pre>
  );
});

// ---------------------------------------------------------------------------
// MarkdownTable — 渲染 | col1 | col2 | 格式的表格
// ---------------------------------------------------------------------------

const MarkdownTable = memo(function MarkdownTable({ rows }: { rows: string[][] }) {
  if (rows.length < 2) return null;
  // 第一行是表头，第二行是分隔符(|---|---|)，第三行起是数据
  const header = rows[0];
  const body = rows.slice(2); // 跳过分隔行

  const cellStyle: React.CSSProperties = {
    padding: ".3rem .5rem",
    border: "1px solid var(--border, #ddd)",
    textAlign: "center",
    fontSize: ".85rem",
  };
  const thStyle: React.CSSProperties = {
    ...cellStyle,
    fontWeight: 600,
    background: "var(--bg-hover, #f5f5f5)",
  };

  return (
    <table style={{
      borderCollapse: "collapse",
      margin: ".5rem 0",
      fontSize: ".85rem",
    }}>
      <thead>
        <tr>{header.map((h, i) => <th key={i} style={thStyle}>{h.trim()}</th>)}</tr>
      </thead>
      <tbody>
        {body.map((row, ri) => (
          <tr key={ri}>
            {row.map((c, ci) => <td key={ci} style={cellStyle}>{c.trim()}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
});

// ---------------------------------------------------------------------------
// 预分割：提取代码块(```...```) 和 Markdown 表格(| ... |)
// 这些结构需要保留原始格式，不能被 LaTeX 分词破坏
// ---------------------------------------------------------------------------

interface PreSegment {
  type: "code" | "table" | "normal";
  value: string;
}

function extractCodeAndTables(text: string): PreSegment[] {
  const segments: PreSegment[] = [];
  // 匹配 ```代码块```（含语言标识可选）
  const codeBlockRe = /```[a-zA-Z]*\n?([\s\S]*?)```/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = codeBlockRe.exec(text)) !== null) {
    // 代码块前的普通文本
    if (m.index > lastIdx) {
      const before = text.slice(lastIdx, m.index);
      if (before) segments.push(...splitTables(before));
    }
    // 代码块内容（去掉末尾换行）
    const code = m[1].replace(/\n$/, "");
    segments.push({ type: "code", value: code });
    lastIdx = m.index + m[0].length;
  }
  // 剩余普通文本
  if (lastIdx < text.length) {
    const rest = text.slice(lastIdx);
    if (rest) segments.push(...splitTables(rest));
  }
  return segments;
}

// 从普通文本中分离 Markdown 表格（连续的 | 开头行，至少2行含|）
function splitTables(text: string): PreSegment[] {
  const segments: PreSegment[] = [];
  const lines = text.split("\n");
  let buffer: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const isTableRow = line.trim().startsWith("|") && line.trim().endsWith("|") && line.includes("-");
    const nextIsTableRow = i + 1 < lines.length && lines[i + 1].trim().startsWith("|");

    // 表格判定：当前行以|开头且含-（表头），下一行也以|开头（数据行）
    // 或当前行以|开头且上一行是分隔符
    if (line.trim().startsWith("|") && (line.includes("-") || nextIsTableRow)) {
      // 收集连续的表格行
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      // 先 flush buffer
      if (buffer.length > 0) {
        segments.push({ type: "normal", value: buffer.join("\n") });
        buffer = [];
      }
      // 解析表格行为二维数组
      const rows = tableLines.map(l =>
        l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim())
      );
      // 至少3行（表头+分隔+1数据）才算表格
      if (rows.length >= 3) {
        segments.push({ type: "table", value: JSON.stringify(rows) });
      } else {
        // 不够格，当普通文本
        segments.push({ type: "normal", value: tableLines.join("\n") });
      }
    } else {
      buffer.push(line);
      i++;
    }
  }
  if (buffer.length > 0) {
    segments.push({ type: "normal", value: buffer.join("\n") });
  }
  return segments;
}

// ---------------------------------------------------------------------------
// MathText — parent component
// ---------------------------------------------------------------------------

export default memo(function MathText({ text, className, block, splitOptions }: MathTextProps) {
  const processed = splitOptions ? applySplitOptions(text) : text;
  const src = block ? (processed.startsWith("$$") ? processed : `$$${processed}$$`) : processed;

  // 先提取代码块和表格，剩余文本走原有 LaTeX 分词逻辑
  const segments = extractCodeAndTables(src);

  return (
    <span className={className}>
      {segments.map((seg, si) => {
        if (seg.type === "code") {
          return <CodeBlock key={si} code={seg.value} />;
        }
        if (seg.type === "table") {
          try {
            const rows = JSON.parse(seg.value) as string[][];
            return <MarkdownTable key={si} rows={rows} />;
          } catch {
            return <TextAtom key={si} text={seg.value} />;
          }
        }
        // normal：走原有 LaTeX 分词
        const tokens = tokenize(seg.value);
        return (
          <span key={si}>
            {tokens.map((t, i) => {
              if (t.type === "block") return <MathAtom key={i} math={t.value} block />;
              if (t.type === "inline" || t.type === "auto") return <MathAtom key={i} math={t.value} />;
              return <TextAtom key={i} text={t.value} />;
            })}
          </span>
        );
      })}
    </span>
  );
});
