import { Router } from "express";

import { AppError } from "../middleware/errors.js";
import { loadOwnEntry } from "../middleware/time-entries.js";
import { renderTaskDetail } from "./render-task.js";
import { validateTimeEntry } from "../lib/validation.js";
import {
  AlreadyRunningError,
  createManualEntry,
  deleteEntry,
  startTimer,
  stopTimer,
  updateManualEntry,
} from "../models/time-entries.js";

export const timeEntriesRouter = Router({ mergeParams: true });

function taskPath(req) {
  return `/teams/${req.team.id}/tasks/${req.task.id}`;
}

timeEntriesRouter.post("/start", async (req, res, next) => {
  try {
    await startTimer({ taskId: req.task.id, userId: req.user.id });
    res.redirect(taskPath(req));
  } catch (err) {
    if (err instanceof AlreadyRunningError) {
      return renderTaskDetail(req, res, { errors: [err.message], status: 409 });
    }
    next(err);
  }
});

timeEntriesRouter.post("/stop", async (req, res, next) => {
  try {
    const stopped = await stopTimer(req.user.id);
    if (!stopped) {
      return renderTaskDetail(req, res, {
        errors: ["計測中の記録がありません"],
        status: 409,
      });
    }
    res.redirect(taskPath(req));
  } catch (err) {
    next(err);
  }
});

timeEntriesRouter.post("/", async (req, res, next) => {
  const { errors, values } = validateTimeEntry(req.body);

  try {
    if (errors.length > 0) {
      return renderTaskDetail(req, res, { errors, status: 400 });
    }

    await createManualEntry({ taskId: req.task.id, userId: req.user.id, ...values });
    res.redirect(taskPath(req));
  } catch (err) {
    next(err);
  }
});

timeEntriesRouter.get("/:entryId/edit", loadOwnEntry, (req, res, next) => {
  if (req.timeEntry.ended_at === null) {
    return next(new AppError(400, "計測中の記録は、停止してから編集してください"));
  }
  res.render("time-entries/edit", {
    errors: [],
    values: {
      workDate: req.timeEntry.work_date,
      minutes: req.timeEntry.minutes,
      note: req.timeEntry.note ?? "",
    },
  });
});

timeEntriesRouter.post("/:entryId", loadOwnEntry, async (req, res, next) => {
  const { errors, values } = validateTimeEntry(req.body);

  if (errors.length > 0) {
    return res.status(400).render("time-entries/edit", { errors, values });
  }

  try {
    const updated = await updateManualEntry(req.timeEntry.id, values);
    if (!updated) {
      return next(new AppError(400, "計測中の記録は、停止してから編集してください"));
    }
    res.redirect(taskPath(req));
  } catch (err) {
    next(err);
  }
});

timeEntriesRouter.post("/:entryId/delete", loadOwnEntry, async (req, res, next) => {
  try {
    await deleteEntry(req.timeEntry.id);
    res.redirect(taskPath(req));
  } catch (err) {
    next(err);
  }
});
