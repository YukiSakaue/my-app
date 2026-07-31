import { query, queryOne } from "../db.js";

const UNIQUE_VIOLATION = "23505";

/** 保存・検索の前に必ず通す。大文字小文字の違いで二重登録されるのを防ぐ。 */
export function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

export class EmailTakenError extends Error {
  constructor() {
    super("このメールアドレスは既に登録されています");
    this.name = "EmailTakenError";
  }
}

export async function createUser({ name, email, passwordHash }) {
  try {
    const result = await query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, created_at`,
      [name.trim(), normalizeEmail(email), passwordHash]
    );
    return result.rows[0];
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION && err.constraint === "users_email_key") {
      throw new EmailTakenError();
    }
    throw err;
  }
}

/** ログイン照合用。password_hash を含むためログイン処理以外では使わない。 */
export function findUserByEmailWithHash(email) {
  return queryOne(
    `SELECT id, name, email, password_hash
       FROM users
      WHERE email = $1`,
    [normalizeEmail(email)]
  );
}

export function findUserById(id) {
  return queryOne(
    `SELECT id, name, email, created_at
       FROM users
      WHERE id = $1`,
    [id]
  );
}
