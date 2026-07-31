import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import { createApp } from "../src/app.js";
import { closePool, query, queryOne } from "../src/db.js";
import { resetDatabase } from "./helpers/db.js";
import { createTask, setUpTeam } from "./helpers/teams.js";

const app = createApp();

beforeEach(resetDatabase);

after(async () => {
  await closePool().catch(() => {});
});

function timePath(teamId, taskId, suffix = "") {
  return `/teams/${teamId}/tasks/${taskId}/time-entries${suffix}`;
}

async function setUpTask() {
  const context = await setUpTeam(app);
  const taskId = await createTask(context.leader, context.team.id, {
    title: "実装する",
    assigneeId: String(context.memberId),
  });
  return { ...context, taskId };
}

describe("タイマー", () => {
  it("開始すると計測中の記録ができる", async () => {
    const { member, team, taskId, memberId } = await setUpTask();

    const res = await member.post(timePath(team.id, taskId, "/start")).type("form").send({});

    assert.equal(res.status, 302);

    const entry = await queryOne("SELECT * FROM time_entries WHERE user_id = $1", [memberId]);
    assert.equal(entry.ended_at, null);
    assert.equal(entry.minutes, null);
    assert.equal(entry.task_id, taskId);
  });

  it("停止すると分が確定する", async () => {
    const { member, team, taskId, memberId } = await setUpTask();
    await member.post(timePath(team.id, taskId, "/start")).type("form").send({});

    const res = await member.post(timePath(team.id, taskId, "/stop")).type("form").send({});

    assert.equal(res.status, 302);

    const entry = await queryOne("SELECT * FROM time_entries WHERE user_id = $1", [memberId]);
    assert.notEqual(entry.ended_at, null);
    assert.equal(Number.isInteger(entry.minutes), true);
    assert.ok(entry.minutes >= 0);
  });

  it("計測中は同時に2件作れない", async () => {
    const { leader, member, team, taskId, memberId } = await setUpTask();
    const otherTaskId = await createTask(leader, team.id, { title: "別のタスク" });

    await member.post(timePath(team.id, taskId, "/start")).type("form").send({});
    const res = await member
      .post(timePath(team.id, otherTaskId, "/start"))
      .type("form")
      .send({});

    assert.equal(res.status, 409);
    assert.match(res.text, /すでに別のタスクで計測中です/);

    const row = await queryOne(
      "SELECT count(*)::int AS count FROM time_entries WHERE user_id = $1 AND ended_at IS NULL",
      [memberId]
    );
    assert.equal(row.count, 1);
  });

  it("別の人は同時に計測できる", async () => {
    const { leader, member, team, taskId } = await setUpTask();

    await member.post(timePath(team.id, taskId, "/start")).type("form").send({});
    const res = await leader.post(timePath(team.id, taskId, "/start")).type("form").send({});

    assert.equal(res.status, 302);

    const row = await queryOne(
      "SELECT count(*)::int AS count FROM time_entries WHERE ended_at IS NULL",
      []
    );
    assert.equal(row.count, 2);
  });

  it("計測中でないのに停止しても記録は増えない", async () => {
    const { member, team, taskId } = await setUpTask();

    const res = await member.post(timePath(team.id, taskId, "/stop")).type("form").send({});

    assert.equal(res.status, 409);
    assert.match(res.text, /計測中の記録がありません/);
  });

  it("計測中のタスク名がヘッダーに出る", async () => {
    const { member, team, taskId } = await setUpTask();
    await member.post(timePath(team.id, taskId, "/start")).type("form").send({});

    const res = await member.get("/teams");

    assert.match(res.text, /計測中：実装する/);
  });

  it("停止するとヘッダーから消える", async () => {
    const { member, team, taskId } = await setUpTask();
    await member.post(timePath(team.id, taskId, "/start")).type("form").send({});
    await member.post(timePath(team.id, taskId, "/stop")).type("form").send({});

    const res = await member.get("/teams");

    assert.doesNotMatch(res.text, /計測中：/);
  });
});

