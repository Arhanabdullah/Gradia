import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { callRpc } from "../../lib/db";
import { Button, Card, Empty, StatusChip } from "../../components/ui";
import DashboardHeader from "../../components/dashboard/DashboardHeader";

const ReviewSheets = () => {
  const [sheets, setSheets] = useState([]); // awaiting review
  const [history, setHistory] = useState([]); // reviewed by me / others
  const [remarks, setRemarks] = useState({}); // sheet_id -> remark text
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const select = "id, status, updated_at, hod_remarks, exams ( name, academic_year ), classes ( name, department )";
    const [pending, past] = await Promise.all([
      supabase.from("result_sheets").select(select).eq("status", "compiled"),
      supabase
        .from("result_sheets")
        .select(select)
        .in("status", ["hod_approved", "hod_rejected", "principal_signed", "published"])
        .order("updated_at", { ascending: false })
        .limit(10),
    ]);
    if (pending.error || past.error) setError(pending.error?.message ?? past.error?.message);
    setSheets(pending.data ?? []);
    setHistory(past.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const review = async (sheet, approve) => {
    setBusyId(sheet.id);
    setMessage("");
    try {
      await callRpc("review_result_sheet", {
        p_sheet_id: sheet.id,
        p_approve: approve,
        p_remarks: remarks[sheet.id] ?? "",
      });
      setMessage(`Sheet "${sheet.exams?.name}" ${approve ? "approved" : "sent back"}.`);
    } catch (err) {
      setMessage(err.message);
    }
    setBusyId(null);
    load();
  };

  return (
    <>
      <DashboardHeader title="Review Sheets" subtitle="Approve or send back compiled result sheets." />

      <section className="mt-6">
        <p className="text-sm font-medium text-(--foreground)">Awaiting my review</p>
        <div className="mt-3 space-y-3">
          {loading ? (
            <>
              <div className="glass-inner motion-safe:animate-pulse rounded-xl px-5 py-4">
                <div className="h-4 w-52 rounded-full bg-(--muted-foreground)/20" />
                <div className="mt-2 h-3 w-32 rounded-full bg-(--muted-foreground)/10" />
              </div>
              <div className="glass-inner motion-safe:animate-pulse rounded-xl px-5 py-4">
                <div className="h-4 w-44 rounded-full bg-(--muted-foreground)/20" />
                <div className="mt-2 h-3 w-28 rounded-full bg-(--muted-foreground)/10" />
              </div>
            </>
          ) : (
            <>
              {error ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-(--danger)/40 px-4 py-4">
                  <p className="text-xs text-(--danger)">Couldn’t load sheets: {error}</p>
                  <Button variant="subtle" onClick={load}>Try again</Button>
                </div>
              ) : null}
              {!error && sheets.length === 0 && (
                <div className="rounded-lg border border-dashed border-(--border) px-4 py-5 text-center">
                  <p className="text-xs text-(--muted-foreground)">
                    Nothing awaiting review. Sheets appear here after an admin compiles them.
                  </p>
                  <Button variant="subtle" className="mt-3" onClick={load}>
                    Check again
                  </Button>
                </div>
              )}
              {sheets.map((s) => (
                <Card key={s.id} aria-busy={busyId === s.id ? true : undefined}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-(--foreground)">
                        {s.exams?.name}
                        <span className="text-(--muted-foreground)">
                          {", "}{s.classes?.name} ({s.classes?.department}){s.exams?.academic_year ? `, ${s.exams.academic_year}` : ""}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-(--muted-foreground)">
                        Compiled {new Date(s.updated_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        className="w-44 rounded-lg border border-(--border) bg-(--surface) px-3.5 py-2.5 text-xs text-(--foreground) placeholder:text-(--muted-foreground)/60 outline-none transition-colors hover:border-(--muted-foreground)/50 focus:border-(--primary) focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                        placeholder="Remarks (optional)"
                        value={remarks[s.id] ?? ""}
                        onChange={(e) => setRemarks({ ...remarks, [s.id]: e.target.value })}
                        disabled={busyId === s.id}
                      />
                      <Button variant="success" onClick={() => review(s, true)} disabled={busyId === s.id}>
                        Approve
                      </Button>
                      <Button variant="danger" onClick={() => review(s, false)} disabled={busyId === s.id}>
                        Send back
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </>
          )}
        </div>
      </section>

      {message ? (
        <p
          role="status"
          className={`mt-4 text-xs ${message.startsWith("Sheet ") ? "text-(--success)" : "text-(--danger)"}`}
        >
          {message}
        </p>
      ) : null}

      <section className="mt-8">
        <p className="text-sm font-medium text-(--foreground)">Recent history</p>
        <div className="mt-3 space-y-2">
          {loading && history.length === 0 ? (
            <>
              <div className="glass-inner motion-safe:animate-pulse rounded-lg px-4 py-3">
                <div className="h-4 w-48 rounded-full bg-(--muted-foreground)/20" />
              </div>
              <div className="glass-inner motion-safe:animate-pulse rounded-lg px-4 py-3">
                <div className="h-4 w-40 rounded-full bg-(--muted-foreground)/20" />
              </div>
            </>
          ) : (
            <>
              {history.length === 0 && <Empty>No reviewed sheets yet.</Empty>}
              {history.map((s) => (
                <div key={s.id} className="glass-inner flex items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-(--foreground)">
                      {s.exams?.name}
                      <span className="text-(--muted-foreground)">
                        {", "}{s.classes?.name}{s.exams?.academic_year ? `, ${s.exams.academic_year}` : ""}
                      </span>
                    </p>
                    {s.hod_remarks ? (
                      <p className="truncate text-xs text-(--muted-foreground)" title={s.hod_remarks}>
                        Remarks: {s.hod_remarks}
                      </p>
                    ) : null}
                  </div>
                  <StatusChip status={s.status} />
                </div>
              ))}
            </>
          )}
        </div>
      </section>
    </>
  );
};

export default ReviewSheets;
