// Module registry for the universal import wizard.
//
// A module owns everything that is specific to one Gradia table: its columns,
// how a file row resolves to a database payload, how existing records are
// detected, and how one validated row is written. The wizard and templates stay
// generic so every screen shares the same upload, mapping, validation and
// reporting experience.

import { supabase } from "../lib/supabase";
import { callRpc } from "../lib/db";
import { EXAM_STATUSES, EXAM_TYPES, MARK_STATUSES, REGULAR_EXAM_TYPES } from "../lib/exams";
import {
  asInt,
  asNumber,
  generatePassword,
  isEmail,
  norm,
  normaliseDate,
  optionalText,
  text,
  token,
} from "./schemaUtils";

const ADMIN_ONLY = ["admin"];
const EXAM_ROLES = ["admin", "teacher"];
const MARKS_ROLES = ["admin", "teacher"];

async function fetchRows(table, columns) {
  const { data, error } = await supabase.from(table).select(columns);
  if (error) throw new Error(`Could not load ${table}: ${error.message}`);
  return data ?? [];
}

function friendlyDbError(error, duplicateMessage) {
  if (!error) return "";
  if (error.code === "23505") return duplicateMessage ?? "A record with the same unique value already exists.";
  if (error.code === "23503") return "A referenced record no longer exists. Refresh the page and try again.";
  if (error.code === "42501") return "You do not have permission to import this record.";
  if (error.code === "23514") return "A value in this row does not meet the database rules.";
  return error.message;
}

function throwDb(error, duplicateMessage) {
  if (error) throw new Error(friendlyDbError(error, duplicateMessage));
}

function buildLookup(rows, keys) {
  const map = new Map();
  for (const row of rows ?? []) {
    for (const key of keys(row)) {
      const cleaned = norm(key);
      if (!cleaned) continue;
      const bucket = map.get(cleaned);
      if (!bucket) map.set(cleaned, [row]);
      else if (!bucket.some((item) => item.id === row.id)) bucket.push(row);
    }
  }
  return map;
}

function resolveOne(map, value) {
  const key = norm(value);
  if (!key) return { item: null };
  const bucket = map.get(key);
  if (!bucket || !bucket.length) return { item: null };
  if (bucket.length === 1) return { item: bucket[0] };
  return { item: null, ambiguous: true, count: bucket.length };
}

function addExisting(map, key, row) {
  if (!key) return;
  const current = map.get(key);
  if (!current) {
    map.set(key, { row });
    return;
  }
  if (current.row?.id === row.id) return;
  if (current.ambiguous) {
    if (!current.rows.some((item) => item.id === row.id)) {
      current.rows.push(row);
      current.count = current.rows.length;
    }
    return;
  }
  map.set(key, { ambiguous: true, rows: [current.row, row], count: 2 });
}

function departmentLookup(context) {
  return buildLookup(context.departments ?? [], (row) => [row.name, row.code]);
}

function findCourseInDepartment(courses, departmentId, value) {
  const key = norm(value);
  if (!key) return { item: null };
  const candidates = (courses ?? []).filter(
    (course) =>
      course.department_id === departmentId &&
      (norm(course.name) === key || (course.code && norm(course.code) === key)),
  );
  if (candidates.length === 1) return { item: candidates[0] };
  if (candidates.length > 1) return { item: null, ambiguous: true, count: candidates.length };
  return { item: null };
}

function findDegree(degrees, value) {
  const key = norm(value);
  if (!key) return { item: null };
  const candidates = (degrees ?? []).filter(
    (degree) => norm(degree.name) === key || (degree.code && norm(degree.code) === key),
  );
  if (candidates.length === 1) return { item: candidates[0] };
  if (candidates.length > 1) return { item: null, ambiguous: true, count: candidates.length };
  return { item: null };
}

function classLookup(context) {
  return buildLookup(context.classes ?? [], (row) => [
    row.name,
    row.section ? `${row.name} ${row.section}` : "",
    row.section ? `${row.name} (${row.section})` : "",
  ]);
}

function classRouteToken(row) {
  if (row.course_id && row.academic_year && row.semester != null && row.section) {
    return token("classes", "route", row.course_id, row.academic_year, row.semester, row.section)[0];
  }
  return classFallbackToken(row);
}

function classFallbackToken(row) {
  if (!row.name) return null;
  return token("classes", "name", row.name, row.academic_year ?? "", row.semester ?? "", row.section ?? "")[0];
}

function subjectLookup(context) {
  return buildLookup(context.subjects ?? [], (row) => [row.code, row.name]);
}

function personLookup(people) {
  return buildLookup(people ?? [], (row) => [row.student_id, row.teacher_id, row.username, row.email, row.name]);
}

function roleError(errors, field, message) {
  errors.push({ field, message });
}

const padClock = (value) => String(value).padStart(2, "0");

// Excel stores time cells as dates when cellDates is on, so read the clock
// parts instead of turning them into a full calendar date.
function normaliseTime(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return Number.NaN;
    return `${padClock(value.getHours())}:${padClock(value.getMinutes())}`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value >= 1) return Number.NaN;
    const total = Math.round(value * 24 * 60);
    return `${padClock(Math.floor(total / 60))}:${padClock(total % 60)}`;
  }
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(am|pm)?$/i);
  if (!match) return Number.NaN;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const suffix = (match[3] ?? "").toLowerCase();
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return Number.NaN;
  return `${padClock(hour)}:${padClock(minute)}`;
}

const clockKey = (value) => (value ? String(value).slice(0, 5) : "");

function asFlag(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  const key = norm(value);
  if (["true", "yes", "y", "1", "allow", "allowed"].includes(key)) return true;
  if (["false", "no", "n", "0", "block", "blocked"].includes(key)) return false;
  return Number.NaN;
}

function examTypeId(value) {
  const key = norm(value);
  if (!key) return null;
  const match = EXAM_TYPES.find((type) => norm(type.id) === key || norm(type.label) === key);
  return match?.id ?? undefined;
}

function examStatusId(value) {
  const key = norm(value);
  if (!key) return null;
  const match = EXAM_STATUSES.find((status) => norm(status.id) === key || norm(status.label) === key);
  return match?.id ?? undefined;
}

function groupWindowFor(context, exam) {
  if (!exam?.exam_group_id) return { startsOn: null, endsOn: null };
  const group = (context.examGroups ?? []).find((row) => row.id === exam.exam_group_id);
  return { startsOn: group?.starts_on ?? null, endsOn: group?.ends_on ?? null };
}

const departmentModule = {
  id: "departments",
  title: "Departments",
  templateName: "Department_Import_Template.xlsx",
  description: "Create or update the departments that courses, classes and staff belong to.",
  identityLabel: "Department",
  roles: ADMIN_ONLY,
  supportsUpdate: true,
  duplicateStrategies: ["new", "skip", "update"],
  defaultStrategy: "new",
  concurrency: 4,
  fields: [
    {
      key: "name",
      label: "Department name",
      required: true,
      aliases: ["name", "department", "department name", "dept", "dept name"],
      example: "Computer Science",
      help: "The full department name shown across Gradia.",
    },
    {
      key: "code",
      label: "Department code",
      required: false,
      aliases: ["code", "short code", "department code", "dept code"],
      example: "CSE",
      help: "A short unique code, for example CSE.",
    },
  ],
  exampleRows: [
    ["Computer Science", "CSE"],
    ["Mechanical Engineering", "MEC"],
  ],
  async loadContext() {
    return { departments: await fetchRows("departments", "id,name,code") };
  },
  resolveRow(values) {
    const errors = [];
    const name = text(values.name);
    const code = optionalText(values.code);
    if (!name) roleError(errors, "Department name", "is required.");
    if (code && code.length > 24) roleError(errors, "Department code", "must be 24 characters or fewer.");
    const identity = code ? token("departments", "code", code)[0] : token("departments", "name", name)[0];
    const altIdentities = [
      token("departments", "name", name)[0],
      code ? token("departments", "code", code)[0] : null,
    ].filter(Boolean);
    return {
      data: { name, code },
      errors,
      identity,
      altIdentities,
      label: code ? `${name} (${code})` : name,
    };
  },
  async findExisting(_records, context) {
    const map = new Map();
    for (const row of context.departments ?? []) {
      addExisting(map, token("departments", "name", row.name)[0], row);
      addExisting(map, token("departments", "code", row.code)[0], row);
    }
    return map;
  },
  async execute({ mode, data, existing }) {
    if (mode === "update" && existing) {
      const { error } = await supabase
        .from("departments")
        .update({ name: data.name, code: data.code })
        .eq("id", existing.id);
      throwDb(error, "Another department already uses that name or code.");
      return { status: "updated" };
    }
    const { error } = await supabase.from("departments").insert({ name: data.name, code: data.code });
    throwDb(error, "A department with that name or code already exists.");
    return { status: "created" };
  },
};

