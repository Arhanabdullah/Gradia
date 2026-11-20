// Examination constants and shared helpers.
//
// The database keeps one `exams` row per class because marks and result sheets
// point at it. `exam_groups` is the scheduling container, so every screen treats
// a group as one examination and reads its per-class rows from `group.exams`.

// Database examination types. These are the values stored in `exam_groups` and
// `exams`, and the grading engine, RLS helpers and triggers key off them, so the
// stored taxonomy is kept intact. The interface exposes the seven activity types
// below and maps them onto these values.
export const EXAM_TYPES = [
  { id: "class_test", label: "Quiz", teachers: true },
  { id: "unit_test", label: "IA1", teachers: true },
  { id: "internal_assessment", label: "Viva", teachers: true },
  { id: "mid_term", label: "IA2", teachers: false },
  { id: "semester", label: "ESA", teachers: false },
  { id: "practical", label: "Practical", teachers: true },
  { id: "assignment", label: "Project", teachers: true },
  { id: "major", label: "ESA", teachers: false },
];

// Legacy activity labels for stored examination types. The semester workflow
// uses component codes for papers, but these names remain in marks screens and
// import templates, so the mapping between a type and its label stays here.
export const ACTIVITY_TYPES = [
  { id: "ia1", label: "IA1", examType: "unit_test", teachers: true, classwork: false, scheduling: true },
  { id: "ia2", label: "IA2", examType: "mid_term", teachers: false, classwork: false, scheduling: true },
  { id: "esa", label: "ESA", examType: "semester", teachers: false, classwork: false, scheduling: true },
  { id: "project", label: "Project", examType: "assignment", teachers: true, classwork: true, scheduling: false },
  { id: "practical", label: "Practical", examType: "practical", teachers: true, classwork: false, scheduling: true },
  { id: "viva", label: "Viva", examType: "internal_assessment", teachers: true, classwork: false, scheduling: true },
  // Quiz joins assignment and project as classwork: no scheduled date or room.
  { id: "quiz", label: "Quiz", examType: "class_test", teachers: true, classwork: true, scheduling: false },
];

export const ACTIVITY_TYPE_LABEL = Object.fromEntries(
  ACTIVITY_TYPES.map((type) => [type.id, type.label]),
);

export const CLASSWORK_KIND_LABEL = { assignment: "Assignment", quiz: "Quiz", project: "Project" };

const EXAM_TYPE_TO_ACTIVITY = {
  class_test: "quiz",
  unit_test: "ia1",
  internal_assessment: "viva",
  mid_term: "ia2",
  semester: "esa",
  final: "esa",
  major: "esa",
  practical: "practical",
  assignment: "project",
  standard: "ia1",
};

// Legacy rows created before exam types existed carry `standard`.
export const LEGACY_EXAM_TYPE = "standard";

export const REGULAR_EXAM_TYPES = EXAM_TYPES.filter((type) => type.teachers).map((type) => type.id);

export const EXAM_TYPE_LABEL = {
  ...Object.fromEntries(EXAM_TYPES.map((type) => [type.id, type.label])),
  [LEGACY_EXAM_TYPE]: "Examination",
  final: "ESA",
};

// Maps a stored examination type (or an activity id) to a UI activity label.
// Unknown legacy values fall back to IA1.
export function activityForExamType(type) {
  if (!type) return "";
  if (ACTIVITY_TYPE_LABEL[type]) return type;
  return EXAM_TYPE_TO_ACTIVITY[type] ?? "ia1";
}

// A paper's activity type: the component code wins, then the examination type.
export function activityForComponent(component, examType) {
  const code = String(component?.code ?? "").toUpperCase();
  if (code) {
    if (code.startsWith("IA1") || code === "IA-1") return "ia1";
    if (code.startsWith("IA2") || code === "IA-2") return "ia2";
    if (code.startsWith("ESA")) return "esa";
    if (code.startsWith("PROJECT")) return "project";
    if (code.startsWith("QUIZ")) return "quiz";
    if (code.startsWith("VIVA")) return "viva";
    if (code.startsWith("PRACTICAL")) return "practical";
    if (code.startsWith("ASSIGNMENT")) return "project";
  }
  return activityForExamType(examType);
}

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

