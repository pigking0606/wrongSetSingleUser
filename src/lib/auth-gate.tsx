"use client";

import { useState, useEffect, useCallback } from "react";
import { IconLock } from "@/lib/icons";

// Check if current password hash matches stored hash (password unchanged since last auth)
async function checkAuth(): Promise<boolean> {
  try {
    const stored = localStorage.getItem("auth_hash");
    if (!stored) return false;
    const resp = await fetch("/api/auth", { method: "GET", cache: "no-store" });
    const { hash } = await resp.json();
    return String(hash) === stored;
  } catch {
    return false;
  }
}

async function tryPassword(password: string): Promise<boolean> {
  try {
    const resp = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    if (!resp.ok) return false;
    // Save auth hash for permanent session
    const verify = await fetch("/api/auth", { method: "GET", cache: "no-store" });
    const { hash } = await verify.json();
    localStorage.setItem("auth_hash", String(hash));
    return true;
  } catch {
    return false;
  }
}

export function useAuth() {
  const [authed, setAuthed] = useState<boolean | null>(null); // null = loading

  useEffect(() => {
    checkAuth().then(setAuthed);
  }, []);

  const login = useCallback(async (pw: string) => {
    const ok = await tryPassword(pw);
    setAuthed(ok);
    return ok;
  }, []);

  return { authed, login };
}

export function AuthGate({ authed, onLogin, children }: { authed: boolean | null; onLogin: (pw: string) => Promise<boolean>; children: React.ReactNode }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  if (authed === null) return null; // loading
  if (authed) return <>{children}</>;

  const submit = async () => {
    if (!pw.trim()) return;
    setLoading(true); setErr("");
    const ok = await onLogin(pw.trim());
    setLoading(false);
    if (!ok) setErr("口令错误");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: "1rem" }}>
      <h1 style={{ fontSize: "1.25rem", fontWeight: 700, display: "flex", alignItems: "center", gap: ".3rem" }}>
        <IconLock size={18} /> 请输入操作口令</h1>
      <input
        type="password" value={pw} onChange={e => setPw(e.target.value)}
        onKeyDown={e => e.key === "Enter" && submit()}
        placeholder="输入口令"
        autoFocus
        style={{ width: "100%", maxWidth: "280px", fontSize: "1rem", padding: ".6rem", textAlign: "center" }}
        disabled={loading}
      />
      {err && <span style={{ color: "var(--red-text)", fontSize: ".85rem" }}>{err}</span>}
      <button className="btn btn-primary" style={{ width: "100%", maxWidth: "280px", padding: ".6rem" }} onClick={submit} disabled={loading}>
        {loading ? "验证中..." : "确认"}
      </button>
    </div>
  );
}
