import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { callRpc } from "../../lib/db";
import { Button, Card, Empty, Field, Select, StatusChip, inputClass } from "../../components/ui";
import { statusLabel } from "../../lib/status";
import { resultKindLabel } from "../../lib/exams";
import DashboardHeader from "../../components/dashboard/DashboardHeader";

const STATUS_FILTERS = [
  { value: "hod_approved", label: "Awaiting Exam Cell approval" },
  { value: "exam_approved", label: "Approved, ready to publish" },
  { value: "exam_rejected", label: "Sent back by Exam Cell" },
  { value: "compiled", label: "Awaiting HOD review" },
  { value: "published", label: "Published" },
  { value: "all", label: "All sheets" },
];

const timestamp = (value) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const readinessLine = (readiness) => {
  if (!readiness) return "Readiness not loaded";
  const parts = [
    `${readiness.items} result item${readiness.items === 1 ? "" : "s"}`,
    `${readiness.students} student${readiness.students === 1 ? "" : "s"}`,
  ];
  if (readiness.ungraded > 0) parts.push(`${readiness.ungraded} ungraded`);
  if (readiness.missing_marks > 0) parts.push(`${readiness.missing_marks} missing marks`);
  if (readiness.missing_credits > 0) parts.push(`${readiness.missing_credits} missing credits`);
  if (readiness.missing_components > 0) {
    parts.push(`${readiness.missing_components} subjects without components`);
  }
  if (readiness.missing_component_marks > 0) {
    parts.push(`${readiness.missing_component_marks} missing component marks`);
  }
  if (readiness.withheld > 0) parts.push(`${readiness.withheld} withheld`);
  parts.push(readiness.ready ? "Ready" : "Not ready");
  return parts.join(", ");
};

