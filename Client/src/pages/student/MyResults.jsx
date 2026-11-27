import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { Button } from "../../components/ui";
import { gradeFor, resultCodeLabel } from "../../lib/status";
import { printResultDocument } from "../../lib/print";
import { isSemesterSheet } from "../../lib/exams";
import { numberText } from "../../lib/assessment";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { chartAxis, chartTooltip } from "../../components/charts/ChartsConfig";
import { Card, Empty, StatCard } from "../../components/ui";
import DashboardHeader from "../../components/dashboard/DashboardHeader";

// chartAxis config reused, with the tick size raised to the 11px text floor
const axis = { ...chartAxis, tick: { ...chartAxis.tick, fontSize: 11 } };

const number = (value) => (value === null || value === undefined ? null : Number(value));

const MyResults = () => {
  const { profile } = useAuth();
  const [sheets, setSheets] = useState(null); // published sheets for my class; null = still loading
  const [items, setItems] = useState([]); // my result items across those sheets
  const [summaries, setSummaries] = useState([]); // persisted SGPA/CGPA per sheet
  const [componentItems, setComponentItems] = useState([]); // component snapshot per result item
  const [institution, setInstitution] = useState(null);
  const [bands, setBands] = useState([]);
  const [schemes, setSchemes] = useState([]);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    supabase
      .from("result_sheets")
      .select(
        "id, published_at, result_kind, exams ( name, academic_year ), classes ( name, department, academic_year, semester, section )",
      )
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .then(({ data, error }) => {
        setSheets(data ?? []);
        if (error) setLoadError(`Could not load your results: ${error.message}. Refresh the page and try again.`);
      });
  }, []);

  useEffect(() => {
    supabase
      .from("institution_settings")
      .select("name, short_name, address, email, phone, result_format, default_grading_scheme_id")
      .maybeSingle()
      .then(({ data }) => setInstitution(data ?? null));
  }, []);

  useEffect(() => {
    Promise.all([
      supabase
        .from("grading_schemes")
        .select("id, name, is_default, theory_pass_percent, lab_pass_percent")
        .order("created_at"),
      supabase
        .from("grade_bands")
        .select("scheme_id, label, min_percent, max_percent, grade_point, is_pass, display_order")
        .order("display_order"),
    ]).then(([schemesRes, bandsRes]) => {
      setSchemes(schemesRes.data ?? []);
      setBands(bandsRes.error ? [] : bandsRes.data ?? []);
    });
  }, []);

  useEffect(() => {
    const ids = (sheets ?? []).map((s) => s.id);
    if (ids.length === 0) {
      setItems([]);
      setSummaries([]);
      return;
    }
    if (!profile?.id) return;

    Promise.all([
      supabase
        .from("result_items")
        .select(
          "id, sheet_id, marks_obtained, max_marks, percentage, grade, grade_point, credit_hours, earned_points, result_code, is_withheld, subjects ( name, code )",
        )
        .in("sheet_id", ids)
        .eq("student_id", profile.id)
        .order("sheet_id"),
      supabase
        .from("result_student_summaries")
        .select(
          "sheet_id, percentage, sgpa, cgpa, overall_grade, is_pass, total_credits, earned_credits, total_grade_points, backlog_count, withheld_count, result_code, promotion_eligible, sgpa_exact, cgpa_exact",
        )
        .in("sheet_id", ids)
        .eq("student_id", profile.id),
    ]).then(([itemsRes, summariesRes]) => {
      setItems(itemsRes.data ?? []);
      if (itemsRes.error) {
        setLoadError(`Could not load your marks: ${itemsRes.error.message}. Refresh the page and try again.`);
      }
      // Older deployments may not have the summary table yet; the page still
      // renders from the result items in that case.
      setSummaries(summariesRes.error ? [] : summariesRes.data ?? []);
    });
  }, [sheets, profile?.id]);

  // Component-level snapshot for internal assessments. The database keeps one
  // row per component, so the dashboard can show how a subject mark was built.
  useEffect(() => {
    const ids = items.map((row) => row.id).filter(Boolean);
    if (ids.length === 0) {
      setComponentItems([]);
      return;
    }
    supabase
      .from("result_component_items")
      .select("id, result_item_id, component_name, component_type, max_marks, marks_obtained, status, display_order")
      .in("result_item_id", ids)
      .order("display_order")
      .then(({ data, error: componentError }) => {
        setComponentItems(componentError ? [] : data ?? []);
      });
  }, [items]);

  const summaryBySheet = useMemo(
    () => new Map(summaries.map((row) => [row.sheet_id, row])),
    [summaries],
  );

  const componentsByItem = useMemo(() => {
    const map = new Map();
    componentItems.forEach((row) => {
      const list = map.get(row.result_item_id) ?? [];
      list.push(row);
      map.set(row.result_item_id, list);
    });
    return map;
  }, [componentItems]);

  const activeSchemeId = useMemo(
    () =>
      institution?.default_grading_scheme_id ??
      schemes.find((row) => row.is_default)?.id ??
      schemes[0]?.id ??
      "",
    [institution, schemes],
  );

  const referenceBands = useMemo(
    () => bands.filter((band) => !activeSchemeId || band.scheme_id === activeSchemeId),
    [bands, activeSchemeId],
  );

  const total = useMemo(
    () => items.reduce((sum, i) => sum + Number(i.marks_obtained), 0),
    [items],
  );
  const totalMax = useMemo(
    () => items.reduce((sum, i) => sum + Number(i.max_marks), 0),
    [items],
  );
  const avgPercentage = totalMax > 0 ? Math.round((total / totalMax) * 1000) / 10 : null;

  // SGPA and CGPA belong to official semester results only. An internal
  // assessment never reports them, even though the engine still grades it.
  const latestSemesterSheet = (sheets ?? []).find(isSemesterSheet) ?? null;
  const latestSummary = latestSemesterSheet ? summaryBySheet.get(latestSemesterSheet.id) ?? null : null;
  const latestSgpa = number(latestSummary?.sgpa);
  const latestCgpa = number(latestSummary?.cgpa);

  const chartData = useMemo(
    () =>
      (sheets ?? [])
        .map((sheet, idx) => {
          const mine = items.filter((i) => i.sheet_id === sheet.id);
          const summary = summaryBySheet.get(sheet.id);
          const got = mine.reduce((s, i) => s + Number(i.marks_obtained), 0);
          const max = mine.reduce((s, i) => s + Number(i.max_marks), 0);
          const score =
            summary?.percentage != null
              ? Number(summary.percentage)
              : max > 0
                ? Math.round((got / max) * 1000) / 10
                : 0;
          return {
            exam: sheet.exams?.name ?? `Result ${idx + 1}`,
            score,
          };
        })
        .reverse(),
    [sheets, items, summaryBySheet],
  );

  return (
    <>
      <DashboardHeader title="My Results" subtitle="Published results for your class. Only semester results issue a grade card." />

      {loadError ? (
        <p className="mt-6 rounded-lg border border-(--danger)/40 bg-(--danger-subtle) px-4 py-3 text-xs text-(--danger)">
          {loadError}
        </p>
      ) : sheets === null ? (
        <div className="mt-7 space-y-3" aria-hidden="true">
          <div className="grid gap-3 sm:grid-cols-3">
            {["published", "sgpa", "cgpa"].map((k) => (
              <div key={k} className="glass-inner h-20 motion-safe:animate-pulse rounded-xl" />
            ))}
          </div>
          <div className="glass-inner h-40 motion-safe:animate-pulse rounded-xl" />
        </div>
      ) : (
        <>
      <div className="mt-7 grid gap-3 sm:grid-cols-3">
        <StatCard label="Published results" value={sheets.length} />
        <StatCard label="Latest SGPA" value={latestSgpa !== null ? latestSgpa : "No semester result yet"} />
        <StatCard label="CGPA" value={latestCgpa !== null ? latestCgpa : "No semester result yet"} />
      </div>

      {avgPercentage !== null ? (
        <p className="mt-2 text-xs text-(--muted-foreground)">
          Overall average across published subjects: {avgPercentage}%, grade {gradeFor(avgPercentage)}.
        </p>
      ) : null}

      {chartData.length > 0 && (
        <Card className="mt-4">
          <p className="text-xs font-medium text-(--muted-foreground)">
            Score per exam (%)
          </p>
          <div className="mt-3 h-55 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="exam" {...axis} dy={8} />
                <YAxis {...axis} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} width={55} />
                <Tooltip
                  cursor={{ fill: "color-mix(in srgb, var(--primary) 6%, transparent)" }}
                  {...chartTooltip}
                />
                <Bar dataKey="score" fill="var(--primary)" radius={[6, 6, 0, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <section className="mt-8 space-y-4">
        {sheets.length === 0 && <Empty>No published results yet. You'll be notified when results go live.</Empty>}
        {sheets.map((sheet) => {
          const mine = items.filter((i) => i.sheet_id === sheet.id);
          const summary = summaryBySheet.get(sheet.id) ?? null;
          const got = mine.reduce((s, i) => s + Number(i.marks_obtained), 0);
          const max = mine.reduce((s, i) => s + Number(i.max_marks), 0);
          const pct =
            summary?.percentage != null
              ? Number(summary.percentage)
              : max > 0
                ? Math.round((got / max) * 1000) / 10
                : 0;
          const overallGrade = summary?.overall_grade ?? gradeFor(pct);
          return (
            <Card key={sheet.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-(--foreground)">
                  {sheet.exams?.name}
                  {sheet.exams?.academic_year ? (
                    <span className="ml-2 font-normal text-(--muted-foreground)">{sheet.exams.academic_year}</span>
                  ) : null}
                </p>
                <div className="flex items-center gap-3">
                  <p className="text-xs text-(--muted-foreground)">
                    {isSemesterSheet(sheet) ? "Semester result" : "Internal assessment"}, published{" "}
                    {new Date(sheet.published_at).toLocaleDateString()}
                  </p>
                  {isSemesterSheet(sheet) ? (
                    <Button
                      variant="subtle"
                      onClick={() =>
                        printResultDocument({
                          institution,
                          sheet,
                          student: profile,
                          items: mine,
                          summary,
                          format: institution?.result_format ?? {},
                          bands: referenceBands,
                        })
                      }
                    >
                      Download PDF
                    </Button>
                  ) : (
                    <span className="text-[11px] text-(--muted-foreground)">No grade card</span>
                  )}
                </div>
              </div>

              {summary ? (
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-(--muted-foreground) tabular-nums">
                  <span>Percentage {summary.percentage != null ? `${summary.percentage}%` : "Not recorded"}</span>
                  {isSemesterSheet(sheet) ? (
                    <>
                      <span>SGPA {summary.sgpa != null ? summary.sgpa : "Not configured"}</span>
                      <span>CGPA {summary.cgpa != null ? summary.cgpa : "Not configured"}</span>
                    </>
                  ) : null}
                  <span>Grade {overallGrade}</span>
                  <span>
                    Result{" "}
                    {summary.result_code
                      ? resultCodeLabel[summary.result_code] ?? summary.result_code
                      : summary.is_pass === false
                        ? "Fail"
                        : "Pass"}
                  </span>
                  {isSemesterSheet(sheet) && summary.backlog_count != null ? (
                    <span>Backlogs {summary.backlog_count}</span>
                  ) : null}
                  {isSemesterSheet(sheet) && summary.promotion_eligible != null ? (
                    <span>{summary.promotion_eligible ? "Promotion eligible" : "Not eligible for promotion"}</span>
                  ) : null}
                </p>
              ) : null}

              {!isSemesterSheet(sheet) && mine.length > 0 ? (
                <div className="mt-3 rounded-xl border border-(--border-subtle) px-3 py-2">
                  <p className="text-xs font-medium text-(--muted-foreground)">Component marks</p>
                  <div className="mt-1 space-y-0.5">
                    {mine.map((item) => {
                      const parts = componentsByItem.get(item.id) ?? [];
                      return (
                        <p key={item.id} className="text-[11px] text-(--muted-foreground) tabular-nums">
                          <span className="text-(--foreground)">{item.subjects?.code}</span>{" "}
                          {parts.length > 0
                            ? parts
                                .map(
                                  (part) =>
                                    `${part.component_name} ${numberText(part.marks_obtained)} of ${numberText(part.max_marks)}`,
                                )
                                .join(", ")
                            : "No component marks recorded"}
                        </p>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="-mx-5 overflow-x-auto px-5">
              <table className="mt-3 w-full min-w-[32rem] text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-xs text-(--muted)">
                    <th className="py-1 font-medium">Subject</th>
                    <th className="py-1 font-medium">Credits</th>
                    <th className="py-1 font-medium">Grade</th>
                    <th className="py-1 font-medium">Points</th>
                    <th className="py-1 font-medium">Earned points</th>
                    <th className="py-1 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((i) => {
                    const p =
                      i.percentage != null
                        ? Number(i.percentage)
                        : Number(i.max_marks) > 0
                          ? (Number(i.marks_obtained) / Number(i.max_marks)) * 100
                          : 0;
                    return (
                      <tr key={i.id ?? i.sheet_id + i.subject_id} className="border-t border-(--border-subtle)">
                        <td className="py-1.5 text-(--foreground)">
                          <span className="font-medium">{i.subjects?.code}</span> {i.subjects?.name}
                        </td>
                        <td className="py-1.5 tabular text-(--muted)">{i.credit_hours ?? "Not set"}</td>
                        <td className="py-1.5 text-(--primary)">{i.grade ?? gradeFor(p)}</td>
                        <td className="py-1.5 tabular text-(--muted)">{i.grade_point ?? ""}</td>
                        <td className="py-1.5 tabular text-(--foreground)">{i.earned_points ?? ""}</td>
                        <td className="py-1.5 text-(--muted)">
                          {i.result_code ? resultCodeLabel[i.result_code] ?? i.result_code : ""}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-(--border)">
                    <td className="py-2 text-(--foreground)">Total</td>
                    <td className="py-2 tabular text-(--muted)">
                      {summary?.total_credits != null ? summary.total_credits : ""}
                    </td>
                    <td className="py-2 font-medium text-(--primary)">{overallGrade}</td>
                    <td className="py-2 tabular text-(--muted)" />
                    <td className="py-2 tabular font-medium text-(--foreground)">
                      {summary?.total_grade_points != null ? summary.total_grade_points : ""}
                    </td>
                    <td className="py-2 text-(--muted)">
                      {summary?.result_code
                        ? resultCodeLabel[summary.result_code] ?? summary.result_code
                        : ""}
                    </td>
                  </tr>
                </tbody>
              </table>
              </div>
            </Card>
          );
        })}
        </section>
        </>
      )}
    </>
  );
};

export default MyResults;
