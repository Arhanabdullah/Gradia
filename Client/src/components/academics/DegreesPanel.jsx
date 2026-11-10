import { useState } from "react";
import { Button, Card, Empty, Field, inputClass } from "../ui";
import ImportButton from "../import/ImportButton";

const emptyDegree = { name: "", code: "" };

export default function DegreesPanel({
  degrees,
  courses,
  classes,
  loading,
  saving,
  onSave,
  onDelete,
  onReload,
}) {
  const [form, setForm] = useState(emptyDegree);
  const [editingId, setEditingId] = useState("");
  const [formError, setFormError] = useState("");

  const courseCount = (id) => courses.filter((course) => course.degree_id === id).length;
  const classCount = (id) => classes.filter((item) => item.degree_id === id).length;

  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setFormError("A degree name is required.");
      return;
    }
    setFormError("");
    const saved = await onSave(form, editingId);
    if (saved) {
      setForm(emptyDegree);
      setEditingId("");
    }
  };

  const startEdit = (degree) => {
    setEditingId(degree.id);
    setForm({
      name: degree.name ?? "",
      code: degree.code ?? "",
    });
    setFormError("");
  };

  const cancelEdit = () => {
    setEditingId("");
    setForm(emptyDegree);
    setFormError("");
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-(--foreground)">
            {editingId ? "Edit degree" : "Create degree"}
          </h2>
          <p className="mt-1 text-xs text-(--muted-foreground)">
            Degrees are shared across the school. Courses, classes, students and department HODs are then linked to a degree.
          </p>
        </div>
        <ImportButton moduleId="degrees" onComplete={onReload} />
      </div>

      <Card>
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Degree name">
            <input
              className={inputClass}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="e.g. BSc"
              required
            />
          </Field>
          <Field label="Degree code (optional)">
            <input
              className={inputClass}
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
              placeholder="e.g. BSC"
            />
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : editingId ? "Save changes" : "Create degree"}
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
        ) : degrees.length === 0 ? (
          <Empty>No degrees yet. Create the first one with the form above.</Empty>
        ) : (
          degrees.map((degree) => {
            const courseTotal = courseCount(degree.id);
            const classTotal = classCount(degree.id);
            return (
              <div
                key={degree.id}
                className="glass-inner flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="text-(--foreground)">
                    {degree.name}
                    {degree.code ? (
                      <span className="ml-2 text-xs text-(--muted-foreground)">{degree.code}</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-(--muted-foreground)">
                    {courseTotal === 0 ? "No courses yet" : `${courseTotal} course${courseTotal === 1 ? "" : "s"}`}
                    {classTotal === 0 ? "" : `, ${classTotal} class${classTotal === 1 ? "" : "es"}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="subtle" onClick={() => startEdit(degree)}>
                    Edit
                  </Button>
                  <Button type="button" variant="danger" onClick={() => onDelete(degree)}>
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