const ResultApproval = () => {
  const [sheets, setSheets] = useState([]);
  const [readiness, setReadiness] = useState({});
  const [audit, setAudit] = useState([]);
  const [statusFilter, setStatusFilter] = useState("hod_approved");
  const [remarks, setRemarks] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [sheetsRes, auditRes] = await Promise.all([
        supabase
          .from("result_sheets")
          .select(
            "id, exam_id, class_id, status, result_kind, compiled_by, hod_reviewed_by, hod_remarks, exam_approved_by, exam_approved_at, exam_remarks, published_at, updated_at, exams ( name, academic_year ), classes ( name )",
          )
          .order("updated_at", { ascending: false }),
        supabase
          .from("audit_logs")
          .select("id, action, entity_table, entity_id, actor_role, details, created_at, profiles ( name )")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      if (sheetsRes.error) throw new Error(sheetsRes.error.message);
      const rows = sheetsRes.data ?? [];
      setSheets(rows);
      setAudit(auditRes.error ? [] : auditRes.data ?? []);

      const pending = rows.filter((row) => row.status === "hod_approved" || row.status === "exam_approved");
      const readinessRows = await Promise.all(
        pending.map(async (row) => {
          try {
            const data = await callRpc("result_sheet_readiness", { p_sheet_id: row.id });
            return [row.id, data];
          } catch {
            return [row.id, null];
          }
        }),
      );
      setReadiness(Object.fromEntries(readinessRows));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const visible = useMemo(
    () =>
      statusFilter === "all"
        ? sheets
        : sheets.filter((row) => row.status === statusFilter),
    [sheets, statusFilter],
  );

  const decide = async (sheet, approve) => {
    setBusyId(sheet.id);
    setError("");
    setMessage("");
    try {
      await callRpc("exam_approve_result_sheet", {
        p_sheet_id: sheet.id,
        p_approve: approve,
        p_remarks: (remarks[sheet.id] ?? "").trim(),
      });
      setMessage(
        approve
          ? "Result sheet approved. It is now ready for publication."
          : "Result sheet sent back for correction.",
      );
      setRemarks((current) => ({ ...current, [sheet.id]: "" }));
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  };

  const publish = async (sheet) => {
    if (!window.confirm("Publish this result sheet? Students will be notified and the version is frozen.")) return;
    setBusyId(sheet.id);
    setError("");
    setMessage("");
    try {
      await callRpc("publish_result_sheet", { p_sheet_id: sheet.id });
      setMessage("Result sheet published. Students in the class have been notified.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  };

  return (
    <>
      <DashboardHeader
        title="Result approval"
        subtitle="Review HOD-approved sheets, approve or return them, then publish."
      />

      <Card className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Field label="Show">
            <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap items-center gap-2 pb-1">
            <Link to="/app/sheets" className="text-xs text-(--primary) hover:underline">
              Compile result sheets
            </Link>
            <Button variant="subtle" onClick={load} disabled={loading}>
              {loading ? "Refreshing" : "Refresh"}
            </Button>
          </div>
        </div>
        {message ? <p role="status" className="mt-3 text-xs text-(--success)">{message}</p> : null}
        {error ? <p role="alert" className="mt-3 text-xs text-(--danger)">{error}</p> : null}
      </Card>

      {loading && sheets.length === 0 ? (
        <div className="mt-4 space-y-3" aria-hidden="true">
          {[0, 1, 2].map((key) => (
            <div key={key} className="glass-inner h-28 motion-safe:animate-pulse rounded-xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-4">
          <Empty>No result sheets in this stage.</Empty>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {visible.map((sheet) => {
            const canDecide = sheet.status === "hod_approved";
            const canPublish = sheet.status === "exam_approved";
            return (
              <Card key={sheet.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-(--foreground)">
                      {sheet.exams?.name ?? "Examination"}, {sheet.classes?.name ?? "Class"}
                    </p>
                    <p className="mt-0.5 text-xs text-(--muted-foreground)">
                      {resultKindLabel(sheet.result_kind)}
                      {sheet.exams?.academic_year ? `, ${sheet.exams.academic_year}` : ""}, updated{" "}
                      {timestamp(sheet.updated_at)}
                    </p>
                  </div>
                  <StatusChip status={sheet.status} />
                </div>

                <p className="mt-2 text-xs text-(--muted-foreground) tabular-nums">
                  {readinessLine(readiness[sheet.id])}
                </p>

                {sheet.hod_remarks ? (
                  <p className="mt-2 rounded-lg border border-(--border-subtle) px-3 py-2 text-xs text-(--muted-foreground)">
                    HOD note: {sheet.hod_remarks}
                  </p>
                ) : null}
                {sheet.exam_remarks ? (
                  <p className="mt-2 rounded-lg border border-(--border-subtle) px-3 py-2 text-xs text-(--muted-foreground)">
                    Exam Cell note: {sheet.exam_remarks}
                  </p>
                ) : null}

                {canDecide ? (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <Field label="Remarks">
                      <input
                        className={`${inputClass} min-w-60`}
                        value={remarks[sheet.id] ?? ""}
                        onChange={(event) =>
                          setRemarks((current) => ({ ...current, [sheet.id]: event.target.value }))
                        }
                        placeholder="Optional note recorded in the review trail"
                      />
                    </Field>
                    <Button onClick={() => decide(sheet, true)} disabled={busyId === sheet.id}>
                      {busyId === sheet.id ? "Saving" : "Approve"}
                    </Button>
                    <Button variant="danger" onClick={() => decide(sheet, false)} disabled={busyId === sheet.id}>
                      Send back
                    </Button>
                  </div>
                ) : null}

                {canPublish ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button onClick={() => publish(sheet)} disabled={busyId === sheet.id}>
                      {busyId === sheet.id ? "Publishing" : "Publish results"}
                    </Button>
                    <p className="text-[11px] text-(--muted-foreground)">
                      {sheet.result_kind === "semester"
                        ? "Publishing freezes this version, makes the grade card available and notifies students."
                        : "Publishing freezes this version and notifies students. Internal assessments do not issue a grade card."}
                    </p>
                  </div>
                ) : null}

                {sheet.status === "published" ? (
                  <p className="mt-2 text-xs text-(--muted-foreground)">
                    Published {timestamp(sheet.published_at)}.
                  </p>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      <section className="mt-8">
        <p className="text-xs font-medium text-(--muted-foreground)">Recent result activity</p>
        <div className="mt-3 space-y-2">
          {audit.length === 0 ? (
            <Empty>No result activity recorded yet.</Empty>
          ) : (
            audit.map((row) => {
              const actor = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
              return (
                <div
                  key={row.id}
                  className="glass-inner flex flex-wrap items-baseline justify-between gap-2 rounded-lg px-4 py-2.5 text-xs"
                >
                  <span className="text-(--foreground)">
                    {statusLabel[row.action] ?? row.action.replaceAll("_", " ").replaceAll(".", " ")}
                  </span>
                  <span className="text-(--muted-foreground)">
                    {actor?.name ?? row.actor_role ?? "System"}, {timestamp(row.created_at)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </section>
    </>
  );
};

export default ResultApproval;