const degreeModule = {
  id: "degrees",
  title: "Degrees",
  templateName: "Degree_Import_Template.xlsx",
  description: "Create or update degrees in the shared degree catalogue.",
  identityLabel: "Degree",
  roles: ADMIN_ONLY,
  supportsUpdate: true,
  duplicateStrategies: ["new", "skip", "update"],
  defaultStrategy: "new",
  concurrency: 4,
  fields: [
    {
      key: "name",
      label: "Degree name",
      required: true,
      aliases: ["degree", "degree name", "name", "programme", "program"],
      example: "BSc",
      help: "Degree names are shared across the school and must be unique.",
    },
    {
      key: "code",
      label: "Degree code",
      required: false,
      aliases: ["code", "degree code", "programme code", "program code"],
      example: "BSC",
      help: "A short code that is unique across the degree catalogue.",
    },
  ],
  exampleRows: [
    ["BSc", "BSC"],
    ["MSc", "MSC"],
  ],
  async loadContext() {
    return {
      degrees: await fetchRows("degrees", "id,name,code"),
    };
  },
  resolveRow(values) {
    const errors = [];
    const name = text(values.name);
    if (!name) roleError(errors, "Degree name", "is required.");
    const code = optionalText(values.code);
    const identity = token("degrees", "name", name)[0];
    const altIdentities = [identity, code ? token("degrees", "code", code)[0] : null].filter(Boolean);
    return {
      data: { name, code },
      errors,
      identity,
      altIdentities,
      label: name,
    };
  },
  async findExisting(_records, context) {
    const map = new Map();
    for (const degree of context.degrees ?? []) {
      addExisting(map, token("degrees", "name", degree.name)[0], degree);
      addExisting(map, token("degrees", "code", degree.code)[0], degree);
    }
    return map;
  },
  async execute({ mode, data, existing }) {
    if (mode === "update" && existing) {
      const { error } = await supabase
        .from("degrees")
        .update({ name: data.name, code: data.code })
        .eq("id", existing.id);
      throwDb(error, "A degree with that name or code already exists.");
      return { status: "updated" };
    }
    const { error } = await supabase.from("degrees").insert({
      name: data.name,
      code: data.code,
    });
    throwDb(error, "A degree with that name or code already exists.");
    return { status: "created" };
  },
};

const courseModule = {
  id: "courses",
  title: "Courses",
  templateName: "Course_Import_Template.xlsx",
  description: "Create or update courses inside an existing department and degree.",
  identityLabel: "Course",
  roles: ADMIN_ONLY,
  supportsUpdate: true,
  duplicateStrategies: ["new", "skip", "update"],
  defaultStrategy: "new",
  concurrency: 4,
  fields: [
    {
      key: "department",
      label: "Department",
      required: true,
      aliases: ["department", "department name", "department code", "dept", "dept name", "dept code"],
      example: "Computer Science",
      help: "An existing department name or code.",
    },
    {
      key: "degree",
      label: "Degree",
      required: true,
      aliases: ["degree", "degree name", "degree code"],
      example: "BSc",
      help: "Must already exist in the degree catalogue. Matched by name or code.",
    },
    {
      key: "name",
      label: "Course name",
      required: true,
      aliases: ["course", "course name", "name", "programme", "program"],
      example: "BSc Computer Science",
      help: "Course names must be unique within the department.",
    },
    {
      key: "code",
      label: "Course code",
      required: false,
      aliases: ["code", "course code", "programme code", "program code"],
      example: "BSC-CS",
    },
    {
      key: "duration_years",
      label: "Duration in years",
      required: false,
      aliases: ["duration", "duration years", "duration in years", "years"],
      example: "4",
      help: "A whole number of years, for example 4.",
    },
  ],
  exampleRows: [
    ["Computer Science", "BSc", "BSc Computer Science", "BSC-CS", "4"],
    ["Computer Science", "MSc", "MSc Data Science", "MSC-DS", "2"],
  ],
  async loadContext() {
    return {
      departments: await fetchRows("departments", "id,name,code"),
      degrees: await fetchRows("degrees", "id,name,code"),
      courses: await fetchRows("courses", "id,name,code,department_id,degree_id,duration_years"),
    };
  },
  resolveRow(values, context) {
    const errors = [];
    const departments = departmentLookup(context);
    const departmentHit = resolveOne(departments, values.department);
    if (!departmentHit.item) {
      roleError(
        errors,
        "Department",
        departmentHit.ambiguous
          ? "matches more than one department. Use the exact name or code."
          : "was not found. Create the department first or check the spelling.",
      );
    }
    const degreeHit = findDegree(context.degrees, values.degree);
    if (!degreeHit.item) {
      roleError(
        errors,
        "Degree",
        degreeHit.ambiguous
          ? "matches more than one degree. Use the exact degree name or code."
          : "was not found in the degree catalogue. Create the degree first.",
      );
    }
    const name = text(values.name);
    if (!name) roleError(errors, "Course name", "is required.");
    const code = optionalText(values.code);
    let duration = null;
    if (text(values.duration_years)) {
      duration = asInt(values.duration_years);
      if (duration === null || Number.isNaN(duration) || duration < 1 || duration > 10) {
        roleError(errors, "Duration in years", "must be a whole number between 1 and 10.");
      }
    }
    const department = departmentHit.item;
    const degree = degreeHit.item;
    const identity = department
      ? token("courses", "department", department.id, "name", name)[0]
      : null;
    const altIdentities = [
      identity,
      department && code ? token("courses", "department", department.id, "code", code)[0] : null,
    ].filter(Boolean);
    return {
      data: {
        department_id: department?.id ?? null,
        degree_id: degree?.id ?? null,
        name,
        code,
        duration_years: duration,
      },
      errors,
      identity,
      altIdentities,
      label: department ? `${name} (${department.name})` : name,
    };
  },
  async findExisting(_records, context) {
    const map = new Map();
    for (const course of context.courses ?? []) {
      addExisting(map, token("courses", "department", course.department_id, "name", course.name)[0], course);
      addExisting(map, token("courses", "department", course.department_id, "code", course.code)[0], course);
    }
    return map;
  },
  async execute({ mode, data, existing }) {
    if (!data.department_id) {
      throw new Error("Department was not found. Refresh the reference data and try again.");
    }
    if (!data.degree_id) {
      throw new Error("Degree was not found. Refresh the reference data and try again.");
    }
    if (mode === "update" && existing) {
      const { error } = await supabase
        .from("courses")
        .update({
          name: data.name,
          code: data.code,
          department_id: data.department_id,
          degree_id: data.degree_id,
          duration_years: data.duration_years,
        })
        .eq("id", existing.id);
      throwDb(error, "This department already has a course with that name.");
      return { status: "updated" };
    }
    const { error } = await supabase.from("courses").insert({
      name: data.name,
      code: data.code,
      department_id: data.department_id,
      degree_id: data.degree_id,
      duration_years: data.duration_years,
    });
    throwDb(error, "This department already has a course with that name.");
    return { status: "created" };
  },
};

