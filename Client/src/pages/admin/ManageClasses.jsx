import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Button, Card, Empty, Field, Select, inputClass } from "../../components/ui";
import DashboardHeader from "../../components/dashboard/DashboardHeader";

const ManageClasses = () => {
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [hods, setHods] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

  const [classForm, setClassForm] = useState({ name: "", department: "", hod_id: "" });
  const [subjectForm, setSubjectForm] = useState({ class_id: "", name: "", code: "", teacher_id: "", max_marks: 100 });

  const load = async () => {
    const [classesRes, subjectsRes, staffRes] = await Promise.all([
      supabase.from("classes").select("*").order("name"),
      supabase.from("subjects").select("*, classes ( name ), profiles ( name )").order("code"),
      supabase.from("profiles").select("id, name, role").in("role", ["hod", "teacher"]),
    ]);
    if (classesRes.error || subjectsRes.error || staffRes.error) {
      setLoadError("Could not load classes and subjects. Check your connection and refresh the page.");
    } else {
      setLoadError("");
    }
    setClasses(classesRes.data ?? []);
    setSubjects(subjectsRes.data ?? []);
    setHods((staffRes.data ?? []).filter((p) => p.role === "hod"));
    setTeachers((staffRes.data ?? []).filter((p) => p.role === "teacher"));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const addClass = async (e) => {
    e.preventDefault();
    setError("");
    setClassForm({ ...classForm, name: classForm.name.trim(), department: classForm.department.trim() });
    const { error: err } = await supabase
      .from("classes")
      .insert({
        name: classForm.name.trim(),
        department: classForm.department.trim(),
        hod_id: classForm.hod_id || null,
      });
    if (err) setError(err.message);
    else {
      setClassForm({ name: "", department: "", hod_id: "" });
      load();
    }
  };

  const addSubject = async (e) => {
    e.preventDefault();
    setError("");
    const { error: err } = await supabase.from("subjects").insert({
      class_id: subjectForm.class_id,
      name: subjectForm.name.trim(),
      code: subjectForm.code.trim(),
      teacher_id: subjectForm.teacher_id || null,
      max_marks: Number(subjectForm.max_marks) || 100,
    });
    if (err) setError(err.message);
    else {
      setSubjectForm({ class_id: "", name: "", code: "", teacher_id: "", max_marks: 100 });
      load();
    }
  };

  const removeClass = async (id) => {
    if (!confirm("Delete this class along with its subjects, exams and marks?")) return;
    await supabase.from("classes").delete().eq("id", id);
    load();
  };

  const removeSubject = async (id) => {
    if (!confirm("Delete this subject and its marks?")) return;
    await supabase.from("subjects").delete().eq("id", id);
    load();
  };

  return (
    <>
      <DashboardHeader title="Classes & Subjects" subtitle="Academic structure of the institution." />

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="text-sm font-semibold text-(--foreground)">Add class</p>
          <form onSubmit={addClass} className="mt-4 space-y-3">
            <Field label="Name">
              <input className={inputClass} value={classForm.name} onChange={(e) => setClassForm({ ...classForm, name: e.target.value })} placeholder="CSE - Semester 3" required />
            </Field>
            <Field label="Department">
              <input className={inputClass} value={classForm.department} onChange={(e) => setClassForm({ ...classForm, department: e.target.value })} placeholder="CSE" required />
            </Field>
            <Field label="HOD">
              <Select value={classForm.hod_id} onChange={(e) => setClassForm({ ...classForm, hod_id: e.target.value })}>
                <option value="">None</option>
                {hods.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </Select>
            </Field>
            <Button type="submit">Add class</Button>
          </form>
        </Card>

        <Card>
          <p className="text-sm font-semibold text-(--foreground)">Add subject</p>
          <form onSubmit={addSubject} className="mt-4 space-y-3">
            <Field label="Class">
              <Select value={subjectForm.class_id} onChange={(e) => setSubjectForm({ ...subjectForm, class_id: e.target.value })} required>
                <option value="">Choose a class</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name">
                <input className={inputClass} value={subjectForm.name} onChange={(e) => setSubjectForm({ ...subjectForm, name: e.target.value })} placeholder="Data Structures" required />
              </Field>
              <Field label="Code">
                <input className={inputClass} value={subjectForm.code} onChange={(e) => setSubjectForm({ ...subjectForm, code: e.target.value })} placeholder="CS201" required />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Teacher">
                <Select value={subjectForm.teacher_id} onChange={(e) => setSubjectForm({ ...subjectForm, teacher_id: e.target.value })}>
                  <option value="">None</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Max marks">
                <input type="number" min={1} className={inputClass} value={subjectForm.max_marks} onChange={(e) => setSubjectForm({ ...subjectForm, max_marks: e.target.value })} />
              </Field>
            </div>
            <Button type="submit">Add subject</Button>
          </form>
        </Card>
      </div>

      {error ? <p className="mt-4 text-xs text-(--danger)">{error}</p> : null}

      <section className="mt-8">
        <p className="text-xs font-medium text-(--muted-foreground)">Classes</p>
        <div className="mt-3 space-y-2">
          {loadError ? <p className="text-xs text-(--danger)">{loadError}</p> : null}
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="glass-inner h-12 animate-pulse rounded-lg" />
              ))
            : classes.length === 0 && <Empty>No classes yet. Use the Add class form above.</Empty>}
          {!loading &&
            classes.map((c) => (
              <div key={c.id} className="glass-inner flex items-center justify-between rounded-lg px-4 py-2.5 text-sm">
                <span className="text-(--foreground)">
                  {c.name}, <span className="text-(--muted-foreground)">{c.department}</span>
                </span>
                <Button variant="danger" onClick={() => removeClass(c.id)}>Delete</Button>
              </div>
            ))}
        </div>
      </section>

      <section className="mt-6">
        <p className="text-xs font-medium text-(--muted-foreground)">Subjects</p>
        <div className="mt-3 space-y-2">
          {subjects.length === 0 && <Empty>No subjects yet. Use the Add subject form above.</Empty>}
          {subjects.map((s) => (
            <div key={s.id} className="glass-inner flex items-center justify-between rounded-lg px-4 py-2.5 text-sm">
              <span className="min-w-0 text-(--foreground)">
                <span className="font-medium">{s.code}</span> {s.name}
                <span className="text-(--muted-foreground)">
                  {", "}{s.classes?.name ?? "no class"}, {s.profiles?.name ?? "unassigned"}, max{" "}
                  <span className="tabular-nums">{s.max_marks}</span>
                </span>
              </span>
              <Button variant="danger" onClick={() => removeSubject(s.id)}>Delete</Button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
};

export default ManageClasses;
