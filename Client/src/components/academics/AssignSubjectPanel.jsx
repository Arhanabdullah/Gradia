import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Empty, Field, SearchField, Select, inputClass } from "../ui";
import ImportButton from "../import/ImportButton";

const SUBJECT_PAGE_SIZE = 20;
const TEACHER_MATCH_LIMIT = 20;

function teacherLabel(teacher) {
  if (!teacher) return "";
  const id = teacher.teacher_id || teacher.username;
  return id ? `${teacher.name} (${id})` : teacher.name;
}

function teacherNamesFor(row) {
  return (row.teachers ?? []).map((teacher) => teacherLabel(teacher.profiles)).filter(Boolean);
}

function TeacherPicker({ teachers, selectedIds, onToggle, disabled = false }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const selectedTeachers = selectedIds
    .map((id) => teachers.find((teacher) => teacher.id === id))
    .filter(Boolean);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return teachers
      .filter((teacher) => !selectedIds.includes(teacher.id))
      .filter((teacher) => {
        if (!needle) return true;
        return [teacher.name, teacher.teacher_id, teacher.username, teacherLabel(teacher)]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      })
      .slice(0, TEACHER_MATCH_LIMIT);
  }, [teachers, selectedIds, query]);

  return (
    <div ref={containerRef} className="relative mt-2">
      {teachers.length === 0 ? (
        <p className="text-xs text-(--danger)">No active teachers available. Add teachers in Users before assigning subjects.</p>
      ) : (
        <>
          <input
            type="text"
            className={inputClass}
            value={query}
            placeholder="Search teachers by name or staff ID"
            aria-label="Search teachers"
            aria-expanded={open}
            disabled={disabled}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
          />
          {open ? (
            <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-(--border) bg-(--surface) p-1 shadow-lg">
              {matches.length === 0 ? (
                <p className="px-2 py-2 text-xs text-(--muted-foreground)">
                  {query.trim()
                    ? `No teachers match "${query.trim()}".`
                    : "All available teachers are already selected."}
                </p>
              ) : (
                matches.map((teacher) => (
                  <button
                    key={teacher.id}
                    type="button"
                    onClick={() => {
                      onToggle(teacher.id);
                      setQuery("");
                      setOpen(true);
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-(--foreground) transition-colors hover:bg-(--primary)/10 focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2"
                  >
                    <span>{teacherLabel(teacher)}</span>
                    <span className="text-(--muted-foreground)">Add</span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </>
      )}

      {selectedTeachers.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {selectedTeachers.map((teacher, index) => (
            <span
              key={teacher.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-(--primary) bg-(--primary)/10 px-3 py-1 text-xs font-medium text-(--primary)"
            >
              {index === 0 ? (
                <span className="rounded-full bg-(--primary) px-1.5 py-0.5 text-[11px] font-semibold text-white">Primary</span>
              ) : null}
              <span>{teacherLabel(teacher)}</span>
              <button
                type="button"
                onClick={() => onToggle(teacher.id)}
                disabled={disabled}
                aria-label={`Remove ${teacher.name}`}
                className="rounded-full px-1 text-(--primary) hover:bg-(--primary)/15 focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
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
  onCatalogueQueryChange,
  onAssignedQueryChange,
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
  const [visibleSubjects, setVisibleSubjects] = useState(SUBJECT_PAGE_SIZE);

  useEffect(() => {
    setVisibleSubjects(SUBJECT_PAGE_SIZE);
  }, [catalogueQuery, selectedClassId]);

  const filteredCatalogueSubjects = useMemo(() => {
    const needle = catalogueQuery.trim().toLowerCase();
    if (!needle) return subjects;
    return subjects.filter((subject) =>
      [subject.code, subject.name, subject.max_marks]
        .filter((value) => value !== null && value !== undefined && value !== "")
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [subjects, catalogueQuery]);

  const shownCatalogueSubjects = filteredCatalogueSubjects.slice(0, visibleSubjects);
  const remainingSubjects = filteredCatalogueSubjects.length - shownCatalogueSubjects.length;

  const filteredAssignedRows = useMemo(() => {
    const needle = assignedQuery.trim().toLowerCase();
    if (!needle) return assignedRows;
    return assignedRows.filter((row) =>
      [row.subjects?.code, row.subjects?.name, ...teacherNamesFor(row)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [assignedRows, assignedQuery]);

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
                  <>
                    <div className="grid gap-2 md:grid-cols-2">
                      {shownCatalogueSubjects.map((subject) => {
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
                    {remainingSubjects > 0 ? (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-(--muted-foreground)">
                          Showing {shownCatalogueSubjects.length} of {filteredCatalogueSubjects.length} subjects.
                        </p>
                        <Button
                          type="button"
                          variant="subtle"
                          onClick={() => setVisibleSubjects((current) => current + SUBJECT_PAGE_SIZE)}
                        >
                          Show {Math.min(SUBJECT_PAGE_SIZE, remainingSubjects)} more
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              {selectedSubjectIds.length > 0 ? (
                <div className="space-y-3">
                  <p className="pb-2.5 text-xs font-semibold text-(--foreground)">Assign at least one teacher to every selected subject</p>
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
                        <TeacherPicker
                          teachers={teachers}
                          selectedIds={selectedTeachers}
                          onToggle={(teacherId) => onToggleTeacherForSubject(id, teacherId)}
                          disabled={saving}
                        />
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
                          <TeacherPicker
                            teachers={teachers}
                            selectedIds={draft}
                            onToggle={(teacherId) => onToggleDraftTeacher(row.id, teacherId)}
                            disabled={saving}
                          />
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