const classModule = {
  id: "classes",
  title: "Classes",
  templateName: "Class_Import_Template.xlsx",
  description: "Create or update class groups with their department, degree, course and semester details.",
  identityLabel: "Class",
  roles: ADMIN_ONLY,
  supportsUpdate: true,
  duplicateStrategies: ["new", "skip", "update"],
  defaultStrategy: "new",
  concurrency: 4,
  fields: [
    {
      key: "name",
      label: "Class name",
      required: true,
      aliases: ["class", "class name", "name", "group"],
      example: "CSE Semester 3, Section A",
    },
    {
      key: "department",
      label: "Department",
      required: true,
      aliases: ["department", "department name", "department code", "dept", "dept name", "dept code"],
      example: "Computer Science",
    },
    {
      key: "degree",
      label: "Degree",
      required: true,
      aliases: ["degree", "degree name", "degree code"],
      example: "BSc",
      help: "Must already exist in the degree catalogue and match the course degree.",
    },
    {
      key: "course",
      label: "Course",
      required: true,
      aliases: ["course", "course name", "course code", "programme", "program"],
      example: "BSc Computer Science",
      help: "Must already exist in the selected department. Matched by name or code.",
    },
    {
      key: "academic_year",
      label: "Academic year",
      required: true,
      aliases: ["academic year", "year", "session year"],
      example: "2026-27",
      help: "The academic year label, for example 2026-27.",
    },
    {
      key: "semester",
      label: "Semester",
      required: true,
      aliases: ["semester", "sem", "term"],
      example: "3",
      help: "A whole number from 1 to 12.",
    },
    {
      key: "section",
      label: "Section",
      required: true,
      aliases: ["section", "sec"],
      example: "A",
    },
    {
      key: "hod",
      label: "Department HOD",
      required: false,
      aliases: ["hod", "department hod", "head of department", "hod name", "hod email"],
      example: "",
      help: "Optional. Use the HOD name, username or email.",
    },
  ],
  exampleRows: [
    ["CSE Semester 3, Section A", "Computer Science", "BSc", "BSc Computer Science", "2026-27", "3", "A", ""],
    ["CSE Semester 3, Section B", "Computer Science", "BSc", "BSc Computer Science", "2026-27", "3", "B", ""],
  ],
  async loadContext() {
    return {
      departments: await fetchRows("departments", "id,name,code"),
      degrees: await fetchRows("degrees", "id,name,code"),
      courses: await fetchRows("courses", "id,name,code,department_id,degree_id"),
      classes: await fetchRows(
        "classes",
        "id,name,department,course_id,degree_id,academic_year,semester,section",
      ),
      profiles: await fetchRows(
        "profiles",
        "id,name,username,email,role,teacher_id,department_id,hod_type",
      ),
    };
  },
  resolveRow(values, context) {
    const errors = [];
    const departmentHit = resolveOne(departmentLookup(context), values.department);
    if (!departmentHit.item) {
      roleError(
        errors,
        "Department",
        departmentHit.ambiguous
          ? "matches more than one department. Use the exact name or code."
          : "was not found.",
      );
    }
    const name = text(values.name);
    if (!name) roleError(errors, "Class name", "is required.");
    const courseHit = departmentHit.item
      ? findCourseInDepartment(context.courses, departmentHit.item.id, values.course)
      : { item: null };
    if (!courseHit.item) {
      roleError(
        errors,
        "Course",
        courseHit.ambiguous
          ? "matches more than one course in this department. Use the exact course name or code."
          : "was not found in the selected department.",
      );
    }
    const degreeHit = findDegree(context.degrees, values.degree);
    if (!degreeHit.item) {
      roleError(
        errors,
        "Degree",
        degreeHit.ambiguous
          ? "matches more than one degree. Use the exact degree name or code."
          : "was not found in the degree catalogue.",
      );
    } else if (courseHit.item?.degree_id && courseHit.item.degree_id !== degreeHit.item.id) {
      roleError(errors, "Degree", "does not match the degree of the selected course.");
    }
    const academicYear = text(values.academic_year);
    if (!academicYear) roleError(errors, "Academic year", "is required.");
    const semester = asInt(values.semester);
    if (semester === null || Number.isNaN(semester) || semester < 1 || semester > 12) {
      roleError(errors, "Semester", "must be a whole number between 1 and 12.");
    }
    const section = text(values.section);
    if (!section) roleError(errors, "Section", "is required.");
    const hodValue = text(values.hod);
    let hod = null;
    if (hodValue) {
      // A class HOD must belong to the same department as the class. Subject
      // HODs are excluded because classes are assigned a department HOD.
      const allDepartmentHods = (context.profiles ?? []).filter(
        (p) => p.role === "hod" && p.hod_type !== "subject",
      );
      const sameDepartment = departmentHit.item
        ? allDepartmentHods.filter((p) => p.department_id === departmentHit.item.id)
        : allDepartmentHods;
      const hodHit = resolveOne(personLookup(sameDepartment), hodValue);
      if (hodHit.item) {
        hod = hodHit.item;
      } else if (hodHit.ambiguous) {
        roleError(
          errors,
          "Department HOD",
          "matches more than one HOD in this department. Use the exact name, username or email.",
        );
      } else if (departmentHit.item && resolveOne(personLookup(allDepartmentHods), hodValue).item) {
        roleError(errors, "Department HOD", "does not belong to the selected department.");
      } else {
        roleError(errors, "Department HOD", "was not found. Use the HOD name, username or email.");
      }
    }
    const course = courseHit.item;
    const degree = degreeHit.item;
    const identity = course
      ? token("classes", "route", course.id, academicYear, semester, section)[0]
      : null;
    const altIdentities = [
      identity,
      token("classes", "name", name, academicYear, semester, section)[0],
    ].filter(Boolean);
    return {
      data: {
        name,
        department: departmentHit.item?.name ?? "",
        degree_id: degree?.id ?? null,
        course_id: course?.id ?? null,
        academic_year: academicYear,
        semester,
        section,
        hod_id: hod?.id ?? null,
      },
      errors,
      identity,
      altIdentities,
      label: `${name}${academicYear ? `, ${academicYear}` : ""}${semester ? `, Semester ${semester}` : ""}${section ? `, Section ${section}` : ""}`,
    };
  },
  async findExisting(_records, context) {
    const map = new Map();
    for (const row of context.classes ?? []) {
      addExisting(map, classRouteToken(row), row);
      addExisting(map, classFallbackToken(row), row);
    }
    return map;
  },
  async execute({ mode, data, existing }) {
    if (!data.course_id) {
      throw new Error("Course was not found. Refresh the reference data and try again.");
    }
    if (!data.degree_id) {
      throw new Error("Degree was not found. Refresh the reference data and try again.");
    }
    if (mode === "update" && existing) {
      const { error } = await supabase
        .from("classes")
        .update({
          name: data.name,
          department: data.department,
          degree_id: data.degree_id,
          course_id: data.course_id,
          academic_year: data.academic_year,
          semester: data.semester,
          section: data.section,
          hod_id: data.hod_id,
        })
        .eq("id", existing.id);
      throwDb(error, "This class could not be updated.");
      return { status: "updated" };
    }
    const { error } = await supabase.from("classes").insert({
      name: data.name,
      department: data.department,
      degree_id: data.degree_id,
      course_id: data.course_id,
      academic_year: data.academic_year,
      semester: data.semester,
      section: data.section,
      hod_id: data.hod_id,
    });
    throwDb(error, "This class could not be created.");
    return { status: "created" };
  },
};

const subjectModule = {
  id: "subjects",
  title: "Subjects",
  templateName: "Subject_Import_Template.xlsx",
  description: "Add subjects to the institution-wide catalogue. Assign them to classes afterwards.",
  identityLabel: "Subject",
  roles: ADMIN_ONLY,
  supportsUpdate: true,
  duplicateStrategies: ["new", "skip", "update"],
  defaultStrategy: "new",
  concurrency: 4,
  fields: [
    {
      key: "name",
      label: "Subject name",
      required: true,
      aliases: ["subject", "subject name", "name"],
      example: "Data Structures",
    },
    {
      key: "code",
      label: "Subject code",
      required: true,
      aliases: ["code", "subject code", "paper code"],
      example: "CS201",
      help: "The code used on marks sheets, for example CS201.",
    },
    {
      key: "max_marks",
      label: "Maximum marks",
      required: false,
      aliases: ["max marks", "maximum marks", "max", "out of"],
      example: "100",
      help: "A whole number. Defaults to 100 when blank.",
    },
  ],
  exampleRows: [
    ["Data Structures", "CS201", "100"],
    ["Operating Systems", "CS202", "100"],
  ],
  async loadContext() {
    return { subjects: await fetchRows("subjects", "id,name,code,max_marks,class_id,teacher_id") };
  },
  resolveRow(values) {
    const errors = [];
    const name = text(values.name);
    if (!name) roleError(errors, "Subject name", "is required.");
    const code = text(values.code);
    if (!code) roleError(errors, "Subject code", "is required.");
    let maxMarks = 100;
    if (text(values.max_marks)) {
      maxMarks = asInt(values.max_marks);
      if (maxMarks === null || Number.isNaN(maxMarks) || maxMarks < 1 || maxMarks > 1000) {
        roleError(errors, "Maximum marks", "must be a whole number between 1 and 1000.");
      }
    }
    const identity = token("subjects", "code", code)[0];
    const altIdentities = [identity, token("subjects", "name", name)[0]].filter(Boolean);
    return {
      data: { name, code, max_marks: maxMarks },
      errors,
      identity,
      altIdentities,
      label: code ? `${code}, ${name}` : name,
    };
  },
  async findExisting(_records, context) {
    const map = new Map();
    for (const row of context.subjects ?? []) {
      addExisting(map, token("subjects", "code", row.code)[0], row);
      addExisting(map, token("subjects", "name", row.name)[0], row);
    }
    return map;
  },
  async execute({ mode, data, existing }) {
    if (mode === "update" && existing) {
      const { error } = await supabase
        .from("subjects")
        .update({ name: data.name, code: data.code, max_marks: data.max_marks })
        .eq("id", existing.id);
      throwDb(error, "A subject with that code already exists.");
      return { status: "updated" };
    }
    const { error } = await supabase.from("subjects").insert({
      name: data.name,
      code: data.code,
      max_marks: data.max_marks,
      class_id: null,
      teacher_id: null,
    });
    throwDb(error, "A subject with that code already exists.");
    return { status: "created" };
  },
};

