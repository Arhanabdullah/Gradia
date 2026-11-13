import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Button, Card, Empty, Field, SearchField, Select } from "../../components/ui";
import DashboardHeader from "../../components/dashboard/DashboardHeader";
import { canPrintGradeCard, printReportDocument, printResultDocument } from "../../lib/print";
import { resultCodeLabel } from "../../lib/status";
import { isSemesterSheet, resultKindLabel } from "../../lib/exams";

const metric = (value, suffix = "") =>
  value === null || value === undefined ? "Not recorded" : `${value}${suffix}`;

const ResultArchive = () => {
  const [sheets, setSheets] = useState([]);
  const [institution, setInstitution] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [items, setItems] = useState([]);
  const [summaries, setSummaries] = useState([]);
  const [bands, setBands] = useState([]);
  const [schemes, setSchemes] = useState([]);
  const [loadingSheets, setLoadingSheets] = useState(true);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [search, setSearch] = useState("");
  const [examFilter, setExamFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      supabase
        .from("result_sheets")
        .select(
          "id, published_at, result_kind, exam_id, class_id, exams ( name, academic_year ), classes ( name, department, academic_year, semester, section )",
        )
        .eq("status", "published")
        .order("published_at", { ascending: false }),
      supabase
        .from("institution_settings")
        .select("name, short_name, address, email, phone, result_format, default_grading_scheme_id")
        .maybeSingle(),
    ]).then(([sheetsRes, institutionRes]) => {
      setSheets(sheetsRes.data ?? []);
      setInstitution(institutionRes.data ?? null);
      setLoadingSheets(false);
      if (sheetsRes.error) setError(sheetsRes.error.message);
    });
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

  const examOptions = useMemo(() => {
    const map = new Map();
    sheets.forEach((sheet) => {
      if (sheet.exam_id && !map.has(sheet.exam_id)) {
        map.set(sheet.exam_id, sheet.exams?.name ?? "Examination");
      }
    });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [sheets]);

  const classOptions = useMemo(() => {
    const map = new Map();
    sheets.forEach((sheet) => {
      if (sheet.class_id && !map.has(sheet.class_id)) {
        map.set(sheet.class_id, sheet.classes?.name ?? "Class");
      }
    });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [sheets]);

  const visibleSheets = useMemo(
    () =>
      sheets.filter(
        (sheet) =>
          (!examFilter || sheet.exam_id === examFilter) &&
          (!classFilter || sheet.class_id === classFilter),
      ),
    [sheets, examFilter, classFilter],
  );

  useEffect(() => {
    if (!selectedId) {
      setItems([]);
      setSummaries([]);
      return undefined;
    }
    let cancelled = false;
    setLoadingSheet(true);
    setError("");
    Promise.all([
      supabase
        .from("result_items")
        .select(
          "id, sheet_id, student_id, marks_obtained, max_marks, percentage, grade, grade_point, credit_hours, earned_points, result_code, is_withheld, subjects ( name, code ), profiles ( name, username, student_id, registration_no, departments ( name ), degrees ( name ), courses ( name ) )",
        )
        .eq("sheet_id", selectedId),
      supabase
        .from("result_student_summaries")
        .select(
          "student_id, percentage, sgpa, cgpa, overall_grade, is_pass, total_credits, earned_credits, total_grade_points, backlog_count, withheld_count, result_code, promotion_eligible, sgpa_exact, cgpa_exact",
        )
        .eq("sheet_id", selectedId),
    ]).then(([itemsRes, summariesRes]) => {
      if (cancelled) return;
      setItems(itemsRes.data ?? []);
      setSummaries(summariesRes.error ? [] : summariesRes.data ?? []);
      setLoadingSheet(false);
      if (itemsRes.error) setError(itemsRes.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selectedSheet = sheets.find((sheet) => sheet.id === selectedId) ?? null;
  const semesterSheet = isSemesterSheet(selectedSheet);
  const summaryByStudent = useMemo(
    () => new Map(summaries.map((row) => [row.student_id, row])),
    [summaries],
  );

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

  const students = useMemo(() => {
    const map = new Map();
    items.forEach((item) => {
      const student = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles;
      if (!map.has(item.student_id)) {
        map.set(item.student_id, {
          id: item.student_id,
          name: student?.name ?? "Student",
          username: student?.username ?? "",
          student_id: student?.student_id ?? "",
          registration_no: student?.registration_no ?? "",
          department: student?.departments?.name ?? "",
          degree: student?.degrees?.name ?? "",
          course: student?.courses?.name ?? "",
          rows: [],
        });
      }
      map.get(item.student_id).rows.push(item);
    });

    return [...map.values()]
      .map((student) => {
        const summary = summaryByStudent.get(student.id) ?? null;
        const total = student.rows.reduce((sum, row) => sum + Number(row.marks_obtained ?? 0), 0);
        const max = student.rows.reduce((sum, row) => sum + Number(row.max_marks ?? 0), 0);
        const percentage =
          summary?.percentage != null
            ? Number(summary.percentage)
            : max > 0
              ? Math.round((total / max) * 10000) / 100
              : null;
        return { ...student, summary, total, max, percentage };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, summaryByStudent]);

  const needle = search.trim().toLowerCase();
  const visibleStudents = students.filter(
    (student) =>
      !needle ||
      student.name.toLowerCase().includes(needle) ||
      student.username.toLowerCase().includes(needle),
  );

  const printStudent = (student) => {
    if (!selectedSheet) return;
    if (!canPrintGradeCard(selectedSheet)) {
      alert("Only a published semester result can be printed as a grade card.");
      return;
    }
    printResultDocument({
      institution,
      sheet: selectedSheet,
      student: {
        name: student.name,
        username: student.username,
        student_id: student.student_id,
        registration_no: student.registration_no,
        departments: student.department ? { name: student.department } : null,
        degrees: student.degree ? { name: student.degree } : null,
        courses: student.course ? { name: student.course } : null,
        classes: selectedSheet.classes,
      },
      items: student.rows,
      summary: student.summary,
      format: institution?.result_format ?? {},
      bands: referenceBands,
    });
  };

  const printClassSummary = () => {
    if (!selectedSheet) return;
    // SGPA, CGPA, backlogs and promotion only exist for an official semester
    // result; an internal assessment prints just its marks.
    const semesterColumns = ["SGPA", "CGPA", "Backlogs", "Promotion"];
    const columns = [
      "Student",
      "Username",
      "Total",
      "Max",
      "Percentage",
      ...(semesterSheet ? semesterColumns : []),
      "Grade",
      "Result code",
    ];
    printReportDocument({
      institution,
      title: "Published result summary",
      subtitle: [
        selectedSheet.exams?.name ?? "Examination",
        selectedSheet.exams?.academic_year,
        selectedSheet.classes?.name,
        resultKindLabel(selectedSheet.result_kind),
      ]
        .filter(Boolean)
        .join(", "),
      sections: [
        {
          heading: "Student results",
          columns,
          rows: visibleStudents.map((student) => [
            student.name,
            student.username,
            student.total,
            student.max,
            metric(student.percentage, "%"),
            ...(semesterSheet
              ? [
                  metric(student.summary?.sgpa),
                  metric(student.summary?.cgpa),
                  metric(student.summary?.backlog_count),
                  student.summary?.promotion_eligible == null
                    ? "Not recorded"
                    : student.summary.promotion_eligible
                      ? "Eligible"
                      : "Not eligible",
                ]
              : []),
            student.summary?.overall_grade ?? "Not recorded",
            student.summary?.result_code
              ? resultCodeLabel[student.summary.result_code] ?? student.summary.result_code
              : student.summary?.is_pass === false
                ? "Fail"
                : "Pass",
          ]),
        },
      ],
    });
  };

  return (
    <>
      <DashboardHeader
        title="Result archive"
        subtitle="Published results you can review and print. Nothing on this page can be edited."
      />

      <Card className="mt-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Examination">
            <Select
              value={examFilter}
              onChange={(event) => {
                setExamFilter(event.target.value);
                setSelectedId("");
              }}
            >
              <option value="">All examinations</option>
              {examOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Class">
            <Select
              value={classFilter}
              onChange={(event) => {
                setClassFilter(event.target.value);
                setSelectedId("");
              }}
            >
              <option value="">All classes</option>
              {classOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Published sheet">
            <Select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              <option value="">Choose a result sheet</option>
              {visibleSheets.map((sheet) => (
                <option key={sheet.id} value={sheet.id}>
                  {sheet.exams?.name ?? "Examination"}, {sheet.classes?.name ?? "Class"}
                  {sheet.published_at ? ` (${new Date(sheet.published_at).toLocaleDateString()})` : ""}
                  {isSemesterSheet(sheet) ? "" : ", internal"}
                </option>
              ))}
            </Select>
          </Field>
          <SearchField
            label="Search students"
            value={search}
            onChange={setSearch}
            placeholder="Name or username"
          />
        </div>
        {error ? <p role="alert" className="mt-3 text-xs text-(--danger)">{error}</p> : null}
      </Card>

      {loadingSheets ? (
        <div className="mt-6 glass-inner h-32 motion-safe:animate-pulse rounded-xl" aria-hidden="true" />
      ) : sheets.length === 0 ? (
        <div className="mt-6">
          <Empty>No published results yet.</Empty>
        </div>
      ) : !selectedId ? (
        <div className="mt-6">
          <Empty>Choose a published result sheet to view and print it.</Empty>
        </div>
      ) : loadingSheet ? (
        <div className="mt-6 glass-inner h-40 motion-safe:animate-pulse rounded-xl" aria-hidden="true" />
      ) : (
        <Card className="mt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-(--foreground)">
                {selectedSheet?.exams?.name ?? "Result sheet"}, {selectedSheet?.classes?.name ?? "Class"}
              </p>
              <p className="mt-0.5 text-xs text-(--muted-foreground)">
                {selectedSheet?.exams?.academic_year ? `${selectedSheet.exams.academic_year}, ` : ""}
                {resultKindLabel(selectedSheet?.result_kind)}, published{" "}
                {selectedSheet?.published_at ? new Date(selectedSheet.published_at).toLocaleDateString() : "date not recorded"}
              </p>
              {semesterSheet ? null : (
                <p className="mt-1 text-[11px] text-(--muted-foreground)">
                  Internal assessment. No grade card is issued for this sheet.
                </p>
              )}
            </div>
            <Button variant="subtle" onClick={printClassSummary} disabled={visibleStudents.length === 0}>
              Print class summary
            </Button>
          </div>

          {visibleStudents.length === 0 ? (
            <div className="mt-4">
              <Empty>No students match the current search.</Empty>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-(--border-subtle)">
              <table className="min-w-full text-left text-xs tabular-nums">
                <thead className="bg-(--surface-secondary)">
                  <tr className="border-b border-(--border-subtle)">
                    <th className="px-3 py-2 font-medium text-(--muted-foreground)">Student</th>
                    <th className="px-3 py-2 font-medium text-(--muted-foreground)">Total</th>
                    <th className="px-3 py-2 font-medium text-(--muted-foreground)">Percentage</th>
                    {semesterSheet ? (
                      <>
                        <th className="px-3 py-2 font-medium text-(--muted-foreground)">SGPA</th>
                        <th className="px-3 py-2 font-medium text-(--muted-foreground)">CGPA</th>
                      </>
                    ) : null}
                    <th className="px-3 py-2 font-medium text-(--muted-foreground)">Grade</th>
                    <th className="px-3 py-2 font-medium text-(--muted-foreground)">Result code</th>
                    {semesterSheet ? (
                      <th className="px-3 py-2 font-medium text-(--muted-foreground)">Backlogs</th>
                    ) : null}
                    <th className="px-3 py-2 font-medium text-(--muted-foreground)" />
                  </tr>
                </thead>
                <tbody>
                  {visibleStudents.map((student) => (
                    <tr key={student.id} className="border-b border-(--border-subtle)/60 last:border-b-0">
                      <td className="px-3 py-2">
                        <p className="font-medium text-(--foreground)">{student.name}</p>
                        <p className="mt-0.5 text-[11px] text-(--muted-foreground)">{student.username}</p>
                      </td>
                      <td className="px-3 py-2 text-(--foreground)">{student.total} of {student.max}</td>
                      <td className="px-3 py-2 text-(--foreground)">{metric(student.percentage, "%")}</td>
                      {semesterSheet ? (
                        <>
                          <td className="px-3 py-2 text-(--muted-foreground)">{metric(student.summary?.sgpa)}</td>
                          <td className="px-3 py-2 text-(--muted-foreground)">{metric(student.summary?.cgpa)}</td>
                        </>
                      ) : null}
                      <td className="px-3 py-2 text-(--primary)">{student.summary?.overall_grade ?? "Not recorded"}</td>
                      <td className="px-3 py-2 text-(--muted-foreground)">
                        {student.summary?.result_code
                          ? resultCodeLabel[student.summary.result_code] ?? student.summary.result_code
                          : student.summary?.is_pass === false
                            ? "Fail"
                            : "Pass"}
                      </td>
                      {semesterSheet ? (
                        <td className="px-3 py-2 text-(--muted-foreground)">
                          {metric(student.summary?.backlog_count)}
                        </td>
                      ) : null}
                      <td className="px-3 py-2 text-right">
                        {semesterSheet ? (
                          <Button variant="subtle" onClick={() => printStudent(student)}>
                            Print
                          </Button>
                        ) : (
                          <span className="text-[11px] text-(--muted-foreground)">No grade card</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
};

export default ResultArchive;
