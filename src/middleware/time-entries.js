import { findEntry, findRunningEntry } from "../models/time-entries.js";
import { AppError } from "./errors.js";

/**
 * 計測中のタスクを全画面のヘッダーに出すため、毎リクエストで取得する。
 * 未ログインなら何もしない。
 */
export async function attachRunningTimer(req, res, next) {
  res.locals.runningTimer = null;
  if (!req.user) {
    return next();
  }

  try {
    res.locals.runningTimer = await findRunningEntry(req.user.id);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * URL の :entryId を読み込む。
 * 作業時間は本人しか編集・削除できない（リーダーであっても他人の記録は触れない）。
 * 別タスク配下の ID を指された場合も弾く。
 */
export async function loadOwnEntry(req, res, next) {
  const entryId = Number(req.params.entryId);
  if (!Number.isInteger(entryId)) {
    return next(new AppError(404, "作業時間の記録が見つかりません"));
  }

  try {
    const entry = await findEntry(entryId);
    const belongsToThisTask = entry?.task_id === req.task.id;

    // 他人の記録でも「存在しない」と同じ扱いにし、記録の有無を伏せる
    if (!entry || !belongsToThisTask || entry.user_id !== req.user.id) {
      return next(new AppError(404, "作業時間の記録が見つかりません"));
    }

    req.timeEntry = entry;
    res.locals.timeEntry = entry;
    next();
  } catch (err) {
    next(err);
  }
}
