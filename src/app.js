import { fileURLToPath } from "node:url";

import cookieParser from "cookie-parser";
import express from "express";

import { attachUser } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { healthRouter } from "./routes/health.js";
import { homeRouter } from "./routes/home.js";
import { teamsRouter } from "./routes/teams.js";
import { errorHandler, notFound } from "./middleware/errors.js";

// テストから supertest で直接使えるよう、ここでは listen しない。
export function createApp() {
  const app = express();

  app.set("view engine", "ejs");
  // 起動時のカレントディレクトリに依存しないよう、このファイルからの相対で解決する
  app.set("views", fileURLToPath(new URL("../views", import.meta.url)));

  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  // 死活監視は認証の前に置く（ログインできない状態でも監視は通したい）
  app.use(healthRouter);

  // 以降のすべてのルートで req.user / res.locals.currentUser が使えるようにする
  app.use(attachUser);

  app.use(authRouter);
  app.use(homeRouter);
  // teamsRouter はルーター全体に requireAuth をかけるため、必ず /teams 配下に
  // マウントする。app 直下に置くと無関係な URL の 404 まで認証で横取りされる。
  app.use("/teams", teamsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
