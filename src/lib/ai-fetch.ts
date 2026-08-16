// ---------------------------------------------------------------------------
// AI 兼容接口统一调用：全局限流 + 429/网络自动重试 + 多 endpoint 自动切换
// ---------------------------------------------------------------------------
// 解决的问题：
//   1. 解析队列本身已限制并发2，但 dedup / fixLaTeX / reconcile / 计划生成等
//      会与解析并行打 API，触发账户级 RPS 上限 → 大量 "API error 429 (1302)"
//   2. 单一 key 达到速率限制时自动退避重试；配置了备用 key / 阿里云 DashScope
//      通道时自动切换，不影响其它 API 的正常使用

export interface AiEndpoint {
  url: string;   // 完整 /chat/completions 地址
  key: string;   // API Key
  model: string; // 模型名（body.model 随 endpoint 切换）
}

export interface AiFetchResult {
  ok: boolean;
  status: number;
  json: any;
}

// 相邻请求最小间隔（毫秒）：进程内全局节流，降低账户 RPS 峰值
const DEFAULT_MIN_INTERVAL_MS = 350;

let lastAiCallAt = 0;
let inflight = 0;
let inflightWaiters: Array<() => void> = [];

export function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

// 全局并发闸门：同时最多允许 maxConcurrency 个 AI 请求
async function acquireConcurrency(maxConcurrency: number) {
  if (inflight < maxConcurrency) { inflight++; return; }
  await new Promise<void>(r => inflightWaiters.push(r));
  inflight++;
}
function releaseConcurrency() {
  inflight--;
  inflightWaiters.shift()?.();
}

// 请求前等待，保证相邻两次请求至少间隔 minIntervalMs
async function acquireRateSlot(minIntervalMs: number) {
  const now = Date.now();
  const wait = minIntervalMs - (now - lastAiCallAt);
  if (wait > 0) await sleep(wait);
  lastAiCallAt = Date.now();
}

// API Key 支持多 key：逗号 / 分号 / 换行分隔
export function splitApiKeys(keys: string | null | undefined): string[] {
  return (keys || "").split(/[,;\n\r]+/).map(k => k.trim()).filter(Boolean);
}

// 判断是否为限流错误（HTTP 429，或阿里云 code 1302 / Throttling / 限流文案）
export function isRateLimit(status: number, json: any): boolean {
  if (status === 429) return true;
  const code = String(json?.error?.code || "");
  const msg = String(json?.error?.message || "");
  return code === "1302" || code === "Throttling" || /rate.?limit|throttl|并发|频率|限流/i.test(msg);
}

export interface AiFetchOptions {
  endpoints: AiEndpoint[];
  buildBody: (model: string) => Record<string, unknown>;
  timeoutMs: number;
  label: string;
  maxAttempts?: number;    // 总尝试次数，默认 endpoints.length + 2
  maxConcurrency?: number; // 全局并发上限，默认 4
  minIntervalMs?: number;  // 相邻请求最小间隔，默认 350
}

export async function aiFetch(opts: AiFetchOptions): Promise<AiFetchResult> {
  const endpoints = opts.endpoints.filter(e => e.key && e.url);
  if (endpoints.length === 0) throw new Error(`[aiFetch] ${opts.label}: 未配置可用的 API endpoint`);
  const maxAttempts = opts.maxAttempts ?? endpoints.length + 2;
  const maxConcurrency = opts.maxConcurrency ?? 4;
  const minIntervalMs = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;

  await acquireConcurrency(maxConcurrency);
  try {
    let lastErr: Error | null = null;
    let lastStatus = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const ep = endpoints[attempt % endpoints.length];
      await acquireRateSlot(minIntervalMs);
      try {
        const resp = await fetch(ep.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${ep.key}` },
          body: JSON.stringify(opts.buildBody(ep.model)),
          signal: AbortSignal.timeout(opts.timeoutMs),
        });
        let json: any = null;
        try { json = await resp.json(); } catch { /* 无 body 或非 JSON */ }
        lastStatus = resp.status;

        // 限流：退避后重试（切换到下一个 endpoint/key）
        if (isRateLimit(resp.status, json)) {
          const retryAfter = parseFloat(resp.headers.get("retry-after") || "");
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 15000)
            : Math.min(600 * Math.pow(2, attempt), 10000);
          console.warn(`[aiFetch] ${opts.label} 触发限流(429), attempt=${attempt}, 等待${waitMs}ms, endpoint=${ep.model}`);
          await sleep(waitMs);
          continue;
        }
        // key 无效 / 无权限：切换下一个 endpoint
        if (resp.status === 401 || resp.status === 403) {
          console.warn(`[aiFetch] ${opts.label} key 无效(status=${resp.status}), 切换 endpoint=${ep.model}`);
          continue;
        }
        return { ok: resp.ok, status: resp.status, json };
      } catch (err) {
        // 超时/中断不重试，直接抛出（保持原有超时语义，避免单题解析无限拉长）
        const name = (err as Error)?.name || "";
        if (name === "TimeoutError" || name === "AbortError" || (err as Error)?.message?.includes("abort")) {
          throw err;
        }
        lastErr = err as Error;
        const waitMs = Math.min(600 * Math.pow(2, attempt), 8000);
        console.warn(`[aiFetch] ${opts.label} 网络错误: ${err instanceof Error ? err.message : err}, attempt=${attempt}, 等待${waitMs}ms 重试`);
        await sleep(waitMs);
      }
    }
    const msg = lastErr
      ? `[aiFetch] ${opts.label} 达到最大尝试次数仍失败（上次状态 ${lastStatus}）: ${lastErr.message}`
      : `[aiFetch] ${opts.label} 达到最大尝试次数(${maxAttempts})仍失败（上次状态 ${lastStatus}）`;
    const e = new Error(msg) as Error & { status?: number };
    e.status = lastStatus;
    throw e;
  } finally {
    releaseConcurrency();
  }
}
