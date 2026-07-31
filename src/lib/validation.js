import { MIN_PASSWORD_LENGTH } from "./passwords.js";

// 完全な RFC 準拠は目指さない。打ち間違いを弾ければ十分で、
// 実在確認はどのみち正規表現ではできない。
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;

export function validateSignup({ name, email, password }) {
  const errors = [];
  const trimmedName = String(name ?? "").trim();
  const trimmedEmail = String(email ?? "").trim();
  const rawPassword = String(password ?? "");

  if (trimmedName.length === 0) {
    errors.push("名前を入力してください");
  } else if (trimmedName.length > MAX_NAME_LENGTH) {
    errors.push(`名前は${MAX_NAME_LENGTH}文字以内で入力してください`);
  }

  if (trimmedEmail.length === 0) {
    errors.push("メールアドレスを入力してください");
  } else if (trimmedEmail.length > MAX_EMAIL_LENGTH) {
    errors.push(`メールアドレスは${MAX_EMAIL_LENGTH}文字以内で入力してください`);
  } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
    errors.push("メールアドレスの形式が正しくありません");
  }

  if (rawPassword.length < MIN_PASSWORD_LENGTH) {
    errors.push(`パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`);
  }

  return { errors, values: { name: trimmedName, email: trimmedEmail } };
}

export function validateLogin({ email, password }) {
  const errors = [];
  const trimmedEmail = String(email ?? "").trim();

  if (trimmedEmail.length === 0) {
    errors.push("メールアドレスを入力してください");
  }
  if (String(password ?? "").length === 0) {
    errors.push("パスワードを入力してください");
  }

  return { errors, values: { email: trimmedEmail } };
}

/**
 * ログイン後の戻り先。外部サイトへ飛ばされないよう、
 * 自サイト内の絶対パスだけを許可する（"//example.com" は他サイト扱い）。
 */
export function safeReturnTo(value, fallback = "/") {
  const path = String(value ?? "");
  if (path.startsWith("/") && !path.startsWith("//")) {
    return path;
  }
  return fallback;
}
