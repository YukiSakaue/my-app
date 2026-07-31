import { query, queryOne } from "../db.js";

// 集計はすべて SQL の集約関数で行う。全件取得して JS で数えると、
// 件数が増えたときにメモリと転送量が効いてくるため。

// 週の区切りと「今日」は JST で判定する（UTC のままだと日付が前後にずれる）
const JST_TODAY = "(now() AT TIME ZONE 'Asia/Tokyo')::date";
const JST_WEEK_START = `date_trunc('week', now() AT TIME ZONE 'Asia/Tokyo')::date`;

/**
 * メンバーごとの担当タスク数・ステータス内訳・今週の作業時間。
 * タスクを持たないメンバーも 0 件として並ぶよう LEFT JOIN で組む。
 */
export async function summarizeMembers(teamId) {
  const result = await query(
    `WITH assigned AS (
       SELECT t.assignee_id AS user_id,
              count(*)::int AS task_count,
              count(*) FILTER (WHERE t.status = 'todo')::int AS todo_count,
              count(*) FILTER (WHERE t.status = 'in_progress')::int AS in_progress_count,
              count(*) FILTER (WHERE t.status = 'review')::int AS review_count,
              count(*) FILTER (WHERE t.status = 'done')::int AS done_count
         FROM tasks t
        WHERE t.team_id = $1 AND t.deleted_at IS NULL AND t.assignee_id IS NOT NULL
        GROUP BY t.assignee_id
     ),
     this_week AS (
       SELECT e.user_id, COALESCE(sum(e.minutes), 0)::int AS minutes
         FROM time_entries e
         JOIN tasks t ON t.id = e.task_id
        WHERE t.team_id = $1 AND e.work_date >= ${JST_WEEK_START}
        GROUP BY e.user_id
     )
     SELECT u.id, u.name, tm.role,
            COALESCE(a.task_count, 0) AS task_count,
            COALESCE(a.todo_count, 0) AS todo_count,
            COALESCE(a.in_progress_count, 0) AS in_progress_count,
            COALESCE(a.review_count, 0) AS review_count,
            COALESCE(a.done_count, 0) AS done_count,
            COALESCE(w.minutes, 0) AS week_minutes
       FROM team_members tm
       JOIN users u ON u.id = tm.user_id
       LEFT JOIN assigned a ON a.user_id = u.id
       LEFT JOIN this_week w ON w.user_id = u.id
      WHERE tm.team_id = $1
      ORDER BY tm.role, u.name`,
    [teamId]
  );
  return result.rows;
}

/** 未割り当てのタスク数。ダッシュボードで取りこぼしを見えるようにする。 */
export async function countUnassignedTasks(teamId) {
  const row = await queryOne(
    `SELECT count(*)::int AS count
       FROM tasks
      WHERE team_id = $1 AND deleted_at IS NULL AND assignee_id IS NULL`,
    [teamId]
  );
  return row.count;
}

/** タスク別の見積時間と実績時間。実績が多い順に並べる。 */
export async function summarizeTasks(teamId) {
  const result = await query(
    `SELECT t.id, t.title, t.status, t.estimated_minutes,
            COALESCE(sum(e.minutes), 0)::int AS actual_minutes,
            assignee.name AS assignee_name
       FROM tasks t
       LEFT JOIN time_entries e ON e.task_id = t.id
       LEFT JOIN users assignee ON assignee.id = t.assignee_id
      WHERE t.team_id = $1 AND t.deleted_at IS NULL
      GROUP BY t.id, t.title, t.status, t.estimated_minutes, assignee.name
      ORDER BY actual_minutes DESC, t.id`,
    [teamId]
  );
  return result.rows;
}

/** 自分が担当しているタスク。所属している全チームを横断して返す。 */
export async function listMyTasks(userId) {
  const result = await query(
    `SELECT t.id, t.title, t.status, t.team_id,
            to_char(t.due_date, 'YYYY-MM-DD') AS due_date,
            team.name AS team_name
       FROM tasks t
       JOIN teams team ON team.id = t.team_id
      WHERE t.assignee_id = $1 AND t.deleted_at IS NULL
      ORDER BY (t.status = 'done'), t.due_date ASC NULLS LAST, t.id`,
    [userId]
  );
  return result.rows;
}

const RECENT_DAYS = 30;

/**
 * 直近30日の作業時間の推移。
 * 記録が無い日も 0 として並ぶよう、日付の系列を生成してから突き合わせる。
 */
export async function summarizeRecentWork(userId) {
  const result = await query(
    `WITH days AS (
       SELECT generate_series(${JST_TODAY} - ($2::int - 1), ${JST_TODAY}, '1 day')::date AS work_date
     ),
     totals AS (
       SELECT work_date, COALESCE(sum(minutes), 0)::int AS minutes
         FROM time_entries
        WHERE user_id = $1 AND work_date >= ${JST_TODAY} - ($2::int - 1)
        GROUP BY work_date
     )
     SELECT d.work_date::text AS work_date, COALESCE(t.minutes, 0) AS minutes
       FROM days d
       LEFT JOIN totals t ON t.work_date = d.work_date
      ORDER BY d.work_date`,
    [userId, RECENT_DAYS]
  );
  return result.rows;
}
