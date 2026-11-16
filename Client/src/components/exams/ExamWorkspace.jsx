import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  MapPin,
  UserRound,
} from "lucide-react";
import { Button, Card, Empty, StatusChip, inputClass } from "../ui";
import PaperScheduleDialog from "./PaperScheduleDialog";
import { supabase } from "../../lib/supabase";
import {
  comparePapers,
  dateKey,
  examTypeLabel,
  formatClock,
  formatExamDate,
  groupIsPublished,
  isClassworkComponent,
  isPracticalSubject,
  paperTitle,
  parseDate,
  resolvedResultKind,
  resultKindLabel,
  submissionStatusLabel,
  teacherLabel,
  timeRange,
  todayKey,
} from "../../lib/exams";
import {
  aggregationLabel,
  averageGroups,
  componentContribution,
  numberText,
  scheduleModeLabel,
} from "../../lib/assessment";

const DETAIL_TABS = [
  { id: "details", label: "Exam details" },
  { id: "students", label: "Registered students" },
  { id: "marks", label: "Marks entry" },
  { id: "reports", label: "Reports" },
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthLabel(cursor) {
  return new Date(cursor.year, cursor.month, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

function paperTone(paper) {
  if (paper.classwork) {
    return "border-(--border) bg-(--surface-secondary) text-(--muted-foreground)";
  }
  if (paper.componentType === "esa") {
    return "border-(--tertiary)/30 bg-(--tertiary)/10 text-(--tertiary)";
  }
  return "border-(--primary)/30 bg-(--primary)/10 text-(--primary)";
}

function paperKindLabel(paper) {
  if (paper.classwork) return "Classwork";
  if (!paper.component) return examTypeLabel(paper.examType);
  if (paper.componentType === "esa") return "End-Semester";
  if (paper.componentType === "practical") return "Practical";
  return "Theory";
}

function PaperChip({ paper, active, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(paper)}
      title={paperTitle(paper)}
      className={`block w-full truncate rounded-md border px-1.5 py-0.5 text-left text-[11px] transition-colors hover:border-(--primary) ${paperTone(paper)} ${
        active ? "ring-2 ring-(--primary)" : ""
      }`}
    >
      {paper.component?.name ?? paper.subjectCode ?? paper.subjectName}
    </button>
  );
}

function Legend({ paper, label }) {
  return (
    <span className={`rounded-md border px-1.5 py-0.5 text-[11px] ${paperTone(paper)}`}>{label}</span>
  );
}

function ExamCalendar({ papers, selectedKey, monthCursor, setMonthCursor, onSelect }) {
  const byDate = useMemo(() => {
    const map = new Map();
    papers.forEach((paper) => {
      if (!paper.date) return;
      if (!map.has(paper.date)) map.set(paper.date, []);
      map.get(paper.date).push(paper);
    });
    return map;
  }, [papers]);

  const { year, month } = monthCursor;
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [
    ...Array.from({ length: startOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const today = todayKey();
  const move = (delta) => {
    const next = new Date(year, month + delta, 1);
    setMonthCursor({ year: next.getFullYear(), month: next.getMonth() });
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-(--foreground)">Examination calendar</h3>
          <p className="mt-0.5 text-xs text-(--muted-foreground)">{monthLabel(monthCursor)}</p>
        </div>
        <div className="flex items-center gap-1">
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

      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] text-(--muted-foreground)">
        {WEEKDAYS.map((day) => (
          <span key={day} className="py-1">{day}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (!day) return <div key={`empty-${index}`} className="min-h-14 rounded-lg" />;
          const key = dateKey(year, month, day);
          const dayPapers = byDate.get(key) ?? [];
          const isToday = key === today;
          return (
            <div
              key={key}
              className={`min-h-14 rounded-lg border p-1 ${
                isToday ? "border-(--primary)/50 bg-(--primary)/5" : "border-transparent"
              }`}
            >
              <span
                className={`text-[11px] tabular-nums ${
                  isToday ? "font-semibold text-(--primary)" : "text-(--muted-foreground)"
                }`}
              >
                {day}
              </span>
              <div className="mt-0.5 space-y-0.5">
                {dayPapers.slice(0, 2).map((paper) => (
                  <PaperChip
                    key={paper.key}
                    paper={paper}
                    active={paper.key === selectedKey}
                    onSelect={onSelect}
                  />
                ))}
                {dayPapers.length > 2 ? (
                  <span className="block px-1 text-[11px] text-(--muted-foreground)">
                    +{dayPapers.length - 2} more
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Legend paper={{ componentType: "internal" }} label="IA and ESA papers" />
        <Legend paper={{ componentType: "esa" }} label="End-Semester" />
        <Legend paper={{ classwork: true }} label="Classwork" />
      </div>
    </Card>
  );
}

function UpcomingList({ papers, selectedKey, onSelect }) {
  const upcoming = useMemo(
    () =>
      papers
        .filter((paper) => paper.date && paper.date >= todayKey())
        .sort(comparePapers)
        .slice(0, 6),
    [papers],
  );

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight text-(--foreground)">Upcoming papers</h3>
        <span className="text-[11px] text-(--muted-foreground)">{upcoming.length}</span>
      </div>

      {upcoming.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-(--border) px-3.5 py-4 text-xs text-(--muted-foreground)">
          No dated papers yet. Open a paper below and set its date, or use a quick action.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {upcoming.map((paper) => {
            const parsed = parseDate(paper.date);
            return (
              <li key={paper.key}>
                <button
                  type="button"
                  onClick={() => onSelect(paper)}
                  className={`flex w-full items-start gap-3 rounded-lg border px-2.5 py-2 text-left transition-colors hover:border-(--primary) ${
                    paper.key === selectedKey ? "border-(--primary)/50 bg-(--primary)/5" : "border-transparent"
                  }`}
                >
                  <span className="flex w-10 shrink-0 flex-col items-center rounded-lg border border-(--border) py-1">
                    <span className="text-[11px] text-(--muted-foreground)">
                      {parsed ? parsed.toLocaleDateString("en-GB", { month: "short" }) : "Date"}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-(--foreground)">
                      {parsed ? parsed.getDate() : "-"}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-(--foreground)">
                      {paperTitle(paper)}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-(--muted-foreground)">
                      {[paperKindLabel(paper), formatClock(paper.start), paper.room].filter(Boolean).join(", ")}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function DetailRow({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-(--muted-foreground)">{label}</dt>
      <dd className="mt-0.5 text-sm text-(--foreground)">{children || "Not set"}</dd>
    </div>
  );
}

function AssessmentPattern({ paper, canSchedule, onOpenSchedule, onSelectComponent }) {
  const components = paper.examSubject.assessment_components ?? [];

  if (components.length === 0) {
    return (
      <div>
        <h4 className="text-sm font-semibold tracking-tight text-(--foreground)">Assessment pattern</h4>
        <p className="mt-2 text-xs text-(--muted-foreground)">
          This examination uses a single paper of {numberText(paper.maxMarks)} marks. Attach an assessment
          structure to break it into IA, ESA and classwork papers.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold tracking-tight text-(--foreground)">Assessment pattern</h4>
        <span className="text-[11px] text-(--muted-foreground)">
          {components.length} paper{components.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-(--border-subtle)">
              <th className="px-2 py-1.5 font-medium text-(--muted-foreground)">Paper</th>
              <th className="px-2 py-1.5 font-medium text-(--muted-foreground)">Type</th>
              <th className="px-2 py-1.5 text-right font-medium text-(--muted-foreground)">Max</th>
              <th className="px-2 py-1.5 text-right font-medium text-(--muted-foreground)">Contributes</th>
              <th className="px-2 py-1.5 font-medium text-(--muted-foreground)">Mode</th>
              <th className="px-2 py-1.5 text-right font-medium text-(--muted-foreground)">Action</th>
            </tr>
          </thead>
          <tbody>
            {components.map((component) => {
              const target = paper.subjectPapers.find((row) => row.component?.id === component.id);
              return (
                <tr key={component.id} className="border-b border-(--border-subtle) last:border-0">
                  <td className="px-2 py-1.5 text-(--foreground)">{component.name}</td>
                  <td className="px-2 py-1.5 text-(--muted-foreground)">
                    {component.aggregation === "average"
                      ? `Averaged in ${component.group_code || "group"}`
                      : aggregationLabel(component.aggregation)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-(--foreground)">
                    {numberText(component.max_marks)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-(--foreground)">
                    {numberText(componentContribution(component))}
                  </td>
                  <td className="px-2 py-1.5 text-(--muted-foreground)">
                    {scheduleModeLabel(isClassworkComponent(component) ? "classwork" : "formal")}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {target && canSchedule ? (
                      <button
                        type="button"
                        onClick={() => onOpenSchedule(target)}
                        className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-(--primary) transition-colors hover:bg-(--primary)/10"
                      >
                        {isClassworkComponent(component) ? "Update" : "Schedule"}
                      </button>
                    ) : target ? (
                      <button
                        type="button"
                        onClick={() => onSelectComponent(target)}
                        className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-(--muted-foreground) transition-colors hover:text-(--foreground)"
                      >
                        View
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="px-2 pt-2 text-xs font-medium text-(--foreground)">Total</td>
              <td className="px-2 pt-2 text-right text-xs font-semibold tabular-nums text-(--foreground)">
                {numberText(
                  components.reduce((sum, component) => {
                    if (component.aggregation === "average") return sum;
                    return sum + componentContribution(component);
                  }, 0) +
                    averageGroups(components).reduce((sum, group) => sum + group.weight, 0),
                )}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function StudentList({ state, query, setQuery, onRetry }) {
  const rows = state.rows.filter((row) => {
    const profile = row.profiles ?? {};
    const haystack = `${profile.name ?? ""} ${profile.student_id ?? ""} ${profile.registration_no ?? ""}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  if (state.loading) {
    return (
      <div className="mt-3 space-y-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-10 animate-pulse rounded-lg bg-(--surface-secondary)" />
        ))}
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-(--danger)/40 px-3.5 py-3">
        <p className="text-xs text-(--danger)">{state.error}</p>
        <Button type="button" variant="subtle" onClick={onRetry}>Try again</Button>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          type="search"
          className={`${inputClass} max-w-xs`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by roll number or name"
          aria-label="Search registered students"
        />
        <span className="text-[11px] text-(--muted-foreground)">
          {rows.length} of {state.rows.length} students
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-(--border) px-3.5 py-4 text-xs text-(--muted-foreground)">
          {state.rows.length === 0
            ? "No students are enrolled in this class yet."
            : "No student matches this search."}
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr className="border-b border-(--border-subtle)">
                <th className="px-2 py-1.5 font-medium text-(--muted-foreground)">Roll number</th>
                <th className="px-2 py-1.5 font-medium text-(--muted-foreground)">Student name</th>
                <th className="px-2 py-1.5 font-medium text-(--muted-foreground)">Registration number</th>
                <th className="px-2 py-1.5 font-medium text-(--muted-foreground)">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const profile = row.profiles ?? {};
                return (
                  <tr key={row.id} className="border-b border-(--border-subtle) last:border-0">
                    <td className="px-2 py-1.5 tabular-nums text-(--foreground)">
                      {profile.student_id || "Not set"}
                    </td>
                    <td className="px-2 py-1.5 text-(--foreground)">{profile.name ?? "Student"}</td>
                    <td className="px-2 py-1.5 tabular-nums text-(--muted-foreground)">
                      {profile.registration_no || "Not set"}
                    </td>
                    <td className="px-2 py-1.5 text-(--muted-foreground)">{row.status ?? "active"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MarksSummary({ paper, state, onRetry }) {
  if (state.loading) {
    return <div className="mt-3 h-24 animate-pulse rounded-lg bg-(--surface-secondary)" />;
  }

  if (state.error) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-(--danger)/40 px-3.5 py-3">
        <p className="text-xs text-(--danger)">{state.error}</p>
        <Button type="button" variant="subtle" onClick={onRetry}>Try again</Button>
      </div>
    );
  }

  const rows = state.rows;
  const students = new Set(rows.map((row) => row.student_id)).size;
  const withheld = rows.filter((row) => row.status === "withheld").length;
  const components = paper.examSubject.assessment_components ?? [];

  const byComponent = new Map();
  rows.forEach((row) => {
    const key = row.assessment_component_id ?? "legacy";
    const bucket = byComponent.get(key) ?? { entered: 0, withheld: 0, total: 0 };
    bucket.entered += 1;
    if (row.status === "withheld") bucket.withheld += 1;
    bucket.total += Number(row.marks_obtained ?? 0);
    byComponent.set(key, bucket);
  });

  return (
    <div className="mt-3 space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-(--border) px-3 py-2">
          <p className="text-[11px] text-(--muted-foreground)">Students with marks</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-(--foreground)">{students}</p>
        </div>
        <div className="rounded-lg border border-(--border) px-3 py-2">
          <p className="text-[11px] text-(--muted-foreground)">Mark rows</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-(--foreground)">{rows.length}</p>
        </div>
        <div className="rounded-lg border border-(--border) px-3 py-2">
          <p className="text-[11px] text-(--muted-foreground)">Withheld</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-(--foreground)">{withheld}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-(--border) px-3.5 py-4 text-xs text-(--muted-foreground)">
          No marks have been entered for this subject yet. Use Marks Entry to record them.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr className="border-b border-(--border-subtle)">
                <th className="px-2 py-1.5 font-medium text-(--muted-foreground)">Paper</th>
                <th className="px-2 py-1.5 text-right font-medium text-(--muted-foreground)">Entered</th>
                <th className="px-2 py-1.5 text-right font-medium text-(--muted-foreground)">Withheld</th>
                <th className="px-2 py-1.5 text-right font-medium text-(--muted-foreground)">Average</th>
              </tr>
            </thead>
            <tbody>
              {components.map((component) => {
                const bucket = byComponent.get(component.id);
                return (
                  <tr key={component.id} className="border-b border-(--border-subtle) last:border-0">
                    <td className="px-2 py-1.5 text-(--foreground)">{component.name}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-(--foreground)">
                      {bucket?.entered ?? 0}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-(--foreground)">
                      {bucket?.withheld ?? 0}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-(--foreground)">
                      {bucket && bucket.entered - bucket.withheld > 0
                        ? numberText(bucket.total / (bucket.entered - bucket.withheld))
                        : "Not set"}
                    </td>
                  </tr>
                );
              })}
              {byComponent.has("legacy") ? (
                <tr>
                  <td className="px-2 py-1.5 text-(--foreground)">Single paper</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-(--foreground)">
                    {byComponent.get("legacy").entered}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-(--foreground)">
                    {byComponent.get("legacy").withheld}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-(--foreground)">
                    {numberText(
                      byComponent.get("legacy").total /
                        Math.max(
                          1,
                          byComponent.get("legacy").entered - byComponent.get("legacy").withheld,
                        ),
                    )}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReportsPanel({ paper }) {
  const sheets = paper.sheets;
  if (sheets.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-dashed border-(--border) px-3.5 py-4 text-xs text-(--muted-foreground)">
        No result sheet has been compiled for this class yet. Compile it after the marks are approved.
      </p>
    );
  }

  return (
    <ul className="mt-3 space-y-2">
      {sheets.map((sheet) => (
        <li key={sheet.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-(--border) px-3.5 py-2.5">
          <div>
            <p className="text-sm font-medium text-(--foreground)">{resultKindLabel(sheet.result_kind)}</p>
            <p className="mt-0.5 text-[11px] text-(--muted-foreground)">
              {sheet.result_kind === "semester"
                ? "Official semester result"
                : "Internal assessment, dashboard only"}
            </p>
          </div>
          <StatusChip status={sheet.status} />
        </li>
      ))}
    </ul>
  );
}

function ExamDetailCard({
  paper,
  tab,
  setTab,
  profile,
  studentsState,
  marksState,
  studentQuery,
  setStudentQuery,
  onRetryStudents,
  onRetryMarks,
  onOpenSchedule,
  onSelectComponent,
  canSchedule,
}) {
  const submission = paper.submission;

  return (
    <Card className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-(--muted-foreground)">
            {paper.className}
            {paper.semester ? `, semester ${paper.semester}` : ""}
            {paper.academicYear ? `, ${paper.academicYear}` : ""}
          </p>
          <h3 className="mt-1 truncate text-lg font-semibold tracking-tight text-(--foreground)">
            {paper.subjectName}
          </h3>
          <p className="mt-0.5 text-xs text-(--muted-foreground)">
            {paper.subjectCode ? `${paper.subjectCode}, ` : ""}
            {paper.component ? paper.component.name : "Single paper"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusChip status={paper.status} />
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${paperTone(paper)}`}>
            {paperKindLabel(paper)}
          </span>
          <span className="rounded-full border border-(--border) px-2.5 py-1 text-[11px] font-medium text-(--muted-foreground)">
            {resultKindLabel(paper.resultKind)}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-(--muted-foreground)">
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays size={13} aria-hidden="true" />
          {paper.date ? formatExamDate(paper.date) : "Date not set"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ClipboardList size={13} aria-hidden="true" />
          {timeRange(paper.start, paper.end)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MapPin size={13} aria-hidden="true" />
          {paper.room || "Room not set"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <UserRound size={13} aria-hidden="true" />
          {paper.invigilatorName || "Invigilator not set"}
        </span>
      </div>

      <nav aria-label="Exam detail views" className="mt-4 flex flex-wrap gap-1 border-b border-(--border-subtle) pb-2">
        {DETAIL_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs transition-colors ${
              tab === item.id
                ? "bg-(--primary-deep) text-white"
                : "text-(--muted-foreground) hover:bg-(--primary)/5 hover:text-(--foreground)"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "details" ? (
        <div className="mt-4 space-y-5">
          <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <DetailRow label="Subject">
              {paper.subjectCode ? `${paper.subjectCode} ${paper.subjectName}` : paper.subjectName}
            </DetailRow>
            <DetailRow label="Class">{paper.className}</DetailRow>
            <DetailRow label="Exam type">
              {paper.component ? paper.component.name : paper.examName}
            </DetailRow>
            <DetailRow label="Date and time">
              {paper.date
                ? `${formatExamDate(paper.date)}, ${timeRange(paper.start, paper.end)}`
                : "Not scheduled"}
            </DetailRow>
            <DetailRow label="Duration">
              {paper.duration ? `${paper.duration} minutes` : "Not set"}
            </DetailRow>
            <DetailRow label="Room">{paper.room}</DetailRow>
            <DetailRow label="Invigilator">{paper.invigilatorName}</DetailRow>
            <DetailRow label="Academic year">{paper.academicYear}</DetailRow>
            <DetailRow label="Semester">{paper.semester ? `Semester ${paper.semester}` : "Not set"}</DetailRow>
            <DetailRow label="Mode">{paper.classwork ? "Classwork" : "Formal paper"}</DetailRow>
            <DetailRow label="Conducted">{paper.conducted ? "Yes" : "Skipped"}</DetailRow>
            <DetailRow label="Marks submission">
              {submission ? submissionStatusLabel(submission.status) : "Not submitted"}
            </DetailRow>
          </dl>

          <AssessmentPattern
            paper={paper}
            canSchedule={canSchedule}
            onOpenSchedule={onOpenSchedule}
            onSelectComponent={onSelectComponent}
          />
        </div>
      ) : null}

      {tab === "students" ? (
        <StudentList
          state={studentsState}
          query={studentQuery}
          setQuery={setStudentQuery}
          onRetry={onRetryStudents}
        />
      ) : null}

      {tab === "marks" ? (
        <div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold tracking-tight text-(--foreground)">Marks entry</h4>
              <p className="mt-0.5 text-xs text-(--muted-foreground)">
                {submission
                  ? `Submission ${submissionStatusLabel(submission.status).toLowerCase()}`
                  : "Not submitted for review yet"}
              </p>
            </div>
            <MarksLink profile={profile} />
          </div>
          <MarksSummary paper={paper} state={marksState} onRetry={onRetryMarks} />
        </div>
      ) : null}

      {tab === "reports" ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold tracking-tight text-(--foreground)">Result sheets</h4>
            <ReportsLink profile={profile} />
          </div>
          <ReportsPanel paper={paper} />
        </div>
      ) : null}
    </Card>
  );
}

function MarksLink({ profile }) {
  const role = profile?.role;
  if (role === "teacher") {
    return <Link to="/app/marks" className="text-xs font-medium text-(--primary)">Open marks entry</Link>;
  }
  if (role === "admin" || role === "exam_cell") {
    return <Link to="/app/sheets" className="text-xs font-medium text-(--primary)">Open result sheets</Link>;
  }
  if (role === "hod") {
    return <Link to="/app/review" className="text-xs font-medium text-(--primary)">Open review</Link>;
  }
  if (role === "principal") {
    return <Link to="/app/publish" className="text-xs font-medium text-(--primary)">Open publication</Link>;
  }
  return null;
}

function ReportsLink({ profile }) {
  const role = profile?.role;
  if (role === "admin" || role === "exam_cell") {
    return <Link to="/app/sheets" className="text-xs font-medium text-(--primary)">Open result sheets</Link>;
  }
  if (role === "principal") {
    return <Link to="/app/publish" className="text-xs font-medium text-(--primary)">Open publication</Link>;
  }
  if (role === "hod") {
    return <Link to="/app/review" className="text-xs font-medium text-(--primary)">Open review</Link>;
  }
  return null;
}

function QuickActions({ paper, canSchedule, onOpenSchedule }) {
  const components = paper.examSubject.assessment_components ?? [];
  const practical = isPracticalSubject(paper.subject);
  const formalCodes = practical
    ? ["PRACTICAL_EXAM", "VIVA", "FINAL"]
    : ["IA1", "IA2", "ESA"];
  const classworkCodes = practical
    ? ["PRACTICAL_RECORD"]
    : ["QUIZ", "ASSIGNMENT", "PROJECT"];

  const formal = formalCodes
    .map((code) => components.find((component) => String(component.code ?? "").toUpperCase() === code))
    .filter(Boolean);
  const classwork = classworkCodes
    .map((code) => components.find((component) => String(component.code ?? "").toUpperCase() === code))
    .find(Boolean);

  const targetFor = (component) =>
    paper.subjectPapers.find((row) => row.component?.id === component.id) ?? null;

  if (components.length === 0) {
    return (
      <p className="text-xs text-(--muted-foreground)">
        This examination has a single paper. Attach an assessment structure to schedule IA, ESA and
        classwork separately.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {formal.map((component) => {
        const target = targetFor(component);
        return (
          <button
            key={component.id}
            type="button"
            disabled={!canSchedule || !target}
            onClick={() => target && onOpenSchedule(target)}
            className="w-full rounded-lg border border-(--border) px-3.5 py-2.5 text-left transition-colors hover:border-(--primary) hover:bg-(--primary)/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="block text-sm font-medium text-(--foreground)">
              {component.exam_date ? `Edit ${component.name}` : `Schedule ${component.name}`}
            </span>
            <span className="mt-0.5 block text-[11px] text-(--muted-foreground)">
              {canSchedule ? "Date, room and invigilator" : "Read only for your role"}
            </span>
          </button>
        );
      })}

      {classwork ? (
        <button
          type="button"
          disabled={!canSchedule}
          onClick={() => {
            const target = targetFor(classwork);
            if (target) onOpenSchedule(target);
          }}
          className="w-full rounded-lg border border-(--border) px-3.5 py-2.5 text-left transition-colors hover:border-(--primary) hover:bg-(--primary)/5 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="block text-sm font-medium text-(--foreground)">Update {classwork.name}</span>
          <span className="mt-0.5 block text-[11px] text-(--muted-foreground)">
            {canSchedule ? "Classwork, mark conducted" : "Read only for your role"}
          </span>
        </button>
      ) : null}

      {formal.length === 0 && !classwork ? (
        <p className="text-xs text-(--muted-foreground)">
          No quick action matches this subject's structure.
        </p>
      ) : null}
    </div>
  );
}

function AssessmentSummary({ paper }) {
  const components = paper.examSubject.assessment_components ?? [];
  const groups = averageGroups(components);
  const rows = [];
  const seenGroups = new Set();
  components.forEach((component) => {
    if (component.aggregation === "average") {
      const code = (component.group_code ?? "").trim() || component.name;
      if (seenGroups.has(code)) return;
      seenGroups.add(code);
      const group = groups.find((row) => row.code === code);
      rows.push({
        label: code === "IA" ? "IA average" : `Group ${code}`,
        value: group?.weight ?? 0,
      });
      return;
    }
    rows.push({ label: component.name, value: componentContribution(component) });
  });
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return (
    <div>
      {components.length === 0 ? (
        <div>
          <p className="text-sm font-semibold tabular-nums text-(--foreground)">
            {numberText(paper.maxMarks)} marks
          </p>
          <p className="mt-0.5 text-[11px] text-(--muted-foreground)">Single paper</p>
        </div>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold tabular-nums text-(--foreground)">{numberText(total)}</p>
            <p className="text-[11px] text-(--muted-foreground)">Total marks</p>
          </div>
          <ul className="mt-2 space-y-1.5">
            {rows.map((row) => (
              <li key={row.label}>
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate text-(--muted-foreground)">{row.label}</span>
                  <span className="shrink-0 tabular-nums text-(--foreground)">
                    {numberText(row.value)}
                    {total > 0 ? ` (${Math.round((row.value / total) * 100)}%)` : ""}
                  </span>
                </div>
                <div className="mt-0.5 h-1 rounded-full bg-(--border)">
                  <div
                    className="h-1 rounded-full bg-(--primary)"
                    style={{ width: total > 0 ? `${Math.max(2, (row.value / total) * 100)}%` : "0%" }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default function ExamWorkspace({
  profile,
  groups,
  filters,
  onFilter,
  onResetAfter,
  yearOptions,
  semesterOptions,
  filterClasses,
  subjects,
  classSubjects,
  teachers,
  teacherAssignments,
  canCreate,
  loading,
  loadError,
  onSchedule,
  onEditSchedule,
  onChanged,
  onNotify,
}) {
  const [selectedKey, setSelectedKey] = useState("");
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [tab, setTab] = useState("details");
  const [dialogPaper, setDialogPaper] = useState(null);
  const [studentQuery, setStudentQuery] = useState("");
  const [studentsNonce, setStudentsNonce] = useState(0);
  const [marksNonce, setMarksNonce] = useState(0);
  const [studentsState, setStudentsState] = useState({ loading: false, error: "", rows: [] });
  const [marksState, setMarksState] = useState({ loading: false, error: "", rows: [] });

  const papers = useMemo(
    () => flattenPapers(groups).filter((row) => matchesPaperFilters(row, filters)),
    [groups, filters],
  );

  const defaultPaper = useMemo(() => {
    const upcoming = papers
      .filter((paper) => paper.date && paper.date >= todayKey())
      .sort(comparePapers)[0];
    return upcoming ?? papers[0] ?? null;
  }, [papers]);

  useEffect(() => {
    if (papers.length === 0) {
      setSelectedKey("");
      return;
    }
    if (!papers.some((paper) => paper.key === selectedKey)) {
      setSelectedKey(defaultPaper?.key ?? "");
      if (defaultPaper?.date) {
        const parsed = parseDate(defaultPaper.date);
        if (parsed) setMonthCursor({ year: parsed.getFullYear(), month: parsed.getMonth() });
      }
    }
  }, [papers, selectedKey, defaultPaper]);

  const paper = papers.find((row) => row.key === selectedKey) ?? defaultPaper;

  useEffect(() => {
    setTab("details");
    setStudentQuery("");
  }, [paper?.key]);

  const teacherById = useMemo(() => new Map(teachers.map((teacher) => [teacher.id, teacher])), [teachers]);

  const selectPaper = (target) => {
    setSelectedKey(target.key);
    if (target.date) {
      const parsed = parseDate(target.date);
      if (parsed) setMonthCursor({ year: parsed.getFullYear(), month: parsed.getMonth() });
    }
  };

  const canSchedule = useMemo(() => {
    if (!paper) return false;
    if (profile?.role === "admin" || profile?.role === "exam_cell") return true;
    if (profile?.role === "teacher") {
      return teacherAssignments.some(
        (row) =>
          row.class_id === paper.classId &&
          row.subject_id === paper.subjectId &&
          row.teacher_id === profile.id,
      );
    }
    return false;
  }, [paper, profile, teacherAssignments]);

  useEffect(() => {
    if (tab !== "students" || !paper) return undefined;
    let cancelled = false;
    setStudentsState({ loading: true, error: "", rows: [] });
    supabase
      .from("student_enrollments")
      .select("id, status, profiles ( id, name, student_id, registration_no )")
      .eq("class_id", paper.classId)
      .order("created_at")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setStudentsState({ loading: false, error: "Could not load registered students.", rows: [] });
          return;
        }
        setStudentsState({ loading: false, error: "", rows: data ?? [] });
      });
    return () => {
      cancelled = true;
    };
  }, [tab, paper, studentsNonce]);

  useEffect(() => {
    if (tab !== "marks" || !paper) return undefined;
    let cancelled = false;
    setMarksState({ loading: true, error: "", rows: [] });
    supabase
      .from("marks")
      .select("id, student_id, assessment_component_id, marks_obtained, status")
      .eq("exam_id", paper.examId)
      .eq("subject_id", paper.subjectId)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setMarksState({ loading: false, error: "Could not load marks for this subject.", rows: [] });
          return;
        }
        setMarksState({ loading: false, error: "", rows: data ?? [] });
      });
    return () => {
      cancelled = true;
    };
  }, [tab, paper, marksNonce]);

  const subjectOptions = useMemo(() => {
    if (!filters.classId) return subjects;
    const offered = new Set(
      classSubjects
        .filter((row) => row.class_id === filters.classId)
        .map((row) => row.subject_id),
    );
    return subjects.filter((subject) => offered.has(subject.id));
  }, [subjects, classSubjects, filters.classId]);

  return (
    <section className="mt-5" aria-label="Examination workspace">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        <label className="block">
          <span className="text-xs font-medium text-(--muted)">Academic year</span>
          <select
            className={`${inputClass} mt-1.5`}
            value={filters.year}
            onChange={(event) => onResetAfter("year", event.target.value)}
          >
            <option value="">Any year</option>
            {yearOptions.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-(--muted)">Semester</span>
          <select
            className={`${inputClass} mt-1.5`}
            value={filters.semester}
            onChange={(event) => onFilter({ semester: event.target.value, classId: "", subjectId: "" })}
          >
            <option value="">Any semester</option>
            {semesterOptions.map((semester) => (
              <option key={semester} value={semester}>Semester {semester}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-(--muted)">Class</span>
          <select
            className={`${inputClass} mt-1.5`}
            value={filters.classId}
            onChange={(event) => onFilter({ classId: event.target.value, subjectId: "" })}
          >
            <option value="">Any class</option>
            {filterClasses.map((klass) => (
              <option key={klass.id} value={klass.id}>{klass.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-(--muted)">Subject</span>
          <select
            className={`${inputClass} mt-1.5`}
            value={filters.subjectId}
            onChange={(event) => onFilter({ subjectId: event.target.value })}
          >
            <option value="">Any subject</option>
            {subjectOptions.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.code ? `${subject.code} ${subject.name}` : subject.name}
              </option>
            ))}
          </select>
        </label>
        {canCreate ? (
          <div className="flex flex-wrap items-end gap-2">
            {paper?.group &&
            !groupIsPublished(paper.group) &&
            (profile?.role === "admin" ||
              profile?.role === "exam_cell" ||
              (profile?.role === "teacher" && paper.group.created_by === profile?.id)) ? (
              <Button type="button" variant="subtle" onClick={() => onEditSchedule(paper.group)}>
                Edit schedule
              </Button>
            ) : null}
            <Button type="button" className="w-full xl:w-auto" onClick={onSchedule}>
              Schedule exam
            </Button>
          </div>
        ) : null}
      </div>

      {loadError ? (
        <div className="mt-3 rounded-lg border border-dashed border-(--danger)/40 px-4 py-3">
          <p className="text-xs text-(--danger)">{loadError}</p>
        </div>
      ) : loading ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.55fr)_minmax(0,0.85fr)]">
          <div className="glass-inner h-80 animate-pulse rounded-xl" />
          <div className="glass-inner h-80 animate-pulse rounded-xl" />
          <div className="glass-inner h-80 animate-pulse rounded-xl" />
        </div>
      ) : papers.length === 0 ? (
        <div className="mt-4">
          <Empty>
            No papers match this view. Clear the filters or schedule an examination to begin.
          </Empty>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.55fr)_minmax(0,0.85fr)]">
          <div className="space-y-4">
            <ExamCalendar
              papers={papers}
              selectedKey={paper?.key ?? ""}
              monthCursor={monthCursor}
              setMonthCursor={setMonthCursor}
              onSelect={selectPaper}
            />
            <UpcomingList papers={papers} selectedKey={paper?.key ?? ""} onSelect={selectPaper} />
          </div>

          {paper ? (
            <ExamDetailCard
              paper={{
                ...paper,
                invigilatorName: paper.teacherId ? teacherLabel(teacherById.get(paper.teacherId)) : "",
                subjectPapers: papers.filter(
                  (row) => row.examSubject.id === paper.examSubject.id,
                ),
              }}
              tab={tab}
              setTab={setTab}
              profile={profile}
              studentsState={studentsState}
              marksState={marksState}
              studentQuery={studentQuery}
              setStudentQuery={setStudentQuery}
              onRetryStudents={() => setStudentsNonce((value) => value + 1)}
              onRetryMarks={() => setMarksNonce((value) => value + 1)}
              onOpenSchedule={setDialogPaper}
              onSelectComponent={selectPaper}
              canSchedule={canSchedule}
            />
          ) : null}

          <div className="space-y-4">
            <Card>
              <h3 className="text-sm font-semibold tracking-tight text-(--foreground)">Quick actions</h3>
              <div className="mt-2">
                {paper ? (
                  <QuickActions
                    paper={{
                      ...paper,
                      subjectPapers: papers.filter(
                        (row) => row.examSubject.id === paper.examSubject.id,
                      ),
                    }}
                    canSchedule={canSchedule}
                    onOpenSchedule={setDialogPaper}
                  />
                ) : (
                  <p className="text-xs text-(--muted-foreground)">Select a paper to see actions.</p>
                )}
              </div>
            </Card>

            <Card>
              <h3 className="text-sm font-semibold tracking-tight text-(--foreground)">Assessment summary</h3>
              <div className="mt-2">
                {paper ? (
                  <AssessmentSummary
                    paper={{
                      ...paper,
                      subjectPapers: papers.filter(
                        (row) => row.examSubject.id === paper.examSubject.id,
                      ),
                    }}
                  />
                ) : null}
              </div>
            </Card>

            <Card>
              <h3 className="text-sm font-semibold tracking-tight text-(--foreground)">Note</h3>
              <p className="mt-2 text-xs text-(--muted-foreground)">
                IA1, IA2, Quiz, Assignment and Project marks stay inside the app. Only the final ESA
                result appears on the printable grade card.
              </p>
            </Card>
          </div>
        </div>
      )}

      {dialogPaper ? (
        <PaperScheduleDialog
          paper={{
            ...dialogPaper,
            invigilatorName: dialogPaper.teacherId
              ? teacherLabel(teacherById.get(dialogPaper.teacherId))
              : "",
          }}
          teachers={teachers}
          onClose={() => setDialogPaper(null)}
          onSaved={onChanged}
          onNotify={onNotify}
        />
      ) : null}
    </section>
  );
}

// ---------- data shaping ----------
// The page filters groups, but a group keeps every subject it contains. The
// workspace shows one paper at a time, so it filters the flattened papers by
// the same controls to avoid showing a subject the user filtered out.
function matchesPaperFilters(paper, filters) {
  if (!filters) return true;
  if (filters.year && paper.academicYear !== filters.year) return false;
  if (filters.semester && String(paper.semester ?? "") !== filters.semester) return false;
  if (filters.classId && paper.classId !== filters.classId) return false;
  if (filters.subjectId && paper.subjectId !== filters.subjectId) return false;
  if (filters.teacherId && paper.examSubject?.teacher_id !== filters.teacherId) return false;
  if (filters.date && paper.date !== filters.date) return false;
  if (filters.type && paper.examType !== filters.type) return false;
  if (filters.status && paper.status !== filters.status) return false;
  if (filters.query) {
    const haystack = [
      paper.subjectName,
      paper.subjectCode,
      paper.className,
      paper.examName,
      paper.component?.name,
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(filters.query.trim().toLowerCase())) return false;
  }
  return true;
}

function flattenPapers(groups) {
  const list = [];
  groups.forEach((group) => {
    (group.exams ?? []).forEach((exam) => {
      (exam.exam_subjects ?? []).forEach((examSubject) => {
        const components = examSubject.assessment_components ?? [];
        if (resolvedResultKind(exam) === "semester" && components.length > 0) {
          components.forEach((component) => {
            list.push(makePaper(group, exam, examSubject, component));
          });
          return;
        }
        list.push(makePaper(group, exam, examSubject, null));
      });
    });
  });
  return list;
}

function makePaper(group, exam, examSubject, component) {
  const subject = examSubject.subjects ?? {};
  const klass = exam.classes ?? {};
  return {
    key: component?.id ?? examSubject.id,
    group,
    exam,
    examId: exam.id,
    examSubject,
    component,
    subject,
    subjectId: examSubject.subject_id,
    subjectName: subject.name ?? "Subject",
    subjectCode: subject.code ?? "",
    subjectType: subject.subject_type ?? "theory",
    classId: exam.class_id,
    className: klass.name ?? "Class",
    semester: klass.semester ?? null,
    academicYear: klass.academic_year ?? exam.academic_year ?? group.academic_year ?? "",
    examType: group.exam_type,
    examName: group.name,
    componentType: component?.component_type ?? group.exam_type,
    classwork: isClassworkComponent(component),
    conducted: component ? component.is_conducted !== false : true,
    date: component?.exam_date ?? examSubject.exam_date ?? "",
    start: component?.start_time ?? examSubject.start_time ?? "",
    end: component?.end_time ?? examSubject.end_time ?? "",
    duration: component?.duration_minutes ?? examSubject.duration_minutes ?? null,
    room: component?.room ?? examSubject.room ?? "",
    // Only a component paper has its own invigilator. A single-paper exam
    // keeps the subject's assigned teacher, which is the legacy equivalent.
    teacherId: component ? component.teacher_id ?? "" : examSubject.teacher_id ?? "",
    maxMarks: component?.max_marks ?? examSubject.max_marks ?? null,
    weight: component?.weight_percent ?? null,
    status: group.status,
    resultKind: resolvedResultKind(exam),
    submission: (exam.exam_submissions ?? []).find(
      (row) => row.subject_id === examSubject.subject_id,
    ) ?? null,
    sheets: exam.result_sheets ?? [],
  };
}
