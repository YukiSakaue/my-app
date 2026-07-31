import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();

// Render はコンテナ外からの接続を受けるため 0.0.0.0 で待ち受ける必要がある。
// ポートは環境変数から取り、ハードコードしない。
const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`Server is running on http://localhost:${config.port}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`${signal} を受信しました。停止します`);
    server.close(() => process.exit(0));
  });
}
