import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Button, inputClass } from "../../components/ui";
import DashboardHeader from "../../components/dashboard/DashboardHeader";
import ImportButton from "../../components/import/ImportButton";
import ExamForm from "../../components/exams/ExamForm";
import ExamGroupCard from "../../components/exams/ExamGroupCard";
import { useAuth } from "../../context/AuthContext";
import {
  EXAM_STATUSES,
  EXAM_TYPES,
  batchKey,
  derivedBatch,
  groupHasPendingApproval,
  groupHasPendingMarks,
  groupIsPublished,
  groupTimeBucket,
  teacherLabel,
} from "../../lib/exams";

const GROUP_SELECT = `
  id, name, exam_type, scope, academic_year, starts_on, ends_on, instructions,
  status, created_by, department_id, course_id,
  departments ( id, name ),
  courses ( id, name, degree_id ),
  exams (
    id, class_id, name, academic_year, status, exam_type, starts_on, ends_on,
    classes ( id, name, department, academic_year, semester, section, course_id, degree_id, courses ( id, name, department_id, degree_id ) ),
    exam_subjects (
      id, subject_id, exam_date, start_time, end_time, duration_minutes,
      max_marks, pass_marks, teacher_id, room, instructions, allow_overlap,
      subjects ( id, name, code, max_marks )
    ),
    exam_submissions (
      id, exam_id, subject_id, status, submitted_at, reviewed_at, approved_at, review_remarks
    ),
    result_sheets ( id, status )
  )
`;

const TABS = [
  { id: "all", label: "All" },
  { id: "upcoming", label: "Upcoming" },
  { id: "ongoing", label: "Ongoing" },
  { id: "completed", label: "Completed" },
  { id: "pending_marks", label: "Pending marks entry" },
  { id: "pending_approval", label: "Results pending approval" },
  { id: "published", label: "Published" },
];

const MISSING_RELATION_CODES = new Set(["42P01", "PGRST205"]);

function isMissingRelation(error) {
  if (!error) return false;
  if (MISSING_RELATION_CODES.has(error.code)) return true;
  return /does not exist|schema cache|could not find the table/i.test(error.message ?? "");
}

const EMPTY_FILTERS = {
  query: "",
  type: "",
  status: "",
  year: "",
  department: "",
  degree: "",
  course: "",
  batch: "",
  classId: "",
  subjectId: "",
  teacherId: "",
  date: "",
};

function classesOf(group) {
  return (group.exams ?? []).map((exam) => exam.classes).filter(Boolean);
}

function subjectsOf(group) {
  return (group.exams ?? []).flatMap((exam) => exam.exam_subjects ?? []);
}

function degreeOfClass(klass, courseById) {
  return klass.degree_id ?? courseById.get(klass.course_id)?.degree_id ?? "";
}

function matchesTab(tab, group) {
  if (tab === "all") return true;
  if (tab === "upcoming" || tab === "ongoing" || tab === "completed") {
    return groupTimeBucket(group) === tab;
  }
  if (tab === "published") return groupIsPublished(group);
  if (tab === "pending_approval") return groupHasPendingApproval(group);
  if (tab === "pending_marks") return groupHasPendingMarks(group);
  return true;
}

