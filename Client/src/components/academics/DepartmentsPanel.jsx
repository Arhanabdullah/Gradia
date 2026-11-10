import { useState } from "react";
import { Button, Card, Empty, Field, inputClass } from "../ui";
import ImportButton from "../import/ImportButton";

const emptyDepartment = { name: "", code: "" };

export default function DepartmentsPanel({
  departments,
  courses,
  loading,
  saving,
  onSave,
  onDelete,
  onReload,
}) {
  const [form, setForm] = useState(emptyDepartment);
  const [editingId, setEditingId] = useState("");
  const [formError, setFormError] = useState("");

  const courseCount = (id) => courses.filter((course) => course.department_id === id).length;

  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setFormError("A department name is required.");
      return;
    }
    setFormError("");
    const saved = await onSave(form, editingId);
    if (saved) {
      setForm(emptyDepartment);
      setEditingId("");
    }
  };

  const startEdit = (department) => {
    setEditingId(department.id);
    setForm({ name: department.name ?? "", code: department.code ?? "" });
    setFormError("");
  };

  const cancelEdit = () => {
    setEditingId("");
    setForm(emptyDepartment);
    setFormError("");
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-(--foreground)">
            {editingId ? "Edit department" : "Create department"}
          </h2>
          <p className="mt-1 text-xs text-(--muted-foreground)">
            Departments sit at the top of the academic structure. Every course belongs to one department.
          </p>
        </div>
        <ImportButton moduleId="departments" onComplete={onReload} />
      </div>

      <Card>
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Field label="Department name">
            <input
              className={inputClass}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="e.g. Computer Science"
              required
            />
          </Field>
          <Field label="Short code (optional)">
            <input
              className={inputClass}
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
              placeholder="e.g. CSE"
            />
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : editingId ? "Save changes" : "Create department"}
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
            <div key={index} className="glass-inner h-14 animate-pulse rounded-lg" />
          ))
        ) : departments.length === 0 ? (
          <Empty>No departments yet. Create the first one with the form above.</Empty>
        ) : (
          departments.map((department) => {
            const used = courseCount(department.id);
            return (
              <div
                key={department.id}
                className="glass-inner flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="text-(--foreground)">
                    {department.name}
                    {department.code ? (
                      <span className="ml-2 text-xs text-(--muted-foreground)">{department.code}</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-(--muted-foreground)">
                    {used === 0 ? "No courses yet" : `${used} course${used === 1 ? "" : "s"}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="subtle" onClick={() => startEdit(department)}>
                    Edit
                  </Button>
                  <Button type="button" variant="danger" onClick={() => onDelete(department)}>
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
