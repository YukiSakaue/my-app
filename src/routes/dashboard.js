import { Router } from "express";

import {
  countUnassignedTasks,
  summarizeMembers,
  summarizeTasks,
} from "../models/reports.js";

export const dashboardRouter = Router({ mergeParams: true });

// loadTeam の後段に置く。所属確認は済んでいる。
dashboardRouter.get("/", async (req, res, next) => {
  try {
    const [members, tasks, unassignedCount] = await Promise.all([
      summarizeMembers(req.team.id),
      summarizeTasks(req.team.id),
      countUnassignedTasks(req.team.id),
    ]);

    res.render("dashboard", { members, tasks, unassignedCount });
  } catch (err) {
    next(err);
  }
});
