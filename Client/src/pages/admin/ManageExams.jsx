import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Button, Card, Empty, Field, Select, inputClass } from "../../components/ui";
import DashboardHeader from "../../components/dashboard/DashboardHeader";

const ManageExams = () => {
  const [classes, setClasses] = useState([]);
  const [exams, setExams] = useState([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ class_id: "", name: "", academic_year: "2025-26" });

  const load = async () => {
    const [{ data: classes }, { data: exams }] = await Promise.all([
      supabase.from("classes").select("id, name").order("name"),
      supabase.from("exams").select("id, name, academic_year, class_id, classes ( name )").order("created_at", { ascending: false }),
    ]);
    setClasses(classes ?? []);
    setExams(exams ?? []);
  };

  useEffect(() => {
    load();
  }, []);

  const addExam = async (e) => {
    e.preventDefault();
    setError("");
    const { error: err } = await supabase
      .from("exams")
      .insert({
        class_id: form.class_id,
        name: form.name.trim(),
        academic_year: form.academic_year.trim() || null,
      });
    if (err) setError(err.message);
    else {
      setForm({ class_id: "", name: "", academic_year: form.academic_year });
      load();
    }
  };

  const removeExam = async (id) => {
    if (!confirm("Delete this exam along with its marks and result sheets?")) return;
    await supabase.from("exams").delete().eq("id", id);
    load();
  };

  return (
    <>
      <DashboardHeader title="Exams" subtitle="Register exams per class before marks entry." />

      <Card className="mt-6 max-w-xl">
        <form onSubmit={addExam} className="space-y-3">
          <Field label="Class">
            <Select value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })} required>
              <option value="">— choose —</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Exam name">
            <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Midterm 2026" required />
          </Field>
          <Field label="Academic year">
            <input className={inputClass} value={form.academic_year} onChange={(e) => setForm({ ...form, academic_year: e.target.value })} placeholder="2025-26" />
          </Field>
          <Button type="submit">Add exam</Button>
        </form>
        {error ? <p className="mt-3 text-xs text-red-500">{error}</p> : null}
      </Card>

      <section className="mt-8">
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-foreground)">All exams</p>
        <div className="mt-3 space-y-2">
          {exams.length === 0 && <Empty>No exams yet.</Empty>}
          {exams.map((x) => (
            <div key={x.id} className="glass-inner flex items-center justify-between rounded-lg px-4 py-2.5 text-sm">
              <span className="text-(--foreground)">
                {x.name} <span className="text-(--muted-foreground)">· {x.classes?.name}{x.academic_year ? ` · ${x.academic_year}` : ""}</span>
              </span>
              <Button variant="danger" onClick={() => removeExam(x.id)}>Delete</Button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
};

export default ManageExams;
