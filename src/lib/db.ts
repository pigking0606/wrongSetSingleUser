import fs from "fs";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "app.db");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any = null;

async function getSqlJs() {
  // Dynamic import works in both dev (Turbopack) and production
  const sqlModule = await import("sql.js");
  return sqlModule.default;
}

export async function getDb() {
  if (db) return db;

  const initSqlJs = await getSqlJs();

  // Explicit WASM path — sql.js needs its WASM file in production
  const wasmDir = path.join(process.cwd(), "node_modules", "sql.js", "dist");
  const locateWasm = (file: string) => {
    // Try node_modules first
    const nmPath = path.join(wasmDir, file);
    if (fs.existsSync(nmPath)) return nmPath;
    // Fallback: copy of WASM placed in public/wasm
    const pubPath = path.join(process.cwd(), "public", "wasm", file);
    if (fs.existsSync(pubPath)) return pubPath;
    return file;
  };

  const SQL = await initSqlJs({ locateFile: locateWasm });

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA foreign_keys=ON");

  return db;
}

export function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

export function runAndSave(sql: string, params?: any[]) {
  if (!db) throw new Error("Database not initialized");
  db.run(sql, params);
  saveDb();
}

export function queryAll<T = Record<string, unknown>>(sql: string, params?: any[]): T[] {
  if (!db) throw new Error("Database not initialized");
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as T);
  }
  stmt.free();
  return results;
}

export function queryOne<T = Record<string, unknown>>(sql: string, params?: any[]): T | null {
  const rows = queryAll<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}
