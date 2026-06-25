import { NextResponse } from "next/server";

// Returns build timestamp — client polls this to detect new deploys
const BUILD_TIME = Date.now();

export async function GET() {
  return NextResponse.json(
    { v: BUILD_TIME },
    { headers: { "Cache-Control": "no-cache, no-store, must-revalidate" } }
  );
}
