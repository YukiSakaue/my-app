import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import request from "supertest";

import { createApp } from "../src/app.js";
import { closePool, query } from "../src/db.js";
import { listMyTasks, summarizeMembers, summarizeRecentWork, summarizeTasks } from "../src/models/reports.js";
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

/** JST の今日から days 日前の 'YYYY-MM-DD'。 */
function jstDateAgo(days) {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  jst.setUTCDate(jst.getUTCDate() - days);
  return jst.toISOString().slice(0, 10);
}

describe("メンバーごとの集計", () => {
  it("担当タスク数とステータス内訳を数える", async () => {
    const { leader, team, memberId, leaderId } = await setUpTeam(app);
    const a = await createTask(leader, team.id, { title: "A", assigneeId: String(memberId) });
    await createTask(leader, team.id, { title: "B", assigneeId: String(memberId) });
    await createTask(leader, team.id, { title: "C", assigneeId: String(leaderId) });
    await leader
      .post(`/teams/${team.id}/tasks/${a}/status`)
      .type("form")
      .send({ status: "done" });

    const rows = await summarizeMembers(team.id);
    const member = rows.find((row) => row.id === memberId);
    const teamLeader = rows.find((row) => row.id === leaderId);

    assert.equal(member.task_count, 2);
    assert.equal(member.todo_count, 1);
    assert.equal(member.done_count, 1);
    assert.equal(teamLeader.task_count, 1);
  });

  it("タスクを持たないメンバーも 0 件で並ぶ", async () => {
    const { team, memberId } = await setUpTeam(app);

    const rows = await summarizeMembers(team.id);
    const member = rows.find((row) => row.id === memberId);

    assert.equal(member.task_count, 0);
    assert.equal(member.week_minutes, 0);
  });

  it("削除済みのタスクは数えない", async () => {
    const { leader, team, memberId } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id, { assigneeId: String(memberId) });
    await leader.post(`/teams/${team.id}/tasks/${taskId}/delete`).type("form").send({});

    const rows = await summarizeMembers(team.id);
    const member = rows.find((row) => row.id === memberId);

    assert.equal(member.task_count, 0);
  });

  it("今週の作業時間を合計する", async () => {
    const { leader, member, team, memberId } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id, { assigneeId: String(memberId) });

    await member
      .post(timePath(team.id, taskId))
      .type("form")
      .send({ workDate: jstDateAgo(0), minutes: "30" });
    await member
      .post(timePath(team.id, taskId))
      .type("form")
      .send({ workDate: jstDateAgo(0), minutes: "45" });

    const rows = await summarizeMembers(team.id);
    const memberRow = rows.find((row) => row.id === memberId);

    assert.equal(memberRow.week_minutes, 75);
  });

  it("他チームの作業時間は混ざらない", async () => {
    const { leader, member, team, memberId } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id, { assigneeId: String(memberId) });
    await member
      .post(timePath(team.id, taskId))
      .type("form")
      .send({ workDate: jstDateAgo(0), minutes: "30" });

    // メンバーが別チームを作り、そちらにも作業時間を記録する
    const own = await member.post("/teams").type("form").send({ name: "別チーム" });
    const otherTeamId = Number(own.headers.location.replace("/teams/", ""));
    const otherTaskId = await createTask(member, otherTeamId, { title: "別タスク" });
    await member
      .post(timePath(otherTeamId, otherTaskId))
      .type("form")
      .send({ workDate: jstDateAgo(0), minutes: "999" });

    const rows = await summarizeMembers(team.id);
    const memberRow = rows.find((row) => row.id === memberId);

    assert.equal(memberRow.week_minutes, 30);
  });
});

describe("タスク別の見積と実績", () => {
  it("見積と実績を並べて返す", async () => {
    const { leader, member, team, memberId } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id, {
      title: "実装する",
      assigneeId: String(memberId),
      estimatedMinutes: "120",
    });

    await member
      .post(timePath(team.id, taskId))
      .type("form")
      .send({ workDate: jstDateAgo(1), minutes: "90" });
    await leader
      .post(timePath(team.id, taskId))
      .type("form")
      .send({ workDate: jstDateAgo(1), minutes: "60" });

    const rows = await summarizeTasks(team.id);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].estimated_minutes, 120);
    // 担当者以外の作業時間も実績に含める（チームの実績なので）
    assert.equal(rows[0].actual_minutes, 150);
  });

  it("記録が無いタスクは実績 0 で並ぶ", async () => {
    const { leader, team } = await setUpTeam(app);
    await createTask(leader, team.id, { title: "未着手", estimatedMinutes: "60" });

    const rows = await summarizeTasks(team.id);

    assert.equal(rows[0].actual_minutes, 0);
  });

  it("削除済みのタスクは含めない", async () => {
    const { leader, team } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id, { title: "消すタスク" });
    await leader.post(`/teams/${team.id}/tasks/${taskId}/delete`).type("form").send({});

    const rows = await summarizeTasks(team.id);

    assert.equal(rows.length, 0);
  });
});

