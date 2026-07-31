// 日時は UTC で保存し、表示のときだけ JST に変換する。
const JST = "Asia/Tokyo";

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("ja-JP", {
  timeZone: JST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(value) {
  if (!value) {
    return "";
  }
  return DATE_TIME_FORMAT.format(new Date(value));
}

/** due_date は 'YYYY-MM-DD' の文字列で受け取る（時差でずらさないため）。 */
export function formatDate(value) {
  if (!value) {
    return "";
  }
  const [year, month, day] = String(value).split("-");
  return `${year}/${month}/${day}`;
}

/** 作業時間は分単位の整数。「90」→「1時間30分」。 */
export function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) {
    return "";
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return `${rest}分`;
  }
  return rest === 0 ? `${hours}時間` : `${hours}時間${rest}分`;
}

/** 今日（JST）の 'YYYY-MM-DD'。期限切れの判定に使う。 */
export function todayInJst() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: JST }).format(new Date());
}
