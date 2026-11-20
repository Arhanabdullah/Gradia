import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { CalendarDays, GraduationCap } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Button, Card, Empty, Field, inputClass } from "../../components/ui";
import DashboardHeader from "../../components/dashboard/DashboardHeader";
import ImportButton from "../../components/import/ImportButton";
import ExamCalendar from "../../components/exams/ExamCalendar";
import SemesterSubjectEditor from "../../components/exams/SemesterSubjectEditor";
import { useAuth } from "../../context/AuthContext";
import { callRpc } from "../../lib/db";
import {
  derivedBatch,
  flattenPapers,
  groupIsPublished,
  isClassworkComponent,
  isPracticalSubject,
  paperTimeBucket,
  semesterGroupForClass,
} from "../../lib/exams";
import { subjectTypeLabel } from "../../lib/assessment";

// The examination module creates one Semester Examination from the assigned
// class structure. A class carries its assigned subjects; each subject carries
// the IA1, IA2, ESA, Quiz, Assignment and Project papers defined in Assessment
// Setup. A department-wide group holds one exam per class, shares every paper
// date and time, and keeps a separate room for each class. The standalone
// activity schedulers and invigilator selection are retired. A department group
// shows the union of subjects assigned across its classes, so classes with
// different subject sets can share paper dates and keep separate rooms.

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
        duration_minutes, room, allow_overlap
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

async function selectWithScheduleModeFallback(makeQuery) {
  const first = await makeQuery(true);
  if (first.error && /schedule_mode/i.test(first.error.message ?? "")) {
    return makeQuery(false);
  }
  return first;
}

const MISSING_RELATION_CODES = new Set(["42P01", "PGRST205"]);

function isMissingRelation(error) {
  if (!error) return false;
  if (MISSING_RELATION_CODES.has(error.code)) return true;
  return /does not exist|schema cache|could not find the table/i.test(error.message ?? "");
}

function isDuplicateExamError(error) {
  return (
    error?.code === "23505" ||
    /already exists|duplicate|unique_violation/i.test(error?.message ?? "")
  );
}

function degreeOfClass(klass, courseById) {
  return klass.degree_id ?? courseById.get(klass.course_id)?.degree_id ?? "";
}

function departmentOfClass(klass, courseById) {
  return courseById.get(klass.course_id)?.department_id ?? "";
}

function templateFamilyMatches(template, family) {
  if (!template) return false;
  return template.subject_type === family || (family === "project" && template.subject_type === "theory");
}

function subjectFamily(subject) {
  return isPracticalSubject(subject) ? "lab" : (subject?.subject_type ?? "theory");
}

