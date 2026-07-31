import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import { createApp } from "../src/app.js";
import { closePool, queryOne } from "../src/db.js";
import { resetDatabase } from "./helpers/db.js";
import { signedInAgent } from "./helpers/auth.js";

const app = createApp();

const LEADER = { name: "リーダー花子", email: "leader@example.com" };
const MEMBER = { name: "メンバー次郎", email: "member@example.com" };
const OUTSIDER = { name: "部外者三郎", email: "outsider@example.com" };

/** チームを作り、作成者（リーダー）のエージェントとチーム情報を返す。 */
async function createTeamAs(agent, name = "開発チーム") {
  const res = await agent.post("/teams").type("form").send({ name });
  assert.equal(res.status, 302);

  const teamId = Number(res.headers.location.replace("/teams/", ""));
  const team = await queryOne("SELECT id, name, invite_code FROM teams WHERE id = $1", [
    teamId,
  ]);
  return team;
}

async function joinWithCode(agent, inviteCode) {
  return agent.post("/teams/join").type("form").send({ inviteCode });
}

beforeEach(resetDatabase);

after(async () => {
  await closePool().catch(() => {});
});

describe("チーム作成", () => {
  it("作成者が自動的にリーダーになる", async () => {
    const agent = await signedInAgent(app, LEADER);
    const team = await createTeamAs(agent);

    const membership = await queryOne(
      "SELECT role FROM team_members WHERE team_id = $1 AND user_id = 1",
      [team.id]
    );
    assert.equal(membership.role, "leader");
  });

  it("招待コードが発行される", async () => {
    const agent = await signedInAgent(app, LEADER);
    const team = await createTeamAs(agent);

    assert.match(team.invite_code, /^[A-Z2-9]{8}$/);
  });

  it("チーム名が空なら作成しない", async () => {
    const agent = await signedInAgent(app, LEADER);
    const res = await agent.post("/teams").type("form").send({ name: "   " });

    assert.equal(res.status, 400);
    const row = await queryOne("SELECT count(*)::int AS count FROM teams", []);
    assert.equal(row.count, 0);
  });

  it("未ログインでは作成できない", async () => {
    const { default: request } = await import("supertest");
    const res = await request(app).post("/teams").type("form").send({ name: "勝手チーム" });

    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^\/login/);

    const row = await queryOne("SELECT count(*)::int AS count FROM teams", []);
    assert.equal(row.count, 0);
  });
});

describe("招待コードでの参加", () => {
  it("正しいコードならメンバーとして参加できる", async () => {
    const leader = await signedInAgent(app, LEADER);
    const team = await createTeamAs(leader);

    const member = await signedInAgent(app, MEMBER);
    const res = await joinWithCode(member, team.invite_code);

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, `/teams/${team.id}`);

    const membership = await queryOne(
      "SELECT role FROM team_members WHERE team_id = $1 AND user_id = 2",
      [team.id]
    );
    assert.equal(membership.role, "member");
  });

  it("小文字で入力してもコードを受け付ける", async () => {
    const leader = await signedInAgent(app, LEADER);
    const team = await createTeamAs(leader);

    const member = await signedInAgent(app, MEMBER);
    const res = await joinWithCode(member, team.invite_code.toLowerCase());

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, `/teams/${team.id}`);
  });

  it("誤ったコードでは参加できない", async () => {
    const leader = await signedInAgent(app, LEADER);
    await createTeamAs(leader);

    const outsider = await signedInAgent(app, OUTSIDER);
    const res = await joinWithCode(outsider, "WRONGCOD");

    assert.equal(res.status, 404);
    assert.match(res.text, /招待コードが正しくありません/);

    const row = await queryOne(
      "SELECT count(*)::int AS count FROM team_members WHERE user_id = 2",
      []
    );
    assert.equal(row.count, 0);
  });

  it("再発行すると古いコードは使えなくなる", async () => {
    const leader = await signedInAgent(app, LEADER);
    const team = await createTeamAs(leader);

    await leader.post(`/teams/${team.id}/invite-code`).type("form").send({});

    const member = await signedInAgent(app, MEMBER);
    const res = await joinWithCode(member, team.invite_code);

    assert.equal(res.status, 404);

    const updated = await queryOne("SELECT invite_code FROM teams WHERE id = $1", [team.id]);
    assert.notEqual(updated.invite_code, team.invite_code);
  });
});

