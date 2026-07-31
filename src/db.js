import pg from "pg";

import { config } from "./config.js";

const { Pool } = pg;

// SSL の要否は接続文字列の sslmode に委ねる（config.js のコメント参照）
export const pool = new Pool({ connectionString: config.databaseUrl });

// Pool は接続エラーを 'error' イベントで投げてくる。ハンドラが無いとプロセスごと落ちるため、
// ログに残したうえで握りつぶさずに済むようにしておく。
pool.on("error", (err) => {
  console.error("[db] idle client error:", err);
});

/**
 * SQL を実行する。値は必ず第2引数のプレースホルダ経由で渡すこと。
 * SQL 文字列に値を結合してはならない（インジェクション防止）。
 */
export function query(text, params = []) {
  return pool.query(text, params);
}

/** 1行だけ返す。該当が無ければ null。 */
export async function queryOne(text, params = []) {
  const result = await query(text, params);
  return result.rows[0] ?? null;
}

/** 複数の更新をまとめて実行する。コールバックが投げたら全体をロールバックする。 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** DB に到達できるか確認する。/healthz とテストの後始末で使う。 */
export async function checkConnection() {
  await query("SELECT 1");
}

export function closePool() {
  return pool.end();
}
