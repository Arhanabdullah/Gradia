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
};

export const statusLabel = {
  draft: "Draft",
  compiled: "Awaiting HOD review",
  hod_approved: "Awaiting principal sign-off",
  hod_rejected: "Sent back by HOD",
  principal_signed: "Ready to publish",
  published: "Published",
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
