import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "../ui";
import {
  PAPER_BUCKET_LABEL,
  comparePapers,
  dateKey,
  paperTimeBucket,
  paperTitle,
  parseDate,
  timeRange,
  todayKey,
} from "../../lib/exams";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthLabel(cursor) {
  return new Date(cursor.year, cursor.month, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

function cursorFor(value) {
  const date = parseDate(value) ?? new Date();
  return { year: date.getFullYear(), month: date.getMonth() };
}

const BUCKET_TONE = {
  upcoming: "border-(--primary)/30 bg-(--primary)/10 text-(--primary)",
  ongoing: "border-(--success)/40 bg-(--success)/10 text-(--success)",
  completed: "border-(--border) bg-(--surface-secondary) text-(--muted-foreground)",
  unscheduled: "border-(--border) bg-(--surface-secondary) text-(--muted-foreground)",
};

function BucketPill({ bucket }) {
  return (
    <span className={`rounded-md border px-1.5 py-0.5 text-[11px] ${BUCKET_TONE[bucket] ?? BUCKET_TONE.unscheduled}`}>
      {PAPER_BUCKET_LABEL[bucket] ?? "Paper"}
    </span>
  );
}

// Shared examination calendar. It reads each paper's own date, so a semester
// examination whose subjects are scheduled on different days shows every paper
// on the correct day. Month navigation and date selection are stateful here so
// both the dashboard card and the examination page behave the same way.
export default function ExamCalendar({
  papers = [],
  selectedKey = "",
  onSelect,
  title = "Examination calendar",
  subtitle = "",
  initialDate = "",
  className = "",
}) {
  const datedPapers = useMemo(() => papers.filter((paper) => paper.date), [papers]);
  const [monthCursor, setMonthCursor] = useState(() => cursorFor(initialDate));
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = todayKey();
    const hasToday = datedPapers.some((paper) => paper.date === today);
    if (hasToday) return today;
    return datedPapers.length ? [...datedPapers].sort(comparePapers)[0].date : "";
  });

  // Selecting a paper elsewhere (the records table or the upcoming list) should
  // bring its month into view.
  const selectedPaper = useMemo(
    () => datedPapers.find((paper) => paper.key === selectedKey) ?? null,
    [datedPapers, selectedKey],
  );

  useEffect(() => {
    if (!selectedPaper?.date) return;
    setMonthCursor(cursorFor(selectedPaper.date));
    setSelectedDate(selectedPaper.date);
  }, [selectedPaper?.key, selectedPaper?.date]);

  const byDate = useMemo(() => {
    const map = new Map();
    datedPapers.forEach((paper) => {
      if (!map.has(paper.date)) map.set(paper.date, []);
      map.get(paper.date).push(paper);
    });
    map.forEach((rows) => rows.sort(comparePapers));
    return map;
  }, [datedPapers]);

  const { year, month } = monthCursor;
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [
    ...Array.from({ length: startOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const today = todayKey();
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthPapers = datedPapers.filter((paper) => paper.date.startsWith(monthKey));
  const counts = monthPapers.reduce(
    (total, paper) => {
      total[paperTimeBucket(paper, today)] += 1;
      return total;
    },
    { upcoming: 0, ongoing: 0, completed: 0, unscheduled: 0 },
  );

  const move = (delta) => {
    const next = new Date(year, month + delta, 1);
    setMonthCursor({ year: next.getFullYear(), month: next.getMonth() });
    const nextKey = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
    const firstInMonth = [...datedPapers].sort(comparePapers).find((paper) => paper.date.startsWith(nextKey));
    setSelectedDate(firstInMonth?.date ?? "");
  };

  const goToday = () => {
    setMonthCursor(cursorFor(today));
    setSelectedDate(today);
  };

  const selectedPapers = selectedDate ? byDate.get(selectedDate) ?? [] : [];

  return (
    <div className={className}>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight text-(--foreground)">{title}</h3>
            <p className="mt-0.5 text-xs text-(--muted-foreground)">
              {subtitle || `${monthLabel(monthCursor)}, ${monthPapers.length} paper${monthPapers.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={goToday}
              className="rounded-lg border border-(--border) px-2.5 py-1.5 text-[11px] text-(--muted-foreground) transition-colors hover:border-(--primary) hover:text-(--foreground)"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => move(-1)}
              aria-label="Previous month"
              className="rounded-lg border border-(--border) p-1.5 text-(--muted-foreground) transition-colors hover:border-(--primary) hover:text-(--foreground)"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              onClick={() => move(1)}
              aria-label="Next month"
              className="rounded-lg border border-(--border) p-1.5 text-(--muted-foreground) transition-colors hover:border-(--primary) hover:text-(--foreground)"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-(--muted-foreground)">
          <span className="rounded-md border border-(--primary)/30 bg-(--primary)/10 px-1.5 py-0.5 text-(--primary)">
            {counts.upcoming} upcoming
          </span>
          <span className="rounded-md border border-(--success)/40 bg-(--success)/10 px-1.5 py-0.5 text-(--success)">
            {counts.ongoing} today
          </span>
          <span className="rounded-md border border-(--border) bg-(--surface-secondary) px-1.5 py-0.5">
            {counts.completed} completed
          </span>
        </div>

        <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] text-(--muted-foreground)">
          {WEEKDAYS.map((day) => (
            <span key={day} className="py-1">{day}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, index) => {
            if (!day) return <div key={`empty-${index}`} className="min-h-11 rounded-lg sm:min-h-14" />;
            const key = dateKey(year, month, day);
            const dayPapers = byDate.get(key) ?? [];
            const isToday = key === today;
            const isSelected = key === selectedDate;
            const bucket = dayPapers.length ? paperTimeBucket(dayPapers[0], today) : null;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedDate(key)}
                aria-pressed={isSelected}
                aria-label={`${new Date(year, month, day).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}${dayPapers.length ? `, ${dayPapers.length} paper${dayPapers.length === 1 ? "" : "s"}` : ""}`}
                className={`min-h-11 rounded-lg border p-1 text-left transition-colors sm:min-h-14 ${
                  isSelected
                    ? "border-(--primary) bg-(--primary)/10"
                    : isToday
                      ? "border-(--primary)/50 bg-(--primary)/5"
                      : "border-transparent hover:border-(--border)"
                }`}
              >
                <span
                  className={`text-[11px] tabular-nums ${
                    isToday || isSelected
                      ? "font-semibold text-(--primary)"
                      : dayPapers.length
                        ? "font-medium text-(--foreground)"
                        : "text-(--muted-foreground)"
                  }`}
                >
                  {day}
                </span>
                {dayPapers.length ? (
                  <span className="mt-0.5 flex flex-wrap items-center gap-0.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${BUCKET_TONE[bucket]?.includes("success") ? "bg-(--success)" : "bg-(--primary)"}`} />
                    <span className="text-[11px] tabular-nums text-(--muted-foreground)">{dayPapers.length}</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="mt-3 border-t border-(--border-subtle) pt-3">
          <p className="text-xs font-medium text-(--foreground)">
            {selectedDate ? parseDate(selectedDate)?.toLocaleDateString("en-GB", {
              weekday: "short",
              day: "2-digit",
              month: "short",
              year: "numeric",
            }) : "Select a date"}
          </p>

          {!selectedDate || selectedPapers.length === 0 ? (
            <p className="mt-1 text-xs text-(--muted-foreground)">
              {datedPapers.length === 0
                ? "No examination papers are scheduled yet. Schedule a semester examination to fill this calendar."
                : "No papers on this date. Choose a highlighted date to see its papers."}
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {selectedPapers.map((paper) => {
                const bucket = paperTimeBucket(paper, today);
                return (
                  <li key={paper.key}>
                    <button
                      type="button"
                      onClick={() => onSelect?.(paper)}
                      className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors hover:border-(--primary) ${
                        paper.key === selectedKey
                          ? "border-(--primary)/50 bg-(--primary)/5"
                          : "border-transparent"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-(--foreground)">{paperTitle(paper)}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-(--muted-foreground)">
                          {[timeRange(paper.start, paper.end), paper.room, paper.className]
                            .filter(Boolean)
                            .join(", ")}
                        </span>
                      </span>
                      <BucketPill bucket={bucket} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {monthPapers.length === 0 && datedPapers.length > 0 ? (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-(--muted-foreground)">
            <CalendarDays size={13} aria-hidden="true" />
            Nothing in {monthLabel(monthCursor)}. Use the arrows to find the next examination.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
