import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Button, Card, Empty, Field, Select, inputClass } from "../../components/ui";
import DashboardHeader from "../../components/dashboard/DashboardHeader";
import DepartmentsPanel from "../../components/academics/DepartmentsPanel";
import DegreesPanel from "../../components/academics/DegreesPanel";
import CoursesPanel from "../../components/academics/CoursesPanel";
import ImportButton from "../../components/import/ImportButton";

const initialClass = { name: "", department_id: "", degree_id: "", course_id: "", academic_year: "", semester: "", section: "", hod_id: "" };
const initialSubject = { name: "", code: "", max_marks: 100 };

const MISSING_RELATION_CODES = new Set(["42P01", "PGRST205"]);

function isMissingRelation(error) {
  if (!error) return false;
  if (MISSING_RELATION_CODES.has(error.code)) return true;
  return /does not exist|schema cache|could not find the table/i.test(error.message ?? "");
}

// The dropdown must identify teachers even when two staff share a name.
function teacherLabel(teacher) {
  if (!teacher) return "";
  const id = teacher.teacher_id || teacher.username;
  return id ? `${teacher.name} (${id})` : teacher.name;
}

function teacherNamesFor(row) {
  return (row.teachers ?? []).map((teacher) => teacherLabel(teacher.profiles)).filter(Boolean);
}

const TABS = [
  { id: "classes", label: "Classes" },
  { id: "subjects", label: "Subjects" },
  { id: "departments", label: "Departments" },
  { id: "degrees", label: "Degrees" },
  { id: "courses", label: "Courses" },
];

