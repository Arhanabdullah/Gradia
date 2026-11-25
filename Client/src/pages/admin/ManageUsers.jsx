import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Button, Card, Empty, Field, Select, inputClass } from "../../components/ui";
import DashboardHeader from "../../components/dashboard/DashboardHeader";
import ImportButton from "../../components/import/ImportButton";

const ROLES = ["student", "teacher", "hod", "principal", "admin", "coordinator", "exam_cell"];
const ROLE_LABEL = {
  student: "Student",
  teacher: "Teacher",
  hod: "HOD",
  principal: "Principal",
  admin: "Admin",
  coordinator: "Coordinator",
  exam_cell: "Exam Cell",
};
const EMPTY_FORM = {
  name: "", username: "", email: "", password: "", phone: "", role: "student",
  student_id: "", registration_no: "", teacher_id: "", department_id: "", degree_id: "", course_id: "", class_id: "",
  hod_type: "department", hod_subject_id: "",
};

const MISSING_RELATION_CODES = new Set(["42P01", "PGRST205"]);

function isMissingRelation(error) {
  if (!error) return false;
  if (MISSING_RELATION_CODES.has(error.code)) return true;
  return /does not exist|schema cache|could not find the table/i.test(error.message ?? "");
}

// Keep department_hod_assignments in step with the profile's department. Older
// deployments do not have the table, so a missing relation is a no-op and never
// blocks the profile change the administrator asked for.
async function syncDepartmentHodAssignment(hodId, departmentId) {
  if (!departmentId) {
    const { error } = await supabase
      .from("department_hod_assignments")
      .delete()
      .eq("hod_id", hodId);
    return error && !isMissingRelation(error)
      ? `HOD scope could not be cleared: ${error.message}`
      : "";
  }

  // Only one HOD per department can be primary; a second HOD still gets read
  // access through a non-primary assignment.
  const { data: primary, error: primaryError } = await supabase
    .from("department_hod_assignments")
    .select("id")
    .eq("department_id", departmentId)
    .eq("is_primary", true)
    .neq("hod_id", hodId)
    .maybeSingle();
  if (primaryError) {
    return isMissingRelation(primaryError)
      ? ""
      : `HOD scope could not be read: ${primaryError.message}`;
  }

  const { error: assignError } = await supabase
    .from("department_hod_assignments")
    .upsert(
      { department_id: departmentId, hod_id: hodId, is_primary: !primary },
      { onConflict: "department_id,hod_id" },
    );
  if (assignError) {
    return isMissingRelation(assignError)
      ? ""
      : `HOD scope could not be updated: ${assignError.message}`;
  }

  const { error: clearError } = await supabase
    .from("department_hod_assignments")
    .delete()
    .eq("hod_id", hodId)
    .neq("department_id", departmentId);
  if (clearError && !isMissingRelation(clearError)) {
    return `HOD scope saved, but the previous department assignment could not be cleared: ${clearError.message}`;
  }
  return "";
}

