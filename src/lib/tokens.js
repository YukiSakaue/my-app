import jwt from "jsonwebtoken";

import { config } from "../config.js";

export const SESSION_COOKIE = "session";

const TOKEN_LIFETIME = "7d";
const TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export function signSessionToken(user) {
  return jwt.sign({ name: user.name }, config.jwtSecret, {
    subject: String(user.id),
    expiresIn: TOKEN_LIFETIME,
  });
}

/** 検証に失敗したら null を返す（期限切れ・改竄・署名鍵違いをまとめて扱う）。 */
export function verifySessionToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

/**
 * セッション Cookie の属性。
 * httpOnly で JavaScript から読めなくし、sameSite=lax で他サイトからの
 * フォーム POST に Cookie が付かないようにして CSRF を抑える。
 */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    path: "/",
    maxAge: TOKEN_LIFETIME_MS,
  };
}
