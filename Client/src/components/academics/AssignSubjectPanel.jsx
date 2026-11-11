import { useMemo } from "react";
import { Button, Card, Empty, Field, SearchField, Select } from "../ui";
import ImportButton from "../import/ImportButton";

function teacherLabel(teacher) {
  if (!teacher) return "";
  const id = teacher.teacher_id || teacher.username;
  return id ? `${teacher.name} (${id})` : teacher.name;
}

function teacherNamesFor(row) {
  return (row.teachers ?? []).map((teacher) => teacherLabel(teacher.profiles)).filter(Boolean);
}

export default function AssignSubjectPanel({
  classes,
  subjects,
  teachers,
  assignedRows,
  selectedClassId,
  selectedSubjectIds,
  teachersBySubject,
  teacherDrafts,
  editingTeacherRowId,
  catalogueQuery,
  assignedQuery,
  teacherQuery,
  onCatalogueQueryChange,
  onAssignedQueryChange,
  onTeacherQueryChange,
  onSelectClass,
  onToggleSubject,
  onToggleTeacherForSubject,
  onEditTeachers,
  onCancelEditTeachers,
  onToggleDraftTeacher,
  onAssignSubjects,
  onSaveTeachers,
  onRemoveAssignment,
  onImportComplete,
  saving,
}) {
  const filteredCatalogueSubjects = useMemo(() => {
    const needle = catalogueQuery.trim().toLowerCase();
    if (!needle) return subjects;
    return subjects.filter((subject) =>
      [subject.code, subject.name, subject.max_marks]
        .filter((value) => value !== null && value !== undefined && value !== "")
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [subjects, catalogueQuery]);

  const filteredAssignedRows = useMemo(() => {
    const needle = assignedQuery.trim().toLowerCase();
    if (!needle) return assignedRows;
    return assignedRows.filter((row) =>
      [row.subjects?.code, row.subjects?.name, ...teacherNamesFor(row)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [assignedRows, assignedQuery]);

  const filteredTeachers = useMemo(() => {
    const needle = teacherQuery.trim().toLowerCase();
    if (!needle) return teachers;
    return teachers.filter((teacher) =>
      [teacher.name, teacher.teacher_id, teacher.username, teacherLabel(teacher)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [teachers, teacherQuery]);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-(--foreground)">Assign subjects to a class</h2>
          <p className="mt-1 text-xs text-(--muted-foreground)">
            Choose a class, select catalogue subjects, and assign at least one teacher to each subject. More than one teacher can share a subject.
          </p>
        </div>
        <ImportButton moduleId="class_subjects" label="Import class subjects" onComplete={onImportComplete} />
      </div>

      <Card>
        <form onSubmit={onAssignSubjects} className="space-y-4">
          <Field label="Select class">
            <Select value={selectedClassId} onChange={(event) => onSelectClass(event.target.value)} required>
              <option value="">Choose a class</option>
              {classes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}, {item.department} {item.section ? `(${item.section})` : ""}
                </option>
              ))}
            </Select>
          </Field>

          {selectedClassId ? (
            <>
              <div>
                <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
                  <p className="pb-2.5 text-xs font-semibold text-(--foreground)">Choose subjects from the catalogue</p>
                  <SearchField
                    value={catalogueQuery}
                    onChange={onCatalogueQueryChange}
                    label="Search catalogue subjects"
                    placeholder="Name or code"
                    className="w-full sm:max-w-xs"
                  />
                </div>
                {subjects.length === 0 ? (
                  <Empty>Create subjects in the Subjects tab first.</Empty>
                ) : filteredCatalogueSubjects.length === 0 ? (
                  <Empty>No subjects match "{catalogueQuery.trim()}".</Empty>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    {filteredCatalogueSubjects.map((subject) => {
                      const alreadyAssigned = assignedRows.some((row) => row.subject_id === subject.id);
                      return (
                        <label
                          key={subject.id}
                          className={`flex cursor-pointer items-start gap-3 rounded-lg border border-(--border) p-3 ${alreadyAssigned ? "opacity-50" : ""}`}
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={selectedSubjectIds.includes(subject.id)}
                            disabled={alreadyAssigned}
                            onChange={() => onToggleSubject(subject.id)}
                          />
                          <span className="min-w-0 flex-1 text-sm text-(--foreground)">
                            <strong>{subject.code}</strong>, {subject.name}
                            <span className="block text-xs text-(--muted-foreground)">
                              {alreadyAssigned ? "Already assigned" : `Maximum marks: ${subject.max_marks}`}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {selectedSubjectIds.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <p className="pb-2.5 text-xs font-semibold text-(--foreground)">Assign at least one teacher to every selected subject</p>
                    {teachers.length > 0 ? (
                      <SearchField
                        value={teacherQuery}
                        onChange={onTeacherQueryChange}
                        label="Search teachers"
                        placeholder="Name or staff ID"
                        className="w-full sm:max-w-xs"
                      />
                    ) : null}
                  </div>
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
                          ) : filteredTeachers.length === 0 ? (
                            <p className="text-xs text-(--muted-foreground)">No teachers match "{teacherQuery.trim()}".</p>
                          ) : (
                            filteredTeachers.map((teacher) => {
                              const active = selectedTeachers.includes(teacher.id);
                              return (
                                <button
                                  key={teacher.id}
                                  type="button"
                                  aria-pressed={active}
                                  onClick={() => onToggleTeacherForSubject(id, teacher.id)}
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
              ) : null}

              <Button type="submit" disabled={saving || selectedSubjectIds.length === 0}>
                {saving
                  ? "Assigning..."
                  : selectedSubjectIds.length
                    ? `Assign ${selectedSubjectIds.length} subject${selectedSubjectIds.length === 1 ? "" : "s"}`
                    : "Assign selected subjects"}
              </Button>
            </>
          ) : null}
        </form>

        {selectedClassId ? (
          <div className="mt-6 border-t border-(--border) pt-4">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <p className="pb-2.5 text-sm font-semibold text-(--foreground)">Subjects currently assigned to this class</p>
              <SearchField
                value={assignedQuery}
                onChange={onAssignedQueryChange}
                label="Search assigned subjects"
                placeholder="Subject or teacher"
                className="w-full sm:max-w-xs"
              />
            </div>
            {assignedRows.length === 0 ? (
              <Empty>No subjects assigned to this class yet.</Empty>
            ) : filteredAssignedRows.length === 0 ? (
              <Empty>No assigned subjects match "{assignedQuery.trim()}".</Empty>
            ) : (
              <div className="space-y-2">
                {filteredAssignedRows.map((row) => {
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
                          <Button type="button" variant="subtle" onClick={() => onEditTeachers(row)} disabled={saving}>Manage teachers</Button>
                          <Button type="button" variant="danger" onClick={() => onRemoveAssignment(row)} disabled={saving}>Remove</Button>
                        </div>
                      </div>
                      {editing ? (
                        <div className="mt-3 border-t border-(--border) pt-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-(--foreground)">Select one or more teachers</p>
                            <span className={`text-xs ${draft.length ? "text-(--muted-foreground)" : "text-(--danger)"}`}>
                              {draft.length ? `${draft.length} selected` : "At least one required"}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {teachers.length === 0 ? (
                              <p className="text-xs text-(--danger)">No active teachers available.</p>
                            ) : filteredTeachers.length === 0 ? (
                              <p className="text-xs text-(--muted-foreground)">No teachers match "{teacherQuery.trim()}".</p>
                            ) : (
                              filteredTeachers.map((teacher) => {
                                const active = draft.includes(teacher.id);
                                return (
                                  <button
                                    key={teacher.id}
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() => onToggleDraftTeacher(row.id, teacher.id)}
                                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2 ${active ? "border-(--primary) bg-(--primary)/10 text-(--primary)" : "border-(--border) text-(--muted-foreground) hover:border-(--primary)/40 hover:text-(--foreground)"}`}
                                  >
                                    {teacherLabel(teacher)}
                                  </button>
                                );
                              })
                            )}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button type="button" onClick={() => onSaveTeachers(row)} disabled={saving || draft.length === 0}>
                              {saving ? "Saving..." : "Save teachers"}
                            </Button>
                            <Button type="button" variant="subtle" onClick={onCancelEditTeachers} disabled={saving}>Cancel</Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </Card>
    </section>
  );
}
