import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import request from "supertest";

import { createApp } from "../src/app.js";
import { closePool, query, queryOne } from "../src/db.js";
import { resetDatabase } from "./helpers/db.js";
import { createTask, setUpTeam } from "./helpers/teams.js";

const app = createApp();

beforeEach(resetDatabase);

after(async () => {
  await closePool().catch(() => {});
});

describe("タスクの作成", () => {
  it("リーダーは作成できる", async () => {
    const { leader, team } = await setUpTeam(app);

    const taskId = await createTask(leader, team.id, {
      title: "画面を作る",
      description: "一覧と詳細",
      dueDate: "2026-08-15",
      estimatedMinutes: "120",
    });

    const task = await queryOne("SELECT * FROM tasks WHERE id = $1", [taskId]);
    assert.equal(task.title, "画面を作る");
    assert.equal(task.status, "todo");
    assert.equal(task.estimated_minutes, 120);
    assert.equal(task.deleted_at, null);
  });

  it("作成時のステータスが履歴に残る", async () => {
    const { leader, team, leaderId } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id);

    const history = await query(
      "SELECT from_status, to_status, changed_by FROM task_status_history WHERE task_id = $1",
      [taskId]
    );
    assert.equal(history.rows.length, 1);
    assert.equal(history.rows[0].from_status, null);
    assert.equal(history.rows[0].to_status, "todo");
    assert.equal(history.rows[0].changed_by, leaderId);
  });

  it("member は作成できない", async () => {
    const { member, team } = await setUpTeam(app);

    const res = await member
      .post(`/teams/${team.id}/tasks`)
      .type("form")
      .send({ title: "勝手なタスク" });

    assert.equal(res.status, 403);

    const row = await queryOne("SELECT count(*)::int AS count FROM tasks", []);
    assert.equal(row.count, 0);
  });

  it("member には作成画面へのフォームを出さない", async () => {
    const { member, team } = await setUpTeam(app);

    const res = await member.get(`/teams/${team.id}/tasks/new`);

    assert.equal(res.status, 403);
  });

  it("タイトルが空なら作成しない", async () => {
    const { leader, team } = await setUpTeam(app);

    const res = await leader
      .post(`/teams/${team.id}/tasks`)
      .type("form")
      .send({ title: "   " });

    assert.equal(res.status, 400);
    assert.match(res.text, /タイトルを入力してください/);
  });

  it("他チームのユーザーは担当者にできない", async () => {
    const { leader, team } = await setUpTeam(app);
    const outsiderId = await queryOne("SELECT id FROM users WHERE email = $1", [
      "outsider@example.com",
    ]);

    const res = await leader
      .post(`/teams/${team.id}/tasks`)
      .type("form")
      .send({ title: "割り当て", assigneeId: String(outsiderId.id) });

    assert.equal(res.status, 400);
    assert.match(res.text, /チームのメンバーから選んでください/);

    const row = await queryOne("SELECT count(*)::int AS count FROM tasks", []);
    assert.equal(row.count, 0);
  });

  it("実在しない日付の期限は受け付けない", async () => {
    const { leader, team } = await setUpTeam(app);

    const res = await leader
      .post(`/teams/${team.id}/tasks`)
      .type("form")
      .send({ title: "期限テスト", dueDate: "2026-02-30" });

    assert.equal(res.status, 400);
    assert.match(res.text, /正しい日付/);
  });
});

