import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { exec } from "child_process";
import fs from "fs";

// Gitee WebHook 部署接口
// 触发条件：push 到 Gitee main → Gitee 调用此接口 → 服务器执行部署脚本

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const hookSecret = process.env.DEPLOY_WEBHOOK_SECRET;
    const { secret } = body;

    // 验证密钥（防止非法调用）
    if (!hookSecret || !secret || secret !== hookSecret) {
      console.warn("[deploy-webhook] 无效密钥拒绝访问");
      return NextResponse.json({ ok: false, error: "invalid secret" }, { status: 403 });
    }

    // 检查分支
    const ref = body.ref || "";
    if (ref !== "refs/heads/main") {
      return NextResponse.json({ ok: true, message: "skipped (not main branch)" });
    }

    const headCommit = body.head_commit?.id || "unknown";
    const author = body.head_commit?.author?.name || "unknown";
    const message = body.head_commit?.message || "";

    console.log(`[deploy-webhook] 收到部署请求: ${headCommit} by ${author}: ${message}`);

    // 部署脚本
    const scriptPath = "/www/wwwroot/wrongset/wrong-deploy-webhook.sh";

    // 检查脚本是否存在
    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json({ ok: false, error: "deploy script not found" }, { status: 500 });
    }

    // 后台执行部署脚本，不等待完成（避免 Gitee 超时）
    exec(`bash ${scriptPath} >> /www/wwwroot/wrongset/deploy-webhook.log 2>&1 &`, (error: any, stdout: string, stderr: string) => {
      if (error) {
        console.error(`[deploy-webhook] exec error: ${error.message}`);
      }
      console.log(`[deploy-webhook] stdout: ${stdout}`);
      if (stderr) {
        console.error(`[deploy-webhook] stderr: ${stderr}`);
      }
    });

    return NextResponse.json({
      ok: true,
      message: "deploy started in background",
      commit: headCommit,
      author,
    });

  } catch (e: any) {
    console.error("[deploy-webhook] error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// GET 用于健康检查
export async function GET() {
  return NextResponse.json({ ok: true, message: "Gitee deploy webhook endpoint is ready" });
}