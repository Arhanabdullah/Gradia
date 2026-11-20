// Module registry for the universal import wizard.
//
// A module owns everything that is specific to one Gradia table: its columns,
// how a file row resolves to a database payload, how existing records are
// detected, and how one validated row is written. The wizard and templates stay
// generic so every screen shares the same upload, mapping, validation and
// reporting experience.

import { supabase } from "../lib/supabase";
import { callRpc } from "../lib/db";
import {
  CLASSWORK_KIND_LABEL,
  EXAM_STATUSES,
  EXAM_TYPES,
  MARK_STATUSES,
  REGULAR_EXAM_TYPES,
  SEMESTER_EXAM_TYPES,
  isClassworkComponent,
} from "../lib/exams";
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

function teacherById(profiles, value) {
  const key = norm(value);
  if (!key) return { item: null };
  const matches = (profiles ?? []).filter(
    (profile) => profile.role === "teacher" && norm(profile.teacher_id) === key,
  );
  if (matches.length === 1) return { item: matches[0] };
  if (matches.length > 1) return { item: null, ambiguous: true, count: matches.length };
  return { item: null };
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
    if (total >= 24 * 60) return Number.NaN;
    return `${padClock(Math.floor(total / 60))}:${padClock(total % 60)}`;
  }

  // Accept 24-hour time (09:30, 13:30) and 12-hour time with AM or PM
  // (10:00 AM, 1:00 PM, 10 a.m.). Excel turns a typed time into a clock value,
  // so a bare "01:00" is always read as 1 AM, not 1 PM.
  const compact = text(value).replace(/\s+/g, "");
  if (!compact) return null;

  let hour;
  let minute;
  let suffix = "";
  let match = compact.match(/^(\d{1,2})[:.](\d{2})(?::\d{2}(?:\.\d+)?)?([ap])\.?m\.?$/i);
  if (match) {
    hour = Number(match[1]);
    minute = Number(match[2]);
    suffix = match[3].toLowerCase() === "p" ? "pm" : "am";
  } else {
    match = compact.match(/^(\d{1,2})([ap])\.?m\.?$/i);
    if (match) {
      hour = Number(match[1]);
      minute = 0;
      suffix = match[2].toLowerCase() === "p" ? "pm" : "am";
    } else {
      match = compact.match(/^(\d{1,2})[:.](\d{2})(?::\d{2}(?:\.\d+)?)?$/);
      if (!match) return Number.NaN;
      hour = Number(match[1]);
      minute = Number(match[2]);
    }
  }

  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return Number.NaN;
  return `${padClock(hour)}:${padClock(minute)}`;
}

