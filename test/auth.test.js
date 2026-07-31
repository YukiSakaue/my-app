import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import request from "supertest";

import { createApp } from "../src/app.js";
import { closePool, queryOne } from "../src/db.js";
import { resetDatabase } from "./helpers/db.js";

const app = createApp();

const VALID_SIGNUP = {
  name: "田中太郎",
  email: "taro@example.com",
  password: "password123",
};

function signup(agent, overrides = {}) {
  return agent.post("/signup").type("form").send({ ...VALID_SIGNUP, ...overrides });
}

function sessionCookie(res) {
  return (res.headers["set-cookie"] ?? []).find((c) => c.startsWith("session="));
}

beforeEach(resetDatabase);

after(async () => {
  await closePool().catch(() => {});
});

describe("POST /signup", () => {
  it("登録に成功するとセッション Cookie を発行してトップへ送る", async () => {
    const res = await signup(request(app));

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, "/");

    const cookie = sessionCookie(res);
    assert.ok(cookie, "session Cookie が発行されていない");
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
  });

  it("パスワードをハッシュ化して保存する", async () => {
    await signup(request(app));

    const row = await queryOne("SELECT password_hash FROM users WHERE email = $1", [
      VALID_SIGNUP.email,
    ]);
    assert.ok(row);
    assert.notEqual(row.password_hash, VALID_SIGNUP.password);
    assert.match(row.password_hash, /^\$2[aby]\$/);
  });

  it("メールアドレスを小文字にして保存する", async () => {
    await signup(request(app), { email: "TARO@Example.COM" });

    const row = await queryOne("SELECT email FROM users", []);
    assert.equal(row.email, "taro@example.com");
  });

  it("パスワードが8文字未満なら登録しない", async () => {
    const res = await signup(request(app), { password: "short12" });

    assert.equal(res.status, 400);
    assert.match(res.text, /パスワードは8文字以上/);

    const row = await queryOne("SELECT count(*)::int AS count FROM users", []);
    assert.equal(row.count, 0);
  });

  it("メールアドレスの形式が不正なら登録しない", async () => {
    const res = await signup(request(app), { email: "not-an-email" });

    assert.equal(res.status, 400);
    assert.match(res.text, /メールアドレスの形式/);
  });

  it("同じメールアドレスは大文字小文字が違っても重複扱いにする", async () => {
    await signup(request(app));
    const res = await signup(request(app), { email: "TARO@EXAMPLE.COM" });

    assert.equal(res.status, 409);
    assert.match(res.text, /既に登録されています/);

    const row = await queryOne("SELECT count(*)::int AS count FROM users", []);
    assert.equal(row.count, 1);
  });
});

describe("POST /login", () => {
  beforeEach(async () => {
    await signup(request(app));
  });

  it("正しい資格情報ならログインできる", async () => {
    const res = await request(app)
      .post("/login")
      .type("form")
      .send({ email: VALID_SIGNUP.email, password: VALID_SIGNUP.password });

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, "/");
    assert.ok(sessionCookie(res));
  });

  it("メールアドレスの大文字小文字が違ってもログインできる", async () => {
    const res = await request(app)
      .post("/login")
      .type("form")
      .send({ email: "TARO@Example.com", password: VALID_SIGNUP.password });

    assert.equal(res.status, 302);
    assert.ok(sessionCookie(res));
  });

  it("パスワードが違えば 401 を返す", async () => {
    const res = await request(app)
      .post("/login")
      .type("form")
      .send({ email: VALID_SIGNUP.email, password: "wrongpassword" });

    assert.equal(res.status, 401);
    assert.ok(!sessionCookie(res));
  });

  it("未登録のメールとパスワード違いで同じエラーを返す", async () => {
    const unknown = await request(app)
      .post("/login")
      .type("form")
      .send({ email: "nobody@example.com", password: "password123" });
    const wrongPassword = await request(app)
      .post("/login")
      .type("form")
      .send({ email: VALID_SIGNUP.email, password: "wrongpassword" });

    // 本文はフォームに入力値を再表示する分だけ異なるため、エラー表示だけを比べる
    const errorBlock = (res) => res.text.match(/<div class="errors">[\s\S]*?<\/div>/)?.[0];

    assert.equal(unknown.status, wrongPassword.status);
    assert.equal(errorBlock(unknown), errorBlock(wrongPassword));
    assert.match(errorBlock(unknown), /メールアドレスまたはパスワードが正しくありません/);
  });

  it("ログイン後は元のページへ戻す", async () => {
    const res = await request(app)
      .post("/login")
      .type("form")
      .send({ ...VALID_SIGNUP, returnTo: "/teams/1" });

    assert.equal(res.headers.location, "/teams/1");
  });

  it("外部サイトへの returnTo は無視する", async () => {
    const res = await request(app)
      .post("/login")
      .type("form")
      .send({ ...VALID_SIGNUP, returnTo: "//evil.example.com/steal" });

    assert.equal(res.headers.location, "/");
  });
});

describe("認証が必要なページ", () => {
  it("未ログインならログイン画面へリダイレクトする", async () => {
    const res = await request(app).get("/");

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, "/login?returnTo=%2F");
  });

  it("ログイン済みならチーム一覧へ送られる", async () => {
    const agent = request.agent(app);
    await signup(agent);

    const res = await agent.get("/");
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, "/teams");

    const teams = await agent.get("/teams");
    assert.equal(teams.status, 200);
    assert.match(teams.text, /田中太郎/);
  });

  it("改竄された Cookie は未ログインとして扱う", async () => {
    const res = await request(app)
      .get("/")
      .set("Cookie", "session=not.a.valid.token");

    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^\/login/);
  });

  it("ユーザーが削除済みなら未ログインとして扱う", async () => {
    const agent = request.agent(app);
    await signup(agent);
    await queryOne("DELETE FROM users RETURNING id", []);

    const res = await agent.get("/");

    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^\/login/);
  });
});

describe("POST /logout", () => {
  it("Cookie を破棄してログイン画面へ送る", async () => {
    const agent = request.agent(app);
    await signup(agent);

    const res = await agent.post("/logout");

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, "/login");

    const afterLogout = await agent.get("/");
    assert.equal(afterLogout.status, 302);
    assert.match(afterLogout.headers.location, /^\/login/);
  });
});

describe("ログイン済みユーザー", () => {
  it("サインアップ画面を見せずトップへ送る", async () => {
    const agent = request.agent(app);
    await signup(agent);

    const res = await agent.get("/signup");

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, "/");
  });
});
