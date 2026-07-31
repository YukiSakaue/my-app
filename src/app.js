import { fileURLToPath } from "node:url";

import express from "express";

import { healthRouter } from "./routes/health.js";
import { errorHandler, notFound } from "./middleware/errors.js";

// テストから supertest で直接使えるよう、ここでは listen しない。
export function createApp() {
  const app = express();

  app.set("view engine", "ejs");
  // 起動時のカレントディレクトリに依存しないよう、このファイルからの相対で解決する
  app.set("views", fileURLToPath(new URL("../views", import.meta.url)));

  app.use(express.urlencoded({ extended: false }));

  app.use(healthRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