describe("ステータス変更", () => {
  it("担当者は自分のタスクのステータスを変えられる", async () => {
    const { leader, member, team, memberId } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id, { assigneeId: String(memberId) });

    const res = await member
      .post(`/teams/${team.id}/tasks/${taskId}/status`)
      .type("form")
      .send({ status: "in_progress" });

    assert.equal(res.status, 302);

    const task = await queryOne("SELECT status FROM tasks WHERE id = $1", [taskId]);
    assert.equal(task.status, "in_progress");
  });

  it("変更が履歴に記録される", async () => {
    const { leader, member, team, memberId } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id, { assigneeId: String(memberId) });

    await member
      .post(`/teams/${team.id}/tasks/${taskId}/status`)
      .type("form")
      .send({ status: "in_progress" });

    const history = await query(
      `SELECT from_status, to_status, changed_by FROM task_status_history
        WHERE task_id = $1 ORDER BY id`,
      [taskId]
    );
    assert.equal(history.rows.length, 2);
    assert.deepEqual(
      { from: history.rows[1].from_status, to: history.rows[1].to_status },
      { from: "todo", to: "in_progress" }
    );
    assert.equal(history.rows[1].changed_by, memberId);
  });

  it("担当外のタスクは member が変更できない", async () => {
    const { leader, member, team, leaderId } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id, { assigneeId: String(leaderId) });

    const res = await member
      .post(`/teams/${team.id}/tasks/${taskId}/status`)
      .type("form")
      .send({ status: "done" });

    assert.equal(res.status, 403);

    const task = await queryOne("SELECT status FROM tasks WHERE id = $1", [taskId]);
    assert.equal(task.status, "todo");
  });

  it("未割り当てのタスクは member が変更できない", async () => {
    const { leader, member, team } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id);

    const res = await member
      .post(`/teams/${team.id}/tasks/${taskId}/status`)
      .type("form")
      .send({ status: "done" });

    assert.equal(res.status, 403);
  });

  it("リーダーは担当者でなくても変更できる", async () => {
    const { leader, team, memberId } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id, { assigneeId: String(memberId) });

    const res = await leader
      .post(`/teams/${team.id}/tasks/${taskId}/status`)
      .type("form")
      .send({ status: "review" });

    assert.equal(res.status, 302);

    const task = await queryOne("SELECT status FROM tasks WHERE id = $1", [taskId]);
    assert.equal(task.status, "review");
  });

  it("不正なステータスは受け付けない", async () => {
    const { leader, team } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id);

    const res = await leader
      .post(`/teams/${team.id}/tasks/${taskId}/status`)
      .type("form")
      .send({ status: "canceled" });

    assert.equal(res.status, 400);
  });

  it("同じステータスへの変更では履歴を増やさない", async () => {
    const { leader, team } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id);

    await leader
      .post(`/teams/${team.id}/tasks/${taskId}/status`)
      .type("form")
      .send({ status: "todo" });

    const row = await queryOne(
      "SELECT count(*)::int AS count FROM task_status_history WHERE task_id = $1",
      [taskId]
    );
    assert.equal(row.count, 1);
  });
});

describe("タスクの編集と削除", () => {
  it("リーダーは担当者を付け替えられる", async () => {
    const { leader, team, memberId } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id);

    const res = await leader
      .post(`/teams/${team.id}/tasks/${taskId}`)
      .type("form")
      .send({ title: "設計をする", assigneeId: String(memberId) });

    assert.equal(res.status, 302);

    const task = await queryOne("SELECT assignee_id FROM tasks WHERE id = $1", [taskId]);
    assert.equal(task.assignee_id, memberId);
  });

  it("member は編集できない", async () => {
    const { leader, member, team } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id);

    const res = await member
      .post(`/teams/${team.id}/tasks/${taskId}`)
      .type("form")
      .send({ title: "書き換え" });

    assert.equal(res.status, 403);

    const task = await queryOne("SELECT title FROM tasks WHERE id = $1", [taskId]);
    assert.equal(task.title, "設計をする");
  });

  it("member は削除できない", async () => {
    const { leader, member, team } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id);

    const res = await member.post(`/teams/${team.id}/tasks/${taskId}/delete`).type("form").send({});

    assert.equal(res.status, 403);

    const task = await queryOne("SELECT deleted_at FROM tasks WHERE id = $1", [taskId]);
    assert.equal(task.deleted_at, null);
  });

  it("リーダーの削除は論理削除で、履歴は残る", async () => {
    const { leader, team } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id);

    const res = await leader
      .post(`/teams/${team.id}/tasks/${taskId}/delete`)
      .type("form")
      .send({});

    assert.equal(res.status, 302);

    const task = await queryOne("SELECT deleted_at FROM tasks WHERE id = $1", [taskId]);
    assert.notEqual(task.deleted_at, null);

    const history = await queryOne(
      "SELECT count(*)::int AS count FROM task_status_history WHERE task_id = $1",
      [taskId]
    );
    assert.equal(history.count, 1);
  });

  it("削除したタスクは一覧にも詳細にも出ない", async () => {
    const { leader, team } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id, { title: "消すタスク" });
    await leader.post(`/teams/${team.id}/tasks/${taskId}/delete`).type("form").send({});

    const list = await leader.get(`/teams/${team.id}/tasks`);
    assert.doesNotMatch(list.text, /消すタスク/);

    const detail = await leader.get(`/teams/${team.id}/tasks/${taskId}`);
    assert.equal(detail.status, 404);
  });
});

