import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { callRpc } from "../../lib/db";
import { Button, Card, Empty, StatusChip } from "../../components/ui";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { chartAxis, chartTooltip } from "../../components/charts/ChartsConfig";
import DashboardHeader from "../../components/dashboard/DashboardHeader";

// chartAxis config reused, with the tick size raised to the 11px text floor
const axis = { ...chartAxis, tick: { ...chartAxis.tick, fontSize: 11 } };

const PublishSheets = () => {
  const [toPublish, setToPublish] = useState([]); // hod_approved, plus legacy principal_signed
  const [history, setHistory] = useState([]);
  const [perf, setPerf] = useState(null); // null = still loading, [] = nothing published
  const [loadError, setLoadError] = useState(null);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setLoadError(null);
    const select = "id, status, updated_at, exams ( name, academic_year ), classes ( name )";
    const [{ data: publish, error: publishError }, { data: past, error: pastError }, { data: published, error: publishedError }] = await Promise.all([
      supabase
        .from("result_sheets")
        .select(select)
        .in("status", ["hod_approved", "principal_signed"])
        .order("updated_at", { ascending: true }),
      supabase
        .from("result_sheets")
        .select(select)
        .in("status", ["published", "hod_rejected", "compiled"])
        .order("updated_at", { ascending: false })
        .limit(10),
      supabase.from("result_sheets").select("id, class_id, classes ( name )").eq("status", "published"),
    ]);
    setToPublish(publish ?? []);
    setHistory(past ?? []);

    const failed = publishError?.message ?? pastError?.message ?? publishedError?.message;
    if (failed) {
      setLoadError(`Could not load result sheets: ${failed}. Refresh the page and try again.`);
      setPerf([]);
      return;
    }

    // institution performance: average % per class across all published sheets
    const ids = (published ?? []).map((s) => s.id);
    if (ids.length > 0) {
      const { data: items, error: itemsError } = await supabase
        .from("result_items")
        .select("sheet_id, marks_obtained, max_marks")
        .in("sheet_id", ids);
      if (itemsError) {
        setLoadError(`Could not load result data: ${itemsError.message}. Refresh the page and try again.`);
        setPerf([]);
        return;
      }
      const byClass = {};
      (published ?? []).forEach((s) => {
        if (!byClass[s.classes?.name ?? "—"]) byClass[s.classes?.name ?? "—"] = { got: 0, max: 0 };
      });
      (items ?? []).forEach((i) => {
        const sheet = (published ?? []).find((s) => s.id === i.sheet_id);
        const key = sheet?.classes?.name ?? "—";
        if (!byClass[key]) byClass[key] = { got: 0, max: 0 };
        byClass[key].got += Number(i.marks_obtained);
        byClass[key].max += Number(i.max_marks);
      });
      setPerf(
        Object.entries(byClass).map(([name, { got, max }]) => ({
          label: name,
          value: max > 0 ? Math.round((got / max) * 1000) / 10 : 0,
        })),
      );
    } else {
      setPerf([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const publish = async (sheet) => {
    if (!confirm(`Publish results for "${sheet.exams?.name}"? Students will be notified.`)) return;
    setBusyId(sheet.id);
    setMessage("");
    try {
      await callRpc("publish_result_sheet", { p_sheet_id: sheet.id });
      setMessage(`Published results for "${sheet.exams?.name}". Students notified.`);
    } catch (err) {
      setMessage(err.message);
    }
    setBusyId(null);
    load();
  };

  const row = (s, actions) => (
    <Card key={s.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-(--foreground)">
            {s.exams?.name} <span className="text-(--muted-foreground)">{s.classes?.name}{s.exams?.academic_year ? `, ${s.exams.academic_year}` : ""}</span>
          </p>
          <p className="text-xs text-(--muted-foreground)">
            Updated {new Date(s.updated_at).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <StatusChip status={s.status} />
        </div>
      </div>
    </Card>
  );

  return (
    <>
      <DashboardHeader title="Publish results" subtitle="Publish results approved by the HOD. Students are notified when a sheet is published." />

      {loadError ? (
        <p className="mt-6 rounded-lg border border-(--danger)/40 bg-(--danger-subtle) px-4 py-3 text-xs text-(--danger)">
          {loadError}
        </p>
      ) : perf === null ? (
        <div className="glass-inner mt-6 h-44 motion-safe:animate-pulse rounded-xl" aria-hidden="true" />
      ) : perf.length > 0 ? (
        <Card className="mt-6">
          <div className="mb-4">
            <p className="text-xs font-medium text-(--foreground)">Institution performance</p>
            <p className="mt-0.5 text-xs text-(--muted-foreground)">Average score (%) by class, all published results</p>
          </div>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perf} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="label" {...axis} dy={8} />
                <YAxis {...axis} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} width={35} />
                <Tooltip cursor={{ fill: "color-mix(in srgb, var(--primary) 6%, transparent)" }} {...chartTooltip} />
                <Bar dataKey="value" fill="var(--primary)" radius={[6, 6, 0, 0]} barSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : (
        <Empty>You have no published results to review yet. Once a principal publishes sheets, class averages appear here.</Empty>
      )}

      <section className="mt-6">
        <p className="text-xs font-medium text-(--muted-foreground)">Approved by HOD, ready to publish</p>
        <div className="mt-3 space-y-3">
          {toPublish.length === 0 && (
            <Empty>Nothing ready to publish. Sheets appear here after the HOD approves a compiled sheet.</Empty>
          )}
          {toPublish.map((s) =>
            row(
              s,
              <Button variant="success" onClick={() => publish(s)} disabled={busyId === s.id}>
                {busyId === s.id ? "Publishing…" : "Publish"}
              </Button>,
            ),
          )}
        </div>
      </section>

      {message ? <p className="mt-4 text-xs text-(--muted)">{message}</p> : null}

      <section className="mt-8">
        <p className="text-xs font-medium text-(--muted-foreground)">Recent history</p>
        <div className="mt-3 space-y-2">
          {history.length === 0 && <Empty>Nothing yet.</Empty>}
          {history.map((s) => (
            <div key={s.id} className="glass-inner flex items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-sm">
              <p className="min-w-0 truncate text-(--foreground)">
                {s.exams?.name} <span className="text-(--muted-foreground)">{s.classes?.name}</span>
              </p>
              <StatusChip status={s.status} />
            </div>
          ))}
        </div>
      </section>
    </>
  );
};

export default PublishSheets;
