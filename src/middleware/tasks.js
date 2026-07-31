import { ROLES } from "../models/teams.js";
import { findTask } from "../models/tasks.js";
import { AppError } from "./errors.js";

/**
 * URL の :taskId を読み込み、req.task を埋める。
 * loadTeam の後段に置くこと。チーム外・削除済みのタスクは 404 になる。
 */
export async function loadTask(req, res, next) {
  const taskId = Number(req.params.taskId);
  if (!Number.isInteger(taskId)) {
    return next(new AppError(404, "タスクが見つかりません"));
  }

  try {
    const task = await findTask(req.team.id, taskId);
    if (!task) {
      return next(new AppError(404, "タスクが見つかりません"));
    }

    req.task = task;
    res.locals.task = task;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * ステータス変更はリーダーか、そのタスクの担当者本人だけに許す。
 * （仕様の権限表「自分に割り当てられたタスクのステータス変更」）
 */
export function requireStatusChangePermission(req, res, next) {
  const isLeader = req.membership?.role === ROLES.LEADER;
  const isAssignee = req.task.assignee_id === req.user.id;

  if (!isLeader && !isAssignee) {
    return next(
      new AppError(403, "自分が担当しているタスクのステータスだけ変更できます")
    );
  }
  next();
}