function formatDay(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

const HIERARCHY_CHILDREN = {
  year: ["degree", "department", "course", "classId"],
  degree: ["department", "course", "classId"],
  department: ["course", "classId"],
  course: ["classId"],
  classId: [],
};

export default function ManageExams() {
  const { profile } = useAuth();
  const location = useLocation();
  const [groups, setGroups] = useState([]);
  const [classes, setClasses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [degrees, setDegrees] = useState([]);
  const [courses, setCourses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [templateComponents, setTemplateComponents] = useState([]);
  const [classSubjects, setClassSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [structure, setStructure] = useState("class");
  const [departmentClassIds, setDepartmentClassIds] = useState([]);
  const [hierarchy, setHierarchy] = useState(() => ({
    year: "",
    degree: "",
    department: "",
    course: "",
    classId: location.state?.classId ?? "",
  }));
  const [openSubjectId, setOpenSubjectId] = useState("");
  const [busy, setBusy] = useState(false);
  // Refs keep automatic creation idempotent when group/state updates re-render
  // the page, and stop a deliberately deleted group from being recreated.
  const autoAttempted = useRef(new Set());
  const suppressedClasses = useRef(new Set());

  const canManage = profile?.role === "admin" || profile?.role === "exam_cell";
  const canDelete = profile?.role === "admin";

  const load = async () => {
    setLoading(true);
    setLoadError("");
    const [
      groupsRes,
      classesRes,
      departmentsRes,
      degreesRes,
      coursesRes,
      subjectsRes,
      classSubjectsRes,
      templatesRes,
      templateComponentsRes,
    ] = await Promise.all([
      selectWithScheduleModeFallback((withMode) =>
        supabase
          .from("exam_groups")
          .select(groupSelect(withMode))
          .in("exam_type", ["semester", "final", "major"])
          .order("created_at", { ascending: false }),
      ),
      supabase
        .from("classes")
        .select("id, name, department, academic_year, semester, section, course_id, degree_id")
        .order("name"),
      supabase.from("departments").select("id, name").order("name"),
      supabase.from("degrees").select("id, name").order("name"),
      supabase.from("courses").select("id, name, department_id, degree_id, code").order("name"),
      supabase
        .from("subjects")
        .select("id, name, code, max_marks, credit_hours, department_id, subject_type, assessment_template_id")
        .order("code"),
      supabase.from("class_subjects").select("id, class_id, subject_id"),
      supabase
        .from("assessment_templates")
        .select("id, name, subject_type, mode, total_marks, is_default, is_active, created_at")
        .order("created_at"),
      selectWithScheduleModeFallback((withMode) =>
        supabase
          .from("assessment_template_components")
          .select(templateComponentSelect(withMode))
          .order("display_order"),
      ),
    ]);

    const failure =
      (degreesRes.error && !isMissingRelation(degreesRes.error) ? degreesRes.error : null) ||
      groupsRes.error ||
      classesRes.error ||
      departmentsRes.error ||
      coursesRes.error ||
      subjectsRes.error ||
      classSubjectsRes.error;

    if (failure) {
      setLoadError("Could not load semester examinations. Check your connection and refresh the page.");
    }

    setGroups(groupsRes.data ?? []);
    setClasses(classesRes.data ?? []);
    setDepartments(departmentsRes.data ?? []);
    setDegrees(degreesRes.error ? [] : (degreesRes.data ?? []));
    setCourses(coursesRes.data ?? []);
    setSubjects(subjectsRes.data ?? []);
    setClassSubjects(classSubjectsRes.data ?? []);
    setTemplates(templatesRes.error ? [] : (templatesRes.data ?? []));
    setTemplateComponents(templateComponentsRes.error ? [] : (templateComponentsRes.data ?? []));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const refreshGroups = useCallback(async () => {
    const { data, error } = await selectWithScheduleModeFallback((withMode) =>
      supabase
        .from("exam_groups")
        .select(groupSelect(withMode))
        .in("exam_type", ["semester", "final", "major"])
        .order("created_at", { ascending: false }),
    );
    if (error) {
      setLoadError("Could not refresh semester examinations. Check your connection and refresh the page.");
      return;
    }
    setLoadError("");
    setGroups(data ?? []);
  }, []);

  const courseById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
  const subjectById = useMemo(() => new Map(subjects.map((subject) => [subject.id, subject])), [subjects]);
  const templateById = useMemo(() => new Map(templates.map((template) => [template.id, template])), [templates]);
  const subjectsByClass = useMemo(() => {
    const map = new Map();
    for (const row of classSubjects) {
      const subject = subjectById.get(row.subject_id);
      if (!subject) continue;
      if (!map.has(row.class_id)) map.set(row.class_id, []);
      map.get(row.class_id).push(subject);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));
    }
    return map;
  }, [classSubjects, subjectById]);

  const setLevel = (level, value) => {
    setHierarchy((current) => {
      const next = { ...current, [level]: value };
      (HIERARCHY_CHILDREN[level] ?? []).forEach((key) => {
        next[key] = "";
      });
      return next;
    });
    setOpenSubjectId("");
  };

  const classesForYear = useMemo(
    () => classes.filter((klass) => !hierarchy.year || klass.academic_year === hierarchy.year),
    [classes, hierarchy.year],
  );
  const classesForDegree = useMemo(
    () =>
      classesForYear.filter(
        (klass) => !hierarchy.degree || degreeOfClass(klass, courseById) === hierarchy.degree,
      ),
    [classesForYear, hierarchy.degree, courseById],
  );
  const classesForDepartment = useMemo(
    () =>
      classesForDegree.filter(
        (klass) => !hierarchy.department || departmentOfClass(klass, courseById) === hierarchy.department,
      ),
    [classesForDegree, hierarchy.department, courseById],
  );
  const classesForCourse = useMemo(
    () =>
      classesForDepartment.filter(
        (klass) => !hierarchy.course || klass.course_id === hierarchy.course,
      ),
    [classesForDepartment, hierarchy.course],
  );
  const yearOptions = useMemo(
    () => [...new Set(classes.map((klass) => klass.academic_year).filter(Boolean))].sort().reverse(),
    [classes],
  );
  const degreeOptions = useMemo(() => {
    const present = new Set(classesForYear.map((klass) => degreeOfClass(klass, courseById)).filter(Boolean));
    return degrees.filter((degree) => present.has(degree.id));
  }, [degrees, classesForYear, courseById]);
  const departmentOptions = useMemo(() => {
    const present = new Set(
      classesForDegree.map((klass) => departmentOfClass(klass, courseById)).filter(Boolean),
    );
    return departments.filter((department) => present.has(department.id));
  }, [departments, classesForDegree, courseById]);
  const courseOptions = useMemo(() => {
    const present = new Set(classesForDepartment.map((klass) => klass.course_id).filter(Boolean));
    return courses.filter((course) => present.has(course.id));
  }, [courses, classesForDepartment]);
  const classOptions = useMemo(
    () =>
      [...classesForCourse].sort((a, b) =>
        `${a.name ?? ""} ${derivedBatch(a)}`.localeCompare(`${b.name ?? ""} ${derivedBatch(b)}`),
      ),
    [classesForCourse],
  );
  const selectedDepartmentClasses = useMemo(
    () => classOptions.filter((klass) => departmentClassIds.includes(klass.id)),
    [classOptions, departmentClassIds],
  );
  const viewClassOptions = useMemo(
    () => (structure === "department" ? selectedDepartmentClasses : classOptions),
    [structure, selectedDepartmentClasses, classOptions],
  );

  // A department-wide group is created per course and academic year from the
  // classes the user selected. Classes in one scope share paper dates while
  // keeping separate rooms.
  const departmentScopes = useMemo(() => {
    const map = new Map();
    for (const klass of selectedDepartmentClasses) {
      const courseId = klass.course_id || "";
      const academicYear = klass.academic_year || "";
      const key = `${courseId}|${academicYear}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(klass);
    }
    return [...map.entries()]
      .map(([key, list]) => {
        const [courseId, academicYear] = key.split("|");
        return {
          key,
          courseId,
          academicYear,
          departmentId: courseById.get(courseId)?.department_id ?? "",
          classes: list,
        };
      })
      .filter(
        (scope) =>
          scope.departmentId &&
          scope.classes.length > 0 &&
          (!hierarchy.course || scope.courseId === hierarchy.course),
      );
  }, [selectedDepartmentClasses, hierarchy.course, courseById]);

  // Keep the department selection inside the current hierarchy filters. A class
  // hidden by a changed filter cannot silently stay in a shared group.
  useEffect(() => {
    if (structure !== "department") return;
    const shownIds = new Set(classOptions.map((klass) => klass.id));
    setDepartmentClassIds((current) => {
      const next = current.filter((classId) => shownIds.has(classId));
      return next.length === current.length ? current : next;
    });
  }, [structure, classOptions]);

  // The class select is only a view into the selected group. If the inspected
  // class is unchecked, move to the first class still selected.
  useEffect(() => {
    if (structure !== "department") return;
    if (selectedDepartmentClasses.length === 0) {
      if (hierarchy.classId) {
        setHierarchy((current) => ({ ...current, classId: "" }));
        setOpenSubjectId("");
      }
      return;
    }
    if (
      hierarchy.classId &&
      !selectedDepartmentClasses.some((klass) => klass.id === hierarchy.classId)
    ) {
      setHierarchy((current) => ({ ...current, classId: selectedDepartmentClasses[0].id }));
      setOpenSubjectId("");
    }
  }, [structure, selectedDepartmentClasses, hierarchy.classId]);

  const toggleDepartmentClass = (classId) => {
    setDepartmentClassIds((current) =>
      current.includes(classId) ? current.filter((id) => id !== classId) : [...current, classId],
    );
    setOpenSubjectId("");
  };

  const selectedClass = useMemo(
    () => classes.find((klass) => klass.id === hierarchy.classId) ?? null,
    [classes, hierarchy.classId],
  );

  const classSemesterGroup = useMemo(
    () => semesterGroupForClass(groups, hierarchy.classId),
    [groups, hierarchy.classId],
  );
  // A department group is per course and academic year. If the viewed class has
  // no subjects of its own, fall back to another selected class in the same
  // scope so the shared subject union is still visible.
  const activeDepartmentScope = useMemo(() => {
    if (structure !== "department") return null;
    if (selectedClass) {
      return (
        departmentScopes.find(
          (scope) =>
            scope.courseId === (selectedClass.course_id || "") &&
            scope.academicYear === (selectedClass.academic_year || ""),
        ) ?? null
      );
    }
    return departmentScopes[0] ?? null;
  }, [structure, selectedClass, departmentScopes]);
  const semesterGroup = useMemo(() => {
    if (structure !== "department") return classSemesterGroup;
    if (classSemesterGroup) return classSemesterGroup;
    if (!activeDepartmentScope) return null;
    return (
      activeDepartmentScope.classes
        .map((klass) => semesterGroupForClass(groups, klass.id))
        .find((group) => group?.scope === "department") ?? null
    );
  }, [structure, classSemesterGroup, activeDepartmentScope, groups]);
  const examForClass = useMemo(
    () => semesterGroup?.exams?.find((exam) => exam.class_id === hierarchy.classId) ?? null,
    [semesterGroup, hierarchy.classId],
  );
  const departmentGroupExams = useMemo(
    () => (structure === "department" ? (semesterGroup?.exams ?? []) : []),
    [structure, semesterGroup],
  );
  // In a department group the inspected class may not offer every subject. Use
  // the first class that does as the editable copy; the RPC then shares its
  // date and time with every other class offering the same subject.
  const departmentExamSubjects = useMemo(() => {
    const map = new Map();
    const ordered = [...departmentGroupExams].sort((a, b) => {
      if (a.class_id === hierarchy.classId) return -1;
      if (b.class_id === hierarchy.classId) return 1;
      return 0;
    });
    for (const exam of ordered) {
      for (const examSubject of exam.exam_subjects ?? []) {
        if (map.has(examSubject.subject_id)) continue;
        map.set(examSubject.subject_id, {
          examSubject,
          exam,
          klass: exam.classes ?? classes.find((klass) => klass.id === exam.class_id) ?? null,
        });
      }
    }
    return map;
  }, [departmentGroupExams, hierarchy.classId, classes]);
  const targetExam = structure === "department"
    ? (examForClass ?? departmentGroupExams[0] ?? null)
    : examForClass;
  const groupLocked = groupIsPublished(semesterGroup);
  const groupHasSheets = useMemo(
    () =>
      (semesterGroup?.exams ?? []).some((exam) => (exam.result_sheets ?? []).length > 0),
    [semesterGroup],
  );

  // Department mode shows the union of assigned subjects across every class in
  // the group, with the classes that offer each one kept for the room editor.
  const assignedSubjects = useMemo(() => {
    if (structure === "department" && departmentGroupExams.length > 0) {
      const map = new Map();
      for (const exam of departmentGroupExams) {
        const klass = exam.classes ?? classes.find((item) => item.id === exam.class_id);
        for (const subject of subjectsByClass.get(exam.class_id) ?? []) {
          if (!map.has(subject.id)) map.set(subject.id, { subject, classes: [] });
          const entry = map.get(subject.id);
          if (klass && !entry.classes.some((item) => item.id === klass.id)) {
            entry.classes.push(klass);
          }
        }
      }
      return [...map.values()].sort((a, b) =>
        `${a.subject.code ?? ""} ${a.subject.name ?? ""}`.localeCompare(
          `${b.subject.code ?? ""} ${b.subject.name ?? ""}`,
        ),
      );
    }
    return (subjectsByClass.get(hierarchy.classId) ?? []).map((subject) => ({
      subject,
      classes: selectedClass ? [selectedClass] : [],
    }));
  }, [structure, departmentGroupExams, subjectsByClass, hierarchy.classId, selectedClass, classes]);

  const templateFor = (subject, examSubject) => {
    const family = subjectFamily(subject);
    const direct = examSubject?.assessment_template_id || subject?.assessment_template_id;
    const directTemplate = direct ? templateById.get(direct) : null;
    if (directTemplate && directTemplate.is_active !== false && templateFamilyMatches(directTemplate, family)) {
      return directTemplate;
    }
    const active = templates.filter((template) => template.is_active !== false);
    return (
      active.find((template) => template.is_default && templateFamilyMatches(template, family)) ??
      active.find((template) => template.is_default && template.subject_type === "theory") ??
      active.find((template) => templateFamilyMatches(template, family)) ??
      null
    );
  };

  const previewFor = (subject, examSubject) => {
    const template = templateFor(subject, examSubject);
    if (!template) return [];
    return templateComponents.filter((component) => component.template_id === template.id);
  };

  const subjectRows = useMemo(
    () =>
      assignedSubjects.map(({ subject, classes: offeredClasses }) => {
        const primary = structure === "department" ? departmentExamSubjects.get(subject.id) : null;
        const examSubject = primary?.examSubject ??
          examForClass?.exam_subjects?.find((row) => row.subject_id === subject.id) ??
          null;
        const components = examSubject?.assessment_components?.length
          ? examSubject.assessment_components
          : previewFor(subject, examSubject);
        const formal = components.filter((row) => !isClassworkComponent(row));
        const dated = formal.filter((row) => row.exam_date);
        const dates = dated.map((row) => row.exam_date).sort();
        return {
          subject,
          offeredClasses,
          primaryClass: primary?.klass ?? offeredClasses[0] ?? selectedClass,
          examSubject,
          components,
          formal,
          classified: Boolean(examSubject),
          dated: dated.length,
          firstDate: dates[0] ?? "",
          lastDate: dates[dates.length - 1] ?? "",
        };
      }),
    // previewFor depends on templates and components, which are in scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      assignedSubjects,
      structure,
      departmentExamSubjects,
      examForClass,
      selectedClass,
      templates,
      templateComponents,
      templateById,
    ],
  );

  const openRow = subjectRows.find((row) => row.subject.id === openSubjectId) ?? null;

  const calendarClassIds = useMemo(() => {
    if (structure !== "department") return null;
    return new Set(selectedDepartmentClasses.map((klass) => klass.id));
  }, [structure, selectedDepartmentClasses]);

  const calendarPapers = useMemo(
    () =>
      flattenPapers(groups).filter(
        (paper) =>
          paper.resultKind === "semester" &&
          (calendarClassIds
            ? calendarClassIds.has(paper.classId)
            : !hierarchy.classId || paper.classId === hierarchy.classId),
      ),
    [groups, hierarchy.classId, calendarClassIds],
  );

  const selectedPaperKey = useMemo(() => {
    if (!openRow?.examSubject) return "";
    const paper = calendarPapers.find(
      (row) => row.examSubject?.id === openRow.examSubject.id && row.date,
    );
    return paper?.key ?? "";
  }, [calendarPapers, openRow]);

  const createGroup = useCallback(
    async ({ scope, departmentId, courseId, classList, academicYear, classSubjectsMap }) => {
      const union = new Map();
      const perClass = {};
      for (const klass of classList) {
        const list = classSubjectsMap.get(klass.id) ?? [];
        if (list.length === 0) continue;
        perClass[klass.id] = list.map((subject) => ({
          subject_id: subject.id,
          max_marks: subject.max_marks ?? 100,
        }));
        for (const subject of list) {
          if (!union.has(subject.id)) {
            union.set(subject.id, {
              subject_id: subject.id,
              max_marks: subject.max_marks ?? 100,
            });
          }
        }
      }
      if (union.size === 0) return false;

      const payload = {
        p_name: `Semester Examination ${academicYear ?? new Date().getFullYear()}`,
        p_exam_type: "semester",
        p_scope: scope,
        p_department_id: departmentId || null,
        p_course_id: courseId || null,
        p_academic_year: academicYear || null,
        p_academic_term_id: null,
        p_class_ids: classList.map((klass) => klass.id),
        p_starts_on: null,
        p_ends_on: null,
        p_instructions: "",
        p_status: "draft",
        p_subjects: [...union.values()],
      };
      if (scope === "department") payload.p_class_subjects = perClass;
      await callRpc("create_exam_group", payload);
      return true;
    },
    [],
  );

  // Semester examinations are created from the structure, never from a button.
  // Class scope covers the selected class; department scope creates one shared
  // group per course and year with a separate room for each class.
  useEffect(() => {
    if (!canManage || loading || loadError) return undefined;
    let cancelled = false;

    const run = async () => {
      try {
        if (structure === "class") {
          if (!selectedClass || suppressedClasses.current.has(selectedClass.id)) return;
          const key = `class:${selectedClass.id}`;
          if (autoAttempted.current.has(key)) return;
          if (semesterGroupForClass(groups, selectedClass.id)) {
            autoAttempted.current.add(key);
            return;
          }
          if ((subjectsByClass.get(selectedClass.id) ?? []).length === 0) return;
          autoAttempted.current.add(key);
          const created = await createGroup({
            scope: "class",
            departmentId: departmentOfClass(selectedClass, courseById),
            courseId: selectedClass.course_id,
            classList: [selectedClass],
            academicYear: selectedClass.academic_year,
            classSubjectsMap: subjectsByClass,
          });
          if (created && !cancelled) {
            setNotice("The semester examination was created from the class structure.");
            await refreshGroups();
          }
          return;
        }

        const createdCourses = [];
        for (const scope of departmentScopes) {
          if (cancelled) return;
          const classList = scope.classes.filter(
            (klass) => !suppressedClasses.current.has(klass.id),
          );
          if (classList.length === 0) continue;
          const key = `department:${scope.key}:${classList.map((klass) => klass.id).sort().join(",")}`;
          if (autoAttempted.current.has(key)) continue;
          if (classList.some((klass) => semesterGroupForClass(groups, klass.id))) {
            autoAttempted.current.add(key);
            continue;
          }
          if (!classList.some((klass) => (subjectsByClass.get(klass.id) ?? []).length > 0)) continue;
          autoAttempted.current.add(key);
          const created = await createGroup({
            scope: "department",
            departmentId: scope.departmentId,
            courseId: scope.courseId,
            classList,
            academicYear: scope.academicYear,
            classSubjectsMap: subjectsByClass,
          });
          if (created && !cancelled) {
            createdCourses.push(courseById.get(scope.courseId)?.name ?? "a course");
          }
        }
        if (createdCourses.length > 0 && !cancelled) {
          setNotice(
            `Shared semester examinations were created for ${createdCourses.join(", ")}.`,
          );
          await refreshGroups();
        }
      } catch (err) {
        if (cancelled) return;
        if (!isDuplicateExamError(err)) {
          setLoadError(err?.message ?? "Could not create the semester examination.");
        }
        await refreshGroups();
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [
    canManage,
    loading,
    loadError,
    structure,
    selectedClass,
    groups,
    subjectsByClass,
    departmentScopes,
    courseById,
    createGroup,
    refreshGroups,
  ]);

  const addMissingSubjects = async () => {
    if (!targetExam) return;
    setNotice("");
    setLoadError("");
    const missing = assignedSubjects
      .filter(({ subject }) =>
        structure === "department"
          ? !departmentExamSubjects.has(subject.id)
          : !examForClass?.exam_subjects?.some((row) => row.subject_id === subject.id),
      )
      .map(({ subject }) => subject);
    if (missing.length === 0) {
      setNotice("Every assigned subject is already in this semester examination.");
      return;
    }
    setBusy(true);
    try {
      for (const subject of missing) {
        // The RPC resolves the assigned teacher per class and adds the subject
        // to every class in the group that offers it.
        await callRpc("add_exam_subject", {
          p_exam_id: targetExam.id,
          p_subject_id: subject.id,
        });
      }
      setNotice(`Added ${missing.length} subject${missing.length === 1 ? "" : "s"} to the semester examination.`);
      await refreshGroups();
    } catch (err) {
      setLoadError(err?.message ?? "Could not add the missing subjects.");
    } finally {
      setBusy(false);
    }
  };

  const openSubject = async (row) => {
    setNotice("");
    setLoadError("");
    if (row.examSubject || !canManage || !targetExam || groupHasSheets) {
      setOpenSubjectId(row.subject.id);
      return;
    }
    setBusy(true);
    try {
      await callRpc("add_exam_subject", {
        p_exam_id: targetExam.id,
        p_subject_id: row.subject.id,
      });
      await refreshGroups();
      setOpenSubjectId(row.subject.id);
      setNotice(`${row.subject.code ?? row.subject.name} added to the semester examination.`);
    } catch (err) {
      setLoadError(err?.message ?? "Could not add this subject.");
    } finally {
      setBusy(false);
    }
  };

  const deleteSemester = async () => {
    if (!semesterGroup || !examForClass) return;
    if (groupHasSheets) {
      setLoadError("A result sheet already exists for this examination, so it cannot be deleted.");
      return;
    }
    setNotice("");
    setLoadError("");
    setBusy(true);
    try {
      const groupExams = semesterGroup.exams ?? [];
      const removeOnlyClass = semesterGroup.scope === "department" && groupExams.length > 1;
      const subjectIds = (examForClass.exam_subjects ?? []).map((row) => row.id);
      // The subject RPC refuses a subject that already has marks or a result
      // sheet, so a busy examination can never be deleted by accident.
      for (const examSubjectId of subjectIds) {
        await callRpc("remove_exam_subject", { p_exam_subject_id: examSubjectId });
      }
      if (removeOnlyClass) {
        // A department group belongs to every class. Removing one class must
        // not delete the other classes' examinations with it.
        const { error: examError } = await supabase.from("exams").delete().eq("id", examForClass.id);
        if (examError) throw new Error(examError.message);
        suppressedClasses.current.add(selectedClass.id);
        setNotice(`Removed ${selectedClass.name} from "${semesterGroup.name}". Other classes keep their schedules.`);
      } else {
        const { error: examError } = await supabase.from("exams").delete().eq("exam_group_id", semesterGroup.id);
        if (examError) throw new Error(examError.message);
        const { error: groupError } = await supabase.from("exam_groups").delete().eq("id", semesterGroup.id);
        if (groupError) throw new Error(groupError.message);
        groupExams.forEach((exam) => suppressedClasses.current.add(exam.class_id));
        setNotice(`Deleted "${semesterGroup.name}".`);
      }
      setOpenSubjectId("");
      await refreshGroups();
    } catch (err) {
      setLoadError(err?.message ?? "Could not delete this semester examination.");
    } finally {
      setBusy(false);
    }
  };

  const title =
    profile?.role === "teacher"
      ? "Semester examinations"
      : profile?.role === "hod"
        ? "Department semester examinations"
        : "Semester examinations";

  const subtitle =
    profile?.role === "teacher"
      ? "Review each subject's assessment breakdown; enter marks in Marks Entry."
      : "Created automatically from the class structure. In department mode, select classes to share paper dates and keep a room per class. Every subject assigned across those classes is listed, even when only some classes offer it.";

  const totalPapers = calendarPapers.length;
  const datedPapers = calendarPapers.filter((paper) => paper.date).length;

  return (
    <>
      <DashboardHeader title={title} subtitle={subtitle} />

      <section className="mt-5" aria-label="Academic hierarchy">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <GraduationCap size={15} className="text-(--primary)" aria-hidden="true" />
              <p className="text-sm font-semibold tracking-tight text-(--foreground)">
                {structure === "department" ? "Choose the department structure" : "Choose a class"}
              </p>
            </div>
            <p className="text-[11px] text-(--muted-foreground)">
              Academic year to degree to department to course to class to subject
            </p>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Field label="Structure">
              <select
                className={inputClass}
                value={structure}
                onChange={(event) => {
                  const next = event.target.value;
                  setStructure(next);
                  if (next === "department") {
                    setDepartmentClassIds(classOptions.map((klass) => klass.id));
                  }
                  setOpenSubjectId("");
                }}
                disabled={!canManage}
              >
                <option value="class">Per class</option>
                <option value="department">Department-wide</option>
              </select>
            </Field>
            <Field label="Academic year">
              <select
                className={inputClass}
                value={hierarchy.year}
                onChange={(event) => setLevel("year", event.target.value)}
              >
                <option value="">Any year</option>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </Field>
            <Field label="Degree">
              <select
                className={inputClass}
                value={hierarchy.degree}
                onChange={(event) => setLevel("degree", event.target.value)}
              >
                <option value="">Any degree</option>
                {degreeOptions.map((degree) => (
                  <option key={degree.id} value={degree.id}>{degree.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Department">
              <select
                className={inputClass}
                value={hierarchy.department}
                onChange={(event) => setLevel("department", event.target.value)}
              >
                <option value="">Any department</option>
                {departmentOptions.map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Course">
              <select
                className={inputClass}
                value={hierarchy.course}
                onChange={(event) => setLevel("course", event.target.value)}
              >
                <option value="">Any course</option>
                {courseOptions.map((course) => (
                  <option key={course.id} value={course.id}>{course.name}</option>
                ))}
              </select>
            </Field>
            <Field label={structure === "department" ? "View class" : "Class"}>
              <select
                className={inputClass}
                value={hierarchy.classId}
                onChange={(event) => setLevel("classId", event.target.value)}
              >
                <option value="">
                  {structure === "department"
                    ? selectedDepartmentClasses.length === 0
                      ? "Select classes below"
                      : "Choose a selected class"
                    : "Choose a class"}
                </option>
                {viewClassOptions.map((klass) => (
                  <option key={klass.id} value={klass.id}>
                    {klass.name}, {derivedBatch(klass)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {structure === "department" ? (
            <div className="mt-4 border-t border-(--border) pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-(--foreground)">Classes to group</p>
                  <p className="mt-0.5 text-[11px] text-(--muted-foreground)">
                    Selected classes share paper dates and times. Each class keeps its own room. Classes with different subjects are supported.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="subtle"
                    className="px-3 py-1.5 text-xs"
                    onClick={() => setDepartmentClassIds(classOptions.map((klass) => klass.id))}
                    disabled={!canManage || classOptions.length === 0}
                  >
                    Select all shown
                  </Button>
                  <Button
                    type="button"
                    variant="subtle"
                    className="px-3 py-1.5 text-xs"
                    onClick={() => setDepartmentClassIds([])}
                    disabled={!canManage || departmentClassIds.length === 0}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              {classOptions.length === 0 ? (
                <p className="mt-3 text-[11px] text-(--muted-foreground)">
                  No classes match the filters above.
                </p>
              ) : (
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {classOptions.map((klass) => (
                    <label
                      key={klass.id}
                      className="flex items-center gap-2 rounded-lg border border-(--border) px-3 py-2 text-xs text-(--foreground)"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-(--primary)"
                        checked={departmentClassIds.includes(klass.id)}
                        onChange={() => toggleDepartmentClass(klass.id)}
                        disabled={!canManage}
                      />
                      <span className="min-w-0 truncate">
                        {klass.name}
                        {derivedBatch(klass) ? `, ${derivedBatch(klass)}` : ""}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <p className="mt-3 text-[11px] text-(--muted-foreground)">
                Classes in the selected course share one examination. Paper dates and times are set
                once; each class keeps its own room in the subject breakdown.
              </p>
            </div>
          ) : null}
        </Card>
      </section>

      {notice ? (
        <p role="status" className="mt-3 text-xs text-(--success)">
          {notice}
        </p>
      ) : null}
      {loadError ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-(--danger)/40 px-4 py-3">
          <p className="text-xs text-(--danger)">{loadError}</p>
          <Button
            type="button"
            variant="subtle"
            onClick={() => {
              autoAttempted.current.clear();
              load();
            }}
          >
            Try again
          </Button>
        </div>
      ) : null}

      {loading ? <div className="glass-inner mt-4 h-32 motion-safe:animate-pulse rounded-xl" /> : null}

      {!loading && !selectedClass ? (
        <div className="mt-4">
          <Card>
            <Empty>
              {structure === "department"
                ? "Choose the academic filters, select the classes to group, then choose a class to inspect its rooms."
                : "Choose an academic year, degree, department, course and class to see its semester examination and every subject's assessment breakdown."}
            </Empty>
          </Card>
        </div>
      ) : null}

      {!loading && selectedClass ? (
        <section className="mt-4" aria-label="Class semester examination">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-(--muted-foreground)">Semester examination</p>
                <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-(--foreground)">
                  {selectedClass.name}
                </h2>
                <p className="mt-0.5 text-xs text-(--muted-foreground)">
                  {[derivedBatch(selectedClass), semesterGroup?.name].filter(Boolean).join(", ")}
                  {semesterGroup?.scope === "department"
                    ? `, across ${departmentGroupExams.length} class${departmentGroupExams.length === 1 ? "" : "es"}`
                    : ""}
                  {semesterGroup ? `, ${assignedSubjects.length} subjects` : ", not scheduled yet"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {semesterGroup ? (
                  <span className="rounded-md border border-(--border) bg-(--surface-secondary) px-2 py-1 text-[11px] text-(--muted-foreground)">
                    {datedPapers} of {totalPapers} papers dated
                  </span>
                ) : null}
                {groupHasSheets ? (
                  <span className="rounded-md border border-(--primary)/30 bg-(--primary)/10 px-2 py-1 text-[11px] text-(--primary)">
                    Result sheet exists, schedule locked
                  </span>
                ) : null}
                {!semesterGroup ? (
                  <span className="rounded-md border border-(--border) bg-(--surface-secondary) px-2 py-1 text-[11px] text-(--muted-foreground)">
                    {assignedSubjects.length > 0 ? "Creating from structure…" : "Waiting for assigned subjects"}
                  </span>
                ) : null}
                {canManage && semesterGroup ? (
                  <>
                    {!groupHasSheets && subjectRows.some((row) => !row.classified) ? (
                      <Button type="button" variant="subtle" onClick={addMissingSubjects} disabled={busy}>
                        Add missing subjects
                      </Button>
                    ) : null}
                    <ImportButton
                      moduleId="schedule_semester"
                      label="Import schedule"
                      onComplete={refreshGroups}
                    />
                    {canDelete && !groupLocked && !groupHasSheets ? (
                      <Button type="button" variant="danger" onClick={deleteSemester} disabled={busy}>
                        {semesterGroup.scope === "department" && (semesterGroup.exams?.length ?? 0) > 1
                          ? "Remove this class"
                          : "Delete examination"}
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>

            {selectedClass && assignedSubjects.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed border-(--border) px-3.5 py-3 text-xs text-(--muted-foreground)">
                No subjects are assigned to this class yet. Assign them in Academics, then return here.
              </p>
            ) : null}

            {assignedSubjects.length > 0 ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {subjectRows.map((row) => {
                  const isOpen = row.subject.id === openSubjectId;
                  const classworkOnly = row.components.length > 0 && row.formal.length === 0;
                  const status = !row.classified
                    ? "Not in examination"
                    : classworkOnly
                      ? "Classwork only"
                      : row.dated > 0
                        ? row.dated === row.formal.length
                          ? "Scheduled"
                          : "Partly scheduled"
                        : "Needs dates";
                  return (
                    <div
                      key={row.subject.id}
                      className={`rounded-lg border p-3 ${
                        isOpen ? "border-(--primary)/50 bg-(--primary)/5" : "border-(--border)"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-(--foreground)">
                            {row.subject.code ?? row.subject.name}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-(--muted-foreground)">
                            {row.subject.code ? row.subject.name : subjectTypeLabel(subjectFamily(row.subject))}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] ${
                            status === "Scheduled"
                              ? "border-(--success)/40 bg-(--success)/10 text-(--success)"
                              : status === "Needs dates" || status === "Partly scheduled"
                                ? "border-(--primary)/30 bg-(--primary)/10 text-(--primary)"
                                : "border-(--border) bg-(--surface-secondary) text-(--muted-foreground)"
                          }`}
                        >
                          {status}
                        </span>
                      </div>

                      <p className="mt-2 text-[11px] text-(--muted-foreground)">
                        {row.components.length} component{row.components.length === 1 ? "" : "s"}
                        {row.classified && row.formal.length > 0 ? `, ${row.dated} dated` : ""}
                      </p>
                      {structure === "department" && row.offeredClasses.length > 0 ? (
                        <p
                          className="mt-0.5 truncate text-[11px] text-(--muted-foreground)"
                          title={row.offeredClasses
                            .map((klass) => klass.name)
                            .filter(Boolean)
                            .join(", ")}
                        >
                          Offered by {row.offeredClasses.length} class
                          {row.offeredClasses.length === 1 ? "" : "es"}: {" "}
                          {row.offeredClasses
                            .map((klass) => klass.name)
                            .filter(Boolean)
                            .join(", ")}
                        </p>
                      ) : null}
                      {row.firstDate ? (
                        <p className="mt-0.5 text-[11px] text-(--muted-foreground)">
                          {row.firstDate === row.lastDate
                            ? formatDay(row.firstDate)
                            : `${formatDay(row.firstDate)} to ${formatDay(row.lastDate)}`}
                        </p>
                      ) : null}

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="subtle"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => openSubject(row)}
                          disabled={busy}
                        >
                          {!row.classified
                            ? canManage && targetExam && !groupHasSheets
                              ? "Add and schedule"
                              : "View structure"
                            : canManage && !groupLocked && !groupHasSheets
                              ? "Schedule or edit"
                              : "View breakdown"}
                        </Button>
                        {row.components.length > 0 ? (
                          <span className="text-[11px] text-(--muted-foreground)">
                            {row.components
                              .slice(0, 4)
                              .map((component) => component.code ?? component.name)
                              .join(", ")}
                            {row.components.length > 4 ? "…" : ""}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </Card>
        </section>
      ) : null}

      {openRow ? (
        <section aria-label="Subject assessment breakdown">
          <SemesterSubjectEditor
            key={`${openRow.subject.id}-${openRow.examSubject?.id ?? "preview"}`}
            klass={openRow.primaryClass ?? selectedClass}
            subject={openRow.subject}
            examSubject={openRow.examSubject}
            previewComponents={previewFor(openRow.subject, openRow.examSubject)}
            subjectClasses={openRow.offeredClasses}
            groupExams={semesterGroup?.exams ?? []}
            groupScope={semesterGroup?.scope ?? "class"}
            canEdit={canManage && !groupLocked && !groupHasSheets}
            onClose={() => setOpenSubjectId("")}
            onSaved={async () => {
              await refreshGroups();
            }}
            onNotify={setNotice}
          />
        </section>
      ) : null}

      <section className="mt-6" aria-label="Examination calendar">
        <ExamCalendar
          papers={calendarPapers}
          selectedKey={selectedPaperKey}
          initialDate={openRow?.firstDate ?? ""}
          title={
            calendarClassIds
              ? `${courseById.get(semesterGroup?.course_id)?.name ?? "Department"} examination calendar`
              : selectedClass
                ? `${selectedClass.name} examination calendar`
                : "Examination calendar"
          }
          subtitle={
            calendarClassIds
              ? "Shared paper dates across the department group, with a separate room for each class."
              : selectedClass
                ? "Papers from this class's semester examination, by paper date."
                : "Every scheduled semester paper across classes."
          }
          onSelect={(paper) => {
            if (!paper?.classId) return;
            setHierarchy((current) => ({
              ...current,
              year: paper.academicYear || current.year,
              classId: paper.classId,
            }));
            setOpenSubjectId(paper.subjectId);
            const bucket = paperTimeBucket(paper);
            if (bucket === "unscheduled") setNotice("This paper is not dated yet.");
          }}
        />
      </section>

      <p className="mt-4 flex items-center gap-1.5 text-[11px] text-(--muted-foreground)">
        <CalendarDays size={13} aria-hidden="true" />
        Semester examinations are created automatically from assigned subjects. Classes without subjects show their Assessment Setup blueprint until subjects are assigned.
      </p>
    </>
  );
}
