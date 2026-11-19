import { useMemo, useState } from "react";
import { Button, Card, Field, Select, inputClass } from "../ui";
import { callRpc } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import {
  SEMESTER_EXAM_TYPES,
  activityForExamType,
  activityIsClasswork,
  addMinutesToClock,
  componentDuration,
  derivedBatch,
  examTypeForActivity,
  examTypesForRole,
  isClassworkComponent,
  isFormalComponent,
  isPracticalSubject,
  subjectAllowedInExam,
  subjectFamily,
  subjectLabel,
  teacherLabel,
} from "../../lib/exams";

const textareaClass =
  "w-full rounded-lg border border-(--muted) bg-(--surface-secondary) px-3.5 py-2.5 text-sm text-(--foreground) placeholder:text-(--muted-foreground)/60 outline-none transition-colors focus:border-(--primary) focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40";

const smallInput = `${inputClass} py-1.5 text-xs`;

function departmentOfClass(klass, courseById) {
  return klass?.course_id ? (courseById.get(klass.course_id)?.department_id ?? "") : "";
}

function degreeOfClass(klass, courseById) {
  const course = klass?.course_id ? courseById.get(klass.course_id) : null;
  return klass?.degree_id ?? course?.degree_id ?? "";
}

function templateFamilyMatches(template, family) {
  if (!template) return false;
  return template.subject_type === family || (family === "project" && template.subject_type === "theory");
}

