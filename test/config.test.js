import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadConfig } from "../src/config.js";

const LOCAL_URL = "postgresql://myapp:myapp@localhost:5432/my_app_test";
const REMOTE_URL = "postgresql://u:p@db.example.render.com/prod?sslmode=verify-full";

describe("loadConfig", () => {
  it("必須の環境変数が欠けていたら起動を止める", () => {
    assert.throws(
      () => loadConfig({ DATABASE_URL: LOCAL_URL }),
      /JWT_SECRET/
    );
  });

  it("テスト実行時にリモート DB を指していたら起動を止める", () => {
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: "test",
          DATABASE_URL: REMOTE_URL,
          JWT_SECRET: "s",
        }),
      /ローカル/
    );
  });

  it("テスト実行時でもローカル DB なら通す", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: LOCAL_URL,
      JWT_SECRET: "s",
    });

    assert.equal(config.isTest, true);
    assert.equal(config.databaseUrl, LOCAL_URL);
  });

  it("PORT 未指定なら 3000 を使う", () => {
    const config = loadConfig({ DATABASE_URL: LOCAL_URL, JWT_SECRET: "s" });

    assert.equal(config.port, 3000);
  });

  it("PORT が数値でなければ起動を止める", () => {
    assert.throws(
      () => loadConfig({ DATABASE_URL: LOCAL_URL, JWT_SECRET: "s", PORT: "abc" }),
      /PORT/
    );
  });
});
