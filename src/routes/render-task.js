import { listStatusHistory } from "../models/tasks.js";
import { listEntriesForTask, sumMinutesForTask } from "../models/time-entries.js";

/**
 * タスク詳細の描画。タスク側と作業時間側の両方から使うため切り出してある。
 * 合計時間は SQL の集約で求める。
 */
export async function renderTaskDetail(req, res, { errors = [], status = 200 } = {}) {
  const [history, entries, totalMinutes] = await Promise.all([
    listStatusHistory(req.task.id),
    listEntriesForTask(req.task.id),
    sumMinutesForTask(req.task.id),
  ]);

  res.status(status).render("tasks/show", { history, entries, totalMinutes, errors });
}