const classSubjectModule = {
  id: "class_subjects",
  title: "Class subjects",
  templateName: "Class_Subject_Import_Template.xlsx",
  description: "Assign catalogue subjects to classes and allocate at least one teacher to each.",
  identityLabel: "Class subject",
  roles: ADMIN_ONLY,
  supportsUpdate: true,
  duplicateStrategies: ["new", "skip", "update"],
  defaultStrategy: "new",
  concurrency: 4,
  fields: [
    {
      key: "class",
      label: "Class",
      required: true,
      aliases: ["class", "class name", "group"],
      example: "CSE Semester 3, Section A",
    },
    {
      key: "subject",
      label: "Subject",
      required: true,
      aliases: ["subject", "subject code", "subject name", "paper"],
      example: "CS201",
      help: "Use the subject code or the exact subject name.",
    },
    {
      key: "teacher",
      label: "Teacher",
      required: true,
      aliases: ["teacher", "teacher name", "teacher id", "teacher email", "username"],
      example: "TCH1001",
      help: "Required. Use the teacher name, username, ID or email. Add more teachers from Manage subjects after import.",
    },
  ],
  exampleRows: [
    ["CSE Semester 3, Section A", "CS201", "TCH1001"],
    ["CSE Semester 3, Section A", "CS202", "TCH1002"],
  ],
  async loadContext() {
    return {
      classes: await fetchRows("classes", "id,name,department,course_id,academic_year,semester,section"),
      subjects: await fetchRows("subjects", "id,name,code,max_marks"),
      profiles: await fetchRows("profiles", "id,name,username,email,role,teacher_id"),
      classSubjects: await fetchRows("class_subjects", "id,class_id,subject_id"),
      teacherAssignments: await fetchRows("teacher_assignments", "id,class_id,subject_id,teacher_id"),
    };
  },
  resolveRow(values, context) {
    const errors = [];
    const classHit = resolveOne(classLookup(context), values.class);
    if (!classHit.item) {
      roleError(
        errors,
        "Class",
        classHit.ambiguous ? "matches more than one class. Use the exact class name." : "was not found.",
      );
    }
    const subjectHit = resolveOne(subjectLookup(context), values.subject);
    if (!subjectHit.item) {
      roleError(
        errors,
        "Subject",
        subjectHit.ambiguous
          ? "matches more than one subject. Use the subject code."
          : "was not found in the subject catalogue.",
      );
    }
    const teacherValue = text(values.teacher);
    let teacher = null;
    if (!teacherValue) {
      roleError(errors, "Teacher", "is required. Every class subject needs at least one teacher.");
    } else {
      const teacherHit = resolveOne(personLookup((context.profiles ?? []).filter((p) => p.role === "teacher")), teacherValue);
      if (!teacherHit.item) {
        roleError(errors, "Teacher", "was not found. Use the teacher name, username, ID or email.");
      } else {
        teacher = teacherHit.item;
      }
    }
    const klass = classHit.item;
    const subject = subjectHit.item;
    const identity = klass && subject ? token("class_subjects", klass.id, subject.id)[0] : null;
    return {
      data: {
        class_id: klass?.id ?? null,
        subject_id: subject?.id ?? null,
        teacher_id: teacher?.id ?? null,
      },
      errors,
      identity,
      altIdentities: identity ? [identity] : [],
      label: klass && subject ? `${klass.name}, ${subject.code}` : "",
    };
  },
  async findExisting(_records, context) {
    const map = new Map();
    const teachersByPair = new Map();
    (context.teacherAssignments ?? []).forEach((row) => {
      const key = `${row.class_id}:${row.subject_id}`;
      const teachers = teachersByPair.get(key) ?? [];
      teachers.push(row.teacher_id);
      teachersByPair.set(key, teachers);
    });
    for (const row of context.classSubjects ?? []) {
      const teacherIds = teachersByPair.get(`${row.class_id}:${row.subject_id}`) ?? [];
      addExisting(map, token("class_subjects", row.class_id, row.subject_id)[0], {
        ...row,
        teacher_ids: teacherIds,
        teacher_id: teacherIds[0] ?? null,
      });
    }
    return map;
  },
  async execute({ mode, data, existing }) {
    if (!data.class_id || !data.subject_id) {
      throw new Error("Class or subject was not found. Refresh the reference data and try again.");
    }
    if (existing && mode === "update") {
      if (!data.teacher_id) {
        return { status: "skipped", message: "Subject is already assigned and no teacher was supplied." };
      }
      if ((existing.teacher_ids ?? []).includes(data.teacher_id)) {
        return { status: "skipped", message: "That teacher is already assigned to this class subject." };
      }
      const { error } = await supabase
        .from("teacher_assignments")
        .insert({
          class_id: data.class_id,
          subject_id: data.subject_id,
          class_subject_id: existing.id,
          teacher_id: data.teacher_id,
          is_primary: (existing.teacher_ids ?? []).length === 0,
        });
      throwDb(error, "The teacher allocation could not be updated.");
      return { status: "updated" };
    }
    const { data: created, error } = await supabase
      .from("class_subjects")
      .insert({ class_id: data.class_id, subject_id: data.subject_id })
      .select("id")
      .single();
    throwDb(error, "This subject is already assigned to the class.");
    if (data.teacher_id) {
      const { error: teacherError } = await supabase
        .from("teacher_assignments")
        .insert({
          class_id: data.class_id,
          subject_id: data.subject_id,
          class_subject_id: created?.id ?? null,
          teacher_id: data.teacher_id,
          is_primary: true,
        });
      if (teacherError) {
        throw new Error(
          `Subject assigned, but the teacher allocation failed: ${friendlyDbError(teacherError)}`,
        );
      }
    }
    return { status: "created" };
  },
};

const userModule = {
  id: "users",
  title: "Users",
  templateName: "User_Import_Template.xlsx",
  description: "Create student, teacher, HOD, principal or admin accounts through the secure create-user function.",
  identityLabel: "User",
  roles: ADMIN_ONLY,
  supportsUpdate: false,
  duplicateStrategies: ["new", "skip"],
  defaultStrategy: "new",
  concurrency: 2,
  fields: [
    {
      key: "name",
      label: "Full name",
      required: true,
      aliases: ["full name", "name", "student name", "teacher name", "staff name"],
      example: "Aarav Sharma",
    },
    {
      key: "email",
      label: "Email",
      required: true,
      aliases: ["email", "email address", "e mail"],
      example: "aarav.sharma@example.edu",
    },
    {
      key: "username",
      label: "Username",
      required: false,
      aliases: ["username", "user name", "login"],
      example: "aarav.sharma",
      help: "Defaults to the part of the email before @.",
    },
    {
      key: "role",
      label: "Role",
      required: true,
      aliases: ["role", "user role", "account type"],
      example: "student",
      help: "Student, teacher, HOD, principal or admin. Staff is treated as teacher.",
    },
    {
      key: "password",
      label: "Password",
      required: false,
      aliases: ["password", "temporary password", "temp password"],
      example: "",
      help: "Leave blank to generate a temporary password. Minimum 6 characters when supplied.",
    },
    {
      key: "student_id",
      label: "Student ID",
      required: false,
      aliases: ["student id", "student number", "roll number", "roll no", "admission number"],
      example: "GRD2026001",
      help: "Required for students.",
    },
    {
      key: "teacher_id",
      label: "Teacher ID",
      required: false,
      aliases: ["teacher id", "employee id", "staff id"],
      example: "",
      help: "Required for teachers.",
    },
    {
      key: "department",
      label: "Department",
      required: false,
      aliases: ["department", "department name", "department code", "dept"],
      example: "Computer Science",
      help: "Required for students and department HODs.",
    },
    {
      key: "degree",
      label: "Degree",
      required: false,
      aliases: ["degree", "degree name", "degree code"],
      example: "BSc",
      help: "Required for students and department HODs. Must already exist in the degree catalogue.",
    },
    {
      key: "course",
      label: "Course",
      required: false,
      aliases: ["course", "course name", "course code", "programme"],
      example: "BSc Computer Science",
      help: "Required for students. Optional for department HODs. Must already exist in the selected department and degree.",
    },
    {
      key: "class",
      label: "Class",
      required: false,
      aliases: ["class", "class name", "group"],
      example: "CSE Semester 3, Section A",
      help: "Required for students.",
    },
    {
      key: "hod_type",
      label: "HOD type",
      required: false,
      aliases: ["hod type", "hod category", "hod"],
      example: "department",
      help: "department or subject. Defaults from the HOD subject column.",
    },
    {
      key: "hod_subject",
      label: "HOD subject",
      required: false,
      aliases: ["hod subject", "subject", "subject code"],
      example: "",
      help: "Required for subject HODs.",
    },
  ],
  exampleRows: [
    ["Aarav Sharma", "aarav.sharma@example.edu", "aarav.sharma", "student", "", "GRD2026001", "", "Computer Science", "BSc", "BSc Computer Science", "CSE Semester 3, Section A", "", ""],
    ["Meera Iyer", "meera.iyer@example.edu", "meera.iyer", "teacher", "", "", "TCH2026001", "", "", "", "", "", ""],
    ["Rohan Das", "rohan.das@example.edu", "rohan.das", "hod", "", "", "", "Computer Science", "BSc", "BSc Computer Science", "", "department", ""],
  ],
  async loadContext() {
    return {
      departments: await fetchRows("departments", "id,name,code"),
      degrees: await fetchRows("degrees", "id,name,code"),
      courses: await fetchRows("courses", "id,name,code,department_id,degree_id"),
      classes: await fetchRows("classes", "id,name,department,course_id,degree_id,academic_year,semester,section"),
      subjects: await fetchRows("subjects", "id,name,code"),
      profiles: await fetchRows(
        "profiles",
        "id,name,username,email,role,student_id,teacher_id,department_id,degree_id,course_id,class_id,is_active",
      ),
    };
  },
  resolveRow(values, context) {
    const errors = [];
    const name = text(values.name);
    if (!name) roleError(errors, "Full name", "is required.");
    const email = text(values.email).toLowerCase();
    if (!email) roleError(errors, "Email", "is required.");
    else if (!isEmail(email)) roleError(errors, "Email", "must be a valid email address.");
    const username = text(values.username) || (email ? email.split("@")[0] : "");
    if (!username) roleError(errors, "Username", "is required.");

    const roleKey = norm(values.role);
    const roleMap = {
      student: "student",
      teacher: "teacher",
      staff: "teacher",
      "teaching staff": "teacher",
      hod: "hod",
      "department hod": "hod",
      "subject hod": "hod",
      "department admin": "hod",
      "dept admin": "hod",
      principal: "principal",
      admin: "admin",
      "super admin": "admin",
      superadmin: "admin",
      "institution admin": "admin",
    };
    const role = roleMap[roleKey];
    if (!role) {
      roleError(errors, "Role", "must be student, teacher, HOD, principal or admin.");
    }

    const password = text(values.password);
    if (password && password.length < 6) {
      roleError(errors, "Password", "must contain at least 6 characters when supplied.");
    }

    let department = null;
    let degree = null;
    let course = null;
    let klass = null;
    let subject = null;

    let hodType = "";
    if (role === "hod") {
      const requested = norm(values.hod_type) || (text(values.hod_subject) ? "subject" : "department");
      if (!["department", "subject"].includes(requested)) {
        roleError(errors, "HOD type", "must be department or subject.");
      } else {
        hodType = requested;
      }
    }

    if (role === "student" || (role === "hod" && hodType === "department")) {
      const departmentHit = resolveOne(departmentLookup(context), values.department);
      if (!departmentHit.item) {
        roleError(
          errors,
          "Department",
          departmentHit.ambiguous ? "matches more than one department." : "is required for students and department HODs.",
        );
      } else {
        department = departmentHit.item;
      }
    }

    if ((role === "student" || (role === "hod" && hodType === "department")) && department) {
      const degreeHit = findDegree(context.degrees, values.degree);
      if (!degreeHit.item) {
        roleError(
          errors,
          "Degree",
          degreeHit.ambiguous
            ? "matches more than one degree."
            : "is required for students and department HODs and must exist in the degree catalogue.",
        );
      } else {
        degree = degreeHit.item;
      }
    }

    if (role === "hod" && hodType === "department" && department && text(values.course)) {
      const courseHit = findCourseInDepartment(context.courses, department.id, values.course);
      if (!courseHit.item) {
        roleError(
          errors,
          "Course",
          courseHit.ambiguous
            ? "matches more than one course in this department."
            : "does not belong to the selected department.",
        );
      } else {
        course = courseHit.item;
      }
    }

    if (role === "student") {
      const studentId = text(values.student_id);
      if (!studentId) roleError(errors, "Student ID", "is required for students.");
      const courseHit = department
        ? findCourseInDepartment(context.courses, department.id, values.course)
        : { item: null };
      if (!courseHit.item) {
        roleError(
          errors,
          "Course",
          courseHit.ambiguous
            ? "matches more than one course in this department."
            : "is required for students and must belong to the selected department.",
        );
      } else {
        course = courseHit.item;
      }
      const classHit = resolveOne(classLookup(context), values.class);
      if (!classHit.item) {
        roleError(
          errors,
          "Class",
          classHit.ambiguous ? "matches more than one class." : "is required for students.",
        );
      } else if (course && classHit.item.course_id && classHit.item.course_id !== course.id) {
        roleError(errors, "Class", "does not belong to the selected course.");
      } else if (degree && classHit.item.degree_id && classHit.item.degree_id !== degree.id) {
        roleError(errors, "Class", "does not belong to the selected degree.");
      } else {
        klass = classHit.item;
      }
    }

    if (degree && course?.degree_id && course.degree_id !== degree.id) {
      roleError(errors, "Degree", "does not match the degree of the selected course.");
    }

    if (role === "teacher") {
      const teacherId = text(values.teacher_id);
      if (!teacherId) roleError(errors, "Teacher ID", "is required for teachers.");
    }

    if (role === "hod" && hodType === "subject") {
      const subjectHit = resolveOne(subjectLookup(context), values.hod_subject);
      if (!subjectHit.item) {
        roleError(
          errors,
          "HOD subject",
          subjectHit.ambiguous ? "matches more than one subject." : "is required for subject HODs.",
        );
      } else {
        subject = subjectHit.item;
      }
    }

    const passwordValue = password || generatePassword();
    const identity = token("users", "email", email)[0];
    const altIdentities = [
      identity,
      token("users", "username", username)[0],
      role === "student" ? token("users", "student", values.student_id)[0] : null,
      role === "teacher" ? token("users", "teacher", values.teacher_id)[0] : null,
    ].filter(Boolean);

    return {
      data: {
        email,
        password: passwordValue,
        name,
        username,
        role,
        student_id: role === "student" ? text(values.student_id) : "",
        teacher_id: role === "teacher" ? text(values.teacher_id) : "",
        department_id: department?.id ?? "",
        degree_id: degree?.id ?? "",
        course_id: course?.id ?? "",
        class_id: klass?.id ?? "",
        hod_type: role === "hod" ? hodType : "",
        hod_subject_id: role === "hod" && hodType === "subject" ? subject?.id ?? "" : "",
        generated_password: !password,
      },
      errors,
      identity,
      altIdentities,
      label: `${name}${email ? `, ${email}` : ""}`,
      meta: { password: passwordValue, generated: !password },
    };
  },
  async findExisting(_records, context) {
    const map = new Map();
    for (const row of context.profiles ?? []) {
      addExisting(map, token("users", "email", row.email)[0], row);
      addExisting(map, token("users", "username", row.username)[0], row);
      addExisting(map, token("users", "student", row.student_id)[0], row);
      addExisting(map, token("users", "teacher", row.teacher_id)[0], row);
    }
    return map;
  },
  async execute({ data }) {
    const payload = {
      email: data.email,
      password: data.password,
      name: data.name,
      username: data.username,
      role: data.role,
      student_id: data.student_id,
      teacher_id: data.teacher_id,
      department_id: data.department_id,
      degree_id: data.degree_id,
      course_id: data.course_id,
      class_id: data.class_id,
      hod_type: data.hod_type,
      hod_subject_id: data.hod_subject_id,
    };
    const { data: response, error } = await supabase.functions.invoke("create-user", { body: payload });
    if (error) {
      let message = error.message;
      try {
        const body = await error.context?.json?.();
        if (body?.error) message = body.error;
      } catch {
        // Keep the transport message when the response is not JSON.
      }
      throw new Error(message || "The account could not be created.");
    }
    if (response?.error) throw new Error(response.error);
    if (data.degree_id && response?.id) {
      // Keep the degree when an older create-user function is still deployed.
      const { error: degreeError } = await supabase
        .from("profiles")
        .update({ degree_id: data.degree_id })
        .eq("id", response.id);
      if (degreeError) {
        return {
          status: "created",
          message: `Account created, but the degree could not be saved: ${degreeError.message}`,
          meta: { password: data.password },
        };
      }
    }
    if (
      data.role === "hod" &&
      data.hod_type === "department" &&
      data.course_id &&
      response?.id
    ) {
      // Same follow-up as ManageUsers: the deployed create-user function does
      // not yet store a department HOD course, so save it with the admin session.
      const { error: courseError } = await supabase
        .from("profiles")
        .update({ course_id: data.course_id })
        .eq("id", response.id);
      if (courseError) {
        return {
          status: "created",
          message: `Account created, but the course could not be saved: ${courseError.message}`,
          meta: { password: data.password },
        };
      }
    }
    return { status: "created", meta: { password: data.password } };
  },
};

