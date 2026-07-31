import { Router } from "express";

import { requireAuth } from "../middleware/auth.js";

export const homeRouter = Router();

// 入り口は所属チームの一覧。タスク機能はフェーズ4以降でチーム配下に追加する。
homeRouter.get("/", requireAuth, (req, res) => {
  res.redirect("/teams");
});
