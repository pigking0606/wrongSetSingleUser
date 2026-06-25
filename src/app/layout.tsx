"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import "./globals.css";
import "katex/dist/katex.min.css";
import { IconSettings } from "@/lib/icons";
import { useGlobalTimer } from "@/lib/study-timer";

const THEMES = [
  { key: "", label: "☀" },
  { key: "theme-dark", label: "☽" },
  { key: "theme-eye", label: "◉" },
];

const themeScript = `
(function() {
  var t = localStorage.getItem("theme") || "";
  document.documentElement.className = "h-full antialiased " + t;
})()
`.replace(/\n/g, "");

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState("");
  const timer = useGlobalTimer();

  useEffect(() => {
    setTheme(localStorage.getItem("theme") || "");
    // Auto-update check: polls /api/version every 30s, prompts reload on new deploy
    let currentVersion = 0;
    const check = async () => {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const { v } = await r.json();
        if (!currentVersion) currentVersion = v;
        else if (v !== currentVersion && confirm("有新版本，是否立即更新？")) location.reload();
      } catch { /* ignore */ }
    };
    check();
    const timer = setInterval(check, 30000);
    return () => clearInterval(timer);
  }, []);

  const switchTheme = (key: string) => {
    setTheme(key);
    localStorage.setItem("theme", key);
    document.documentElement.className = "h-full antialiased " + key;
  };

  return (
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">
        <header className="border-b" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
          <div className="max-w-2xl mx-auto px-6 py-3 flex items-center justify-between">
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <Link href="/" className="font-semibold text-sm tracking-wide no-underline" style={{ color: "var(--text)" }}>
                错题复习
              </Link>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
              {timer.running && (
                <span style={{ fontSize: ".75rem", fontVariantNumeric: "tabular-nums", fontFamily: "monospace", color: "var(--green-text)", fontWeight: 600 }}>
                  {String(Math.floor(timer.elapsed / 60)).padStart(2, "0")}:{String(timer.elapsed % 60).padStart(2, "0")}
                </span>
              )}
              {timer.paused && (
                <span style={{ fontSize: ".75rem", fontVariantNumeric: "tabular-nums", fontFamily: "monospace", color: "var(--text-muted)" }}>
                  暂停 {String(Math.floor(timer.elapsed / 60)).padStart(2, "0")}:{String(timer.elapsed % 60).padStart(2, "0")}
                </span>
              )}
              <a href="/settings" title="设置" style={{ color: "var(--text-muted)", textDecoration: "none", display: "flex" }}><IconSettings size={18} /></a>
              <div className="theme-toggle">
              {THEMES.map(t => (
                <button
                  key={t.key}
                  className={theme === t.key ? "active" : ""}
                  onClick={() => switchTheme(t.key)}
                  title={t.key === "" ? "日间" : t.key === "theme-dark" ? "夜间" : "护眼"}
                >
                  {t.label}
                </button>
              ))}
            </div>
            </div>
          </div>
        </header>
        <main className="max-w-2xl mx-auto p-6">{children}</main>
      </body>
    </html>
  );
}
