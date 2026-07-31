import { query } from "../../src/db.js";

// テストは同じローカル DB を共有するため、各テストの前に消して独立させる。
// テーブルが増えたらここに足す（RESTART IDENTITY で id も 1 から振り直す）。
const TABLES = ["users", "teams", "team_members", "tasks", "task_status_history"];

export function resetDatabase() {
  return query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}