describe("手入力", () => {
  it("日付・分・メモを登録できる", async () => {
    const { member, team, taskId, memberId } = await setUpTask();

    const res = await member
      .post(timePath(team.id, taskId))
      .type("form")
      .send({ workDate: "2026-07-30", minutes: "45", note: "設計の検討" });

    assert.equal(res.status, 302);

    const entry = await queryOne(
      "SELECT work_date::text AS work_date, minutes, note, ended_at FROM time_entries WHERE user_id = $1",
      [memberId]
    );
    assert.equal(entry.work_date, "2026-07-30");
    assert.equal(entry.minutes, 45);
    assert.equal(entry.note, "設計の検討");
    // 手入力も ended_at を埋め、「NULL なら計測中」の判定を一貫させる
    assert.notEqual(entry.ended_at, null);
  });

  it("0分は受け付けない", async () => {
    const { member, team, taskId } = await setUpTask();

    const res = await member
      .post(timePath(team.id, taskId))
      .type("form")
      .send({ workDate: "2026-07-30", minutes: "0" });

    assert.equal(res.status, 400);
    assert.match(res.text, /1分以上/);
  });

  it("小数は受け付けない", async () => {
    const { member, team, taskId } = await setUpTask();

    const res = await member
      .post(timePath(team.id, taskId))
      .type("form")
      .send({ workDate: "2026-07-30", minutes: "45.5" });

    assert.equal(res.status, 400);
    assert.match(res.text, /整数/);
  });

  it("1日24時間を超える入力は受け付けない", async () => {
    const { member, team, taskId } = await setUpTask();

    const res = await member
      .post(timePath(team.id, taskId))
      .type("form")
      .send({ workDate: "2026-07-30", minutes: "1441" });

    assert.equal(res.status, 400);

    const row = await queryOne("SELECT count(*)::int AS count FROM time_entries", []);
    assert.equal(row.count, 0);
  });

  it("自分の記録は編集できる", async () => {
    const { member, team, taskId, memberId } = await setUpTask();
    await member
      .post(timePath(team.id, taskId))
      .type("form")
      .send({ workDate: "2026-07-30", minutes: "45" });
    const entry = await queryOne("SELECT id FROM time_entries WHERE user_id = $1", [memberId]);

    const res = await member
      .post(timePath(team.id, taskId, `/${entry.id}`))
      .type("form")
      .send({ workDate: "2026-07-29", minutes: "60", note: "修正" });

    assert.equal(res.status, 302);

    const updated = await queryOne(
      "SELECT work_date::text AS work_date, minutes, note FROM time_entries WHERE id = $1",
      [entry.id]
    );
    assert.deepEqual(updated, { work_date: "2026-07-29", minutes: 60, note: "修正" });
  });

  it("自分の記録は削除できる", async () => {
    const { member, team, taskId, memberId } = await setUpTask();
    await member
      .post(timePath(team.id, taskId))
      .type("form")
      .send({ workDate: "2026-07-30", minutes: "45" });
    const entry = await queryOne("SELECT id FROM time_entries WHERE user_id = $1", [memberId]);

    const res = await member
      .post(timePath(team.id, taskId, `/${entry.id}/delete`))
      .type("form")
      .send({});

    assert.equal(res.status, 302);

    const row = await queryOne("SELECT count(*)::int AS count FROM time_entries", []);
    assert.equal(row.count, 0);
  });
});

describe("他人の作業時間", () => {
  async function setUpMemberEntry() {
    const context = await setUpTask();
    await context.member
      .post(timePath(context.team.id, context.taskId))
      .type("form")
      .send({ workDate: "2026-07-30", minutes: "45", note: "メンバーの記録" });
    const entry = await queryOne("SELECT id FROM time_entries WHERE user_id = $1", [
      context.memberId,
    ]);
    return { ...context, entryId: entry.id };
  }

  it("リーダーでも編集できない", async () => {
    const { leader, team, taskId, entryId } = await setUpMemberEntry();

    const res = await leader
      .post(timePath(team.id, taskId, `/${entryId}`))
      .type("form")
      .send({ workDate: "2026-01-01", minutes: "999" });

    assert.equal(res.status, 404);

    const unchanged = await queryOne("SELECT minutes FROM time_entries WHERE id = $1", [entryId]);
    assert.equal(unchanged.minutes, 45);
  });

  it("リーダーでも削除できない", async () => {
    const { leader, team, taskId, entryId } = await setUpMemberEntry();

    const res = await leader
      .post(timePath(team.id, taskId, `/${entryId}/delete`))
      .type("form")
      .send({});

    assert.equal(res.status, 404);

    const row = await queryOne("SELECT count(*)::int AS count FROM time_entries", []);
    assert.equal(row.count, 1);
  });

  it("編集画面も開けない", async () => {
    const { leader, team, taskId, entryId } = await setUpMemberEntry();

    const res = await leader.get(timePath(team.id, taskId, `/${entryId}/edit`));

    assert.equal(res.status, 404);
  });

  it("チームのログとしては閲覧できる", async () => {
    const { leader, team, taskId } = await setUpMemberEntry();

    const res = await leader.get(`/teams/${team.id}/tasks/${taskId}`);

    assert.equal(res.status, 200);
    assert.match(res.text, /メンバーの記録/);
    assert.match(res.text, /メンバー次郎/);
  });
});

describe("チーム外からの記録", () => {
  it("部外者はタイマーを開始できない", async () => {
    const { outsider, team, taskId } = await setUpTask();

    const res = await outsider.post(timePath(team.id, taskId, "/start")).type("form").send({});

    assert.equal(res.status, 404);

    const row = await queryOne("SELECT count(*)::int AS count FROM time_entries", []);
    assert.equal(row.count, 0);
  });

  it("部外者は手入力もできない", async () => {
    const { outsider, team, taskId } = await setUpTask();

    const res = await outsider
      .post(timePath(team.id, taskId))
      .type("form")
      .send({ workDate: "2026-07-30", minutes: "45" });

    assert.equal(res.status, 404);
  });
});

describe("合計時間", () => {
  it("タスク詳細に合計が出る", async () => {
    const { leader, member, team, taskId } = await setUpTask();
    await member
      .post(timePath(team.id, taskId))
      .type("form")
      .send({ workDate: "2026-07-30", minutes: "45" });
    await leader
      .post(timePath(team.id, taskId))
      .type("form")
      .send({ workDate: "2026-07-30", minutes: "75" });

    const res = await leader.get(`/teams/${team.id}/tasks/${taskId}`);

    // 45 + 75 = 120 分
    assert.match(res.text, /合計 2時間/);
  });

  it("タスクを論理削除しても作業記録は残る", async () => {
    const { leader, member, team, taskId } = await setUpTask();
    await member
      .post(timePath(team.id, taskId))
      .type("form")
      .send({ workDate: "2026-07-30", minutes: "45" });

    await leader.post(`/teams/${team.id}/tasks/${taskId}/delete`).type("form").send({});

    const rows = await query("SELECT minutes FROM time_entries WHERE task_id = $1", [taskId]);
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].minutes, 45);
  });
});