const examModule = {
  id: "exams",
  title: "Exams",
  templateName: "Examination_Import_Template.xlsx",
  description: "Create examination groups and their subject papers for existing classes.",
  identityLabel: "Exam",
  roles: EXAM_ROLES,
  supportsUpdate: true,
  duplicateStrategies: ["new", "skip", "update"],
  defaultStrategy: "new",
  concurrency: 2,
  fields: [
    {
      key: "class",
      label: "Class",
      required: true,
      aliases: ["class", "class name", "group"],
      example: "CSE Semester 3, Section A",
    },
    {
      key: "name",
      label: "Exam name",
      required: true,
      aliases: ["exam", "exam name", "examination", "name", "assessment"],
      example: "Midterm 2026",
    },
    {
      key: "exam_type",
      label: "Exam type",
      required: false,
      aliases: ["exam type", "type", "assessment type", "category"],
      example: "Mid-term",
      help: "Class test when left blank. Teachers may import class tests, unit tests, internal assessments, assignments and practicals.",
    },
    {
      key: "academic_year",
      label: "Academic year",
      required: false,
      aliases: ["academic year", "year", "session year"],
      example: "2026-27",
      help: "Uses the class academic year when left blank.",
    },
    {
      key: "starts_on",
      label: "Starts on",
      required: false,
      aliases: ["starts on", "start date", "from date", "start"],
      example: "2026-11-16",
    },
    {
      key: "ends_on",
      label: "Ends on",
      required: false,
      aliases: ["ends on", "end date", "to date", "end"],
      example: "2026-11-27",
    },
    {
      key: "status",
      label: "Status",
      required: false,
      aliases: ["status", "exam status", "state"],
      example: "draft",
      help: "Draft when left blank. Administrators may also import cancelled examinations.",
    },
    {
      key: "instructions",
      label: "Instructions",
      required: false,
      aliases: ["instructions", "notes", "guidance", "remarks"],
      example: "Reporting time 09:30, no calculators",
    },
  ],
  exampleRows: [
    ["CSE Semester 3, Section A", "Midterm 2026", "Mid-term", "2026-27", "2026-11-16", "2026-11-27", "draft", "Reporting time 09:30"],
    ["CSE Semester 3, Section A", "Unit test 2", "Unit test", "2026-27", "", "", "open", ""],
  ],
  async loadContext() {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id ?? null;
    let role = null;
    if (userId) {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
      role = profile?.role ?? null;
    }
    return {
      userId,
      role,
      classes: await fetchRows("classes", "id,name,department,course_id,academic_year,semester,section"),
      courses: await fetchRows("courses", "id,department_id,name,code"),
      subjects: await fetchRows("subjects", "id,name,code,max_marks"),
      classSubjects: await fetchRows("class_subjects", "id,class_id,subject_id"),
      teacherAssignments: await fetchRows("teacher_assignments", "id,class_id,subject_id,teacher_id"),
      exams: await fetchRows(
        "exams",
        "id,name,class_id,academic_year,exam_group_id,exam_type,status,starts_on,ends_on,instructions",
      ),
    };
  },
  resolveRow(values, context) {
    const errors = [];
    const classHit = resolveOne(classLookup(context), values.class);
    if (!classHit.item) {
      roleError(
        errors,
        "Class",
        classHit.ambiguous ? "matches more than one class. Use the exact class name." : "was not found.",
      );
    }
    const klass = classHit.item;

    const name = text(values.name);
    if (!name) roleError(errors, "Exam name", "is required.");

    const rawType = text(values.exam_type);
    const type = rawType ? examTypeId(rawType) : null;
    if (type === undefined) {
      roleError(errors, "Exam type", "is not recognised. Use a value such as Class test, Unit test, Mid-term or Final.");
    }
    const allowedTypes = context.role === "teacher" ? REGULAR_EXAM_TYPES : EXAM_TYPES.map((item) => item.id);
    if (type && !allowedTypes.includes(type)) {
      roleError(
        errors,
        "Exam type",
        context.role === "teacher"
          ? "is reserved for administrators. Teachers can import class tests, unit tests, internal assessments, assignments and practicals."
          : "is not allowed for this account.",
      );
    }

    const rawStatus = text(values.status);
    const status = rawStatus ? examStatusId(rawStatus) : null;
    if (status === undefined) {
      roleError(errors, "Status", "is not recognised. Use draft, open, ongoing, completed or cancelled.");
    }
    if (context.role === "teacher" && status === "cancelled") {
      roleError(errors, "Status", "cannot be cancelled for a teacher-created examination.");
    }

    const startsOn = normaliseDate(values.starts_on);
    if (Number.isNaN(startsOn)) roleError(errors, "Starts on", "must be a valid date.");
    const endsOn = normaliseDate(values.ends_on);
    if (Number.isNaN(endsOn)) roleError(errors, "Ends on", "must be a valid date.");
    if (startsOn && endsOn && endsOn < startsOn) {
      roleError(errors, "Ends on", "cannot be before the start date.");
    }

    const instructions = optionalText(values.instructions);
    const academicYear = optionalText(values.academic_year);

    let subjectIds = [];
    if (klass) {
      const offered = new Set(
        (context.classSubjects ?? [])
          .filter((row) => row.class_id === klass.id)
          .map((row) => row.subject_id),
      );
      subjectIds = (context.subjects ?? []).filter((row) => offered.has(row.id)).map((row) => row.id);

      if (context.role === "teacher") {
        const mine = new Set(
          (context.teacherAssignments ?? [])
            .filter((row) => row.teacher_id === context.userId && row.class_id === klass.id)
            .map((row) => row.subject_id),
        );
        subjectIds = subjectIds.filter((subjectId) => mine.has(subjectId));
        if (subjectIds.length === 0) {
          roleError(errors, "Class", "has no subjects assigned to you. Ask an administrator to assign your subjects.");
        }
      } else if (subjectIds.length === 0) {
        roleError(errors, "Class", "does not offer any subjects yet. Assign subjects to the class first.");
      }
    }

    const identity = klass && name ? token("exams", klass.id, name)[0] : null;
    return {
      data: {
        class_id: klass?.id ?? null,
        name,
        exam_type: type ?? null,
        status: status ?? null,
        academic_year: academicYear,
        starts_on: startsOn,
        ends_on: endsOn,
        instructions,
        subject_ids: subjectIds,
      },
      errors,
      identity,
      altIdentities: identity ? [identity] : [],
      label: klass ? `${name} (${klass.name})` : name,
    };
  },
  async findExisting(_records, context) {
    const map = new Map();
    for (const row of context.exams ?? []) {
      if (row.class_id && row.name) addExisting(map, token("exams", row.class_id, row.name)[0], row);
    }
    return map;
  },
  async execute({ mode, data, existing, context }) {
    if (!data.class_id) throw new Error("Class was not found. Refresh the reference data and try again.");
    const klass = (context.classes ?? []).find((row) => row.id === data.class_id);
    const course = (context.courses ?? []).find((row) => row.id === klass?.course_id);

    if (mode === "update" && existing) {
      const payload = {
        name: data.name,
        exam_type: data.exam_type ?? existing.exam_type ?? "class_test",
        academic_year: data.academic_year ?? existing.academic_year ?? null,
        starts_on: data.starts_on ?? existing.starts_on ?? null,
        ends_on: data.ends_on ?? existing.ends_on ?? null,
        instructions: data.instructions ?? existing.instructions ?? "",
      };
      const status = data.status ?? existing.status ?? "draft";

      if (existing.exam_group_id) {
        const { error: groupError } = await supabase
          .from("exam_groups")
          .update({ ...payload, status })
          .eq("id", existing.exam_group_id);
        throwDb(groupError, "This examination group could not be updated.");

        // Status has its own guarded RPC so teacher updates keep working after
        // the group moves to completed or ongoing.
        const { error: examError } = await supabase
          .from("exams")
          .update(payload)
          .eq("exam_group_id", existing.exam_group_id);
        throwDb(examError, "This examination could not be updated.");

        if (status !== existing.status) {
          await callRpc("set_exam_group_status", {
            p_group_id: existing.exam_group_id,
            p_status: status,
          });
        }
      } else {
        const { error } = await supabase
          .from("exams")
          .update({ ...payload, status })
          .eq("id", existing.id);
        throwDb(error, "This examination could not be updated.");
      }
      return { status: "updated" };
    }

    const subjectById = new Map((context.subjects ?? []).map((row) => [row.id, row]));
    const subjects = (data.subject_ids ?? [])
      .map((subjectId) => subjectById.get(subjectId))
      .filter(Boolean)
      .map((subject) => {
        const max = Number(subject.max_marks) || 100;
        const assignment = (context.teacherAssignments ?? []).find(
          (row) => row.class_id === data.class_id && row.subject_id === subject.id,
        );
        return {
          subject_id: subject.id,
          exam_date: null,
          start_time: null,
          end_time: null,
          max_marks: max,
          pass_marks: Math.round(max * 0.4),
          teacher_id: assignment?.teacher_id ?? null,
          room: null,
          instructions: "",
          allow_overlap: false,
          is_optional: false,
        };
      });

    if (subjects.length === 0) {
      throw new Error("This class has no importable subjects. Assign subjects to the class first.");
    }

    await callRpc("create_exam_group", {
      p_name: data.name,
      p_exam_type: data.exam_type ?? "class_test",
      p_scope: "class",
      p_department_id: course?.department_id ?? null,
      p_course_id: klass?.course_id ?? null,
      p_academic_year: data.academic_year ?? klass?.academic_year ?? null,
      p_academic_term_id: null,
      p_class_ids: [data.class_id],
      p_starts_on: data.starts_on ?? null,
      p_ends_on: data.ends_on ?? null,
      p_instructions: data.instructions ?? "",
      p_status: data.status ?? "draft",
      p_subjects: subjects,
    });
    return { status: "created" };
  },
};

