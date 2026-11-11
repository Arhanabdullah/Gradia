import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { Button, Card, Empty, Field, Select, inputClass } from "../../components/ui";
import DashboardHeader from "../../components/dashboard/DashboardHeader";
import { attendancePercentage, formatAttendance } from "../../lib/attendance";
import { fetchClassStudents } from "../../lib/roster";

const classLabel = (klass) => {
  if (!klass) return "";
  const parts = [klass.name];
  if (klass.academic_year) parts.push(klass.academic_year);
  if (klass.semester != null) parts.push(`Sem ${klass.semester}`);
  if (klass.section) parts.push(`Section ${klass.section}`);
  return parts.join(", ");
};

const subjectLabel = (subject) =>
  subject ? `${subject.code ? `${subject.code}, ` : ""}${subject.name}` : "Subject";

const emptyRecord = { attended: "", total: "", saved: false };

const Attendance = () => {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [scopeLoading, setScopeLoading] = useState(true);
  const [scopeError, setScopeError] = useState("");

  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [academicYear, setAcademicYear] = useState("");
  const [teacherId, setTeacherId] = useState("");

  const [students, setStudents] = useState([]);
  const [records, setRecords] = useState({});
  const [rosterLoading, setRosterLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedClass = classes.find((klass) => klass.id === classId);

  // ---------- academic scope ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!profile) return;
      setScopeLoading(true);
      setScopeError("");
      try {
        if (isAdmin) {
          const { data, error: loadError } = await supabase
            .from("classes")
            .select("id, name, academic_year, semester, section, is_active")
            .order("name");
          if (loadError) throw new Error(loadError.message);
          if (cancelled) return;
          setClasses(data ?? []);
          setAssignments([]);
          setSubjects([]);
        } else {
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
              .select("id, name, academic_year, semester, section, is_active")
              .in("id", classIds)
              .order("name"),
            supabase
              .from("subjects")
              .select("id, name, code")
              .in("id", subjectIds)
              .order("code"),
          ]);
          if (classesRes.error) throw new Error(classesRes.error.message);
          if (subjectsRes.error) throw new Error(subjectsRes.error.message);
          if (cancelled) return;

          setAssignments(rows);
          setClasses(classesRes.data ?? []);
          setSubjects(subjectsRes.data ?? []);
        }
      } catch (err) {
        if (!cancelled) setScopeError(err.message);
      } finally {
        if (!cancelled) setScopeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile, isAdmin]);

  // ---------- subjects offered in the selected class ----------
  useEffect(() => {
    let cancelled = false;
    setSubjectId("");
    setTeacherId("");
    setStudents([]);
    setRecords({});
    setMessage("");
    setError("");

    if (!classId) {
      setAcademicYear("");
      if (isAdmin) setSubjects([]);
      return undefined;
    }

    const klass = classes.find((item) => item.id === classId);
    setAcademicYear((klass?.academic_year ?? "").trim());

    if (!isAdmin) {
      return undefined;
    }

    setSubjects([]);
    supabase
      .from("class_subjects")
      .select("subject_id, subjects ( id, name, code )")
      .eq("class_id", classId)
      .then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (loadError) {
          setError(loadError.message);
          return;
        }
        const rows = (data ?? [])
          .map((row) => {
            const subject = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;
            return subject ? { id: row.subject_id, name: subject.name, code: subject.code } : null;
          })
          .filter(Boolean)
          .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));
        setSubjects(rows);
      });

    return () => {
      cancelled = true;
    };
  }, [classId, classes, assignments, isAdmin]);

  // ---------- teachers assigned to the selected class + subject ----------
  useEffect(() => {
    let cancelled = false;
    setTeacherId(isAdmin ? "" : profile?.id ?? "");

    if (!isAdmin || !classId || !subjectId) {
      setTeachers([]);
      return undefined;
    }

    supabase
      .from("teacher_assignments")
      .select("teacher_id, profiles ( id, name )")
      .eq("class_id", classId)
      .eq("subject_id", subjectId)
      .then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (loadError) {
          setError(loadError.message);
          return;
        }
        const map = new Map();
        (data ?? []).forEach((row) => {
          const person = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
          if (person) map.set(row.teacher_id, person);
        });
        const rows = [...map.values()].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
        setTeachers(rows);
        if (rows.length === 1) setTeacherId(rows[0].id);
      });

    return () => {
      cancelled = true;
    };
  }, [isAdmin, classId, subjectId, profile?.id]);

  // ---------- roster + existing attendance ----------
  useEffect(() => {
    let cancelled = false;
    setStudents([]);
    setRecords({});
    setMessage("");
    setError("");
    if (!classId || !subjectId || !academicYear.trim()) return undefined;

    const year = academicYear.trim();
    setRosterLoading(true);
    (async () => {
      try {
        const roster = await fetchClassStudents(classId);
        const { data, error: loadError } = await supabase
          .from("attendance")
          .select("student_id, attended_classes, total_classes")
          .eq("class_id", classId)
          .eq("subject_id", subjectId)
          .eq("academic_year", year);
        if (loadError) throw new Error(loadError.message);
        if (cancelled) return;

        const saved = {};
        (data ?? []).forEach((row) => {
          saved[row.student_id] = {
            attended: String(row.attended_classes ?? ""),
            total: String(row.total_classes ?? ""),
            saved: true,
          };
        });
        const initial = {};
        roster.forEach((student) => {
          initial[student.id] = saved[student.id] ?? emptyRecord;
        });

        setStudents(roster);
        setRecords(initial);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setRosterLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [classId, subjectId, academicYear]);

  const subjectOptions = useMemo(() => {
    if (isAdmin) return subjects;
    const assignedSubjectIds = new Set(
      assignments.filter((row) => row.class_id === classId).map((row) => row.subject_id),
    );
    return subjects.filter((item) => assignedSubjectIds.has(item.id));
  }, [isAdmin, subjects, assignments, classId]);

  const subject = subjectOptions.find((row) => row.id === subjectId);

  const updateRecord = (studentId, key, value) => {
    setRecords((current) => ({
      ...current,
      [studentId]: {
        ...(current[studentId] ?? emptyRecord),
        [key]: value,
      },
    }));
  };

  const invalidRecord = (record) => {
    if (!record) return false;
    const hasAttended = record.attended !== "";
    const hasTotal = record.total !== "";
    if (!hasAttended && !hasTotal) return false;
    if (!hasAttended || !hasTotal) return true;
    const attended = Number(record.attended);
    const total = Number(record.total);
    return (
      !Number.isInteger(attended) ||
      !Number.isInteger(total) ||
      attended < 0 ||
      total <= 0 ||
      attended > total
    );
  };

  const invalidCount = students.filter((student) => invalidRecord(records[student.id])).length;

  const enteredCount = students.filter((student) => {
    const record = records[student.id];
    return record && record.attended !== "" && record.total !== "";
  }).length;

  const summary = useMemo(() => {
    let attended = 0;
    let total = 0;
    students.forEach((student) => {
      const record = records[student.id];
      if (!record || record.attended === "" || record.total === "") return;
      const a = Number(record.attended);
      const t = Number(record.total);
      if (Number.isInteger(a) && Number.isInteger(t) && a >= 0 && t > 0 && a <= t) {
        attended += a;
        total += t;
      }
    });
    return { attended, total, percentage: attendancePercentage(attended, total) };
  }, [students, records]);

  const save = async () => {
    setMessage("");
    setError("");
    if (!classId || !subjectId) {
      setError("Choose a class and subject first.");
      return;
    }
    if (!academicYear.trim()) {
      setError("Enter the academic year for this attendance record.");
      return;
    }
    if (!teacherId) {
      setError("Choose the teacher who recorded this attendance.");
      return;
    }
    if (invalidCount > 0) {
      setError(
        `Attendance must use whole numbers with total classes above zero and attended classes no greater than total. Fix ${invalidCount} row${invalidCount === 1 ? "" : "s"} first.`,
      );
      return;
    }

    setSaving(true);
    try {
      const rows = [];
      const deletes = [];
      students.forEach((student) => {
        const record = records[student.id] ?? emptyRecord;
        const blank = record.attended === "" && record.total === "";
        if (blank) {
          if (record.saved) deletes.push(student.id);
          return;
        }
        rows.push({
          student_id: student.id,
          class_id: classId,
          subject_id: subjectId,
          academic_year: academicYear.trim(),
          teacher_id: teacherId,
          attended_classes: Number(record.attended),
          total_classes: Number(record.total),
        });
      });

      for (const studentId of deletes) {
        const { error: deleteError } = await supabase
          .from("attendance")
          .delete()
          .eq("student_id", studentId)
          .eq("class_id", classId)
          .eq("subject_id", subjectId)
          .eq("academic_year", academicYear.trim());
        if (deleteError) throw new Error(deleteError.message);
      }

      if (rows.length > 0) {
        const { error: saveError } = await supabase
          .from("attendance")
          .upsert(rows, { onConflict: "student_id,class_id,subject_id,academic_year" });
        if (saveError) throw new Error(saveError.message);
      }

      setRecords((current) => {
        const next = { ...current };
        students.forEach((student) => {
          const record = current[student.id] ?? emptyRecord;
          const blank = record.attended === "" && record.total === "";
          next[student.id] = blank ? emptyRecord : { ...record, saved: true };
        });
        return next;
      });
      setMessage(
        `Saved ${rows.length} attendance record${rows.length === 1 ? "" : "s"}${deletes.length ? ` and cleared ${deletes.length}` : ""}.`,
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DashboardHeader
        title="Attendance"
        subtitle="Record classes attended and classes conducted for each subject."
      />

      <Card className="mt-6">
        <div className="mb-4">
          <p className="text-sm font-medium text-(--foreground)">Choose a class and subject</p>
          <p className="mt-1 text-xs text-(--muted-foreground)">
            The percentage is calculated as attended classes divided by total classes, multiplied by 100.
            Saving an existing student and subject updates that record instead of creating a duplicate.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Class">
            <Select
              value={classId}
              onChange={(event) => setClassId(event.target.value)}
              disabled={scopeLoading}
            >
              <option value="">{scopeLoading ? "Loading classes" : "Choose a class"}</option>
              {classes.map((klass) => (
                <option key={klass.id} value={klass.id}>{classLabel(klass)}</option>
              ))}
            </Select>
          </Field>

          <Field label="Subject">
            <Select
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
              disabled={!classId || subjectOptions.length === 0}
            >
              <option value="">
                {!classId ? "Choose a class first" : subjectOptions.length === 0 ? "No subjects available" : "Choose a subject"}
              </option>
              {subjectOptions.map((item) => (
                <option key={item.id} value={item.id}>{subjectLabel(item)}</option>
              ))}
            </Select>
          </Field>

          <Field label="Academic year">
            <input
              className={inputClass}
              value={academicYear}
              onChange={(event) => setAcademicYear(event.target.value)}
              placeholder="e.g. 2026-27"
              disabled={Boolean(selectedClass?.academic_year)}
            />
          </Field>

          {isAdmin ? (
            <Field label="Recorded by teacher">
              <Select
                value={teacherId}
                onChange={(event) => setTeacherId(event.target.value)}
                disabled={!subjectId || teachers.length === 0}
              >
                <option value="">
                  {!subjectId ? "Choose a subject first" : teachers.length === 0 ? "No assigned teacher" : "Choose a teacher"}
                </option>
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Recorded by">
              <input className={inputClass} value={profile?.name ?? ""} readOnly />
            </Field>
          )}
        </div>

        {scopeLoading ? <p className="mt-3 text-xs text-(--muted-foreground)">Loading your classes.</p> : null}
        {!scopeLoading && classes.length === 0 ? (
          <Empty>
            {isAdmin
              ? "No classes exist yet. Create a class from Academics first."
              : "No classes are assigned to you yet. Ask an administrator to assign your subjects."}
          </Empty>
        ) : null}
        {classId && subjectOptions.length === 0 && !scopeLoading ? (
          <p className="mt-3 text-xs text-(--muted-foreground)">
            This class has no subjects available to you. Ask an administrator to assign the class subjects.
          </p>
        ) : null}
        {isAdmin && subjectId && teachers.length === 0 ? (
          <p className="mt-3 text-xs text-(--muted-foreground)">
            No teacher is assigned to this class and subject, so attendance cannot be linked to a teacher yet.
          </p>
        ) : null}
        {scopeError ? <p role="alert" className="mt-3 text-xs text-(--danger)">{scopeError}</p> : null}
      </Card>

      {classId && subjectId && academicYear ? (
        <section className="mt-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-(--foreground)">
                {subjectLabel(subject)}, {selectedClass ? classLabel(selectedClass) : ""}
              </p>
              <p className="mt-1 text-xs text-(--muted-foreground) tabular-nums">
                {enteredCount} of {students.length} students entered
                {invalidCount > 0 ? `, ${invalidCount} invalid` : ""}
                {summary.percentage !== null ? `, class attendance ${formatAttendance(summary.percentage)}` : ""}
              </p>
            </div>
            <Button onClick={save} disabled={saving || rosterLoading || students.length === 0}>
              {saving ? "Saving" : "Save attendance"}
            </Button>
          </div>

          {rosterLoading ? (
            <div className="mt-4 glass-inner h-40 motion-safe:animate-pulse rounded-xl" aria-hidden="true" />
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-(--border-subtle)">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-(--surface-secondary)">
                  <tr className="border-b border-(--border-subtle)">
                    <th className="px-3 py-2 font-medium text-(--muted-foreground)">Student</th>
                    <th className="px-3 py-2 font-medium text-(--muted-foreground)">Attended</th>
                    <th className="px-3 py-2 font-medium text-(--muted-foreground)">Total</th>
                    <th className="px-3 py-2 font-medium text-(--muted-foreground)">Attendance</th>
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
                    const record = records[student.id] ?? emptyRecord;
                    const invalid = invalidRecord(record);
                    const percentage = attendancePercentage(record.attended, record.total);
                    return (
                      <tr key={student.id} className="border-b border-(--border-subtle)/60 last:border-b-0">
                        <td className="px-3 py-2">
                          <p className="font-medium text-(--foreground)">{student.name}</p>
                          <p className="mt-0.5 text-[11px] text-(--muted-foreground)">
                            {student.username}
                            {record.saved ? ", recorded" : ""}
                          </p>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            aria-label={`Classes attended for ${student.name}`}
                            aria-invalid={invalid ? true : undefined}
                            className={`${inputClass} w-24 tabular-nums ${invalid ? "border-(--danger)!" : ""}`}
                            value={record.attended}
                            onChange={(event) => updateRecord(student.id, "attended", event.target.value)}
                            placeholder="0"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={1}
                            step={1}
                            aria-label={`Total classes for ${student.name}`}
                            aria-invalid={invalid ? true : undefined}
                            className={`${inputClass} w-24 tabular-nums ${invalid ? "border-(--danger)!" : ""}`}
                            value={record.total}
                            onChange={(event) => updateRecord(student.id, "total", event.target.value)}
                            placeholder="0"
                          />
                        </td>
                        <td className="px-3 py-2 font-medium text-(--foreground) tabular-nums">
                          {formatAttendance(percentage)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {message ? <p role="status" className="mt-3 text-xs text-(--success)">{message}</p> : null}
          {error ? <p role="alert" className="mt-3 text-xs text-(--danger)">{error}</p> : null}
        </section>
      ) : null}
    </>
  );
};

export default Attendance;
