import { useMemo, useState } from "react";
import { Button, Card, Field, inputClass } from "../ui";
import { callRpc } from "../../lib/db";
import {
  addMinutesToClock,
  formatClock,
  isClassworkComponent,
  isPracticalSubject,
  timeRange,
} from "../../lib/exams";
import { aggregationLabel, numberText, scheduleModeLabel } from "../../lib/assessment";

const smallInput = `${inputClass} py-1.5 text-xs`;

function contributionOf(row) {
  if (!row) return 0;
  if (row.aggregation === "scaled") {
    return Number(row.scaleTo ?? row.weightPercent ?? row.maxMarks ?? 0);
  }
  return Number(row.weightPercent ?? row.maxMarks ?? 0);
}

function endForRow(row) {
  if (row.end_time) return row.end_time;
  if (row.start_time && row.duration_minutes) {
    return addMinutesToClock(row.start_time, row.duration_minutes);
  }
  return "";
}

function componentMatchesRow(component, row) {
  if (!component || !row) return false;
  const code = String(component.code ?? "").trim().toUpperCase();
  const rowCode = String(row.code ?? "").trim().toUpperCase();
  if (code && rowCode) return code === rowCode;
  return (component.name ?? "") === row.name;
}

function initialRows(examSubject, previewComponents) {
  const rows = examSubject?.assessment_components?.length
    ? examSubject.assessment_components
    : previewComponents;
  return (rows ?? [])
    .slice()
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    .map((component) => ({
      id: component.id ?? null,
      name: component.name ?? "Paper",
      code: component.code ?? "",
      componentType: component.component_type ?? "theory",
      aggregation: component.aggregation ?? "direct",
      groupCode: component.group_code ?? "",
      maxMarks: component.max_marks ?? null,
      weightPercent: component.weight_percent ?? null,
      scaleFrom: component.scale_from ?? null,
      scaleTo: component.scale_to ?? null,
      scheduleMode: component.schedule_mode ?? "formal",
      isConducted: component.is_conducted !== false,
      examDate: component.exam_date ?? "",
      startTime: component.start_time ? formatClock(component.start_time) : "",
      endTime: component.end_time ? formatClock(component.end_time) : "",
      durationMinutes: component.duration_minutes ?? "",
      room: component.room ?? "",
      allowOverlap: Boolean(component.allow_overlap),
    }));
}

