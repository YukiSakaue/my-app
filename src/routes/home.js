import { Router } from "express";

import { requireAuth } from "../middleware/auth.js";

export const homeRouter = Router();

// フェーズ3以降でチーム一覧・タスク一覧に置き換える
homeRouter.get("/", requireAuth, (req, res) => {
  res.render("home");
});
