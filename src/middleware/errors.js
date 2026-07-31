/**
 * ユーザーに見せてよいメッセージを持つエラー。
 * これ以外のエラーは詳細をログにだけ出し、ユーザーには汎用メッセージを返す。
 */
export class AppError extends Error {
  constructor(status, userMessage, options = {}) {
    super(options.logMessage ?? userMessage, { cause: options.cause });
    this.name = "AppError";
    this.status = status;
    this.userMessage = userMessage;
  }
}

export function notFound(req, res, next) {
  next(new AppError(404, "ページが見つかりません"));
}

/**
 * 集中エラーハンドラ。
 * ログには原因を含む詳細を、レスポンスには安全なメッセージだけを出す。
 */
export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const status = err instanceof AppError ? err.status : 500;
  const userMessage =
    err instanceof AppError ? err.userMessage : "サーバー側で問題が発生しました";

  // 想定内の 4xx はログを 1 行に抑え、想定外のものはスタックごと残す
  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  } else {
    console.warn(`[warn] ${req.method} ${req.originalUrl} -> ${status}: ${err.message}`);
  }

  res.status(status);
  if (req.accepts("html")) {
    res.render("error", { status, message: userMessage });
  } else {
    res.json({ error: userMessage });
  }
}
