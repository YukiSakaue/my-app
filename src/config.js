// 設定はすべて環境変数から読む。値が欠けたまま起動して実行時に落ちるのを防ぐため、
// 起動時にここでまとめて検証する。

const REQUIRED_KEYS = ["DATABASE_URL", "JWT_SECRET"];

const LOCAL_HOST_PATTERN = /@(localhost|127\.0\.0\.1)([:/]|$)/;

function isLocalDatabase(databaseUrl) {
  return LOCAL_HOST_PATTERN.test(databaseUrl);
}

export function loadConfig(env = process.env) {
  const missing = REQUIRED_KEYS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(
      `環境変数が設定されていません: ${missing.join(", ")}。.env または Render の Environment を確認してください`
    );
  }

  const nodeEnv = env.NODE_ENV ?? "development";
  const databaseUrl = env.DATABASE_URL;

  // テストは各テーブルを truncate しながら回すため、本番 DB を指したまま実行すると
  // データを破壊する。ローカル以外を向いていたら起動させない。
  if (nodeEnv === "test" && !isLocalDatabase(databaseUrl)) {
    throw new Error(
      "テスト実行時の DATABASE_URL はローカルの PostgreSQL でなければなりません。.env.test を確認してください"
    );
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT が不正です: ${env.PORT}`);
  }

  // SSL は接続文字列の sslmode で指定する（Render は sslmode=verify-full、
  // ローカルは指定なしで平文）。コード側で証明書検証を無効化しないこと。
  return {
    nodeEnv,
    isTest: nodeEnv === "test",
    port,
    databaseUrl,
    jwtSecret: env.JWT_SECRET,
  };
}

export const config = loadConfig();
