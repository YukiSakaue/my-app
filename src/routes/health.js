import { Router } from "express";

import { checkConnection } from "../db.js";

export const healthRouter = Router();

// デプロイ先の死活監視用。DB に到達できなければ 503 を返し、
// 「プロセスは生きているが DB が死んでいる」状態を検知できるようにする。
healthRouter.get("/healthz", async (req, res) => {
  try {
    await checkConnection();
    res.json({ status: "ok", database: "ok" });
  } catch (err) {
    console.error("[healthz] database check failed:", err);
    res.status(503).json({ status: "error", database: "unreachable" });
  }
});
