import { Router } from "express";

import { AppError } from "../middleware/errors.js";
import { loadTask, requireStatusChangePermission } from "../middleware/tasks.js";
import { requireLeader } from "../middleware/teams.js";
import { isValidStatus } from "../lib/statuses.js";
import { validateTask } from "../lib/validation.js";
import { listMembers } from "../models/teams.js";
import {
  DEFAULT_SORT,
  changeStatus,
  createTask,
  isValidSort,
  listStatusHistory,
  listTasks,
  softDeleteTask,
  updateTask,
} from "../models/tasks.js";

export const tasksRouter = Router({ mergeParams: true });

const EMPTY_VALUES = {
  title: "",
  description: "",
  assigneeId: null,
  dueDate: null,
  estimatedMinutes: null,
};

/** 担当者に指定できるのは、そのチームのメンバーだけ。 */
async function assertAssigneeInTeam(teamId, assigneeId) {
  if (assigneeId === null) {
    return true;
  }
  const members = await listMembers(teamId);
  return members.some((member) => member.id === assigneeId);
}

tasksRouter.get("/", async (req, res, next) => {
  try {
    const status = isValidStatus(req.query.status) ? req.query.status : null;
    const sort = isValidSort(req.query.sort) ? req.query.sort : DEFAULT_SORT;
    const assigneeId =
      req.query.assignee === "none" ? "none" : Number(req.query.assignee) || null;

    const [tasks, members] = await Promise.all([
      listTasks(req.team.id, { status, assigneeId, sort }),
      listMembers(req.team.id),
    ]);

    res.render("tasks/index", {
      tasks,
      members,
      filters: { status, assignee: req.query.assignee ?? "", sort },
    });
  } catch (err) {
    next(err);
  }
});

tasksRouter.get("/new", requireLeader, async (req, res, next) => {
  try {
    const members = await listMembers(req.team.id);
    res.render("tasks/new", { members, errors: [], values: EMPTY_VALUES });
  } catch (err) {
    next(err);
  }
});

tasksRouter.post("/", requireLeader, async (req, res, next) => {
  const { errors, values } = validateTask(req.body);

  try {
    if (errors.length === 0 && !(await assertAssigneeInTeam(req.team.id, values.assigneeId))) {
      errors.push("担当者はチームのメンバーから選んでください");
    }
    if (errors.length > 0) {
      const members = await listMembers(req.team.id);
      return res.status(400).render("tasks/new", { members, errors, values });
    }

    const task = await createTask({
      teamId: req.team.id,
      createdBy: req.user.id,
      ...values,
    });
    res.redirect(`/teams/${req.team.id}/tasks/${task.id}`);
  } catch (err) {
    next(err);
  }
});

tasksRouter.get("/:taskId", loadTask, async (req, res, next) => {
  try {
    const history = await listStatusHistory(req.task.id);
    res.render("tasks/show", { history, errors: [] });
  } catch (err) {
    next(err);
  }
});

tasksRouter.get("/:taskId/edit", loadTask, requireLeader, async (req, res, next) => {
  try {
    const members = await listMembers(req.team.id);
    res.render("tasks/edit", {
      members,
      errors: [],
      values: {
        title: req.task.title,
        description: req.task.description,
        assigneeId: req.task.assignee_id,
        dueDate: req.task.due_date,
        estimatedMinutes: req.task.estimated_minutes,
      },
    });
  } catch (err) {
    next(err);
  }
});

tasksRouter.post("/:taskId", loadTask, requireLeader, async (req, res, next) => {
  const { errors, values } = validateTask(req.body);

  try {
    if (errors.length === 0 && !(await assertAssigneeInTeam(req.team.id, values.assigneeId))) {
      errors.push("担当者はチームのメンバーから選んでください");
    }
    if (errors.length > 0) {
      const members = await listMembers(req.team.id);
      return res.status(400).render("tasks/edit", { members, errors, values });
    }

    await updateTask(req.task.id, values);
    res.redirect(`/teams/${req.team.id}/tasks/${req.task.id}`);
  } catch (err) {
    next(err);
  }
});

tasksRouter.post(
  "/:taskId/status",
  loadTask,
  requireStatusChangePermission,
  async (req, res, next) => {
    const toStatus = String(req.body.status ?? "");
    if (!isValidStatus(toStatus)) {
      return next(new AppError(400, "指定されたステータスが不正です"));
    }

    try {
      if (toStatus !== req.task.status) {
        const changed = await changeStatus(req.task.id, {
          fromStatus: req.task.status,
          toStatus,
          changedBy: req.user.id,
        });
        if (!changed) {
          // 表示していた画面の後に誰かが先に変更した場合
          return next(
            new AppError(409, "別の変更が先に反映されました。画面を開き直してください")
          );
        }
      }
      res.redirect(`/teams/${req.team.id}/tasks/${req.task.id}`);
    } catch (err) {
      next(err);
    }
  }
);

tasksRouter.post("/:taskId/delete", loadTask, requireLeader, async (req, res, next) => {
  try {
    await softDeleteTask(req.task.id);
    res.redirect(`/teams/${req.team.id}/tasks`);
  } catch (err) {
    next(err);
  }
});
