import { randomBytes } from "node:crypto";

// 紛らわしい文字（0/O、1/I/l）を除いた集合。口頭やチャットで伝える前提のため。
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export function generateInviteCode() {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (const byte of bytes) {
    code += ALPHABET[byte % ALPHABET.length];
  }
  return code;
}

/** 入力されたコードの表記ゆれ（小文字・前後の空白）を吸収する。 */
export function normalizeInviteCode(value) {
  return String(value ?? "").trim().toUpperCase();
}
