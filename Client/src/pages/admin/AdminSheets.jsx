import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { callRpc } from "../../lib/db";
import {
  Button,
  Card,
  Empty,
  StatusChip,
} from "../../components/ui";
import { statusLabel } from "../../lib/status";
import DashboardHeader from "../../components/dashboard/DashboardHeader";

const AdminSheets = () => {
  const [exams, setExams] = useState([]);
  const [sheets, setSheets] = useState([]);
  const [expected, setExpected] = useState({}); // exam_id -> {students, subjects, entered}
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    const [{ data: exams }, { data: sheets }, { data: subjects }, { data: marks }, { data: activeStudents }] =
      await Promise.all([
        supabase.from("exams").select("id, name, academic_year, class_id, classes ( name )").order("created_at", { ascending: false }),
        supabase.from("result_sheets").select("id, status, exam_id, updated_at, exams ( name, academic_year ), classes ( name )").order("updated_at", { ascending: false }),
        supabase.from("subjects").select("id, class_id"),
        supabase.from("marks").select("exam_id, subject_id"),
        supabase.from("profiles").select("id, class_id").eq("role", "student").eq("is_active", true),
      ]);
    setExams(exams ?? []);
    setSheets(sheets ?? []);

    // completeness per exam = entered marks / (active students of class x subjects of class)
    const map = {};
    const activeByClass = {};
    (activeStudents ?? []).forEach((s) => {
      activeByClass[s.class_id] = (activeByClass[s.class_id] ?? 0) + 1;
    });
    const subjectsByClass = {};
    (subjects ?? []).forEach((s) => {
      subjectsByClass[s.class_id] = (subjectsByClass[s.class_id] ?? 0) + 1;
    });
    (exams ?? []).forEach((x) => {
      const total = (activeByClass[x.class_id] ?? 0) * (subjectsByClass[x.class_id] ?? 0);
      map[x.id] = {
        total,
        entered: (marks ?? []).filter((m) => m.exam_id === x.id).length,
      };
    });
    setExpected(map);
  };

  useEffect(() => {
    load();
  }, []);

  const compile = async (exam) => {
    setBusyId(exam.id);
    setMessage("");
    try {
      await callRpc("compile_result_sheet", { p_exam_id: exam.id });
      setMessage(`Compiled result sheet for "${exam.name}".`);
    } catch (err) {
      setMessage(err.message);
    }
    setBusyId(null);
    load();
  };

  const removeSheet = async (sheet) => {
    if (!confirm(`Delete the ${statusLabel[sheet.status] ?? sheet.status} sheet for "${sheet.exams?.name}"?`))
      return;
    await supabase.from("result_sheets").delete().eq("id", sheet.id);
    load();
  };

  return (
    <>
      <DashboardHeader title="Result Sheets" subtitle="Compile marks into review-ready sheets." />

      <section className="mt-6">
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-foreground)">Exams</p>
        <div className="mt-3 space-y-2">
          {exams.length === 0 && <Empty>No exams yet — create one on the Exams page.</Empty>}
          {exams.map((x) => {
            const e = expected[x.id] ?? { total: 0, entered: 0 };
            const complete = e.total > 0 && e.entered >= e.total;
            const hasSheet = sheets.some((s) => s.exam_id === x.id);
            return (
              <Card key={x.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm text-(--foreground)">
                    {x.name} <span className="text-(--muted-foreground)">· {x.classes?.name}{x.academic_year ? ` · ${x.academic_year}` : ""}</span>
                  </p>
                  <p className="mt-0.5 text-[10px] text-(--muted-foreground)">
                    Marks: {e.entered}/{e.total || "?"} {complete ? "· complete" : `· ${e.total ? "incomplete" : "no students/subjects"}`}
                  </p>
                </div>
                <Button disabled={busyId === x.id || hasSheet} onClick={() => compile(x)}>
                  {hasSheet ? "Sheet exists" : busyId === x.id ? "Compiling…" : "Compile sheet"}
                </Button>
              </Card>
            );
          })}
        </div>
      </section>

      {message ? <p className="mt-4 text-xs text-(--muted)">{message}</p> : null}

      <section className="mt-8">
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-foreground)">Sheets</p>
        <div className="mt-3 space-y-2">
          {sheets.length === 0 && <Empty>No result sheets compiled yet.</Empty>}
          {sheets.map((s) => (
            <div key={s.id} className="glass-inner flex items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-sm">
              <div>
                <p className="text-(--foreground)">
                  {s.exams?.name} <span className="text-(--muted-foreground)">· {s.classes?.name}</span>
                </p>
                <p className="text-[10px] text-(--muted-foreground)">
                  Updated {new Date(s.updated_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusChip status={s.status} />
                {s.status !== "published" && (
                  <Button variant="danger" onClick={() => removeSheet(s)}>Delete</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
};

export default AdminSheets;
