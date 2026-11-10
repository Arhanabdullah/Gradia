// Status labels/chips and grade mapping shared across dashboard pages.
// Chip colours ride the status tokens from index.css (--danger/--success and
// friends); consumers of statusChipClass/statusLabel get the same class shapes.
export const statusChipClass = {
  compiled: "border-(--primary-deep)/40 text-(--primary-deep)",
  hod_approved: "border-(--success)/40 text-(--success)",
  hod_rejected: "border-(--danger)/40 text-(--danger)",
  principal_signed: "border-(--primary)/50 text-(--primary)",
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
  hod_approved: "Awaiting principal sign-off",
  hod_rejected: "Sent back by HOD",
  principal_signed: "Ready to publish",
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

export function gradeFor(percentage) {
  if (percentage >= 90) return "A+";
  if (percentage >= 80) return "A";
  if (percentage >= 70) return "B+";
  if (percentage >= 60) return "B";
  if (percentage >= 50) return "C";
  if (percentage >= 40) return "D";
  return "F";
}
