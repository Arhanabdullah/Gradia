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

  const load = async () => {
    const select = "id, status, updated_at, hod_remarks, exams ( name, academic_year ), classes ( name, department )";
    const [{ data: pending }, { data: past }] = await Promise.all([
      supabase.from("result_sheets").select(select).eq("status", "compiled"),
      supabase
        .from("result_sheets")
        .select(select)
        .in("status", ["hod_approved", "hod_rejected", "principal_signed", "published"])
        .order("updated_at", { ascending: false })
        .limit(10),
    ]);
    setSheets(pending ?? []);
    setHistory(past ?? []);
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
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-foreground)">Awaiting my review</p>
        <div className="mt-3 space-y-3">
          {sheets.length === 0 && <Empty>Nothing awaiting review.</Empty>}
          {sheets.map((s) => (
            <Card key={s.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-(--foreground)">
                    {s.exams?.name} <span className="text-(--muted-foreground)">· {s.classes?.name} ({s.classes?.department}){s.exams?.academic_year ? ` · ${s.exams.academic_year}` : ""}</span>
                  </p>
                  <p className="text-[10px] text-(--muted-foreground)">
                    Compiled {new Date(s.updated_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    className="w-40 rounded-lg border border-(--border) bg-(--surface) px-2.5 py-1.5 text-xs text-(--foreground) outline-none focus:border-(--primary)"
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
        </div>
      </section>

      {message ? <p className="mt-4 text-xs text-(--muted)">{message}</p> : null}

      <section className="mt-8">
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-foreground)">Recent history</p>
        <div className="mt-3 space-y-2">
          {history.length === 0 && <Empty>No reviewed sheets yet.</Empty>}
          {history.map((s) => (
            <div key={s.id} className="glass-inner flex items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate text-(--foreground)">
                  {s.exams?.name} <span className="text-(--muted-foreground)">· {s.classes?.name}{s.exams?.academic_year ? ` · ${s.exams.academic_year}` : ""}</span>
                </p>
                {s.hod_remarks ? (
                  <p className="truncate text-[10px] text-(--muted-foreground)" title={s.hod_remarks}>
                    Remarks: {s.hod_remarks}
                  </p>
                ) : null}
              </div>
              <StatusChip status={s.status} />
            </div>
          ))}
        </div>
      </section>
    </>
  );
};

export default ReviewSheets;
