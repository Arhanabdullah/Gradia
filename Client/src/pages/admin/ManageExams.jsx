import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Button, inputClass } from "../../components/ui";
import DashboardHeader from "../../components/dashboard/DashboardHeader";
import ImportButton from "../../components/import/ImportButton";
import ClassExamScheduler from "../../components/exams/ClassExamScheduler";
import ExamRecordsTable from "../../components/exams/ExamRecordsTable";
import ExamWorkspace from "../../components/exams/ExamWorkspace";
import PaperScheduleDialog from "../../components/exams/PaperScheduleDialog";
import { useAuth } from "../../context/AuthContext";
import { callRpc } from "../../lib/db";
import {
  ACTIVITY_TYPES,
  EXAM_STATUSES,
  batchKey,
  derivedBatch,
  flattenPapers,
  groupIsPublished,
  paperMatchesFilters,
  paperMatchesTab,
  teacherLabel,
} from "../../lib/exams";

// `schedule_mode` arrives with 202611180001. Until that migration is applied the
// column is absent, so the queries retry without it and the client falls back to
// inferring classwork from the component code (see lib/exams.js).
const groupSelect = (withScheduleMode = true) => `
  id, name, exam_type, scope, academic_year, starts_on, ends_on, instructions,
  status, created_by, department_id, course_id,
  departments ( id, name ),
  courses ( id, name, degree_id ),
  exams (
    id, class_id, name, academic_year, status, exam_type, result_kind, starts_on, ends_on,
    classes ( id, name, department, academic_year, semester, section, course_id, degree_id, courses ( id, name, department_id, degree_id ) ),
    exam_subjects (
      id, subject_id, assessment_template_id, exam_date, start_time, end_time, duration_minutes,
      max_marks, pass_marks, teacher_id, room, instructions, allow_overlap,
      subjects ( id, name, code, max_marks, subject_type, assessment_template_id ),
      assessment_components (
        id, exam_subject_id, name, code, component_type, max_marks, pass_marks,
        weight_percent, aggregation, group_code, scale_from, scale_to, display_order,
        is_optional, is_external, is_conducted, ${withScheduleMode ? "schedule_mode, " : ""}exam_date, start_time, end_time,
        duration_minutes, room, teacher_id, allow_overlap
      )
    ),
    exam_submissions (
      id, exam_id, subject_id, status, submitted_at, reviewed_at, approved_at, review_remarks
    ),
    result_sheets ( id, status, result_kind )
  )
`;

const templateComponentSelect = (withScheduleMode = true) =>
  `id, template_id, name, code, component_type, max_marks, weight_percent, aggregation, group_code, scale_from, scale_to, display_order, is_optional, is_external${
    withScheduleMode ? ", schedule_mode" : ""
  }`;

// Retries a select without `schedule_mode` when the column does not exist yet.
async function selectWithScheduleModeFallback(makeQuery) {
  const first = await makeQuery(true);
  if (first.error && /schedule_mode/i.test(first.error.message ?? "")) {
    return makeQuery(false);
  }
  return first;
}

const TABS = [
  { id: "all", label: "All" },
  { id: "upcoming", label: "Upcoming" },
  { id: "ongoing", label: "Ongoing" },
  { id: "completed", label: "Completed" },
  { id: "pending_marks", label: "Pending marks entry" },
  { id: "pending_publication", label: "Results pending publication" },
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
  semester: "",
  subjectId: "",
  teacherId: "",
  date: "",
};

// The academic dropdowns cascade in the order the page shows them, so each
// level only lists values that still have a class behind it.
const FILTER_CHILDREN = {
  degree: ["department", "course", "year", "batch", "classId", "semester", "subjectId", "teacherId"],
  department: ["course", "year", "batch", "classId", "semester", "subjectId", "teacherId"],
  course: ["year", "batch", "classId", "semester", "subjectId", "teacherId"],
  year: ["batch", "classId", "semester", "subjectId", "teacherId"],
  batch: ["classId", "semester", "subjectId", "teacherId"],
  classId: ["semester", "subjectId", "teacherId"],
  semester: ["subjectId", "teacherId"],
  subjectId: ["teacherId"],
};

function degreeOfClass(klass, courseById) {
  return klass.degree_id ?? courseById.get(klass.course_id)?.degree_id ?? "";
}

function departmentOfClass(klass, courseById) {
  return courseById.get(klass.course_id)?.department_id ?? "";
}

