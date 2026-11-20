import { lazy, Suspense, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { StatCard, Empty, Card, StatusChip } from "../components/ui";
import AttendanceSummary from "../components/AttendanceSummary";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import ExamCalendarCard from "../components/dashboard/ExamCalendarCard";
import { Link } from "react-router-dom";

const ResultPipelineChart = lazy(() => import("../components/charts/ResultPipelineChart"));

const STATUS_SHORT = {
  compiled: "Compiled",
  hod_approved: "HOD OK",
  hod_rejected: "Sent back",
  principal_signed: "Ready",
  exam_approved: "Exam OK",
  exam_rejected: "Exam sent back",
  published: "Published",
};

const loadChart = async (profile) => {
  if (["admin", "hod", "principal", "exam_cell", "coordinator"].includes(profile.role)) {
    const { data } = await supabase.from("result_sheets").select("status");
    const counts = {};
    (data ?? []).forEach((s) => (counts[s.status] = (counts[s.status] ?? 0) + 1));
    const order = [
      "compiled",
      "hod_approved",
      "exam_approved",
      "principal_signed",
      "published",
      "hod_rejected",
      "exam_rejected",
    ];
    return {
      title: "Result sheet pipeline",
      subtitle: "Sheets by workflow stage",
      data: order.filter((k) => counts[k]).map((k) => ({ label: STATUS_SHORT[k], value: counts[k] })),
    };
  }
  if (profile.role === "teacher") {
    const [{ data: assignments }, { data: marks }] = await Promise.all([
      supabase
        .from("teacher_assignments")
        .select("subject_id, subjects ( id, code )")
        .eq("teacher_id", profile.id),
      supabase.from("marks").select("subject_id").eq("entered_by", profile.id),
    ]);
    const counts = {};
    (marks ?? []).forEach((mark) => (counts[mark.subject_id] = (counts[mark.subject_id] ?? 0) + 1));
    const bySubject = new Map();
    (assignments ?? []).forEach((row) => {
      if (row.subject_id && !bySubject.has(row.subject_id)) {
        bySubject.set(row.subject_id, row.subjects?.code ?? "Subject");
      }
    });
    return {
      title: "Marks entered",
      subtitle: "Entries per assigned subject",
      data: [...bySubject.entries()]
        .map(([id, code]) => ({ label: code, value: counts[id] ?? 0 }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  }
  return null;
};

const SUBTITLE = {
  admin: "Institution status at a glance.",
  teacher: "Your teaching workload at a glance.",
  hod: "Department review pipeline at a glance.",
  principal: "Publication pipeline at a glance.",
  coordinator: "Institution-wide monitoring at a glance.",
  exam_cell: "Result configuration and approval at a glance.",
  student: "Your academic snapshot.",
};

const countQuery = async (table, eq) => {
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  if (eq) for (const [c, v] of Object.entries(eq)) q = q.eq(c, v);
  const { count } = await q;
  return count ?? 0;
};

const loadCounts = async (role, profile) => {
  if (role === "admin") {
    const [students, teachers, hods, principals, classes, subjects, published, awaiting] =
      await Promise.all([
        countQuery("profiles", { role: "student" }),
        countQuery("profiles", { role: "teacher" }),
        countQuery("profiles", { role: "hod" }),
        countQuery("profiles", { role: "principal" }),
        countQuery("classes"),
        countQuery("subjects"),
        countQuery("result_sheets", { status: "published" }),
        countQuery("result_sheets", { status: "compiled" }),
      ]);
    return [
      { label: "Students", value: students },
      { label: "Faculty & staff", value: teachers + hods + principals },
      { label: "Classes", value: classes },
      { label: "Subjects", value: subjects },
      { label: "Results published", value: published },
      { label: "Awaiting HOD review", value: awaiting },
    ];
  }
  if (role === "teacher") {
    const [subjects, marks] = await Promise.all([
      countQuery("teacher_assignments", { teacher_id: profile.id }),
      countQuery("marks", { entered_by: profile.id }),
    ]);
    return [
      { label: "My subjects", value: subjects },
      { label: "Marks entered by me", value: marks },
    ];
  }
  if (role === "hod") {
    const [awaiting, sentBack, published] = await Promise.all([
      countQuery("result_sheets", { status: "compiled" }),
      countQuery("result_sheets", { status: "hod_rejected" }),
      countQuery("result_sheets", { status: "published" }),
    ]);
    return [
      { label: "Awaiting my review", value: awaiting },
      { label: "Sent back by me", value: sentBack },
      { label: "Published", value: published },
    ];
  }
  if (role === "principal") {
    const [awaiting, hodApproved, signed, examApproved, published] = await Promise.all([
      countQuery("result_sheets", { status: "compiled" }),
      countQuery("result_sheets", { status: "hod_approved" }),
      countQuery("result_sheets", { status: "principal_signed" }),
      countQuery("result_sheets", { status: "exam_approved" }),
      countQuery("result_sheets", { status: "published" }),
    ]);
    return [
      { label: "Awaiting HOD approval", value: awaiting },
      { label: "Ready to publish", value: hodApproved + signed + examApproved },
      { label: "Published", value: published },
    ];
  }
  if (role === "coordinator") {
    const [students, teachers, classes, subjects, published, attendance] = await Promise.all([
      countQuery("profiles", { role: "student" }),
      countQuery("profiles", { role: "teacher" }),
      countQuery("classes"),
      countQuery("subjects"),
      countQuery("result_sheets", { status: "published" }),
      countQuery("attendance"),
    ]);
    return [
      { label: "Students", value: students },
      { label: "Teachers", value: teachers },
      { label: "Classes", value: classes },
      { label: "Subjects", value: subjects },
      { label: "Results published", value: published },
      { label: "Attendance records", value: attendance },
    ];
  }
  if (role === "exam_cell") {
    const [awaitingExam, approved, published, awaitingHod, schemes, components] = await Promise.all([
      countQuery("result_sheets", { status: "hod_approved" }),
      countQuery("result_sheets", { status: "exam_approved" }),
      countQuery("result_sheets", { status: "published" }),
      countQuery("result_sheets", { status: "compiled" }),
      countQuery("grading_schemes"),
      countQuery("assessment_components"),
    ]);
    return [
      { label: "Awaiting Exam Cell approval", value: awaitingExam },
      { label: "Approved by Exam Cell", value: approved },
      { label: "Published", value: published },
      { label: "Awaiting HOD review", value: awaitingHod },
      { label: "Grading schemes", value: schemes },
      { label: "Assessment components", value: components },
    ];
  }
  // student
  const [subjectsInClass, unread] = await Promise.all([
    profile.class_id
      ? countQuery("class_subjects", { class_id: profile.class_id })
      : Promise.resolve(0),
    countQuery("notifications", { user_id: profile.id, is_read: false }),
  ]);
  return [
    { label: "Class", value: profile.classes?.name ?? "Not assigned yet" },
    ...(profile.class_id ? [{ label: "Subjects in class", value: subjectsInClass }] : []),
    { label: "Unread notifications", value: unread },
  ];
};

const loadDept = async (profile) => {
  if (profile.role !== "hod") return null;

  const [{ data: ownClasses }, { data: classSubjects }, { data: students }] = await Promise.all([
    supabase.from("classes").select("id, name, department").eq("hod_id", profile.id).order("name"),
    supabase.from("class_subjects").select("class_id, subject_id"),
    supabase.from("profiles").select("id, class_id").eq("role", "student"),
  ]);

  let classes = ownClasses ?? [];
  if (classes.length === 0) {
    const { data: assignments } = await supabase
      .from("class_hod_assignments")
      .select("class_id")
      .eq("hod_id", profile.id);
    const classIds = [...new Set((assignments ?? []).map((row) => row.class_id))];
    if (classIds.length > 0) {
      const { data } = await supabase
        .from("classes")
        .select("id, name, department")
        .in("id", classIds)
        .order("name");
      classes = data ?? [];
    }
  }

  return classes.map((klass) => ({
    id: klass.id,
    name: klass.name,
    department: klass.department,
    subjects: (classSubjects ?? []).filter((row) => row.class_id === klass.id).length,
    students: (students ?? []).filter((student) => student.class_id === klass.id).length,
  }));
};

const Overview = () => {
  const { profile } = useAuth();
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [chart, setChart] = useState(null);
  const [dept, setDept] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!profile) return;
    loadCounts(profile.role, profile).then(setStats).catch(() => setLoadError(true));
    loadChart(profile).then(setChart).catch(() => setLoadError(true));
    loadDept(profile).then(setDept).catch(() => setLoadError(true));

    if (profile.role === "student") {
      setAttendanceLoading(true);
      supabase
        .from("attendance")
        .select("subject_id, attended_classes, total_classes, subjects ( name, code )")
        .eq("student_id", profile.id)
        .then(({ data, error }) => {
          setAttendance(data ?? []);
          setAttendanceLoading(false);
          // The attendance migration is additive. An older deployment must
          // still render the rest of the student dashboard.
          if (error && !/does not exist|schema cache|could not find the table/i.test(error.message ?? "")) {
            setLoadError(true);
          }
        });
    }

    if (["admin", "hod", "principal", "exam_cell", "coordinator"].includes(profile.role)) {
      supabase
        .from("result_sheets")
        .select("id, status, exams ( name ), classes ( name )")
        .order("updated_at", { ascending: false })
        .limit(5)
        .then(({ data }) => setRecent(data ?? []))
        .catch(() => setLoadError(true));
    }
  }, [profile]);

  return (
    <>
      <DashboardHeader
        title="Overview"
        subtitle={SUBTITLE[profile?.role] ?? "Academic performance at a glance."}
      />
      <div className="mt-7 grid gap-3 sm:grid-cols-3">
        {(stats ?? Array.from({ length: 3 })).map((stat, i) =>
          stat ? <StatCard key={i} label={stat.label} value={stat.value} /> : <StatCard key={i} label="â€¦" value="" />,
        )}
      </div>
      {loadError ? (
        <p className="mt-3 text-xs text-(--danger)">
          Couldnâ€™t load some dashboard data. Check your connection and refresh the page.
        </p>
      ) : null}

      <ExamCalendarCard className="mt-4" />

      {profile.role === "student" ? (
        <Card className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-(--foreground)">{profile.name}</p>
              <p className="mt-0.5 text-xs text-(--muted)">
                {profile.email}, {profile.username}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium text-(--muted-foreground)">Class</p>
              <p className="mt-0.5 text-sm text-(--foreground)">{profile.classes?.name ?? "Not assigned yet"}</p>
              {profile.degrees?.name ? (
                <p className="text-xs text-(--muted-foreground)">{profile.degrees.name}</p>
              ) : null}
              {profile.department ? (
                <p className="text-xs text-(--muted-foreground)">{profile.department}</p>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      {profile.role === "student" ? (
        <AttendanceSummary
          className="mt-4"
          rows={attendance}
          loading={attendanceLoading}
          title="Overall attendance"
          subtitle="Attended classes divided by classes conducted, across every recorded year and subject."
        />
      ) : null}

      {profile.role === "hod" ? (
        <Card className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-(--foreground)">{profile.name}</p>
              <p className="mt-0.5 text-xs text-(--muted)">
                {profile.email}, {profile.username}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium text-(--muted-foreground)">
                {profile.hod_type === "subject" ? "Subject HOD" : "Department HOD"}
              </p>
              {profile.hod_type !== "subject" ? (
                <>
                  <p className="mt-0.5 text-sm text-(--foreground)">
                    {profile.departments?.name ?? profile.department ?? "No department assigned"}
                  </p>
                  <p className="text-xs text-(--muted-foreground)">
                    {profile.degrees?.name ? `Degree: ${profile.degrees.name}` : "No degree assigned"}
                  </p>
                  <p className="text-xs text-(--muted-foreground)">
                    {profile.courses?.name ? `Course: ${profile.courses.name}` : "No course assigned"}
                  </p>
                </>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      {dept && dept.length > 0 ? (
        <section className="mt-6">
          <p className="text-xs font-medium text-(--muted-foreground)">My department</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dept.map((c) => (
              <Card key={c.id}>
                <p className="text-sm font-semibold text-(--foreground)">{c.name}</p>
                <p className="mt-0.5 text-xs text-(--muted-foreground)">{c.department}</p>
                <div className="mt-3 flex gap-5 text-xs text-(--muted)">
                  <span>
                    <span className="font-semibold text-(--foreground) tabular-nums">{c.students}</span> students
                  </span>
                  <span>
                    <span className="font-semibold text-(--foreground) tabular-nums">{c.subjects}</span> subjects
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {chart && chart.data.length > 0 ? (
        <Card>
          <div className="mb-4">
            <p className="text-xs font-medium text-(--foreground)">{chart.title}</p>
            <p className="mt-0.5 text-xs text-(--muted-foreground)">{chart.subtitle}</p>
          </div>
          <Suspense fallback={<div className="h-55 w-full" aria-hidden="true" />}>
            <ResultPipelineChart data={chart.data} />
          </Suspense>
        </Card>
      ) : null}

      {!stats ? null : ["admin", "hod", "principal", "exam_cell", "coordinator"].includes(profile.role) ? (
        <section className="mt-8">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs font-medium text-(--muted-foreground)">Recently updated result sheets</p>
            {profile.role === "admin" || profile.role === "exam_cell" ? (
              <Link to="/app/sheets" className="text-xs text-(--primary) hover:underline">
                Manage results
              </Link>
            ) : profile.role === "coordinator" ? (
              <Link to="/app/archive" className="text-xs text-(--primary) hover:underline">
                Open result archive
              </Link>
            ) : null}
          </div>
          <div className="mt-3 space-y-2">
            {recent.length === 0 && <Empty>No result sheets yet.</Empty>}
            {recent.map((s) => (
              <div
                key={s.id}
                className="glass-inner flex items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-sm"
              >
                <span className="text-(--foreground)">
                  {s.exams?.name}, {s.classes?.name}
                </span>
                <StatusChip status={s.status} />
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className="mt-8">
          <Empty>Use the sidebar to navigate your workspace.</Empty>
        </div>
      )}
    </>
  );
};

export default Overview;
