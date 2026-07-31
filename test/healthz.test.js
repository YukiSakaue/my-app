import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import request from "supertest";

import { createApp } from "../src/app.js";
import { closePool } from "../src/db.js";

const app = createApp();

describe("GET /healthz", () => {
  it("DB に到達できるとき 200 を返す", async () => {
    const res = await request(app).get("/healthz");

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: "ok", database: "ok" });
  });
});

describe("存在しないルート", () => {
  it("404 とエラーページを返す", async () => {
    const res = await request(app).get("/no-such-page");

    assert.equal(res.status, 404);
    assert.match(res.text, /ページが見つかりません/);
  });
});

// pool を閉じて DB 断を再現する。以降このプロセスでは DB を使えないため、
// このファイルの最後に置くこと。
describe("DB に到達できないとき", () => {
  it("/healthz が 503 を返す", async () => {
    await closePool();

    const res = await request(app).get("/healthz");

    assert.equal(res.status, 503);
    assert.equal(res.body.status, "error");
    assert.equal(res.body.database, "unreachable");
  });
});

after(async () => {
  // すでに閉じている場合もあるため失敗は無視する
  await closePool().catch(() => {});
});
