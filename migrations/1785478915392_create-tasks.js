/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

const STATUSES = "('todo', 'in_progress', 'review', 'done')";

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.createTable("tasks", {
    id: { type: "serial", primaryKey: true },
    team_id: { type: "integer", notNull: true, references: "teams", onDelete: "CASCADE" },
    title: { type: "text", notNull: true },
    description: { type: "text", notNull: true, default: "" },
    // 担当者が退会しても、タスクと作業実績は残す
    assignee_id: { type: "integer", references: "users", onDelete: "SET NULL" },
    // 作成者が消えると履歴の説明がつかなくなるため、削除は拒否する
    created_by: { type: "integer", notNull: true, references: "users", onDelete: "RESTRICT" },
    status: { type: "text", notNull: true, default: "todo" },
    due_date: { type: "date" },
    estimated_minutes: { type: "integer" },
    // 論理削除。集計から実績を消さずに一覧から外すため、物理削除はしない。
    deleted_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // enum ではなく CHECK。値の追加・変更をマイグレーションで扱いやすくするため。
  pgm.addConstraint("tasks", "tasks_status_valid", {
    check: `status IN ${STATUSES}`,
  });
  pgm.addConstraint("tasks", "tasks_title_not_blank", {
    check: "length(btrim(title)) > 0",
  });
  pgm.addConstraint("tasks", "tasks_estimated_minutes_positive", {
    check: "estimated_minutes IS NULL OR estimated_minutes >= 0",
  });

  // 一覧は「チームの未削除タスク」を必ず起点にする
  pgm.createIndex("tasks", ["team_id", "status"], { where: "deleted_at IS NULL" });
  pgm.createIndex("tasks", ["team_id", "assignee_id"], { where: "deleted_at IS NULL" });

  pgm.createTrigger("tasks", "tasks_set_updated_at", {
    when: "BEFORE",
    operation: "UPDATE",
    level: "ROW",
    function: "set_updated_at",
  });

  pgm.createTable("task_status_history", {
    id: { type: "serial", primaryKey: true },
    task_id: { type: "integer", notNull: true, references: "tasks", onDelete: "CASCADE" },
    // 作成時の初期ステータスには遷移元が無いため nullable
    from_status: { type: "text" },
    to_status: { type: "text", notNull: true },
    changed_by: { type: "integer", notNull: true, references: "users", onDelete: "RESTRICT" },
    changed_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("task_status_history", "task_status_history_from_valid", {
    check: `from_status IS NULL OR from_status IN ${STATUSES}`,
  });
  pgm.addConstraint("task_status_history", "task_status_history_to_valid", {
    check: `to_status IN ${STATUSES}`,
  });

  pgm.createIndex("task_status_history", ["task_id", "changed_at"]);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.dropTable("task_status_history");
  pgm.dropTrigger("tasks", "tasks_set_updated_at");
  pgm.dropTable("tasks");
};
