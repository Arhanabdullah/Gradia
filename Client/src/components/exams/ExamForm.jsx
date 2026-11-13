import { useMemo, useState } from "react";
import { Button, Card, Field, Select, inputClass } from "../ui";
import { callRpc } from "../../lib/db";
import {
  REGULAR_EXAM_TYPES,
  examTypesForRole,
  derivedBatch,
  batchKey,
  subjectLabel,
  teacherLabel,
} from "../../lib/exams";

const textareaClass =
  "w-full rounded-lg border border-(--muted) bg-(--surface-secondary) px-3.5 py-2.5 text-sm text-(--foreground) placeholder:text-(--muted-foreground)/60 outline-none transition-colors focus:border-(--primary) focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40";

function departmentOfClass(klass, courseById) {
  const course = klass?.course_id ? courseById.get(klass.course_id) : null;
  return course?.department_id ?? "";
}

function degreeOfClass(klass, courseById) {
  const course = klass?.course_id ? courseById.get(klass.course_id) : null;
  return klass?.degree_id ?? course?.degree_id ?? "";
}

export default function ExamForm({
  profile,
  classes,
  departments,
  degrees,
  courses,
  subjects,
  classSubjects,
  teacherAssignments,
  teachers,
  onCreated,
  onCancel,
}) {
  const isTeacher = profile?.role === "teacher";
  const types = examTypesForRole(profile?.role);
  const [form, setForm] = useState({
    name: "",
    exam_type: isTeacher ? "class_test" : "mid_term",
    scope: "class",
    academic_year: "",
    department_id: "",
    degree_id: "",
    course_id: "",
    batch: "",
    class_id: "",
    class_ids: [],
    starts_on: "",
    ends_on: "",
    instructions: "",
    status: "draft",
  });
  const [rows, setRows] = useState({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  const courseById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
  const departmentName = useMemo(
    () => new Map(departments.map((department) => [department.id, department.name])),
    [departments],
  );
  const teacherName = useMemo(() => new Map(teachers.map((teacher) => [teacher.id, teacherLabel(teacher)])), [teachers]);
  const subjectById = useMemo(() => new Map(subjects.map((subject) => [subject.id, subject])), [subjects]);

  const myClassIds = useMemo(() => {
    if (!isTeacher) return null;
    return new Set(
      teacherAssignments.filter((row) => row.teacher_id === profile.id).map((row) => row.class_id),
    );
  }, [isTeacher, teacherAssignments, profile]);

  const scopedClasses = useMemo(
    () => classes.filter((klass) => !myClassIds || myClassIds.has(klass.id)),
    [classes, myClassIds],
  );

  const academicYears = useMemo(
    () => [...new Set(scopedClasses.map((klass) => klass.academic_year).filter(Boolean))].sort(),
    [scopedClasses],
  );

  const departmentOptions = useMemo(() => {
    const present = new Set(
      scopedClasses.map((klass) => departmentOfClass(klass, courseById)).filter(Boolean),
    );
    return departments.filter((department) => present.has(department.id));
  }, [departments, scopedClasses, courseById]);

  const degreeOptions = useMemo(() => {
    const present = new Set(
      scopedClasses
        .filter((klass) => !form.department_id || departmentOfClass(klass, courseById) === form.department_id)
        .map((klass) => degreeOfClass(klass, courseById))
        .filter(Boolean),
    );
    return degrees.filter((degree) => present.has(degree.id));
  }, [degrees, scopedClasses, form.department_id, courseById]);

  const courseOptions = useMemo(
    () =>
      courses.filter(
        (course) =>
          (!form.department_id || course.department_id === form.department_id) &&
          (!form.degree_id || !course.degree_id || course.degree_id === form.degree_id) &&
          scopedClasses.some((klass) => klass.course_id === course.id),
      ),
    [courses, form.department_id, form.degree_id, scopedClasses],
  );

  const batchClasses = useMemo(
    () =>
      scopedClasses.filter(
        (klass) =>
          (!form.academic_year || klass.academic_year === form.academic_year) &&
          (!form.department_id || departmentOfClass(klass, courseById) === form.department_id) &&
          (!form.degree_id || degreeOfClass(klass, courseById) === form.degree_id) &&
          (!form.course_id || klass.course_id === form.course_id),
      ),
    [scopedClasses, form.academic_year, form.department_id, form.degree_id, form.course_id, courseById],
  );

  const batchOptions = useMemo(() => {
    const map = new Map();
    batchClasses.forEach((klass) => map.set(batchKey(klass), derivedBatch(klass)));
    return [...map.entries()].map(([value, label]) => ({ value, label }));
  }, [batchClasses]);

  const classOptions = useMemo(
    () => batchClasses.filter((klass) => !form.batch || batchKey(klass) === form.batch),
    [batchClasses, form.batch],
  );

  const selectedClasses = useMemo(() => {
    if (form.scope === "class") {
      return form.class_id ? classOptions.filter((klass) => klass.id === form.class_id) : [];
    }
    return classOptions.filter((klass) => form.class_ids.includes(klass.id));
  }, [form.scope, form.class_id, form.class_ids, classOptions]);

  const selectedClassIds = selectedClasses.map((klass) => klass.id);

  const eligibleSubjects = useMemo(() => {
    if (selectedClassIds.length === 0) return [];
    const sets = selectedClassIds.map(
      (classId) =>
        new Set(
          classSubjects
            .filter((row) => row.class_id === classId)
            .map((row) => row.subject_id),
        ),
    );
    const shared = [...sets[0]].filter((subjectId) => sets.every((set) => set.has(subjectId)));
    return shared
      .map((subjectId) => subjectById.get(subjectId))
      .filter(Boolean)
      .filter((subject) => {
        if (!isTeacher) return true;
        return selectedClassIds.every((classId) =>
          teacherAssignments.some(
            (row) =>
              row.class_id === classId &&
              row.subject_id === subject.id &&
              row.teacher_id === profile.id,
          ),
        );
      })
      .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));
  }, [selectedClassIds, classSubjects, subjectById, isTeacher, teacherAssignments, profile]);

  const defaultTeacher = (subjectId) => {
    const assignment = teacherAssignments.find(
      (row) => row.subject_id === subjectId && selectedClassIds.includes(row.class_id),
    );
    return assignment?.teacher_id ?? (isTeacher ? profile.id : "");
  };

  const defaultRow = (subject) => {
    const max = Number(subject?.max_marks) || 100;
    return {
      exam_date: "",
      start_time: "",
      end_time: "",
      max_marks: max,
      pass_marks: Math.round(max * 0.4),
      teacher_id: defaultTeacher(subject?.id),
      room: "",
      instructions: "",
      allow_overlap: false,
    };
  };

  const rowFor = (subject) => ({ ...defaultRow(subject), ...(rows[subject.id] ?? {}) });

  const updateRow = (subjectId, patch) => {
    setRows((current) => ({ ...current, [subjectId]: { ...current[subjectId], ...patch } }));
  };

  const update = (patch) => setForm((current) => ({ ...current, ...patch }));

  const resetClassSelection = (patch) => {
    update({ ...patch, class_id: "", class_ids: [], batch: "" });
  };

  const chooseClass = (classId) => {
    const klass = classOptions.find((row) => row.id === classId);
    update({
      class_id: classId,
      academic_year: form.academic_year || klass?.academic_year || "",
      course_id: form.course_id || klass?.course_id || "",
      degree_id: form.degree_id || degreeOfClass(klass, courseById),
      department_id: form.department_id || departmentOfClass(klass, courseById),
    });
  };

  const toggleClass = (classId) => {
    update({
      class_ids: form.class_ids.includes(classId)
        ? form.class_ids.filter((id) => id !== classId)
        : [...form.class_ids, classId],
    });
  };

  const validate = () => {
    const problems = [];
    if (!form.name.trim()) problems.push("Give the examination a name.");
    if (!form.exam_type) problems.push("Choose an examination type.");
    if (isTeacher && !REGULAR_EXAM_TYPES.includes(form.exam_type)) {
      problems.push("Teachers can schedule class tests, unit tests, internal assessments, assignments and practicals.");
    }
    if (form.scope === "class" && !form.class_id) problems.push("Choose the class for this examination.");
    if (form.scope === "department" && form.class_ids.length === 0) {
      problems.push("Choose at least one class for this department examination.");
    }
    if (form.scope === "department" && !form.department_id) {
      problems.push("Choose a department for a department-wide examination.");
    }
    if (form.scope === "department" && !form.course_id) {
      problems.push("Choose a course for a department-wide examination.");
    }
    if (form.starts_on && form.ends_on && form.ends_on < form.starts_on) {
      problems.push("The end date cannot be before the start date.");
    }
    if (eligibleSubjects.length === 0) problems.push("No subject is offered by every selected class.");

    eligibleSubjects.forEach((subject) => {
      const row = rowFor(subject);
      const max = Number(row.max_marks);
      const pass = row.pass_marks === "" ? null : Number(row.pass_marks);
      if (!max || max <= 0) problems.push(`${subjectLabel(subject)}: maximum marks must be greater than zero.`);
      if (pass != null && (Number.isNaN(pass) || pass < 0 || pass > max || !max)) {
        problems.push(`${subjectLabel(subject)}: passing marks must sit between 0 and the maximum.`);
      }
      if (row.start_time && row.end_time && row.end_time <= row.start_time) {
        problems.push(`${subjectLabel(subject)}: the end time must be after the start time.`);
      }
      if (row.exam_date && form.starts_on && row.exam_date < form.starts_on) {
        problems.push(`${subjectLabel(subject)}: the paper is before the examination start date.`);
      }
      if (row.exam_date && form.ends_on && row.exam_date > form.ends_on) {
        problems.push(`${subjectLabel(subject)}: the paper is after the examination end date.`);
      }
    });

    // Papers in one class may not overlap unless the row explicitly allows it.
    const scheduled = eligibleSubjects
      .map((subject) => ({ subject, row: rowFor(subject) }))
      .filter(({ row }) => row.exam_date && row.start_time && row.end_time && !row.allow_overlap);
    for (let first = 0; first < scheduled.length; first += 1) {
      for (let second = first + 1; second < scheduled.length; second += 1) {
        const left = scheduled[first];
        const right = scheduled[second];
        if (left.row.exam_date !== right.row.exam_date) continue;
        if (left.row.start_time < right.row.end_time && left.row.end_time > right.row.start_time) {
          problems.push(
            `${subjectLabel(left.subject)} overlaps ${subjectLabel(right.subject)}. Change a time or allow the overlap.`,
          );
        }
      }
    }
    return [...new Set(problems)];
  };

  const problems = validate();

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (problems.length) {
      setError(problems[0]);
      return;
    }

    const payload = eligibleSubjects.map((subject) => {
      const row = rowFor(subject);
      return {
        subject_id: subject.id,
        exam_date: row.exam_date || null,
        start_time: row.start_time || null,
        end_time: row.end_time || null,
        max_marks: Number(row.max_marks),
        pass_marks: row.pass_marks === "" ? null : Number(row.pass_marks),
        teacher_id: row.teacher_id || null,
        room: row.room || null,
        instructions: row.instructions || "",
        allow_overlap: Boolean(row.allow_overlap),
        is_optional: false,
      };
    });

    setSaving(true);
    try {
      const groupId = await callRpc("create_exam_group", {
        p_name: form.name.trim(),
        p_exam_type: form.exam_type,
        p_scope: form.scope,
        p_department_id: form.department_id || null,
        p_course_id: form.course_id || null,
        p_academic_year: form.academic_year || null,
        p_academic_term_id: null,
        p_class_ids: selectedClassIds,
        p_starts_on: form.starts_on || null,
        p_ends_on: form.ends_on || null,
        p_instructions: form.instructions || "",
        p_status: form.status,
        p_subjects: payload,
      });
      setSuccess(`Scheduled "${form.name.trim()}".`);
      setRows({});
      setForm((current) => ({
        ...current,
        name: "",
        class_id: "",
        class_ids: [],
        starts_on: "",
        ends_on: "",
        instructions: "",
      }));
      onCreated?.(groupId);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const departmentLabel = form.department_id ? departmentName.get(form.department_id) : "";

  return (
    <Card className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-(--foreground)">Schedule an examination</p>
          <p className="mt-1 text-xs text-(--muted-foreground)">
            {isTeacher
              ? "Choose a class you teach, then schedule the subjects you are assigned."
              : "One class or a whole department. Every class receives the same subject schedule."}
          </p>
        </div>
        {onCancel ? (
          <Button type="button" variant="subtle" onClick={onCancel}>
            Close
          </Button>
        ) : null}
      </div>

      <form onSubmit={submit} className="mt-5 space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Examination name">
            <input
              className={inputClass}
              value={form.name}
              onChange={(event) => update({ name: event.target.value })}
              placeholder="Mid-term 2026"
              required
            />
          </Field>
          <Field label="Type">
            <Select value={form.exam_type} onChange={(event) => update({ exam_type: event.target.value })}>
              {types.map((type) => (
                <option key={type.id} value={type.id}>{type.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(event) => update({ status: event.target.value })}>
              <option value="draft">Draft</option>
              <option value="open">Open</option>
              <option value="ongoing">Ongoing</option>
              <option value="completed">Completed</option>
            </Select>
          </Field>
        </div>

        <div>
          <p className="text-xs font-medium text-(--muted)">Scope</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              variant={form.scope === "class" ? "primary" : "subtle"}
              onClick={() => update({ scope: "class", class_ids: [] })}
            >
              One class
            </Button>
            {!isTeacher ? (
              <Button
                type="button"
                variant={form.scope === "department" ? "primary" : "subtle"}
                onClick={() => update({ scope: "department", class_id: "" })}
              >
                Department-wide
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Academic year">
            <Select
              value={form.academic_year}
              onChange={(event) => resetClassSelection({ academic_year: event.target.value })}
            >
              <option value="">Any year</option>
              {academicYears.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </Select>
          </Field>
          <Field label="Department">
            <Select
              value={form.department_id}
              onChange={(event) => resetClassSelection({ department_id: event.target.value, degree_id: "", course_id: "" })}
            >
              <option value="">Any department</option>
              {departmentOptions.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Degree">
            <Select
              value={form.degree_id}
              onChange={(event) => resetClassSelection({ degree_id: event.target.value, course_id: "" })}
              disabled={degreeOptions.length === 0}
            >
              <option value="">Any degree</option>
              {degreeOptions.map((degree) => (
                <option key={degree.id} value={degree.id}>{degree.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Course">
            <Select
              value={form.course_id}
              onChange={(event) => resetClassSelection({ course_id: event.target.value })}
            >
              <option value="">Any course</option>
              {courseOptions.map((course) => (
                <option key={course.id} value={course.id}>{course.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Batch">
            <Select value={form.batch} onChange={(event) => update({ batch: event.target.value, class_id: "", class_ids: [] })}>
              <option value="">Any batch</option>
              {batchOptions.map((batch) => (
                <option key={batch.value} value={batch.value}>{batch.label}</option>
              ))}
            </Select>
          </Field>
        </div>

        {form.scope === "class" ? (
          <Field label="Class">
            <Select value={form.class_id} onChange={(event) => chooseClass(event.target.value)}>
              <option value="">Choose a class</option>
              {classOptions.map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.name}, {derivedBatch(klass)}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <fieldset className="rounded-xl border border-(--border-subtle) p-4">
            <legend className="px-1 text-xs font-medium text-(--muted)">Classes in {departmentLabel || "the department"}</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {classOptions.length === 0 ? (
                <p className="text-xs text-(--muted-foreground)">No classes match the current filters.</p>
              ) : null}
              {classOptions.map((klass) => (
                <label key={klass.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-(--border-subtle) px-3 py-2">
                  <input
                    type="checkbox"
                    checked={form.class_ids.includes(klass.id)}
                    onChange={() => toggleClass(klass.id)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 text-xs text-(--foreground)">
                    {klass.name}
                    <span className="block text-(--muted-foreground)">{derivedBatch(klass)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts on">
            <input
              type="date"
              className={inputClass}
              value={form.starts_on}
              onChange={(event) => update({ starts_on: event.target.value })}
            />
          </Field>
          <Field label="Ends on">
            <input
              type="date"
              className={inputClass}
              value={form.ends_on}
              onChange={(event) => update({ ends_on: event.target.value })}
            />
          </Field>
        </div>

        <Field label="Instructions">
          <textarea
            className={textareaClass}
            rows={3}
            value={form.instructions}
            onChange={(event) => update({ instructions: event.target.value })}
            placeholder="Reporting time, permitted materials, seating notes."
          />
        </Field>

        <section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-(--foreground)">Subject schedule</p>
              <p className="mt-0.5 text-xs text-(--muted-foreground)">
                Different dates and times are allowed per subject. Overlaps within one class are rejected.
              </p>
            </div>
            <p className="text-xs text-(--muted-foreground) tabular-nums">
              {eligibleSubjects.length} subject{eligibleSubjects.length === 1 ? "" : "s"}
            </p>
          </div>

          {selectedClassIds.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-(--border) px-4 py-4 text-xs text-(--muted-foreground)">
              Choose {form.scope === "class" ? "a class" : "the classes"} first. Subjects appear here once the class is set.
            </p>
          ) : eligibleSubjects.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-(--border) px-4 py-4 text-xs text-(--muted-foreground)">
              No subject is offered by every selected class. Choose classes that share subjects.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {eligibleSubjects.map((subject) => {
                const row = rowFor(subject);
                return (
                  <div key={subject.id} className="rounded-xl border border-(--border-subtle) p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-(--foreground)">{subjectLabel(subject)}</p>
                      <span className="text-xs text-(--muted-foreground) tabular-nums">
                        Subject maximum {subject.max_marks}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <Field label="Paper date">
                        <input
                          type="date"
                          className={inputClass}
                          value={row.exam_date}
                          min={form.starts_on || undefined}
                          max={form.ends_on || undefined}
                          onChange={(event) => updateRow(subject.id, { exam_date: event.target.value })}
                        />
                      </Field>
                      <Field label="Start time">
                        <input
                          type="time"
                          className={inputClass}
                          value={row.start_time}
                          onChange={(event) => updateRow(subject.id, { start_time: event.target.value })}
                        />
                      </Field>
                      <Field label="End time">
                        <input
                          type="time"
                          className={inputClass}
                          value={row.end_time}
                          onChange={(event) => updateRow(subject.id, { end_time: event.target.value })}
                        />
                      </Field>
                      <Field label="Room">
                        <input
                          className={inputClass}
                          value={row.room}
                          onChange={(event) => updateRow(subject.id, { room: event.target.value })}
                          placeholder="Block A, room 12"
                        />
                      </Field>
                      <Field label="Maximum marks">
                        <input
                          type="number"
                          className={inputClass}
                          min={1}
                          value={row.max_marks}
                          onChange={(event) => updateRow(subject.id, { max_marks: event.target.value })}
                        />
                      </Field>
                      <Field label="Passing marks">
                        <input
                          type="number"
                          className={inputClass}
                          min={0}
                          value={row.pass_marks}
                          onChange={(event) => updateRow(subject.id, { pass_marks: event.target.value })}
                        />
                      </Field>
                      <Field label="Invigilator">
                        <Select
                          value={row.teacher_id}
                          onChange={(event) => updateRow(subject.id, { teacher_id: event.target.value })}
                        >
                          <option value="">Use assigned teacher</option>
                          {teachers.map((teacher) => (
                            <option key={teacher.id} value={teacher.id}>{teacherLabel(teacher)}</option>
                          ))}
                        </Select>
                      </Field>
                      <label className="flex items-end gap-2 pb-2 text-xs text-(--muted-foreground)">
                        <input
                          type="checkbox"
                          checked={row.allow_overlap}
                          onChange={(event) => updateRow(subject.id, { allow_overlap: event.target.checked })}
                          className="mb-0.5"
                        />
                        Allow overlap
                      </label>
                    </div>
                    {row.teacher_id ? (
                      <p className="mt-1 text-xs text-(--muted-foreground)">
                        Invigilator: {teacherName.get(row.teacher_id) ?? "Selected teacher"}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {error ? (
          <p role="alert" className="text-xs text-(--danger)">{error}</p>
        ) : null}
        {success ? (
          <p role="status" className="text-xs text-(--success)">{success}</p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-(--muted-foreground)">
            Dates and times are checked against the other papers for the same class before saving.
          </p>
          <Button type="submit" disabled={saving || selectedClassIds.length === 0}>
            {saving ? "Scheduling…" : "Schedule examination"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
