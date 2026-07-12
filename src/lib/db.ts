import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "6603"),
  user: process.env.DB_USER || "wrongset",
  password: process.env.DB_PASSWORD || "wrongset123",
  database: process.env.DB_NAME || "wrongset",
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4",
});

export async function getDb() { return pool; }
export async function saveDb() {}
export async function runAndSave(sql: string, params?: any[]) { await pool.execute(sql, params); }
export async function queryAll<T = any>(sql: string, params?: any[]): Promise<T[]> { const [rows] = await pool.execute(sql, params); return rows as T[]; }
export async function queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> { const rows = await queryAll<T>(sql, params); return rows[0] || null; }