const ManageUsers = () => {
  const [users, setUsers] = useState([]);
  const [classes, setClasses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [degrees, setDegrees] = useState([]);
  const [courses, setCourses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [statusBusyId, setStatusBusyId] = useState("");
  const editDialogRef = useRef(null);
  const deleteDialogRef = useRef(null);

  const selectedCourses = useMemo(
    () =>
      courses.filter(
        (course) =>
          course.department_id === form.department_id &&
          (!form.degree_id || !course.degree_id || course.degree_id === form.degree_id),
      ),
    [courses, form.department_id, form.degree_id],
  );
  const editCourses = useMemo(
    () =>
      courses.filter(
        (course) =>
          course.department_id === editForm?.department_id &&
          (!editForm?.degree_id || !course.degree_id || course.degree_id === editForm.degree_id),
      ),
    [courses, editForm?.department_id, editForm?.degree_id],
  );
  const editClasses = useMemo(
    () =>
      classes.filter(
        (item) =>
          (!editForm?.course_id || item.course_id === editForm.course_id) &&
          (!editForm?.degree_id || !item.degree_id || item.degree_id === editForm.degree_id),
      ),
    [classes, editForm?.course_id, editForm?.degree_id],
  );
  const selectedClasses = useMemo(
    () =>
      classes.filter(
        (item) =>
          (!form.course_id || item.course_id === form.course_id) &&
          (!form.degree_id || !item.degree_id || item.degree_id === form.degree_id),
      ),
    [classes, form.course_id, form.degree_id],
  );

  const load = async () => {
    setLoading(true);
    const [usersRes, classesRes, departmentsRes, degreesRes, coursesRes, subjectsRes] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("classes").select("id, name, course_id, degree_id").order("name"),
      supabase.from("departments").select("id, name").order("name"),
      supabase.from("degrees").select("id, name, code").order("name"),
      supabase.from("courses").select("id, name, department_id, degree_id").order("name"),
      supabase.from("subjects").select("id, name, code").order("name"),
    ]);

    // A deployment without the degree migration still works for every other
    // account field; the degree list simply stays empty.
    const failed = [usersRes, classesRes, departmentsRes, coursesRes, subjectsRes].find((result) => result.error);
    const degreesMissing = isMissingRelation(degreesRes.error);
    if (failed) {
      setLoadError(`Could not load account data: ${failed.error.message}. Apply the Gradia academic-structure migration and refresh.`);
    } else if (degreesRes.error && !degreesMissing) {
      setLoadError(`Could not load degrees: ${degreesRes.error.message}`);
    } else {
      setLoadError("");
    }
    setUsers(usersRes.data ?? []);
    setClasses(classesRes.data ?? []);
    setDepartments(departmentsRes.data ?? []);
    setDegrees(degreesMissing ? [] : degreesRes.data ?? []);
    setCourses(coursesRes.data ?? []);
    setSubjects(subjectsRes.data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (editUser && !editDialogRef.current?.open) editDialogRef.current?.showModal();
  }, [editUser]);

  useEffect(() => {
    if (deleteTarget && !deleteDialogRef.current?.open) deleteDialogRef.current?.showModal();
  }, [deleteTarget]);

  const update = (key) => (event) => {
    const value = event.target.value;
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "role") {
        next.department_id = "";
        next.degree_id = "";
        next.course_id = "";
        next.class_id = "";
        next.hod_type = "department";
        next.hod_subject_id = "";
      }
      if (key === "department_id") {
        next.course_id = "";
        next.class_id = "";
      }
      if (key === "degree_id") {
        next.course_id = "";
        next.class_id = "";
      }
      if (key === "course_id") {
        const course = courses.find((item) => item.id === value);
        if (course?.degree_id) next.degree_id = course.degree_id;
        next.class_id = "";
      }
      if (key === "hod_type") {
        next.department_id = "";
        next.degree_id = "";
        next.course_id = "";
      }
      return next;
    });
  };

  const createUser = async (event) => {
    event.preventDefault();
    setError("");

    const needsDegree = form.role === "student" || (form.role === "hod" && form.hod_type === "department");
    if (needsDegree && !form.department_id) {
      setError("Select the department this account belongs to.");
      return;
    }
    if (needsDegree && !form.degree_id) {
      setError("Select the degree this account belongs to.");
      return;
    }

    setBusy(true);
    const payload = {
      email: form.email.trim(),
      password: form.password,
      name: form.name.trim(),
      username: form.username.trim() || form.email.split("@")[0],
      phone: form.role === "student" || form.role === "teacher" ? form.phone.trim() : "",
      role: form.role,
      student_id: form.role === "student" ? form.student_id.trim() : "",
      registration_no: form.role === "student" ? form.registration_no.trim() : "",
      teacher_id: form.role === "teacher" ? form.teacher_id.trim() : "",
      department_id: needsDegree ? form.department_id : "",
      degree_id: needsDegree ? form.degree_id : "",
      course_id: needsDegree ? form.course_id : "",
      class_id: form.role === "student" ? form.class_id : "",
      hod_type: form.role === "hod" ? form.hod_type : "",
      hod_subject_id: form.role === "hod" && form.hod_type === "subject" ? form.hod_subject_id : "",
    };

    const { data, error: fnError } = await supabase.functions.invoke("create-user", { body: payload });
    if (fnError || data?.error) {
      setBusy(false);
      setError(data?.error || `Could not create the account. Check that the updated create-user Edge Function is deployed. (${fnError?.message || "Unknown error"})`);
      return;
    }

    // The deployed create-user function ignores course_id for HODs, so persist
    // the HOD course with the admin session as a follow-up. Once the updated
    // function is deployed this becomes a harmless idempotent write.
    let courseWarning = "";
    if (payload.degree_id && data?.id) {
      // The updated Edge Function stores the degree itself. This follow-up keeps
      // the account correct if an older function is still deployed.
      const { error: degreeError } = await supabase
        .from("profiles")
        .update({ degree_id: payload.degree_id })
        .eq("id", data.id);
      if (degreeError) {
        courseWarning = `Account created, but the degree was not saved: ${degreeError.message}. Use Edit to assign it.`;
      }
    }
    if (payload.role === "hod" && payload.hod_type === "department" && payload.course_id && data?.id) {
      const { error: courseError } = await supabase
        .from("profiles")
        .update({ course_id: payload.course_id })
        .eq("id", data.id);
      if (courseError) {
        courseWarning = `Account created, but the course was not saved: ${courseError.message}. Use Edit to assign it.`;
      }
    }

    // New HODs only get an assignment row through this admin write; the schema
    // does not sync profiles.department_id into the scope table with a trigger.
    if (payload.role === "hod" && payload.hod_type === "department" && data?.id) {
      const scopeWarning = await syncDepartmentHodAssignment(data.id, payload.department_id);
      if (scopeWarning) {
        courseWarning = courseWarning ? `${courseWarning} ${scopeWarning}` : scopeWarning;
      }
    }

    setBusy(false);
    setForm(EMPTY_FORM);
    setShowPassword(false);
    if (courseWarning) setError(courseWarning);
    await load();
  };

  const startEdit = (user) => {
    setEditUser(user);
    setEditForm({
      id: user.id,
      name: user.name ?? "",
      username: user.username ?? "",
      email: user.email ?? "",
      phone: user.phone ?? "",
      password: "",
      role: user.role ?? "student",
      student_id: user.student_id ?? "",
      registration_no: user.registration_no ?? "",
      teacher_id: user.teacher_id ?? "",
      department_id: user.department_id ?? "",
      degree_id: user.degree_id ?? "",
      course_id: user.course_id ?? "",
      class_id: user.class_id ?? "",
      hod_type: user.hod_type ?? "department",
      hod_subject_id: user.hod_subject_id ?? "",
    });
    setEditError("");
    setShowEditPassword(false);
    setNotice("");
  };

  const closeEdit = () => {
    if (editBusy) return;
    editDialogRef.current?.close();
  };

  const handleEditDialogClose = () => {
    setEditUser(null);
    setEditForm(null);
    setEditBusy(false);
    setEditError("");
    setShowEditPassword(false);
  };

  const updateEdit = (key) => (event) => {
    const value = event.target.value;
    setEditForm((current) => {
      if (!current) return current;
      const next = { ...current, [key]: value };
      if (key === "role") {
        next.department_id = "";
        next.degree_id = "";
        next.course_id = "";
        next.class_id = "";
        next.hod_type = "department";
        next.hod_subject_id = "";
      }
      if (key === "department_id") {
        next.course_id = "";
        next.class_id = "";
      }
      if (key === "degree_id") {
        next.course_id = "";
        next.class_id = "";
      }
      if (key === "course_id") {
        const course = courses.find((item) => item.id === value);
        if (course?.degree_id) next.degree_id = course.degree_id;
        next.class_id = "";
      }
      if (key === "hod_type") {
        next.department_id = "";
        next.degree_id = "";
        next.course_id = "";
        next.hod_subject_id = "";
      }
      return next;
    });
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    if (!editForm) return;
    const needsDegree =
      editForm.role === "student" || (editForm.role === "hod" && editForm.hod_type === "department");
    if (!editForm.name.trim() || !editForm.email.trim()) {
      setEditError("Full name and email are required.");
      return;
    }
    if (needsDegree && !editForm.department_id) {
      setEditError("Select the department this account belongs to.");
      return;
    }
    if (needsDegree && !editForm.degree_id) {
      setEditError("Select the degree this account belongs to.");
      return;
    }
    if (editForm.role === "student" && (!editForm.student_id.trim() || !editForm.course_id || !editForm.class_id)) {
      setEditError("Students require Student ID, Course and Class.");
      return;
    }
    if (editForm.role === "teacher" && !editForm.teacher_id.trim()) {
      setEditError("Teacher ID is required.");
      return;
    }
    if (editForm.role === "hod" && editForm.hod_type === "subject" && !editForm.hod_subject_id) {
      setEditError("Select a subject for this HOD.");
      return;
    }

    setEditBusy(true);
    setEditError("");
    const payload = {
      user_id: editForm.id,
      email: editForm.email.trim(),
      password: editForm.password,
      name: editForm.name.trim(),
      username: editForm.username.trim() || editForm.email.split("@")[0],
      phone: editForm.phone.trim(),
      role: editForm.role,
      student_id: editForm.role === "student" ? editForm.student_id.trim() : "",
      registration_no: editForm.role === "student" ? editForm.registration_no.trim() : "",
      teacher_id: editForm.role === "teacher" ? editForm.teacher_id.trim() : "",
      department_id: needsDegree ? editForm.department_id : "",
      degree_id: needsDegree ? editForm.degree_id : "",
      course_id: needsDegree ? editForm.course_id : "",
      class_id: editForm.role === "student" ? editForm.class_id : "",
      hod_type: editForm.role === "hod" ? editForm.hod_type : "",
      hod_subject_id: editForm.role === "hod" && editForm.hod_type === "subject" ? editForm.hod_subject_id : "",
    };

    const { data, error: fnError } = await supabase.functions.invoke("update-user", { body: payload });
    if (fnError || data?.error) {
      setEditBusy(false);
      setEditError(data?.error || `Could not update the account. Check that the update-user Edge Function is deployed. (${fnError?.message || "Unknown error"})`);
      return;
    }

    setEditBusy(false);
    editDialogRef.current?.close();
    setNotice("Account updated.");
    await load();
  };

  const startDelete = (user) => {
    setDeleteTarget(user);
    setDeleteConfirm("");
    setDeleteError("");
    setNotice("");
  };

  const closeDelete = () => {
    if (deleteBusy) return;
    deleteDialogRef.current?.close();
  };

  const handleDeleteDialogClose = () => {
    setDeleteTarget(null);
    setDeleteConfirm("");
    setDeleteBusy(false);
    setDeleteError("");
  };

  const confirmDelete = async (event) => {
    event.preventDefault();
    if (!deleteTarget) return;
    if (deleteConfirm.trim().toLowerCase() !== String(deleteTarget.email ?? "").toLowerCase()) {
      setDeleteError("Type the account email exactly to confirm deletion.");
      return;
    }

    setDeleteBusy(true);
    setDeleteError("");
    const { data, error: fnError } = await supabase.functions.invoke("delete-user", {
      body: { user_id: deleteTarget.id, confirm_email: deleteConfirm.trim() },
    });
    if (fnError || data?.error) {
      setDeleteBusy(false);
      setDeleteError(data?.error || `Could not delete the account. Check that the delete-user Edge Function is deployed. (${fnError?.message || "Unknown error"})`);
      return;
    }

    setDeleteBusy(false);
    deleteDialogRef.current?.close();
    setNotice("Account deleted.");
    await load();
  };

  const toggleActive = async (user) => {
    setStatusBusyId(user.id);
    setLoadError("");
    const { data, error: fnError } = await supabase.functions.invoke("set-user-active", {
      body: { user_id: user.id, active: !user.is_active },
    });
    if (fnError || data?.error) {
      setLoadError(data?.error || `Could not change account status. Check that the set-user-active Edge Function is deployed. (${fnError?.message || "Unknown error"})`);
    } else {
      setNotice(user.is_active ? "Account deactivated." : "Account activated.");
      await load();
    }
    setStatusBusyId("");
  };

  const departmentName = (id) => departments.find((item) => item.id === id)?.name || "";
  const degreeName = (id) => degrees.find((item) => item.id === id)?.name || "";
  const courseName = (id) => courses.find((item) => item.id === id)?.name || "";
  const subjectName = (id) => subjects.find((item) => item.id === id)?.name || "";

  return (
    <>
      <DashboardHeader title="Users" subtitle="Create accounts and manage access." />

      <Card className="mt-6">
        <form onSubmit={createUser} className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <input className={inputClass} value={form.name} onChange={update("name")} autoComplete="name" required />
          </Field>
          <Field label="Username">
            <input className={inputClass} value={form.username} onChange={update("username")} placeholder="Auto from email" />
          </Field>
          <Field label="Email">
            <input type="email" className={inputClass} value={form.email} onChange={update("email")} autoComplete="email" required />
          </Field>
          <div>
            <label htmlFor="new-user-password" className="text-xs font-medium text-(--muted)">Password</label>
            <div className="relative mt-1.5">
              <input
                id="new-user-password"
                type={showPassword ? "text" : "password"}
                className={`${inputClass} pr-11`}
                value={form.password}
                onChange={update("password")}
                autoComplete="new-password"
                required
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                title={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-(--muted-foreground) transition-colors hover:text-(--foreground)"
              >
                {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            </div>
          </div>
          <Field label="Role">
            <Select value={form.role} onChange={update("role")}>
              {ROLES.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
            </Select>
          </Field>

          {(form.role === "student" || form.role === "teacher") && (
            <Field label="Phone number">
              <input
                type="tel"
                name="phone"
                className={inputClass}
                value={form.phone}
                onChange={update("phone")}
                autoComplete="tel"
                placeholder="e.g. +91 98765 43210"
              />
            </Field>
          )}

          {form.role === "student" && <>
            <Field label="Student ID">
              <input className={inputClass} value={form.student_id} onChange={update("student_id")} placeholder="e.g. GRD2026001" required />
            </Field>
            <Field label="Registration number">
              <input
                className={inputClass}
                value={form.registration_no}
                onChange={update("registration_no")}
                placeholder="e.g. 2026CS1001"
              />
            </Field>
            <Field label="Department">
              <Select value={form.department_id} onChange={update("department_id")} required>
                <option value="">Select department</option>
                {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            </Field>
            <Field label="Degree">
              <Select value={form.degree_id} onChange={update("degree_id")} required disabled={degrees.length === 0}>
                <option value="">{degrees.length === 0 ? "No degrees yet" : "Select degree"}</option>
                {degrees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            </Field>
            <Field label="Course">
              <Select value={form.course_id} onChange={update("course_id")} required disabled={!form.degree_id}>
                <option value="">{form.degree_id ? "Select course" : "Select a degree first"}</option>
                {selectedCourses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            </Field>
            <Field label="Class / Semester / Section">
              <Select value={form.class_id} onChange={update("class_id")} required disabled={!form.course_id}>
                <option value="">Select class</option>
                {selectedClasses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            </Field>
          </>}

          {form.role === "teacher" && <Field label="Teacher ID">
            <input className={inputClass} value={form.teacher_id} onChange={update("teacher_id")} placeholder="e.g. TCH2026001" required />
          </Field>}

          {form.role === "hod" && <>
            <Field label="HOD category">
              <Select value={form.hod_type} onChange={update("hod_type")}>
                <option value="department">Department HOD</option>
                <option value="subject">Subject HOD</option>
              </Select>
            </Field>
            {form.hod_type === "department" ? (
              <>
                <Field label="Department">
                  <Select value={form.department_id} onChange={update("department_id")} required>
                    <option value="">Select department</option>
                    {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </Select>
                </Field>
                <Field label="Degree">
                  <Select value={form.degree_id} onChange={update("degree_id")} required disabled={degrees.length === 0}>
                    <option value="">{degrees.length === 0 ? "No degrees yet" : "Select degree"}</option>
                    {degrees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </Select>
                </Field>
                <Field label="Course">
                  <Select
                    value={form.course_id}
                    onChange={update("course_id")}
                    disabled={!form.degree_id}
                  >
                    <option value="">{form.degree_id ? "Select course" : "Select a degree first"}</option>
                    {selectedCourses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </Select>
                  {form.degree_id && selectedCourses.length === 0 ? (
                    <span className="mt-1 block text-xs text-(--muted-foreground)">No courses are configured for this degree yet.</span>
                  ) : null}
                </Field>
              </>
            ) : (
              <Field label="Subject">
                <Select value={form.hod_subject_id} onChange={update("hod_subject_id")} required>
                  <option value="">Select subject</option>
                  {subjects.map((item) => <option key={item.id} value={item.id}>{item.code} – {item.name}</option>)}
                </Select>
              </Field>
            )}
          </>}

          {error ? <p className="sm:col-span-2 whitespace-pre-line text-xs text-(--danger)">{error}</p> : null}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy || loading}>
              {busy ? "Creating…" : "Create account"}
            </Button>
          </div>
        </form>
        {(form.role === "student" || form.role === "hod") && !loading && (departments.length === 0 || degrees.length === 0) && (
          <p className="mt-3 text-xs text-(--muted-foreground)">No departments, degrees or courses are configured yet. Create these academic records before registering students or HODs.</p>
        )}
      </Card>

      <dialog
        ref={editDialogRef}
        className="dialog-panel"
        aria-labelledby="edit-user-title"
        onClose={handleEditDialogClose}
      >
        {editForm ? (
          <form onSubmit={saveEdit} className="grid gap-4 sm:grid-cols-2" aria-labelledby="edit-user-title">
            <div className="flex items-start justify-between gap-3 sm:col-span-2">
              <div>
                <h1 id="edit-user-title" className="text-base font-semibold text-(--foreground)">Edit user</h1>
                <p className="mt-0.5 text-xs text-(--muted-foreground)">{editUser?.email}</p>
              </div>
              <Button type="button" variant="subtle" onClick={closeEdit} disabled={editBusy}>Close</Button>
            </div>
            <Field label="Full name">
              <input className={inputClass} value={editForm.name} onChange={updateEdit("name")} autoComplete="name" required />
            </Field>
            <Field label="Username">
              <input className={inputClass} value={editForm.username} onChange={updateEdit("username")} autoComplete="username" />
            </Field>
            <Field label="Email">
              <input type="email" className={inputClass} value={editForm.email} onChange={updateEdit("email")} autoComplete="email" required />
            </Field>
            {(editForm.role === "student" || editForm.role === "teacher") && (
              <Field label="Phone number">
                <input
                  type="tel"
                  name="phone"
                  className={inputClass}
                  value={editForm.phone}
                  onChange={updateEdit("phone")}
                  autoComplete="tel"
                  placeholder="e.g. +91 98765 43210"
                />
              </Field>
            )}
            <div>
              <label htmlFor="edit-user-password" className="text-xs font-medium text-(--muted)">New password</label>
              <div className="relative mt-1.5">
                <input
                  id="edit-user-password"
                  type={showEditPassword ? "text" : "password"}
                  className={`${inputClass} pr-11`}
                  value={editForm.password}
                  onChange={updateEdit("password")}
                  autoComplete="new-password"
                  minLength={6}
                  placeholder="Leave blank to keep current password"
                />
                <button
                  type="button"
                  onClick={() => setShowEditPassword((value) => !value)}
                  aria-label={showEditPassword ? "Hide new password" : "Show new password"}
                  aria-pressed={showEditPassword}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-(--muted-foreground) transition-colors hover:text-(--foreground)"
                >
                  {showEditPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                </button>
              </div>
            </div>
            <Field label="Role">
              <Select value={editForm.role} onChange={updateEdit("role")} required>
                {ROLES.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
              </Select>
            </Field>

            {editForm.role === "student" && <>
              <Field label="Student ID">
                <input className={inputClass} value={editForm.student_id} onChange={updateEdit("student_id")} required />
              </Field>
              <Field label="Registration number">
                <input className={inputClass} value={editForm.registration_no} onChange={updateEdit("registration_no")} />
              </Field>
              <Field label="Department">
                <Select value={editForm.department_id} onChange={updateEdit("department_id")} required>
                  <option value="">Select department</option>
                  {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>
              </Field>
              <Field label="Degree">
                <Select value={editForm.degree_id} onChange={updateEdit("degree_id")} required disabled={degrees.length === 0}>
                  <option value="">{degrees.length === 0 ? "No degrees yet" : "Select degree"}</option>
                  {degrees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>
              </Field>
              <Field label="Course">
                <Select value={editForm.course_id} onChange={updateEdit("course_id")} required disabled={!editForm.degree_id}>
                  <option value="">{editForm.degree_id ? "Select course" : "Select a degree first"}</option>
                  {editCourses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>
              </Field>
              <Field label="Class / Semester / Section">
                <Select value={editForm.class_id} onChange={updateEdit("class_id")} required disabled={!editForm.course_id}>
                  <option value="">Select class</option>
                  {editClasses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>
              </Field>
            </>}

            {editForm.role === "teacher" && <Field label="Teacher ID">
              <input className={inputClass} value={editForm.teacher_id} onChange={updateEdit("teacher_id")} required />
            </Field>}

            {editForm.role === "hod" && <>
              <Field label="HOD category">
                <Select value={editForm.hod_type} onChange={updateEdit("hod_type")}>
                  <option value="department">Department HOD</option>
                  <option value="subject">Subject HOD</option>
                </Select>
              </Field>
              {editForm.hod_type === "department" ? (
                <>
                  <Field label="Department">
                    <Select value={editForm.department_id} onChange={updateEdit("department_id")} required>
                      <option value="">Select department</option>
                      {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Degree">
                    <Select value={editForm.degree_id} onChange={updateEdit("degree_id")} required disabled={degrees.length === 0}>
                      <option value="">{degrees.length === 0 ? "No degrees yet" : "Select degree"}</option>
                      {degrees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Course">
                    <Select value={editForm.course_id} onChange={updateEdit("course_id")} disabled={!editForm.degree_id}>
                      <option value="">{editForm.degree_id ? "Select course" : "Select a degree first"}</option>
                      {editCourses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </Select>
                  </Field>
                </>
              ) : (
                <Field label="Subject">
                  <Select value={editForm.hod_subject_id} onChange={updateEdit("hod_subject_id")} required>
                    <option value="">Select subject</option>
                    {subjects.map((item) => <option key={item.id} value={item.id}>{item.code} – {item.name}</option>)}
                  </Select>
                </Field>
              )}
            </>}

            {editError ? <p role="alert" className="sm:col-span-2 text-xs text-(--danger)">{editError}</p> : null}
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" disabled={editBusy}>{editBusy ? "Saving…" : "Save changes"}</Button>
              <Button type="button" variant="subtle" autoFocus onClick={closeEdit} disabled={editBusy}>Cancel</Button>
            </div>
          </form>
        ) : null}
      </dialog>

      <dialog
        ref={deleteDialogRef}
        className="dialog-panel"
        aria-labelledby="delete-user-title"
        aria-describedby="delete-user-hint delete-user-error"
        onClose={handleDeleteDialogClose}
      >
        {deleteTarget ? (
          <form onSubmit={confirmDelete}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 id="delete-user-title" className="text-base font-semibold text-(--foreground)">Delete user</h1>
                <p className="mt-0.5 text-xs text-(--muted-foreground)">{deleteTarget.name}</p>
              </div>
              <Button type="button" variant="subtle" onClick={closeDelete} disabled={deleteBusy}>Close</Button>
            </div>
            <p className="mt-4 text-sm text-(--muted-foreground)">
              This permanently removes the account and its academic records. This action cannot be undone.
            </p>
            <Field label="Confirm account email">
              <input
                id="delete-user-confirm"
                className={inputClass}
                value={deleteConfirm}
                onChange={(event) => setDeleteConfirm(event.target.value)}
                placeholder={deleteTarget.email}
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                required
              />
            </Field>
            <p id="delete-user-hint" className="mt-2 text-xs text-(--muted-foreground)">
              Type {deleteTarget.email} to confirm.
            </p>
            <p id="delete-user-error" aria-live="polite" className="mt-2 text-xs text-(--danger)">
              {deleteError}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button type="submit" variant="danger" disabled={deleteBusy}>
                {deleteBusy ? "Deleting…" : "Delete account"}
              </Button>
              <Button type="button" variant="subtle" autoFocus onClick={closeDelete} disabled={deleteBusy}>Cancel</Button>
            </div>
          </form>
        ) : null}
      </dialog>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-medium text-(--muted-foreground)">All accounts</p>
          <ImportButton moduleId="users" label="Import users" onComplete={load} />
        </div>
        <div className="mt-3 space-y-2">
          {loadError ? <p className="text-xs text-(--danger)">{loadError}</p> : null}
          {notice ? <p className="text-xs text-(--muted-foreground)">{notice}</p> : null}
          {loading ? Array.from({ length: 3 }).map((_, i) => <div key={i} className="glass-inner h-12 animate-pulse rounded-lg" />) : null}
          {!loading && users.length === 0 && <Empty>No accounts yet. Create the first one with the form above.</Empty>}
          {!loading && users.map((user) => (
            <div key={user.id} className="glass-inner flex items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate text-(--foreground)">{user.name}, <span className="text-(--muted-foreground)">{user.email}</span></p>
                <p className="text-xs text-(--muted-foreground)">
                  {ROLE_LABEL[user.role] ?? user.role}
                  {user.student_id ? ` · Student ID: ${user.student_id}` : ""}
                  {user.teacher_id ? ` · Teacher ID: ${user.teacher_id}` : ""}
                  {user.role === "student" && user.department ? ` · ${user.department}` : ""}
                  {user.role === "student" && user.degree_id && degreeName(user.degree_id) ? ` · ${degreeName(user.degree_id)}` : ""}
                  {user.role === "student" && user.course_id && courseName(user.course_id) ? ` · ${courseName(user.course_id)}` : ""}
                  {user.role === "hod" && user.hod_type !== "subject" && user.department_id && departmentName(user.department_id) ? ` · Department: ${departmentName(user.department_id)}` : ""}
                  {user.role === "hod" && user.hod_type !== "subject" && user.degree_id && degreeName(user.degree_id) ? ` · Degree: ${degreeName(user.degree_id)}` : ""}
                  {user.role === "hod" && user.hod_type !== "subject" && user.course_id && courseName(user.course_id) ? ` · Course: ${courseName(user.course_id)}` : ""}
                  {user.hod_type === "subject" && user.hod_subject_id ? ` · ${subjectName(user.hod_subject_id)} HOD` : ""}
                  {!user.is_active ? " · Inactive" : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <Button variant="subtle" onClick={() => startEdit(user)}>Edit</Button>
                {user.role !== "admin" && (
                  <Button
                    variant={user.is_active ? "danger" : "success"}
                    onClick={() => toggleActive(user)}
                    disabled={statusBusyId === user.id}
                  >
                    {statusBusyId === user.id ? "Updating…" : user.is_active ? "Deactivate" : "Activate"}
                  </Button>
                )}
                <Button variant="danger" onClick={() => startDelete(user)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
};

export default ManageUsers;