export default function ManageExams() {
  const { profile } = useAuth();
  const [groups, setGroups] = useState([]);
  const [classes, setClasses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [degrees, setDegrees] = useState([]);
  const [courses, setCourses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [templateComponents, setTemplateComponents] = useState([]);
  const [classSubjects, setClassSubjects] = useState([]);
  const [teacherAssignments, setTeacherAssignments] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("all");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showForm, setShowForm] = useState(false);
  const [editGroup, setEditGroup] = useState(null);
  const [dialogPaper, setDialogPaper] = useState(null);

  const load = async () => {
    setLoading(true);
    setLoadError("");
    const [groupsRes, classesRes, departmentsRes, degreesRes, coursesRes, subjectsRes, classSubjectsRes, assignmentsRes, teachersRes, templatesRes, templateComponentsRes] =
      await Promise.all([
        selectWithScheduleModeFallback((withMode) =>
          supabase.from("exam_groups").select(groupSelect(withMode)).order("created_at", { ascending: false }),
        ),
        supabase.from("classes").select("id, name, department, academic_year, semester, section, course_id, degree_id").order("name"),
        supabase.from("departments").select("id, name").order("name"),
        supabase.from("degrees").select("id, name").order("name"),
        supabase.from("courses").select("id, name, department_id, degree_id, code").order("name"),
        supabase.from("subjects").select("id, name, code, max_marks, credit_hours, department_id, subject_type, assessment_template_id").order("code"),
        supabase.from("class_subjects").select("id, class_id, subject_id"),
        supabase.from("teacher_assignments").select("id, class_id, subject_id, teacher_id"),
        supabase.from("profiles").select("id, name, teacher_id, username").eq("role", "teacher").eq("is_active", true).order("name"),
        supabase.from("assessment_templates").select("id, name, subject_type, mode, total_marks, is_default, is_active, created_at").order("created_at"),
        selectWithScheduleModeFallback((withMode) =>
          supabase.from("assessment_template_components").select(templateComponentSelect(withMode)).order("display_order"),
        ),
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
    setTemplates(templatesRes.error ? [] : (templatesRes.data ?? []));
    setTemplateComponents(templateComponentsRes.error ? [] : (templateComponentsRes.data ?? []));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  // A paper or subject change is fully reflected in the `exam_groups` query, so
  // refresh just that one instead of re-running the full eleven-query load. The
  // table stays on screen while it runs, which avoids the skeleton flash after
  // every save.
  const refreshGroups = async () => {
    const { data, error } = await selectWithScheduleModeFallback((withMode) =>
      supabase.from("exam_groups").select(groupSelect(withMode)).order("created_at", { ascending: false }),
    );
    if (error) {
      setLoadError("Could not refresh examinations. Check your connection and refresh the page.");
      return;
    }
    setLoadError("");
    setGroups(data ?? []);
  };

  const canCreate =
    profile?.role === "admin" || profile?.role === "teacher" || profile?.role === "exam_cell";

  const canManageGroup = (group) =>
    Boolean(group) &&
    (profile?.role === "admin" ||
      profile?.role === "exam_cell" ||
      (profile?.role === "teacher" && group.created_by === profile?.id));

  const canDeleteGroup = (group) => Boolean(group) && profile?.role === "admin" && !groupIsPublished(group);

  const courseById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);

  const papers = useMemo(() => flattenPapers(groups), [groups]);

  const uniqueSubjects = useMemo(() => {
    const map = new Map();
    papers.forEach((paper) => map.set(paper.subjectId, paper.subject));
    return [...map.values()].sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));
  }, [papers]);

  const teacherOptions = useMemo(() => {
    const map = new Map(teachers.map((teacher) => [teacher.id, teacher]));
    papers.forEach((paper) => {
      if (paper.teacherId && !map.has(paper.teacherId)) {
        map.set(paper.teacherId, { id: paper.teacherId, name: "Assigned teacher" });
      }
    });
    return [...map.values()].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }, [teachers, papers]);

  // Each level filters the classes that are still eligible for the next level.
  const classesForDegree = useMemo(
    () => classes.filter((klass) => !filters.degree || degreeOfClass(klass, courseById) === filters.degree),
    [classes, filters.degree, courseById],
  );
  const classesForDepartment = useMemo(
    () => classesForDegree.filter((klass) => !filters.department || departmentOfClass(klass, courseById) === filters.department),
    [classesForDegree, filters.department, courseById],
  );
  const classesForCourse = useMemo(
    () => classesForDepartment.filter((klass) => !filters.course || klass.course_id === filters.course),
    [classesForDepartment, filters.course],
  );
  const classesForYear = useMemo(
    () => classesForCourse.filter((klass) => !filters.year || klass.academic_year === filters.year),
    [classesForCourse, filters.year],
  );
  const classesForBatch = useMemo(
    () => classesForYear.filter((klass) => !filters.batch || batchKey(klass) === filters.batch),
    [classesForYear, filters.batch],
  );
  const classesForClass = useMemo(
    () => classesForBatch.filter((klass) => !filters.classId || klass.id === filters.classId),
    [classesForBatch, filters.classId],
  );

  const degreeOptions = useMemo(() => {
    const present = new Set(classes.map((klass) => degreeOfClass(klass, courseById)).filter(Boolean));
    return degrees.filter((degree) => present.has(degree.id));
  }, [degrees, classes, courseById]);

  const departmentOptions = useMemo(() => {
    const present = new Set(classesForDegree.map((klass) => departmentOfClass(klass, courseById)).filter(Boolean));
    return departments.filter((department) => present.has(department.id));
  }, [departments, classesForDegree, courseById]);

  const courseOptions = useMemo(() => {
    const present = new Set(classesForDepartment.map((klass) => klass.course_id).filter(Boolean));
    return courses.filter((course) => present.has(course.id));
  }, [courses, classesForDepartment]);

  const yearOptions = useMemo(
    () => [...new Set(classesForCourse.map((klass) => klass.academic_year).filter(Boolean))].sort(),
    [classesForCourse],
  );

  const batchOptions = useMemo(() => {
    const map = new Map();
    classesForYear.forEach((klass) => map.set(batchKey(klass), derivedBatch(klass)));
    return [...map.entries()].map(([value, label]) => ({ value, label }));
  }, [classesForYear]);

  const classOptions = useMemo(
    () =>
      [...classesForBatch].sort((a, b) =>
        `${a.name ?? ""} ${derivedBatch(a)}`.localeCompare(`${b.name ?? ""} ${derivedBatch(b)}`),
      ),
    [classesForBatch],
  );

  const semesterOptions = useMemo(
    () =>
      [...new Set(classesForClass.map((klass) => klass.semester).filter((value) => value != null))]
        .map(String)
        .sort((a, b) => Number(a) - Number(b)),
    [classesForClass],
  );

  const subjectOptions = useMemo(() => {
    if (!filters.classId) return uniqueSubjects;
    const offered = new Set(
      classSubjects.filter((row) => row.class_id === filters.classId).map((row) => row.subject_id),
    );
    return uniqueSubjects.filter((subject) => offered.has(subject.id));
  }, [uniqueSubjects, classSubjects, filters.classId]);

  const setFilter = (patch) => setFilters((current) => ({ ...current, ...patch }));
  const resetAfter = (level, value) => {
    setFilters((current) => {
      const next = { ...current, [level]: value };
      (FILTER_CHILDREN[level] ?? []).forEach((key) => {
        next[key] = "";
      });
      return next;
    });
  };

  const visiblePapers = useMemo(
    () =>
      papers.filter(
        (paper) => paperMatchesTab(paper, tab) && paperMatchesFilters(paper, filters),
      ),
    [papers, tab, filters],
  );

  const tabCounts = useMemo(
    () =>
      Object.fromEntries(
        TABS.map((item) => [
          item.id,
          papers.filter((paper) => paperMatchesTab(paper, item.id) && paperMatchesFilters(paper, filters)).length,
        ]),
      ),
    [papers, filters],
  );

  const deleteExamination = async (paper) => {
    const group = paper.group;
    const subjectIds = [
      ...new Set(
        (group.exams ?? []).flatMap((exam) =>
          (exam.exam_subjects ?? []).map((examSubject) => examSubject.id),
        ),
      ),
    ];
    setLoadError("");
    try {
      // The subject RPC refuses published results and existing marks, so the
      // remaining deletes only run once the record is safe to remove.
      for (const examSubjectId of subjectIds) {
        await callRpc("remove_exam_subject", { p_exam_subject_id: examSubjectId });
      }
      const { error: examError } = await supabase.from("exams").delete().eq("exam_group_id", group.id);
      if (examError) throw new Error(examError.message);
      const { error: groupError } = await supabase.from("exam_groups").delete().eq("id", group.id);
      if (groupError) throw new Error(groupError.message);
      setNotice(`Deleted "${group.name}".`);
      await refreshGroups();
    } catch (err) {
      setLoadError(err?.message ?? "Could not delete this examination.");
    }
  };

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

      <section className="mt-5" aria-label="Examination filters">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
              onChange={(event) => resetAfter("classId", event.target.value)}
            >
              <option value="">Any class</option>
              {classOptions.map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.name}, {derivedBatch(klass)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-(--muted)">Semester</span>
            <select
              className={`${inputClass} mt-1.5`}
              value={filters.semester}
              onChange={(event) => resetAfter("semester", event.target.value)}
            >
              <option value="">Any semester</option>
              {semesterOptions.map((semester) => (
                <option key={semester} value={semester}>Semester {semester}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-(--muted)">Subject</span>
            <select
              className={`${inputClass} mt-1.5`}
              value={filters.subjectId}
              onChange={(event) => resetAfter("subjectId", event.target.value)}
            >
              <option value="">Any subject</option>
              {subjectOptions.map((subject) => (
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
            <span className="text-xs font-medium text-(--muted)">Examination type</span>
            <select
              className={`${inputClass} mt-1.5`}
              value={filters.type}
              onChange={(event) => setFilter({ type: event.target.value })}
            >
              <option value="">Any type</option>
              {ACTIVITY_TYPES.map((type) => (
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
            <span className="text-xs font-medium text-(--muted)">Paper date</span>
            <input
              type="date"
              className={`${inputClass} mt-1.5`}
              value={filters.date}
              onChange={(event) => setFilter({ date: event.target.value })}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-(--muted)">Search</span>
            <input
              className={`${inputClass} mt-1.5`}
              value={filters.query}
              onChange={(event) => setFilter({ query: event.target.value })}
              placeholder="Examination, subject, class, course"
              type="search"
            />
          </label>
          <div className="flex items-end">
            <Button type="button" variant="subtle" onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear filters
            </Button>
          </div>
        </div>
      </section>

      <ExamWorkspace
        profile={profile}
        groups={groups}
        filters={filters}
        teachers={teachers}
        teacherAssignments={teacherAssignments}
        loading={loading}
        loadError={loadError}
        onChanged={refreshGroups}
        onNotify={setNotice}
      />

      <div className="mt-8 border-t border-(--border-subtle) pt-6">
        <h3 className="text-sm font-semibold tracking-tight text-(--foreground)">All examination records</h3>
        <p className="mt-1 text-xs text-(--muted-foreground)">
          Filter, import and edit every scheduled paper, including subjects and assessment components.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-(--muted-foreground)">
          {visiblePapers.length} of {papers.length} paper{papers.length === 1 ? "" : "s"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ImportButton moduleId="exams" onComplete={load} />
          <ImportButton moduleId="exam_subjects" label="Import subject schedules" onComplete={load} />
          {canCreate ? (
            <Button
              type="button"
              onClick={() => {
                setEditGroup(null);
                setShowForm((value) => !value);
              }}
            >
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

      {showForm || editGroup ? (
        <ClassExamScheduler
          key={editGroup?.id ?? "new"}
          mode={editGroup ? "edit" : "create"}
          group={editGroup}
          groups={groups}
          profile={profile}
          classes={classes}
          departments={departments}
          degrees={degrees}
          courses={courses}
          subjects={subjects}
          classSubjects={classSubjects}
          teacherAssignments={teacherAssignments}
          teachers={teachers}
          templates={templates}
          templateComponents={templateComponents}
          onSaved={() => {
            const wasEditing = Boolean(editGroup);
            setShowForm(false);
            setEditGroup(null);
            setNotice(wasEditing ? "Schedule updated." : "Examination scheduled.");
            load();
          }}
          onCancel={() => {
            setShowForm(false);
            setEditGroup(null);
          }}
          onNotify={setNotice}
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

      <section className="mt-4 space-y-3">
        {loadError ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-(--danger)/40 px-4 py-4">
            <p className="text-xs text-(--danger)">{loadError}</p>
            <Button type="button" variant="subtle" onClick={load}>Try again</Button>
          </div>
        ) : null}

        {loading ? (
          <div className="glass-inner h-32 motion-safe:animate-pulse rounded-xl" />
        ) : null}

        {!loading && !loadError && visiblePapers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-(--border) px-4 py-8 text-center">
            <p className="text-sm font-medium text-(--foreground)">No papers match this view.</p>
            <p className="mt-1 text-xs text-(--muted-foreground)">
              {papers.length === 0
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

        {!loading && !loadError && visiblePapers.length > 0 ? (
          <ExamRecordsTable
            papers={visiblePapers}
            profile={profile}
            teachers={teachers}
            degrees={degrees}
            departments={departments}
            courses={courses}
            subjects={subjects}
            classSubjects={classSubjects}
            templates={templates}
            templateComponents={templateComponents}
            canManageGroup={canManageGroup}
            canDeleteGroup={canDeleteGroup}
            onEdit={(target) => {
              setShowForm(false);
              setEditGroup(target);
            }}
            onReschedule={setDialogPaper}
            onDelete={deleteExamination}
            onChanged={refreshGroups}
            onNotify={setNotice}
          />
        ) : null}
      </section>

      {dialogPaper ? (
        <PaperScheduleDialog
          paper={dialogPaper}
          teachers={teachers}
          onClose={() => setDialogPaper(null)}
          onSaved={refreshGroups}
          onNotify={setNotice}
        />
      ) : null}
    </>
  );
}