// Sample templates show 12-hour clock labels so an afternoon paper reads as
// 01:00 PM instead of being mistaken for 1 AM.
function clockLabel(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return raw;
  let hour = Number(match[1]);
  const suffix = hour >= 12 ? "PM" : "AM";
  if (hour === 0) hour = 12;
  else if (hour > 12) hour -= 12;
  return `${padClock(hour)}:${match[2]} ${suffix}`;
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
      example: "5.5",
      help: "A positive number of years, including decimals such as 5.5.",
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
      duration = asNumber(values.duration_years);
      if (duration === null || Number.isNaN(duration) || duration <= 0 || duration > 99.9) {
        roleError(errors, "Duration in years", "must be a positive number, such as 4 or 5.5.");
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
  requiredAny: [["teacher_id", "teacher"]],
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
      key: "teacher_id",
      label: "Teacher ID",
      required: false,
      aliases: ["teacher id", "employee id", "staff id", "teacher employee id"],
      example: "TCH1001",
      help: "Recommended. Matches the Teacher ID shown in Manage users, so teachers who share a name stay distinct. Supply this or Teacher name.",
    },
    {
      key: "teacher",
      label: "Teacher name",
      required: false,
      aliases: ["teacher", "teacher name", "teacher email", "username", "email"],
      example: "",
      help: "Optional when Teacher ID is supplied. Name, username or email must match exactly one teacher; a duplicate name is rejected as ambiguous.",
    },
  ],
  exampleRows: [
    ["CSE Semester 3, Section A", "CS201", "TCH1001", ""],
    ["CSE Semester 3, Section A", "CS202", "TCH1002", ""],
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
    const teacherIdValue = text(values.teacher_id);
    const teacherNameValue = text(values.teacher);
    const teacherProfiles = (context.profiles ?? []).filter((profile) => profile.role === "teacher");
    let teacher = null;
    if (teacherIdValue) {
      const idHit = teacherById(teacherProfiles, teacherIdValue);
      if (!idHit.item) {
        roleError(
          errors,
          "Teacher ID",
          idHit.ambiguous
            ? "matches more than one teacher. Check the user records."
            : "was not found. Use the Teacher ID shown in Manage users.",
        );
      } else {
        teacher = idHit.item;
        if (teacherNameValue) {
          const nameHit = resolveOne(personLookup(teacherProfiles), teacherNameValue);
          if (nameHit.item && nameHit.item.id !== teacher.id) {
            roleError(errors, "Teacher name", `does not match Teacher ID ${teacherIdValue}.`);
          }
        }
      }
    } else if (teacherNameValue) {
      const teacherHit = resolveOne(personLookup(teacherProfiles), teacherNameValue);
      if (!teacherHit.item) {
        roleError(
          errors,
          "Teacher name",
          teacherHit.ambiguous
            ? "matches more than one teacher. Use the Teacher ID instead."
            : "was not found. Use the Teacher ID shown in Manage users.",
        );
      } else {
        teacher = teacherHit.item;
      }
    } else {
      roleError(errors, "Teacher", "is required. Supply a Teacher ID or teacher name.");
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
      help: "An existing Gradia class. The class must offer subjects, and for a teacher at least one assigned to you.",
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
      example: "IA1",
      help: "IA1 when left blank. Teachers may import IA1, Quiz, Project, Practical and Viva.",
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
  // The sample group points at a class the signed-in user can actually import
  // for, so the name and academic year resolve instead of naming a fiction.
  exampleRows(context = {}) {
    const { klass } = firstUsableClassSubject(context);
    const className = classSampleLabel(klass) || "CSE Semester 3, Section A";
    const academicYear = klass?.academic_year || "2026-27";
    return [
      [className, `IA1 ${academicYear}`, "IA1", academicYear, futureDate(14), futureDate(21), "draft", "Reporting time 15 minutes before the paper"],
      [className, `Quiz 2 ${academicYear}`, "Quiz", academicYear, futureDate(28), futureDate(28), "open", ""],
    ];
  },
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
      roleError(errors, "Exam type", "is not recognised. Use IA1, IA2, ESA, Project, Practical, Viva or Quiz.");
    }
    const allowedTypes = context.role === "teacher" ? REGULAR_EXAM_TYPES : EXAM_TYPES.map((item) => item.id);
    if (type && !allowedTypes.includes(type)) {
      roleError(
        errors,
        "Exam type",
        context.role === "teacher"
          ? "is reserved for the Exam Cell. Teachers can import IA1, Quiz, Project, Practical and Viva."
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
        return {
          subject_id: subject.id,
          exam_date: null,
          start_time: null,
          end_time: null,
          max_marks: max,
          pass_marks: Math.round(max * 0.4),
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

const SCHEDULE_ROLES = ["admin", "teacher", "exam_cell"];

// A class lookup accepts the plain name or the name with its section. Templates
// use the same spelling so a downloaded example actually resolves.
function classSampleLabel(klass) {
  if (!klass) return "";
  return klass.section ? `${klass.name} (${klass.section})` : klass.name;
}

function futureDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function firstUsableClassSubject(context) {
  const isTeacher = context.role === "teacher";
  const classes = [...(context.classes ?? [])].sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? ""),
  );
  const assignments = context.teacherAssignments ?? [];
  for (const klass of classes) {
    const offered = (context.classSubjects ?? []).filter((row) => row.class_id === klass.id);
    const usable = isTeacher
      ? offered.filter((row) =>
          assignments.some(
            (assignment) =>
              assignment.class_id === klass.id &&
              assignment.subject_id === row.subject_id &&
              assignment.teacher_id === context.userId,
          ),
        )
      : offered;
    if (usable.length === 0) continue;
    const subject = (context.subjects ?? []).find((row) => row.id === usable[0].subject_id);
    if (subject) return { klass, subject };
  }
  return { klass: null, subject: null };
}

// ---------- semester paper scheduling ----------
// A row schedules one paper that Assessment Setup already created inside the
// class semester examination. The import never invents an examination or a
// component: it only writes each paper's own date, time and room through
// update_assessment_component_schedule. The room is written for the row's
// class, so a department group keeps a different room for each class.
const semesterIndexCache = new WeakMap();

function componentLabel(component) {
  if (!component) return "Paper";
  return component.code ? `${component.name} (${component.code})` : component.name;
}

function componentKey(component) {
  return norm(component?.code || component?.name || "");
}

function semesterScheduleIndex(context) {
  const cached = semesterIndexCache.get(context);
  if (cached) return cached;

  const examById = new Map((context.exams ?? []).map((row) => [row.id, row]));
  const groupById = new Map((context.examGroups ?? []).map((row) => [row.id, row]));
  const examSubjectById = new Map(
    (context.examSubjects ?? []).map((row) => [row.id, row]),
  );
  const items = [];
  const byClassSubject = new Map();

  for (const component of context.assessmentComponents ?? []) {
    const examSubject = examSubjectById.get(component.exam_subject_id);
    const exam = examById.get(examSubject?.exam_id);
    if (!exam?.class_id || !examSubject?.subject_id) continue;
    const group = groupById.get(exam.exam_group_id) ?? null;
    const examType = exam.exam_type ?? group?.exam_type;
    if (!SEMESTER_EXAM_TYPES.includes(examType)) continue;

    const item = { component, exam, group, subjectId: examSubject.subject_id };
    items.push(item);
    const key = `${exam.class_id}|${examSubject.subject_id}`;
    if (!byClassSubject.has(key)) byClassSubject.set(key, []);
    byClassSubject.get(key).push(item);
  }

  const index = { items, byClassSubject };
  semesterIndexCache.set(context, index);
  return index;
}

function semesterPapersFor(context, classId, subjectId) {
  if (!classId || !subjectId) return [];
  return semesterScheduleIndex(context).byClassSubject.get(`${classId}|${subjectId}`) ?? [];
}

function semesterPaperToken(classId, subjectId, component) {
  return token("semester_paper", classId, subjectId, componentKey(component))[0];
}

function scheduleSampleRow(item, context, index = 0) {
  const subject = (context.subjects ?? []).find((row) => row.id === item.subjectId);
  const klass = (context.classes ?? []).find((row) => row.id === item.exam.class_id);
  return {
    class: classSampleLabel(klass),
    exam: item.exam.name,
    subject: subject?.code || subject?.name || "",
    paper: item.component.code || item.component.name,
    exam_date: futureDate(14 + index * 2),
    start_time: clockLabel(clockKey(item.component.start_time)) || "10:00 AM",
    end_time: clockLabel(clockKey(item.component.end_time)) || "01:00 PM",
    room: "Hall A",
    allow_overlap: "No",
  };
}

// The project still works before 202611180001 is applied: the code fallback in
// isClassworkComponent() covers rows that have no schedule_mode column yet.
async function fetchAssessmentComponents() {
  const base = "id,exam_subject_id,name,code,is_conducted,exam_date,start_time,end_time,room,allow_overlap";
  try {
    return await fetchRows("assessment_components", `${base},schedule_mode`);
  } catch (error) {
    if (!/schedule_mode/i.test(error?.message ?? "")) throw error;
    return fetchRows("assessment_components", base);
  }
}

const semesterScheduleModule = {
  id: "schedule_semester",
  title: "Semester paper schedules",
  templateName: "Semester_Paper_Schedule_Import_Template.xlsx",
  description:
    "Set the date, time and class-wise room for papers that a semester examination already created.",
  identityLabel: "Paper schedule",
  roles: SCHEDULE_ROLES,
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
      help: "An existing Gradia class that already has its semester examination.",
    },
    {
      key: "exam",
      label: "Examination name",
      required: false,
      aliases: ["exam", "exam name", "examination", "assessment"],
      example: "Semester Examination 2026-27",
      help: "Optional. Use it when the class has more than one semester examination.",
    },
    {
      key: "subject",
      label: "Subject",
      required: true,
      aliases: ["subject", "subject code", "subject name", "paper subject"],
      example: "CS201",
      help: "The subject must be part of the class semester examination and, for a teacher, assigned to you.",
    },
    {
      key: "paper",
      label: "Paper",
      required: true,
      aliases: ["paper", "paper code", "component", "component code", "assessment"],
      example: "ESA",
      help: "The paper code from Assessment Setup, for example ESA, IA1 or IA2. Quiz, assignment and project are classwork and are marked in Marks Entry.",
    },
    {
      key: "exam_date",
      label: "Paper date",
      required: true,
      aliases: ["paper date", "exam date", "date", "paper on"],
      example: "2026-12-10",
      help: "Must sit inside the examination date range when the examination has one.",
    },
    {
      key: "start_time",
      label: "Start time",
      required: true,
      aliases: ["start time", "starts at", "from", "time"],
      example: "10:00 AM",
      help: "24-hour HH:MM or 12-hour with AM or PM, for example 10:00 AM.",
    },
    {
      key: "end_time",
      label: "End time",
      required: true,
      aliases: ["end time", "ends at", "to", "until"],
      example: "01:00 PM",
      help: "Must be after the start time. Use 01:00 PM for an afternoon paper.",
    },
    {
      key: "room",
      label: "Room or lab",
      required: false,
      aliases: ["room", "venue", "lab", "hall"],
      example: "Hall A",
    },
    {
      key: "allow_overlap",
      label: "Allow overlap",
      required: false,
      aliases: ["allow overlap", "overlap", "clash allowed"],
      example: "No",
      help: "Yes or no. Only set yes when this paper may run at the same time as another paper of the class.",
    },
  ],
  exampleRows(context = {}) {
    const { items } = semesterScheduleIndex(context);
    const formal = items.filter((item) => !isClassworkComponent(item.component));
    const { klass, subject } = firstUsableClassSubject(context);
    const preferred = formal.filter(
      (item) =>
        (!klass || item.exam.class_id === klass.id) &&
        (!subject || item.subjectId === subject.id),
    );
    const chosen = (preferred.length > 0 ? preferred : formal)
      .slice(0, 2)
      .map((item, index) => scheduleSampleRow(item, context, index));
    if (chosen.length > 0) {
      return chosen.map((row) => [
        row.class,
        row.exam,
        row.subject,
        row.paper,
        row.exam_date,
        row.start_time,
        row.end_time,
        row.room,
        row.allow_overlap,
      ]);
    }

    const className = classSampleLabel(klass) || "CSE Semester 3, Section A";
    const examName = klass?.academic_year
      ? `Semester Examination ${klass.academic_year}`
      : "Semester Examination 2026-27";
    const subjectCode = subject?.code || subject?.name || "CS201";
    return [
      [className, examName, subjectCode, "ESA", futureDate(14), "10:00 AM", "01:00 PM", "Hall A", "No"],
      [className, examName, subjectCode, "IA1", futureDate(7), "10:00 AM", "11:00 AM", "R-101", "No"],
    ];
  },
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
      subjects: await fetchRows("subjects", "id,name,code,max_marks"),
      classSubjects: await fetchRows("class_subjects", "id,class_id,subject_id"),
      teacherAssignments: await fetchRows("teacher_assignments", "id,class_id,subject_id,teacher_id"),
      examGroups: await fetchRows("exam_groups", "id,name,exam_type,academic_year,status"),
      exams: await fetchRows("exams", "id,class_id,name,exam_group_id,exam_type,status,academic_year"),
      examSubjects: await fetchRows("exam_subjects", "id,exam_id,subject_id"),
      assessmentComponents: await fetchAssessmentComponents(),
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

    const subjectHit = resolveOne(subjectLookup(context), values.subject);
    if (!subjectHit.item) {
      roleError(
        errors,
        "Subject",
        subjectHit.ambiguous ? "matches more than one subject. Use the subject code." : "was not found.",
      );
    }
    const subject = subjectHit.item;

    if (klass && subject) {
      const offered = (context.classSubjects ?? []).some(
        (row) => row.class_id === klass.id && row.subject_id === subject.id,
      );
      if (!offered) roleError(errors, "Subject", "is not offered by this class.");
      if (context.role === "teacher") {
        const assigned = (context.teacherAssignments ?? []).some(
          (row) =>
            row.class_id === klass.id &&
            row.subject_id === subject.id &&
            row.teacher_id === context.userId,
        );
        if (!assigned) roleError(errors, "Subject", "is not assigned to you for this class.");
      }
    }

    const examName = text(values.exam);
    let scoped = semesterPapersFor(context, klass?.id, subject?.id);
    if (examName && scoped.length > 0) {
      const matching = scoped.filter(
        (item) => norm(item.exam.name) === norm(examName) || norm(item.group?.name) === norm(examName),
      );
      if (matching.length > 0) scoped = matching;
      else {
        roleError(
          errors,
          "Examination name",
          "was not found for this class. Create the semester examination first, or leave the column blank.",
        );
      }
    }

    let paper = null;
    const paperText = text(values.paper);
    if (!paperText) {
      roleError(errors, "Paper", "is required, for example ESA or IA1.");
    } else {
      const key = norm(paperText);
      const matches = scoped.filter(
        (item) => norm(item.component.code) === key || norm(item.component.name) === key,
      );
      if (matches.length === 1) paper = matches[0];
      else if (matches.length > 1) {
        roleError(errors, "Paper", "matches more than one paper. Use the paper code.");
      } else if (scoped.length === 0) {
        roleError(errors, "Paper", "was not found. Create the class semester examination first.");
      } else {
        const available = [
          ...new Set(
            scoped
              .filter((item) => !isClassworkComponent(item.component))
              .map((item) => item.component.code || item.component.name),
          ),
        ];
        roleError(
          errors,
          "Paper",
          available.length > 0
            ? `was not found. Use one of ${available.join(", ")}.`
            : "was not found. This examination has no schedulable papers.",
        );
      }
    }

    if (paper && isClassworkComponent(paper.component)) {
      roleError(
        errors,
        "Paper",
        `${componentLabel(paper.component)} is classwork: it has no date or room. Mark it in Marks Entry.`,
      );
    }

    const examDate = normaliseDate(values.exam_date);
    if (Number.isNaN(examDate)) roleError(errors, "Paper date", "must be a valid date.");
    if (!examDate) roleError(errors, "Paper date", "is required.");

    const startTime = normaliseTime(values.start_time);
    if (Number.isNaN(startTime)) roleError(errors, "Start time", "must be a time such as 09:30 or 10:00 AM.");
    if (!startTime) roleError(errors, "Start time", "is required.");

    const endTime = normaliseTime(values.end_time);
    if (Number.isNaN(endTime)) roleError(errors, "End time", "must be a time such as 12:00 or 01:00 PM.");
    if (!endTime) roleError(errors, "End time", "is required.");
    if (startTime && endTime && endTime <= startTime) {
      roleError(errors, "End time", "must be after the start time. Use 01:00 PM for an afternoon paper.");
    }

    const allowOverlap = asFlag(values.allow_overlap);
    if (Number.isNaN(allowOverlap)) roleError(errors, "Allow overlap", "must be Yes or No.");

    const identity =
      klass && subject && paper ? semesterPaperToken(klass.id, subject.id, paper.component) : null;

    return {
      data: {
        component_id: paper?.component.id ?? null,
        class_id: klass?.id ?? null,
        subject_id: subject?.id ?? null,
        exam_id: paper?.exam.id ?? null,
        exam_date: examDate,
        start_time: startTime,
        end_time: endTime,
        room: text(values.room) || null,
        allow_overlap: allowOverlap === true,
      },
      errors,
      identity,
      altIdentities: identity ? [identity] : [],
      label:
        paper && subject
          ? `${componentLabel(paper.component)}, ${subject.code ?? subject.name} (${klass?.name ?? ""})`
          : "Paper schedule",
    };
  },
  async findExisting(_records, context) {
    const map = new Map();
    for (const item of semesterScheduleIndex(context).items) {
      if (isClassworkComponent(item.component)) continue;
      addExisting(map, semesterPaperToken(item.exam.class_id, item.subjectId, item.component), {
        ...item.component,
        class_id: item.exam.class_id,
        subject_id: item.subjectId,
      });
    }
    return map;
  },
  // Conflict preflight. The wizard marks these rows invalid before anything is
  // written, so a clashing paper is never imported silently.
  async preflight(records, context) {
    const notes = new Map();
    const subjectById = new Map((context.subjects ?? []).map((row) => [row.id, row]));
    const scheduled = semesterScheduleIndex(context).items.filter(
      (item) => item.component.is_conducted !== false && item.component.exam_date,
    );

    for (const record of records) {
      const data = record.data ?? {};
      if (!data.class_id || !data.exam_date || !data.start_time || !data.end_time) continue;
      if (data.allow_overlap) continue;

      const clash = scheduled.find((item) => {
        if (item.exam.class_id !== data.class_id) return false;
        if (item.component.id === data.component_id) return false;
        if (item.component.allow_overlap) return false;
        if (item.component.exam_date !== data.exam_date) return false;
        const otherStart = clockKey(item.component.start_time);
        const otherEnd = clockKey(item.component.end_time);
        return otherStart && otherEnd && data.start_time < otherEnd && data.end_time > otherStart;
      });
      if (clash) {
        const subjectCode = subjectById.get(clash.subjectId)?.code ?? "another subject";
        notes.set(
          record.rowNumber,
          `Overlaps ${subjectCode} ${clash.component.code ?? clash.component.name}, already scheduled at ${clockKey(clash.component.start_time)} for this class.`,
        );
        continue;
      }

      const fileClash = records.find((other) => {
        if (other === record) return false;
        if (other.rowNumber > record.rowNumber) return false;
        const value = other.data ?? {};
        if (value.class_id !== data.class_id || value.exam_date !== data.exam_date) return false;
        return value.start_time && value.end_time && data.start_time < value.end_time && data.end_time > value.start_time;
      });
      if (fileClash) {
        notes.set(record.rowNumber, `Overlaps row ${fileClash.rowNumber} in this file for the same class.`);
      }
    }
    return notes;
  },
  async execute({ mode, data, existing }) {
    const componentId = existing?.id ?? data.component_id;
    if (!componentId) {
      throw new Error(
        "This paper is not part of the class semester examination yet. The examination is created automatically from assigned subjects; assign the subject and open the class first.",
      );
    }
    await callRpc("update_assessment_component_schedule", {
      p_component_id: componentId,
      p_patch: {
        is_conducted: true,
        exam_date: data.exam_date,
        start_time: data.start_time,
        end_time: data.end_time,
        room: data.room,
        allow_overlap: Boolean(data.allow_overlap),
      },
      // The row names the class, so its room is written only for that class.
      // Dates and times still propagate across the whole examination group.
      p_room_class_id: data.class_id,
    });
    return { status: mode === "update" || existing ? "updated" : "created" };
  },
};