describe("所属していないチーム", () => {
  it("詳細を閲覧できず、存在も伏せる（403 ではなく 404）", async () => {
    const leader = await signedInAgent(app, LEADER);
    const team = await createTeamAs(leader, "秘密チーム");

    const outsider = await signedInAgent(app, OUTSIDER);
    const res = await outsider.get(`/teams/${team.id}`);

    assert.equal(res.status, 404);
    assert.doesNotMatch(res.text, /秘密チーム/);
  });

  it("メンバーの権限を変更できない", async () => {
    const leader = await signedInAgent(app, LEADER);
    const team = await createTeamAs(leader);

    const outsider = await signedInAgent(app, OUTSIDER);
    const res = await outsider
      .post(`/teams/${team.id}/members/1/role`)
      .type("form")
      .send({ role: "member" });

    assert.equal(res.status, 404);

    const membership = await queryOne(
      "SELECT role FROM team_members WHERE team_id = $1 AND user_id = 1",
      [team.id]
    );
    assert.equal(membership.role, "leader");
  });

  it("招待コードを再発行できない", async () => {
    const leader = await signedInAgent(app, LEADER);
    const team = await createTeamAs(leader);

    const outsider = await signedInAgent(app, OUTSIDER);
    const res = await outsider.post(`/teams/${team.id}/invite-code`).type("form").send({});

    assert.equal(res.status, 404);

    const unchanged = await queryOne("SELECT invite_code FROM teams WHERE id = $1", [team.id]);
    assert.equal(unchanged.invite_code, team.invite_code);
  });

  it("一覧に他人のチームは出てこない", async () => {
    const leader = await signedInAgent(app, LEADER);
    await createTeamAs(leader, "秘密チーム");

    const outsider = await signedInAgent(app, OUTSIDER);
    const res = await outsider.get("/teams");

    assert.equal(res.status, 200);
    assert.doesNotMatch(res.text, /秘密チーム/);
  });
});

describe("メンバー（leader 以外）の権限", () => {
  async function setUpTeamWithMember() {
    const leader = await signedInAgent(app, LEADER);
    const team = await createTeamAs(leader);
    const member = await signedInAgent(app, MEMBER);
    await joinWithCode(member, team.invite_code);
    return { leader, member, team };
  }

  it("チームの詳細は閲覧できる", async () => {
    const { member, team } = await setUpTeamWithMember();

    const res = await member.get(`/teams/${team.id}`);

    assert.equal(res.status, 200);
    assert.match(res.text, /開発チーム/);
  });

  it("招待コードは表示されない", async () => {
    const { member, team } = await setUpTeamWithMember();

    const res = await member.get(`/teams/${team.id}`);

    assert.doesNotMatch(res.text, new RegExp(team.invite_code));
  });

  it("他人の権限を変更できない", async () => {
    const { member, team } = await setUpTeamWithMember();

    const res = await member
      .post(`/teams/${team.id}/members/1/role`)
      .type("form")
      .send({ role: "member" });

    assert.equal(res.status, 403);

    const membership = await queryOne(
      "SELECT role FROM team_members WHERE team_id = $1 AND user_id = 1",
      [team.id]
    );
    assert.equal(membership.role, "leader");
  });

  it("自分をリーダーに昇格できない", async () => {
    const { member, team } = await setUpTeamWithMember();

    const res = await member
      .post(`/teams/${team.id}/members/2/role`)
      .type("form")
      .send({ role: "leader" });

    assert.equal(res.status, 403);

    const membership = await queryOne(
      "SELECT role FROM team_members WHERE team_id = $1 AND user_id = 2",
      [team.id]
    );
    assert.equal(membership.role, "member");
  });

  it("招待コードを再発行できない", async () => {
    const { member, team } = await setUpTeamWithMember();

    const res = await member.post(`/teams/${team.id}/invite-code`).type("form").send({});

    assert.equal(res.status, 403);
  });
});

describe("リーダーによる権限変更", () => {
  it("メンバーをリーダーに昇格できる", async () => {
    const leader = await signedInAgent(app, LEADER);
    const team = await createTeamAs(leader);
    const member = await signedInAgent(app, MEMBER);
    await joinWithCode(member, team.invite_code);

    const res = await leader
      .post(`/teams/${team.id}/members/2/role`)
      .type("form")
      .send({ role: "leader" });

    assert.equal(res.status, 302);

    const membership = await queryOne(
      "SELECT role FROM team_members WHERE team_id = $1 AND user_id = 2",
      [team.id]
    );
    assert.equal(membership.role, "leader");
  });

  it("最後のリーダーは降格できない", async () => {
    const leader = await signedInAgent(app, LEADER);
    const team = await createTeamAs(leader);

    const res = await leader
      .post(`/teams/${team.id}/members/1/role`)
      .type("form")
      .send({ role: "member" });

    assert.equal(res.status, 400);
    assert.match(res.text, /最後のリーダーは降格できません/);

    const membership = await queryOne(
      "SELECT role FROM team_members WHERE team_id = $1 AND user_id = 1",
      [team.id]
    );
    assert.equal(membership.role, "leader");
  });

  it("リーダーが2人いれば降格できる", async () => {
    const leader = await signedInAgent(app, LEADER);
    const team = await createTeamAs(leader);
    const member = await signedInAgent(app, MEMBER);
    await joinWithCode(member, team.invite_code);
    await leader.post(`/teams/${team.id}/members/2/role`).type("form").send({ role: "leader" });

    const res = await leader
      .post(`/teams/${team.id}/members/1/role`)
      .type("form")
      .send({ role: "member" });

    assert.equal(res.status, 302);

    const membership = await queryOne(
      "SELECT role FROM team_members WHERE team_id = $1 AND user_id = 1",
      [team.id]
    );
    assert.equal(membership.role, "member");
  });

  it("不正な role は受け付けない", async () => {
    const leader = await signedInAgent(app, LEADER);
    const team = await createTeamAs(leader);

    const res = await leader
      .post(`/teams/${team.id}/members/1/role`)
      .type("form")
      .send({ role: "admin" });

    assert.equal(res.status, 400);
  });
});
