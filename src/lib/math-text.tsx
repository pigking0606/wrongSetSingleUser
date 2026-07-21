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

function tokenize(text: string): Array<{ type: "block" | "inline" | "auto" | "text"; value: string }> {
  // Strip orphan $ signs (unmatched singles) before processing
  text = removeOrphanDollars(text);

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
// MathText — parent component
// ---------------------------------------------------------------------------

export default memo(function MathText({ text, className, block, splitOptions }: MathTextProps) {
  const processed = splitOptions ? applySplitOptions(text) : text;
  const src = block ? (processed.startsWith("$$") ? processed : `$$${processed}$$`) : processed;
  const tokens = tokenize(src);

  return (
    <span className={className}>
      {tokens.map((t, i) => {
        if (t.type === "block") return <MathAtom key={i} math={t.value} block />;
        if (t.type === "inline" || t.type === "auto") return <MathAtom key={i} math={t.value} />;
        return <TextAtom key={i} text={t.value} />;
      })}
    </span>
  );
});
