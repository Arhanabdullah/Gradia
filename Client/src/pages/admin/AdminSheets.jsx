import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { callRpc } from "../../lib/db";
import { Button, Card, Empty, StatusChip } from "../../components/ui";
import { statusLabel } from "../../lib/status";
import DashboardHeader from "../../components/dashboard/DashboardHeader";

const AdminSheets = () => {
  const [exams, setExams] = useState([]);
  const [sheets, setSheets] = useState([]);
  const [expected, setExpected] = useState({}); // exam_id -> readiness
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    const [examsRes, sheetsRes, subjectsRes, marksRes, studentsRes, enrollmentsRes, submissionsRes] =
      await Promise.all([
        supabase
          .from("exams")
          .select("id, name, academic_year, class_id, classes ( name )")
          .order("created_at", { ascending: false }),
        supabase
          .from("result_sheets")
          .select("id, status, exam_id, updated_at, exams ( name, academic_year ), classes ( name )")
          .order("updated_at", { ascending: false }),
        supabase
          .from("exam_subjects")
          .select("id, exam_id, subject_id, subjects ( code, name )"),
        supabase.from("marks").select("exam_id, subject_id, student_id"),
        supabase.from("profiles").select("id, class_id").eq("role", "student").eq("is_active", true),
        supabase
          .from("student_enrollments")
          .select("student_id, class_id")
          .eq("status", "active"),
        supabase
          .from("exam_submissions")
          .select("id, exam_id, subject_id, status, reviewed_at, review_remarks"),
      ]);

    const failure =
      examsRes.error ||
      sheetsRes.error ||
      subjectsRes.error ||
      marksRes.error ||
      studentsRes.error ||
      enrollmentsRes.error ||
      submissionsRes.error;
    if (failure) {
      setLoadError("Could not load results. Check your connection and refresh the page.");
    } else {
      setLoadError("");
    }

    const examRows = examsRes.data ?? [];
    const sheetRows = sheetsRes.data ?? [];
    const subjectRows = subjectsRes.data ?? [];
    const markRows = marksRes.data ?? [];
    const activeStudents = studentsRes.data ?? [];
    const activeEnrollments = enrollmentsRes.data ?? [];
    const submissionRows = submissionsRes.data ?? [];

    setExams(examRows);
    setSheets(sheetRows);

    // Marks entry treats an active enrollment and the profile class as one
    // roster, so the compile readiness count must use the same union.
    const activeSets = {};
    activeStudents.forEach((student) => {
      if (!student.class_id) return;
      if (!activeSets[student.class_id]) activeSets[student.class_id] = new Set();
      activeSets[student.class_id].add(student.id);
    });
    activeEnrollments.forEach((enrollment) => {
      if (!enrollment.class_id) return;
      if (!activeSets[enrollment.class_id]) activeSets[enrollment.class_id] = new Set();
      activeSets[enrollment.class_id].add(enrollment.student_id);
    });
    const activeByClass = {};
    Object.entries(activeSets).forEach(([classId, ids]) => {
      activeByClass[classId] = ids.size;
    });

    const subjectsByExam = {};
    subjectRows.forEach((subject) => {
      subjectsByExam[subject.exam_id] = (subjectsByExam[subject.exam_id] ?? 0) + 1;
    });

    const marksByExam = {};
    markRows.forEach((mark) => {
      marksByExam[mark.exam_id] = (marksByExam[mark.exam_id] ?? 0) + 1;
    });

    const submissionsByExam = {};
    submissionRows.forEach((row) => {
      if (!submissionsByExam[row.exam_id]) {
        submissionsByExam[row.exam_id] = { total: 0, approved: 0, pending: 0, returned: 0, missing: 0 };
      }
      const bucket = submissionsByExam[row.exam_id];
      bucket.total += 1;
      if (row.status === "approved") bucket.approved += 1;
      else if (row.status === "submitted" || row.status === "under_review") bucket.pending += 1;
      else if (row.status === "returned") bucket.returned += 1;
      else bucket.missing += 1;
    });

    const map = {};
    examRows.forEach((exam) => {
      const subjectCount = subjectsByExam[exam.id] ?? 0;
      const studentCount = activeByClass[exam.class_id] ?? 0;
      const total = studentCount * subjectCount;
      const entered = marksByExam[exam.id] ?? 0;
      const submissions = submissionsByExam[exam.id] ?? { total: 0, approved: 0, pending: 0, returned: 0, missing: 0 };
      const submissionsOutstanding = Math.max(subjectCount - submissions.total, 0);
      map[exam.id] = {
        total,
        entered,
        subjects: subjectCount,
        students: studentCount,
        submissions,
        submissionsOutstanding,
      };
    });
    setExpected(map);
    setLoading(false);
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
    if (!confirm(`Delete the ${statusLabel[sheet.status] ?? sheet.status} sheet for "${sheet.exams?.name}"?`)) return;
    await supabase.from("result_sheets").delete().eq("id", sheet.id);
    load();
  };

  const readiness = (exam) => {
    const info = expected[exam.id] ?? {
      total: 0,
      entered: 0,
      subjects: 0,
      students: 0,
      submissions: { total: 0, approved: 0, pending: 0, returned: 0, missing: 0 },
      submissionsOutstanding: 0,
    };
    const complete = info.total > 0 && info.entered >= info.total;
    const submissionsReady =
      info.subjects > 0 &&
      info.submissionsOutstanding === 0 &&
      info.submissions.approved === info.subjects;

    return {
      info,
      complete,
      submissionsReady,
      ready: info.subjects > 0 && info.students > 0 && complete && submissionsReady,
    };
  };

  return (
    <>
      <DashboardHeader title="Result sheets" subtitle="Compile approved marks into review-ready sheets." />

      <section className="mt-6">
        <p className="text-sm font-medium text-(--foreground)">Examinations</p>
        <div className="mt-3 space-y-2">
          {loadError ? <p className="text-xs text-(--danger)">{loadError}</p> : null}
          {loading
            ? Array.from({ length: 2 }).map((_, index) => (
                <div key={index} className="glass-inner h-20 motion-safe:animate-pulse rounded-xl" />
              ))
            : exams.length === 0 && <Empty>No examinations yet. Create one on the exams page.</Empty>}
          {!loading &&
            exams.map((exam) => {
              const { info, complete, submissionsReady, ready } = readiness(exam);
              const hasSheet = sheets.some((sheet) => sheet.exam_id === exam.id);
              const statusLine = hasSheet
                ? "A result sheet already exists for this examination."
                : ready
                  ? "Ready to compile."
                  : info.students === 0 || info.subjects === 0
                    ? "No active students or scheduled subjects in this class."
                    : !complete
                      ? "Marks are still incomplete."
                      : !submissionsReady
                        ? "Marks are still awaiting approval."
                        : "Not ready to compile.";
              return (
                <Card key={exam.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm text-(--foreground)">
                      {exam.name}
                      <span className="text-(--muted-foreground)">
                        {", "}{exam.classes?.name}
                        {exam.academic_year ? `, ${exam.academic_year}` : ""}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-(--muted-foreground)">
                      Marks: <span className="tabular-nums">{info.entered}</span> of{" "}
                      <span className="tabular-nums">{info.total || "?"}</span> entered,{" "}
                      {info.subjects} subject{info.subjects === 1 ? "" : "s"}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-(--muted-foreground)">
                      <span>
                        Approvals: <span className="tabular-nums">{info.submissions.approved}</span> of{" "}
                        <span className="tabular-nums">{info.subjects}</span>
                      </span>
                      {info.submissions.pending > 0 ? (
                        <span className="text-(--primary)">{info.submissions.pending} awaiting review</span>
                      ) : null}
                      {info.submissions.returned > 0 ? (
                        <span className="text-(--danger)">{info.submissions.returned} returned</span>
                      ) : null}
                      {info.submissionsOutstanding > 0 ? (
                        <span className="text-(--muted-foreground)">
                          {info.submissionsOutstanding} not submitted
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-xs text-(--muted-foreground)">{statusLine}</p>
                  </div>
                  <Button disabled={busyId === exam.id || hasSheet || !ready} onClick={() => compile(exam)}>
                    {hasSheet ? "Sheet exists" : busyId === exam.id ? "Compiling" : "Compile sheet"}
                  </Button>
                </Card>
              );
            })}
        </div>
      </section>

      {message ? <p role="status" className="mt-4 text-xs text-(--muted)">{message}</p> : null}

      <section className="mt-8">
        <p className="text-sm font-medium text-(--foreground)">Sheets</p>
        <div className="mt-3 space-y-2">
          {loading
            ? Array.from({ length: 2 }).map((_, index) => (
                <div key={index} className="glass-inner h-12 motion-safe:animate-pulse rounded-lg" />
              ))
            : sheets.length === 0 && (
                <Empty>No result sheets compiled yet. Compile one from an examination listed above.</Empty>
              )}
          {!loading &&
            sheets.map((sheet) => (
              <div key={sheet.id} className="glass-inner flex items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="text-(--foreground)">
                    {sheet.exams?.name}, {sheet.classes?.name}
                  </p>
                  <p className="text-xs text-(--muted-foreground) tabular-nums">
                    Updated {new Date(sheet.updated_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusChip status={sheet.status} />
                  {sheet.status !== "published" && (
                    <Button variant="danger" onClick={() => removeSheet(sheet)}>
                      Delete
                    </Button>
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
