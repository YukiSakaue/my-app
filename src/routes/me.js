import { Router } from "express";

import { requireAuth } from "../middleware/auth.js";
import { listMyTasks, summarizeRecentWork } from "../models/reports.js";

export const meRouter = Router();

// 個人ビューは所属している全チームを横断して見せる
meRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const [tasks, recentWork] = await Promise.all([
      listMyTasks(req.user.id),
      summarizeRecentWork(req.user.id),
    ]);

    const totalMinutes = recentWork.reduce((sum, day) => sum + day.minutes, 0);
    const maxMinutes = Math.max(...recentWork.map((day) => day.minutes), 0);

    res.render("me", { tasks, recentWork, totalMinutes, maxMinutes });
  } catch (err) {
    next(err);
  }
});