const scheduleModules = { schedule_semester: semesterScheduleModule };

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

const ATTENDANCE_ROLES = ["admin", "teacher", "hod"];

const attendanceModule = {
  id: "attendance",
  title: "Attendance",
  templateName: "Attendance_Import_Template.xlsx",
  description: "Import classes attended and classes conducted for students in your assigned classes and subjects.",
  identityLabel: "Attendance record",
  roles: ATTENDANCE_ROLES,
  supportsUpdate: true,
  duplicateStrategies: ["new", "skip", "update"],
  defaultStrategy: "update",
  concurrency: 4,
  fields: [
    {
      key: "class",
      label: "Class",
      required: false,
      aliases: ["class", "class name", "group"],
      example: "BCS2A",
      help: "Required when no class is selected on the Attendance screen.",
    },
    {
      key: "subject",
      label: "Subject",
      required: false,
      aliases: ["subject", "subject code", "subject name", "paper"],
      example: "CS201",
      help: "Required when no subject is selected on the Attendance screen.",
    },
    {
      key: "academic_year",
      label: "Academic year",
      required: false,
      aliases: ["academic year", "year", "session", "batch year"],
      example: "2026-27",
      help: "Defaults to the academic year of the selected class.",
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
      key: "attended",
      label: "Classes attended",
      required: true,
      aliases: ["attended", "classes attended", "attended classes", "present", "present classes"],
      example: "18",
      help: "A whole number of classes the student attended. It cannot exceed the total classes.",
    },
    {
      key: "total",
      label: "Total classes",
      required: false,
      aliases: ["total", "total classes", "total classes conducted", "classes conducted", "conducted"],
      example: "22",
      help: "Whole number of classes conducted for the subject. Defaults to the total entered on the Attendance screen.",
    },
    {
      key: "teacher",
      label: "Teacher",
      required: false,
      aliases: ["teacher", "teacher name", "faculty", "recorded by"],
      example: "",
      help: "Administrators only. Defaults to the teacher assigned to the class and subject.",
    },
    {
      key: "notes",
      label: "Notes",
      required: false,
      aliases: ["notes", "note", "remarks", "remark", "comment"],
      example: "",
    },
  ],
  exampleRows: [
    ["BCS2A", "CS201", "2026-27", "GRD2026001", "18", "22", "", ""],
    ["BCS2A", "CS201", "2026-27", "GRD2026002", "20", "22", "", "Medical leave"],
  ],
  async loadContext() {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id ?? null;
    let callerRole = null;
    if (userId) {
      const { data: me } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();
      callerRole = me?.role ?? null;
    }
    return {
      userId,
      callerRole,
      classes: await fetchRows("classes", "id,name,academic_year,semester,section,is_active"),
      subjects: await fetchRows("subjects", "id,name,code,class_id"),
      profiles: await fetchRows("profiles", "id,name,username,email,role,student_id,class_id,is_active"),
      classSubjects: await fetchRows("class_subjects", "id,class_id,subject_id"),
      enrollments: await fetchRows("student_enrollments", "student_id,class_id,status"),
      teacherAssignments: await fetchRows("teacher_assignments", "id,class_id,subject_id,teacher_id"),
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
    if (!klass) roleError(errors, "Class", "is required. Choose a class on the Attendance screen or add a Class column.");

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
    if (!subject) roleError(errors, "Subject", "is required. Choose a subject on the Attendance screen or add a Subject column.");
    else if (klass && !assignedIds.has(subject.id) && subject.class_id !== klass.id) {
      roleError(errors, "Subject", "is not assigned to the selected class.");
    }

    const academicYear = text(values.academic_year) || text(defaults.academic_year) || text(klass?.academic_year);
    if (!academicYear) {
      roleError(errors, "Academic year", "is required. Add an Academic year column or set it on the class.");
    } else if (klass?.academic_year && text(klass.academic_year) !== academicYear) {
      roleError(errors, "Academic year", `must match the class academic year ${klass.academic_year}.`);
    }

    // The database forces a teacher or HOD to record under their own identity.
    // An administrator records on behalf of a teacher assigned to the subject.
    const callerRole = context.callerRole;
    const assignedTeacherIds = new Set(
      (context.teacherAssignments ?? [])
        .filter((row) => row.class_id === klass?.id && row.subject_id === subject?.id)
        .map((row) => row.teacher_id),
    );
    let teacherId = null;
    if (callerRole === "teacher" || callerRole === "hod") {
      teacherId = context.userId ?? null;
      if (klass && subject && teacherId && !assignedTeacherIds.has(teacherId)) {
        roleError(errors, "Class", "you are not assigned to this subject in this class.");
      }
    } else {
      const teacherValue = text(values.teacher);
      if (teacherValue) {
        const key = norm(teacherValue);
        const matches = (context.profiles ?? []).filter(
          (row) =>
            assignedTeacherIds.has(row.id) &&
            (norm(row.name) === key || norm(row.username) === key || norm(row.email) === key),
        );
        if (matches.length === 1) teacherId = matches[0].id;
        else if (matches.length > 1) {
          roleError(errors, "Teacher", "matches more than one teacher. Use the username or email.");
        } else {
          roleError(errors, "Teacher", "was not found or is not assigned to this class and subject.");
        }
      } else if (defaults.teacher_id && assignedTeacherIds.has(defaults.teacher_id)) {
        teacherId = defaults.teacher_id;
      } else if (assignedTeacherIds.size === 1) {
        teacherId = [...assignedTeacherIds][0];
      }
      if (!teacherId) {
        roleError(
          errors,
          "Teacher",
          "is required when more than one teacher is assigned. Choose one on the Attendance screen or add a Teacher column.",
        );
      }
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

    const attended = asInt(values.attended);
    if (attended === null) {
      roleError(errors, "Classes attended", "is required.");
    } else if (Number.isNaN(attended)) {
      roleError(errors, "Classes attended", "must be a whole number.");
    } else if (attended < 0) {
      roleError(errors, "Classes attended", "cannot be negative.");
    }

    let total = asInt(values.total);
    if (total === null) total = asInt(defaults.total_classes);
    if (total === null) {
      roleError(
        errors,
        "Total classes",
        "is required. Enter the total classes conducted on the Attendance screen or add a Total classes column.",
      );
    } else if (Number.isNaN(total)) {
      roleError(errors, "Total classes", "must be a whole number.");
    } else if (total <= 0) {
      roleError(errors, "Total classes", "must be greater than zero.");
    } else if (attended !== null && !Number.isNaN(attended) && attended > total) {
      roleError(errors, "Classes attended", "cannot be greater than total classes.");
    }

    const notes = optionalText(values.notes);
    const identity =
      student && klass && subject && academicYear
        ? token("attendance", student.id, klass.id, subject.id, academicYear)[0]
        : null;
    return {
      data: {
        student_id: student?.id ?? null,
        class_id: klass?.id ?? null,
        subject_id: subject?.id ?? null,
        academic_year: academicYear || null,
        teacher_id: teacherId,
        recorded_by: context.userId ?? null,
        attended_classes: Number.isNaN(attended) ? null : attended,
        total_classes: Number.isNaN(total) ? null : total,
        notes,
      },
      errors,
      identity,
      altIdentities: identity ? [identity] : [],
      label: student && subject ? `${student.name}, ${subject.code}` : studentValue,
    };
  },
  async findExisting(records) {
    const triples = new Map();
    for (const record of records) {
      if (record.errors?.length) continue;
      const data = record.data;
      if (!data?.class_id || !data?.subject_id || !data?.academic_year) continue;
      triples.set(`${data.class_id}:${data.subject_id}:${data.academic_year}`, data);
    }
    const map = new Map();
    for (const triple of triples.values()) {
      const { data, error } = await supabase
        .from("attendance")
        .select("id,student_id,class_id,subject_id,academic_year,attended_classes,total_classes,notes")
        .eq("class_id", triple.class_id)
        .eq("subject_id", triple.subject_id)
        .eq("academic_year", triple.academic_year);
      if (error) throw new Error(`Could not check existing attendance: ${error.message}`);
      for (const row of data ?? []) {
        addExisting(
          map,
          token("attendance", row.student_id, row.class_id, row.subject_id, row.academic_year)[0],
          row,
        );
      }
    }
    return map;
  },
  async execute({ mode, data, existing }) {
    if (!data.student_id || !data.class_id || !data.subject_id) {
      throw new Error("Student, class or subject was not found. Refresh the reference data and try again.");
    }
    if (mode === "update" || existing) {
      const { error } = await supabase
        .from("attendance")
        .upsert(data, { onConflict: "student_id,class_id,subject_id,academic_year" });
      throwDb(error, "An attendance record already exists for this student, subject and academic year.");
      return { status: existing ? "updated" : "created" };
    }
    const { error } = await supabase.from("attendance").insert(data);
    throwDb(error, "An attendance record already exists for this student, subject and academic year.");
    return { status: "created" };
  },
};

// ---------- classwork ----------
// One row creates and publishes an assignment, quiz or project. It only carries
// a deadline and submission details; assessment marks live in the semester exam.
const CLASSWORK_IMPORT_ROLES = ["admin", "teacher", "exam_cell"];

function normaliseClassworkDeadline(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return Number.NaN;
    return `${value.getFullYear()}-${padClock(value.getMonth() + 1)}-${padClock(value.getDate())}` +
      `T${padClock(value.getHours())}:${padClock(value.getMinutes())}:00`;
  }
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (!match) {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return Number.NaN;
    return `${parsed.getFullYear()}-${padClock(parsed.getMonth() + 1)}-${padClock(parsed.getDate())}` +
      `T${padClock(parsed.getHours())}:${padClock(parsed.getMinutes())}:00`;
  }
  const probe = new Date(`${match[1]}T00:00:00`);
  const dateParts = match[1].split("-").map(Number);
  if (
    Number.isNaN(probe.getTime()) ||
    probe.getFullYear() !== dateParts[0] ||
    probe.getMonth() + 1 !== dateParts[1] ||
    probe.getDate() !== dateParts[2]
  ) {
    return Number.NaN;
  }
  const hour = match[2] === undefined ? 23 : Number(match[2]);
  const minute = match[3] === undefined ? 59 : Number(match[3]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return Number.NaN;
  return `${match[1]}T${padClock(hour)}:${padClock(minute)}:00`;
}

function classworkIdentity(row) {
  return token("classwork", row.class_id, row.subject_id, row.kind, row.title)[0] ?? null;
}

function classworkSubjectOffered(context, klass, subject) {
  if (!klass || !subject) return false;
  return (context.classSubjects ?? []).some(
    (row) => row.class_id === klass.id && row.subject_id === subject.id,
  );
}

function classworkAssignedToMe(context, klass, subject) {
  if (!klass || !subject) return false;
  return (context.teacherAssignments ?? []).some(
    (row) =>
      row.class_id === klass.id &&
      row.subject_id === subject.id &&
      row.teacher_id === context.userId,
  );
}

const classworkModule = {
  id: "classwork",
  title: "Classwork",
  templateName: "Classwork_Import_Template.xlsx",
  description: "Publish assignments, quizzes and projects for your classes.",
  identityLabel: "Classwork",
  roles: CLASSWORK_IMPORT_ROLES,
  supportsUpdate: false,
  duplicateStrategies: ["new", "skip"],
  defaultStrategy: "new",
  concurrency: 3,
  fields: [
    {
      key: "kind",
      label: "Kind",
      required: true,
      aliases: ["kind", "type", "activity", "activity type"],
      example: "assignment",
      help: "Use assignment, quiz or project.",
    },
    {
      key: "class",
      label: "Class",
      required: true,
      aliases: ["class", "class name", "group"],
      example: "CSE Semester 3, Section A",
      help: "Use the exact class name shown in Gradia, including the section when it has one.",
    },
    {
      key: "subject",
      label: "Subject",
      required: true,
      aliases: ["subject", "subject code", "subject name", "paper"],
      example: "CS201",
      help: "The subject must already be offered by the class. Teachers can only import subjects assigned to them.",
    },
    {
      key: "title",
      label: "Title",
      required: true,
      aliases: ["title", "name", "classwork title", "assignment title", "quiz title", "project title"],
      example: "Data structures lab report",
    },
    {
      key: "description",
      label: "Description",
      required: false,
      aliases: ["description", "brief", "details"],
      example: "Write up the lab experiment.",
    },
    {
      key: "instructions",
      label: "Instructions",
      required: false,
      aliases: ["instructions", "submission instructions", "notes", "guidance"],
      example: "Use your roll number as the file name.",
    },
    {
      key: "deadline",
      label: "Deadline",
      required: false,
      aliases: ["deadline", "due date", "due on", "due"],
      example: "2026-12-10 23:59",
      help: "YYYY-MM-DD or YYYY-MM-DD HH:MM. A date without a time uses 23:59 in your local time. Excel date cells are also read.",
    },
  ],
  exampleRows(context) {
    const { klass, subject } = firstUsableClassSubject(context);
    const className = classSampleLabel(klass) || "CSE Semester 3, Section A";
    const subjectCode = subject?.code || "CS201";
    return [
      [
        "Assignment",
        className,
        subjectCode,
        "Data structures lab report",
        "Write up the lab experiment.",
        "Upload a PDF.",
        futureDate(14),
      ],
      [
        "Quiz",
        className,
        subjectCode,
        "Week 3 quiz",
        "",
        "Answer every question in the text box.",
        futureDate(21),
      ],
      [
        "Project",
        className,
        subjectCode,
        "Mini project",
        "Build and demonstrate the app.",
        "Upload the source link.",
        futureDate(28),
      ],
    ];
  },
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
      classes: await fetchRows("classes", "id,name,academic_year,semester,section,course_id"),
      subjects: await fetchRows("subjects", "id,name,code,max_marks"),
      classSubjects: await fetchRows("class_subjects", "id,class_id,subject_id"),
      teacherAssignments: await fetchRows("teacher_assignments", "id,class_id,subject_id,teacher_id"),
    };
  },
  resolveRow(values, context) {
    const errors = [];

    const kindKeys = new Map();
    for (const [id, label] of Object.entries(CLASSWORK_KIND_LABEL)) {
      kindKeys.set(id, id);
      kindKeys.set(norm(label), id);
    }
    kindKeys.set("class test", "quiz");
    kindKeys.set("test", "quiz");
    const kind = kindKeys.get(norm(values.kind)) ?? null;
    if (!kind) {
      roleError(errors, "Kind", "must be assignment, quiz or project.");
    }

    const classHit = resolveOne(classLookup(context), values.class);
    if (!classHit.item) {
      roleError(
        errors,
        "Class",
        classHit.ambiguous ? "matches more than one class. Use the exact class name." : "was not found.",
      );
    }
    const klass = classHit.item;

    const subjectHit = resolveOne(subjectLookup(context), values.subject);
    if (!subjectHit.item) {
      roleError(
        errors,
        "Subject",
        subjectHit.ambiguous ? "matches more than one subject. Use the subject code." : "was not found.",
      );
    }
    const subject = subjectHit.item;
    if (klass && subject) {
      if (!classworkSubjectOffered(context, klass, subject)) {
        roleError(errors, "Subject", "is not offered by the selected class.");
      } else if (context.role === "teacher" && !classworkAssignedToMe(context, klass, subject)) {
        roleError(errors, "Subject", "is not assigned to you for this class.");
      }
    }

    const title = text(values.title);
    if (!title) roleError(errors, "Title", "is required.");

    const deadline = normaliseClassworkDeadline(values.deadline);
    if (Number.isNaN(deadline)) {
      roleError(errors, "Deadline", "must be YYYY-MM-DD or YYYY-MM-DD HH:MM.");
    }
    const deadlineIso = !deadline || Number.isNaN(deadline) ? null : new Date(deadline).toISOString();

    const assignedTeacher =
      klass && subject
        ? (context.teacherAssignments ?? []).find(
            (row) => row.class_id === klass.id && row.subject_id === subject.id,
          ) ?? null
        : null;
    const teacherId =
      context.role === "teacher" ? context.userId ?? null : assignedTeacher?.teacher_id ?? null;

    const identity =
      klass && subject && kind && title
        ? token("classwork", klass.id, subject.id, kind, title)[0]
        : null;

    return {
      data: {
        kind,
        class_id: klass?.id ?? null,
        subject_id: subject?.id ?? null,
        teacher_id: teacherId,
        title,
        description: text(values.description),
        instructions: text(values.instructions),
        deadline: deadlineIso,
        created_by: context.userId ?? null,
      },
      errors,
      identity,
      altIdentities: identity ? [identity] : [],
      label: title || values.title || "Classwork",
    };
  },
  async findExisting() {
    const map = new Map();
    const rows = await fetchRows("classwork_items", "id,kind,class_id,subject_id,title,published");
    for (const row of rows) {
      addExisting(map, classworkIdentity(row), row);
    }
    return map;
  },
  async execute({ data }) {
    const { data: item, error } = await supabase
      .from("classwork_items")
      .insert(data)
      .select("id")
      .single();
    throwDb(error, "A classwork item with this title already exists for this class and subject.");
    if (!item?.id) throw new Error("The classwork item was not created.");
    try {
      await callRpc("publish_classwork_item", { p_item_id: item.id });
    } catch (publishError) {
      await supabase.from("classwork_items").delete().eq("id", item.id);
      throw new Error(`Classwork could not be published: ${publishError.message}`);
    }
    return { status: "created", message: "Published to the class." };
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
  ...scheduleModules,
  marks: marksModule,
  attendance: attendanceModule,
  classwork: classworkModule,
};

export function getImportModule(id) {
  return importModules[id] ?? null;
}
