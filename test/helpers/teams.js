import assert from "node:assert/strict";

import { queryOne } from "../../src/db.js";
import { signedInAgent } from "./auth.js";

/** チームを作り、リーダーのエージェントとチーム情報を返す。 */
export async function createTeam(app, agent, name = "開発チーム") {
  const res = await agent.post("/teams").type("form").send({ name });
  assert.equal(res.status, 302);

  const teamId = Number(res.headers.location.replace("/teams/", ""));
  return queryOne("SELECT id, name, invite_code FROM teams WHERE id = $1", [teamId]);
}

/**
 * リーダー1人・メンバー1人・部外者1人が揃った状態を用意する。
 * 権限テストの多くがこの形を必要とするため共通化する。
 */
export async function setUpTeam(app) {
  const leader = await signedInAgent(app, {
    name: "リーダー花子",
    email: "leader@example.com",
  });
  const team = await createTeam(app, leader);

  const member = await signedInAgent(app, {
    name: "メンバー次郎",
    email: "member@example.com",
  });
  await member.post("/teams/join").type("form").send({ inviteCode: team.invite_code });

  const outsider = await signedInAgent(app, {
    name: "部外者三郎",
    email: "outsider@example.com",
  });

  const leaderId = await userIdByEmail("leader@example.com");
  const memberId = await userIdByEmail("member@example.com");

  return { leader, member, outsider, team, leaderId, memberId };
}

async function userIdByEmail(email) {
  const row = await queryOne("SELECT id FROM users WHERE email = $1", [email]);
  return row.id;
}

/** タスクを作り、その ID を返す。 */
export async function createTask(agent, teamId, fields = {}) {
  const res = await agent
    .post(`/teams/${teamId}/tasks`)
    .type("form")
    .send({ title: "設計をする", description: "", ...fields });

  assert.equal(res.status, 302, `タスク作成に失敗しました: ${res.status}`);
  return Number(res.headers.location.split("/").pop());
}
