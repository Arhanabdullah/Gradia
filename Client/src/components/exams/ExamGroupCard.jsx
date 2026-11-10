import { useEffect, useMemo, useState } from "react";
import { Button, Card, Field, Select, StatusChip, inputClass } from "../ui";
import { callRpc } from "../../lib/db";
import { statusChipClass } from "../../lib/status";
import {
  EXAM_STATUSES,
  examStatusLabel,
  examTypeLabel,
  formatExamDate,
  formatClock,
  groupExams,
  groupIsPublished,
  groupSheets,
  groupStatusSummary,
  groupSubjectStatus,
  subjectLabel,
  submissionStatusLabel,
  teacherLabel,
  timeRange,
} from "../../lib/exams";

function SubmissionChip({ status }) {
  const label = status === "draft" ? "Not submitted" : submissionStatusLabel(status);
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium ${
        statusChipClass[status] ?? statusChipClass.draft
      }`}
    >
      {label}
    </span>
  );
}

function uniqueSubjects(group) {
  const map = new Map();
  groupExams(group).forEach((exam) => {
    (exam.exam_subjects ?? []).forEach((subject) => {
      if (!map.has(subject.subject_id)) map.set(subject.subject_id, { ...subject, exam });
    });
  });
  return [...map.values()].sort((a, b) =>
    (a.subjects?.code ?? "").localeCompare(b.subjects?.code ?? ""),
  );
}

export default function ExamGroupCard({
  group,
  canManage,
  teachers,
  degrees,
  onChanged,
  onNotify,
}) {
  const [drafts, setDrafts] = useState({});
  const [busySubject, setBusySubject] = useState(null);
  const [status, setStatus] = useState(group.status ?? "draft");
  const [statusBusy, setStatusBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setStatus(group.status ?? "draft");
  }, [group.status]);

  const subjects = useMemo(() => uniqueSubjects(group), [group]);
  const summary = useMemo(() => groupStatusSummary(group), [group]);
  const exams = groupExams(group);
  const sheets = groupSheets(group);
  const published = groupIsPublished(group);
  const classNames = exams.map((exam) => exam.classes?.name).filter(Boolean);
  const degreeId =
    group.courses?.degree_id ?? exams.find((exam) => exam.classes?.degree_id)?.classes.degree_id ?? "";
  const degreeName = degrees?.find((degree) => degree.id === degreeId)?.name ?? "";
  const teacherNames = useMemo(() => new Map(teachers.map((teacher) => [teacher.id, teacherLabel(teacher)])), [teachers]);

  const valueFor = (subject, field) => {
    const draft = drafts[subject.id] ?? {};
    if (Object.prototype.hasOwnProperty.call(draft, field)) return draft[field];
    return subject[field] ?? "";
  };

  const setValue = (subject, field, value) => {
    setDrafts((current) => ({
      ...current,
      [subject.id]: { ...(current[subject.id] ?? {}), [field]: value },
    }));
  };

  const saveSchedule = async (subject) => {
    setBusySubject(subject.id);
    setError("");
    try {
      await callRpc("update_exam_subject_schedule", {
        p_exam_subject_id: subject.id,
        p_exam_date: valueFor(subject, "exam_date") || null,
        p_start_time: valueFor(subject, "start_time") || null,
        p_end_time: valueFor(subject, "end_time") || null,
        p_max_marks: Number(valueFor(subject, "max_marks")) || null,
        p_pass_marks: valueFor(subject, "pass_marks") === "" ? null : Number(valueFor(subject, "pass_marks")),
        p_teacher_id: valueFor(subject, "teacher_id") || null,
        p_instructions: valueFor(subject, "instructions"),
        p_room: valueFor(subject, "room") || null,
        p_allow_overlap: Boolean(valueFor(subject, "allow_overlap")),
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[subject.id];
        return next;
      });
      onNotify?.(`Schedule saved for ${subjectLabel(subject.subjects)}.`);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusySubject(null);
    }
  };

  const changeStatus = async () => {
    setStatusBusy(true);
    setError("");
    try {
      await callRpc("set_exam_group_status", { p_group_id: group.id, p_status: status });
      onNotify?.(`"${group.name}" is now ${examStatusLabel(status).toLowerCase()}.`);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setStatusBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-(--foreground)">{group.name}</p>
            <span className="text-xs text-(--muted-foreground)">{examTypeLabel(group.exam_type)}</span>
            <StatusChip status={group.status} />
            {published ? <StatusChip status="published" /> : null}
          </div>
          <p className="mt-1 text-xs text-(--muted-foreground)">
            {group.scope === "department" ? "Department-wide" : "Single class"}
            {group.departments?.name ? `, ${group.departments.name}` : ""}
            {degreeName ? `, ${degreeName}` : ""}
            {group.courses?.name ? `, ${group.courses.name}` : ""}
            {group.academic_year ? `, ${group.academic_year}` : ""}
          </p>
          <p className="mt-1 text-xs text-(--muted-foreground)">
            {formatExamDate(group.starts_on)} to {formatExamDate(group.ends_on)}
            {classNames.length ? `, ${classNames.length} class${classNames.length === 1 ? "" : "es"}` : ""}
          </p>
          {classNames.length ? (
            <p className="mt-1 truncate text-[11px] text-(--muted-foreground)" title={classNames.join(", ")}>
              {classNames.join(", ")}
            </p>
          ) : null}
        </div>

        {canManage && !published ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Status">
              <Select value={status} onChange={(event) => setStatus(event.target.value)}>
                {EXAM_STATUSES.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </Select>
            </Field>
            <Button type="button" variant="subtle" onClick={changeStatus} disabled={statusBusy || status === group.status}>
              {statusBusy ? "Updating…" : "Update status"}
            </Button>
          </div>
        ) : null}
      </div>

      {group.instructions ? (
        <p className="mt-3 rounded-lg border border-(--border-subtle) px-3 py-2 text-xs text-(--muted-foreground)">
          {group.instructions}
        </p>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-(--border-subtle) px-3 py-2">
          <p className="text-[11px] text-(--muted-foreground)">Papers scheduled</p>
          <p className="mt-0.5 text-sm font-semibold text-(--foreground) tabular-nums">{summary.total}</p>
        </div>
        <div className="rounded-lg border border-(--border-subtle) px-3 py-2">
          <p className="text-[11px] text-(--muted-foreground)">Awaiting approval</p>
          <p className="mt-0.5 text-sm font-semibold text-(--foreground) tabular-nums">{summary.pending}</p>
        </div>
        <div className="rounded-lg border border-(--border-subtle) px-3 py-2">
          <p className="text-[11px] text-(--muted-foreground)">Approved</p>
          <p className="mt-0.5 text-sm font-semibold text-(--foreground) tabular-nums">{summary.approved}</p>
        </div>
      </div>

      {sheets.length ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-(--muted-foreground)">
          Result sheet
          {sheets.map((sheet) => (
            <StatusChip key={sheet.id} status={sheet.status} />
          ))}
        </p>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-xl border border-(--border-subtle)">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-(--surface-secondary)">
            <tr className="border-b border-(--border-subtle)">
              <th className="px-3 py-2 font-medium text-(--muted-foreground)">Subject</th>
              <th className="px-3 py-2 font-medium text-(--muted-foreground)">Date</th>
              <th className="px-3 py-2 font-medium text-(--muted-foreground)">Time</th>
              <th className="px-3 py-2 font-medium text-(--muted-foreground)">Marks</th>
              <th className="px-3 py-2 font-medium text-(--muted-foreground)">Invigilator</th>
              <th className="px-3 py-2 font-medium text-(--muted-foreground)">Marks status</th>
              {canManage && !published ? (
                <th className="px-3 py-2 font-medium text-(--muted-foreground)">Schedule</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {subjects.length === 0 ? (
              <tr>
                <td colSpan={canManage && !published ? 7 : 6} className="px-3 py-4 text-center text-(--muted-foreground)">
                  No subjects are attached to this examination yet.
                </td>
              </tr>
            ) : null}
            {subjects.map((subject) => {
              const statusValue = groupSubjectStatus(group, subject.subject_id);
              const editable = canManage && !published;
              return (
                <tr key={subject.id} className="border-b border-(--border-subtle)/60 last:border-b-0 align-top">
                  <td className="px-3 py-2">
                    <p className="font-medium text-(--foreground)">{subjectLabel(subject.subjects)}</p>
                    <p className="mt-0.5 text-[11px] text-(--muted-foreground)">
                      Max {subject.max_marks}
                      {subject.pass_marks != null ? `, pass ${subject.pass_marks}` : ""}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-(--muted-foreground)">
                    {editable ? (
                      <input
                        type="date"
                        className={`${inputClass} w-40`}
                        value={valueFor(subject, "exam_date")}
                        min={group.starts_on || undefined}
                        max={group.ends_on || undefined}
                        onChange={(event) => setValue(subject, "exam_date", event.target.value)}
                        aria-label={`Paper date for ${subjectLabel(subject.subjects)}`}
                      />
                    ) : (
                      formatExamDate(subject.exam_date)
                    )}
                  </td>
                  <td className="px-3 py-2 text-(--muted-foreground)">
                    {editable ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="time"
                          className={`${inputClass} w-28`}
                          value={formatClock(valueFor(subject, "start_time"))}
                          onChange={(event) => setValue(subject, "start_time", event.target.value)}
                          aria-label={`Start time for ${subjectLabel(subject.subjects)}`}
                        />
                        <input
                          type="time"
                          className={`${inputClass} w-28`}
                          value={formatClock(valueFor(subject, "end_time"))}
                          onChange={(event) => setValue(subject, "end_time", event.target.value)}
                          aria-label={`End time for ${subjectLabel(subject.subjects)}`}
                        />
                      </div>
                    ) : (
                      <>
                        <span>{timeRange(subject.start_time, subject.end_time)}</span>
                        {subject.duration_minutes ? (
                          <p className="mt-0.5 text-[11px] text-(--muted-foreground)">
                            {subject.duration_minutes} min
                          </p>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 text-(--muted-foreground) tabular-nums">
                    {editable ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={1}
                          className={`${inputClass} w-20`}
                          value={valueFor(subject, "max_marks")}
                          onChange={(event) => setValue(subject, "max_marks", event.target.value)}
                          aria-label={`Maximum marks for ${subjectLabel(subject.subjects)}`}
                        />
                        <input
                          type="number"
                          min={0}
                          className={`${inputClass} w-20`}
                          value={valueFor(subject, "pass_marks")}
                          onChange={(event) => setValue(subject, "pass_marks", event.target.value)}
                          aria-label={`Passing marks for ${subjectLabel(subject.subjects)}`}
                        />
                      </div>
                    ) : (
                      `${subject.max_marks}${subject.pass_marks != null ? ` of ${subject.pass_marks} to pass` : ""}`
                    )}
                  </td>
                  <td className="px-3 py-2 text-(--muted-foreground)">
                    {editable ? (
                      <Select
                        value={valueFor(subject, "teacher_id")}
                        onChange={(event) => setValue(subject, "teacher_id", event.target.value)}
                        aria-label={`Invigilator for ${subjectLabel(subject.subjects)}`}
                      >
                        <option value="">Use assigned teacher</option>
                        {teachers.map((teacher) => (
                          <option key={teacher.id} value={teacher.id}>{teacherLabel(teacher)}</option>
                        ))}
                      </Select>
                    ) : (
                      teacherNames.get(subject.teacher_id) ?? "Assigned teacher"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <SubmissionChip status={statusValue} />
                    {exams.length > 1 ? (
                      <p className="mt-1 text-[11px] text-(--muted-foreground) tabular-nums">
                        {groupStatusSummary({
                          ...group,
                          exams: exams.map((exam) => ({
                            ...exam,
                            exam_subjects: (exam.exam_subjects ?? []).filter(
                              (row) => row.subject_id === subject.subject_id,
                            ),
                          })),
                        }).approved}{" "}
                        of {exams.length} classes approved
                      </p>
                    ) : null}
                  </td>
                  {editable ? (
                    <td className="px-3 py-2">
                      <Button
                        type="button"
                        variant="subtle"
                        onClick={() => saveSchedule(subject)}
                        disabled={busySubject === subject.id}
                      >
                        {busySubject === subject.id ? "Saving…" : "Save"}
                      </Button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error ? <p role="alert" className="mt-2 text-xs text-(--danger)">{error}</p> : null}
    </Card>
  );
}