export function examTypeLabel(type) {
  if (!type) return "Examination";
  if (ACTIVITY_TYPE_LABEL[type]) return ACTIVITY_TYPE_LABEL[type];
  const activity = EXAM_TYPE_TO_ACTIVITY[type];
  if (activity) return ACTIVITY_TYPE_LABEL[activity];
  return EXAM_TYPE_LABEL[type] ?? type;
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

// A single paper is upcoming, ongoing (today) or completed, read from its own
// date instead of the group window. The semester workflow schedules each paper
// inside one class examination, so the paper date is the only source of truth.
export function paperTimeBucket(paper, today = todayKey()) {
  if (!paper?.date) return "unscheduled";
  if (paper.date > today) return "upcoming";
  if (paper.date === today) return "ongoing";
  return "completed";
}

export const PAPER_BUCKET_LABEL = {
  upcoming: "Upcoming",
  ongoing: "Ongoing",
  completed: "Completed",
  unscheduled: "Not scheduled",
};

// One semester examination per class, or one shared group per course for the
// department structure. The group holds the class exam rows, and each class
// exam carries the subject papers.
export function semesterGroupForClass(groups, classId) {
  if (!classId) return null;
  return (
    (groups ?? []).find((group) =>
      (group.exams ?? []).some(
        (exam) => exam.class_id === classId && resolvedResultKind(exam) === "semester",
      ),
    ) ?? null
  );
}

export function semesterPapers(groups) {
  return flattenPapers(groups).filter((paper) => paper.resultKind === "semester");
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
// never scheduled, so it has no date or room.
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

// ---------- paper flattening ----------
// One schedulable paper per row: a semester subject contributes one row per
// assessment component, everything else contributes its single subject paper.
export function flattenPapers(groups) {
  const list = [];
  (groups ?? []).forEach((group) => {
    (group.exams ?? []).forEach((exam) => {
      (exam.exam_subjects ?? []).forEach((examSubject) => {
        const components = examSubject.assessment_components ?? [];
        if (resolvedResultKind(exam) === "semester" && components.length > 0) {
          components.forEach((component) => {
            list.push(makePaper(group, exam, examSubject, component));
          });
          return;
        }
        list.push(makePaper(group, exam, examSubject, null));
      });
    });
  });
  return list;
}

export function makePaper(group, exam, examSubject, component) {
  const subject = examSubject.subjects ?? {};
  const klass = exam.classes ?? {};
  return {
    key: component?.id ?? examSubject.id,
    group,
    exam,
    examId: exam.id,
    examSubject,
    component,
    subject,
    subjectId: examSubject.subject_id,
    subjectName: subject.name ?? "Subject",
    subjectCode: subject.code ?? "",
    subjectType: subject.subject_type ?? "theory",
    classId: exam.class_id,
    className: klass.name ?? "Class",
    courseId: klass.course_id ?? group.course_id ?? "",
    courseName: klass.courses?.name ?? group.courses?.name ?? "",
    departmentId: klass.courses?.department_id ?? group.department_id ?? "",
    degreeId: klass.degree_id ?? "",
    semester: klass.semester ?? null,
    academicYear: klass.academic_year ?? exam.academic_year ?? group.academic_year ?? "",
    // The filter compares this stable key; `batch` stays the display label.
    batchKey: batchKey(klass),
    batch: derivedBatch(klass),
    examType: group.exam_type,
    examName: group.name,
    activity: activityForComponent(component, group.exam_type),
    componentType: component?.component_type ?? group.exam_type,
    classwork: isClassworkComponent(component),
    conducted: component ? component.is_conducted !== false : true,
    // A component paper carries its own schedule. Falling back to the subject
    // roll-up date would put an undated classwork row on the ESA date.
    date: component ? component.exam_date ?? "" : examSubject.exam_date ?? "",
    start: component ? component.start_time ?? "" : examSubject.start_time ?? "",
    end: component ? component.end_time ?? "" : examSubject.end_time ?? "",
    duration: component ? component.duration_minutes ?? null : examSubject.duration_minutes ?? null,
    room: component ? component.room ?? "" : examSubject.room ?? "",
    // Invigilator selection is retired. Only the legacy single-paper exam
    // still exposes its assigned subject teacher; component papers do not.
    teacherId: component ? "" : examSubject.teacher_id ?? "",
    maxMarks: component?.max_marks ?? examSubject.max_marks ?? null,
    weight: component?.weight_percent ?? null,
    status: group.status,
    resultKind: resolvedResultKind(exam),
    submission: (exam.exam_submissions ?? []).find(
      (row) => row.subject_id === examSubject.subject_id,
    ) ?? null,
    sheets: exam.result_sheets ?? [],
  };
}

// ---------- records filters ----------
// One predicate keeps the calendar, the records table and the status counts in
// step. `filters.type` holds an activity id (IA1, ESA, Quiz, ...) and each paper
// resolves its own activity from its component code or examination type.
export function paperMatchesFilters(paper, filters) {
  if (!paper) return false;
  if (!filters) return true;
  if (filters.degree && paper.degreeId !== filters.degree) return false;
  if (filters.department && paper.departmentId !== filters.department) return false;
  if (filters.course && paper.courseId !== filters.course) return false;
  if (filters.year && paper.academicYear !== filters.year) return false;
  if (filters.batch && paper.batchKey !== filters.batch) return false;
  if (filters.classId && paper.classId !== filters.classId) return false;
  if (filters.semester && String(paper.semester ?? "") !== filters.semester) return false;
  if (filters.subjectId && paper.subjectId !== filters.subjectId) return false;
  if (filters.teacherId && paper.teacherId !== filters.teacherId) return false;
  if (filters.type && paper.activity !== filters.type) return false;
  if (filters.status && paper.status !== filters.status) return false;
  if (filters.date && paper.date !== filters.date) return false;

  const needle = (filters.query ?? "").trim().toLowerCase();
  if (needle) {
    const haystack = [
      paper.examName,
      paper.subjectName,
      paper.subjectCode,
      paper.component?.name,
      paper.className,
      paper.courseName,
      paper.academicYear,
      paper.batch,
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  return true;
}

// Status tabs read the same group-level workflow helpers as the rest of the app,
// so a paper is only ever as far along as the sheet it belongs to.
export function paperMatchesTab(paper, tab) {
  if (!tab || tab === "all") return true;
  const group = paper?.group;
  if (tab === "pending_marks") return groupHasPendingMarks(group);
  if (tab === "pending_publication") return groupHasPendingPublication(group);
  if (tab === "published") return groupIsPublished(group);
  return groupTimeBucket(group) === tab;
}
