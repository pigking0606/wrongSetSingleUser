// 解析任务并发队列
// - 一次最多执行 2 个解析任务
// - 每题解析完成后等待 1s 再继续解析下一题
// - 队列长度不限
// - 支持时段限制：仅在允许时段内启动新任务，排除时段内暂停
//   设置项（settings 表，明文存储）：
//     analyze_schedule_enabled  "1"/"0" 是否启用时段限制
//     analyze_schedule_windows  JSON: [{"start":"HH:MM","end":"HH:MM"}] 允许时段
//     analyze_schedule_excludes JSON: [{"start":"HH:MM","end":"HH:MM"}] 排除时段
//   end 为排他（不包含），如 "00:00"-"06:00" 表示 00:00~05:59

import { queryOne } from "@/lib/db";

type Task = () => Promise<void>;
interface TimeWindow { start: string; end: string; }

const MAX_CONCURRENCY = 2;
const COOLDOWN_MS = 1000;
// 不在允许时段时，每 30 秒重试一次（等待进入时段）
const RETRY_MS = 30 * 1000;
// gate 缓存有效期 20 秒，避免每次 schedule 都读 DB
const GATE_CACHE_MS = 20 * 1000;

let running = 0;
const waiting: Array<{ task: Task; resolve: () => void; reject: (e: unknown) => void }> = [];
let wakeTimer: NodeJS.Timeout | null = null;
// gate 缓存：{ value, expiresAt }，expiresAt 为时间戳（ms）
let gateCache: { value: boolean; expiresAt: number } | null = null;

async function loadPlainSetting(key: string): Promise<string> {
  try {
    const row = await queryOne<{ value: string }>("SELECT value FROM settings WHERE `key`=?", [key]);
    if (row?.value) return row.value;
  } catch { /* 表可能尚未初始化 */ }
  return "";
}

function timeToMin(t: string): number {
  const parts = t.split(":").map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

// 返回北京时间（UTC+8）的当前分钟数。服务器可能运行在非东八区，需统一按北京时间判断时段
function beijingMinutes(now: Date): number {
  // UTC 时间 + 8 小时，再取模 24 小时得到北京时间
  const utc = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (utc + 8 * 60) % (24 * 60);
}

function inWindow(now: Date, w: TimeWindow): boolean {
  const cur = beijingMinutes(now);
  const s = timeToMin(w.start);
  const e = timeToMin(w.end);
  if (s === e) return false; // 空区间
  return cur >= s && cur < e;
}

/** 清除 gate 缓存，设置变更后调用以立即生效 */
export function invalidateScheduleGate() {
  gateCache = null;
}

/** 当前是否允许启动新解析任务 */
export async function isAllowedNow(): Promise<boolean> {
  // 命中缓存
  if (gateCache && Date.now() < gateCache.expiresAt) return gateCache.value;

  const enabledRaw = (await loadPlainSetting("analyze_schedule_enabled")).trim().toLowerCase();
  const enabled = enabledRaw === "1" || enabledRaw === "true" || enabledRaw === "yes";
  if (!enabled) {
    // 未启用时段限制 → 总是允许
    gateCache = { value: true, expiresAt: Date.now() + GATE_CACHE_MS };
    return true;
  }

  const winRaw = await loadPlainSetting("analyze_schedule_windows");
  const excRaw = await loadPlainSetting("analyze_schedule_excludes");
  let windows: TimeWindow[] = [];
  let excludes: TimeWindow[] = [];
  try { windows = winRaw ? JSON.parse(winRaw) : []; } catch { /* */ }
  try { excludes = excRaw ? JSON.parse(excRaw) : []; } catch { /* */ }

  // 允许窗口为空 → 视为不限制（仅当启用但未配置窗口时）
  if (windows.length === 0) {
    gateCache = { value: true, expiresAt: Date.now() + GATE_CACHE_MS };
    return true;
  }

  const now = new Date();
  const inAllow = windows.some(w => inWindow(now, w));
  const inExclude = excludes.some(w => inWindow(now, w));
  const allowed = inAllow && !inExclude;
  gateCache = { value: allowed, expiresAt: Date.now() + GATE_CACHE_MS };
  return allowed;
}

async function schedule() {
  // 若有等待中的任务才需要判断 gate
  if (waiting.length === 0) return;

  const allowed = await isAllowedNow();
  if (!allowed) {
    // 不在允许时段：设置定时唤醒，等待进入时段后重试
    if (!wakeTimer) {
      wakeTimer = setTimeout(() => {
        wakeTimer = null;
        schedule();
      }, RETRY_MS);
    }
    return;
  }

  while (running < MAX_CONCURRENCY && waiting.length > 0) {
    const item = waiting.shift()!;
    running++;
    runOne(item);
  }
}

async function runOne(item: { task: Task; resolve: () => void; reject: (e: unknown) => void }) {
  try {
    await item.task();
    item.resolve();
  } catch (err) {
    item.reject(err);
  } finally {
    running--;
    // 每题解析完成后等待 1s 再继续解析下一题
    setTimeout(() => schedule(), COOLDOWN_MS);
  }
}

/** 将任务加入解析队列，返回 Promise（任务完成时 resolve） */
export function enqueue(task: Task): Promise<void> {
  return new Promise((resolve, reject) => {
    waiting.push({ task, resolve, reject });
    console.log(`[analysis-queue] enqueued (running=${running}, pending=${waiting.length})`);
    // fire-and-forget，不阻塞调用方
    schedule();
  });
}

/** 获取队列状态 */
export function getQueueStatus() {
  return { running, pending: waiting.length, capacity: MAX_CONCURRENCY };
}