export default function ManageExams() {
  const { profile } = useAuth();
  const [groups, setGroups] = useState([]);
  const [classes, setClasses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [degrees, setDegrees] = useState([]);
  const [courses, setCourses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [classSubjects, setClassSubjects] = useState([]);
  const [teacherAssignments, setTeacherAssignments] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("all");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    setLoading(true);
    setLoadError("");
    const [groupsRes, classesRes, departmentsRes, degreesRes, coursesRes, subjectsRes, classSubjectsRes, assignmentsRes, teachersRes] =
      await Promise.all([
        supabase.from("exam_groups").select(GROUP_SELECT).order("created_at", { ascending: false }),
        supabase.from("classes").select("id, name, department, academic_year, semester, section, course_id, degree_id").order("name"),
        supabase.from("departments").select("id, name").order("name"),
        supabase.from("degrees").select("id, name").order("name"),
        supabase.from("courses").select("id, name, department_id, degree_id, code").order("name"),
        supabase.from("subjects").select("id, name, code, max_marks, department_id").order("code"),
        supabase.from("class_subjects").select("id, class_id, subject_id"),
        supabase.from("teacher_assignments").select("id, class_id, subject_id, teacher_id"),
        supabase.from("profiles").select("id, name, teacher_id, username").eq("role", "teacher").eq("is_active", true).order("name"),
      ]);

    const failure =
      (degreesRes.error && !isMissingRelation(degreesRes.error) ? degreesRes.error : null) ||
      groupsRes.error ||
      classesRes.error ||
      departmentsRes.error ||
      coursesRes.error ||
      subjectsRes.error ||
      classSubjectsRes.error ||
      assignmentsRes.error ||
      teachersRes.error;

    if (failure) {
      setLoadError("Could not load examinations. Check your connection and refresh the page.");
    }

    setGroups(groupsRes.data ?? []);
    setClasses(classesRes.data ?? []);
    setDepartments(departmentsRes.data ?? []);
    setDegrees(degreesRes.error ? [] : (degreesRes.data ?? []));
    setCourses(coursesRes.data ?? []);
    setSubjects(subjectsRes.data ?? []);
    setClassSubjects(classSubjectsRes.data ?? []);
    setTeacherAssignments(assignmentsRes.data ?? []);
    setTeachers(teachersRes.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const canCreate = profile?.role === "admin" || profile?.role === "teacher";

  const uniqueClasses = useMemo(() => {
    const map = new Map();
    groups.forEach((group) => classesOf(group).forEach((klass) => map.set(klass.id, klass)));
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [groups]);

  const uniqueSubjects = useMemo(() => {
    const map = new Map();
    groups.forEach((group) =>
      subjectsOf(group).forEach((subject) => {
        if (subject.subjects) map.set(subject.subjects.id, subject.subjects);
      }),
    );
    return [...map.values()].sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));
  }, [groups]);

  const courseById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);

  const filterClasses = useMemo(
    () =>
      uniqueClasses.filter(
        (klass) =>
          (!filters.year || klass.academic_year === filters.year) &&
          (!filters.department || courseById.get(klass.course_id)?.department_id === filters.department) &&
          (!filters.degree || degreeOfClass(klass, courseById) === filters.degree) &&
          (!filters.course || klass.course_id === filters.course) &&
          (!filters.batch || batchKey(klass) === filters.batch),
      ),
    [uniqueClasses, filters.year, filters.department, filters.degree, filters.course, filters.batch, courseById],
  );

  const yearOptions = useMemo(
    () => [...new Set(uniqueClasses.map((klass) => klass.academic_year).filter(Boolean))].sort(),
    [uniqueClasses],
  );
  const departmentOptions = useMemo(() => {
    const present = new Set(
      uniqueClasses.map((klass) => courseById.get(klass.course_id)?.department_id).filter(Boolean),
    );
    return departments.filter((department) => present.has(department.id));
  }, [departments, uniqueClasses, courseById]);
  const degreeOptions = useMemo(() => {
    const present = new Set(
      uniqueClasses
        .map((klass) => degreeOfClass(klass, courseById))
        .filter(Boolean),
    );
    return degrees.filter((degree) => present.has(degree.id));
  }, [degrees, uniqueClasses, courseById]);
  const courseOptions = useMemo(
    () =>
      courses.filter(
        (course) =>
          (!filters.department || course.department_id === filters.department) &&
          (!filters.degree || !course.degree_id || course.degree_id === filters.degree) &&
          uniqueClasses.some((klass) => klass.course_id === course.id),
      ),
    [courses, filters.department, filters.degree, uniqueClasses],
  );
  const batchOptions = useMemo(() => {
    const map = new Map();
    filterClasses.forEach((klass) => map.set(batchKey(klass), derivedBatch(klass)));
    return [...map.entries()].map(([value, label]) => ({ value, label }));
  }, [filterClasses]);

  const setFilter = (patch) => setFilters((current) => ({ ...current, ...patch }));
  const resetAfter = (level, value) => {
    if (level === "year") setFilters((current) => ({ ...current, year: value, batch: "", classId: "" }));
    if (level === "department") {
      setFilters((current) => ({ ...current, department: value, degree: "", course: "", batch: "", classId: "" }));
    }
    if (level === "degree") {
      setFilters((current) => ({ ...current, degree: value, course: "", batch: "", classId: "" }));
    }
    if (level === "course") setFilters((current) => ({ ...current, course: value, batch: "", classId: "" }));
    if (level === "batch") setFilters((current) => ({ ...current, batch: value, classId: "" }));
  };

  const visibleGroups = useMemo(
    () =>
      groups.filter((group) => {
        if (!matchesTab(tab, group)) return false;
        const groupClasses = classesOf(group);
        const groupSubjects = subjectsOf(group);

        if (filters.query) {
          const haystack = [
            group.name,
            ...groupClasses.map((klass) => klass.name),
            ...groupSubjects.map((subject) => `${subject.subjects?.code ?? ""} ${subject.subjects?.name ?? ""}`),
          ]
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(filters.query.trim().toLowerCase())) return false;
        }
        if (filters.type && group.exam_type !== filters.type) return false;
        if (filters.status && group.status !== filters.status) return false;
        if (
          filters.year &&
          !(group.academic_year === filters.year || groupClasses.some((klass) => klass.academic_year === filters.year))
        ) {
          return false;
        }
        if (
          filters.department &&
          !(
            group.department_id === filters.department ||
            groupClasses.some((klass) => courseById.get(klass.course_id)?.department_id === filters.department)
          )
        ) {
          return false;
        }
        if (
          filters.degree &&
          !(
            courseById.get(group.course_id)?.degree_id === filters.degree ||
            groupClasses.some((klass) => degreeOfClass(klass, courseById) === filters.degree)
          )
        ) {
          return false;
        }
        if (
          filters.course &&
          !(group.course_id === filters.course || groupClasses.some((klass) => klass.course_id === filters.course))
        ) {
          return false;
        }
        if (filters.batch && !groupClasses.some((klass) => batchKey(klass) === filters.batch)) return false;
        if (filters.classId && !groupClasses.some((klass) => klass.id === filters.classId)) return false;
        if (filters.subjectId && !groupSubjects.some((subject) => subject.subject_id === filters.subjectId)) {
          return false;
        }
        if (filters.teacherId && !groupSubjects.some((subject) => subject.teacher_id === filters.teacherId)) {
          return false;
        }
        if (filters.date) {
          const inRange =
            group.starts_on && group.ends_on && group.starts_on <= filters.date && group.ends_on >= filters.date;
          if (!inRange && !groupSubjects.some((subject) => subject.exam_date === filters.date)) return false;
        }
        return true;
      }),
    [groups, tab, filters, courseById],
  );

  const tabCounts = useMemo(
    () =>
      Object.fromEntries(
        TABS.map((item) => [
          item.id,
          groups.filter((group) => {
            if (!matchesTab(item.id, group)) return false;
            return true;
          }).length,
        ]),
      ),
    [groups],
  );

  const teacherOptions = useMemo(() => {
    const map = new Map(teachers.map((teacher) => [teacher.id, teacher]));
    subjectsOfGroups(groups).forEach((subject) => {
      if (subject.teacher_id && !map.has(subject.teacher_id)) {
        map.set(subject.teacher_id, { id: subject.teacher_id, name: "Assigned teacher" });
      }
    });
    return [...map.values()].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }, [teachers, groups]);

  const title =
    profile?.role === "teacher"
      ? "My examinations"
      : profile?.role === "hod"
        ? "Department examinations"
        : "Examinations";

  const subtitle =
    profile?.role === "teacher"
      ? "Schedule regular tests for your classes, then track marks and approvals."
      : profile?.role === "hod"
        ? "Examinations and marks submissions within your department."
        : "Schedule examinations, subject papers and approvals across the institution.";

  return (
    <>
      <DashboardHeader title={title} subtitle={subtitle} />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-(--muted-foreground)">
          {visibleGroups.length} of {groups.length} examination{groups.length === 1 ? "" : "s"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ImportButton moduleId="exams" onComplete={load} />
          <ImportButton moduleId="exam_subjects" label="Import subject schedules" onComplete={load} />
          {canCreate ? (
            <Button type="button" onClick={() => setShowForm((value) => !value)}>
              {showForm ? "Hide form" : "Schedule examination"}
            </Button>
          ) : null}
        </div>
      </div>

      {notice ? (
        <p role="status" className="mt-3 text-xs text-(--success)">
          {notice}
        </p>
      ) : null}

      {showForm ? (
        <ExamForm
          profile={profile}
          classes={classes}
          departments={departments}
          degrees={degrees}
          courses={courses}
          subjects={subjects}
          classSubjects={classSubjects}
          teacherAssignments={teacherAssignments}
          teachers={teachers}
          onCreated={() => {
            setShowForm(false);
            setNotice("Examination scheduled.");
            load();
          }}
          onCancel={() => setShowForm(false)}
        />
      ) : null}

      <nav aria-label="Examination views" className="mt-6 flex flex-wrap gap-1 border-b border-(--border-subtle) pb-2">
        {TABS.map((item) => (
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
            <span className="ml-1.5 tabular-nums opacity-70">{tabCounts[item.id] ?? 0}</span>
          </button>
        ))}
      </nav>

      <section className="mt-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block sm:col-span-2 lg:col-span-2">
            <span className="text-xs font-medium text-(--muted)">Search</span>
            <input
              className={`${inputClass} mt-1.5`}
              value={filters.query}
              onChange={(event) => setFilter({ query: event.target.value })}
              placeholder="Examination, class, subject"
              type="search"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-(--muted)">Type</span>
            <select
              className={`${inputClass} mt-1.5`}
              value={filters.type}
              onChange={(event) => setFilter({ type: event.target.value })}
            >
              <option value="">Any type</option>
              {EXAM_TYPES.map((type) => (
                <option key={type.id} value={type.id}>{type.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-(--muted)">Status</span>
            <select
              className={`${inputClass} mt-1.5`}
              value={filters.status}
              onChange={(event) => setFilter({ status: event.target.value })}
            >
              <option value="">Any status</option>
              {EXAM_STATUSES.map((status) => (
                <option key={status.id} value={status.id}>{status.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-(--muted)">Academic year</span>
            <select
              className={`${inputClass} mt-1.5`}
              value={filters.year}
              onChange={(event) => resetAfter("year", event.target.value)}
            >
              <option value="">Any year</option>
              {yearOptions.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-(--muted)">Department</span>
            <select
              className={`${inputClass} mt-1.5`}
              value={filters.department}
              onChange={(event) => resetAfter("department", event.target.value)}
            >
              <option value="">Any department</option>
              {departmentOptions.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-(--muted)">Degree</span>
            <select
              className={`${inputClass} mt-1.5`}
              value={filters.degree}
              onChange={(event) => resetAfter("degree", event.target.value)}
            >
              <option value="">Any degree</option>
              {degreeOptions.map((degree) => (
                <option key={degree.id} value={degree.id}>{degree.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-(--muted)">Course</span>
            <select
              className={`${inputClass} mt-1.5`}
              value={filters.course}
              onChange={(event) => resetAfter("course", event.target.value)}
            >
              <option value="">Any course</option>
              {courseOptions.map((course) => (
                <option key={course.id} value={course.id}>{course.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-(--muted)">Batch</span>
            <select
              className={`${inputClass} mt-1.5`}
              value={filters.batch}
              onChange={(event) => resetAfter("batch", event.target.value)}
            >
              <option value="">Any batch</option>
              {batchOptions.map((batch) => (
                <option key={batch.value} value={batch.value}>{batch.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-(--muted)">Class</span>
            <select
              className={`${inputClass} mt-1.5`}
              value={filters.classId}
              onChange={(event) => setFilter({ classId: event.target.value })}
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
              onChange={(event) => setFilter({ subjectId: event.target.value })}
            >
              <option value="">Any subject</option>
              {uniqueSubjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.code ? `${subject.code} ${subject.name}` : subject.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-(--muted)">Teacher</span>
            <select
              className={`${inputClass} mt-1.5`}
              value={filters.teacherId}
              onChange={(event) => setFilter({ teacherId: event.target.value })}
            >
              <option value="">Any teacher</option>
              {teacherOptions.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>{teacherLabel(teacher)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-(--muted)">Paper date</span>
            <input
              type="date"
              className={`${inputClass} mt-1.5`}
              value={filters.date}
              onChange={(event) => setFilter({ date: event.target.value })}
            />
          </label>
          <div className="flex items-end">
            <Button type="button" variant="subtle" onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear filters
            </Button>
          </div>
        </div>
      </section>

      <section className="mt-6 space-y-3">
        {loadError ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-(--danger)/40 px-4 py-4">
            <p className="text-xs text-(--danger)">{loadError}</p>
            <Button type="button" variant="subtle" onClick={load}>Try again</Button>
          </div>
        ) : null}

        {loading
          ? Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="glass-inner h-32 motion-safe:animate-pulse rounded-xl" />
            ))
          : null}

        {!loading && !loadError && visibleGroups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-(--border) px-4 py-8 text-center">
            <p className="text-sm font-medium text-(--foreground)">No examinations match this view.</p>
            <p className="mt-1 text-xs text-(--muted-foreground)">
              {groups.length === 0
                ? "Schedule the first examination to begin."
                : "Clear the filters, choose another tab, or schedule a new examination."}
            </p>
            {canCreate ? (
              <Button type="button" className="mt-4" onClick={() => setShowForm(true)}>
                Schedule examination
              </Button>
            ) : null}
          </div>
        ) : null}

        {!loading &&
          visibleGroups.map((group) => (
            <ExamGroupCard
              key={group.id}
              group={group}
              teachers={teachers}
              degrees={degrees}
              canManage={profile?.role === "admin" || (profile?.role === "teacher" && group.created_by === profile.id)}
              onChanged={load}
              onNotify={setNotice}
            />
          ))}
      </section>
    </>
  );
}

function subjectsOfGroups(groups) {
  return groups.flatMap((group) => subjectsOf(group));
}
