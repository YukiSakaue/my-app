import { query, queryOne, withTransaction } from "../db.js";
import { DEFAULT_STATUS } from "../lib/statuses.js";

// 並べ替えは値を SQL に埋め込むため、必ずこの表に載っているものだけを使う。
// 利用者の入力をそのまま連結すると SQL インジェクションになる。
const SORT_CLAUSES = {
  due_date: "t.due_date ASC NULLS LAST, t.id ASC",
  created_at: "t.created_at DESC",
  status: "t.status ASC, t.due_date ASC NULLS LAST",
};

export const DEFAULT_SORT = "due_date";

export function isValidSort(value) {
  return Object.hasOwn(SORT_CLAUSES, value);
}

// due_date は日付だけの値なので、時差で前日にずれないよう文字列のまま扱う
const TASK_COLUMNS = `
  t.id, t.team_id, t.title, t.description, t.status,
  t.assignee_id, t.created_by, t.estimated_minutes,
  to_char(t.due_date, 'YYYY-MM-DD') AS due_date,
  t.created_at, t.updated_at,
  assignee.name AS assignee_name,
  creator.name AS creator_name`;

const TASK_JOINS = `
  FROM tasks t
  LEFT JOIN users assignee ON assignee.id = t.assignee_id
  JOIN users creator ON creator.id = t.created_by`;

/**
 * タスクを作り、初期ステータスを履歴に残す。
 * 履歴だけ欠けた状態が生まれないよう同一トランザクションで行う。
 */
export function createTask({
  teamId,
  title,
  description,
  assigneeId,
  createdBy,
  dueDate,
  estimatedMinutes,
}) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO tasks
         (team_id, title, description, assignee_id, created_by, status, due_date, estimated_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, status`,
      [
        teamId,
        title,
        description,
        assigneeId,
        createdBy,
        DEFAULT_STATUS,
        dueDate,
        estimatedMinutes,
      ]
    );
    const task = result.rows[0];

    await client.query(
      `INSERT INTO task_status_history (task_id, from_status, to_status, changed_by)
       VALUES ($1, NULL, $2, $3)`,
      [task.id, task.status, createdBy]
    );

    return task;
  });
}

/** チームのタスク一覧。絞り込みと並べ替えは SQL 側で行う。 */
export async function listTasks(teamId, { status, assigneeId, sort = DEFAULT_SORT } = {}) {
  const conditions = ["t.team_id = $1", "t.deleted_at IS NULL"];
  const params = [teamId];

  if (status) {
    params.push(status);
    conditions.push(`t.status = $${params.length}`);
  }
  if (assigneeId === "none") {
    conditions.push("t.assignee_id IS NULL");
  } else if (assigneeId) {
    params.push(assigneeId);
    conditions.push(`t.assignee_id = $${params.length}`);
  }

  const orderBy = SORT_CLAUSES[sort] ?? SORT_CLAUSES[DEFAULT_SORT];
  const result = await query(
    `SELECT ${TASK_COLUMNS} ${TASK_JOINS}
      WHERE ${conditions.join(" AND ")}
      ORDER BY ${orderBy}`,
    params
  );
  return result.rows;
}

/** 削除済みは返さない。チーム外の ID を渡しても null になる。 */
export function findTask(teamId, taskId) {
  return queryOne(
    `SELECT ${TASK_COLUMNS} ${TASK_JOINS}
      WHERE t.id = $1 AND t.team_id = $2 AND t.deleted_at IS NULL`,
    [taskId, teamId]
  );
}

export async function updateTask(taskId, { title, description, assigneeId, dueDate, estimatedMinutes }) {
  const result = await query(
    `UPDATE tasks
        SET title = $2,
            description = $3,
            assignee_id = $4,
            due_date = $5,
            estimated_minutes = $6
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id`,
    [taskId, title, description, assigneeId, dueDate, estimatedMinutes]
  );
  return result.rowCount > 0;
}

/**
 * ステータスを変更し、履歴に記録する。
 * 同時に別の変更が入っていた場合に備え、変更前のステータスを条件に含める。
 */
export function changeStatus(taskId, { fromStatus, toStatus, changedBy }) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE tasks
          SET status = $3
        WHERE id = $1 AND status = $2 AND deleted_at IS NULL
        RETURNING id`,
      [taskId, fromStatus, toStatus]
    );

    if (result.rowCount === 0) {
      return false;
    }

    await client.query(
      `INSERT INTO task_status_history (task_id, from_status, to_status, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [taskId, fromStatus, toStatus, changedBy]
    );
    return true;
  });
}

/**
 * 論理削除。物理削除すると紐づく作業時間と履歴まで消え、
 * 過去の集計値が変わってしまうため。
 */
export async function softDeleteTask(taskId) {
  const result = await query(
    `UPDATE tasks SET deleted_at = now()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id`,
    [taskId]
  );
  return result.rowCount > 0;
}

export async function listStatusHistory(taskId) {
  const result = await query(
    `SELECT h.from_status, h.to_status, h.changed_at, u.name AS changed_by_name
       FROM task_status_history h
       JOIN users u ON u.id = h.changed_by
      WHERE h.task_id = $1
      ORDER BY h.changed_at, h.id`,
    [taskId]
  );
  return result.rows;
}
