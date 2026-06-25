import { NextResponse } from "next/server";

// Simple health check — no database dependency
export async function GET() {
  return NextResponse.json({ ok: true, time: new Date().toISOString() });
}
