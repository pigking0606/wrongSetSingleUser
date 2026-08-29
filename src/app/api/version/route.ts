import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/app-version";

// Returns build timestamp — client polls this to detect new deploys
const BUILD_TIME = Date.now();

export async function GET() {
  return NextResponse.json(
    { v: BUILD_TIME, appVersion: APP_VERSION },
    { headers: { "Cache-Control": "no-cache, no-store, must-revalidate" } }
  );
}
