import { query, queryOne } from "../db.js";

const UNIQUE_VIOLATION = "23505";
const RUNNING_INDEX = "time_entries_one_running_per_user";

export class AlreadyRunningError extends Error {
  constructor() {
    super("すでに別のタスクで計測中です。先に停止してください");
    this.name = "AlreadyRunningError";
  }
}

// work_date は JST の日付。時差で前日・翌日に寄らないよう SQL 側で変換する。
const JST_TODAY = "(now() AT TIME ZONE 'Asia/Tokyo')::date";

/** 計測を開始する。すでに計測中なら AlreadyRunningError を投げる。 */
export async function startTimer({ taskId, userId }) {
  try {
    return await queryOne(
      `INSERT INTO time_entries (task_id, user_id, started_at, work_date)
       VALUES ($1, $2, now(), ${JST_TODAY})
       RETURNING id, task_id, started_at`,
      [taskId, userId]
    );
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION && err.constraint === RUNNING_INDEX) {
      throw new AlreadyRunningError();
    }
    throw err;
  }
}

/**
 * 計測中のものを停止し、経過分を確定する。
 * 分は整数で保持するため、秒は四捨五入する。
 */
export function stopTimer(userId) {
  return queryOne(
    `UPDATE time_entries
        SET ended_at = now(),
            minutes = GREATEST(0, round(EXTRACT(EPOCH FROM (now() - started_at)) / 60))
      WHERE user_id = $1 AND ended_at IS NULL
      RETURNING id, task_id, minutes`,
    [userId]
  );
}

/** ヘッダーに出す計測中の情報。無ければ null。 */
export function findRunningEntry(userId) {
  return queryOne(
    `SELECT e.id, e.task_id, e.started_at, t.title AS task_title, t.team_id
       FROM time_entries e
       JOIN tasks t ON t.id = e.task_id
      WHERE e.user_id = $1 AND e.ended_at IS NULL`,
    [userId]
  );
}

/**
 * 手入力の登録。日付と分から started_at / ended_at を組み立てる。
 * こうしておくと「ended_at が NULL なら計測中」という判定が全体で一貫する。
 */
export function createManualEntry({ taskId, userId, workDate, minutes, note }) {
  return queryOne(
    `INSERT INTO time_entries (task_id, user_id, started_at, ended_at, work_date, minutes, note)
     VALUES (
       $1, $2,
       ($3::date + time '00:00') AT TIME ZONE 'Asia/Tokyo',
       ($3::date + time '00:00') AT TIME ZONE 'Asia/Tokyo' + make_interval(mins => $4),
       $3::date, $4, $5
     )
     RETURNING id`,
    [taskId, userId, workDate, minutes, note]
  );
}

export function findEntry(entryId) {
  return queryOne(
    `SELECT e.id, e.task_id, e.user_id, e.work_date::text AS work_date,
            e.minutes, e.note, e.ended_at, t.team_id
       FROM time_entries e
       JOIN tasks t ON t.id = e.task_id
      WHERE e.id = $1`,
    [entryId]
  );
}

/** 計測中のものは編集させない（停止するまで分が確定しないため）。 */
export async function updateManualEntry(entryId, { workDate, minutes, note }) {
  const result = await query(
    `UPDATE time_entries
        SET work_date = $2::date,
            started_at = ($2::date + time '00:00') AT TIME ZONE 'Asia/Tokyo',
            ended_at = ($2::date + time '00:00') AT TIME ZONE 'Asia/Tokyo'
                       + make_interval(mins => $3),
            minutes = $3,
            note = $4
      WHERE id = $1 AND ended_at IS NOT NULL`,
    [entryId, workDate, minutes, note]
  );
  return result.rowCount > 0;
}

export async function deleteEntry(entryId) {
  const result = await query(`DELETE FROM time_entries WHERE id = $1`, [entryId]);
  return result.rowCount > 0;
}

/** タスクの作業ログ。計測中のものも「計測中」として並べる。 */
export async function listEntriesForTask(taskId) {
  const result = await query(
    `SELECT e.id, e.user_id, e.work_date::text AS work_date, e.minutes, e.note,
            e.started_at, e.ended_at, u.name AS user_name
       FROM time_entries e
       JOIN users u ON u.id = e.user_id
      WHERE e.task_id = $1
      ORDER BY e.work_date DESC, e.started_at DESC`,
    [taskId]
  );
  return result.rows;
}

/** 合計時間は SQL の集約で求める（全件取得して JS で足さない）。 */
export async function sumMinutesForTask(taskId) {
  const row = await queryOne(
    `SELECT COALESCE(sum(minutes), 0)::int AS total
       FROM time_entries
      WHERE task_id = $1`,
    [taskId]
  );
  return row.total;
}