const examSubjectModule = {
  id: "exam_subjects",
  title: "Subject schedules",
  templateName: "Subject_Schedule_Import_Template.xlsx",
  description: "Set the date, time, room and marks for subjects already scheduled on an examination.",
  identityLabel: "Subject schedule",
  roles: EXAM_ROLES,
  supportsUpdate: true,
  duplicateStrategies: ["update", "skip"],
  defaultStrategy: "update",
  concurrency: 2,
  fields: [
    {
      key: "class",
      label: "Class",
      required: true,
      aliases: ["class", "class name", "group"],
      example: "CSE Semester 3, Section A",
    },
    {
      key: "exam",
      label: "Exam",
      required: true,
      aliases: ["exam", "exam name", "examination", "assessment"],
      example: "Midterm 2026",
    },
    {
      key: "subject",
      label: "Subject",
      required: true,
      aliases: ["subject", "subject code", "subject name", "paper"],
      example: "CS201",
      help: "The subject must already be part of the examination.",
    },
    {
      key: "exam_date",
      label: "Paper date",
      required: false,
      aliases: ["paper date", "exam date", "date", "paper on"],
      example: "2026-11-18",
      help: "Must sit inside the examination date range.",
    },
    {
      key: "start_time",
      label: "Start time",
      required: false,
      aliases: ["start time", "starts at", "from", "time"],
      example: "09:30",
    },
    {
      key: "end_time",
      label: "End time",
      required: false,
      aliases: ["end time", "ends at", "to", "until"],
      example: "12:00",
    },
    {
      key: "max_marks",
      label: "Maximum marks",
      required: false,
      aliases: ["maximum marks", "max marks", "out of", "total marks"],
      example: "100",
      help: "Keeps the current maximum when left blank.",
    },
    {
      key: "pass_marks",
      label: "Passing marks",
      required: false,
      aliases: ["passing marks", "pass marks", "minimum marks", "pass"],
      example: "40",
      help: "Keeps the current passing mark when left blank.",
    },
    {
      key: "teacher",
      label: "Invigilator",
      required: false,
      aliases: ["invigilator", "teacher", "teacher name", "teacher id", "username"],
      example: "",
      help: "Optional. Use the teacher name, username, ID or email.",
    },
    {
      key: "room",
      label: "Room",
      required: false,
      aliases: ["room", "venue", "hall", "location"],
      example: "Block A, room 12",
    },
    {
      key: "instructions",
      label: "Instructions",
      required: false,
      aliases: ["instructions", "notes", "guidance", "remarks"],
      example: "Section A only",
    },
    {
      key: "allow_overlap",
      label: "Allow overlap",
      required: false,
      aliases: ["allow overlap", "overlap", "clash allowed"],
      example: "No",
      help: "Yes or no. Overlapping papers for the same class are rejected unless this is yes.",
    },
  ],
  exampleRows: [
    ["CSE Semester 3, Section A", "Midterm 2026", "CS201", "2026-11-18", "09:30", "12:00", "100", "40", "", "Block A, room 12", "", "No"],
    ["CSE Semester 3, Section A", "Midterm 2026", "CS202", "2026-11-20", "09:30", "12:00", "100", "40", "", "Block A, room 12", "", "No"],
  ],
  async loadContext() {
    return {
      classes: await fetchRows("classes", "id,name,department,course_id,academic_year,semester,section"),
      exams: await fetchRows("exams", "id,name,class_id,academic_year,exam_group_id"),
      examGroups: await fetchRows("exam_groups", "id,name,scope,starts_on,ends_on"),
      subjects: await fetchRows("subjects", "id,name,code,max_marks"),
      profiles: await fetchRows("profiles", "id,name,username,email,role"),
      examSubjects: await fetchRows(
        "exam_subjects",
        "id,exam_id,subject_id,exam_date,start_time,end_time,max_marks,pass_marks,teacher_id,room,instructions,allow_overlap",
      ),
    };
  },
  resolveRow(values, context) {
    const errors = [];
    const classHit = resolveOne(classLookup(context), values.class);
    if (!classHit.item) {
      roleError(
        errors,
        "Class",
        classHit.ambiguous ? "matches more than one class. Use the exact class name." : "was not found.",
      );
    }
    const klass = classHit.item;

    let exam = null;
    const examValue = text(values.exam);
    if (!examValue) {
      roleError(errors, "Exam", "is required.");
    } else if (klass) {
      const matches = (context.exams ?? []).filter(
        (row) => norm(row.name) === norm(examValue) && row.class_id === klass.id,
      );
      if (matches.length === 1) exam = matches[0];
      else if (matches.length > 1) {
        roleError(errors, "Exam", "matches more than one examination. Use the exact examination name.");
      } else {
        roleError(errors, "Exam", "was not found for this class. Import the examination first.");
      }
    }

    const subjectHit = resolveOne(subjectLookup(context), values.subject);
    if (!subjectHit.item) {
      roleError(
        errors,
        "Subject",
        subjectHit.ambiguous
          ? "matches more than one subject. Use the subject code."
          : "was not found in the subject catalogue.",
      );
    }
    const subject = subjectHit.item;

    const schedule =
      exam && subject
        ? (context.examSubjects ?? []).find(
            (row) => row.exam_id === exam.id && row.subject_id === subject.id,
          ) ?? null
        : null;
    if (exam && subject && !schedule) {
      roleError(errors, "Subject", "is not part of this examination. Import the examination first.");
    }

    const rawDate = values.exam_date;
    const examDate = normaliseDate(rawDate);
    if (Number.isNaN(examDate)) {
      roleError(errors, "Paper date", "must be a valid date.");
    }
    const finalDate = examDate ?? schedule?.exam_date ?? null;
    if (finalDate && exam) {
      const { startsOn, endsOn } = groupWindowFor(context, exam);
      if (startsOn && finalDate < startsOn) {
        roleError(errors, "Paper date", `cannot be before the examination starts on ${startsOn}.`);
      }
      if (endsOn && finalDate > endsOn) {
        roleError(errors, "Paper date", `cannot be after the examination ends on ${endsOn}.`);
      }
    }

    const startTime = normaliseTime(values.start_time);
    if (Number.isNaN(startTime)) roleError(errors, "Start time", "must be a time such as 09:30.");
    const endTime = normaliseTime(values.end_time);
    if (Number.isNaN(endTime)) roleError(errors, "End time", "must be a time such as 12:00.");

    const finalStart = startTime ?? (clockKey(schedule?.start_time) || null);
    const finalEnd = endTime ?? (clockKey(schedule?.end_time) || null);
    if (finalStart && finalEnd && finalEnd <= finalStart) {
      roleError(errors, "End time", "must be after the start time.");
    }

    const rawMax = asNumber(values.max_marks);
    if (Number.isNaN(rawMax)) roleError(errors, "Maximum marks", "must be a number.");
    const maxMarks = rawMax ?? Number(schedule?.max_marks ?? subject?.max_marks ?? 100);
    if (!Number.isNaN(rawMax) && maxMarks <= 0) {
      roleError(errors, "Maximum marks", "must be greater than zero.");
    }

    const rawPass = asNumber(values.pass_marks);
    if (Number.isNaN(rawPass)) roleError(errors, "Passing marks", "must be a number.");
    const passMarks =
      rawPass ?? (schedule?.pass_marks != null ? Number(schedule.pass_marks) : null);
    if (passMarks != null && (passMarks < 0 || passMarks > maxMarks)) {
      roleError(errors, "Passing marks", "must sit between 0 and the maximum marks.");
    }

    let teacherId = schedule?.teacher_id ?? null;
    const teacherValue = text(values.teacher);
    if (teacherValue) {
      const teacherHit = resolveOne(
        personLookup((context.profiles ?? []).filter((row) => row.role === "teacher")),
        teacherValue,
      );
      if (!teacherHit.item) {
        roleError(errors, "Invigilator", "was not found. Use the teacher name, username, ID or email.");
      } else {
        teacherId = teacherHit.item.id;
      }
    }

    const overlapValue = asFlag(values.allow_overlap);
    if (Number.isNaN(overlapValue)) {
      roleError(errors, "Allow overlap", "must be yes or no.");
    }
    const allowOverlap = overlapValue === null ? Boolean(schedule?.allow_overlap) : overlapValue;

    if (finalDate && finalStart && finalEnd && !allowOverlap && klass && schedule) {
      const classByExam = new Map((context.exams ?? []).map((row) => [row.id, row.class_id]));
      const conflict = (context.examSubjects ?? []).find((row) => {
        if (row.id === schedule.id) return false;
        if (classByExam.get(row.exam_id) !== klass.id) return false;
        if (row.exam_date !== finalDate) return false;
        const otherStart = clockKey(row.start_time);
        const otherEnd = clockKey(row.end_time);
        if (!otherStart || !otherEnd || row.allow_overlap) return false;
        return finalStart < otherEnd && finalEnd > otherStart;
      });
      if (conflict) {
        roleError(errors, "Start time", "overlaps another paper for this class. Change the time or allow overlap.");
      }
    }

    const room = text(values.room) || schedule?.room || null;
    const instructions = text(values.instructions) || schedule?.instructions || "";
    const identity = exam && subject ? token("exam_subjects", exam.id, subject.id)[0] : null;

    return {
      data: {
        exam_subject_id: schedule?.id ?? null,
        exam_id: exam?.id ?? null,
        subject_id: subject?.id ?? null,
        exam_date: finalDate,
        start_time: finalStart || null,
        end_time: finalEnd || null,
        max_marks: Number.isNaN(rawMax) ? null : maxMarks,
        pass_marks: Number.isNaN(rawPass) ? null : passMarks,
        teacher_id: teacherId,
        room,
        instructions,
        allow_overlap: allowOverlap,
      },
      errors,
      identity,
      altIdentities: identity ? [identity] : [],
      label: exam && subject ? `${exam.name}, ${subject.code ?? subject.name}` : examValue,
    };
  },
  async findExisting(_records, context) {
    const map = new Map();
    for (const row of context.examSubjects ?? []) {
      addExisting(map, token("exam_subjects", row.exam_id, row.subject_id)[0], row);
    }
    return map;
  },
  async execute({ data }) {
    if (!data.exam_subject_id) {
      throw new Error("This subject is not part of the examination. Import the examination first.");
    }
    await callRpc("update_exam_subject_schedule", {
      p_exam_subject_id: data.exam_subject_id,
      p_exam_date: data.exam_date,
      p_start_time: data.start_time,
      p_end_time: data.end_time,
      p_max_marks: data.max_marks,
      p_pass_marks: data.pass_marks,
      p_teacher_id: data.teacher_id,
      p_instructions: data.instructions,
      p_room: data.room,
      p_allow_overlap: data.allow_overlap,
    });
    return { status: "updated" };
  },
};

