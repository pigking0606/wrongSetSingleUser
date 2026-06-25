import { NextRequest, NextResponse } from "next/server";
import { initSchema } from "@/lib/schema";
import { performAnalysis } from "@/lib/analyze-pipeline";

export async function POST(req: NextRequest) {
  await initSchema();

  try {
    const { question_id } = await req.json();
    if (!question_id) {
      return NextResponse.json({ error: "question_id required" }, { status: 400 });
    }

    const cls = await performAnalysis(question_id);
    if (!cls) {
      return NextResponse.json({ error: "分析失败" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, classification: cls });
  } catch (err) {
    console.error("Analyze error:", err);
    return NextResponse.json({ error: "分析失败" }, { status: 500 });
  }
}