// Full assessment breakdown for one subject inside its class semester
// examination. The rows come from the materialised structure created by
// Assessment Setup, so scheduling here never invents a new component.
export default function SemesterSubjectEditor({
  klass,
  subject,
  examSubject,
  previewComponents = [],
  subjectClasses = [],
  groupExams = [],
  groupScope = "class",
  canEdit = false,
  onClose,
  onSaved,
  onNotify,
}) {
  const [rows, setRows] = useState(() => initialRows(examSubject, previewComponents));
  const [classRooms, setClassRooms] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const scheduled = Boolean(examSubject);
  const practical = isPracticalSubject(subject);
  // A department group shares every paper date and time. Only the room is
  // edited per class, so one row expands into one room input per class.
  const multiClass = groupScope === "department" && groupExams.length > 1;
  const classPapers = useMemo(
    () =>
      groupExams
        .map((exam) => ({
          examId: exam.id,
          classId: exam.class_id,
          className: exam.classes?.name ?? "Class",
          examSubject: (exam.exam_subjects ?? []).find(
            (row) => row.subject_id === subject?.id,
          ) ?? null,
        }))
        .filter((entry) => entry.examSubject),
    [groupExams, subject?.id],
  );
  // subjectClasses is the union across the department group. classPapers is
  // the subset that already has this subject in the examination. Together they
  // let the editor name both the classes sharing the paper and the classes
  // that do not offer it.
  const offeringClassNames = useMemo(() => {
    const names = new Map();
    for (const klass of subjectClasses) {
      if (klass?.id && klass.name) names.set(klass.id, klass.name);
    }
    for (const entry of classPapers) {
      if (!names.has(entry.classId) && entry.className) {
        names.set(entry.classId, entry.className);
      }
    }
    return [...names.values()];
  }, [subjectClasses, classPapers]);
  const notOfferingClassNames = useMemo(() => {
    const offeringIds = new Set(subjectClasses.map((klass) => klass?.id).filter(Boolean));
    for (const entry of classPapers) offeringIds.add(entry.classId);
    return groupExams
      .filter((exam) => !offeringIds.has(exam.class_id))
      .map((exam) => exam.classes?.name)
      .filter(Boolean);
  }, [subjectClasses, classPapers, groupExams]);
  const papersFor = (row) =>
    classPapers
      .map((entry) => ({
        ...entry,
        component: (entry.examSubject.assessment_components ?? []).find((component) =>
          componentMatchesRow(component, row),
        ) ?? null,
      }))
      .filter((entry) => entry.component);
  const roomKey = (componentId, classId) => `${componentId}:${classId}`;
  const roomValue = (entry) =>
    classRooms[roomKey(entry.component.id, entry.classId)] ?? entry.component.room ?? "";
  const formalRows = useMemo(() => rows.filter((row) => !isClassworkComponent({ schedule_mode: row.scheduleMode })), [rows]);
  // A lab with every paper off is a deliberate direct-marks setup: the teacher
  // enters one mark out of 100 in Marks Entry instead of marking each paper.
  const directMode = practical && rows.length > 0 && rows.every((row) => !row.isConducted);

  const updateRow = (index, patch) => {
    setRows((current) =>
      current.map((row, position) => {
        if (position !== index) return row;
        const next = { ...row, ...patch };
        if (patch.startTime !== undefined || patch.durationMinutes !== undefined) {
          next.endTime =
            next.startTime && next.durationMinutes
              ? addMinutesToClock(next.startTime, next.durationMinutes)
              : "";
        }
        return next;
      }),
    );
  };

  const save = async () => {
    setError("");
    if (!scheduled) {
      setError("Add this subject to the class semester examination before scheduling its papers.");
      return;
    }

    for (const row of formalRows) {
      if (!row.isConducted) continue;
      if (row.startTime && row.endTime && row.endTime <= row.startTime) {
        setError(`${row.name}: the end time must be after the start time.`);
        return;
      }
    }

    if (formalRows.length > 0 && !formalRows.some((row) => row.isConducted) && !directMode) {
      setError(
        practical
          ? "Keep at least one paper switched on, or switch off every lab paper to enter direct marks out of 100."
          : "Keep at least one paper switched on.",
      );
      return;
    }

    setSaving(true);
    try {
      for (const row of rows) {
        if (!row.id) continue;
        const classwork = isClassworkComponent({ schedule_mode: row.scheduleMode });
        // Classwork is never scheduled. For a practical subject its conducted
        // switch still matters: all three lab activities must be off before
        // the single direct mark is available.
        if (classwork) {
          if (!practical) continue;
          await callRpc("update_assessment_component_schedule", {
            p_component_id: row.id,
            p_patch: { is_conducted: row.isConducted },
          });
          continue;
        }
        const patch = {
          is_conducted: row.isConducted,
          exam_date: row.examDate || null,
          start_time: row.startTime || null,
          end_time: row.endTime || null,
          duration_minutes: row.durationMinutes === "" ? null : Number(row.durationMinutes),
          allow_overlap: Boolean(row.allowOverlap),
        };
        // In a department group the shared call must not carry a room; each
        // class writes its own copy afterwards.
        if (!multiClass) patch.room = row.room?.trim() || null;
        await callRpc("update_assessment_component_schedule", {
          p_component_id: row.id,
          p_patch: patch,
        });

        if (multiClass && row.isConducted) {
          for (const entry of papersFor(row)) {
            await callRpc("update_assessment_component_schedule", {
              p_component_id: entry.component.id,
              p_patch: { room: roomValue(entry).trim() || null },
              p_room_class_id: entry.classId,
            });
          }
        }
      }
      onNotify?.(`Saved the assessment schedule for ${subject?.code ?? subject?.name ?? "the subject"}.`);
      onSaved?.();
    } catch (err) {
      setError(err?.message ?? "Could not save this subject schedule.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-(--muted-foreground)">Assessment breakdown</p>
          <h3 className="mt-0.5 text-base font-semibold tracking-tight text-(--foreground)">
            {subject?.code ? `${subject.code} ${subject.name}` : subject?.name ?? "Subject"}
          </h3>
          <p className="mt-0.5 text-xs text-(--muted-foreground)">
            {multiClass && klass?.name ? `Primary copy from ${klass.name}. ` : klass?.name ? `${klass.name}, ` : ""}
            {practical ? "Practical" : "Theory"} structure from Assessment Setup.
          </p>
          {multiClass ? (
            <div className="mt-1 space-y-0.5">
              <p className="text-[11px] text-(--muted-foreground)">
                Offered by {offeringClassNames.length} class{offeringClassNames.length === 1 ? "" : "es"}: {" "}
                {offeringClassNames.join(", ") || "the selected classes"}.
              </p>
              {notOfferingClassNames.length > 0 ? (
                <p className="text-[11px] text-(--muted-foreground)">
                  Not offered by: {notOfferingClassNames.join(", ")}.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="subtle" onClick={onClose}>
            Close
          </Button>
          {canEdit && scheduled ? (
            <Button type="button" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save schedule"}
            </Button>
          ) : null}
        </div>
      </div>

      {!scheduled ? (
        <p className="mt-3 rounded-lg border border-dashed border-(--border) px-3.5 py-3 text-xs text-(--muted-foreground)">
          This subject is not part of the class semester examination yet. The structure below is the
          blueprint from Assessment Setup. Add the subject to the examination to schedule its papers.
        </p>
      ) : null}

      {directMode ? (
        <p className="mt-3 rounded-lg border border-(--primary)/30 bg-(--primary)/5 px-3.5 py-3 text-xs text-(--foreground)">
          Direct marks: all lab papers are switched off. Teachers enter one mark out of 100 per student in Marks Entry.
        </p>
      ) : null}

      <div className="mt-4 space-y-2">
        {rows.map((row, index) => {
          const classwork = isClassworkComponent({ schedule_mode: row.scheduleMode });
          return (
            <div key={row.id ?? `${row.code}-${index}`} className="rounded-lg border border-(--border) p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-(--foreground)">
                    {row.name}
                    {row.code ? <span className="ml-1.5 text-[11px] text-(--muted-foreground)">{row.code}</span> : null}
                  </p>
                  <p className="mt-0.5 text-[11px] text-(--muted-foreground)">
                    Max {numberText(row.maxMarks)}, contributes {numberText(contributionOf(row))}
                    {row.aggregation && row.aggregation !== "direct" ? `, ${aggregationLabel(row.aggregation)}` : ""}
                    {row.groupCode ? ` (${row.groupCode})` : ""}, {scheduleModeLabel(row.scheduleMode)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {classwork ? (
                    <span className="rounded-md border border-(--border) bg-(--surface-secondary) px-1.5 py-0.5 text-[11px] text-(--muted-foreground)">
                      Marked in Marks Entry
                    </span>
                  ) : null}
                  {!classwork || practical ? (
                    <label className="flex items-center gap-1.5 text-[11px] text-(--muted-foreground)">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-(--primary)"
                        checked={row.isConducted}
                        disabled={!canEdit || !scheduled}
                        onChange={(event) => updateRow(index, { isConducted: event.target.checked })}
                      />
                      Conducted
                    </label>
                  ) : null}
                </div>
              </div>

              {classwork ? (
                <p className="mt-2 text-[11px] text-(--muted-foreground)">
                  Classwork has no date or room. Teachers publish it from Classwork and enter marks here.
                  {practical ? " Switch it off with the other lab papers to enter one direct mark out of 100." : ""}
                </p>
              ) : (
                <div className={`mt-2.5 grid gap-2 sm:grid-cols-2 ${multiClass ? "lg:grid-cols-4" : "lg:grid-cols-5"}`}>
                  <Field label="Paper date">
                    <input
                      type="date"
                      className={smallInput}
                      value={row.examDate ?? ""}
                      disabled={!canEdit || !scheduled || !row.isConducted}
                      onChange={(event) => updateRow(index, { examDate: event.target.value })}
                    />
                  </Field>
                  <Field label="Start time">
                    <input
                      type="time"
                      className={smallInput}
                      value={row.startTime ?? ""}
                      disabled={!canEdit || !scheduled || !row.isConducted}
                      onChange={(event) => updateRow(index, { startTime: event.target.value })}
                    />
                  </Field>
                  <Field label="Duration (minutes)">
                    <input
                      type="number"
                      min="1"
                      step="5"
                      className={smallInput}
                      value={row.durationMinutes ?? ""}
                      disabled={!canEdit || !scheduled || !row.isConducted}
                      onChange={(event) => updateRow(index, { durationMinutes: event.target.value })}
                      placeholder="120"
                    />
                  </Field>
                  <Field label="Ends at">
                    <input
                      type="text"
                      className={`${smallInput} text-(--muted-foreground)`}
                      value={endForRow(row) ? formatClock(endForRow(row)) : "Not set"}
                      readOnly
                      tabIndex={-1}
                    />
                  </Field>
                  {!multiClass ? (
                    <Field label={practical ? "Lab" : "Room"}>
                      <input
                        type="text"
                        className={smallInput}
                        value={row.room ?? ""}
                        disabled={!canEdit || !scheduled || !row.isConducted}
                        onChange={(event) => updateRow(index, { room: event.target.value })}
                        placeholder={practical ? "Lab 2" : "R-101"}
                      />
                    </Field>
                  ) : null}
                </div>
              )}

              {!classwork && multiClass && row.isConducted ? (
                <div className="mt-2.5 rounded-lg border border-(--border) bg-(--surface-secondary)/40 p-2.5">
                  <p className="text-[11px] font-medium text-(--muted-foreground)">
                    Room by class
                    <span className="ml-1 font-normal">shared date and time, separate rooms</span>
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {papersFor(row).map((entry) => (
                      <Field key={`${entry.component.id}:${entry.classId}`} label={entry.className}>
                        <input
                          type="text"
                          className={smallInput}
                          value={roomValue(entry)}
                          disabled={!canEdit || !scheduled}
                          onChange={(event) =>
                            setClassRooms((current) => ({
                              ...current,
                              [roomKey(entry.component.id, entry.classId)]: event.target.value,
                            }))
                          }
                          placeholder={practical ? "Lab 2" : "R-101"}
                        />
                      </Field>
                    ))}
                  </div>
                  {classPapers.length <= 1 ? (
                    <p className="mt-2 text-[11px] text-(--muted-foreground)">
                      Only this class in the group offers this subject.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {!classwork ? (
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  <label className="flex items-center gap-1.5 pb-2 text-[11px] text-(--muted-foreground)">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-(--primary)"
                      checked={row.allowOverlap}
                      disabled={!canEdit || !scheduled || !row.isConducted}
                      onChange={(event) => updateRow(index, { allowOverlap: event.target.checked })}
                    />
                    Allow an overlapping paper
                  </label>
                  <span className="pb-2 text-[11px] text-(--muted-foreground)">
                    {timeRange(row.startTime, endForRow(row))}
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-(--border) px-3.5 py-3 text-xs text-(--muted-foreground)">
          No assessment structure is configured for this subject. Set its template in Assessment Setup first.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-xs text-(--danger)">
          {error}
        </p>
      ) : null}

      {!canEdit && scheduled ? (
        <p className="mt-3 text-[11px] text-(--muted-foreground)">
          You can review the structure but not change the schedule.
        </p>
      ) : null}
    </Card>
  );
}
