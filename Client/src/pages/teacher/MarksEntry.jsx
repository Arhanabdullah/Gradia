import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { chartAxis, chartTooltip } from "../../components/charts/ChartsConfig";
import { Button, Card, Empty, Field, Select, inputClass } from "../../components/ui";
import DashboardHeader from "../../components/dashboard/DashboardHeader";

const MarksEntry = () => {
  const { profile } = useAuth();
  const [classes, setClasses] = useState([]);
  const [exams, setExams] = useState([]);
  const [subjects, setSubjects] = useState([]); // my subjects in the selected class
  const [students, setStudents] = useState([]);
  const [marksState, setMarksState] = useState({}); // student_id -> value
  const [dirty, setDirty] = useState(new Set());
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const [classId, setClassId] = useState("");
  const [examId, setExamId] = useState("");
  const [subjectId, setSubjectId] = useState("");

  useEffect(() => {
    supabase
      .from("classes")
      .select("id, name")
      .order("name")
      .then(({ data }) => setClasses(data ?? []));
  }, []);

  useEffect(() => {
    setSubjects([]);
    setStudents([]);
    setMarksState({});
    if (!classId) return;
    supabase
      .from("subjects")
      .select("id, name, code, max_marks")
      .eq("class_id", classId)
      .eq("teacher_id", profile.id)
      .order("code")
      .then(({ data }) => setSubjects(data ?? []));
    supabase
      .from("profiles")
      .select("id, name, username")
      .eq("class_id", classId)
      .eq("role", "student")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => setStudents(data ?? []));
    supabase
      .from("exams")
      .select("id, name, academic_year")
      .eq("class_id", classId)
      .order("created_at", { ascending: false })
      .then(({ data }) => setExams(data ?? []));
  }, [classId, profile]);

  useEffect(() => {
    setMarksState({});
    setDirty(new Set());
    if (!examId || !subjectId) return;
    supabase
      .from("marks")
      .select("student_id, marks_obtained")
      .eq("exam_id", examId)
      .eq("subject_id", subjectId)
      .then(({ data }) => {
        const saved = {};
        (data ?? []).forEach((m) => (saved[m.student_id] = m.marks_obtained));
        setMarksState(saved);
      });
  }, [examId, subjectId]);

  const subject = subjects.find((s) => s.id === subjectId);
  const maxMarks = subject?.max_marks ?? 100;

  const performance = useMemo(() => {
    if (!subject || !examId) return null;
    const values = students
      .map((st) => ({ username: st.username ?? st.name, marks: Number(marksState[st.id]) }))
      .filter((r) => !Number.isNaN(r.marks) && r.marks !== null);
    const got = values.reduce((s, r) => s + r.marks, 0);
    return {
      entered: values.length,
      average: values.length > 0 ? Math.round((got / values.length) * 10) / 10 : null,
      rows: values.sort((a, b) => b.marks - a.marks),
    };
  }, [students, marksState, subject, examId]);
  const invalid = (v) =>
    v !== undefined && v !== null && v !== "" &&
    (Number.isNaN(Number(v)) || Number(v) < 0 || Number(v) > maxMarks);
  const invalidCount = students.filter((st) => invalid(marksState[st.id])).length;
  const entered = students.filter((st) => marksState[st.id] !== undefined && marksState[st.id] !== "").length;

  const setValue = (studentId, value) => {
    setMarksState({ ...marksState, [studentId]: value });
    setDirty((prev) => new Set(prev).add(studentId));
  };

  const save = async () => {
    if (invalidCount > 0) {
      setMessage(`Marks must be numbers between 0 and ${maxMarks}. Fix ${invalidCount} invalid entr${invalidCount === 1 ? "y" : "ies"} first.`);
      return;
    }
    setSaving(true);
    setMessage("");
    const rows = [...dirty]
      .filter((id) => marksState[id] !== "" && marksState[id] !== undefined)
      .map((id) => ({
        exam_id: examId,
        subject_id: subjectId,
        student_id: id,
        marks_obtained: Number(marksState[id]),
        entered_by: profile.id,
      }));
    // deletions: students whose saved mark exists but field was cleared
    const cleared = [...dirty].filter((id) => marksState[id] === "" || marksState[id] === undefined);
    for (const id of cleared) {
      await supabase
        .from("marks")
        .delete()
        .eq("exam_id", examId)
        .eq("subject_id", subjectId)
        .eq("student_id", id);
    }
    let err = null;
    if (rows.length > 0) {
      const res = await supabase
        .from("marks")
        .upsert(rows, { onConflict: "exam_id,subject_id,student_id" });
      err = res.error;
    }
    setSaving(false);
    setMessage(err ? `Save failed: ${err.message}` : `Saved ${rows.length + cleared.length} entries.`);
    setDirty(new Set());
  };

  return (
    <>
      <DashboardHeader title="Marks Entry" subtitle="Enter marks for your assigned subjects." />

      <Card className="mt-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Class">
            <Select value={classId} onChange={(e) => { setClassId(e.target.value); setExamId(""); setSubjectId(""); }}>
              <option value="">Select</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Exam">
            <Select value={examId} onChange={(e) => setExamId(e.target.value)} disabled={!classId}>
              <option value="">Select</option>
              {exams.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}{x.academic_year ? ` (${x.academic_year})` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="My subject">
            <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} disabled={!classId}>
              <option value="">Select</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.code} {s.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        {subjects.length === 0 && classId ? (
          <p className="mt-3 text-xs text-(--muted)">No subjects are assigned to you in this class.</p>
        ) : null}
      </Card>

      {classId && examId && subjectId ? (
        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-medium text-(--muted-foreground)">
              {entered} of {students.length} entered, max {maxMarks}
            </p>
            <Button onClick={save} disabled={saving || dirty.size === 0}>
              {saving ? "Saving…" : "Save marks"}
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {students.length === 0 && <Empty>No active students in this class.</Empty>}
            {students.map((st) => (
              <div key={st.id} className="glass-inner flex items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-sm">
                <span className="text-(--foreground)">
                  {st.name} <span className="text-(--muted-foreground)">({st.username})</span>
                </span>
                <input
                  type="number"
                  aria-invalid={invalid(marksState[st.id]) ? true : undefined}
                  className={`${inputClass} w-28 tabular-nums ${invalid(marksState[st.id]) ? "border-(--danger)!" : ""}`}
                  min={0}
                  max={maxMarks}
                  value={marksState[st.id] ?? ""}
                  onChange={(e) => setValue(st.id, e.target.value)}
                />
              </div>
            ))}
          </div>
          {message ? (
            <p
              role="status"
              className={`mt-3 text-xs ${message.startsWith("Save failed") || message.startsWith("Marks must be") ? "text-(--danger)" : "text-(--success)"}`}
            >
              {message}
            </p>
          ) : null}

          {performance && performance.entered > 0 ? (
            <Card className="mt-6">
              <div className="mb-4">
                <p className="text-sm font-medium text-(--foreground)">
                  Performance, {subject.code}
                </p>
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
