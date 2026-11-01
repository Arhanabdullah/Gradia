// Status labels/chips and grade mapping shared across dashboard pages.
export const statusChipClass = {
  compiled: "border-amber-500/40 text-amber-500",
  hod_approved: "border-emerald-500/40 text-emerald-500",
  hod_rejected: "border-red-500/40 text-red-500",
  principal_signed: "border-(--primary)/50 text-(--primary)",
  published: "border-sky-500/40 text-sky-500",
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
