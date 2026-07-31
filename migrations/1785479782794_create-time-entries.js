/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.createTable("time_entries", {
    id: { type: "serial", primaryKey: true },
    // タスクを論理削除しても実績は残すが、物理削除された場合は道連れにする
    task_id: { type: "integer", notNull: true, references: "tasks", onDelete: "CASCADE" },
    user_id: { type: "integer", notNull: true, references: "users", onDelete: "CASCADE" },
    started_at: { type: "timestamptz", notNull: true },
    // NULL は「計測中」を意味する
    ended_at: { type: "timestamptz" },
    // 集計の日付境界が時差でずれないよう、JST の日付を別に持つ
    work_date: { type: "date", notNull: true },
    // 計測中は確定しないため nullable。作業時間は分単位の整数で持つ。
    minutes: { type: "integer" },
    note: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // 「計測中なら minutes は未確定」「終了済みなら minutes は確定」を DB で強制する
  pgm.addConstraint("time_entries", "time_entries_minutes_matches_state", {
    check: "(ended_at IS NULL) = (minutes IS NULL)",
  });
  pgm.addConstraint("time_entries", "time_entries_minutes_not_negative", {
    check: "minutes IS NULL OR minutes >= 0",
  });
  pgm.addConstraint("time_entries", "time_entries_ended_after_started", {
    check: "ended_at IS NULL OR ended_at >= started_at",
  });

  // 1ユーザーにつき計測中のレコードは同時に1件まで
  pgm.createIndex("time_entries", "user_id", {
    name: "time_entries_one_running_per_user",
    unique: true,
    where: "ended_at IS NULL",
  });

  // タスク詳細のログ表示と、タスク別の合計時間の集計に使う
  pgm.createIndex("time_entries", ["task_id", "started_at"]);
  // 個人ビューの「直近30日の推移」に使う
  pgm.createIndex("time_entries", ["user_id", "work_date"]);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.dropTable("time_entries");
};