function addDays(dateValue, days) {
  if (!dateValue) return "";
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateValue;
  date.setDate(date.getDate() + Number(days || 0));
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function cleanRoom(value) {
  return (value ?? "").trim().toLowerCase();
}

function overlaps(left, right) {
  return left.date === right.date && left.start < right.end && left.end > right.start;
}

function sortComponents(list) {
  return [...list].sort((a, b) => {
    const order = (a.display_order ?? 0) - (b.display_order ?? 0);
    return order !== 0 ? order : String(a.code ?? "").localeCompare(String(b.code ?? ""));
  });
}

function componentLabel(component) {
  return component?.name ?? component?.code ?? "Paper";
}

// Flattens every other examination into one comparable paper list so the
// scheduler can warn about a room, invigilator or class collision before the
// database trigger rejects the save.
function flattenExistingPapers(groups, excludeGroupId) {
  const list = [];
  (groups ?? []).forEach((group) => {
    if (excludeGroupId && group.id === excludeGroupId) return;
    (group.exams ?? []).forEach((exam) => {
      const classLabel = exam.classes?.name ?? "another class";
      (exam.exam_subjects ?? []).forEach((examSubject) => {
        const subject = examSubject.subjects ?? {};
        const components = examSubject.assessment_components ?? [];
        if (components.length > 0) {
          components.forEach((component) => {
            if (component.is_conducted === false) return;
            if (!component.exam_date || !component.start_time || !component.end_time) return;
            list.push({
              groupId: group.id,
              classId: exam.class_id,
              classLabel,
              date: component.exam_date,
              start: component.start_time.slice(0, 5),
              end: component.end_time.slice(0, 5),
              room: cleanRoom(component.room),
              teacherId: component.teacher_id ?? "",
              allowOverlap: Boolean(component.allow_overlap),
              label: `${subjectLabel(subject)} ${componentLabel(component)}`.trim(),
            });
          });
          return;
        }
        if (examSubject.exam_date && examSubject.start_time && examSubject.end_time) {
          list.push({
            groupId: group.id,
            classId: exam.class_id,
            classLabel,
            date: examSubject.exam_date,
            start: examSubject.start_time.slice(0, 5),
            end: examSubject.end_time.slice(0, 5),
            room: cleanRoom(examSubject.room),
            teacherId: examSubject.teacher_id ?? "",
            allowOverlap: Boolean(examSubject.allow_overlap),
            label: subjectLabel(subject),
          });
        }
      });
    });
  });
  return list;
}

function newPaper(subject, components, defaultTeacher) {
  const formal = components.filter(isFormalComponent);
  const practical = isPracticalSubject(subject);
  const preferred = practical
    ? (formal.find((component) => /PRACTICAL_EXAM|PRACTICAL/i.test(component.code ?? "")) ?? formal[0])
    : (formal.find((component) => /^ESA$/i.test(component.code ?? "")) ?? formal[0]);
  const longPaper = /ESA|PRACTICAL_EXAM|VIVA/i.test(preferred?.code ?? "");
  return {
    code: preferred?.code ?? "",
    exam_date: "",
    start_time: "",
    duration_minutes: preferred ? (longPaper ? 180 : 60) : "",
    room: "",
    teacher_id: defaultTeacher ?? "",
    allow_overlap: false,
  };
}

function entryFromExamSubject(examSubject, subject) {
  const components = sortComponents(examSubject?.assessment_components ?? []);
  const formal = components.filter(isFormalComponent);
  const conducted = formal.filter((component) => component.is_conducted !== false);
  const chosen = conducted.length > 0 ? conducted : formal.slice(0, 1);
  const papers = chosen.length > 0
    ? chosen.map((component) => ({
        code: component.code,
        exam_date: component.exam_date ?? "",
        start_time: component.start_time ? component.start_time.slice(0, 5) : "",
        duration_minutes: componentDuration(component) ?? "",
        room: component.room ?? "",
        teacher_id: component.teacher_id ?? "",
        allow_overlap: Boolean(component.allow_overlap),
      }))
    : [{
        code: "",
        exam_date: examSubject?.exam_date ?? "",
        start_time: examSubject?.start_time ? examSubject.start_time.slice(0, 5) : "",
        duration_minutes: componentDuration(examSubject) ?? "",
        room: examSubject?.room ?? "",
        teacher_id: examSubject?.teacher_id ?? "",
        allow_overlap: Boolean(examSubject?.allow_overlap),
      }];

  return {
    subjectId: subject?.id ?? examSubject?.subject_id,
    subject,
    examSubjectId: examSubject?.id ?? null,
    examId: examSubject?.exam_id ?? null,
    components,
    originalCodes: conducted.map((component) => component.code),
    teacher_id: examSubject?.teacher_id ?? "",
    max_marks: examSubject?.max_marks ?? subject?.max_marks ?? 100,
    pass_marks: examSubject?.pass_marks ?? "",
    papers,
  };
}

export default function ClassExamScheduler({
  profile,
  mode = "create",
  group = null,
  groups = [],
  classes = [],
  departments = [],
  degrees = [],
  courses = [],
  subjects = [],
  classSubjects = [],
  teacherAssignments = [],
  teachers = [],
  templates = [],
  templateComponents = [],
  onSaved,
  onCancel,
  onNotify,
}) {
  const isTeacher = profile?.role === "teacher";
  const canManageSubjectList = profile?.role === "admin" || profile?.role === "exam_cell";
  const editing = mode === "edit" && Boolean(group);
  const canChangeSubjectList = !editing || canManageSubjectList;
  const groupClass = editing ? (group?.exams?.[0]?.classes ?? null) : null;
  const groupExam = editing ? (group?.exams?.[0] ?? null) : null;

  const courseById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
  const subjectById = useMemo(() => new Map(subjects.map((subject) => [subject.id, subject])), [subjects]);
  const teacherById = useMemo(() => new Map(teachers.map((teacher) => [teacher.id, teacher])), [teachers]);
  const activeTemplates = useMemo(
    () => templates.filter((template) => template.is_active !== false),
    [templates],
  );

  const [form, setForm] = useState(() => ({
    name: group?.name ?? "",
    exam_type: group?.exam_type ?? (isTeacher ? "class_test" : "semester"),
    status: group?.status ?? "draft",
    scope: group?.scope ?? "class",
    degree_id: groupClass ? degreeOfClass(groupClass, courseById) : "",
    department_id: group?.department_id ?? (groupClass ? departmentOfClass(groupClass, courseById) : ""),
    course_id: group?.course_id ?? groupClass?.course_id ?? "",
    academic_year: group?.academic_year ?? groupClass?.academic_year ?? "",
    semester: groupClass?.semester != null ? String(groupClass.semester) : "",
    class_id: groupClass?.id ?? "",
    starts_on: group?.starts_on ?? "",
    ends_on: group?.ends_on ?? "",
    instructions: group?.instructions ?? "",
  }));

  const [entries, setEntries] = useState(() =>
    editing
      ? (groupExam?.exam_subjects ?? []).map((examSubject) =>
          entryFromExamSubject(examSubject, subjectById.get(examSubject.subject_id) ?? examSubject.subjects),
        )
      : [],
  );
  const [removedSubjectIds, setRemovedSubjectIds] = useState([]);
  const [picked, setPicked] = useState([]);
  const [query, setQuery] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [bulk, setBulk] = useState({
    exam_date: "",
    start_time: "",
    duration_minutes: "60",
    rooms: "",
    teacher_ids: [],
    stagger_days: "1",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const componentMode = SEMESTER_EXAM_TYPES.includes(form.exam_type);
  const activity = activityForExamType(form.exam_type);
  const classworkActivity = !componentMode && activityIsClasswork(activity);
  const scope = form.scope;

  const myClassIds = useMemo(() => {
    if (!isTeacher) return null;
    return new Set(
      teacherAssignments.filter((row) => row.teacher_id === profile?.id).map((row) => row.class_id),
    );
  }, [isTeacher, teacherAssignments, profile]);

  const scopedClasses = useMemo(() => {
    const list = classes.filter((klass) => !myClassIds || myClassIds.has(klass.id));
    if (editing && groupClass && !list.some((klass) => klass.id === groupClass.id)) {
      list.push(groupClass);
    }
    return list;
  }, [classes, myClassIds, editing, groupClass]);

  const degreeOptions = useMemo(() => {
    const present = new Set(scopedClasses.map((klass) => degreeOfClass(klass, courseById)).filter(Boolean));
    return degrees.filter((degree) => present.has(degree.id));
  }, [degrees, scopedClasses, courseById]);

  const departmentOptions = useMemo(() => {
    const present = new Set(
      scopedClasses
        .filter((klass) => !form.degree_id || degreeOfClass(klass, courseById) === form.degree_id)
        .map((klass) => departmentOfClass(klass, courseById))
        .filter(Boolean),
    );
    return departments.filter((department) => present.has(department.id));
  }, [departments, scopedClasses, form.degree_id, courseById]);

  const courseOptions = useMemo(
    () =>
      courses.filter(
        (course) =>
          (!form.degree_id || !course.degree_id || course.degree_id === form.degree_id) &&
          (!form.department_id || course.department_id === form.department_id) &&
          scopedClasses.some((klass) => klass.course_id === course.id),
      ),
    [courses, form.degree_id, form.department_id, scopedClasses],
  );

  const yearOptions = useMemo(() => {
    const years = scopedClasses
      .filter(
        (klass) =>
          (!form.degree_id || degreeOfClass(klass, courseById) === form.degree_id) &&
          (!form.department_id || departmentOfClass(klass, courseById) === form.department_id) &&
          (!form.course_id || klass.course_id === form.course_id),
      )
      .map((klass) => klass.academic_year)
      .filter(Boolean);
    return [...new Set(years)].sort();
  }, [scopedClasses, form.degree_id, form.department_id, form.course_id, courseById]);

  const semesterOptions = useMemo(() => {
    const semesters = scopedClasses
      .filter(
        (klass) =>
          (!form.degree_id || degreeOfClass(klass, courseById) === form.degree_id) &&
          (!form.department_id || departmentOfClass(klass, courseById) === form.department_id) &&
          (!form.course_id || klass.course_id === form.course_id) &&
          (!form.academic_year || klass.academic_year === form.academic_year),
      )
      .map((klass) => klass.semester)
      .filter((value) => value != null);
    return [...new Set(semesters)].map(String).sort((a, b) => Number(a) - Number(b));
  }, [scopedClasses, form.degree_id, form.department_id, form.course_id, form.academic_year, courseById]);

  const classOptions = useMemo(
    () =>
      scopedClasses.filter(
        (klass) =>
          (!form.degree_id || degreeOfClass(klass, courseById) === form.degree_id) &&
          (!form.department_id || departmentOfClass(klass, courseById) === form.department_id) &&
          (!form.course_id || klass.course_id === form.course_id) &&
          (!form.academic_year || klass.academic_year === form.academic_year) &&
          (!form.semester || String(klass.semester ?? "") === form.semester),
      ),
    [scopedClasses, form.degree_id, form.department_id, form.course_id, form.academic_year, form.semester, courseById],
  );

  const selectedClass = classOptions.find((klass) => klass.id === form.class_id)
    ?? scopedClasses.find((klass) => klass.id === form.class_id)
    ?? null;

  // Department scope schedules one paper across every class that matches the
  // chosen academic structure. Class scope keeps a single class.
  const targetClasses = useMemo(
    () => (scope === "department" ? classOptions : selectedClass ? [selectedClass] : []),
    [scope, classOptions, selectedClass],
  );

  const targetClassIds = useMemo(() => targetClasses.map((klass) => klass.id), [targetClasses]);

  const templateForSubject = (subject) => {
    const family = subjectFamily(subject);
    const own = activeTemplates.find(
      (template) => template.id === subject?.assessment_template_id && templateFamilyMatches(template, family),
    );
    if (own) return own;

    const defaults = activeTemplates
      .filter((template) => template.is_default && template.subject_type === family)
      .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
    if (defaults.length > 0) return defaults[0];

    return (
      activeTemplates
        .filter((template) => template.is_default && template.subject_type === "theory")
        .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))[0] ?? null
    );
  };

  const componentsForEntry = (entry) => {
    if (entry?.components?.length) return sortComponents(entry.components);
    const template = templateForSubject(entry?.subject);
    if (!template) return [];
    return sortComponents(
      templateComponents.filter((component) => component.template_id === template.id),
    );
  };

  const defaultTeacherFor = (subjectId) => {
    const assignment = teacherAssignments.find(
      (row) => row.class_id === form.class_id && row.subject_id === subjectId,
    );
    return assignment?.teacher_id ?? (isTeacher ? profile?.id : "") ?? "";
  };

  const eligibleSubjects = useMemo(() => {
    if (targetClassIds.length === 0) return [];
    // A department examination only takes subjects that every target class
    // offers, because the database writes one subject row per class.
    const offeredSets = targetClassIds.map(
      (classId) =>
        new Set(
          classSubjects
            .filter((row) => row.class_id === classId)
            .map((row) => row.subject_id),
        ),
    );
    return subjects
      .filter((subject) => offeredSets.every((set) => set.has(subject.id)))
      .filter((subject) => subjectAllowedInExam(subject, form.exam_type))
      .filter((subject) => {
        if (!isTeacher) return true;
        return teacherAssignments.some(
          (row) =>
            row.class_id === form.class_id &&
            row.subject_id === subject.id &&
            row.teacher_id === profile?.id,
        );
      })
      .sort((a, b) => String(a.code ?? "").localeCompare(String(b.code ?? "")));
  }, [targetClassIds, form.class_id, form.exam_type, classSubjects, subjects, isTeacher, teacherAssignments, profile]);

  const filteredSubjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return eligibleSubjects;
    return eligibleSubjects.filter((subject) =>
      `${subject.code ?? ""} ${subject.name ?? ""}`.toLowerCase().includes(needle),
    );
  }, [eligibleSubjects, query]);

  const selectedIds = useMemo(() => new Set(entries.map((entry) => entry.subjectId)), [entries]);

  const existingPapers = useMemo(
    () => flattenExistingPapers(groups, editing ? group?.id : null),
    [groups, editing, group],
  );

  const conflicts = useMemo(() => {
    const map = new Map();
    const add = (key, message) => {
      if (!map.has(key)) map.set(key, []);
      if (!map.get(key).includes(message)) map.get(key).push(message);
    };

    const scheduled = [];
    entries.forEach((entry) => {
      entry.papers.forEach((paper, index) => {
        const end = addMinutesToClock(paper.start_time, paper.duration_minutes);
        if (!paper.exam_date || !paper.start_time || !end || end <= paper.start_time) return;
        scheduled.push({
          key: `${entry.subjectId}:${index}`,
          classId: form.class_id,
          classLabel: selectedClass?.name ?? "this class",
          date: paper.exam_date,
          start: paper.start_time,
          end,
          room: cleanRoom(paper.room),
          teacherId: paper.teacher_id ?? "",
          allowOverlap: Boolean(paper.allow_overlap),
          label: `${subjectLabel(entry.subject)} ${entry.components?.find((component) => component.code === paper.code)?.name ?? paper.code ?? ""}`.trim(),
        });
      });
    });

    for (let first = 0; first < scheduled.length; first += 1) {
      for (let second = first + 1; second < scheduled.length; second += 1) {
        const left = scheduled[first];
        const right = scheduled[second];
        if (left.allowOverlap || right.allowOverlap) continue;
        if (!overlaps(left, right)) continue;
        if (left.classId === right.classId) {
          add(left.key, `Overlaps ${right.label} in this schedule.`);
          add(right.key, `Overlaps ${left.label} in this schedule.`);
        }
      }
    }

    scheduled.forEach((paper) => {
      if (paper.allowOverlap) return;
      existingPapers.forEach((other) => {
        if (other.allowOverlap) return;
        if (!overlaps(paper, other)) return;
        if (paper.classId === other.classId) {
          add(paper.key, `Overlaps ${other.label} for ${other.classLabel}.`);
        }
        if (paper.room && other.room && paper.room === other.room) {
          add(paper.key, `Room is already booked by ${other.label} (${other.classLabel}).`);
        }
        if (paper.teacherId && other.teacherId && paper.teacherId === other.teacherId) {
          const name = teacherById.get(paper.teacherId);
          add(
            paper.key,
            `${name ? teacherLabel(name) : "The invigilator"} is already assigned to ${other.label} (${other.classLabel}).`,
          );
        }
      });
    });

    return map;
  }, [entries, form.class_id, selectedClass, existingPapers, teacherById]);

  const problems = useMemo(() => {
    const list = [];
    if (!form.name.trim()) list.push("Give the examination a name.");
    if (scope === "department") {
      if (!form.department_id) list.push("Choose a department.");
      if (!form.course_id) list.push("Choose a course for the department examination.");
      if (targetClassIds.length === 0) list.push("No class matches the chosen department, course and year.");
    } else if (!form.class_id) {
      list.push("Choose a class.");
    }
    if (entries.length === 0) list.push("Add at least one subject to the scheduling panel.");
    if (form.starts_on && form.ends_on && form.ends_on < form.starts_on) {
      list.push("The end date cannot be before the start date.");
    }

    entries.forEach((entry) => {
      const label = subjectLabel(entry.subject);
      if (!componentMode && (!Number(entry.max_marks) || Number(entry.max_marks) <= 0)) {
        list.push(`${label}: maximum marks must be greater than zero.`);
      }
      entry.papers.forEach((paper, index) => {
        const end = addMinutesToClock(paper.start_time, paper.duration_minutes);
        const touched = paper.exam_date || paper.start_time || paper.duration_minutes;
        if (touched && (!paper.exam_date || !paper.start_time || !paper.duration_minutes)) {
          list.push(`${label}: set a date, start time and duration together.`);
        }
        if (paper.start_time && paper.duration_minutes && (!end || end <= paper.start_time)) {
          list.push(`${label}: the duration must end after the start time.`);
        }
        if (paper.exam_date && form.starts_on && paper.exam_date < form.starts_on) {
          list.push(`${label}: a paper is before the examination start date.`);
        }
        if (paper.exam_date && form.ends_on && paper.exam_date > form.ends_on) {
          list.push(`${label}: a paper is after the examination end date.`);
        }
        const messages = conflicts.get(`${entry.subjectId}:${index}`) ?? [];
        if (messages.length > 0 && !paper.allow_overlap) {
          list.push(`${label}: ${messages[0]}`);
        }
      });
    });

    return [...new Set(list)];
  }, [form, entries, componentMode, conflicts, targetClassIds, scope]);

  const updateForm = (patch) => setForm((current) => ({ ...current, ...patch }));

  const resetEntries = () => {
    setEntries([]);
    setPicked([]);
    setRemovedSubjectIds([]);
  };

  const changeScope = (value) => {
    updateForm({ scope: value, class_id: "", semester: "" });
    resetEntries();
  };
  const changeDegree = (value) => {
    updateForm({ degree_id: value, department_id: "", course_id: "", academic_year: "", semester: "", class_id: "" });
    resetEntries();
  };
  const changeDepartment = (value) => {
    updateForm({ department_id: value, course_id: "", academic_year: "", semester: "", class_id: "" });
    resetEntries();
  };
  const changeCourse = (value) => {
    updateForm({ course_id: value, academic_year: "", semester: "", class_id: "" });
    resetEntries();
  };
  const changeYear = (value) => {
    updateForm({ academic_year: value, semester: "", class_id: "" });
    resetEntries();
  };
  const changeSemester = (value) => {
    updateForm({ semester: value, class_id: "" });
    resetEntries();
  };
  const changeClass = (value) => {
    updateForm({ class_id: value });
    resetEntries();
  };
  const changeExamType = (value) => {
    updateForm({ exam_type: examTypeForActivity(value) });
    resetEntries();
  };

  const addSubject = (subject) => {
    if (!subject || selectedIds.has(subject.id)) return;
    const draft = { subjectId: subject.id, subject, examSubjectId: null, examId: null, components: [], originalCodes: [], teacher_id: defaultTeacherFor(subject.id), max_marks: Number(subject.max_marks) || 100, pass_marks: Math.round((Number(subject.max_marks) || 100) * 0.4), papers: [] };
    const components = componentsForEntry(draft);
    if (componentMode && components.length === 0) {
      setError(`${subjectLabel(subject)} has no assessment structure. Set one up in Assessment Setup first.`);
      return;
    }
    setError("");
    const paper = newPaper(subject, components, defaultTeacherFor(subject.id));
    // A regular class test or unit test is one short subject paper; the ESA
    // default of three hours only applies to semester component papers.
    if (!componentMode) paper.duration_minutes = "60";
    setEntries((current) => [
      ...current,
      { ...draft, papers: [paper] },
    ]);
  };

  const addPicked = () => {
    picked.forEach((subjectId) => {
      const subject = subjectById.get(subjectId);
      if (subject) addSubject(subject);
    });
    setPicked([]);
  };

  const removeSubject = (subjectId) => {
    const entry = entries.find((row) => row.subjectId === subjectId);
    if (entry?.examSubjectId) setRemovedSubjectIds((current) => [...current, entry.examSubjectId]);
    setEntries((current) => current.filter((row) => row.subjectId !== subjectId));
  };

  const togglePicked = (subjectId) => {
    setPicked((current) =>
      current.includes(subjectId) ? current.filter((id) => id !== subjectId) : [...current, subjectId],
    );
  };

  const updatePaper = (subjectId, index, patch) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.subjectId === subjectId
          ? { ...entry, papers: entry.papers.map((paper, paperIndex) => (paperIndex === index ? { ...paper, ...patch } : paper)) }
          : entry,
      ),
    );
  };

  const addPaper = (subjectId) => {
    setEntries((current) =>
      current.map((entry) => {
        if (entry.subjectId !== subjectId) return entry;
        const components = componentsForEntry(entry);
        const used = new Set(entry.papers.map((paper) => paper.code));
        const next = components.find((component) => isFormalComponent(component) && !used.has(component.code));
        if (!next) return entry;
        return {
          ...entry,
          papers: [...entry.papers, newPaper(entry.subject, [next], entry.teacher_id || defaultTeacherFor(subjectId))],
        };
      }),
    );
  };

  const removePaper = (subjectId, index) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.subjectId === subjectId
          ? { ...entry, papers: entry.papers.filter((_, paperIndex) => paperIndex !== index) }
          : entry,
      ),
    );
  };

  const applyBulk = () => {
    const hasInput =
      bulk.exam_date || bulk.start_time || bulk.duration_minutes || bulk.rooms.trim() || bulk.teacher_ids.length > 0;
    if (!hasInput) {
      setError("Fill at least one bulk field before applying.");
      return;
    }
    const rooms = bulk.rooms.split(",").map((room) => room.trim()).filter(Boolean);
    // Build the next list outside the state updater. StrictMode invokes an
    // updater twice, and the running paper index is a side effect, so it must
    // not live inside the updater or the rotation would skip a slot.
    let flat = 0;
    const nextEntries = entries.map((entry) => ({
      ...entry,
      papers: entry.papers.map((paper) => {
        const next = {
          ...paper,
          exam_date: bulk.exam_date ? addDays(bulk.exam_date, flat * (Number(bulk.stagger_days) || 0)) : paper.exam_date,
          start_time: bulk.start_time || paper.start_time,
          duration_minutes: bulk.duration_minutes || paper.duration_minutes,
          room: !classworkActivity && rooms.length > 0 ? rooms[flat % rooms.length] : paper.room,
          teacher_id:
            !classworkActivity && bulk.teacher_ids.length > 0
              ? bulk.teacher_ids[flat % bulk.teacher_ids.length]
              : paper.teacher_id,
        };
        flat += 1;
        return next;
      }),
    }));
    setEntries(nextEntries);
    setError("");
    setNotice(
      `Applied the bulk schedule${bulk.exam_date ? ` from ${bulk.exam_date}` : ""}${
        Number(bulk.stagger_days) > 0 ? `, staggered by ${bulk.stagger_days} day(s)` : ""
      }.`,
    );
    onNotify?.(`Bulk schedule applied to ${entries.reduce((total, entry) => total + entry.papers.length, 0)} paper(s).`);
  };

  const buildPayload = () =>
    entries.map((entry) => {
      const teacherId = entry.teacher_id || defaultTeacherFor(entry.subjectId) || null;
      const components = componentsForEntry(entry);

      if (componentMode && components.length > 0) {
        const payloadComponents = components.map((component) => {
          if (isClassworkComponent(component)) {
            return {
              code: component.code,
              is_conducted: true,
              exam_date: null,
              start_time: null,
              end_time: null,
              room: null,
              teacher_id: null,
              allow_overlap: false,
            };
          }
          const paper = entry.papers.find((row) => row.code === component.code);
          if (!paper) {
            // A paper without a row is simply not dated yet. Keep it conducted so
            // creating an exam never silently drops IA1, IA2 or a viva from the
            // assessment structure; the group card has an explicit toggle for
            // turning a paper off.
            return {
              code: component.code,
              is_conducted: true,
              exam_date: null,
              start_time: null,
              end_time: null,
              room: null,
              teacher_id: null,
              allow_overlap: false,
            };
          }
          return {
            code: component.code,
            is_conducted: true,
            exam_date: paper.exam_date || null,
            start_time: paper.start_time || null,
            end_time: addMinutesToClock(paper.start_time, paper.duration_minutes) || null,
            room: paper.room?.trim() || null,
            teacher_id: paper.teacher_id || null,
            allow_overlap: Boolean(paper.allow_overlap),
          };
        });

        return {
          subject_id: entry.subjectId,
          exam_date: null,
          start_time: null,
          end_time: null,
          max_marks: Number(templateForSubject(entry.subject)?.total_marks) || Number(entry.max_marks) || 100,
          pass_marks: null,
          teacher_id: teacherId,
          room: null,
          instructions: "",
          allow_overlap: false,
          is_optional: false,
          components: payloadComponents,
        };
      }

      const paper = entry.papers[0] ?? {};
      return {
        subject_id: entry.subjectId,
        exam_date: paper.exam_date || null,
        start_time: paper.start_time || null,
        end_time: addMinutesToClock(paper.start_time, paper.duration_minutes) || null,
        max_marks: Number(entry.max_marks) || 100,
        pass_marks: entry.pass_marks === "" ? null : Number(entry.pass_marks),
        teacher_id: classworkActivity ? null : teacherId,
        room: classworkActivity ? null : paper.room?.trim() || null,
        instructions: "",
        allow_overlap: Boolean(paper.allow_overlap),
        is_optional: false,
      };
    });

  const saveCreate = async () => {
    // The paper dates are the real schedule. If the operator leaves the group
    // window blank, derive it from the earliest and latest dated paper so the
    // group is not listed as "not scheduled".
    const paperDates = entries
      .flatMap((entry) => entry.papers.map((paper) => paper.exam_date))
      .filter(Boolean)
      .sort();
    const startsOn = form.starts_on || paperDates[0] || null;
    const endsOn = form.ends_on || paperDates[paperDates.length - 1] || null;

    const groupId = await callRpc("create_exam_group", {
      p_name: form.name.trim(),
      p_exam_type: form.exam_type,
      p_scope: scope,
      p_department_id: form.department_id || null,
      p_course_id: form.course_id || null,
      p_academic_year: form.academic_year || selectedClass?.academic_year || null,
      p_academic_term_id: null,
      p_class_ids: scope === "department" ? targetClassIds : [form.class_id],
      p_starts_on: startsOn,
      p_ends_on: endsOn,
      p_instructions: form.instructions || "",
      p_status: form.status,
      p_subjects: buildPayload(),
    });
    onNotify?.(`Saved "${form.name.trim()}".`);
    onSaved?.(groupId);
  };

  const saveEdit = async () => {
    if (form.status !== group.status) {
      await callRpc("set_exam_group_status", { p_group_id: group.id, p_status: form.status });
    }

    for (const examSubjectId of removedSubjectIds) {
      await callRpc("remove_exam_subject", { p_exam_subject_id: examSubjectId });
    }

    for (const entry of entries) {
      let components = componentsForEntry(entry);
      let examSubjectId = entry.examSubjectId;

      if (!examSubjectId) {
        examSubjectId = await callRpc("add_exam_subject", {
          p_exam_id: groupExam.id,
          p_subject_id: entry.subjectId,
          p_teacher_id: entry.teacher_id || defaultTeacherFor(entry.subjectId) || null,
          p_max_marks: Number(entry.max_marks) || null,
          p_pass_marks: entry.pass_marks === "" ? null : Number(entry.pass_marks),
        });
        const { data, error: componentError } = await supabase
          .from("assessment_components")
          .select("id, code, name, component_type, schedule_mode, exam_date, start_time, end_time, duration_minutes, room, teacher_id, allow_overlap, is_conducted, display_order")
          .eq("exam_subject_id", examSubjectId)
          .order("display_order");
        if (componentError) throw new Error(componentError.message);
        components = sortComponents(data ?? []);
      }

      if (componentMode && components.length > 0) {
        for (const paper of entry.papers) {
          const component = components.find((row) => row.code === paper.code);
          if (!component) continue;
          await callRpc("update_assessment_component_schedule", {
            p_component_id: component.id,
            p_patch: {
              is_conducted: true,
              exam_date: paper.exam_date || null,
              start_time: paper.start_time || null,
              duration_minutes: paper.duration_minutes ? Number(paper.duration_minutes) : null,
              room: paper.room?.trim() || null,
              teacher_id: paper.teacher_id || null,
              allow_overlap: Boolean(paper.allow_overlap),
            },
          });
        }

        for (const code of entry.originalCodes) {
          if (entry.papers.some((paper) => paper.code === code)) continue;
          const component = components.find((row) => row.code === code);
          if (!component) continue;
          await callRpc("update_assessment_component_schedule", {
            p_component_id: component.id,
            p_patch: { is_conducted: false },
          });
        }
      } else {
        const paper = entry.papers[0] ?? {};
        await callRpc("update_exam_subject_schedule", {
          p_exam_subject_id: examSubjectId,
          p_exam_date: paper.exam_date || null,
          p_start_time: paper.start_time || null,
          p_end_time: addMinutesToClock(paper.start_time, paper.duration_minutes) || null,
          p_max_marks: Number(entry.max_marks) || null,
          p_pass_marks: entry.pass_marks === "" ? null : Number(entry.pass_marks),
          p_teacher_id: entry.teacher_id || defaultTeacherFor(entry.subjectId) || null,
          p_instructions: null,
          p_room: paper.room?.trim() || null,
          p_allow_overlap: Boolean(paper.allow_overlap),
        });
      }
    }

    onNotify?.(`Updated the schedule for "${group.name}".`);
    onSaved?.(group.id);
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (problems.length > 0) {
      setError(problems[0]);
      return;
    }
    setSaving(true);
    try {
      if (editing) await saveEdit();
      else await saveCreate();
    } catch (err) {
      setError(err.message ?? "Could not save the schedule.");
    } finally {
      setSaving(false);
    }
  };

  const typeOptions = examTypesForRole(profile?.role);
  const bulkPaperCount = entries.reduce((total, entry) => total + entry.papers.length, 0);
  const classLabel = selectedClass ? `${selectedClass.name}, ${derivedBatch(selectedClass)}` : "";

  return (
    <Card className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-(--foreground)">
            {editing ? `Edit schedule, ${group.name}` : "Class examination scheduler"}
          </p>
          <p className="mt-1 text-xs text-(--muted-foreground)">
            {editing
              ? "Paper changes apply to every class in this examination. Published examinations stay read-only."
              : "Pick the class, add its subjects, then schedule each paper with its own date, room and invigilator."}
          </p>
        </div>
        {onCancel ? (
          <Button type="button" variant="subtle" onClick={onCancel}>
            Close
          </Button>
        ) : null}
      </div>

      <form onSubmit={submit} className="mt-5 space-y-6">
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-(--foreground)">1. Choose the scope</p>
            {editing ? (
              <span className="rounded-full border border-(--border) px-2.5 py-1 text-[11px] text-(--muted-foreground)">
                {scope === "department"
                  ? `Department examination, ${group?.exams?.length ?? 0} classes`
                  : "Class is fixed for this examination"}
              </span>
            ) : null}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Field label="Schedule for">
              <Select
                value={form.scope}
                onChange={(event) => changeScope(event.target.value)}
                disabled={editing || isTeacher}
              >
                <option value="class">One class</option>
                <option value="department">A department</option>
              </Select>
            </Field>
            <Field label="Degree">
              <Select value={form.degree_id} onChange={(event) => changeDegree(event.target.value)} disabled={editing}>
                <option value="">Any degree</option>
                {degreeOptions.map((degree) => (
                  <option key={degree.id} value={degree.id}>{degree.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Department">
              <Select value={form.department_id} onChange={(event) => changeDepartment(event.target.value)} disabled={editing}>
                <option value="">{scope === "department" ? "Choose a department" : "Any department"}</option>
                {departmentOptions.map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Course">
              <Select value={form.course_id} onChange={(event) => changeCourse(event.target.value)} disabled={editing}>
                <option value="">{scope === "department" ? "Choose a course" : "Any course"}</option>
                {courseOptions.map((course) => (
                  <option key={course.id} value={course.id}>{course.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Academic year">
              <Select value={form.academic_year} onChange={(event) => changeYear(event.target.value)} disabled={editing}>
                <option value="">Any year</option>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </Select>
            </Field>
            <Field label="Semester">
              <Select value={form.semester} onChange={(event) => changeSemester(event.target.value)} disabled={editing}>
                <option value="">Any semester</option>
                {semesterOptions.map((semester) => (
                  <option key={semester} value={semester}>Semester {semester}</option>
                ))}
              </Select>
            </Field>
            {scope === "department" ? (
              <Field label="Classes">
                <p className="rounded-lg border border-(--border-subtle) bg-(--surface-secondary)/40 px-3 py-2.5 text-sm text-(--foreground)">
                  {targetClassIds.length === 0
                    ? "No class matches yet"
                    : `${targetClassIds.length} class${targetClassIds.length === 1 ? "" : "es"} included`}
                </p>
              </Field>
            ) : (
              <Field label="Class">
                <Select value={form.class_id} onChange={(event) => changeClass(event.target.value)} disabled={editing}>
                  <option value="">Choose a class</option>
                  {classOptions.map((klass) => (
                    <option key={klass.id} value={klass.id}>
                      {klass.name}, {derivedBatch(klass)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Examination name">
            <input
              className={inputClass}
              value={form.name}
              onChange={(event) => updateForm({ name: event.target.value })}
              placeholder="Enter exam name"
              required
              disabled={editing}
            />
          </Field>
          <Field label="Type">
            <Select value={activity} onChange={(event) => changeExamType(event.target.value)} disabled={editing}>
              {(typeOptions.length > 0 ? typeOptions : [{ id: activity, label: activity }]).map((type) => (
                <option key={type.id} value={type.id}>{type.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(event) => updateForm({ status: event.target.value })}>
              <option value="draft">Draft</option>
              <option value="open">Open</option>
              <option value="ongoing">Ongoing</option>
              <option value="completed">Completed</option>
              {editing ? <option value="cancelled">Cancelled</option> : null}
            </Select>
          </Field>
          <Field label="Papers">
            <p className="rounded-lg border border-(--border-subtle) bg-(--surface-secondary)/40 px-3 py-2.5 text-sm text-(--foreground)">
              {componentMode
                ? "IA1, IA2 and ESA per subject"
                : classworkActivity
                  ? "Classwork, no room or invigilator"
                  : "One subject paper"}
            </p>
          </Field>
          <Field label="Starts on">
            <input
              type="date"
              className={inputClass}
              value={form.starts_on}
              onChange={(event) => updateForm({ starts_on: event.target.value })}
              disabled={editing}
            />
          </Field>
          <Field label="Ends on">
            <input
              type="date"
              className={inputClass}
              value={form.ends_on}
              onChange={(event) => updateForm({ ends_on: event.target.value })}
              disabled={editing}
            />
          </Field>
          <Field label="Instructions">
            <textarea
              className={textareaClass}
              rows={2}
              value={form.instructions}
              onChange={(event) => updateForm({ instructions: event.target.value })}
              placeholder="Reporting time, permitted materials, seating notes."
              disabled={editing}
            />
          </Field>
        </section>

        <p className="rounded-lg border border-(--border-subtle) bg-(--surface-secondary)/40 px-3 py-2 text-[11px] text-(--muted-foreground)">
          {componentMode
            ? "ESA papers are scheduled one row at a time. Quiz, Assignment and Project stay classwork and never need a room or invigilator. The assessment structure still controls direct-mark or breakdown entry in Marks Entry."
            : classworkActivity
              ? "Project and Quiz are classwork activities. They are marked in class and never take a date, room or invigilator."
              : isTeacher
                ? "Teachers schedule their own IA1, Quiz, Project, Practical and Viva activities. IA2 and ESA papers belong to an ESA examination managed by the Exam Cell."
                : "Single-paper activities keep one subject paper. Practical subjects belong in a Practical or ESA examination."}
        </p>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)]">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-(--foreground)">2. Assigned subjects</p>
              <span className="text-xs text-(--muted-foreground) tabular-nums">
                {eligibleSubjects.length} available
              </span>
            </div>
            <input
              type="search"
              className={`${inputClass} mt-3`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search code or subject"
              aria-label="Search assigned subjects"
            />

            {targetClassIds.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-(--border) px-4 py-4 text-xs text-(--muted-foreground)">
                {scope === "department"
                  ? "Choose a department and course. Every matching class is included and its shared subjects appear here."
                  : "Choose the academic filters and a class. Its assigned subjects appear here."}
              </p>
            ) : eligibleSubjects.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-(--border) px-4 py-4 text-xs text-(--muted-foreground)">
                {isTeacher
                  ? "No subject in this class is assigned to you for this examination type."
                  : scope === "department"
                    ? "No subject is shared by every class in this department for the examination type."
                    : "No subject in this class matches the examination type."}
              </p>
            ) : (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button type="button" variant="subtle" onClick={addPicked} disabled={picked.length === 0 || !canChangeSubjectList}>
                    Add selected ({picked.length})
                  </Button>
                  <span className="text-[11px] text-(--muted-foreground)">
                    Or drag a card into the panel.
                  </span>
                </div>
                <ul className="mt-3 max-h-[32rem] space-y-2 overflow-y-auto pr-1">
                  {filteredSubjects.map((subject) => {
                    const selected = selectedIds.has(subject.id);
                    const template = templateForSubject(subject);
                    const components = componentsForEntry({ subject, components: [] });
                    const blocked = componentMode && components.length === 0;
                    return (
                      <li
                        key={subject.id}
                        draggable={canChangeSubjectList && !selected && !blocked}
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/plain", subject.id);
                          event.dataTransfer.effectAllowed = "copy";
                        }}
                        className={`rounded-xl border p-3 transition-colors ${
                          selected
                            ? "border-(--primary)/40 bg-(--primary)/5"
                            : "border-(--border-subtle) hover:border-(--primary)/30"
                        } ${canChangeSubjectList && !selected && !blocked ? "cursor-grab active:cursor-grabbing" : ""}`}
                      >
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-0.5 size-4 rounded border-(--border) accent-(--primary) focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2"
                            checked={picked.includes(subject.id)}
                            onChange={() => togglePicked(subject.id)}
                            disabled={!canChangeSubjectList}
                            aria-label={`Select ${subjectLabel(subject)}`}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-(--foreground)">{subjectLabel(subject)}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-(--muted-foreground)">
                              <span>{subject.credit_hours != null ? `${subject.credit_hours} credits` : "Credits not set"}</span>
                              <span aria-hidden="true">/</span>
                              <span>{isPracticalSubject(subject) ? "Practical" : "Theory"}</span>
                              {template ? (
                                <>
                                  <span aria-hidden="true">/</span>
                                  <span>{template.mode === "direct" ? "Direct marks" : "Assessment breakdown"}</span>
                                </>
                              ) : null}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="subtle"
                            className="px-2.5 py-1 text-[11px]"
                            onClick={() => (selected ? removeSubject(subject.id) : addSubject(subject))}
                            disabled={!canChangeSubjectList || (blocked && !selected)}
                          >
                            {selected ? "Remove" : "Add"}
                          </Button>
                        </div>
                        {blocked ? (
                          <p className="mt-2 text-[11px] text-(--danger)">
                            No assessment structure. Set one up in Assessment Setup.
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>

          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              const subjectId = event.dataTransfer.getData("text/plain");
              const subject = subjectById.get(subjectId);
              if (subject && canChangeSubjectList) addSubject(subject);
            }}
            className={`rounded-xl border p-3 transition-colors ${
              dragOver ? "border-(--primary) bg-(--primary)/5" : "border-(--border-subtle)"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-(--foreground)">3. Scheduling panel</p>
              <span className="text-xs text-(--muted-foreground) tabular-nums">
                {entries.length} subject{entries.length === 1 ? "" : "s"}, {bulkPaperCount} paper{bulkPaperCount === 1 ? "" : "s"}
              </span>
            </div>

            {entries.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-(--border) px-4 py-6 text-center text-xs text-(--muted-foreground)">
                Add subjects from the left, or drop them here.
              </p>
            ) : (
              <>
                <div className="mt-3 rounded-xl border border-(--border-subtle) bg-(--surface-secondary)/30 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium text-(--foreground)">Bulk schedule</p>
                    <span className="text-[11px] text-(--muted-foreground)">
                      Dates stagger by default so papers do not collide.
                    </span>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Date">
                      <input
                        type="date"
                        className={smallInput}
                        value={bulk.exam_date}
                        onChange={(event) => setBulk((current) => ({ ...current, exam_date: event.target.value }))}
                      />
                    </Field>
                    <Field label="Start time">
                      <input
                        type="time"
                        className={smallInput}
                        value={bulk.start_time}
                        onChange={(event) => setBulk((current) => ({ ...current, start_time: event.target.value }))}
                      />
                    </Field>
                    <Field label="Duration (minutes)">
                      <input
                        type="number"
                        min={1}
                        className={smallInput}
                        value={bulk.duration_minutes}
                        onChange={(event) => setBulk((current) => ({ ...current, duration_minutes: event.target.value }))}
                      />
                    </Field>
                    {!classworkActivity ? (
                      <Field label="Rooms, comma separated">
                        <input
                          className={smallInput}
                          value={bulk.rooms}
                          onChange={(event) => setBulk((current) => ({ ...current, rooms: event.target.value }))}
                          placeholder="Room 101, Room 102"
                        />
                      </Field>
                    ) : null}
                    <Field label="Stagger by (days)">
                      <input
                        type="number"
                        min={0}
                        className={smallInput}
                        value={bulk.stagger_days}
                        onChange={(event) => setBulk((current) => ({ ...current, stagger_days: event.target.value }))}
                      />
                    </Field>
                    {!classworkActivity ? (
                      <Field label="Invigilators">
                        <div className="max-h-24 overflow-y-auto rounded-lg border border-(--border-subtle) bg-(--surface-secondary) p-2">
                          {teachers.length === 0 ? (
                            <p className="text-[11px] text-(--muted-foreground)">No active teacher.</p>
                          ) : null}
                          {teachers.map((teacher) => (
                            <label key={teacher.id} className="flex items-center gap-2 py-0.5 text-[11px] text-(--foreground)">
                              <input
                                type="checkbox"
                                className="size-3.5 rounded border-(--border) accent-(--primary)"
                                checked={bulk.teacher_ids.includes(teacher.id)}
                                onChange={() =>
                                  setBulk((current) => ({
                                    ...current,
                                    teacher_ids: current.teacher_ids.includes(teacher.id)
                                      ? current.teacher_ids.filter((id) => id !== teacher.id)
                                      : [...current.teacher_ids, teacher.id],
                                  }))
                                }
                              />
                              <span className="truncate">{teacherLabel(teacher)}</span>
                            </label>
                          ))}
                        </div>
                      </Field>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] text-(--muted-foreground)">
                      {classworkActivity
                        ? "Classwork has no room or invigilator, so only the date, time and duration apply."
                        : "Rooms and invigilators rotate in order when several are chosen."}
                    </p>
                    <Button type="button" variant="subtle" onClick={applyBulk} disabled={saving}>
                      Apply to {bulkPaperCount} paper{bulkPaperCount === 1 ? "" : "s"}
                    </Button>
                  </div>
                </div>

                <div className="mt-3 space-y-3">
                  {entries.map((entry) => {
                    const components = componentsForEntry(entry);
                    const formal = components.filter(isFormalComponent);
                    const classwork = components.filter(isClassworkComponent);
                    const template = templateForSubject(entry.subject);
                    return (
                      <div key={entry.subjectId} className="rounded-xl border border-(--border-subtle) p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-(--foreground)">{subjectLabel(entry.subject)}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-(--muted-foreground)">
                              <span>{entry.subject?.credit_hours != null ? `${entry.subject.credit_hours} credits` : "Credits not set"}</span>
                              <span aria-hidden="true">/</span>
                              <span>{isPracticalSubject(entry.subject) ? "Practical" : "Theory"}</span>
                              {template ? (
                                <>
                                  <span aria-hidden="true">/</span>
                                  <span>{template.name}</span>
                                </>
                              ) : null}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {componentMode && formal.length > 0 && entry.papers.length < formal.length ? (
                              <Button
                                type="button"
                                variant="subtle"
                                className="px-2.5 py-1 text-[11px]"
                                onClick={() => addPaper(entry.subjectId)}
                              >
                                Add paper
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="danger"
                              className="px-2.5 py-1 text-[11px]"
                              onClick={() => removeSubject(entry.subjectId)}
                              disabled={!canChangeSubjectList}
                            >
                              Remove subject
                            </Button>
                          </div>
                        </div>

                        {classwork.length > 0 ? (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {classwork.map((component) => (
                              <span
                                key={component.code}
                                className="rounded-full border border-(--border-subtle) bg-(--surface-secondary)/50 px-2.5 py-1 text-[11px] text-(--muted-foreground)"
                              >
                                {componentLabel(component)}: classwork, no room
                              </span>
                            ))}
                          </div>
                        ) : null}

                        {!componentMode ? (
                          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            <Field label="Maximum marks">
                              <input
                                type="number"
                                min={1}
                                className={smallInput}
                                value={entry.max_marks}
                                onChange={(event) =>
                                  setEntries((current) =>
                                    current.map((row) =>
                                      row.subjectId === entry.subjectId ? { ...row, max_marks: event.target.value } : row,
                                    ),
                                  )
                                }
                              />
                            </Field>
                            <Field label="Passing marks">
                              <input
                                type="number"
                                min={0}
                                className={smallInput}
                                value={entry.pass_marks}
                                onChange={(event) =>
                                  setEntries((current) =>
                                    current.map((row) =>
                                      row.subjectId === entry.subjectId ? { ...row, pass_marks: event.target.value } : row,
                                    ),
                                  )
                                }
                              />
                            </Field>
                            {!classworkActivity ? (
                              <Field label="Invigilator">
                                <Select
                                  className="py-1.5 text-xs"
                                  value={entry.teacher_id}
                                  onChange={(event) =>
                                    setEntries((current) =>
                                      current.map((row) =>
                                        row.subjectId === entry.subjectId ? { ...row, teacher_id: event.target.value } : row,
                                      ),
                                    )
                                  }
                                >
                                  <option value="">Use assigned teacher</option>
                                  {teachers.map((teacher) => (
                                    <option key={teacher.id} value={teacher.id}>{teacherLabel(teacher)}</option>
                                  ))}
                                </Select>
                              </Field>
                            ) : null}
                          </div>
                        ) : null}

                        <div className="mt-3 space-y-2">
                          {entry.papers.map((paper, index) => {
                            const messages = conflicts.get(`${entry.subjectId}:${index}`) ?? [];
                            return (
                              <div
                                key={`${entry.subjectId}:${index}`}
                                className={`rounded-lg border p-2.5 ${
                                  messages.length > 0 && !paper.allow_overlap
                                    ? "border-(--danger)/40 bg-(--danger-subtle)/30"
                                    : "border-(--border-subtle)"
                                }`}
                              >
                                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                  {componentMode ? (
                                    <Field label="Paper">
                                      <Select
                                        className="py-1.5 text-xs"
                                        value={paper.code}
                                        onChange={(event) => updatePaper(entry.subjectId, index, { code: event.target.value })}
                                      >
                                        {formal
                                          .filter(
                                            (component) =>
                                              component.code === paper.code ||
                                              !entry.papers.some((row, rowIndex) => rowIndex !== index && row.code === component.code),
                                          )
                                          .map((component) => (
                                            <option key={component.code} value={component.code}>
                                              {componentLabel(component)}
                                            </option>
                                          ))}
                                      </Select>
                                    </Field>
                                  ) : (
                                    <Field label="Paper">
                                      <p className="rounded-lg border border-(--border-subtle) bg-(--surface-secondary)/40 px-3 py-2 text-xs text-(--foreground)">
                                        Subject paper
                                      </p>
                                    </Field>
                                  )}
                                  <Field label="Date">
                                    <input
                                      type="date"
                                      className={smallInput}
                                      value={paper.exam_date}
                                      min={form.starts_on || undefined}
                                      max={form.ends_on || undefined}
                                      onChange={(event) => updatePaper(entry.subjectId, index, { exam_date: event.target.value })}
                                    />
                                  </Field>
                                  <Field label="Start time">
                                    <input
                                      type="time"
                                      className={smallInput}
                                      value={paper.start_time}
                                      onChange={(event) => updatePaper(entry.subjectId, index, { start_time: event.target.value })}
                                    />
                                  </Field>
                                  <Field label="Duration (minutes)">
                                    <input
                                      type="number"
                                      min={1}
                                      className={smallInput}
                                      value={paper.duration_minutes}
                                      onChange={(event) =>
                                        updatePaper(entry.subjectId, index, { duration_minutes: event.target.value })
                                      }
                                    />
                                  </Field>
                                  {!classworkActivity ? (
                                    <>
                                      <Field label="Room">
                                        <input
                                          className={smallInput}
                                          value={paper.room}
                                          onChange={(event) => updatePaper(entry.subjectId, index, { room: event.target.value })}
                                          placeholder="Block A, room 12"
                                        />
                                      </Field>
                                      <Field label="Invigilator">
                                        <Select
                                          className="py-1.5 text-xs"
                                          value={paper.teacher_id}
                                          onChange={(event) => updatePaper(entry.subjectId, index, { teacher_id: event.target.value })}
                                        >
                                          <option value="">Use assigned teacher</option>
                                          {teachers.map((teacher) => (
                                            <option key={teacher.id} value={teacher.id}>{teacherLabel(teacher)}</option>
                                          ))}
                                        </Select>
                                      </Field>
                                    </>
                                  ) : null}
                                  <div className="flex items-end gap-3">
                                    <label className="flex items-center gap-2 pb-1.5 text-[11px] text-(--muted-foreground)">
                                      <input
                                        type="checkbox"
                                        className="size-3.5 rounded border-(--border) accent-(--primary)"
                                        checked={paper.allow_overlap}
                                        onChange={(event) =>
                                          updatePaper(entry.subjectId, index, { allow_overlap: event.target.checked })
                                        }
                                      />
                                      Allow overlap
                                    </label>
                                    {entry.papers.length > 1 ? (
                                      <Button
                                        type="button"
                                        variant="danger"
                                        className="px-2 py-1 text-[11px]"
                                        onClick={() => removePaper(entry.subjectId, index)}
                                      >
                                        Remove
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>
                                {messages.length > 0 && !paper.allow_overlap ? (
                                  <ul className="mt-1.5 space-y-0.5">
                                    {messages.map((message) => (
                                      <li key={message} className="text-[11px] text-(--danger)">{message}</li>
                                    ))}
                                  </ul>
                                ) : null}
                                {paper.start_time && paper.duration_minutes ? (
                                  <p className="mt-1 text-[11px] text-(--muted-foreground)">
                                    Runs {paper.start_time} to {addMinutesToClock(paper.start_time, paper.duration_minutes) || "an invalid time"}.
                                  </p>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </section>

        {error ? (
          <p role="alert" className="rounded-lg border border-(--danger)/30 bg-(--danger-subtle)/40 px-3 py-2 text-xs text-(--danger)">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-xs text-(--success)">{notice}</p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--border-subtle) pt-4">
          <p className="text-[11px] text-(--muted-foreground)">
            {classLabel ? `${classLabel}. ` : ""}
            {classworkActivity
              ? "Classwork papers are marked in class, so no room, invigilator or timing check applies."
              : "Room, invigilator and timing conflicts are checked before saving."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {!editing && form.status !== "draft" ? (
              <Button
                type="button"
                variant="subtle"
                onClick={() => {
                  updateForm({ status: "draft" });
                  setNotice("Status set to draft. Submit to save the draft.");
                }}
                disabled={saving}
              >
                Mark as draft
              </Button>
            ) : null}
            <Button type="submit" disabled={saving || !form.class_id || entries.length === 0}>
              {saving ? "Saving…" : editing ? "Save schedule" : form.status === "draft" ? "Save draft" : "Schedule examination"}
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}
