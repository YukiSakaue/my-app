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

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * タスクの入力検証。
 * 空文字は「未指定」として null に寄せ、DB には NULL を入れる。
 */
export function validateTask({ title, description, assigneeId, dueDate, estimatedMinutes }) {
  const errors = [];
  const trimmedTitle = String(title ?? "").trim();
  const trimmedDescription = String(description ?? "").trim();

  if (trimmedTitle.length === 0) {
    errors.push("タイトルを入力してください");
  } else if (trimmedTitle.length > MAX_TITLE_LENGTH) {
    errors.push(`タイトルは${MAX_TITLE_LENGTH}文字以内で入力してください`);
  }
  if (trimmedDescription.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`説明は${MAX_DESCRIPTION_LENGTH}文字以内で入力してください`);
  }

  const assigneeGiven = String(assigneeId ?? "").trim().length > 0;
  const parsedAssigneeId = parseOptionalInteger(assigneeId);
  if (assigneeGiven && parsedAssigneeId === null) {
    errors.push("担当者の指定が不正です");
  }

  const parsedDueDate = String(dueDate ?? "").trim() || null;
  if (parsedDueDate !== null && !isValidDate(parsedDueDate)) {
    errors.push("期限は正しい日付で入力してください");
  }

  const parsedMinutes = parseOptionalInteger(estimatedMinutes);
  const minutesGiven = String(estimatedMinutes ?? "").trim().length > 0;
  if (minutesGiven && (parsedMinutes === null || parsedMinutes < 0)) {
    errors.push("見積時間は0以上の整数（分）で入力してください");
  }

  return {
    errors,
    values: {
      title: trimmedTitle,
      description: trimmedDescription,
      assigneeId: parsedAssigneeId,
      dueDate: parsedDueDate,
      estimatedMinutes: minutesGiven ? parsedMinutes : null,
    },
  };
}

const MAX_NOTE_LENGTH = 500;
// 1日分の記録なので24時間を超える入力は打ち間違いとみなす
const MAX_ENTRY_MINUTES = 24 * 60;

/** 手入力の作業時間の検証。分は整数で受け取り、浮動小数は使わない。 */
export function validateTimeEntry({ workDate, minutes, note }) {
  const errors = [];
  const trimmedDate = String(workDate ?? "").trim();
  const trimmedNote = String(note ?? "").trim();

  if (trimmedDate.length === 0) {
    errors.push("日付を入力してください");
  } else if (!isValidDate(trimmedDate)) {
    errors.push("日付は正しい形式で入力してください");
  }

  const parsedMinutes = parseOptionalInteger(minutes);
  if (parsedMinutes === null) {
    errors.push("作業時間は整数（分）で入力してください");
  } else if (parsedMinutes < 1) {
    errors.push("作業時間は1分以上で入力してください");
  } else if (parsedMinutes > MAX_ENTRY_MINUTES) {
    errors.push(`作業時間は1日あたり${MAX_ENTRY_MINUTES}分以内で入力してください`);
  }

  if (trimmedNote.length > MAX_NOTE_LENGTH) {
    errors.push(`メモは${MAX_NOTE_LENGTH}文字以内で入力してください`);
  }

  return {
    errors,
    values: {
      workDate: trimmedDate,
      minutes: parsedMinutes,
      note: trimmedNote.length > 0 ? trimmedNote : null,
    },
  };
}

/** 未入力なら null、整数として読めなければ null を返す。 */
export function parseOptionalInteger(value) {
  const text = String(value ?? "").trim();
  if (text.length === 0) {
    return null;
  }
  const parsed = Number(text);
  return Number.isInteger(parsed) ? parsed : null;
}

// 'YYYY-MM-DD' の形に加えて、2月30日のような実在しない日付も弾く
function isValidDate(text) {
  if (!DATE_PATTERN.test(text)) {
    return false;
  }
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
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
