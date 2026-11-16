import { useEffect, useMemo, useState } from "react";
import { Button, Card, Field, Select, StatusChip, inputClass } from "../ui";
import { callRpc } from "../../lib/db";
import { statusChipClass } from "../../lib/status";
import {
  EXAM_STATUSES,
  conductedComponents,
  examStatusLabel,
  examTypeLabel,
  formatExamDate,
  formatClock,
  groupExams,
  groupIsPublished,
  groupSheets,
  groupStatusSummary,
  groupSubjectStatus,
  isComponentPaperExam,
  isPracticalSubject,
  subjectAllowedInExam,
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

// One entry per subject, carrying every class row that subject appears on.
function subjectRows(group) {
  const map = new Map();
  groupExams(group).forEach((exam) => {
    (exam.exam_subjects ?? []).forEach((subject) => {
      const list = map.get(subject.subject_id) ?? [];
      list.push({ ...subject, exam });
      map.set(subject.subject_id, list);
    });
  });
  return [...map.entries()]
    .map(([subjectId, rows]) => ({ subjectId, rows, primary: rows[0] }))
    .sort((a, b) => (a.primary.subjects?.code ?? "").localeCompare(b.primary.subjects?.code ?? ""));
}

const paperKey = (subjectId, code) => `${subjectId}:${code}`;

export default function ExamGroupCard({
  group,
  canManage,
  canEditSubjects = false,
  teachers,
  degrees,
  subjects = [],
  classSubjects = [],
  templates = [],
  onChanged,
  onEditSchedule,
  onNotify,
}) {
  const [drafts, setDrafts] = useState({});
  const [paperDrafts, setPaperDrafts] = useState({});
  const [busySubject, setBusySubject] = useState(null);
  const [busyPaper, setBusyPaper] = useState(null);
  const [busyStructure, setBusyStructure] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [addSubjectId, setAddSubjectId] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [status, setStatus] = useState(group.status ?? "draft");
  const [statusBusy, setStatusBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setStatus(group.status ?? "draft");
  }, [group.status]);

  useEffect(() => {
    setDrafts({});
    setPaperDrafts({});
    setRemoveTarget(null);
  }, [group.id]);

  const subjectsInGroup = useMemo(() => subjectRows(group), [group]);
  const summary = useMemo(() => groupStatusSummary(group), [group]);
  const exams = groupExams(group);
  const sheets = groupSheets(group);
  const published = groupIsPublished(group);
  const componentMode = exams.some((exam) => isComponentPaperExam(exam));
  const classNames = exams.map((exam) => exam.classes?.name).filter(Boolean);
  const degreeId =
    group.courses?.degree_id ?? exams.find((exam) => exam.classes?.degree_id)?.classes.degree_id ?? "";
  const degreeName = degrees?.find((degree) => degree.id === degreeId)?.name ?? "";
  const teacherNames = useMemo(() => new Map(teachers.map((teacher) => [teacher.id, teacherLabel(teacher)])), [teachers]);
  const templateName = useMemo(() => new Map(templates.map((template) => [template.id, template.name])), [templates]);

  const editable = canManage && !published;

  const paperCount = subjectsInGroup.reduce((total, entry) => {
    if (!componentMode) return total + 1;
    return total + conductedComponents(entry.primary).length;
  }, 0);

  const availableSubjects = useMemo(() => {
    const classIds = new Set(exams.map((exam) => exam.class_id));
    const offered = new Set(
      classSubjects.filter((row) => classIds.has(row.class_id)).map((row) => row.subject_id),
    );
    const present = new Set(subjectsInGroup.map((entry) => entry.subjectId));
    return subjects
      .filter((subject) => offered.has(subject.id) && !present.has(subject.id))
      .filter((subject) => subjectAllowedInExam(subject, group.exam_type))
      .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));
  }, [classSubjects, exams, subjects, subjectsInGroup, group.exam_type]);

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

  const paperValue = (subjectId, component, field) => {
    const draft = paperDrafts[paperKey(subjectId, component.code)] ?? {};
    if (Object.prototype.hasOwnProperty.call(draft, field)) return draft[field];
    if (field === "is_conducted") return component.is_conducted !== false;
    return component[field] ?? "";
  };

  const setPaperValue = (subjectId, component, field, value) => {
    const key = paperKey(subjectId, component.code);
    setPaperDrafts((current) => ({
      ...current,
      [key]: { ...(current[key] ?? {}), [field]: value },
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

  const savePaper = async (entry, component) => {
    const key = paperKey(entry.subjectId, component.code);
    setBusyPaper(key);
    setError("");
    try {
      await callRpc("update_assessment_component_schedule", {
        p_component_id: component.id,
        p_patch: {
          is_conducted: paperValue(entry.subjectId, component, "is_conducted"),
          exam_date: paperValue(entry.subjectId, component, "exam_date") || null,
          start_time: paperValue(entry.subjectId, component, "start_time") || null,
          end_time: paperValue(entry.subjectId, component, "end_time") || null,
          room: paperValue(entry.subjectId, component, "room") || null,
          teacher_id: paperValue(entry.subjectId, component, "teacher_id") || null,
          allow_overlap: Boolean(paperValue(entry.subjectId, component, "allow_overlap")),
        },
      });
      setPaperDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      onNotify?.(`${component.name} saved for ${subjectLabel(entry.primary.subjects)}.`);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyPaper(null);
    }
  };

  const applyStructure = async (entry) => {
    setBusyStructure(entry.subjectId);
    setError("");
    try {
      for (const row of entry.rows) {
        await callRpc("apply_assessment_template", {
          p_exam_subject_id: row.id,
          p_template_id: null,
          p_replace: false,
        });
      }
      onNotify?.(`Assessment structure applied to ${subjectLabel(entry.primary.subjects)}.`);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyStructure(null);
    }
  };

  const addSubject = async () => {
    if (!addSubjectId || exams.length === 0) return;
    setAddBusy(true);
    setError("");
    try {
      await callRpc("add_exam_subject", {
        p_exam_id: exams[0].id,
        p_subject_id: addSubjectId,
        p_teacher_id: null,
        p_max_marks: null,
        p_pass_marks: null,
      });
      const added = subjects.find((subject) => subject.id === addSubjectId);
      setAddSubjectId("");
      onNotify?.(`${subjectLabel(added)} added to "${group.name}".`);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setAddBusy(false);
    }
  };

  const removeSubject = async (entry) => {
    setBusySubject(entry.subjectId);
    setError("");
    try {
      await callRpc("remove_exam_subject", { p_exam_subject_id: entry.primary.id });
      setRemoveTarget(null);
      onNotify?.(`${subjectLabel(entry.primary.subjects)} removed from "${group.name}".`);
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

        {editable ? (
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
            {onEditSchedule ? (
              <Button type="button" variant="subtle" onClick={() => onEditSchedule(group)}>
                Edit schedule
              </Button>
            ) : null}
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
          <p className="mt-0.5 text-sm font-semibold text-(--foreground) tabular-nums">{paperCount}</p>
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

      <div className="mt-4 space-y-3">
        {subjectsInGroup.length === 0 ? (
          <p className="rounded-xl border border-dashed border-(--border) px-4 py-4 text-center text-xs text-(--muted-foreground)">
            No subjects are attached to this examination yet.
          </p>
        ) : null}

        {subjectsInGroup.map((entry) => {
          const subject = entry.primary;
          const statusValue = groupSubjectStatus(group, subject.subject_id);
          const practical = isPracticalSubject(subject.subjects);
          const components = subject.assessment_components ?? [];

          if (componentMode) {
            return (
              <div key={entry.subjectId} className="rounded-xl border border-(--border-subtle)">
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-(--border-subtle) px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-(--foreground)">{subjectLabel(subject.subjects)}</p>
                    <p className="mt-0.5 text-[11px] text-(--muted-foreground)">
                      {practical ? "Practical" : "Theory"}
                      {subject.assessment_template_id
                        ? `, ${templateName.get(subject.assessment_template_id) ?? "assessment structure"}`
                        : ""}
                      {`, max ${subject.max_marks}`}
                      {subject.pass_marks != null ? `, pass ${subject.pass_marks}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <SubmissionChip status={statusValue} />
                    {editable && canEditSubjects && removeTarget === entry.subjectId ? (
                      <>
                        <Button
                          type="button"
                          variant="subtle"
                          onClick={() => removeSubject(entry)}
                          disabled={busySubject === entry.subjectId}
                        >
                          {busySubject === entry.subjectId ? "Removing…" : "Confirm remove"}
                        </Button>
                        <Button type="button" variant="subtle" onClick={() => setRemoveTarget(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : editable && canEditSubjects ? (
                      <Button type="button" variant="subtle" onClick={() => setRemoveTarget(entry.subjectId)}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>

                {components.length === 0 ? (
                  <div className="flex flex-wrap items-center gap-2 px-3 py-3">
                    <p className="text-xs text-(--muted-foreground)">
                      No assessment structure is attached to this subject yet.
                    </p>
                    {editable ? (
                      <Button
                        type="button"
                        variant="subtle"
                        onClick={() => applyStructure(entry)}
                        disabled={busyStructure === entry.subjectId}
                      >
                        {busyStructure === entry.subjectId ? "Applying…" : "Apply structure"}
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-(--surface-secondary)">
                        <tr className="border-b border-(--border-subtle)">
                          <th className="px-3 py-2 font-medium text-(--muted-foreground)">Paper</th>
                          <th className="px-3 py-2 font-medium text-(--muted-foreground)">Date</th>
                          <th className="px-3 py-2 font-medium text-(--muted-foreground)">Time</th>
                          <th className="px-3 py-2 font-medium text-(--muted-foreground)">Room</th>
                          <th className="px-3 py-2 font-medium text-(--muted-foreground)">Invigilator</th>
                          <th className="px-3 py-2 font-medium text-(--muted-foreground)">Conducted</th>
                          {editable ? (
                            <th className="px-3 py-2 font-medium text-(--muted-foreground)">Save</th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {components
                          .slice()
                          .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
                          .map((component) => {
                            const conducted = paperValue(entry.subjectId, component, "is_conducted");
                            const key = paperKey(entry.subjectId, component.code);
                            return (
                              <tr key={component.id} className="border-b border-(--border-subtle)/60 last:border-b-0 align-top">
                                <td className="px-3 py-2">
                                  <p className="font-medium text-(--foreground)">{component.name}</p>
                                  <p className="mt-0.5 text-[11px] text-(--muted-foreground)">
                                    {component.aggregation === "scaled"
                                      ? `${component.scale_from} to ${component.scale_to}`
                                      : `max ${component.max_marks}`}
                                    {component.aggregation === "average" ? `, group ${component.group_code || "IA"}` : ""}
                                    {component.is_optional ? ", optional" : ""}
                                  </p>
                                </td>
                                <td className="px-3 py-2 text-(--muted-foreground)">
                                  {editable ? (
                                    <input
                                      type="date"
                                      className={`${inputClass} w-36`}
                                      value={paperValue(entry.subjectId, component, "exam_date")}
                                      min={group.starts_on || undefined}
                                      max={group.ends_on || undefined}
                                      disabled={!conducted}
                                      onChange={(event) =>
                                        setPaperValue(entry.subjectId, component, "exam_date", event.target.value)
                                      }
                                      aria-label={`${component.name} date for ${subjectLabel(subject.subjects)}`}
                                    />
                                  ) : (
                                    formatExamDate(component.exam_date)
                                  )}
                                </td>
                                <td className="px-3 py-2 text-(--muted-foreground)">
                                  {editable ? (
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="time"
                                        className={`${inputClass} w-24`}
                                        value={formatClock(paperValue(entry.subjectId, component, "start_time"))}
                                        disabled={!conducted}
                                        onChange={(event) =>
                                          setPaperValue(entry.subjectId, component, "start_time", event.target.value)
                                        }
                                        aria-label={`${component.name} start time for ${subjectLabel(subject.subjects)}`}
                                      />
                                      <input
                                        type="time"
                                        className={`${inputClass} w-24`}
                                        value={formatClock(paperValue(entry.subjectId, component, "end_time"))}
                                        disabled={!conducted}
                                        onChange={(event) =>
                                          setPaperValue(entry.subjectId, component, "end_time", event.target.value)
                                        }
                                        aria-label={`${component.name} end time for ${subjectLabel(subject.subjects)}`}
                                      />
                                    </div>
                                  ) : (
                                    timeRange(component.start_time, component.end_time)
                                  )}
                                </td>
                                <td className="px-3 py-2 text-(--muted-foreground)">
                                  {editable ? (
                                    <input
                                      className={`${inputClass} w-28`}
                                      value={paperValue(entry.subjectId, component, "room")}
                                      disabled={!conducted}
                                      onChange={(event) =>
                                        setPaperValue(entry.subjectId, component, "room", event.target.value)
                                      }
                                      placeholder="Room"
                                      aria-label={`${component.name} room for ${subjectLabel(subject.subjects)}`}
                                    />
                                  ) : (
                                    component.room || "Not set"
                                  )}
                                </td>
                                <td className="px-3 py-2 text-(--muted-foreground)">
                                  {editable ? (
                                    <Select
                                      value={paperValue(entry.subjectId, component, "teacher_id")}
                                      disabled={!conducted}
                                      onChange={(event) =>
                                        setPaperValue(entry.subjectId, component, "teacher_id", event.target.value)
                                      }
                                      aria-label={`${component.name} invigilator for ${subjectLabel(subject.subjects)}`}
                                    >
                                      <option value="">Use assigned teacher</option>
                                      {teachers.map((teacher) => (
                                        <option key={teacher.id} value={teacher.id}>{teacherLabel(teacher)}</option>
                                      ))}
                                    </Select>
                                  ) : (
                                    teacherNames.get(component.teacher_id) ?? "Assigned teacher"
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  <label className="flex items-center gap-2 text-[11px] text-(--muted-foreground)">
                                    <input
                                      type="checkbox"
                                      checked={conducted}
                                      disabled={!editable}
                                      onChange={(event) =>
                                        setPaperValue(entry.subjectId, component, "is_conducted", event.target.checked)
                                      }
                                    />
                                    {conducted ? "Yes" : "Not conducted"}
                                  </label>
                                </td>
                                {editable ? (
                                  <td className="px-3 py-2">
                                    <Button
                                      type="button"
                                      variant="subtle"
                                      onClick={() => savePaper(entry, component)}
                                      disabled={busyPaper === key}
                                    >
                                      {busyPaper === key ? "Saving…" : "Save"}
                                    </Button>
                                  </td>
                                ) : null}
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          }

          return (
            <div key={entry.subjectId} className="overflow-x-auto rounded-xl border border-(--border-subtle)">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-(--surface-secondary)">
                  <tr className="border-b border-(--border-subtle)">
                    <th className="px-3 py-2 font-medium text-(--muted-foreground)">Subject</th>
                    <th className="px-3 py-2 font-medium text-(--muted-foreground)">Date</th>
                    <th className="px-3 py-2 font-medium text-(--muted-foreground)">Time</th>
                    <th className="px-3 py-2 font-medium text-(--muted-foreground)">Marks</th>
                    <th className="px-3 py-2 font-medium text-(--muted-foreground)">Invigilator</th>
                    <th className="px-3 py-2 font-medium text-(--muted-foreground)">Marks status</th>
                    {editable ? (
                      <th className="px-3 py-2 font-medium text-(--muted-foreground)">Schedule</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  <tr className="align-top">
                    <td className="px-3 py-2">
                      <p className="font-medium text-(--foreground)">{subjectLabel(subject.subjects)}</p>
                      <p className="mt-0.5 text-[11px] text-(--muted-foreground)">
                        Max {subject.max_marks}
                        {subject.pass_marks != null ? `, pass ${subject.pass_marks}` : ""}
                      </p>
                      {editable && canEditSubjects ? (
                        removeTarget === entry.subjectId ? (
                          <span className="mt-1 flex flex-wrap gap-1">
                            <Button
                              type="button"
                              variant="subtle"
                              onClick={() => removeSubject(entry)}
                              disabled={busySubject === entry.subjectId}
                            >
                              {busySubject === entry.subjectId ? "Removing…" : "Confirm remove"}
                            </Button>
                            <Button type="button" variant="subtle" onClick={() => setRemoveTarget(null)}>
                              Cancel
                            </Button>
                          </span>
                        ) : (
                          <Button type="button" variant="subtle" className="mt-1" onClick={() => setRemoveTarget(entry.subjectId)}>
                            Remove
                          </Button>
                        )
                      ) : null}
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
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {editable && canEditSubjects ? (
        <div className="mt-4 rounded-xl border border-(--border-subtle) p-3">
          <p className="text-sm font-medium text-(--foreground)">Add a subject</p>
          <p className="mt-0.5 text-xs text-(--muted-foreground)">
            Only subjects offered by this examination's classes can be added. Practical subjects are limited to practical and semester examinations.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Field label="Subject">
              <Select value={addSubjectId} onChange={(event) => setAddSubjectId(event.target.value)}>
                <option value="">Choose a subject</option>
                {availableSubjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subjectLabel(subject)}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="button" onClick={addSubject} disabled={!addSubjectId || addBusy}>
              {addBusy ? "Adding…" : "Add subject"}
            </Button>
          </div>
          {availableSubjects.length === 0 ? (
            <p className="mt-2 text-[11px] text-(--muted-foreground)">
              Every eligible subject is already attached.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? <p role="alert" className="mt-2 text-xs text-(--danger)">{error}</p> : null}
    </Card>
  );
}
