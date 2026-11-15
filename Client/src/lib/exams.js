// Examination constants and shared helpers.
//
// The database keeps one `exams` row per class because marks and result sheets
// point at it. `exam_groups` is the scheduling container, so every screen treats
// a group as one examination and reads its per-class rows from `group.exams`.

export const EXAM_TYPES = [
  { id: "class_test", label: "Quiz", teachers: true },
  { id: "unit_test", label: "Unit test", teachers: true },
  { id: "internal_assessment", label: "Internal assessment", teachers: true },
  { id: "mid_term", label: "Mid-term", teachers: false },
  { id: "semester", label: "End-Semester", teachers: false },
  { id: "practical", label: "Practical", teachers: true },
  { id: "assignment", label: "Assignment", teachers: true },
  { id: "major", label: "Major", teachers: false },
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
  if (role === "admin" || role === "exam_cell") return EXAM_TYPES;
  return [];
}

export function isRegularExamType(type) {
  return REGULAR_EXAM_TYPES.includes(type);
}

export function examTypeLabel(type) {
  return EXAM_TYPE_LABEL[type] ?? type ?? "Examination";
}

// ---------- official result classification ----------
// An examination either produces an internal assessment (dashboard only) or
// an official semester result (the only kind that can issue a grade card).
// `auto` follows the examination type; the database resolves the same way.
export const RESULT_KINDS = [
  { id: "auto", label: "Follow the examination type" },
  { id: "internal", label: "Internal assessment" },
  { id: "semester", label: "Semester result" },
];

export const SEMESTER_EXAM_TYPES = ["semester", "final", "major"];

export function resolvedResultKind(exam) {
  if (!exam) return "internal";
  if (exam.result_kind === "internal" || exam.result_kind === "semester") return exam.result_kind;
  return SEMESTER_EXAM_TYPES.includes(exam.exam_type) ? "semester" : "internal";
}

export function resultKindLabel(kind) {
  return kind === "semester" ? "Semester result" : "Internal assessment";
}

// A published sheet stores the kind it was compiled as. Only a semester sheet
// is an official result; internal assessments never print a grade card.
export function isSemesterSheet(sheet) {
  return sheet?.result_kind === "semester";
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

// Date helpers for the examination calendar. Dates are stored as plain
// `YYYY-MM-DD`, so they are parsed at local midnight to avoid a day shift.
export function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Earliest paper first; undated papers sort last.
export function comparePapers(a, b) {
  const left = `${a?.date || "9999-12-31"} ${a?.start || "99:99"}`;
  const right = `${b?.date || "9999-12-31"} ${b?.start || "99:99"}`;
  return left.localeCompare(right);
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

export function groupHasPendingPublication(group) {
  const marksPending = groupSubmissions(group).some(
    (row) => row.status === "submitted" || row.status === "under_review",
  );
  const sheetPending = groupSheets(group).some((sheet) =>
    ["compiled", "hod_approved", "exam_approved", "principal_signed"].includes(sheet.status),
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

// ---------- practical subjects and component papers ----------
// A practical subject is either typed as a lab or carries an LS code. The
// database resolves the same way (`public.is_practical_subject`), so the
// client only hides options the server would reject.
export function isPracticalSubject(subject) {
  if (!subject) return false;
  if (subject.subject_type === "lab") return true;
  return /^LS[0-9]/i.test(subject.code ?? "");
}

export function subjectFamily(subject) {
  return isPracticalSubject(subject) ? "lab" : (subject?.subject_type ?? "theory");
}

// A semester examination carries one schedulable paper per assessment
// component. Internal examinations keep the legacy single subject paper.
export function isComponentPaperExam(exam) {
  return resolvedResultKind(exam) === "semester";
}

export function examSubjectComponents(examSubject) {
  return examSubject?.assessment_components ?? [];
}

export function conductedComponents(examSubject) {
  return examSubjectComponents(examSubject).filter((row) => row.is_conducted !== false);
}

// Practical subjects never sit in an internal assessment. A practical
// examination takes practical subjects only. A semester examination takes
// both, but a practical subject only carries its practical papers.
export function subjectAllowedInExam(subject, examType) {
  const practical = isPracticalSubject(subject);
  if (examType === "practical") return practical;
  if (SEMESTER_EXAM_TYPES.includes(examType)) return true;
  return !practical;
}

export function componentPaperLabel(component) {
  if (!component) return "Paper";
  return component.name ?? component.code ?? "Paper";
}

// "IA 1, CS201 Data Structures" for calendar chips and the upcoming list.
export function paperTitle(paper) {
  if (!paper) return "Paper";
  const subject = paper.subjectCode ? `${paper.subjectCode} ${paper.subjectName}` : paper.subjectName;
  return paper.component?.name ? `${paper.component.name}, ${subject}` : subject;
}

// ---------- formal papers and classwork ----------
// A component is classwork when the structure says so, with a code fallback
// for rows created before the schedule mode existed. Classwork is marked but
// never invigilated, so it has no date, room or invigilator.
export const CLASSWORK_CODES = new Set(["QUIZ", "ASSIGNMENT", "PROJECT", "PRACTICAL_RECORD"]);

export function isClassworkComponent(component) {
  if (!component) return false;
  if (component.schedule_mode) return component.schedule_mode === "classwork";
  return CLASSWORK_CODES.has(String(component.code ?? "").toUpperCase());
}

export function isFormalComponent(component) {
  return !isClassworkComponent(component);
}

// Minutes a paper runs for, from the stored duration or the clock range.
export function componentDuration(component) {
  if (!component) return null;
  if (component.duration_minutes != null) return Number(component.duration_minutes);
  if (component.start_time && component.end_time) {
    const [sh, sm] = component.start_time.split(":").map(Number);
    const [eh, em] = component.end_time.split(":").map(Number);
    const minutes = eh * 60 + em - (sh * 60 + sm);
    return minutes > 0 ? minutes : null;
  }
  return null;
}

export function addMinutesToClock(start, minutes) {
  if (!start || !Number.isFinite(Number(minutes))) return "";
  const [hours, mins] = start.split(":").map(Number);
  const total = (hours * 60 + mins + Number(minutes)) % (24 * 60);
  const nextHours = String(Math.floor(total / 60)).padStart(2, "0");
  const nextMins = String(total % 60).padStart(2, "0");
  return `${nextHours}:${nextMins}`;
}

export function teacherLabel(teacher) {
  if (!teacher) return "";
  const identifier = teacher.teacher_id || teacher.username;
  return identifier ? `${teacher.name} (${identifier})` : teacher.name;
}
