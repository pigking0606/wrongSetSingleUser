"use client";

import { memo, useEffect, useRef } from "react";
import katex from "katex";

interface MathTextProps {
  text: string;
  className?: string;
  block?: boolean;
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

function tokenize(text: string): Array<{ type: "block" | "inline" | "auto" | "text"; value: string }> {
  // Strip orphan $ signs (unmatched singles) before processing
  const dollarCount = (text.match(/\$/g) || []).length;
  if (dollarCount % 2 !== 0) {
    // Remove lone $ signs — they're almost certainly AI formatting errors
    // Find $ not adjacent to another $ and remove the last one
    const idx = text.lastIndexOf("$");
    if (idx >= 0) {
      text = text.slice(0, idx) + text.slice(idx + 1);
    }
  }

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
// MathText — parent component
// ---------------------------------------------------------------------------

export default memo(function MathText({ text, className, block }: MathTextProps) {
  const src = block ? (text.startsWith("$$") ? text : `$$${text}$$`) : text;
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
