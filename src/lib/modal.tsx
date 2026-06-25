"use client";

import { useState, useCallback, createContext, useContext, type ReactNode } from "react";

// ---- Types ----
type ModalState = {
  type: "confirm" | "alert" | "prompt";
  title: string;
  message: string;
  placeholder?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolve: (value: any) => void;
} | null;

// ---- Context ----
interface ModalContextValue {
  confirm: (title: string, message: string) => Promise<boolean>;
  alert: (title: string, message: string) => Promise<void>;
  prompt: (title: string, message: string, placeholder?: string) => Promise<string | null>;
}

const ModalContext = createContext<ModalContextValue | null>(null);

export function useModal(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModal must be used within ModalProvider");
  return ctx;
}

// ---- Provider ----
export function ModalProvider({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<ModalState>(null);

  const confirm = useCallback((title: string, message: string): Promise<boolean> => {
    return new Promise(resolve => setModal({ type: "confirm", title, message, resolve }));
  }, []);

  const alert = useCallback((title: string, message: string): Promise<void> => {
    return new Promise(resolve => setModal({ type: "alert", title, message, resolve: () => resolve() }));
  }, []);

  const prompt = useCallback((title: string, message: string, placeholder?: string): Promise<string | null> => {
    return new Promise(resolve => setModal({ type: "prompt", title, message, placeholder, resolve }));
  }, []);

  const handleConfirm = (value?: string) => {
    if (!modal) return;
    if (modal.type === "prompt") modal.resolve(value ?? null);
    else modal.resolve(true);
    setModal(null);
  };

  const handleCancel = () => {
    if (!modal) return;
    if (modal.type === "confirm") modal.resolve(false);
    else if (modal.type === "prompt") modal.resolve(null);
    else modal.resolve(true); // alert always resolves
    setModal(null);
  };

  const [promptValue, setPromptValue] = useState("");

  return (
    <ModalContext.Provider value={{ confirm, alert, prompt }}>
      {children}
      {modal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 10000,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,.45)", backdropFilter: "blur(2px)",
        }} onClick={handleCancel}>
          <div className="card" style={{
            maxWidth: "420px", width: "90%", padding: "1.25rem 1.5rem",
            display: "flex", flexDirection: "column", gap: ".75rem",
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: "1rem" }}>{modal.title}</div>
            <div style={{ fontSize: ".875rem", color: "var(--text-muted)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{modal.message}</div>
            {modal.type === "prompt" && (
              <input
                value={promptValue}
                onChange={e => setPromptValue(e.target.value)}
                placeholder={modal.placeholder || ""}
                style={{ width: "100%", boxSizing: "border-box", fontSize: ".85rem" }}
                autoFocus
                onKeyDown={e => { if (e.key === "Enter") handleConfirm(promptValue); }}
              />
            )}
            <div style={{ display: "flex", gap: ".5rem", justifyContent: "flex-end" }}>
              {(modal.type === "confirm" || modal.type === "prompt") && (
                <button className="btn" style={{ fontSize: ".85rem", padding: ".4rem 1rem" }} onClick={handleCancel}>取消</button>
              )}
              <button className="btn btn-primary" style={{ fontSize: ".85rem", padding: ".4rem 1rem" }}
                onClick={() => handleConfirm(modal.type === "prompt" ? promptValue : undefined)}>
                {modal.type === "alert" ? "确定" : "确认"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalContext.Provider>
  );
}