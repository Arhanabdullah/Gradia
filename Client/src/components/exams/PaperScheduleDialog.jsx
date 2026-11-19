import { useEffect, useMemo, useState } from "react";
import { Button, Field, inputClass } from "../ui";
import { callRpc } from "../../lib/db";
import {
  addMinutesToClock,
  componentDuration,
  formatExamDate,
  isClassworkComponent,
  teacherLabel,
} from "../../lib/exams";

const checkboxClass =
  "size-4 rounded border-(--border) accent-(--primary) focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2";

// Schedules one paper. A component paper (IA1, ESA, ...) saves through the
// component RPC; a single-paper subject saves through the subject RPC. Formal
// papers collect date, start time, duration, room and invigilator. Classwork
// only collects the conducted flag, because it has no date, room or invigilator
// by design.
export default function PaperScheduleDialog({ paper, teachers = [], onClose, onSaved, onNotify }) {
  const component = paper?.component ?? null;
  const examSubject = paper?.examSubject ?? null;
  const classwork = isClassworkComponent(component);
  const paperName = component?.name ?? "Subject paper";
  const source = component ?? examSubject;
  // A component falls back to the subject paper's date and clock so the dialog
  // opens with the same schedule the records table shows. Room and invigilator
  // are not inherited: an empty component field must stay empty rather than
  // silently assigning the subject teacher as the invigilator on save.
  const sourceDate = component?.exam_date || examSubject?.exam_date || "";
  const sourceStart = component?.start_time || examSubject?.start_time || "";
  const [form, setForm] = useState({
    exam_date: sourceDate,
    start_time: sourceStart ? sourceStart.slice(0, 5) : "",
    duration_minutes: component?.duration_minutes ?? examSubject?.duration_minutes ?? "",
    room: component ? component.room ?? "" : examSubject?.room ?? "",
    teacher_id: component ? component.teacher_id ?? "" : examSubject?.teacher_id ?? "",
    is_conducted: component ? component.is_conducted !== false : true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const teacherOptions = useMemo(
    () => [...teachers].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    [teachers],
  );

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  if (!paper || !source) return null;

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const endPreview = form.start_time
    ? addMinutesToClock(form.start_time, form.duration_minutes || componentDuration(source) || 0)
    : "";

  const save = async () => {
    setSaving(true);
    setError("");

    if (!classwork && form.start_time && form.duration_minutes !== "" && Number(form.duration_minutes) <= 0) {
      setError("Duration must be a positive number of minutes.");
      setSaving(false);
      return;
    }

    try {
      if (component) {
        const patch = classwork
          ? { is_conducted: form.is_conducted }
          : {
              is_conducted: form.is_conducted,
              exam_date: form.exam_date,
              start_time: form.start_time,
              duration_minutes: form.duration_minutes,
              room: form.room,
              teacher_id: form.teacher_id,
            };
        await callRpc("update_assessment_component_schedule", {
          p_component_id: component.id,
          p_patch: patch,
        });
      } else {
        // A single-paper subject stores one clock range; the database derives
        // its duration from the start and end time.
        await callRpc("update_exam_subject_schedule", {
          p_exam_subject_id: examSubject.id,
          p_exam_date: form.exam_date || null,
          p_start_time: form.start_time || null,
          p_end_time: addMinutesToClock(form.start_time, form.duration_minutes) || null,
          p_max_marks: examSubject.max_marks ?? null,
          p_pass_marks: examSubject.pass_marks ?? null,
          p_teacher_id: form.teacher_id || null,
          p_instructions: examSubject.instructions ?? null,
          p_room: form.room || null,
          p_allow_overlap: Boolean(examSubject.allow_overlap),
        });
      }
      onSaved?.();
      onNotify?.(
        classwork
          ? `${paperName} updated for ${paper.subjectName}.`
          : `${paperName} saved for ${paper.subjectName}.`,
      );
      onClose();
    } catch (err) {
      setError(err?.message ?? "Could not save this paper. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-(--background)/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paper-dialog-title"
      onMouseDown={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="glass-inner max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl p-5"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-(--muted-foreground)">
              {paper.className}
              {paper.semester ? `, semester ${paper.semester}` : ""}
            </p>
            <h3 id="paper-dialog-title" className="mt-1 text-lg font-semibold tracking-tight text-(--foreground)">
              {classwork ? "Update" : "Schedule"} {paperName}
            </h3>
            <p className="mt-1 text-xs text-(--muted-foreground)">
              {paper.subjectCode ? `${paper.subjectCode} ` : ""}
              {paper.subjectName}
            </p>
          </div>
          <Button type="button" variant="subtle" onClick={onClose} disabled={saving}>
            Close
          </Button>
        </div>

        {component ? (
          <>
            <label className="mt-4 flex items-center gap-2 text-sm text-(--foreground)">
              <input
                type="checkbox"
                className={checkboxClass}
                checked={form.is_conducted}
                onChange={(event) => set({ is_conducted: event.target.checked })}
              />
              Conducted
            </label>
            <p className="mt-1 text-xs text-(--muted-foreground)">
              {form.is_conducted
                ? "This paper counts towards the subject total."
                : "Skipped papers are left out of the subject total and the compiled result."}
            </p>
          </>
        ) : null}

        {classwork ? (
          <p className="mt-4 rounded-lg border border-dashed border-(--border) px-3.5 py-3 text-xs text-(--muted-foreground)">
            Classwork is marked in class. It has no examination date, room or invigilator, so only the
            conducted flag is saved here.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Examination date">
              <input
                type="date"
                className={inputClass}
                value={form.exam_date}
                onChange={(event) => set({ exam_date: event.target.value })}
              />
            </Field>
            <Field label="Start time">
              <input
                type="time"
                className={inputClass}
                value={form.start_time}
                onChange={(event) => set({ start_time: event.target.value })}
              />
            </Field>
            <Field label="Duration (minutes)">
              <input
                type="number"
                min="1"
                step="5"
                className={inputClass}
                value={form.duration_minutes}
                onChange={(event) => set({ duration_minutes: event.target.value })}
                placeholder="90"
              />
            </Field>
            <Field label="Room">
              <input
                type="text"
                className={inputClass}
                value={form.room}
                onChange={(event) => set({ room: event.target.value })}
                placeholder="R-101"
              />
            </Field>
            <Field label="Invigilator">
              <select
                className={inputClass}
                value={form.teacher_id}
                onChange={(event) => set({ teacher_id: event.target.value })}
              >
                <option value="">Not assigned</option>
                {teacherOptions.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacherLabel(teacher)}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-end">
              <p className="text-xs text-(--muted-foreground)">
                {form.exam_date ? formatExamDate(form.exam_date) : "Date not set"}
                {form.start_time ? `, ${form.start_time}` : ""}
                {endPreview ? ` to ${endPreview}` : ""}
              </p>
            </div>
          </div>
        )}

        {error ? (
          <p role="alert" className="mt-3 text-xs text-(--danger)">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="subtle" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save paper"}
          </Button>
        </div>
      </div>
    </div>
  );
}
