// Examination constants and shared helpers.
//
// The database keeps one `exams` row per class because marks and result sheets
// point at it. `exam_groups` is the scheduling container, so every screen treats
// a group as one examination and reads its per-class rows from `group.exams`.

export const EXAM_TYPES = [
  { id: "class_test", label: "Class test", teachers: true },
  { id: "unit_test", label: "Unit test", teachers: true },
  { id: "internal_assessment", label: "Internal assessment", teachers: true },
  { id: "mid_term", label: "Mid-term", teachers: false },
  { id: "semester", label: "Semester", teachers: false },
  { id: "practical", label: "Practical", teachers: true },
  { id: "assignment", label: "Assignment", teachers: true },
  { id: "major", label: "Major", teachers: false },
  { id: "final", label: "Final", teachers: false },
];

// Legacy rows created before exam types existed carry `standard`.
export const LEGACY_EXAM_TYPE = "standard";

export const REGULAR_EXAM_TYPES = EXAM_TYPES.filter((type) => type.teachers).map((type) => type.id);

export const EXAM_TYPE_LABEL = {
  ...Object.fromEntries(EXAM_TYPES.map((type) => [type.id, type.label])),
  [LEGACY_EXAM_TYPE]: "Examination",
};

export const EXAM_STATUSES = [
  { id: "draft", label: "Draft" },
  { id: "open", label: "Open" },
  { id: "ongoing", label: "Ongoing" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

export const EXAM_STATUS_LABEL = Object.fromEntries(EXAM_STATUSES.map((status) => [status.id, status.label]));

export const SUBMISSION_STATUSES = [
  { id: "draft", label: "Draft" },
  { id: "submitted", label: "Submitted" },
  { id: "under_review", label: "Under review" },
  { id: "approved", label: "Approved" },
  { id: "returned", label: "Returned" },
];

export const SUBMISSION_STATUS_LABEL = Object.fromEntries(
  SUBMISSION_STATUSES.map((status) => [status.id, status.label]),
);

export const MARK_STATUSES = [
  { id: "present", label: "Present" },
  { id: "absent", label: "Absent" },
  { id: "exempt", label: "Exempt" },
  { id: "withheld", label: "Withheld" },
];

export function examTypesForRole(role) {
  if (role === "teacher") return EXAM_TYPES.filter((type) => type.teachers);
  if (role === "admin") return EXAM_TYPES;
  return [];
}

export function isRegularExamType(type) {
  return REGULAR_EXAM_TYPES.includes(type);
}

export function examTypeLabel(type) {
  return EXAM_TYPE_LABEL[type] ?? type ?? "Examination";
}

export function examStatusLabel(status) {
  return EXAM_STATUS_LABEL[status] ?? status ?? "Draft";
}

export function submissionStatusLabel(status) {
  return SUBMISSION_STATUS_LABEL[status] ?? status ?? "Not submitted";
}

export function formatExamDate(value) {
  if (!value) return "Not scheduled";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatClock(value) {
  if (!value) return "";
  return value.slice(0, 5);
}

export function timeRange(start, end) {
  if (!start && !end) return "Time not set";
  if (!start) return `Until ${formatClock(end)}`;
  if (!end) return `From ${formatClock(start)}`;
  return `${formatClock(start)} to ${formatClock(end)}`;
}

export function todayKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function groupExams(group) {
  return group?.exams ?? [];
}

export function groupSubjects(group) {
  return groupExams(group).flatMap((exam) => (exam.exam_subjects ?? []).map((subject) => ({ ...subject, exam })));
}

export function groupSubmissions(group) {
  return groupExams(group).flatMap((exam) => (exam.exam_submissions ?? []).map((row) => ({ ...row, exam })));
}

export function groupSheets(group) {
  return groupExams(group).flatMap((exam) => (exam.result_sheets ?? []).map((sheet) => ({ ...sheet, exam })));
}

// Upcoming, ongoing and completed are derived from the stored dates first and
// the explicit status second, so a group left in "open" still behaves correctly
// once its dates pass.
export function groupTimeBucket(group, today = todayKey()) {
  const status = group?.status;
  if (status === "cancelled" || status === "completed") return "completed";
  if (status === "ongoing") return "ongoing";

  const { starts_on: startsOn, ends_on: endsOn } = group ?? {};
  if (endsOn && endsOn < today) return "completed";
  if (startsOn && startsOn > today) return "upcoming";
  if (startsOn && (!endsOn || endsOn >= today) && startsOn <= today) return "ongoing";
  if (status === "open") return "upcoming";
  return "upcoming";
}

export function groupIsPublished(group) {
  return groupSheets(group).some((sheet) => sheet.status === "published");
}

export function groupHasPendingApproval(group) {
  const marksPending = groupSubmissions(group).some(
    (row) => row.status === "submitted" || row.status === "under_review",
  );
  const sheetPending = groupSheets(group).some((sheet) =>
    ["compiled", "hod_approved", "principal_signed"].includes(sheet.status),
  );
  return marksPending || sheetPending;
}

export function groupHasPendingMarks(group) {
  if (groupIsPublished(group)) return false;
  return groupExams(group).some((exam) => {
    const submissions = exam.exam_submissions ?? [];
    return (exam.exam_subjects ?? []).some((subject) => {
      const submission = submissions.find((row) => row.subject_id === subject.subject_id);
      return !submission || submission.status === "draft" || submission.status === "returned";
    });
  });
}

export function groupSubjectStatus(group, subjectId) {
  const rows = groupSubmissions(group).filter((row) => row.subject_id === subjectId);
  if (rows.length === 0) return "draft";
  if (rows.some((row) => row.status === "returned")) return "returned";
  if (rows.some((row) => row.status === "submitted" || row.status === "under_review")) {
    return rows.some((row) => row.status === "submitted") ? "submitted" : "under_review";
  }
  if (rows.every((row) => row.status === "approved")) return "approved";
  return rows[0].status;
}

export function groupStatusSummary(group) {
  const subjects = groupSubjects(group);
  const total = subjects.length;
  const approved = subjects.filter((subject) => groupSubjectStatus(group, subject.subject_id) === "approved").length;
  const pending = subjects.filter((subject) => {
    const status = groupSubjectStatus(group, subject.subject_id);
    return status === "submitted" || status === "under_review";
  }).length;
  const missing = subjects.filter((subject) => {
    const status = groupSubjectStatus(group, subject.subject_id);
    return status === "draft" || status === "returned";
  }).length;
  return { total, approved, pending, missing };
}

export function derivedBatch(klass) {
  if (!klass) return "";
  const parts = [];
  if (klass.academic_year) parts.push(klass.academic_year);
  if (klass.semester != null) parts.push(`Sem ${klass.semester}`);
  if (klass.section) parts.push(`Section ${klass.section}`);
  return parts.length ? parts.join(", ") : klass.name;
}

export function batchKey(klass) {
  if (!klass) return "";
  return [klass.academic_year ?? "", klass.semester ?? "", klass.section ?? ""].join("|");
}

export function subjectLabel(subject) {
  if (!subject) return "Subject";
  return subject.code ? `${subject.code} ${subject.name}` : subject.name;
}

export function teacherLabel(teacher) {
  if (!teacher) return "";
  const identifier = teacher.teacher_id || teacher.username;
  return identifier ? `${teacher.name} (${identifier})` : teacher.name;
}
