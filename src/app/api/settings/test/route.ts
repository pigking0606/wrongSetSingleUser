import { NextRequest, NextResponse } from "next/server";

// POST /api/settings/test
// 用前端表单当前填写的 key/url/model 发一个极简测试请求，验证配置是否可用
// 不读数据库 —— 测的是"如果保存了能不能用"，避免"保存后才发现 key 错了"的循环
export async function POST(req: NextRequest) {
  const { type, key, url, model } = await req.json() as {
    type: "vision" | "text";
    key: string;
    url: string;
    model: string;
  };

  if (!key || !key.trim()) {
    return NextResponse.json({ ok: false, error: "API Key 未填写" });
  }
  if (!model || !model.trim()) {
    return NextResponse.json({ ok: false, error: "模型名未填写" });
  }

  // 拼接 URL：用户填了就用用户的，否则按 model 名称走默认
  let baseUrl = (url || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    if (model.startsWith("deepseek")) {
      baseUrl = "https://api.deepseek.com/v1";
    } else {
      baseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    }
  }
  const fullUrl = baseUrl + "/chat/completions";

  // 发一个极简请求：让模型回复 "OK"，max_tokens 给小值快速返回
  // vision 模型也用纯文本测试（不传图），大多数 vision 模型都支持纯文本输入
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const startedAt = Date.now();
  try {
    const resp = await fetch(fullUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key.trim()}`,
      },
      body: JSON.stringify({
        model: model.trim(),
        max_tokens: 16,
        temperature: 0,
        messages: [{ role: "user", content: '回复"OK"两个字符' }],
      }),
      signal: controller.signal,
    });

    const elapsed = Date.now() - startedAt;

    if (!resp.ok) {
      // 区分常见错误码
      const errText = await resp.text().catch(() => "");
      let hint = "";
      if (resp.status === 401 || resp.status === 403) hint = "（Key 无效或无权访问该模型）";
      else if (resp.status === 404) hint = "（URL 或模型名不存在）";
      else if (resp.status === 429) hint = "（限流，稍后再试）";
      // 网关返回 HTML 时 errText 很长且不是 JSON，只截前 200 字
      const preview = errText.slice(0, 200).replace(/\s+/g, " ").trim();
      return NextResponse.json({
        ok: false,
        error: `HTTP ${resp.status} ${hint}`,
        detail: preview || "(无响应体)",
        elapsed,
      });
    }

    const data = await resp.json();
    const content: string = data.choices?.[0]?.message?.content || "";

    // 有些 provider 报错时 HTTP 200 但 body 里带 error 字段
    if (data.error) {
      return NextResponse.json({
        ok: false,
        error: `API 返回错误: ${data.error.message || data.error.type || JSON.stringify(data.error)}`,
        elapsed,
      });
    }

    if (!content) {
      return NextResponse.json({
        ok: false,
        error: "API 返回空内容（可能被限流或模型异常）",
        detail: JSON.stringify(data).slice(0, 200),
        elapsed,
      });
    }

    return NextResponse.json({
      ok: true,
      message: `连接成功，模型回复：${content.slice(0, 40)}`,
      elapsed,
    });
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    const msg = err instanceof Error ? err.message : String(err);
    let hint = "";
    if (msg.includes("aborted") || msg.includes("AbortError")) hint = "（30 秒超时，URL 不通或响应过慢）";
    else if (msg.includes("ENOTFOUND") || msg.includes("getaddrinfo")) hint = "（域名无法解析，URL 错误）";
    else if (msg.includes("ECONNREFUSED")) hint = "（连接被拒绝）";
    else if (msg.includes("fetch failed")) hint = "（网络错误，检查 URL 是否以 https:// 开头）";
    return NextResponse.json({ ok: false, error: `${msg} ${hint}`, elapsed });
  } finally {
    clearTimeout(timeout);
  }
}
