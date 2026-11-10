import { useState } from "react";
import { Button, Card, Empty, Field, Select, inputClass } from "../ui";
import ImportButton from "../import/ImportButton";

const emptyCourse = { name: "", code: "", department_id: "", degree_id: "", duration_years: "" };

export default function CoursesPanel({
  courses,
  departments,
  degrees,
  classes,
  loading,
  saving,
  onSave,
  onDelete,
  onReload,
}) {
  const [form, setForm] = useState(emptyCourse);
  const [editingId, setEditingId] = useState("");
  const [formError, setFormError] = useState("");

  const departmentName = (id) => departments.find((item) => item.id === id)?.name ?? "Unknown department";
  const degreeName = (id) => degrees.find((item) => item.id === id)?.name ?? "Degree not set";
  const classCount = (id) => classes.filter((item) => item.course_id === id).length;

  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setFormError("A course name is required.");
      return;
    }
    if (!form.department_id) {
      setFormError("Select the department this course belongs to.");
      return;
    }
    if (!form.degree_id) {
      setFormError("Select the degree this course belongs to.");
      return;
    }
    if (form.duration_years !== "" && Number(form.duration_years) <= 0) {
      setFormError("Duration must be a positive number of years.");
      return;
    }
    setFormError("");
    const saved = await onSave(form, editingId);
    if (saved) {
      setForm(emptyCourse);
      setEditingId("");
    }
  };

  const startEdit = (course) => {
    setEditingId(course.id);
    setForm({
      name: course.name ?? "",
      code: course.code ?? "",
      department_id: course.department_id ?? "",
      degree_id: course.degree_id ?? "",
      duration_years: course.duration_years == null ? "" : String(course.duration_years),
    });
    setFormError("");
  };

  const cancelEdit = () => {
    setEditingId("");
    setForm(emptyCourse);
    setFormError("");
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-(--foreground)">
            {editingId ? "Edit course" : "Create course"}
          </h2>
          <p className="mt-1 text-xs text-(--muted-foreground)">
            Courses belong to a department and a degree, and classes are created against a course. Degrees are shared across departments.
          </p>
        </div>
        <ImportButton moduleId="courses" onComplete={onReload} />
      </div>

      <Card>
        {departments.length === 0 ? (
          <p className="mb-3 text-xs text-(--danger)">
            Create a department first. Every course must belong to a department.
          </p>
        ) : null}
        {degrees.length === 0 ? (
          <p className="mb-3 text-xs text-(--danger)">
            Create a degree first. Every course must belong to a department and a degree.
          </p>
        ) : null}
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Course name">
            <input
              className={inputClass}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="e.g. BSc Computer Science"
              required
            />
          </Field>
          <Field label="Course code (optional)">
            <input
              className={inputClass}
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
              placeholder="e.g. BSC-CS"
            />
          </Field>
          <Field label="Department">
            <Select
              value={form.department_id}
              onChange={(event) => setForm({ ...form, department_id: event.target.value })}
              required
            >
              <option value="">Select department</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                  {department.code ? ` (${department.code})` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Degree">
            <Select
              value={form.degree_id}
              onChange={(event) => setForm({ ...form, degree_id: event.target.value })}
              required
              disabled={degrees.length === 0}
            >
              <option value="">
                {degrees.length === 0 ? "No degrees yet" : "Select degree"}
              </option>
              {degrees.map((degree) => (
                <option key={degree.id} value={degree.id}>
                  {degree.name}
                  {degree.code ? ` (${degree.code})` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Duration in years (optional)">
            <input
              type="number"
              min="1"
              className={inputClass}
              value={form.duration_years}
              onChange={(event) => setForm({ ...form, duration_years: event.target.value })}
              placeholder="e.g. 4"
            />
          </Field>
          <div className="flex items-end gap-2 md:col-span-2 lg:col-span-4">
            <Button type="submit" disabled={saving || departments.length === 0}>
              {saving ? "Saving..." : editingId ? "Save changes" : "Create course"}
            </Button>
            {editingId ? (
              <Button type="button" variant="subtle" onClick={cancelEdit} disabled={saving}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
        {formError ? <p className="mt-3 text-xs text-(--danger)">{formError}</p> : null}
      </Card>

      <div className="mt-5 space-y-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="glass-inner h-16 animate-pulse rounded-lg" />
          ))
        ) : courses.length === 0 ? (
          <Empty>No courses yet. Create the first one with the form above.</Empty>
        ) : (
          courses.map((course) => {
            const used = classCount(course.id);
            return (
              <div
                key={course.id}
                className="glass-inner flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="text-(--foreground)">
                    {course.name}
                    {course.code ? (
                      <span className="ml-2 text-xs text-(--muted-foreground)">{course.code}</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-(--muted-foreground)">
                    {departmentName(course.department_id)}
                    {`, ${degreeName(course.degree_id)}`}
                    {course.duration_years ? `, ${course.duration_years} year${course.duration_years === 1 ? "" : "s"}` : ""}
                    {used === 0 ? ", no classes yet" : `, ${used} class${used === 1 ? "" : "es"}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="subtle" onClick={() => startEdit(course)}>
                    Edit
                  </Button>
                  <Button type="button" variant="danger" onClick={() => onDelete(course)}>
                    Delete
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