describe("チームダッシュボードの画面", () => {
  it("メンバーは閲覧できる", async () => {
    const { leader, member, team, memberId } = await setUpTeam(app);
    await createTask(leader, team.id, {
      title: "実装する",
      assigneeId: String(memberId),
      estimatedMinutes: "120",
    });

    const res = await member.get(`/teams/${team.id}/dashboard`);

    assert.equal(res.status, 200);
    assert.match(res.text, /メンバー次郎/);
    assert.match(res.text, /実装する/);
    assert.match(res.text, /2時間/);
  });

  it("超過している場合は差分を表示する", async () => {
    const { leader, member, team, memberId } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id, {
      assigneeId: String(memberId),
      estimatedMinutes: "60",
    });
    await member
      .post(timePath(team.id, taskId))
      .type("form")
      .send({ workDate: jstDateAgo(0), minutes: "90" });

    const res = await leader.get(`/teams/${team.id}/dashboard`);

    assert.match(res.text, /超過 30分/);
  });

  it("部外者は閲覧できない", async () => {
    const { leader, outsider, team } = await setUpTeam(app);
    await createTask(leader, team.id, { title: "秘密のタスク" });

    const res = await outsider.get(`/teams/${team.id}/dashboard`);

    assert.equal(res.status, 404);
    assert.doesNotMatch(res.text, /秘密のタスク/);
  });

  it("未ログインでは閲覧できない", async () => {
    const { team } = await setUpTeam(app);

    const res = await request(app).get(`/teams/${team.id}/dashboard`);

    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^\/login/);
  });
});

describe("個人ビュー", () => {
  it("自分の担当タスクだけが出る", async () => {
    const { leader, member, team, memberId, leaderId } = await setUpTeam(app);
    await createTask(leader, team.id, { title: "自分の担当", assigneeId: String(memberId) });
    await createTask(leader, team.id, { title: "他人の担当", assigneeId: String(leaderId) });

    const res = await member.get("/me");

    assert.equal(res.status, 200);
    assert.match(res.text, /自分の担当/);
    assert.doesNotMatch(res.text, /他人の担当/);
  });

  it("所属している全チームを横断して集める", async () => {
    const { leader, member, team, memberId } = await setUpTeam(app);
    await createTask(leader, team.id, { title: "こちらのチーム", assigneeId: String(memberId) });

    const own = await member.post("/teams").type("form").send({ name: "別チーム" });
    const otherTeamId = Number(own.headers.location.replace("/teams/", ""));
    await createTask(member, otherTeamId, {
      title: "あちらのチーム",
      assigneeId: String(memberId),
    });

    const res = await member.get("/me");

    assert.match(res.text, /こちらのチーム/);
    assert.match(res.text, /あちらのチーム/);
  });

  it("直近30日は記録が無い日も 0 で並ぶ", async () => {
    const { member, memberId } = await setUpTeam(app);

    const rows = await summarizeRecentWork(memberId);

    assert.equal(rows.length, 30);
    assert.ok(rows.every((row) => row.minutes === 0));
    assert.equal(rows.at(-1).work_date, jstDateAgo(0));
  });

  it("30日より前の記録は含めない", async () => {
    const { leader, member, team, memberId } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id, { assigneeId: String(memberId) });

    await member
      .post(timePath(team.id, taskId))
      .type("form")
      .send({ workDate: jstDateAgo(3), minutes: "30" });
    // 直接投入する（画面からは未来・過去いずれの日付も入れられるため）
    await query(
      `INSERT INTO time_entries (task_id, user_id, started_at, ended_at, work_date, minutes)
       VALUES ($1, $2, now(), now(), $3::date, 600)`,
      [taskId, memberId, jstDateAgo(40)]
    );

    const rows = await summarizeRecentWork(memberId);
    const total = rows.reduce((sum, row) => sum + row.minutes, 0);

    assert.equal(total, 30);
  });

  it("削除済みタスクの担当は出ない", async () => {
    const { leader, member, team, memberId } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id, {
      title: "消すタスク",
      assigneeId: String(memberId),
    });
    await leader.post(`/teams/${team.id}/tasks/${taskId}/delete`).type("form").send({});

    const rows = await listMyTasks(memberId);

    assert.equal(rows.length, 0);
  });

  it("未ログインでは閲覧できない", async () => {
    const res = await request(app).get("/me");

    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^\/login/);
  });
});
