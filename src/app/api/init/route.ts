import { NextResponse } from "next/server";
import { initSchema } from "@/lib/schema";

export async function POST() {
  try {
    await initSchema();
    return NextResponse.json({ ok: true, message: "Database initialized" });
  } catch (err: any) {
    console.error("DB init failed:", err.message, err.stack);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
