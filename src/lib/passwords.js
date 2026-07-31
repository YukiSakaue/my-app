import bcrypt from "bcrypt";

import { config } from "../config.js";

export const MIN_PASSWORD_LENGTH = 8;

// bcrypt はコスト分だけ意図的に遅い。本番は 12 とし、
// テストでは回数が多く実行時間に効いてくるため下げる。
const SALT_ROUNDS = config.isTest ? 4 : 12;

export function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

let dummyHash = null;

/**
 * 常に false を返すが、実際の照合と同じだけ時間をかける。
 * ユーザーが存在しないときに即座に返すと、応答時間の差から
 * 「そのメールアドレスが登録済みか」を外部から判別できてしまう。
 */
export async function verifyPasswordAgainstDummy(plainPassword) {
  dummyHash ??= await hashPassword("dummy-password-for-timing-equalization");
  return bcrypt.compare(plainPassword, dummyHash);
}
