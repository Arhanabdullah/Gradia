import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { callRpc } from "../../lib/db";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { chartAxis, chartTooltip } from "../../components/charts/ChartsConfig";
import { Button, Card, Empty, Field, Select, StatusChip, inputClass } from "../../components/ui";
import DashboardHeader from "../../components/dashboard/DashboardHeader";
import ImportButton from "../../components/import/ImportButton";
import {
  MARK_STATUSES,
  examTypeLabel,
  formatExamDate,
  subjectLabel,
  submissionStatusLabel,
  timeRange,
} from "../../lib/exams";

const LOCKED_STATUSES = ["submitted", "under_review", "approved"];

const ACTION_LABEL = {
  submitted: "Submitted for review",
  review_started: "Review started",
  approved: "Approved",
  returned: "Returned for correction",
  reopened: "Reopened by an administrator",
};

function timestampLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function actorName(event) {
  const person = Array.isArray(event.profiles) ? event.profiles[0] : event.profiles;
  return person?.name ?? "A staff member";
}

async function fetchStudents(classId) {
  const { data: enrollments } = await supabase
    .from("student_enrollments")
    .select("student_id")
    .eq("class_id", classId)
    .eq("status", "active");

  const enrolledIds = [...new Set((enrollments ?? []).map((row) => row.student_id))];
  const columns = "id, name, username";

  // Enrolled students are the source of truth, while the profile class keeps
  // older classes working and matches the count used when marks are submitted.
  const [enrolledRes, classRes] = await Promise.all([
    enrolledIds.length > 0
      ? supabase
          .from("profiles")
          .select(columns)
          .in("id", enrolledIds)
          .eq("role", "student")
          .eq("is_active", true)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("profiles")
      .select(columns)
      .eq("class_id", classId)
      .eq("role", "student")
      .eq("is_active", true),
  ]);

  const error = enrolledRes.error ?? classRes.error;
  if (error) throw new Error(error.message);

  const map = new Map();
  [...(enrolledRes.data ?? []), ...(classRes.data ?? [])].forEach((student) => map.set(student.id, student));
  return [...map.values()].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

const MarksEntry = () => {
  const { profile } = useAuth();

  const [assignments, setAssignments] = useState([]);
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [scopeLoading, setScopeLoading] = useState(true);
  const [scopeError, setScopeError] = useState("");

  const [exams, setExams] = useState([]);
  const [examSubjects, setExamSubjects] = useState([]);

  const [classId, setClassId] = useState("");
  const [examId, setExamId] = useState("");
  const [subjectId, setSubjectId] = useState("");

  const [students, setStudents] = useState([]);
  const [marksState, setMarksState] = useState({});
  const [statusState, setStatusState] = useState({});
  const [remarksState, setRemarksState] = useState({});
  const [savedIds, setSavedIds] = useState({});
  const [dirty, setDirty] = useState(new Set());

  const [submission, setSubmission] = useState(null);
  const [events, setEvents] = useState([]);
  const [sheet, setSheet] = useState(null);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [marksVersion, setMarksVersion] = useState(0);
  const [bulkValue, setBulkValue] = useState("");
  const [bulkTarget, setBulkTarget] = useState("blank");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!profile) return;
      setScopeLoading(true);
      setScopeError("");
      try {
        const { data: assignmentRows, error: assignmentError } = await supabase
          .from("teacher_assignments")
          .select("class_id, subject_id")
          .eq("teacher_id", profile.id);
        if (assignmentError) throw new Error(assignmentError.message);

        const rows = assignmentRows ?? [];
        const classIds = [...new Set(rows.map((row) => row.class_id))];
        const subjectIds = [...new Set(rows.map((row) => row.subject_id))];

        if (classIds.length === 0) {
          if (!cancelled) {
            setAssignments([]);
            setClasses([]);
            setSubjects([]);
          }
          return;
        }

        const [classesRes, subjectsRes] = await Promise.all([
          supabase
            .from("classes")
            .select("id, name, academic_year, semester, section")
            .in("id", classIds)
            .order("name"),
          supabase
            .from("subjects")
            .select("id, name, code, max_marks")
            .in("id", subjectIds)
            .order("code"),
        ]);
        if (classesRes.error) throw new Error(classesRes.error.message);
        if (subjectsRes.error) throw new Error(subjectsRes.error.message);
        if (cancelled) return;

        setAssignments(rows);
        setClasses(classesRes.data ?? []);
        setSubjects(subjectsRes.data ?? []);
      } catch (err) {
        if (!cancelled) setScopeError(err.message);
      } finally {
        if (!cancelled) setScopeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile]);

  useEffect(() => {
    let cancelled = false;
    setExams([]);
    setExamSubjects([]);
    setExamId("");
    setSubjectId("");
    if (!classId) return undefined;

    supabase
      .from("exams")
      .select("id, name, academic_year, exam_type, status, starts_on, ends_on")
      .eq("class_id", classId)
      .order("created_at", { ascending: false })
      .then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (loadError) {
          setError(loadError.message);
          return;
        }
        setExams(data ?? []);
      });

    return () => {
      cancelled = true;
    };
  }, [classId]);

  const mySubjectIds = useMemo(
    () => [...new Set(assignments.filter((row) => row.class_id === classId).map((row) => row.subject_id))],
    [assignments, classId],
  );

  useEffect(() => {
    let cancelled = false;
    setExamSubjects([]);
    setSubjectId("");
    setSubmission(null);
    setEvents([]);
    setSheet(null);
    if (!examId || mySubjectIds.length === 0) return undefined;

    Promise.all([
      supabase
        .from("exam_subjects")
        .select("id, subject_id, exam_date, start_time, end_time, max_marks, pass_marks, subjects ( id, name, code )")
        .eq("exam_id", examId)
        .in("subject_id", mySubjectIds),
    ]).then(([subjectsRes]) => {
      if (cancelled) return;
      if (subjectsRes.error) {
        setError(subjectsRes.error.message);
        return;
      }
      setExamSubjects(subjectsRes.data ?? []);
    });

    return () => {
      cancelled = true;
    };
  }, [examId, mySubjectIds]);

  useEffect(() => {
    setMessage("");
    setError("");
  }, [classId, examId, subjectId]);

  useEffect(() => {
    let cancelled = false;
    setStudents([]);
    setMarksState({});
    setStatusState({});
    setRemarksState({});
    setSavedIds({});
    setDirty(new Set());
    setSubmission(null);
    setEvents([]);
    if (!classId || !examId || !subjectId) return undefined;

    (async () => {
      try {
        const roster = await fetchStudents(classId);
        const [marksRes, submissionRes, sheetRes] = await Promise.all([
          supabase
            .from("marks")
            .select("id, student_id, marks_obtained, status, remarks")
            .eq("exam_id", examId)
            .eq("subject_id", subjectId),
          supabase
            .from("exam_submissions")
            .select(
              "id, status, submitted_by, submitted_at, reviewed_by, reviewed_at, approved_by, approved_at, review_remarks",
            )
            .eq("exam_id", examId)
            .eq("subject_id", subjectId)
            .maybeSingle(),
          supabase
            .from("result_sheets")
            .select("id, status, published_at")
            .eq("exam_id", examId)
            .maybeSingle(),
        ]);

        if (cancelled) return;
        if (marksRes.error) throw new Error(marksRes.error.message);
        if (submissionRes.error) throw new Error(submissionRes.error.message);
        setSheet(sheetRes.error ? null : sheetRes.data ?? null);

        const marks = {};
        const statuses = {};
        const remarks = {};
        const ids = {};
        (marksRes.data ?? []).forEach((row) => {
          marks[row.student_id] = String(row.marks_obtained ?? "");
          statuses[row.student_id] = row.status ?? "present";
          remarks[row.student_id] = row.remarks ?? "";
          ids[row.student_id] = row.id;
        });

        const initialStatuses = {};
        roster.forEach((student) => {
          initialStatuses[student.id] = statuses[student.id] ?? "present";
        });

        setStudents(roster);
        setMarksState(marks);
        setStatusState(initialStatuses);
        setRemarksState(remarks);
        setSavedIds(ids);

        const current = submissionRes.data ?? null;
        setSubmission(current);

        if (current?.id) {
          const { data: eventRows } = await supabase
            .from("exam_submission_events")
            .select("id, action, remarks, created_at, profiles ( name )")
            .eq("submission_id", current.id)
            .order("created_at");
          if (!cancelled) setEvents(eventRows ?? []);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [classId, examId, subjectId, marksVersion]);

  const examSubject = examSubjects.find((row) => row.subject_id === subjectId);
  const subject = subjects.find((row) => row.id === subjectId);
  const maxMarks = Number(examSubject?.max_marks ?? subject?.max_marks ?? 100);
  const passMarks = examSubject?.pass_marks != null ? Number(examSubject.pass_marks) : null;
  const locked = Boolean(submission && LOCKED_STATUSES.includes(submission.status));
  const published = sheet?.status === "published";
  const readOnly = locked || published;

  const setValue = (studentId, value) => {
    setMarksState((current) => ({ ...current, [studentId]: value }));
    setDirty((current) => new Set(current).add(studentId));
  };

  const setStatus = (studentId, value) => {
    setStatusState((current) => ({ ...current, [studentId]: value }));
    if (value !== "present") {
      setMarksState((current) => ({ ...current, [studentId]: "0" }));
    }
    setDirty((current) => new Set(current).add(studentId));
  };

  const setRemarks = (studentId, value) => {
    setRemarksState((current) => ({ ...current, [studentId]: value }));
    setDirty((current) => new Set(current).add(studentId));
  };

  const invalid = (value) => {
    if (value === undefined || value === null || value === "") return false;
    const numeric = Number(value);
    return Number.isNaN(numeric) || numeric < 0 || numeric > maxMarks;
  };

  const invalidCount = students.filter(
    (student) =>
      (statusState[student.id] ?? "present") === "present" && invalid(marksState[student.id]),
  ).length;

  const enteredCount = students.filter((student) => {
    const status = statusState[student.id] ?? "present";
    if (status !== "present") return true;
    return marksState[student.id] !== undefined && marksState[student.id] !== "";
  }).length;

  const missingCount = students.length - enteredCount;

  const performance = useMemo(() => {
    if (!subject || !examId) return null;
    const values = students
      .filter((student) => {
        const status = statusState[student.id] ?? "present";
        const value = marksState[student.id];
        if (status !== "present" || value === undefined || value === "") return false;
        const numeric = Number(value);
        return !Number.isNaN(numeric) && numeric >= 0 && numeric <= maxMarks;
      })
      .map((student) => ({ username: student.username ?? student.name, marks: Number(marksState[student.id]) }));
    if (values.length === 0) return null;
    const total = values.reduce((sum, row) => sum + row.marks, 0);
    return {
      entered: values.length,
      average: Math.round((total / values.length) * 10) / 10,
      rows: values.sort((a, b) => b.marks - a.marks),
    };
  }, [students, marksState, statusState, subject, examId, maxMarks]);

  const applyBulk = () => {
    const numeric = Number(bulkValue);
    if (bulkValue === "" || Number.isNaN(numeric) || numeric < 0 || numeric > maxMarks) {
      setError(`Enter a mark between 0 and ${maxMarks} to apply.`);
      return;
    }
    const nextMarks = { ...marksState };
    const nextStatus = { ...statusState };
    const nextDirty = new Set(dirty);
    students.forEach((student) => {
      const status = statusState[student.id] ?? "present";
      const hasValue = nextMarks[student.id] !== undefined && nextMarks[student.id] !== "";
      if (bulkTarget === "blank" && (hasValue || status !== "present")) return;
      nextMarks[student.id] = String(numeric);
      nextStatus[student.id] = "present";
      nextDirty.add(student.id);
    });
    setMarksState(nextMarks);
    setStatusState(nextStatus);
    setDirty(nextDirty);
    setError("");
    setMessage(`Applied ${numeric} to ${bulkTarget === "blank" ? "blank rows" : "every student"}.`);
  };

  const save = async () => {
    setError("");
    setMessage("");
    if (invalidCount > 0) {
      setError(`Marks must be between 0 and ${maxMarks}. Fix ${invalidCount} invalid entr${invalidCount === 1 ? "y" : "ies"} first.`);
      return;
    }

    setSaving(true);
    try {
      const rows = [];
      const deletes = [];

      for (const studentId of dirty) {
        const status = statusState[studentId] ?? "present";
        const value = marksState[studentId];
        const hasValue = value !== undefined && value !== "";

        if (status === "present" && !hasValue) {
          if (savedIds[studentId]) deletes.push(studentId);
          continue;
        }

        rows.push({
          exam_id: examId,
          subject_id: subjectId,
          student_id: studentId,
          marks_obtained: status === "present" ? Number(value) : 0,
          status,
          remarks: (remarksState[studentId] ?? "").trim() || null,
          entered_by: profile.id,
        });
      }

      for (const studentId of deletes) {
        const { error: deleteError } = await supabase
          .from("marks")
          .delete()
          .eq("exam_id", examId)
          .eq("subject_id", subjectId)
          .eq("student_id", studentId);
        if (deleteError) throw new Error(deleteError.message);
      }

      if (rows.length > 0) {
        const { error: saveError } = await supabase
          .from("marks")
          .upsert(rows, { onConflict: "exam_id,subject_id,student_id" });
        if (saveError) throw new Error(saveError.message);
      }

      setDirty(new Set());
      setMessage(`Saved ${rows.length} mark${rows.length === 1 ? "" : "s"}${deletes.length ? ` and cleared ${deletes.length}` : ""}.`);
      setMarksVersion((value) => value + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    setError("");
    setMessage("");
    if (dirty.size > 0) {
      setError("Save your changes before submitting for review.");
      return;
    }
    if (invalidCount > 0) {
      setError(`Fix ${invalidCount} invalid mark${invalidCount === 1 ? "" : "s"} before submitting.`);
      return;
    }
    if (students.length === 0) {
      setError("No active students are enrolled in this class.");
      return;
    }
    if (missingCount > 0) {
      setError(`Enter a mark or a non-present status for ${missingCount} student${missingCount === 1 ? "" : "s"}.`);
      return;
    }

    setSubmitting(true);
    try {
      await callRpc("submit_exam_marks", { p_exam_id: examId, p_subject_id: subjectId });
      setMessage("Marks submitted for review. Entries are locked until a reviewer responds.");
      setMarksVersion((value) => value + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const classLabel = (klass) => {
    const parts = [klass.name];
    if (klass.academic_year) parts.push(klass.academic_year);
    if (klass.semester != null) parts.push(`Sem ${klass.semester}`);
    if (klass.section) parts.push(`Section ${klass.section}`);
    return parts.join(", ");
  };

  const selectedExam = exams.find((row) => row.id === examId);
  const subjectChoices = examSubjects
    .map((row) => ({ row, meta: subjects.find((item) => item.id === row.subject_id) }))
    .sort((a, b) => (a.meta?.code ?? "").localeCompare(b.meta?.code ?? ""));

  return (
    <>
      <DashboardHeader title="Marks entry" subtitle="Enter, validate and submit marks for the subjects you teach." />

      <Card className="mt-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-(--foreground)">Choose a class, examination and subject</p>
            <p className="mt-1 text-xs text-(--muted-foreground)">
              Only the classes and subjects assigned to you appear here. Saved marks stay as drafts until you submit them
              for review.
            </p>
          </div>
          <ImportButton
            moduleId="marks"
            label="Import marks"
            defaults={{ class_id: classId, exam_id: examId, subject_id: subjectId }}
            onComplete={() => setMarksVersion((value) => value + 1)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Class">
            <Select
              value={classId}
              onChange={(event) => {
                setClassId(event.target.value);
                setExamId("");
                setSubjectId("");
              }}
              disabled={scopeLoading}
            >
              <option value="">{scopeLoading ? "Loading classes" : "Choose a class"}</option>
              {classes.map((klass) => (
                <option key={klass.id} value={klass.id}>{classLabel(klass)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Examination">
            <Select
              value={examId}
              onChange={(event) => {
                setExamId(event.target.value);
                setSubjectId("");
              }}
              disabled={!classId || exams.length === 0}
            >
              <option value="">{classId && exams.length === 0 ? "No examinations yet" : "Choose an examination"}</option>
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.name}
                  {exam.academic_year ? ` (${exam.academic_year})` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Subject">
            <Select
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
              disabled={!examId || subjectChoices.length === 0}
            >
              <option value="">
                {examId && subjectChoices.length === 0 ? "No subjects scheduled" : "Choose a subject"}
              </option>
              {subjectChoices.map(({ row, meta }) => (
                <option key={row.subject_id} value={row.subject_id}>{subjectLabel(meta)}</option>
              ))}
            </Select>
          </Field>
        </div>

        {scopeLoading ? <p className="mt-3 text-xs text-(--muted-foreground)">Loading your teaching assignments.</p> : null}
        {!scopeLoading && classes.length === 0 ? (
          <Empty>No classes are assigned to you yet. Ask an administrator to assign your subjects.</Empty>
        ) : null}
        {scopeError ? <p role="alert" className="mt-3 text-xs text-(--danger)">{scopeError}</p> : null}
        {classId && exams.length === 0 && !scopeLoading ? (
          <p className="mt-3 text-xs text-(--muted-foreground)">
            This class has no examinations yet. Schedule one from the Exams page.
          </p>
        ) : null}
        {examId && subjectChoices.length === 0 ? (
          <p className="mt-3 text-xs text-(--muted-foreground)">
            No scheduled subject matches your teaching assignments for this examination.
          </p>
        ) : null}
      </Card>

      {examSubject ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-(--border-subtle) px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-(--foreground)">
              {subjectLabel(subject)} in {selectedExam?.name}
            </p>
            <p className="mt-0.5 text-xs text-(--muted-foreground)">
              {examTypeLabel(selectedExam?.exam_type)}, {formatExamDate(examSubject.exam_date)}
              {examSubject.start_time || examSubject.end_time
                ? `, ${timeRange(examSubject.start_time, examSubject.end_time)}`
                : ""}
              {examSubject.room ? `, ${examSubject.room}` : ""}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {submission ? <StatusChip status={submission.status} /> : <StatusChip status="draft" />}
            {published ? <StatusChip status="published" /> : null}
          </div>
        </div>
      ) : null}

      {classId && examId && subjectId ? (
        <section className="mt-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-(--foreground)">Student marks</p>
              <p className="mt-1 text-xs text-(--muted-foreground) tabular-nums">
                {enteredCount} of {students.length} entered, maximum {maxMarks}
                {passMarks != null ? `, pass ${passMarks}` : ""}
                {invalidCount > 0 ? `, ${invalidCount} invalid` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!readOnly ? (
                <Button onClick={save} disabled={saving || dirty.size === 0 || invalidCount > 0}>
                  {saving ? "Saving" : "Save draft"}
                </Button>
              ) : null}
              {!readOnly ? (
                <Button
                  variant="subtle"
                  onClick={submit}
                  disabled={submitting || dirty.size > 0 || invalidCount > 0 || missingCount > 0}
                >
                  {submitting ? "Submitting" : "Submit for approval"}
                </Button>
              ) : null}
            </div>
          </div>

          {readOnly ? (
            <p className="mt-3 rounded-lg border border-(--border-subtle) px-4 py-3 text-xs text-(--muted-foreground)">
              {published
                ? "Results for this examination are published. Marks can no longer be edited."
                : submission?.status === "approved"
                  ? "These marks were approved. They are locked while the result sheet moves through sign-off."
                  : "These marks are awaiting review. They cannot be edited until a reviewer returns them."}
            </p>
          ) : null}

          {!readOnly ? (
            <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-(--border-subtle) p-3">
              <Field label="Bulk entry">
                <input
                  type="number"
                  className={`${inputClass} w-32 tabular-nums`}
                  min={0}
                  max={maxMarks}
                  value={bulkValue}
                  onChange={(event) => setBulkValue(event.target.value)}
                  placeholder="Mark"
                />
              </Field>
              <Field label="Apply to">
                <Select value={bulkTarget} onChange={(event) => setBulkTarget(event.target.value)}>
                  <option value="blank">Blank rows only</option>
                  <option value="all">Every student</option>
                </Select>
              </Field>
              <Button variant="subtle" onClick={applyBulk} disabled={students.length === 0}>
                Apply
              </Button>
              <p className="pb-2 text-[11px] text-(--muted-foreground)">
                Useful for full-mark practicals and for clearing a whole class before re-entry.
              </p>
            </div>
          ) : null}

          <div className="mt-4 overflow-x-auto rounded-xl border border-(--border-subtle)">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-(--surface-secondary)">
                <tr className="border-b border-(--border-subtle)">
                  <th className="px-3 py-2 font-medium text-(--muted-foreground)">Student</th>
                  <th className="px-3 py-2 font-medium text-(--muted-foreground)">Status</th>
                  <th className="px-3 py-2 font-medium text-(--muted-foreground)">Marks</th>
                  <th className="px-3 py-2 font-medium text-(--muted-foreground)">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {students.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-(--muted-foreground)">
                      No active students are enrolled in this class.
                    </td>
                  </tr>
                ) : null}
                {students.map((student) => {
                  const status = statusState[student.id] ?? "present";
                  const value = marksState[student.id] ?? "";
                  const numeric = Number(value);
                  const belowPass =
                    status === "present" && value !== "" && passMarks != null && numeric < passMarks;
                  return (
                    <tr key={student.id} className="border-b border-(--border-subtle)/60 last:border-b-0">
                      <td className="px-3 py-2">
                        <p className="font-medium text-(--foreground)">{student.name}</p>
                        <p className="mt-0.5 text-[11px] text-(--muted-foreground)">{student.username}</p>
                      </td>
                      <td className="px-3 py-2">
                        {readOnly ? (
                          <span className="text-(--muted-foreground)">
                            {MARK_STATUSES.find((item) => item.id === status)?.label ?? "Present"}
                          </span>
                        ) : (
                          <Select
                            value={status}
                            onChange={(event) => setStatus(student.id, event.target.value)}
                            aria-label={`Status for ${student.name}`}
                          >
                            {MARK_STATUSES.map((item) => (
                              <option key={item.id} value={item.id}>{item.label}</option>
                            ))}
                          </Select>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {readOnly || status !== "present" ? (
                          <span className="tabular-nums text-(--muted-foreground)">
                            {status === "present" ? (value === "" ? "Not entered" : value) : "0"}
                          </span>
                        ) : (
                          <div>
                            <input
                              type="number"
                              aria-label={`Marks for ${student.name}`}
                              aria-invalid={invalid(value) ? true : undefined}
                              className={`${inputClass} w-28 tabular-nums ${invalid(value) ? "border-(--danger)!" : ""}`}
                              min={0}
                              max={maxMarks}
                              value={value}
                              onChange={(event) => setValue(student.id, event.target.value)}
                            />
                            {belowPass ? (
                              <p className="mt-1 text-[11px] text-(--muted-foreground)">Below pass mark</p>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {readOnly ? (
                          <span className="text-(--muted-foreground)">{remarksState[student.id] || "None"}</span>
                        ) : (
                          <input
                            className={`${inputClass} min-w-40`}
                            value={remarksState[student.id] ?? ""}
                            onChange={(event) => setRemarks(student.id, event.target.value)}
                            placeholder="Optional"
                            aria-label={`Remarks for ${student.name}`}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {message ? <p role="status" className="mt-3 text-xs text-(--success)">{message}</p> : null}
          {error ? <p role="alert" className="mt-3 text-xs text-(--danger)">{error}</p> : null}

          {submission ? (
            <Card className="mt-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-(--foreground)">Approval history</p>
                  <p className="mt-0.5 text-xs text-(--muted-foreground)">
                    Current status: {submissionStatusLabel(submission.status)}
                  </p>
                </div>
                {submission.status === "returned" ? (
                  <span className="text-xs text-(--danger)">Editing is open again</span>
                ) : null}
              </div>

              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-[11px] text-(--muted-foreground)">Submitted</dt>
                  <dd className="mt-0.5 text-xs text-(--foreground)">
                    {submission.submitted_at ? timestampLabel(submission.submitted_at) : "Not submitted"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-(--muted-foreground)">Reviewed</dt>
                  <dd className="mt-0.5 text-xs text-(--foreground)">
                    {submission.reviewed_at ? timestampLabel(submission.reviewed_at) : "Not reviewed"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-(--muted-foreground)">Approved</dt>
                  <dd className="mt-0.5 text-xs text-(--foreground)">
                    {submission.approved_at ? timestampLabel(submission.approved_at) : "Not approved"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-(--muted-foreground)">Published</dt>
                  <dd className="mt-0.5 text-xs text-(--foreground)">
                    {sheet?.published_at ? timestampLabel(sheet.published_at) : "Not published"}
                  </dd>
                </div>
              </dl>

              {submission.review_remarks ? (
                <p className="mt-3 rounded-lg border border-(--border-subtle) px-3 py-2 text-xs text-(--muted-foreground)">
                  Reviewer note: {submission.review_remarks}
                </p>
              ) : null}

              {events.length > 0 ? (
                <ol className="mt-4 space-y-2">
                  {events.map((event) => (
                    <li key={event.id} className="flex flex-wrap items-baseline gap-2 text-xs">
                      <span className="font-medium text-(--foreground)">
                        {ACTION_LABEL[event.action] ?? event.action}
                      </span>
                      <span className="text-(--muted-foreground)">{actorName(event)}</span>
                      <span className="text-(--muted-foreground) tabular-nums">{timestampLabel(event.created_at)}</span>
                      {event.remarks ? (
                        <span className="w-full text-(--muted-foreground)">{event.remarks}</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : null}
            </Card>
          ) : null}

          {performance ? (
            <Card className="mt-6">
              <div className="mb-4">
                <p className="text-sm font-medium text-(--foreground)">Performance, {subject?.code}</p>
                <p className="mt-0.5 text-xs text-(--muted-foreground) tabular-nums">
                  {performance.entered} entered, class average {performance.average} of {maxMarks}
                </p>
              </div>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={performance.rows} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="username" {...chartAxis} tick={{ ...chartAxis.tick, fontSize: 12 }} dy={8} />
                    <YAxis {...chartAxis} tick={{ ...chartAxis.tick, fontSize: 12 }} domain={[0, maxMarks]} width={30} />
                    <Tooltip
                      cursor={{ fill: "color-mix(in oklab, var(--primary) 7%, transparent)" }}
                      {...chartTooltip}
                    />
                    <Bar dataKey="marks" fill="var(--primary)" radius={[5, 5, 0, 0]} barSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ) : null}
        </section>
      ) : null}
    </>
  );
};

export default MarksEntry;
