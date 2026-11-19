// Status labels/chips and grade mapping shared across dashboard pages.
// Chip colours ride the status tokens from index.css (--danger/--success and
// friends); consumers of statusChipClass/statusLabel get the same class shapes.
export const statusChipClass = {
  compiled: "border-(--primary-deep)/40 text-(--primary-deep)",
  hod_approved: "border-(--success)/40 text-(--success)",
  hod_rejected: "border-(--danger)/40 text-(--danger)",
  principal_signed: "border-(--primary)/50 text-(--primary)",
  exam_approved: "border-(--success)/40 text-(--success)",
  exam_rejected: "border-(--danger)/40 text-(--danger)",
  published: "border-(--tertiary)/40 text-(--tertiary)",
  draft: "border-(--border) text-(--muted)",
  open: "border-(--primary)/50 text-(--primary)",
  ongoing: "border-(--tertiary)/40 text-(--tertiary)",
  completed: "border-(--success)/40 text-(--success)",
  cancelled: "border-(--danger)/40 text-(--danger)",
  submitted: "border-(--primary)/50 text-(--primary)",
  under_review: "border-(--primary-deep)/40 text-(--primary-deep)",
  approved: "border-(--success)/40 text-(--success)",
  returned: "border-(--danger)/40 text-(--danger)",
};

export const statusLabel = {
  draft: "Draft",
  compiled: "Awaiting HOD review",
  hod_approved: "Approved by HOD",
  hod_rejected: "Sent back by HOD",
  principal_signed: "Ready to publish",
  exam_approved: "Approved by Exam Cell",
  exam_rejected: "Sent back by Exam Cell",
  published: "Published",
  open: "Open",
  ongoing: "Ongoing",
  completed: "Completed",
  cancelled: "Cancelled",
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  returned: "Returned",
};

// Result codes are calculated by the database. P and XP are passing outcomes;
// X means the promotion rules were not met; F is a failed subject; RW means the
// result is officially withheld and is never counted as a backlog.
export const resultCodeLabel = {
  P: "Pass",
  XP: "Pass with backlog",
  X: "Not promoted",
  F: "Fail",
  RW: "Result withheld",
};

export const resultCodeChipClass = {
  P: "border-(--success)/40 text-(--success)",
  XP: "border-(--tertiary)/40 text-(--tertiary)",
  X: "border-(--danger)/40 text-(--danger)",
  F: "border-(--danger)/40 text-(--danger)",
  RW: "border-(--border) text-(--muted)",
};

// Fallback only. Persisted result items carry the grade computed from the
// institution's configured grade bands; this fixed scale is used when a row
// predates that configuration.
export function gradeFor(percentage) {
  if (percentage >= 90) return "O";
  if (percentage >= 80) return "A+";
  if (percentage >= 70) return "A";
  if (percentage >= 60) return "B+";
  if (percentage >= 50) return "B";
  if (percentage >= 40) return "C";
  return "F";
}
