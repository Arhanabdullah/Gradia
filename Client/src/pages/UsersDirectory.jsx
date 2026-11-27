import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "../lib/supabase";
import { Button, Card, Empty, Field, Select, StatusChip, inputClass } from "../components/ui";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import AttendanceSummary from "../components/AttendanceSummary";
import { formatAttendance } from "../lib/attendance";

const ROLE_OPTIONS = [
  { value: "student", label: "Students" },
  { value: "teacher", label: "Teachers" },
  { value: "hod", label: "HODs" },
  { value: "principal", label: "Principals" },
  { value: "admin", label: "Admins" },
  { value: "coordinator", label: "Coordinators" },
  { value: "exam_cell", label: "Exam Cell" },
];

const ROLE_LABEL = {
  student: "Student",
  teacher: "Teacher",
  hod: "HOD",
  principal: "Principal",
  admin: "Admin",
  coordinator: "Coordinator",
  exam_cell: "Exam Cell",
};

const PROFILE_SELECT =
  "id, name, username, email, role, student_id, teacher_id, phone, is_active, created_at, " +
  "department_id, degree_id, course_id, class_id, hod_type, hod_subject_id, " +
  "departments ( name ), degrees ( name ), courses ( name ), " +
  "classes!profiles_class_fkey ( id, name, academic_year, semester, section )";

// Older deployments may not have the degree layer yet. The directory keeps
// working without it instead of failing the whole list.
const PROFILE_SELECT_WITHOUT_DEGREE =
  "id, name, username, email, role, student_id, teacher_id, phone, is_active, created_at, " +
  "department_id, course_id, class_id, hod_type, hod_subject_id, " +
  "departments ( name ), courses ( name ), " +
  "classes!profiles_class_fkey ( id, name, academic_year, semester, section )";
const MISSING_RELATION_CODES = new Set(["42P01", "PGRST205"]);

function isMissingRelation(error) {
  if (!error) return false;
  if (MISSING_RELATION_CODES.has(error.code)) return true;
  return /does not exist|schema cache|could not find the table/i.test(error.message ?? "");
}

function firstEmbed(value) {
  return Array.isArray(value) ? value[0] : value;
}

function text(value, fallback = "Not assigned") {
  return value === null || value === undefined || value === "" ? fallback : value;
}

function classText(klass) {
  if (!klass) return "Not assigned";
  const parts = [klass.name];
  if (klass.academic_year) parts.push(klass.academic_year);
  if (klass.semester != null) parts.push(`Sem ${klass.semester}`);
  if (klass.section) parts.push(`Section ${klass.section}`);
  return parts.join(", ");
}

function formatDate(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleDateString("en-GB");
}

const DetailItem = ({ label, value }) => (
  <div>
    <dt className="text-[11px] text-(--muted-foreground)">{label}</dt>
    <dd className="mt-0.5 text-xs text-(--foreground)">{text(value, "Not recorded")}</dd>
  </div>
);

const SectionHeading = ({ title, subtitle }) => (
  <div className="mb-3">
    <p className="text-sm font-medium text-(--foreground)">{title}</p>
    {subtitle ? <p className="mt-0.5 text-xs text-(--muted-foreground)">{subtitle}</p> : null}
  </div>
);