describe("他チームのタスク", () => {
  it("部外者は一覧を見られない", async () => {
    const { leader, outsider, team } = await setUpTeam(app);
    await createTask(leader, team.id, { title: "秘密のタスク" });

    const res = await outsider.get(`/teams/${team.id}/tasks`);

    assert.equal(res.status, 404);
    assert.doesNotMatch(res.text, /秘密のタスク/);
  });

  it("部外者は詳細を見られない", async () => {
    const { leader, outsider, team } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id, { title: "秘密のタスク" });

    const res = await outsider.get(`/teams/${team.id}/tasks/${taskId}`);

    assert.equal(res.status, 404);
    assert.doesNotMatch(res.text, /秘密のタスク/);
  });

  it("部外者はステータスを変更できない", async () => {
    const { leader, outsider, team } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id);

    const res = await outsider
      .post(`/teams/${team.id}/tasks/${taskId}/status`)
      .type("form")
      .send({ status: "done" });

    assert.equal(res.status, 404);

    const task = await queryOne("SELECT status FROM tasks WHERE id = $1", [taskId]);
    assert.equal(task.status, "todo");
  });

  it("別チームの URL からは他チームのタスクを触れない", async () => {
    const { leader, outsider, team } = await setUpTeam(app);
    const taskId = await createTask(leader, team.id, { title: "秘密のタスク" });

    // 部外者が自分のチームを作り、その配下から他チームのタスク ID を指す
    const own = await outsider.post("/teams").type("form").send({ name: "別チーム" });
    const ownTeamId = Number(own.headers.location.replace("/teams/", ""));

    const res = await outsider.get(`/teams/${ownTeamId}/tasks/${taskId}`);

    assert.equal(res.status, 404);
    assert.doesNotMatch(res.text, /秘密のタスク/);
  });

  it("未ログインでは一覧を見られない", async () => {
    const { leader, team } = await setUpTeam(app);
    await createTask(leader, team.id);

    const res = await request(app).get(`/teams/${team.id}/tasks`);

    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^\/login/);
  });
});

describe("一覧の絞り込みと並べ替え", () => {
  async function setUpTasks() {
    const context = await setUpTeam(app);
    const { leader, team, memberId, leaderId } = context;

    const a = await createTask(leader, team.id, {
      title: "期限が遠い",
      dueDate: "2026-12-01",
      assigneeId: String(memberId),
    });
    const b = await createTask(leader, team.id, {
      title: "期限が近い",
      dueDate: "2026-08-01",
      assigneeId: String(leaderId),
    });
    const c = await createTask(leader, team.id, { title: "期限なし" });

    await leader
      .post(`/teams/${team.id}/tasks/${b}/status`)
      .type("form")
      .send({ status: "done" });

    return { ...context, ids: { a, b, c } };
  }

  it("ステータスで絞り込める", async () => {
    const { leader, team } = await setUpTasks();

    const res = await leader.get(`/teams/${team.id}/tasks?status=done`);

    assert.match(res.text, /期限が近い/);
    assert.doesNotMatch(res.text, /期限が遠い/);
  });

  it("担当者で絞り込める", async () => {
    const { leader, team, memberId } = await setUpTasks();

    const res = await leader.get(`/teams/${team.id}/tasks?assignee=${memberId}`);

    assert.match(res.text, /期限が遠い/);
    assert.doesNotMatch(res.text, /期限が近い/);
  });

  it("未割り当てで絞り込める", async () => {
    const { leader, team } = await setUpTasks();

    const res = await leader.get(`/teams/${team.id}/tasks?assignee=none`);

    assert.match(res.text, /期限なし/);
    assert.doesNotMatch(res.text, /期限が近い/);
  });

  it("期限順に並び、期限なしは末尾に来る", async () => {
    const { leader, team } = await setUpTasks();

    const res = await leader.get(`/teams/${team.id}/tasks?sort=due_date`);
    const order = ["期限が近い", "期限が遠い", "期限なし"].map((title) =>
      res.text.indexOf(title)
    );

    assert.ok(order[0] < order[1], "期限が近いものが先に来ていない");
    assert.ok(order[1] < order[2], "期限なしが末尾に来ていない");
  });

  it("不正な並べ替え指定は既定値に落とす", async () => {
    const { leader, team } = await setUpTasks();

    const res = await leader.get(`/teams/${team.id}/tasks?sort=title;DROP TABLE tasks`);

    assert.equal(res.status, 200);
    const stillThere = await queryOne("SELECT count(*)::int AS count FROM tasks", []);
    assert.equal(stillThere.count, 3);
  });
});
