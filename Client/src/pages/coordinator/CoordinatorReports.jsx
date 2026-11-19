import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { callRpc } from "../../lib/db";
import { Button, Card, Empty, Field, SearchField, Select, StatCard } from "../../components/ui";
import DashboardHeader from "../../components/dashboard/DashboardHeader";
import { printReportDocument } from "../../lib/print";

const metric = (value, suffix = "") =>
  value === null || value === undefined ? "Not recorded" : `${value}${suffix}`;

const classLabel = (row) => {
  const parts = [row.name];
  if (row.academic_year) parts.push(row.academic_year);
  if (row.semester != null) parts.push(`Sem ${row.semester}`);
  if (row.section) parts.push(`Section ${row.section}`);
  return parts.join(", ");
};

const ReportTable = ({ columns, rows, empty }) => {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto rounded-xl border border-(--border-subtle)">
      <table className="min-w-full text-left text-xs tabular-nums">
        <thead className="bg-(--surface-secondary)">
          <tr className="border-b border-(--border-subtle)">
            {columns.map((column) => (
              <th
                key={column.key}
                className={`px-3 py-2 font-medium text-(--muted-foreground) ${column.align === "right" ? "text-right" : ""}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? index} className="border-b border-(--border-subtle)/60 last:border-b-0">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-3 py-2 text-(--foreground) ${column.align === "right" ? "text-right" : ""}`}
                >
                  {column.render ? column.render(row) : row[column.key] ?? "Not recorded"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const CoordinatorReports = () => {
  const [report, setReport] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [classes, setClasses] = useState([]);
  const [exams, setExams] = useState([]);
  const [institution, setInstitution] = useState(null);

  const [department, setDepartment] = useState("");
  const [classId, setClassId] = useState("");
  const [examId, setExamId] = useState("");
  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      supabase.from("departments").select("id, name").order("name"),
      supabase
        .from("classes")
        .select("id, name, department, academic_year, semester, section")
        .order("name"),
      supabase
        .from("exams")
        .select("id, name, academic_year, class_id, classes ( name )")
        .order("created_at", { ascending: false }),
      supabase
        .from("institution_settings")
        .select("name, short_name, address, email, phone")
        .maybeSingle(),
    ]).then(([departmentsRes, classesRes, examsRes, institutionRes]) => {
      setDepartments(departmentsRes.data ?? []);
      setClasses(classesRes.data ?? []);
      setExams(examsRes.data ?? []);
      setInstitution(institutionRes.data ?? null);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    callRpc("coordinator_monitoring_report", {
      p_department: department || null,
      p_class_id: classId || null,
      p_exam_id: examId || null,
    })
      .then((data) => {
        if (!cancelled) setReport(data ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [department, classId, examId]);

  const departmentOptions = useMemo(() => {
    const names = new Set(departments.map((row) => row.name));
    classes.forEach((row) => {
      if (row.department) names.add(row.department);
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [departments, classes]);

  const classOptions = useMemo(
    () => classes.filter((row) => !department || row.department === department),
    [classes, department],
  );

  const examOptions = useMemo(
    () => exams.filter((row) => !classId || row.class_id === classId),
    [exams, classId],
  );

  const needle = search.trim().toLowerCase();
  const matches = (...values) =>
    !needle || values.filter(Boolean).some((value) => String(value).toLowerCase().includes(needle));

  const classRows = useMemo(
    () => (report?.classes ?? []).filter((row) => matches(row.name, row.department)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [report, needle],
  );

  const departmentRows = useMemo(
    () => (report?.departments ?? []).filter((row) => matches(row.department)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [report, needle],
  );

  const subjectRows = useMemo(
    () => (report?.subjects ?? []).filter((row) => matches(row.name, row.code, row.department)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [report, needle],
  );

  const totals = report?.totals ?? null;

  const print = () => {
    printReportDocument({
      institution,
      title: "Institution monitoring report",
      subtitle: [
        department || "All departments",
        classId ? classLabel(classes.find((row) => row.id === classId) ?? {}) : "All classes",
        examId ? exams.find((row) => row.id === examId)?.name ?? "Selected examination" : "All published examinations",
      ].join(", "),
      sections: [
        {
          heading: "Department performance",
          columns: ["Department", "Classes", "Students", "Subject offerings", "Average %", "Pass rate", "Attendance"],
          rows: departmentRows.map((row) => [
            row.department,
            row.classes,
            row.students,
            row.subject_offerings,
            metric(row.average_percentage, "%"),
            metric(row.pass_rate, "%"),
            metric(row.attendance_percentage, "%"),
          ]),
        },
        {
          heading: "Class performance",
          columns: ["Class", "Department", "Students", "Subject offerings", "Average %", "Pass rate", "Attendance"],
          rows: classRows.map((row) => [
            classLabel(row),
            row.department,
            row.students,
            row.subject_offerings,
            metric(row.average_percentage, "%"),
            metric(row.pass_rate, "%"),
            metric(row.attendance_percentage, "%"),
          ]),
        },
        {
          heading: "Subject performance",
          columns: ["Code", "Subject", "Department", "Result entries", "Average %", "Pass rate", "Attendance"],
          rows: subjectRows.map((row) => [
            row.code,
            row.name,
            row.department,
            row.entries,
            metric(row.average_percentage, "%"),
            metric(row.pass_rate, "%"),
            metric(row.attendance_percentage, "%"),
          ]),
        },
      ],
    });
  };

  return (
    <>
      <DashboardHeader
        title="Monitoring"
        subtitle="Read-only view across departments, classes, subjects, results and attendance."
      />

      <Card className="mt-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Department">
            <Select
              value={department}
              onChange={(event) => {
                setDepartment(event.target.value);
                setClassId("");
              }}
            >
              <option value="">All departments</option>
              {departmentOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Class">
            <Select value={classId} onChange={(event) => setClassId(event.target.value)}>
              <option value="">All classes</option>
              {classOptions.map((row) => (
                <option key={row.id} value={row.id}>{classLabel(row)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Examination">
            <Select value={examId} onChange={(event) => setExamId(event.target.value)}>
              <option value="">All published examinations</option>
              {examOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                  {row.academic_year ? ` (${row.academic_year})` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <SearchField
            label="Search"
            value={search}
            onChange={setSearch}
            placeholder="Department, class or subject"
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-(--muted-foreground)">
            Coordinator access is read-only. Use the print action for a signed monitoring report.
          </p>
          <Button variant="subtle" onClick={print} disabled={!report || loading}>
            Print report
          </Button>
        </div>
        {error ? <p role="alert" className="mt-3 text-xs text-(--danger)">{error}</p> : null}
      </Card>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Students" value={totals?.students ?? "…"} />
        <StatCard label="Teachers" value={totals?.teachers ?? "…"} />
        <StatCard label="Classes" value={totals?.classes ?? "…"} />
        <StatCard label="Subjects" value={totals?.subjects ?? "…"} />
        <StatCard label="Published result sheets" value={totals?.published_sheets ?? "…"} />
        <StatCard label="Attendance records" value={totals?.attendance_records ?? "…"} />
      </div>

      {loading && !report ? (
        <div className="mt-6 space-y-3" aria-hidden="true">
          {[0, 1, 2].map((key) => (
            <div key={key} className="glass-inner h-32 motion-safe:animate-pulse rounded-xl" />
          ))}
        </div>
      ) : null}

      {report ? (
        <>
          <section className="mt-8">
            <p className="text-xs font-medium text-(--muted-foreground)">Department performance</p>
            <div className="mt-3">
              <ReportTable
                columns={[
                  { key: "department", label: "Department" },
                  { key: "classes", label: "Classes", align: "right" },
                  { key: "students", label: "Students", align: "right" },
                  { key: "subject_offerings", label: "Subject offerings", align: "right" },
                  {
                    key: "average_percentage",
                    label: "Average",
                    align: "right",
                    render: (row) => metric(row.average_percentage, "%"),
                  },
                  {
                    key: "pass_rate",
                    label: "Pass rate",
                    align: "right",
                    render: (row) => metric(row.pass_rate, "%"),
                  },
                  {
                    key: "attendance_percentage",
                    label: "Attendance",
                    align: "right",
                    render: (row) => metric(row.attendance_percentage, "%"),
                  },
                ]}
                rows={departmentRows}
                empty="No department data matches the current filters."
              />
            </div>
          </section>

          <section className="mt-8">
            <p className="text-xs font-medium text-(--muted-foreground)">Class performance</p>
            <div className="mt-3">
              <ReportTable
                columns={[
                  { key: "name", label: "Class", render: (row) => classLabel(row) },
                  { key: "department", label: "Department" },
                  { key: "students", label: "Students", align: "right" },
                  { key: "subject_offerings", label: "Subject offerings", align: "right" },
                  {
                    key: "average_percentage",
                    label: "Average",
                    align: "right",
                    render: (row) => metric(row.average_percentage, "%"),
                  },
                  {
                    key: "pass_rate",
                    label: "Pass rate",
                    align: "right",
                    render: (row) => metric(row.pass_rate, "%"),
                  },
                  {
                    key: "attendance_percentage",
                    label: "Attendance",
                    align: "right",
                    render: (row) => metric(row.attendance_percentage, "%"),
                  },
                ]}
                rows={classRows}
                empty="No classes match the current filters."
              />
            </div>
          </section>

          <section className="mt-8">
            <p className="text-xs font-medium text-(--muted-foreground)">Subject performance</p>
            <div className="mt-3">
              <ReportTable
                columns={[
                  { key: "code", label: "Code" },
                  { key: "name", label: "Subject" },
                  { key: "department", label: "Department" },
                  { key: "entries", label: "Result entries", align: "right" },
                  {
                    key: "average_percentage",
                    label: "Average",
                    align: "right",
                    render: (row) => metric(row.average_percentage, "%"),
                  },
                  {
                    key: "pass_rate",
                    label: "Pass rate",
                    align: "right",
                    render: (row) => metric(row.pass_rate, "%"),
                  },
                  {
                    key: "attendance_percentage",
                    label: "Attendance",
                    align: "right",
                    render: (row) => metric(row.attendance_percentage, "%"),
                  },
                ]}
                rows={subjectRows}
                empty="No subjects match the current filters."
              />
            </div>
          </section>
        </>
      ) : null}
    </>
  );
};

export default CoordinatorReports;
