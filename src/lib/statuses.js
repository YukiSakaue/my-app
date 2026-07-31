export const TASK_STATUSES = ["todo", "in_progress", "review", "done"];

const LABELS = {
  todo: "未着手",
  in_progress: "作業中",
  review: "レビュー中",
  done: "完了",
};

export const DEFAULT_STATUS = "todo";

export function isValidStatus(value) {
  return TASK_STATUSES.includes(value);
}

export function statusLabel(value) {
  return LABELS[value] ?? value;
}

/** 画面のプルダウン用。表示順は仕様の並び（todo → done）に合わせる。 */
export function statusOptions() {
  return TASK_STATUSES.map((value) => ({ value, label: LABELS[value] }));
}
