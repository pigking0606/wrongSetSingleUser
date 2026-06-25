import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const correct = process.env.APP_PASSWORD || "123456";
  if (password === correct) {
    return NextResponse.json({ ok: true, token: password });
  }
  return NextResponse.json({ error: "口令错误" }, { status: 401 });
}

export async function GET() {
  // Return a hash of the current password for client-side validation
  const pwd = process.env.APP_PASSWORD || "123456";
  let hash = 0;
  for (let i = 0; i < pwd.length; i++) {
    hash = ((hash << 5) - hash) + pwd.charCodeAt(i);
    hash |= 0;
  }
  return NextResponse.json({ hash });
}
