import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { StatCard, Empty, Card, StatusChip } from "../components/ui";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import { Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { chartAxis, chartTooltip } from "../components/charts/ChartsConfig";

const STATUS_SHORT = {
  compiled: "Compiled",
  hod_approved: "HOD OK",
  hod_rejected: "Sent back",
  principal_signed: "Signed",
  published: "Published",
};

const loadChart = async (profile) => {
  if (["admin", "hod", "principal"].includes(profile.role)) {
    const { data } = await supabase.from("result_sheets").select("status");
    const counts = {};
    (data ?? []).forEach((s) => (counts[s.status] = (counts[s.status] ?? 0) + 1));
    const order = ["compiled", "hod_approved", "principal_signed", "published", "hod_rejected"];
    return {
      title: "Result sheet pipeline",
      subtitle: "Sheets by workflow stage",
      data: order.filter((k) => counts[k]).map((k) => ({ label: STATUS_SHORT[k], value: counts[k] })),
    };
  }
  if (profile.role === "teacher") {
    const [{ data: subjects }, { data: marks }] = await Promise.all([
      supabase.from("subjects").select("id, code").eq("teacher_id", profile.id),
      supabase.from("marks").select("subject_id").eq("entered_by", profile.id),
    ]);
    const counts = {};
    (marks ?? []).forEach((m) => (counts[m.subject_id] = (counts[m.subject_id] ?? 0) + 1));
    return {
      title: "Marks entered",
      subtitle: "Entries per assigned subject",
      data: (subjects ?? []).map((s) => ({ label: s.code, value: counts[s.id] ?? 0 })),
    };
  }
  return null;
};

const SUBTITLE = {
  admin: "Institution status at a glance.",
  teacher: "Your teaching workload at a glance.",
  hod: "Department review pipeline at a glance.",
  principal: "Final sign-off pipeline at a glance.",
  student: "Your academic snapshot.",
};

const countQuery = async (table, eq) => {
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  if (eq) for (const [c, v] of Object.entries(eq)) q = q.eq(c, v);
  const { count } = await q;
  return count ?? 0;
};

const loadCounts = async (role, profile) => {
  if (role === "admin")
    return [
      { label: "Students", value: await countQuery("profiles", { role: "student" }) },
      { label: "Faculty & staff", value: (await countQuery("profiles", { role: "teacher" }))
        + (await countQuery("profiles", { role: "hod" }))
        + (await countQuery("profiles", { role: "principal" })) },
      { label: "Classes", value: await countQuery("classes") },
      { label: "Subjects", value: await countQuery("subjects") },
      { label: "Results published", value: await countQuery("result_sheets", { status: "published" }) },
      { label: "Awaiting HOD review", value: await countQuery("result_sheets", { status: "compiled" }) },
    ];
  if (role === "teacher")
    return [
      { label: "My subjects", value: await countQuery("subjects", { teacher_id: profile.id }) },
      { label: "Marks entered by me", value: await countQuery("marks", { entered_by: profile.id }) },
    ];
  if (role === "hod")
    return [
      { label: "Awaiting my review", value: await countQuery("result_sheets", { status: "compiled" }) },
      { label: "Sent back by me", value: await countQuery("result_sheets", { status: "hod_rejected" }) },
      { label: "Published", value: await countQuery("result_sheets", { status: "published" }) },
    ];
  if (role === "principal")
    return [
      { label: "Awaiting my sign-off", value: await countQuery("result_sheets", { status: "hod_approved" }) },
      { label: "Ready to publish", value: await countQuery("result_sheets", { status: "principal_signed" }) },
      { label: "Published", value: await countQuery("result_sheets", { status: "published" }) },
    ];
  // student
  return [
    { label: "Class", value: profile.classes?.name ?? "Not assigned yet" },
    ...(profile.class_id
      ? [{ label: "Subjects in class", value: await countQuery("subjects", { class_id: profile.class_id }) }]
      : []),
    { label: "Unread notifications", value: await countQuery("notifications", { user_id: profile.id, is_read: false }) },
  ];
};

const loadDept = async (profile) => {
  if (profile.role !== "hod") return null;
  const [{ data: classes }, { data: subjects }, { data: students }] = await Promise.all([
    supabase.from("classes").select("id, name, department").eq("hod_id", profile.id).order("name"),
    supabase.from("subjects").select("id, class_id"),
    supabase.from("profiles").select("id, class_id").eq("role", "student"),
  ]);
  return (classes ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    department: c.department,
    subjects: (subjects ?? []).filter((s) => s.class_id === c.id).length,
    students: (students ?? []).filter((s) => s.class_id === c.id).length,
  }));
};

const Overview = () => {
  const { profile } = useAuth();
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [chart, setChart] = useState(null);
  const [dept, setDept] = useState(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!profile) return;
    loadCounts(profile.role, profile).then(setStats).catch(() => setLoadError(true));
    loadChart(profile).then(setChart).catch(() => setLoadError(true));
    loadDept(profile).then(setDept).catch(() => setLoadError(true));

    if (["admin", "hod", "principal"].includes(profile.role)) {
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
          stat ? <StatCard key={i} label={stat.label} value={stat.value} /> : <StatCard key={i} label="…" value="" />,
        )}
      </div>
      {loadError ? (
        <p className="mt-3 text-xs text-(--danger)">
          Couldn’t load some dashboard data. Check your connection and refresh the page.
        </p>
      ) : null}

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
              {profile.department ? (
                <p className="text-xs text-(--muted-foreground)">{profile.department}</p>
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
          <div className="h-55 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart.data} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="label" {...chartAxis} tick={{ ...chartAxis.tick, fontSize: 11 }} dy={8} />
                <YAxis {...chartAxis} tick={{ ...chartAxis.tick, fontSize: 11 }} allowDecimals={false} width={30} />
                <Tooltip cursor={{ fill: "var(--primary)", fillOpacity: 0.06 }} {...chartTooltip} />
                <Bar dataKey="value" fill="var(--primary)" radius={[6, 6, 0, 0]} barSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : null}

      {!stats ? null : ["admin", "hod", "principal"].includes(profile.role) ? (
        <section className="mt-8">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs font-medium text-(--muted-foreground)">Recently updated result sheets</p>
            {profile.role === "admin" && (
              <Link to="/app/sheets" className="text-xs text-(--primary) hover:underline">
                Manage results
              </Link>
            )}
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