const UsersDirectory = () => {
  const [role, setRole] = useState("student");
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const detailRef = useRef(null);
  const detailRequest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    detailRequest.current += 1;
    setSelected(null);
    setDetail(null);
    setDetailLoading(false);
    setDepartmentFilter("");
    setClassFilter("");
    setStatusFilter("all");

    (async () => {
      let result = await supabase
        .from("profiles")
        .select(PROFILE_SELECT)
        .eq("role", role)
        .order("name");

      if (result.error && /degree|relationship|schema cache/i.test(result.error.message ?? "")) {
        result = await supabase
          .from("profiles")
          .select(PROFILE_SELECT_WITHOUT_DEGREE)
          .eq("role", role)
          .order("name");
      }

      if (cancelled) return;
      if (result.error) setLoadError(result.error.message);
      setUsers(result.data ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [role]);

  useEffect(() => {
    if (selected) detailRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  const departmentOptions = useMemo(() => {
    const names = new Set();
    users.forEach((user) => {
      const department = firstEmbed(user.departments)?.name;
      if (department) names.add(department);
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [users]);

  const classOptions = useMemo(() => {
    const map = new Map();
    users.forEach((user) => {
      const klass = firstEmbed(user.classes);
      if (klass?.id) map.set(klass.id, klass);
    });
    return [...map.values()].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }, [users]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return users.filter((user) => {
      if (statusFilter === "active" && !user.is_active) return false;
      if (statusFilter === "inactive" && user.is_active) return false;

      const department = firstEmbed(user.departments)?.name ?? "";
      if (departmentFilter && department !== departmentFilter) return false;

      if (classFilter && user.class_id !== classFilter) return false;

      if (!needle) return true;
      return [
        user.name,
        user.username,
        user.email,
        user.student_id,
        user.teacher_id,
        department,
        firstEmbed(user.degrees)?.name,
        firstEmbed(user.courses)?.name,
        firstEmbed(user.classes)?.name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [users, search, departmentFilter, classFilter, statusFilter]);

  const openProfile = async (user) => {
    const requestId = detailRequest.current + 1;
    detailRequest.current = requestId;
    setSelected(user);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);

    const next = {
      assignments: [],
      hodClasses: [],
      hodDepartments: [],
      subjects: [],
      subjectTeachers: [],
      attendance: [],
      attendanceAvailable: true,
      resultItems: [],
      marks: [],
      enrollments: [],
    };

    try {
      if (user.role === "student") {
        const classId = user.class_id;
        const [subjectsRes, teachersRes, attendanceRes, resultsRes, marksRes, enrollmentsRes] =
          await Promise.all([
            classId
              ? supabase
                  .from("class_subjects")
                  .select("subject_id, subjects ( id, name, code )")
                  .eq("class_id", classId)
              : Promise.resolve({ data: [], error: null }),
            classId
              ? supabase
                  .from("teacher_assignments")
                  .select("subject_id, teacher_id, profiles!teacher_assignments_teacher_id_fkey(name)")
                  .eq("class_id", classId)
              : Promise.resolve({ data: [], error: null }),
            supabase
              .from("attendance")
              .select(
                "id, subject_id, class_id, academic_year, attended_classes, total_classes, attendance_percentage, subjects ( name, code )",
              )
              .eq("student_id", user.id)
              .order("academic_year", { ascending: false }),
            supabase
              .from("result_items")
              .select(
                "id, sheet_id, subject_id, marks_obtained, max_marks, subjects ( name, code ), result_sheets ( id, status, published_at, exams ( name, academic_year ) )",
              )
              .eq("student_id", user.id),
            supabase
              .from("marks")
              .select(
                "id, exam_id, subject_id, marks_obtained, status, assessment_component_id, assessment_components ( max_marks ), exams ( name, academic_year ), subjects ( name, code, max_marks )",
              )
              .eq("student_id", user.id),
            supabase
              .from("student_enrollments")
              .select("id, class_id, status, enrolled_on, ended_on, classes ( name, academic_year )")
              .eq("student_id", user.id)
              .order("enrolled_on", { ascending: false }),
          ]);

        if (isMissingRelation(attendanceRes.error)) {
          next.attendanceAvailable = false;
        } else if (attendanceRes.error) {
          throw new Error(attendanceRes.error.message);
        }

        const firstError = [subjectsRes, teachersRes, resultsRes, marksRes, enrollmentsRes].find(
          (result) => result.error,
        );
        if (firstError) throw new Error(firstError.error.message);

        next.subjects = subjectsRes.data ?? [];
        next.subjectTeachers = teachersRes.data ?? [];
        next.attendance = attendanceRes.data ?? [];
        next.resultItems = resultsRes.data ?? [];
        next.marks = marksRes.data ?? [];
        next.enrollments = enrollmentsRes.data ?? [];
      } else {
        const [assignmentsRes, hodClassesRes, hodDepartmentsRes] = await Promise.all([
          supabase
            .from("teacher_assignments")
            .select(
              "id, class_id, subject_id, classes ( name, academic_year, semester, section ), subjects ( name, code )",
            )
            .eq("teacher_id", user.id),
          user.role === "hod"
            ? supabase
                .from("class_hod_assignments")
                .select("class_id, classes ( name, academic_year )")
                .eq("hod_id", user.id)
            : Promise.resolve({ data: [], error: null }),
          user.role === "hod"
            ? supabase
                .from("department_hod_assignments")
                .select("department_id, departments ( name )")
                .eq("hod_id", user.id)
            : Promise.resolve({ data: [], error: null }),
        ]);

        const firstError = [assignmentsRes, hodClassesRes, hodDepartmentsRes].find(
          (result) => result.error,
        );
        if (firstError) throw new Error(firstError.error.message);

        next.assignments = assignmentsRes.data ?? [];
        next.hodClasses = hodClassesRes.data ?? [];
        next.hodDepartments = hodDepartmentsRes.data ?? [];
      }

      if (detailRequest.current === requestId) setDetail(next);
    } catch (err) {
      if (detailRequest.current === requestId) setDetailError(err.message);
    } finally {
      if (detailRequest.current === requestId) setDetailLoading(false);
    }
  };

  const performance = useMemo(() => {
    if (!detail) return [];

    const rows =
      detail.resultItems.length > 0
        ? detail.resultItems.map((item) => ({
            subjectId: item.subject_id,
            subject: firstEmbed(item.subjects),
            obtained: Number(item.marks_obtained ?? 0),
            max: Number(item.max_marks ?? 0),
          }))
        : detail.marks.map((mark) => {
            const subject = firstEmbed(mark.subjects);
            const component = firstEmbed(mark.assessment_components);
            return {
              subjectId: mark.subject_id,
              subject,
              obtained: Number(mark.marks_obtained ?? 0),
              max: Number(component?.max_marks ?? subject?.max_marks ?? 0),
            };
          });

    const map = new Map();
    rows.forEach((row) => {
      const key = row.subjectId ?? row.subject?.code ?? row.subject?.name ?? "unknown";
      const current = map.get(key) ?? {
        id: key,
        name: row.subject?.name ?? "Subject",
        code: row.subject?.code ?? "",
        obtained: 0,
        max: 0,
        entries: 0,
      };
      current.obtained += row.obtained;
      current.max += row.max;
      current.entries += 1;
      map.set(key, current);
    });

    return [...map.values()]
      .map((row) => ({
        ...row,
        percentage: row.max > 0 ? Math.round((row.obtained / row.max) * 1000) / 10 : null,
      }))
      .sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name));
  }, [detail]);

  const examGroups = useMemo(() => {
    if (!detail) return [];

    if (detail.resultItems.length > 0) {
      const map = new Map();
      detail.resultItems.forEach((item) => {
        const sheet = firstEmbed(item.result_sheets);
        const key = item.sheet_id ?? sheet?.id ?? "unknown";
        const exam = firstEmbed(sheet?.exams);
        const current = map.get(key) ?? {
          id: key,
          name: exam?.name ?? "Result",
          year: exam?.academic_year ?? "",
          status: sheet?.status ?? "draft",
          publishedAt: sheet?.published_at ?? null,
          rows: [],
        };
        current.rows.push(item);
        map.set(key, current);
      });
      return [...map.values()].sort((a, b) => String(b.publishedAt ?? "").localeCompare(String(a.publishedAt ?? "")));
    }

    const map = new Map();
    detail.marks.forEach((mark) => {
      const key = mark.exam_id ?? "unknown";
      const exam = firstEmbed(mark.exams);
      const current = map.get(key) ?? {
        id: key,
        name: exam?.name ?? "Examination",
        year: exam?.academic_year ?? "",
        status: null,
        publishedAt: null,
        rows: [],
      };
      current.rows.push(mark);
      map.set(key, current);
    });
    return [...map.values()];
  }, [detail]);

  const teacherNames = (subjectId) => {
    if (!detail) return "Not assigned";
    const names = detail.subjectTeachers
      .filter((row) => row.subject_id === subjectId)
      .map((row) => firstEmbed(row.profiles)?.name)
      .filter(Boolean);
    return names.length > 0 ? [...new Set(names)].join(", ") : "Not assigned";
  };

  const renderStudentProfile = () => (
    <>
      <Card className="mt-4">
        <SectionHeading title="Personal information" subtitle="Identity and academic placement." />
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <DetailItem label="Full name" value={selected.name} />
          <DetailItem label="Username" value={selected.username} />
          <DetailItem label="Email" value={selected.email} />
          <DetailItem label="Student ID" value={selected.student_id} />
          <DetailItem label="Phone" value={selected.phone} />
          <DetailItem label="Department" value={firstEmbed(selected.departments)?.name} />
          <DetailItem label="Degree" value={firstEmbed(selected.degrees)?.name} />
          <DetailItem label="Course" value={firstEmbed(selected.courses)?.name} />
          <DetailItem label="Class" value={classText(firstEmbed(selected.classes))} />
          <DetailItem label="Batch" value={firstEmbed(selected.classes)?.academic_year} />
          <DetailItem label="Account status" value={selected.is_active ? "Active" : "Inactive"} />
          <DetailItem label="Joined" value={formatDate(selected.created_at)} />
        </dl>
      </Card>

      <Card className="mt-4">
        <SectionHeading title="Enrolled subjects" subtitle="Subjects offered by the student's class." />
        {detail?.subjects?.length ? (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[28rem] text-left text-xs">
              <thead>
                <tr className="border-b border-(--border-subtle) text-(--muted-foreground)">
                  <th className="py-2 font-medium">Subject</th>
                  <th className="py-2 font-medium">Code</th>
                  <th className="py-2 font-medium">Teacher</th>
                </tr>
              </thead>
              <tbody>
                {detail.subjects.map((row) => {
                  const subject = firstEmbed(row.subjects);
                  return (
                    <tr key={row.subject_id} className="border-b border-(--border-subtle)/60 last:border-b-0">
                      <td className="py-2 text-(--foreground)">{text(subject?.name, "Subject")}</td>
                      <td className="py-2 text-(--muted-foreground)">{text(subject?.code, "n/a")}</td>
                      <td className="py-2 text-(--muted-foreground)">{teacherNames(row.subject_id)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No subjects are linked to this student's class yet.</Empty>
        )}
      </Card>

      <Card className="mt-4">
        <SectionHeading
          title="Subject-wise performance"
          subtitle={detail?.resultItems?.length ? "From published and recorded result sheets." : "From recorded marks where result sheets are not available."}
        />
        {performance.length > 0 ? (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[28rem] text-left text-xs">
              <thead>
                <tr className="border-b border-(--border-subtle) text-(--muted-foreground)">
                  <th className="py-2 font-medium">Subject</th>
                  <th className="py-2 font-medium">Entries</th>
                  <th className="py-2 text-right font-medium">Marks</th>
                  <th className="py-2 text-right font-medium">Maximum</th>
                  <th className="py-2 text-right font-medium">Percentage</th>
                </tr>
              </thead>
              <tbody>
                {performance.map((row) => (
                  <tr key={row.id} className="border-b border-(--border-subtle)/60 last:border-b-0">
                    <td className="py-2 text-(--foreground)">
                      {row.code ? `${row.code}, ` : ""}
                      {row.name}
                    </td>
                    <td className="py-2 text-(--muted-foreground) tabular-nums">{row.entries}</td>
                    <td className="py-2 text-right text-(--foreground) tabular-nums">{row.obtained}</td>
                    <td className="py-2 text-right text-(--muted-foreground) tabular-nums">{row.max}</td>
                    <td className="py-2 text-right font-medium text-(--foreground) tabular-nums">
                      {formatAttendance(row.percentage)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No marks or result items are available for this student.</Empty>
        )}
      </Card>

      <div className="mt-4">
        <SectionHeading title="Attendance" subtitle="Subject-wise and overall attendance." />
        {detail?.attendanceAvailable === false ? (
          <Empty>Attendance records are not available on this deployment yet.</Empty>
        ) : (
          <AttendanceSummary rows={detail?.attendance ?? []} subtitle="All recorded academic years." />
        )}
      </div>

      <Card className="mt-4">
        <SectionHeading title="Examination results" subtitle="Result sheets and recorded marks for this student." />
        {examGroups.length > 0 ? (
          <div className="space-y-4">
            {examGroups.map((group) => {
              const obtained = group.rows.reduce(
                (sum, row) => sum + Number(row.marks_obtained ?? 0),
                0,
              );
              const maximum = group.rows.reduce(
                (sum, row) =>
                  sum +
                  Number(
                    row.max_marks ?? firstEmbed(row.subjects)?.max_marks ?? 0,
                  ),
                0,
              );
              const percentage =
                maximum > 0 ? Math.round((obtained / maximum) * 1000) / 10 : null;
              return (
                <div key={group.id} className="rounded-xl border border-(--border-subtle)">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-(--border-subtle) px-3 py-2">
                    <div>
                      <p className="text-xs font-medium text-(--foreground)">
                        {group.name}
                        {group.year ? `, ${group.year}` : ""}
                      </p>
                      <p className="mt-0.5 text-[11px] text-(--muted-foreground)">
                        {group.publishedAt
                          ? `Published ${formatDate(group.publishedAt)}`
                          : "Recorded marks"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {group.status ? <StatusChip status={group.status} /> : null}
                      <span className="text-xs font-medium text-(--foreground) tabular-nums">
                        {formatAttendance(percentage)}
                      </span>
                    </div>
                  </div>
                  <div className="overflow-x-auto px-3">
                    <table className="w-full min-w-[24rem] text-left text-xs">
                      <thead>
                        <tr className="text-(--muted-foreground)">
                          <th className="py-2 font-medium">Subject</th>
                          <th className="py-2 text-right font-medium">Marks</th>
                          <th className="py-2 text-right font-medium">Maximum</th>
                          <th className="py-2 text-right font-medium">Percentage</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => {
                          const subject = firstEmbed(row.subjects);
                          const max = Number(
                            row.max_marks ?? subject?.max_marks ?? 0,
                          );
                          const value = Number(row.marks_obtained ?? 0);
                          const rowPercentage =
                            max > 0 ? Math.round((value / max) * 1000) / 10 : null;
                          return (
                            <tr key={row.id ?? `${group.id}-${row.subject_id}`} className="border-t border-(--border-subtle)/60">
                              <td className="py-2 text-(--foreground)">
                                {subject?.code ? `${subject.code}, ` : ""}
                                {text(subject?.name, "Subject")}
                              </td>
                              <td className="py-2 text-right text-(--foreground) tabular-nums">{value}</td>
                              <td className="py-2 text-right text-(--muted-foreground) tabular-nums">{max}</td>
                              <td className="py-2 text-right text-(--muted-foreground) tabular-nums">
                                {formatAttendance(rowPercentage)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty>No examination results or marks are available for this student.</Empty>
        )}
      </Card>

      <Card className="mt-4">
        <SectionHeading title="Enrollment history" subtitle="Class placement records." />
        {detail?.enrollments?.length ? (
          <div className="space-y-2">
            {detail.enrollments.map((row) => {
              const klass = firstEmbed(row.classes);
              return (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-(--border-subtle) px-3 py-2 text-xs"
                >
                  <span className="text-(--foreground)">{classText(klass)}</span>
                  <span className="text-(--muted-foreground)">
                    {row.status}, {formatDate(row.enrolled_on)}
                    {row.ended_on ? ` to ${formatDate(row.ended_on)}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty>No enrollment history is available.</Empty>
        )}
      </Card>
    </>
  );

  const renderStaffProfile = () => (
    <>
      <Card className="mt-4">
        <SectionHeading title="Personal information" subtitle="Identity and academic scope." />
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <DetailItem label="Full name" value={selected.name} />
          <DetailItem label="Username" value={selected.username} />
          <DetailItem label="Email" value={selected.email} />
          <DetailItem label="Teacher ID" value={selected.teacher_id} />
          <DetailItem label="Phone" value={selected.phone} />
          <DetailItem label="Role" value={ROLE_LABEL[selected.role] ?? selected.role} />
          <DetailItem label="Department" value={firstEmbed(selected.departments)?.name} />
          <DetailItem label="Degree" value={firstEmbed(selected.degrees)?.name} />
          <DetailItem label="Course" value={firstEmbed(selected.courses)?.name} />
          {selected.role === "hod" ? (
            <DetailItem
              label="HOD category"
              value={selected.hod_type === "subject" ? "Subject HOD" : "Department HOD"}
            />
          ) : null}
          <DetailItem label="Account status" value={selected.is_active ? "Active" : "Inactive"} />
          <DetailItem label="Joined" value={formatDate(selected.created_at)} />
        </dl>
      </Card>

      <Card className="mt-4">
        <SectionHeading title="Allocated classes and subjects" subtitle="Teaching assignments for this account." />
        {detail?.assignments?.length ? (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[28rem] text-left text-xs">
              <thead>
                <tr className="border-b border-(--border-subtle) text-(--muted-foreground)">
                  <th className="py-2 font-medium">Class</th>
                  <th className="py-2 font-medium">Subject</th>
                </tr>
              </thead>
              <tbody>
                {detail.assignments.map((row) => (
                  <tr key={row.id} className="border-b border-(--border-subtle)/60 last:border-b-0">
                    <td className="py-2 text-(--foreground)">{classText(firstEmbed(row.classes))}</td>
                    <td className="py-2 text-(--muted-foreground)">
                      {firstEmbed(row.subjects)?.code
                        ? `${firstEmbed(row.subjects).code}, `
                        : ""}
                      {text(firstEmbed(row.subjects)?.name, "Subject")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No classes or subjects are assigned to this account yet.</Empty>
        )}
      </Card>

      {selected.role === "hod" ? (
        <Card className="mt-4">
          <SectionHeading title="HOD scope" subtitle="Classes and departments this HOD oversees." />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-(--muted-foreground)">Classes</p>
              {detail?.hodClasses?.length ? (
                <ul className="mt-2 space-y-1 text-xs text-(--foreground)">
                  {detail.hodClasses.map((row) => (
                    <li key={row.class_id}>{classText(firstEmbed(row.classes))}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-(--muted-foreground)">No class scope recorded.</p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-(--muted-foreground)">Departments</p>
              {detail?.hodDepartments?.length ? (
                <ul className="mt-2 space-y-1 text-xs text-(--foreground)">
                  {detail.hodDepartments.map((row) => (
                    <li key={row.department_id}>{text(firstEmbed(row.departments)?.name, "Department")}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-(--muted-foreground)">No department scope recorded.</p>
              )}
            </div>
          </div>
        </Card>
      ) : null}
    </>
  );

  return (
    <>
      <DashboardHeader
        title="Users Dashboard"
        subtitle="Browse people by role, filter the list and open a complete profile."
      />

      <Card className="mt-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Role">
            <Select value={role} onChange={(event) => setRole(event.target.value)}>
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Search">
            <input
              className={inputClass}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, email or ID"
            />
          </Field>
          <Field label="Department">
            <Select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
              <option value="">All departments</option>
              {departmentOptions.map((department) => (
                <option key={department} value={department}>{department}</option>
              ))}
            </Select>
          </Field>
          <Field label="Class">
            <Select
              value={classFilter}
              onChange={(event) => setClassFilter(event.target.value)}
              disabled={role !== "student"}
            >
              <option value="">All classes</option>
              {classOptions.map((klass) => (
                <option key={klass.id} value={klass.id}>{classText(klass)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All accounts</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </Select>
          </Field>
        </div>

        <p className="mt-3 text-xs text-(--muted-foreground)">
          Lists and profiles only include people your role is allowed to see.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-(--muted-foreground) tabular-nums">
            {loading ? "Loading accounts" : `${filtered.length} of ${users.length} account${users.length === 1 ? "" : "s"}`}
          </p>
          {search || departmentFilter || classFilter || statusFilter !== "all" ? (
            <Button
              variant="subtle"
              onClick={() => {
                setSearch("");
                setDepartmentFilter("");
                setClassFilter("");
                setStatusFilter("all");
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>

        {loadError ? <p role="alert" className="mt-3 text-xs text-(--danger)">{loadError}</p> : null}
      </Card>

      {selected ? (
        <section ref={detailRef} className="mt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-(--foreground)">{selected.name}</p>
              <p className="mt-0.5 text-xs text-(--muted-foreground)">
                {ROLE_LABEL[selected.role] ?? selected.role}, {selected.email}
              </p>
            </div>
            <Button
              variant="subtle"
              onClick={() => {
                detailRequest.current += 1;
                setSelected(null);
                setDetail(null);
                setDetailError("");
                setDetailLoading(false);
              }}
            >
              Close profile
            </Button>
          </div>

          {detailError ? (
            <p role="alert" className="mt-3 rounded-lg border border-(--danger)/40 bg-(--danger-subtle) px-4 py-3 text-xs text-(--danger)">
              {detailError}
            </p>
          ) : null}

          {detailLoading ? (
            <div className="mt-4 space-y-3" aria-hidden="true">
              <div className="glass-inner h-28 motion-safe:animate-pulse rounded-xl" />
              <div className="glass-inner h-40 motion-safe:animate-pulse rounded-xl" />
            </div>
          ) : selected.role === "student" ? (
            renderStudentProfile()
          ) : (
            renderStaffProfile()
          )}
        </section>
      ) : null}

      <section className="mt-6">
        <div className="space-y-2">
          {loading
            ? Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="glass-inner h-16 motion-safe:animate-pulse rounded-lg" />
              ))
            : null}
          {!loading && filtered.length === 0 ? (
            <Empty>No accounts match the selected role and filters.</Empty>
          ) : null}
          {!loading
            ? (
            <AnimatePresence mode="popLayout" initial={false}>
            {filtered.map((user) => {
                const department = firstEmbed(user.departments)?.name;
                const degree = firstEmbed(user.degrees)?.name;
                const course = firstEmbed(user.courses)?.name;
                const klass = firstEmbed(user.classes);
                return (
                  <motion.div
                    key={user.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    className="glass-inner flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-(--foreground)">
                        {user.name}
                        <span className="text-(--muted-foreground)">, {user.email}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-(--muted-foreground)">
                        {ROLE_LABEL[user.role] ?? user.role}
                        {user.student_id ? `, Student ID: ${user.student_id}` : ""}
                        {user.teacher_id ? `, Teacher ID: ${user.teacher_id}` : ""}
                        {department ? `, ${department}` : ""}
                        {degree ? `, ${degree}` : ""}
                        {course ? `, ${course}` : ""}
                        {klass ? `, ${classText(klass)}` : ""}
                        {!user.is_active ? ", Inactive" : ""}
                      </p>
                    </div>
                    <Button variant="subtle" onClick={() => openProfile(user)}>
                      View profile
                    </Button>
                  </motion.div>
                );
              })
            }
            </AnimatePresence>
            )
            : null}
        </div>
      </section>
    </>
  );
};

export default UsersDirectory;
