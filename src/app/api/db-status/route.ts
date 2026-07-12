import { NextResponse } from "next/server";
import { initSchema } from "@/lib/schema";
import { queryOne } from "@/lib/db";

export async function GET() {
  try {
    await initSchema();

    const questionCount = await queryOne<{ c: number }>("SELECT COUNT(*) as c FROM questions");
    const chapterCount = await queryOne<{ c: number }>("SELECT COUNT(*) as c FROM chapters");
    const subjectCount = await queryOne<{ c: number }>("SELECT COUNT(*) as c FROM chapters WHERE level=1");
    const reviewCount = await queryOne<{ c: number }>("SELECT COUNT(*) as c FROM review_records");

    return NextResponse.json({
      questionCount: questionCount?.c ?? 0,
      chapterCount: chapterCount?.c ?? 0,
      subjectCount: subjectCount?.c ?? 0,
      reviewCount: reviewCount?.c ?? 0,
    });
  } catch (err: any) {
    console.error("DB status error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
