// 解析任务并发队列
// - 一次最多执行 2 个解析任务
// - 每题解析完成后等待 1s 再继续解析下一题
// - 队列长度不限

type Task = () => Promise<void>;

const MAX_CONCURRENCY = 2;
const COOLDOWN_MS = 1000;

let running = 0;
const waiting: Array<{ task: Task; resolve: () => void; reject: (e: unknown) => void }> = [];

function schedule() {
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
    setTimeout(schedule, COOLDOWN_MS);
  }
}

/** 将任务加入解析队列，返回 Promise（任务完成时 resolve） */
export function enqueue(task: Task): Promise<void> {
  return new Promise((resolve, reject) => {
    waiting.push({ task, resolve, reject });
    console.log(`[analysis-queue] enqueued (running=${running}, pending=${waiting.length})`);
    schedule();
  });
}

/** 获取队列状态 */
export function getQueueStatus() {
  return { running, pending: waiting.length, capacity: MAX_CONCURRENCY };
}
