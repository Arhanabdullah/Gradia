import { Card, Empty } from "./ui";
import { formatAttendance, summarizeAttendance } from "../lib/attendance";

const AttendanceSummary = ({
  rows = [],
  loading = false,
  title = "Attendance",
  subtitle = "Across every subject and academic year.",
  className = "",
}) => {
  const summary = summarizeAttendance(rows);

  if (loading) {
    return (
      <Card className={className} aria-hidden="true">
        <div className="h-16 motion-safe:animate-pulse rounded-lg bg-(--surface-secondary)" />
      </Card>
    );
  }

  return (
    <Card className={className}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-(--muted-foreground)">{title}</p>
          <p className="mt-1 font-editorial text-4xl leading-none tracking-tight text-(--foreground) tabular-nums">
            {formatAttendance(summary.percentage)}
          </p>
          <p className="mt-2 text-xs text-(--muted-foreground) tabular-nums">
            {summary.total > 0
              ? `${summary.attended} of ${summary.total} classes attended across ${summary.subjects.length} subject${summary.subjects.length === 1 ? "" : "s"}.`
              : "No attendance has been recorded yet."}
          </p>
        </div>
        <p className="text-xs text-(--muted-foreground)">{subtitle}</p>
      </div>

      {summary.subjects.length > 0 ? (
        <div className="mt-5 space-y-2">
          {summary.subjects.map((subject) => (
            <div
              key={subject.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-(--border-subtle) px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-(--foreground)">
                  {subject.code ? `${subject.code}, ` : ""}
                  {subject.name}
                </p>
                <p className="mt-0.5 text-[11px] text-(--muted-foreground) tabular-nums">
                  {subject.attended} of {subject.total} classes
                </p>
              </div>
              <p className="text-sm font-medium text-(--foreground) tabular-nums">
                {formatAttendance(subject.percentage)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4">
          <Empty>No subject-wise attendance yet.</Empty>
        </div>
      )}
    </Card>
  );
};

export default AttendanceSummary;
