import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { callRpc } from "../../lib/db";
import { Button, Card, Empty, StatusChip, inputClass } from "../../components/ui";
import DashboardHeader from "../../components/dashboard/DashboardHeader";
import { subjectLabel } from "../../lib/exams";

function stamp(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ReviewSheets = () => {
  const [sheets, setSheets] = useState([]); // compiled sheets awaiting review
  const [history, setHistory] = useState([]); // reviewed sheets
  const [marksQueue, setMarksQueue] = useState([]); // marks submissions awaiting review
  const [marksHistory, setMarksHistory] = useState([]); // approved or returned marks
  const [remarks, setRemarks] = useState({}); // sheet_id -> remark text
  const [markRemarks, setMarkRemarks] = useState({}); // submission_id -> remark text
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const sheetSelect =
      "id, status, updated_at, hod_remarks, exams ( name, academic_year ), classes ( name, department )";
    const markSelect =
      "id, exam_id, subject_id, class_id, status, submitted_at, reviewed_at, review_remarks, " +
      "exams ( name, academic_year ), subjects ( name, code ), classes ( name )";

    const [pending, past, markPending, markPast] = await Promise.all([
      supabase.from("result_sheets").select(sheetSelect).eq("status", "compiled"),
      supabase
        .from("result_sheets")
        .select(sheetSelect)
        .in("status", ["hod_approved", "hod_rejected", "principal_signed", "published"])
        .order("updated_at", { ascending: false })
        .limit(10),
      supabase
        .from("exam_submissions")
        .select(markSelect)
        .in("status", ["submitted", "under_review"])
        .order("submitted_at", { ascending: true }),
      supabase
        .from("exam_submissions")
        .select(markSelect)
        .in("status", ["approved", "returned"])
        .order("updated_at", { ascending: false })
        .limit(10),
    ]);

    const failure = pending.error || past.error || markPending.error || markPast.error;
    if (failure) setError(failure.message);
    setSheets(pending.data ?? []);
    setHistory(past.data ?? []);
    setMarksQueue(markPending.data ?? []);
    setMarksHistory(markPast.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const review = async (sheet, approve) => {
    setBusyId(sheet.id);
    setNotice(null);
    try {
      await callRpc("review_result_sheet", {
        p_sheet_id: sheet.id,
        p_approve: approve,
        p_remarks: remarks[sheet.id] ?? "",
      });
      setNotice({
        tone: "success",
        text: `Sheet "${sheet.exams?.name}" ${approve ? "approved" : "sent back"}.`,
      });
    } catch (err) {
      setNotice({ tone: "danger", text: err.message });
    }
    setBusyId(null);
    load();
  };

  const reviewMarks = async (row, approve) => {
    setBusyId(row.id);
    setNotice(null);
    try {
      await callRpc("review_exam_marks", {
        p_exam_id: row.exam_id,
        p_subject_id: row.subject_id,
        p_approve: approve,
        p_remarks: markRemarks[row.id] ?? "",
      });
      setNotice({
        tone: "success",
        text: `Marks for ${subjectLabel(row.subjects)} ${approve ? "approved" : "returned for correction"}.`,
      });
    } catch (err) {
      setNotice({ tone: "danger", text: err.message });
    }
    setBusyId(null);
    load();
  };

  return (
    <>
      <DashboardHeader title="Review sheets" subtitle="Approve marks submissions and compiled result sheets." />

      <section className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-(--foreground)">Marks awaiting approval</p>
          <p className="text-xs text-(--muted-foreground) tabular-nums">
            {marksQueue.length} submission{marksQueue.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="mt-3 space-y-3">
          {loading && marksQueue.length === 0 ? (
            <div className="glass-inner motion-safe:animate-pulse rounded-xl px-5 py-4">
              <div className="h-4 w-52 rounded-full bg-(--muted-foreground)/20" />
              <div className="mt-2 h-3 w-32 rounded-full bg-(--muted-foreground)/10" />
            </div>
          ) : null}

          {!loading && marksQueue.length === 0 ? (
            <Empty>No marks are awaiting your approval. Teachers submit marks from the marks entry page.</Empty>
          ) : null}

          {marksQueue.map((row) => (
            <Card key={row.id} aria-busy={busyId === row.id ? true : undefined}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-(--foreground)">
                    {subjectLabel(row.subjects)}
                    <span className="text-(--muted-foreground)">
                      {", "}{row.classes?.name ?? "Class"}
                      {row.exams?.academic_year ? `, ${row.exams.academic_year}` : ""}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-(--muted-foreground)">
                    {row.exams?.name}
                    {row.submitted_at ? `, submitted ${stamp(row.submitted_at)}` : ""}
                  </p>
                </div>
                <StatusChip status={row.status} />
              </div>

              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="min-w-48 flex-1">
                  <span className="text-xs font-medium text-(--muted)">Remarks</span>
                  <input
                    className={`${inputClass} mt-1.5`}
                    placeholder="Optional note for the teacher"
                    value={markRemarks[row.id] ?? ""}
                    onChange={(event) => setMarkRemarks({ ...markRemarks, [row.id]: event.target.value })}
                    disabled={busyId === row.id}
                  />
                </label>
                <Button variant="success" onClick={() => reviewMarks(row, true)} disabled={busyId === row.id}>
                  Approve marks
                </Button>
                <Button variant="danger" onClick={() => reviewMarks(row, false)} disabled={busyId === row.id}>
                  Return for correction
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <p className="text-sm font-medium text-(--foreground)">Compiled sheets awaiting review</p>
        <div className="mt-3 space-y-3">
          {loading && sheets.length === 0 ? (
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
          ) : null}

          {error ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-(--danger)/40 px-4 py-4">
              <p className="text-xs text-(--danger)">Could not load reviews: {error}</p>
              <Button variant="subtle" onClick={load}>Try again</Button>
            </div>
          ) : null}

          {!loading && !error && sheets.length === 0 ? (
            <div className="rounded-lg border border-dashed border-(--border) px-4 py-5 text-center">
              <p className="text-xs text-(--muted-foreground)">
                Nothing awaiting review. Sheets appear here after an admin compiles them.
              </p>
              <Button variant="subtle" className="mt-3" onClick={load}>
                Check again
              </Button>
            </div>
          ) : null}

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
                    Compiled {stamp(s.updated_at)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className={`${inputClass} w-44`}
                    placeholder="Remarks (optional)"
                    value={remarks[s.id] ?? ""}
                    onChange={(event) => setRemarks({ ...remarks, [s.id]: event.target.value })}
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

      {notice ? (
        <p
          role="status"
          className={`mt-4 text-xs ${notice.tone === "success" ? "text-(--success)" : "text-(--danger)"}`}
        >
          {notice.text}
        </p>
      ) : null}

      <section className="mt-8">
        <p className="text-sm font-medium text-(--foreground)">Approval history</p>

        <div className="mt-3 space-y-2">
          <p className="text-xs text-(--muted-foreground)">Marks submissions</p>
          {marksHistory.length === 0 ? <Empty>No reviewed marks yet.</Empty> : null}
          {marksHistory.map((row) => (
            <div key={row.id} className="glass-inner flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate text-(--foreground)">
                  {subjectLabel(row.subjects)}
                  <span className="text-(--muted-foreground)">
                    {", "}{row.classes?.name ?? "Class"}{row.exams?.name ? `, ${row.exams.name}` : ""}
                  </span>
                </p>
                <p className="text-xs text-(--muted-foreground)">
                  {row.reviewed_at ? `Reviewed ${stamp(row.reviewed_at)}` : "No review date"}
                  {row.review_remarks ? `, ${row.review_remarks}` : ""}
                </p>
              </div>
              <StatusChip status={row.status} />
            </div>
          ))}
        </div>

        <div className="mt-5 space-y-2">
          <p className="text-xs text-(--muted-foreground)">Result sheets</p>
          {history.length === 0 ? <Empty>No reviewed sheets yet.</Empty> : null}
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
        </div>
      </section>
    </>
  );
};

export default ReviewSheets;