const marksModule = {
  id: "marks",
  title: "Marks",
  templateName: "Marks_Import_Template.xlsx",
  description: "Import marks for students in your assigned classes and subjects.",
  identityLabel: "Mark",
  roles: MARKS_ROLES,
  supportsUpdate: true,
  duplicateStrategies: ["new", "skip", "update"],
  defaultStrategy: "new",
  concurrency: 4,
  fields: [
    {
      key: "class",
      label: "Class",
      required: false,
      aliases: ["class", "class name", "group"],
      example: "CSE Semester 3, Section A",
      help: "Required when no class is selected on the Marks Entry screen.",
    },
    {
      key: "exam",
      label: "Exam",
      required: false,
      aliases: ["exam", "exam name", "examination", "assessment"],
      example: "Midterm 2026",
      help: "Required when no exam is selected on the Marks Entry screen.",
    },
    {
      key: "subject",
      label: "Subject",
      required: false,
      aliases: ["subject", "subject code", "subject name", "paper"],
      example: "CS201",
      help: "Required when no subject is selected on the Marks Entry screen.",
    },
    {
      key: "student",
      label: "Student",
      required: true,
      aliases: ["student", "student name", "student id", "roll number", "roll no", "username", "email"],
      example: "GRD2026001",
      help: "Use the student ID, username, email or full name. Student ID or username is safest.",
    },
    {
      key: "marks",
      label: "Marks obtained",
      required: false,
      aliases: ["marks", "marks obtained", "obtained marks", "score", "mark", "result"],
      example: "78",
      help: "A number between 0 and the subject maximum marks. Required for present students; absent, exempt and withheld rows store 0.",
    },
    {
      key: "status",
      label: "Attendance status",
      required: false,
      aliases: ["status", "attendance", "attendance status", "result status"],
      example: "present",
      help: "Present when left blank. Use absent, exempt or withheld when no mark should be recorded.",
    },
    {
      key: "remarks",
      label: "Remarks",
      required: false,
      aliases: ["remarks", "remark", "note", "notes", "comment"],
      example: "Medical leave",
    },
  ],
  exampleRows: [
    ["CSE Semester 3, Section A", "Midterm 2026", "CS201", "GRD2026001", "78", "present", ""],
    ["CSE Semester 3, Section A", "Midterm 2026", "CS201", "GRD2026002", "", "absent", "Medical leave"],
  ],
  async loadContext() {
    const { data: auth } = await supabase.auth.getUser();
    return {
      userId: auth?.user?.id ?? null,
      classes: await fetchRows("classes", "id,name,department,course_id,academic_year,semester,section"),
      exams: await fetchRows("exams", "id,name,class_id,academic_year,exam_group_id,status"),
      subjects: await fetchRows("subjects", "id,name,code,max_marks,class_id"),
      profiles: await fetchRows("profiles", "id,name,username,email,role,student_id,class_id,is_active"),
      classSubjects: await fetchRows("class_subjects", "id,class_id,subject_id"),
      enrollments: await fetchRows("student_enrollments", "student_id,class_id,status"),
      examSubjects: await fetchRows("exam_subjects", "id,exam_id,subject_id,max_marks,pass_marks"),
      submissions: await fetchRows("exam_submissions", "id,exam_id,subject_id,status"),
    };
  },
  resolveRow(values, context, _rowNumber, defaults = {}) {
    const errors = [];
    let klass = null;
    if (text(values.class)) {
      const classHit = resolveOne(classLookup(context), values.class);
      if (!classHit.item) {
        roleError(
          errors,
          "Class",
          classHit.ambiguous ? "matches more than one class. Use the exact class name." : "was not found.",
        );
      } else {
        klass = classHit.item;
      }
    } else if (defaults.class_id) {
      klass = (context.classes ?? []).find((row) => row.id === defaults.class_id) ?? null;
    }
    if (!klass) roleError(errors, "Class", "is required. Choose a class on the Marks Entry screen or add a Class column.");

    let exam = null;
    if (text(values.exam)) {
      const matches = (context.exams ?? []).filter(
        (row) => norm(row.name) === norm(values.exam) && (!klass || row.class_id === klass.id),
      );
      if (matches.length === 1) exam = matches[0];
      else if (matches.length > 1) roleError(errors, "Exam", "matches more than one exam. Use the exact exam name.");
      else roleError(errors, "Exam", "was not found for this class.");
    } else if (defaults.exam_id) {
      exam = (context.exams ?? []).find((row) => row.id === defaults.exam_id) ?? null;
    }
    if (!exam) roleError(errors, "Exam", "is required. Choose an exam on the Marks Entry screen or add an Exam column.");
    else if (klass && exam.class_id !== klass.id) roleError(errors, "Exam", "does not belong to the selected class.");

    const assignedIds = new Set(
      (context.classSubjects ?? []).filter((row) => row.class_id === klass?.id).map((row) => row.subject_id),
    );
    let subject = null;
    if (text(values.subject)) {
      const key = norm(values.subject);
      const candidates = (context.subjects ?? []).filter(
        (row) => norm(row.code) === key || norm(row.name) === key,
      );
      const eligible = assignedIds.size
        ? candidates.filter((row) => assignedIds.has(row.id) || row.class_id === klass?.id)
        : candidates;
      if (eligible.length === 1) subject = eligible[0];
      else if (eligible.length > 1) roleError(errors, "Subject", "matches more than one subject. Use the subject code.");
      else roleError(errors, "Subject", "was not found or is not assigned to this class.");
    } else if (defaults.subject_id) {
      subject = (context.subjects ?? []).find((row) => row.id === defaults.subject_id) ?? null;
    }
    if (!subject) roleError(errors, "Subject", "is required. Choose a subject on the Marks Entry screen or add a Subject column.");
    else if (klass && !assignedIds.has(subject.id) && subject.class_id !== klass.id) {
      roleError(errors, "Subject", "is not assigned to the selected class.");
    }

    // The examination subject owns the real maximum, so a subject that is not
    // part of this exam is rejected instead of silently accepted by RLS.
    const examSubject =
      exam && subject
        ? (context.examSubjects ?? []).find(
            (row) => row.exam_id === exam.id && row.subject_id === subject.id,
          ) ?? null
        : null;
    if (exam && subject && !examSubject) {
      roleError(errors, "Subject", "is not part of this examination. Schedule the subject first.");
    }
    const maxMarks = examSubject?.max_marks != null ? Number(examSubject.max_marks) : Number(subject?.max_marks ?? 100);

    const submission =
      exam && subject
        ? (context.submissions ?? []).find(
            (row) => row.exam_id === exam.id && row.subject_id === subject.id,
          ) ?? null
        : null;
    if (submission && ["submitted", "under_review", "approved"].includes(submission.status)) {
      roleError(
        errors,
        "Exam",
        `marks are locked because this subject was already ${submission.status.replace("_", " ")}. Ask for it to be reopened.`,
      );
    }

    const enrolledIds = new Set(
      (context.enrollments ?? [])
        .filter((row) => row.class_id === klass?.id && row.status === "active")
        .map((row) => row.student_id),
    );

    const studentValue = text(values.student);
    let student = null;
    if (!studentValue) {
      roleError(errors, "Student", "is required.");
    } else if (klass) {
      const key = norm(studentValue);
      const matches = (context.profiles ?? []).filter(
        (row) =>
          row.role === "student" &&
          row.is_active !== false &&
          (row.class_id === klass.id || enrolledIds.has(row.id)) &&
          (norm(row.student_id) === key ||
            norm(row.username) === key ||
            norm(row.email) === key ||
            norm(row.name) === key),
      );
      if (matches.length === 1) student = matches[0];
      else if (matches.length > 1) {
        roleError(errors, "Student", "matches more than one student. Use the student ID or username.");
      } else {
        roleError(errors, "Student", "was not found in the selected class.");
      }
    }

    const rawStatus = text(values.status);
    let status = null;
    if (rawStatus) {
      const key = norm(rawStatus);
      const match = MARK_STATUSES.find((item) => norm(item.id) === key || norm(item.label) === key);
      if (!match) {
        roleError(errors, "Attendance status", "must be present, absent, exempt or withheld.");
      } else {
        status = match.id;
      }
    }
    const effectiveStatus = status ?? "present";

    let marksValue = asNumber(values.marks);
    if (Number.isNaN(marksValue)) {
      roleError(errors, "Marks obtained", "must be a number.");
    } else if (marksValue === null && effectiveStatus === "present") {
      roleError(errors, "Marks obtained", "is required for a present student.");
    } else if (marksValue === null) {
      marksValue = 0;
    } else if (marksValue < 0 || marksValue > maxMarks) {
      roleError(errors, "Marks obtained", `must be between 0 and ${maxMarks}.`);
    } else if (effectiveStatus !== "present" && marksValue !== 0) {
      roleError(errors, "Marks obtained", `must be blank or 0 when the status is ${effectiveStatus}.`);
    }

    const remarks = optionalText(values.remarks);
    const identity =
      exam && subject && student ? token("marks", exam.id, subject.id, student.id)[0] : null;
    return {
      data: {
        exam_id: exam?.id ?? null,
        subject_id: subject?.id ?? null,
        student_id: student?.id ?? null,
        marks_obtained: Number.isNaN(marksValue) ? null : marksValue,
        status: effectiveStatus,
        remarks,
        entered_by: context.userId ?? null,
      },
      errors,
      identity,
      altIdentities: identity ? [identity] : [],
      label: student && subject ? `${student.name}, ${subject.code}` : studentValue,
    };
  },
  async findExisting(records) {
    const pairs = new Map();
    for (const record of records) {
      if (record.errors?.length || !record.data?.exam_id || !record.data?.subject_id) continue;
      pairs.set(`${record.data.exam_id}:${record.data.subject_id}`, {
        exam_id: record.data.exam_id,
        subject_id: record.data.subject_id,
      });
    }
    const map = new Map();
    for (const pair of pairs.values()) {
      const { data, error } = await supabase
        .from("marks")
        .select("id,exam_id,subject_id,student_id,marks_obtained,status,remarks")
        .eq("exam_id", pair.exam_id)
        .eq("subject_id", pair.subject_id);
      if (error) throw new Error(`Could not check existing marks: ${error.message}`);
      for (const row of data ?? []) {
        addExisting(map, token("marks", row.exam_id, row.subject_id, row.student_id)[0], row);
      }
    }
    return map;
  },
  async execute({ mode, data, existing }) {
    if (!data.exam_id || !data.subject_id || !data.student_id) {
      throw new Error("Exam, subject or student was not found. Refresh the reference data and try again.");
    }
    if (mode === "update" || existing) {
      const { error } = await supabase
        .from("marks")
        .upsert(data, { onConflict: "exam_id,subject_id,student_id" });
      throwDb(error, "A mark for this student already exists for this exam and subject.");
      return { status: existing ? "updated" : "created" };
    }
    const { error } = await supabase.from("marks").insert(data);
    throwDb(error, "A mark for this student already exists for this exam and subject.");
    return { status: "created" };
  },
};

export const importModules = {
  departments: departmentModule,
  degrees: degreeModule,
  courses: courseModule,
  classes: classModule,
  subjects: subjectModule,
  class_subjects: classSubjectModule,
  users: userModule,
  exams: examModule,
  exam_subjects: examSubjectModule,
  marks: marksModule,
};

export function getImportModule(id) {
  return importModules[id] ?? null;
}
