import { appendFile, mkdir } from "fs/promises";
import { join } from "path";

// 所有 AI 响应统一写入 setLog/aiResp 文件，便于排查解析失败/格式错误
// 服务器路径：/www/wwwroot/wrongset/setLog/aiResp
// 本地开发：项目根目录 setLog/aiResp
const LOG_DIR = join(process.cwd(), "setLog");
const LOG_FILE = join(LOG_DIR, "aiResp");
let dirEnsured = false;

async function ensureDir() {
  if (dirEnsured) return;
  try {
    await mkdir(LOG_DIR, { recursive: true });
    dirEnsured = true;
  } catch { /* ignore */ }
}

// 记录 AI 响应到 setLog/aiResp
// fire-and-forget：日志失败不能影响主流程
export function logAiResp(tag: string, model: string, content: string, extra?: string) {
  void (async () => {
    await ensureDir();
    const ts = new Date().toISOString();
    const extraBlock = extra ? `\n---------- extra ----------\n${extra}\n` : "";
    const block = `\n================ ${ts} | ${tag} | model=${model} ================\n${content}\n${extraBlock}\n`;
    try {
      await appendFile(LOG_FILE, block, "utf8");
    } catch { /* ignore */ }
  })();
}