export default function ManageClasses() {
  const [activeTab, setActiveTab] = useState("classes");
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [degrees, setDegrees] = useState([]);
  const [courses, setCourses] = useState([]);
  const [hods, setHods] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [classForm, setClassForm] = useState(initialClass);
  const [editingClassId, setEditingClassId] = useState("");
  const [subjectForm, setSubjectForm] = useState(initialSubject);
  const [editingSubjectId, setEditingSubjectId] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedSubjectIds, setSelectedSubjectIds] = useState([]);
  const [teachersBySubject, setTeachersBySubject] = useState({});
  const [teacherDrafts, setTeacherDrafts] = useState({});
  const [editingTeacherRowId, setEditingTeacherRowId] = useState("");
  const [assignedRows, setAssignedRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState("");
  const [success, setSuccess] = useState("");

  const filteredCourses = useMemo(
    () =>
      courses.filter(
        (course) =>
          (!classForm.department_id || course.department_id === classForm.department_id) &&
          (!classForm.degree_id || !course.degree_id || course.degree_id === classForm.degree_id),
      ),
    [courses, classForm.department_id, classForm.degree_id]
  );
  const degreeName = (id) => degrees.find((item) => item.id === id)?.name ?? null;
  const filteredHods = useMemo(
    () =>
      hods.filter(
        (hod) =>
          !classForm.department_id ||
          hod.department_id === classForm.department_id ||
          hod.id === classForm.hod_id,
      ),
    [hods, classForm.department_id, classForm.hod_id]
  );

  async function load() {
    setLoading(true);
    setPageError("");
    const results = await Promise.all([
      supabase.from("classes").select("*").order("name"),
      supabase.from("subjects").select("*").order("code"),
      supabase.from("departments").select("id,name,code").order("name"),
      supabase.from("degrees").select("id,name,code").order("name"),
      supabase.from("courses").select("id,name,code,department_id,degree_id,duration_years").order("name"),
      supabase.from("profiles").select("id,name,username,teacher_id,role,hod_type,department_id").in("role", ["hod", "teacher"]).eq("is_active", true),
    ]);
    const labels = ["classes", "subjects", "departments", "degrees", "courses", "teachers/HODs"];
    const failed = results.findIndex((result, index) => result.error && !(index === 3 && isMissingRelation(result.error)));
    if (failed !== -1) {
      setPageError(`${labels[failed]}: ${results[failed].error.message}`);
    }
    setClasses(results[0].data ?? []);
    setSubjects(results[1].data ?? []);
    setDepartments(results[2].data ?? []);
    setDegrees(results[3].data ?? []);
    setCourses(results[4].data ?? []);
    const staff = results[5].data ?? [];
    setHods(staff.filter((person) => person.role === "hod" && person.hod_type !== "subject"));
    setTeachers(staff.filter((person) => person.role === "teacher"));
    setLoading(false);
  }

  async function loadAssignments(classId) {
    if (!classId) { setAssignedRows([]); return; }
    const { data, error } = await supabase
      .from("class_subjects")
      .select("id,class_id,subject_id,subjects(id,name,code,max_marks)")
      .eq("class_id", classId)
      .order("created_at");
    if (error) { setPageError(`Assignments: ${error.message}`); return; }
    const ids = (data ?? []).map((row) => row.subject_id);
    let teacherRows = [];
    if (ids.length) {
      const response = await supabase
        .from("teacher_assignments")
        .select("id,subject_id,teacher_id,is_primary,profiles!teacher_assignments_teacher_id_fkey(id,name,teacher_id,username)")
        .eq("class_id", classId)
        .in("subject_id", ids);
      if (response.error) setPageError(`Teacher assignments: ${response.error.message}`);
      teacherRows = response.data ?? [];
    }
    const bySubject = new Map();
    teacherRows.forEach((row) => {
      const list = bySubject.get(row.subject_id) ?? [];
      list.push(row);
      bySubject.set(row.subject_id, list);
    });
    bySubject.forEach((list) => list.sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || (a.profiles?.name ?? "").localeCompare(b.profiles?.name ?? "")));
    setAssignedRows((data ?? []).map((row) => ({
      ...row,
      teachers: bySubject.get(row.subject_id) ?? [],
    })));
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { loadAssignments(selectedClassId); }, [selectedClassId]);

  async function addClass(event) {
    event.preventDefault(); setPageError(""); setSuccess("");
    if (!classForm.department_id) { setPageError("Select the department this class belongs to."); return; }
    if (!classForm.degree_id) { setPageError("Select the degree this class belongs to."); return; }
    if (!classForm.course_id) { setPageError("Select the course this class belongs to."); return; }
    setSaving(true);
    const department = departments.find((item) => item.id === classForm.department_id);
    const payload = {
      name: classForm.name.trim(),
      department: department?.name ?? "",
      degree_id: classForm.degree_id,
      course_id: classForm.course_id,
      academic_year: classForm.academic_year.trim(),
      semester: Number(classForm.semester),
      section: classForm.section.trim(),
      hod_id: classForm.hod_id || null,
    };
    const { data, error } = editingClassId
      ? await supabase.from("classes").update(payload).eq("id", editingClassId).select("id").single()
      : await supabase.from("classes").insert(payload).select("id").single();
    if (error) setPageError(`Could not save class: ${error.message}`);
    else {
      setClassForm(initialClass); setEditingClassId(""); setSelectedClassId(data.id);
      setSuccess(editingClassId ? "Class updated successfully." : "Class created successfully.");
      await load();
    }
    setSaving(false);
  }

  function startEditClass(item) {
    const course = courses.find((entry) => entry.id === item.course_id);
    setEditingClassId(item.id);
    setClassForm({
      name: item.name ?? "",
      department_id: course?.department_id ?? "",
      degree_id: item.degree_id ?? course?.degree_id ?? "",
      course_id: item.course_id ?? "",
      academic_year: item.academic_year ?? "",
      semester: item.semester ? String(item.semester) : "",
      section: item.section ?? "",
      hod_id: item.hod_id ?? "",
    });
    setPageError(""); setSuccess("");
    setActiveTab("classes");
  }

  function cancelClassEdit() {
    setEditingClassId("");
    setClassForm(initialClass);
    setPageError("");
  }

  async function addSubject(event) {
    event.preventDefault(); setPageError(""); setSuccess(""); setSaving(true);
    const payload = {
      name: subjectForm.name.trim(),
      code: subjectForm.code.trim(),
      max_marks: Number(subjectForm.max_marks),
    };
    const { error } = editingSubjectId
      ? await supabase.from("subjects").update(payload).eq("id", editingSubjectId)
      : await supabase.from("subjects").insert({ ...payload, class_id: null, teacher_id: null });
    if (error) setPageError(`Could not save subject: ${error.message}`);
    else {
      setSubjectForm(initialSubject); setEditingSubjectId("");
      setSuccess(editingSubjectId ? "Subject updated." : "Subject added to the subject catalogue.");
      await load();
    }
    setSaving(false);
  }

  function startEditSubject(subject) {
    setEditingSubjectId(subject.id);
    setSubjectForm({
      name: subject.name ?? "",
      code: subject.code ?? "",
      max_marks: subject.max_marks ?? 100,
    });
    setPageError(""); setSuccess("");
    setActiveTab("subjects");
  }

  function cancelSubjectEdit() {
    setEditingSubjectId("");
    setSubjectForm(initialSubject);
    setPageError("");
  }

  function toggleSubject(id) {
    setSelectedSubjectIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleTeacherForSubject(subjectId, teacherId) {
    setTeachersBySubject((current) => {
      const selected = current[subjectId] ?? [];
      return {
        ...current,
        [subjectId]: selected.includes(teacherId)
          ? selected.filter((id) => id !== teacherId)
          : [...selected, teacherId],
      };
    });
  }

  function startEditTeachers(row) {
    setEditingTeacherRowId(row.id);
    setTeacherDrafts((current) => ({ ...current, [row.id]: row.teachers.map((teacher) => teacher.teacher_id) }));
    setPageError("");
    setSuccess("");
  }

  function cancelEditTeachers() {
    setEditingTeacherRowId("");
    setTeacherDrafts({});
    setPageError("");
  }

  function toggleDraftTeacher(rowId, teacherId) {
    setTeacherDrafts((current) => {
      const selected = current[rowId] ?? [];
      return {
        ...current,
        [rowId]: selected.includes(teacherId)
          ? selected.filter((id) => id !== teacherId)
          : [...selected, teacherId],
      };
    });
  }

  async function assignSubjects(event) {
    event.preventDefault();
    if (!selectedClassId) { setPageError("Select a class first."); return; }
    if (!selectedSubjectIds.length) { setPageError("Select at least one subject."); return; }
    setPageError(""); setSuccess(""); setSaving(true);
    const existing = new Set(assignedRows.map((row) => row.subject_id));
    const newIds = selectedSubjectIds.filter((id) => !existing.has(id));
    if (!newIds.length) { setPageError("All selected subjects are already assigned to this class."); setSaving(false); return; }
    const missingTeachers = newIds.filter((id) => !(teachersBySubject[id]?.length));
    if (missingTeachers.length) {
      const codes = missingTeachers.map((id) => subjects.find((subject) => subject.id === id)?.code ?? "subject").join(", ");
      setPageError(`Assign at least one teacher to every selected subject. Missing: ${codes}.`);
      setSaving(false);
      return;
    }
    const { data: created, error: linkError } = await supabase
      .from("class_subjects")
      .insert(newIds.map((subject_id) => ({ class_id: selectedClassId, subject_id })))
      .select("id,subject_id");
    if (linkError) { setPageError(`Could not assign subjects: ${linkError.message}`); setSaving(false); return; }
    const classSubjectBySubject = new Map((created ?? []).map((row) => [row.subject_id, row.id]));
    const teacherRows = newIds.flatMap((subject_id) =>
      (teachersBySubject[subject_id] ?? []).map((teacher_id, index) => ({
        class_id: selectedClassId,
        subject_id,
        class_subject_id: classSubjectBySubject.get(subject_id),
        teacher_id,
        is_primary: index === 0,
      })),
    );
    if (teacherRows.length) {
      const { error } = await supabase.from("teacher_assignments").insert(teacherRows);
      if (error) {
        await supabase.from("class_subjects").delete().in("id", (created ?? []).map((row) => row.id));
        setPageError(`Subjects were not assigned because teacher allocation failed: ${error.message}`);
        setSaving(false);
        return;
      }
    }
    setSelectedSubjectIds([]); setTeachersBySubject({}); setTeacherDrafts({}); setEditingTeacherRowId("");
    setSuccess("Selected subjects assigned to the class with their teachers.");
    await loadAssignments(selectedClassId); setSaving(false);
  }

  async function saveTeachers(row) {
    const selected = teacherDrafts[row.id] ?? [];
    if (!selected.length) { setPageError("Keep at least one teacher assigned to this subject."); return; }
    const current = row.teachers ?? [];
    const currentIds = current.map((teacher) => teacher.teacher_id);
    const toRemove = current.filter((teacher) => !selected.includes(teacher.teacher_id));
    const toAdd = selected.filter((id) => !currentIds.includes(id));
    const currentPrimary = current.find((teacher) => teacher.is_primary)?.teacher_id;
    const nextPrimary = selected.includes(currentPrimary) ? currentPrimary : selected[0];
    setSaving(true); setPageError(""); setSuccess("");
    let failure = null;
    if (toAdd.length) {
      const { error } = await supabase.from("teacher_assignments").insert(toAdd.map((teacher_id) => ({
        class_id: row.class_id ?? selectedClassId,
        subject_id: row.subject_id,
        class_subject_id: row.id,
        teacher_id,
        is_primary: false,
      })));
      if (error) failure = error;
    }
    if (!failure && toRemove.length) {
      const { error } = await supabase.from("teacher_assignments").delete().in("id", toRemove.map((teacher) => teacher.id));
      if (error) failure = error;
    }
    if (!failure) {
      const { error } = await supabase
        .from("teacher_assignments")
        .update({ is_primary: true })
        .eq("class_subject_id", row.id)
        .eq("teacher_id", nextPrimary);
      if (error) failure = error;
    }
    if (failure) {
      setPageError(`Could not update teachers: ${failure.message}`);
    } else {
      setSuccess("Teachers updated for this subject.");
      setEditingTeacherRowId("");
      setTeacherDrafts({});
      await loadAssignments(selectedClassId);
    }
    setSaving(false);
  }

  async function removeAssignment(row) {
    if (!window.confirm(`Remove ${row.subjects?.name ?? "this subject"} from the selected class?`)) return;
    const { error } = await supabase.from("class_subjects").delete().eq("id", row.id);
    if (error) setPageError(error.message);
    else { setSuccess("Subject removed from this class. The subject catalogue was not deleted."); await loadAssignments(selectedClassId); }
  }

  async function removeSubject(subject) {
    if (!window.confirm(`Delete ${subject.name} from the subject catalogue? This may be blocked if it is used in marks or exams.`)) return;
    const { error } = await supabase.from("subjects").delete().eq("id", subject.id);
    if (error) setPageError(error.message);
    else { setSuccess("Subject deleted from the catalogue."); await load(); await loadAssignments(selectedClassId); }
  }

  async function removeClass(id) {
    if (!window.confirm("Delete this class? Existing exams and marks linked to it may also be affected.")) return;
    const { error } = await supabase.from("classes").delete().eq("id", id);
    if (error) setPageError(error.message);
    else { if (selectedClassId === id) setSelectedClassId(""); setSuccess("Class deleted."); await load(); }
  }

  async function saveDepartment(form, editingId) {
    setPageError(""); setSuccess("");
    const name = form.name.trim();
    const code = form.code.trim() || null;
    if (!name) { setPageError("A department name is required."); return false; }
    setSaving(true);
    const previous = departments.find((item) => item.id === editingId);
    const result = editingId
      ? await supabase.from("departments").update({ name, code }).eq("id", editingId).select("id").single()
      : await supabase.from("departments").insert({ name, code }).select("id").single();
    if (result.error) {
      setSaving(false);
      setPageError(result.error.code === "23505"
        ? "A department with that name or code already exists."
        : `Could not save department: ${result.error.message}`);
      return false;
    }
    if (editingId && previous && previous.name !== name) {
      const courseIds = courses.filter((course) => course.department_id === editingId).map((course) => course.id);
      if (courseIds.length) {
        const { error: syncError } = await supabase.from("classes").update({ department: name }).in("course_id", courseIds);
        if (syncError) setPageError(`Department saved, but class labels could not be refreshed: ${syncError.message}`);
      }
      const { error: textError } = await supabase.from("classes").update({ department: name }).eq("department", previous.name);
      if (textError) setPageError(`Department saved, but class labels could not be refreshed: ${textError.message}`);
    }
    setSuccess(editingId ? "Department updated." : "Department created.");
    await load();
    setSaving(false);
    return true;
  }

  async function deleteDepartment(department) {
    setPageError(""); setSuccess("");
    const used = courses.filter((course) => course.department_id === department.id).length;
    if (used) {
      setPageError(`Cannot delete ${department.name}: ${used} course${used === 1 ? "" : "s"} still belong to this department. Reassign or delete those courses first.`);
      return;
    }
    const classCount = classes.filter((item) => item.department === department.name).length;
    if (classCount) {
      setPageError(`Cannot delete ${department.name}: ${classCount} class${classCount === 1 ? "" : "es"} still reference this department. Reassign those classes first.`);
      return;
    }
    if (!window.confirm(`Delete department ${department.name}?`)) return;
    setSaving(true);
    const { error } = await supabase.from("departments").delete().eq("id", department.id);
    if (error) setPageError(`Could not delete department: ${error.message}`);
    else { setSuccess("Department deleted."); await load(); }
    setSaving(false);
  }

  async function saveCourse(form, editingId) {
    setPageError(""); setSuccess("");
    const name = form.name.trim();
    const departmentId = form.department_id;
    const degreeId = form.degree_id;
    const duration = form.duration_years === "" || form.duration_years == null ? null : Number(form.duration_years);
    if (!name) { setPageError("A course name is required."); return false; }
    if (!departmentId) { setPageError("Select the department this course belongs to."); return false; }
    if (!degreeId) { setPageError("Select the degree this course belongs to."); return false; }
    if (duration !== null && (!Number.isFinite(duration) || duration <= 0)) {
      setPageError("Duration must be a positive number of years.");
      return false;
    }
    setSaving(true);
    const payload = { name, code: form.code.trim() || null, department_id: departmentId, degree_id: degreeId, duration_years: duration };
    const result = editingId
      ? await supabase.from("courses").update(payload).eq("id", editingId).select("id").single()
      : await supabase.from("courses").insert(payload).select("id").single();
    if (result.error) {
      setSaving(false);
      setPageError(result.error.code === "23505"
        ? "This department already has a course with that name."
        : `Could not save course: ${result.error.message}`);
      return false;
    }
    const department = departments.find((item) => item.id === departmentId);
    if (department) {
      const { error: syncError } = await supabase.from("classes").update({ department: department.name }).eq("course_id", result.data.id);
      if (syncError) setPageError(`Course saved, but class labels could not be refreshed: ${syncError.message}`);
    }
    setSuccess(editingId ? "Course updated." : "Course created.");
    await load();
    setSaving(false);
    return true;
  }

  async function deleteCourse(course) {
    setPageError(""); setSuccess("");
    const used = classes.filter((item) => item.course_id === course.id).length;
    if (used) {
      setPageError(`Cannot delete ${course.name}: ${used} class${used === 1 ? "" : "es"} still use this course. Reassign those classes first.`);
      return;
    }
    if (!window.confirm(`Delete course ${course.name}?`)) return;
    setSaving(true);
    const { error } = await supabase.from("courses").delete().eq("id", course.id);
    if (error) setPageError(`Could not delete course: ${error.message}`);
    else { setSuccess("Course deleted."); await load(); }
    setSaving(false);
  }

  async function saveDegree(form, editingId) {
    setPageError(""); setSuccess("");
    const name = form.name.trim();
    const code = form.code.trim() || null;
    if (!name) { setPageError("A degree name is required."); return false; }
    setSaving(true);
    const payload = { name, code };
    const result = editingId
      ? await supabase.from("degrees").update(payload).eq("id", editingId).select("id").single()
      : await supabase.from("degrees").insert(payload).select("id").single();
    if (result.error) {
      setSaving(false);
      setPageError(result.error.code === "23505"
        ? "A degree with that name or code already exists."
        : `Could not save degree: ${result.error.message}`);
      return false;
    }
    setSuccess(editingId ? "Degree updated." : "Degree created.");
    await load();
    setSaving(false);
    return true;
  }

  async function deleteDegree(degree) {
    setPageError(""); setSuccess("");
    const courseTotal = courses.filter((course) => course.degree_id === degree.id).length;
    const classTotal = classes.filter((item) => item.degree_id === degree.id).length;
    if (courseTotal || classTotal) {
      setPageError(
        `Cannot delete ${degree.name}: ${courseTotal} course${courseTotal === 1 ? "" : "s"} and ${classTotal} class${classTotal === 1 ? "" : "es"} still use it. Reassign them first.`,
      );
      return;
    }
    if (!window.confirm(`Delete degree ${degree.name}?`)) return;
    setSaving(true);
    const { error } = await supabase.from("degrees").delete().eq("id", degree.id);
    if (error) setPageError(`Could not delete degree: ${error.message}`);
    else { setSuccess("Degree deleted."); await load(); }
    setSaving(false);
  }

  function manageSubjectsFor(classId) {
    setSelectedClassId(classId);
    setSelectedSubjectIds([]);
    setTeachersBySubject({});
    setTeacherDrafts({});
    setEditingTeacherRowId("");
    setActiveTab("subjects");
  }

  return (
    <>
      <DashboardHeader title="Academics" subtitle="Manage departments, courses, classes and subjects in one connected structure." />

      {pageError && <div role="alert" className="mt-5 rounded-lg border border-(--danger)/40 bg-(--danger-subtle) p-3 text-sm text-(--danger)">{pageError}</div>}
      {success && <div role="status" className="mt-5 rounded-lg border border-(--success)/40 bg-(--success-subtle) p-3 text-sm text-(--success)">{success}</div>}

      <div role="tablist" aria-label="Academic management" className="mt-6 flex flex-wrap gap-1 rounded-xl border border-(--border) bg-(--surface-secondary) p-1">
        {TABS.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`academics-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`academics-panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2 ${selected ? "bg-(--primary-deep) text-white" : "text-(--muted-foreground) hover:bg-(--primary)/5 hover:text-(--foreground)"}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`academics-panel-${activeTab}`} aria-labelledby={`academics-tab-${activeTab}`} className="mt-6">
        {activeTab === "classes" && (
          <>
            <section>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-xs font-medium text-(--muted-foreground)">Section 01</p><h2 className="text-base font-semibold text-(--foreground)">{editingClassId ? "Edit class" : "Create class"}</h2><p className="mt-1 text-xs text-(--muted-foreground)">Create the academic class independently. Subjects are assigned from the Subjects tab.</p></div>
                <ImportButton moduleId="classes" onComplete={load} />
              </div>
              <Card>
                {departments.length === 0 && <p className="mb-3 text-xs text-(--danger)">No departments found. Add departments, degrees and courses before creating classes.</p>}
                {departments.length > 0 && degrees.length === 0 && <p className="mb-3 text-xs text-(--danger)">No degrees found. Add a degree in the Degrees tab before creating classes.</p>}
                <form onSubmit={addClass} className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  <Field label="Class name"><input className={inputClass} value={classForm.name} onChange={(e) => setClassForm({ ...classForm, name: e.target.value })} placeholder="e.g. CSE Semester 3, Section A" required /></Field>
                  <Field label="Department"><Select value={classForm.department_id} onChange={(e) => setClassForm({ ...classForm, department_id: e.target.value, course_id: "", hod_id: "" })} required><option value="">Select department</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}{d.code ? ` (${d.code})` : ""}</option>)}</Select></Field>
                  <Field label="Degree"><Select value={classForm.degree_id} onChange={(e) => setClassForm({ ...classForm, degree_id: e.target.value, course_id: "" })} required disabled={degrees.length === 0}><option value="">{degrees.length === 0 ? "No degrees yet" : "Select degree"}</option>{degrees.map((d) => <option key={d.id} value={d.id}>{d.name}{d.code ? ` (${d.code})` : ""}</option>)}</Select></Field>
                  <Field label="Course"><Select value={classForm.course_id} onChange={(e) => { const course = courses.find((entry) => entry.id === e.target.value); setClassForm({ ...classForm, course_id: e.target.value, degree_id: course?.degree_id ?? classForm.degree_id }); }} required disabled={!classForm.degree_id || filteredCourses.length === 0}><option value="">{classForm.degree_id ? "Select course" : "Select degree first"}</option>{filteredCourses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
                  <Field label="Academic year"><input className={inputClass} value={classForm.academic_year} onChange={(e) => setClassForm({ ...classForm, academic_year: e.target.value })} placeholder="2026-27" required /></Field>
                  <Field label="Semester"><Select value={classForm.semester} onChange={(e) => setClassForm({ ...classForm, semester: e.target.value })} required><option value="">Select semester</option>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>Semester {i + 1}</option>)}</Select></Field>
                  <Field label="Section"><input className={inputClass} value={classForm.section} onChange={(e) => setClassForm({ ...classForm, section: e.target.value })} placeholder="A" required /></Field>
                  <Field label="Department HOD (optional)"><Select value={classForm.hod_id} onChange={(e) => setClassForm({ ...classForm, hod_id: e.target.value })}><option value="">Not assigned</option>{filteredHods.map((hod) => <option key={hod.id} value={hod.id}>{hod.name}</option>)}</Select></Field>
                  <div className="flex items-end"><Button type="submit" disabled={saving || !departments.length || !degrees.length || !filteredCourses.length}>{saving ? "Saving..." : editingClassId ? "Save changes" : "Create Class"}</Button></div>
                </form>
                {editingClassId ? <div className="mt-3"><Button type="button" variant="subtle" onClick={cancelClassEdit} disabled={saving}>Cancel edit</Button></div> : null}
              </Card>
            </section>

            <section className="mt-8">
              <div className="mb-3"><h2 className="text-base font-semibold text-(--foreground)">All classes</h2><p className="mt-1 text-xs text-(--muted-foreground)">Open a class to assign its subjects, or delete a class you no longer need.</p></div>
              {loading ? <div className="glass-inner h-12 animate-pulse rounded-lg" /> : classes.length === 0 ? <Empty>No classes created yet.</Empty> : <div className="space-y-2">{classes.map((item) => <div key={item.id} className="glass-inner flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm"><div className="text-(--foreground)"><strong>{item.name}</strong><span className="block text-xs text-(--muted-foreground)">{degreeName(item.degree_id) ? `${degreeName(item.degree_id)}, ` : ""}{item.department}, {item.academic_year ?? "Year not set"}, Semester {item.semester ?? "Not set"}, Section {item.section ?? "Not set"}</span></div><div className="flex gap-2"><Button type="button" variant="subtle" onClick={() => startEditClass(item)}>Edit</Button><Button type="button" variant="subtle" onClick={() => manageSubjectsFor(item.id)}>Manage subjects</Button><Button type="button" variant="danger" onClick={() => removeClass(item.id)}>Delete</Button></div></div>)}</div>}
            </section>
          </>
        )}

        {activeTab === "subjects" && (
          <>
            <section>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-xs font-medium text-(--muted-foreground)">Section 02</p><h2 className="text-base font-semibold text-(--foreground)">{editingSubjectId ? "Edit subject" : "Create subject"}</h2><p className="mt-1 text-xs text-(--muted-foreground)">Add a subject once to the institution-wide catalogue. Do not select a class here.</p></div>
                <ImportButton moduleId="subjects" onComplete={load} />
              </div>
              <Card>
                <form onSubmit={addSubject} className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <Field label="Subject name"><input className={inputClass} value={subjectForm.name} onChange={(e) => setSubjectForm({ ...subjectForm, name: e.target.value })} placeholder="Data Structures" required /></Field>
                  <Field label="Subject code"><input className={inputClass} value={subjectForm.code} onChange={(e) => setSubjectForm({ ...subjectForm, code: e.target.value })} placeholder="CS201" required /></Field>
                  <Field label="Maximum marks"><input type="number" min="1" className={inputClass} value={subjectForm.max_marks} onChange={(e) => setSubjectForm({ ...subjectForm, max_marks: e.target.value })} required /></Field>
                  <div className="flex items-end"><Button type="submit" disabled={saving}>{saving ? "Saving..." : editingSubjectId ? "Save changes" : "Create Subject"}</Button></div>
                </form>
                {editingSubjectId ? <div className="mt-3"><Button type="button" variant="subtle" onClick={cancelSubjectEdit} disabled={saving}>Cancel edit</Button></div> : null}
              </Card>
              <div className="mt-3 space-y-2">
                {subjects.length === 0 ? <Empty>No subjects in the catalogue yet.</Empty> : subjects.map((subject) => <div key={subject.id} className="glass-inner flex items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm"><span className="min-w-0 text-(--foreground)"><strong>{subject.code}</strong>, {subject.name}<span className="ml-2 text-xs text-(--muted-foreground)">Max marks: {subject.max_marks}</span></span><div className="flex gap-2"><Button type="button" variant="subtle" onClick={() => startEditSubject(subject)}>Edit</Button><Button type="button" variant="danger" onClick={() => removeSubject(subject)}>Delete</Button></div></div>)}
              </div>
            </section>

            <section className="mt-8">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-xs font-medium text-(--muted-foreground)">Section 03</p><h2 className="text-base font-semibold text-(--foreground)">Assign multiple subjects to a class</h2><p className="mt-1 text-xs text-(--muted-foreground)">Choose a class, select several catalogue subjects, and assign at least one teacher to each subject. More than one teacher can share a subject.</p></div>
                <ImportButton
                  moduleId="class_subjects"
                  label="Import class subjects"
                  onComplete={() => {
                    load();
                    loadAssignments(selectedClassId);
                  }}
                />
              </div>
              <Card>
                <form onSubmit={assignSubjects} className="space-y-4">
                  <Field label="Select class"><Select value={selectedClassId} onChange={(e) => { setSelectedClassId(e.target.value); setSelectedSubjectIds([]); setTeachersBySubject({}); setTeacherDrafts({}); setEditingTeacherRowId(""); }} required><option value="">Choose a class</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}, {c.department} {c.section ? `(${c.section})` : ""}</option>)}</Select></Field>
                  {selectedClassId && <>
                    <div><p className="mb-2 text-xs font-semibold text-(--foreground)">Choose subjects from the catalogue</p>
                      {subjects.length === 0 ? <Empty>Create subjects in Section 02 first.</Empty> : <div className="grid gap-2 md:grid-cols-2">{subjects.map((subject) => {
                        const alreadyAssigned = assignedRows.some((row) => row.subject_id === subject.id);
                        return <label key={subject.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border border-(--border) p-3 ${alreadyAssigned ? "opacity-50" : ""}`}><input type="checkbox" className="mt-1" checked={selectedSubjectIds.includes(subject.id)} disabled={alreadyAssigned} onChange={() => toggleSubject(subject.id)} /><span className="min-w-0 flex-1 text-sm text-(--foreground)"><strong>{subject.code}</strong>, {subject.name}<span className="block text-xs text-(--muted-foreground)">{alreadyAssigned ? "Already assigned" : `Maximum marks: ${subject.max_marks}`}</span></span></label>;
                      })}</div>}
                    </div>
                    {selectedSubjectIds.length > 0 && (
                      <div className="space-y-3">
                        <p className="text-xs font-semibold text-(--foreground)">Assign at least one teacher to every selected subject</p>
                        {selectedSubjectIds.map((id) => {
                          const subject = subjects.find((item) => item.id === id);
                          const selectedTeachers = teachersBySubject[id] ?? [];
                          return (
                            <div key={id} className="rounded-lg border border-(--border) p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-sm text-(--foreground)">{subject?.code}, {subject?.name}</span>
                                <span className={`text-xs ${selectedTeachers.length ? "text-(--muted-foreground)" : "text-(--danger)"}`}>
                                  {selectedTeachers.length ? `${selectedTeachers.length} selected` : "Select at least one teacher"}
                                </span>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {teachers.length === 0 ? (
                                  <p className="text-xs text-(--danger)">No active teachers available. Add teachers in Users before assigning subjects.</p>
                                ) : (
                                  teachers.map((teacher) => {
                                    const active = selectedTeachers.includes(teacher.id);
                                    return (
                                      <button
                                        key={teacher.id}
                                        type="button"
                                        aria-pressed={active}
                                        onClick={() => toggleTeacherForSubject(id, teacher.id)}
                                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2 ${active ? "border-(--primary) bg-(--primary)/10 text-(--primary)" : "border-(--border) text-(--muted-foreground) hover:border-(--primary)/40 hover:text-(--foreground)"}`}
                                      >
                                        {teacherLabel(teacher)}
                                      </button>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <Button type="submit" disabled={saving || selectedSubjectIds.length === 0}>{saving ? "Assigning..." : `Assign ${selectedSubjectIds.length || "Selected"} Subject(s)`}</Button>
                  </>}
                </form>
                {selectedClassId && (
                  <div className="mt-6 border-t border-(--border) pt-4">
                    <p className="mb-3 text-sm font-semibold text-(--foreground)">Subjects currently assigned to this class</p>
                    {assignedRows.length === 0 ? (
                      <Empty>No subjects assigned to this class yet.</Empty>
                    ) : (
                      <div className="space-y-2">
                        {assignedRows.map((row) => {
                          const names = teacherNamesFor(row);
                          const editing = editingTeacherRowId === row.id;
                          const draft = teacherDrafts[row.id] ?? [];
                          return (
                            <div key={row.id} className="rounded-lg border border-(--border) p-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="text-sm text-(--foreground)">
                                  <strong>{row.subjects?.code}</strong>, {row.subjects?.name}
                                  <span className={`block text-xs ${names.length ? "text-(--muted-foreground)" : "text-(--danger)"}`}>
                                    {names.length ? `Teachers: ${names.join(", ")}` : "No teacher assigned. Assign at least one teacher."}
                                  </span>
                                </div>
                                <div className="flex gap-2">
                                  <Button type="button" variant="subtle" onClick={() => startEditTeachers(row)} disabled={saving}>Manage teachers</Button>
                                  <Button type="button" variant="danger" onClick={() => removeAssignment(row)} disabled={saving}>Remove</Button>
                                </div>
                              </div>
                              {editing ? (
                                <div className="mt-3 border-t border-(--border) pt-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-xs font-semibold text-(--foreground)">Select one or more teachers</p>
                                    <span className={`text-xs ${draft.length ? "text-(--muted-foreground)" : "text-(--danger)"}`}>{draft.length ? `${draft.length} selected` : "At least one required"}</span>
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {teachers.length === 0 ? (
                                      <p className="text-xs text-(--danger)">No active teachers available.</p>
                                    ) : (
                                      teachers.map((teacher) => {
                                        const active = draft.includes(teacher.id);
                                        return (
                                          <button
                                            key={teacher.id}
                                            type="button"
                                            aria-pressed={active}
                                            onClick={() => toggleDraftTeacher(row.id, teacher.id)}
                                            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2 ${active ? "border-(--primary) bg-(--primary)/10 text-(--primary)" : "border-(--border) text-(--muted-foreground) hover:border-(--primary)/40 hover:text-(--foreground)"}`}
                                          >
                                            {teacherLabel(teacher)}
                                          </button>
                                        );
                                      })
                                    )}
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <Button type="button" onClick={() => saveTeachers(row)} disabled={saving || draft.length === 0}>{saving ? "Saving..." : "Save teachers"}</Button>
                                    <Button type="button" variant="subtle" onClick={cancelEditTeachers} disabled={saving}>Cancel</Button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </section>
          </>
        )}

        {activeTab === "departments" && (
          <DepartmentsPanel
            departments={departments}
            courses={courses}
            loading={loading}
            saving={saving}
            onSave={saveDepartment}
            onDelete={deleteDepartment}
            onReload={load}
          />
        )}

        {activeTab === "degrees" && (
          <DegreesPanel
            degrees={degrees}
            courses={courses}
            classes={classes}
            loading={loading}
            saving={saving}
            onSave={saveDegree}
            onDelete={deleteDegree}
            onReload={load}
          />
        )}

        {activeTab === "courses" && (
          <CoursesPanel
            courses={courses}
            departments={departments}
            degrees={degrees}
            classes={classes}
            loading={loading}
            saving={saving}
            onSave={saveCourse}
            onDelete={deleteCourse}
            onReload={load}
          />
        )}
      </div>
    </>
  );
}
