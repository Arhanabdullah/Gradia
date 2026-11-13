import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Button, Card, Empty, Field, Select, inputClass } from "../../components/ui";
import DashboardHeader from "../../components/dashboard/DashboardHeader";

const COMPONENT_TYPES = [
  { value: "internal", label: "Internal assessment" },
  { value: "quiz", label: "Quiz" },
  { value: "assignment", label: "Assignment" },
  { value: "practical", label: "Practical" },
  { value: "theory", label: "Theory" },
  { value: "esa", label: "End semester assessment" },
  { value: "overall", label: "Overall" },
];

const EMPTY_COMPONENT = {
  name: "",
  component_type: "internal",
  max_marks: "",
  pass_marks: "",
  weight_percent: "",
  display_order: "1",
  is_optional: false,
};

const numberOrNull = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isNaN(numeric) ? null : numeric;
};

const AssessmentSetup = () => {
  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState("");
  const [examSubjects, setExamSubjects] = useState([]);
  const [examSubjectId, setExamSubjectId] = useState("");
  const [components, setComponents] = useState([]);
  const [componentDrafts, setComponentDrafts] = useState({});
  const [componentForm, setComponentForm] = useState(EMPTY_COMPONENT);
  const [subjectDraft, setSubjectDraft] = useState({ max_marks: "", pass_marks: "" });
  const [marksCount, setMarksCount] = useState(0);

  const [loadingExams, setLoadingExams] = useState(true);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [loadingComponents, setLoadingComponents] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    supabase
      .from("exams")
      .select("id, name, academic_year, class_id, classes ( name )")
      .order("created_at", { ascending: false })
      .then(({ data, error: examsError }) => {
        setExams(data ?? []);
        setLoadingExams(false);
        if (examsError) setError(examsError.message);
      });
  }, []);

  useEffect(() => {
    setExamSubjects([]);
    setExamSubjectId("");
    setComponents([]);
    setMarksCount(0);
    if (!examId) return;
    let cancelled = false;
    setLoadingSubjects(true);
    Promise.all([
      supabase
        .from("exam_subjects")
        .select("id, subject_id, max_marks, pass_marks, is_optional, subjects ( name, code )")
        .eq("exam_id", examId)
        .order("subject_id"),
      supabase.from("marks").select("id", { count: "exact", head: true }).eq("exam_id", examId),
    ]).then(([subjectsRes, marksRes]) => {
      if (cancelled) return;
      setExamSubjects(subjectsRes.data ?? []);
      setMarksCount(marksRes.count ?? 0);
      setLoadingSubjects(false);
      if (subjectsRes.error) setError(subjectsRes.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [examId]);

  const selectedExam = exams.find((row) => row.id === examId) ?? null;
  const examSubject = examSubjects.find((row) => row.id === examSubjectId) ?? null;

  const loadComponents = async (id) => {
    if (!id) {
      setComponents([]);
      setComponentDrafts({});
      return;
    }
    const { data, error: componentsError } = await supabase
      .from("assessment_components")
      .select("id, exam_subject_id, name, component_type, max_marks, pass_marks, weight_percent, display_order, is_optional")
      .eq("exam_subject_id", id)
      .order("display_order");
    if (componentsError) throw new Error(componentsError.message);
    setComponents(data ?? []);
    setComponentDrafts(
      Object.fromEntries(
        (data ?? []).map((row) => [
          row.id,
          {
            name: row.name,
            component_type: row.component_type ?? "theory",
            max_marks: String(row.max_marks ?? ""),
            pass_marks: row.pass_marks == null ? "" : String(row.pass_marks),
            weight_percent: row.weight_percent == null ? "" : String(row.weight_percent),
            display_order: String(row.display_order ?? 1),
            is_optional: row.is_optional,
          },
        ]),
      ),
    );
  };

  const selectExamSubject = async (id) => {
    setExamSubjectId(id);
    setMessage("");
    setError("");
    const row = examSubjects.find((item) => item.id === id);
    setSubjectDraft({
      max_marks: row ? String(row.max_marks ?? "") : "",
      pass_marks: row?.pass_marks == null ? "" : String(row.pass_marks),
    });
    setComponentForm(EMPTY_COMPONENT);
    setLoadingComponents(true);
    try {
      await loadComponents(id);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingComponents(false);
    }
  };

  const weightTotal = useMemo(
    () =>
      components.reduce((sum, row) => {
        const draft = componentDrafts[row.id];
        const weight = numberOrNull(draft?.weight_percent ?? row.weight_percent);
        return sum + (weight ?? 0);
      }, 0),
    [components, componentDrafts],
  );

  const setComponentValue = (id, key, value) =>
    setComponentDrafts((current) => ({ ...current, [id]: { ...current[id], [key]: value } }));

  const saveExamSubject = async () => {
    if (!examSubject) return;
    const max = numberOrNull(subjectDraft.max_marks);
    const pass = numberOrNull(subjectDraft.pass_marks);
    if (max === null || max <= 0) {
      setError("Exam subject full marks must be greater than zero.");
      return;
    }
    if (pass !== null && (pass < 0 || pass > max)) {
      setError("Pass marks must sit between zero and the full marks.");
      return;
    }
    setBusy("subject");
    setError("");
    setMessage("");
    try {
      const { error: updateError } = await supabase
        .from("exam_subjects")
        .update({ max_marks: max, pass_marks: pass })
        .eq("id", examSubject.id);
      if (updateError) throw new Error(updateError.message);
      setExamSubjects((current) =>
        current.map((row) => (row.id === examSubject.id ? { ...row, max_marks: max, pass_marks: pass } : row)),
      );
      setMessage("Exam subject full marks saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const addComponent = async () => {
    if (!examSubjectId) return;
    const max = numberOrNull(componentForm.max_marks);
    const pass = numberOrNull(componentForm.pass_marks);
    const weight = numberOrNull(componentForm.weight_percent);
    if (!componentForm.name.trim() || max === null || max <= 0) {
      setError("A component needs a name and full marks greater than zero.");
      return;
    }
    if (pass !== null && (pass < 0 || pass > max)) {
      setError("Component pass marks must sit between zero and its full marks.");
      return;
    }
    if (weight !== null && (weight <= 0 || weight > 100)) {
      setError("Component weight must be above zero and at most 100.");
      return;
    }
    setBusy("component-add");
    setError("");
    setMessage("");
    try {
      const { error: insertError } = await supabase.from("assessment_components").insert({
        exam_subject_id: examSubjectId,
        name: componentForm.name.trim(),
        component_type: componentForm.component_type,
        max_marks: max,
        pass_marks: pass,
        weight_percent: weight,
        display_order: numberOrNull(componentForm.display_order) ?? 1,
        is_optional: componentForm.is_optional,
      });
      if (insertError) throw new Error(insertError.message);
      setComponentForm(EMPTY_COMPONENT);
      await loadComponents(examSubjectId);
      setMessage("Assessment component added.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const saveComponent = async (id) => {
    const draft = componentDrafts[id];
    const max = numberOrNull(draft?.max_marks);
    const pass = numberOrNull(draft?.pass_marks);
    const weight = numberOrNull(draft?.weight_percent);
    if (!draft?.name?.trim() || max === null || max <= 0) {
      setError("Check the component name and full marks before saving.");
      return;
    }
    if (pass !== null && (pass < 0 || pass > max)) {
      setError("Component pass marks must sit between zero and its full marks.");
      return;
    }
    if (weight !== null && (weight <= 0 || weight > 100)) {
      setError("Component weight must be above zero and at most 100.");
      return;
    }
    setBusy(`component-${id}`);
    setError("");
    setMessage("");
    try {
      const { error: updateError } = await supabase
        .from("assessment_components")
        .update({
          name: draft.name.trim(),
          component_type: draft.component_type,
          max_marks: max,
          pass_marks: pass,
          weight_percent: weight,
          display_order: numberOrNull(draft.display_order) ?? 1,
          is_optional: draft.is_optional,
        })
        .eq("id", id);
      if (updateError) throw new Error(updateError.message);
      await loadComponents(examSubjectId);
      setMessage("Assessment component updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const deleteComponent = async (id) => {
    if (!window.confirm("Delete this assessment component? Components with marks cannot be removed.")) return;
    setBusy(`component-${id}`);
    setError("");
    setMessage("");
    try {
      const { error: deleteError } = await supabase.from("assessment_components").delete().eq("id", id);
      if (deleteError) throw new Error(deleteError.message);
      await loadComponents(examSubjectId);
      setMessage("Assessment component deleted.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <DashboardHeader
        title="Assessment setup"
        subtitle="Configure assessment components, full marks and weights for each exam subject."
      />

      {message ? <p role="status" className="mt-4 text-xs text-(--success)">{message}</p> : null}
      {error ? <p role="alert" className="mt-4 text-xs text-(--danger)">{error}</p> : null}

      <Card className="mt-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Examination">
            <Select value={examId} onChange={(event) => setExamId(event.target.value)} disabled={loadingExams}>
              <option value="">{loadingExams ? "Loading examinations" : "Choose an examination"}</option>
              {exams.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                  {row.academic_year ? ` (${row.academic_year})` : ""}
                  {row.classes?.name ? `, ${row.classes.name}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Exam subject">
            <Select
              value={examSubjectId}
              onChange={(event) => selectExamSubject(event.target.value)}
              disabled={!examId || loadingSubjects}
            >
              <option value="">
                {!examId
                  ? "Choose an examination first"
                  : loadingSubjects
                    ? "Loading subjects"
                    : examSubjects.length === 0
                      ? "No subjects in this examination"
                      : "Choose a subject"}
              </option>
              {examSubjects.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.subjects?.code} {row.subjects?.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {selectedExam ? (
          <p className="mt-3 text-xs text-(--muted-foreground)">
            {selectedExam.classes?.name ? `${selectedExam.classes.name}, ` : ""}
            {marksCount} mark row{marksCount === 1 ? "" : "s"} recorded for this examination.
            {marksCount > 0
              ? " Exam subjects cannot be added or removed after marks exist, but full marks and components stay editable."
              : ""}
          </p>
        ) : null}
      </Card>

      {examSubject ? (
        <>
          <Card className="mt-4">
            <p className="text-sm font-medium text-(--foreground)">
              {examSubject.subjects?.code} {examSubject.subjects?.name}
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Field label="Subject full marks">
                <input
                  type="number"
                  className={`${inputClass} w-32 tabular-nums`}
                  value={subjectDraft.max_marks}
                  onChange={(event) =>
                    setSubjectDraft((current) => ({ ...current, max_marks: event.target.value }))
                  }
                />
              </Field>
              <Field label="Subject pass marks">
                <input
                  type="number"
                  className={`${inputClass} w-32 tabular-nums`}
                  value={subjectDraft.pass_marks}
                  onChange={(event) =>
                    setSubjectDraft((current) => ({ ...current, pass_marks: event.target.value }))
                  }
                  placeholder="Optional"
                />
              </Field>
              <Button onClick={saveExamSubject} disabled={busy === "subject"}>
                {busy === "subject" ? "Saving" : "Save subject"}
              </Button>
            </div>
          </Card>

          <Card className="mt-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-(--foreground)">Assessment components</p>
                <p className="mt-1 text-xs text-(--muted-foreground)">
                  When weights total 100, the subject total is weighted. Otherwise raw component marks are summed.
                </p>
              </div>
              <p className="text-xs tabular-nums text-(--muted-foreground)">
                Weight total: {Math.round(weightTotal * 100) / 100}%
              </p>
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-(--border-subtle) p-3">
              <Field label="Name">
                <input
                  className={`${inputClass} w-40`}
                  value={componentForm.name}
                  onChange={(event) =>
                    setComponentForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Internal assessment"
                />
              </Field>
              <Field label="Type">
                <Select
                  value={componentForm.component_type}
                  onChange={(event) =>
                    setComponentForm((current) => ({ ...current, component_type: event.target.value }))
                  }
                >
                  {COMPONENT_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Full marks">
                <input
                  type="number"
                  className={`${inputClass} w-28 tabular-nums`}
                  value={componentForm.max_marks}
                  onChange={(event) =>
                    setComponentForm((current) => ({ ...current, max_marks: event.target.value }))
                  }
                />
              </Field>
              <Field label="Pass marks">
                <input
                  type="number"
                  className={`${inputClass} w-28 tabular-nums`}
                  value={componentForm.pass_marks}
                  onChange={(event) =>
                    setComponentForm((current) => ({ ...current, pass_marks: event.target.value }))
                  }
                  placeholder="Optional"
                />
              </Field>
              <Field label="Weight %">
                <input
                  type="number"
                  className={`${inputClass} w-24 tabular-nums`}
                  value={componentForm.weight_percent}
                  onChange={(event) =>
                    setComponentForm((current) => ({ ...current, weight_percent: event.target.value }))
                  }
                  placeholder="Optional"
                />
              </Field>
              <Field label="Order">
                <input
                  type="number"
                  className={`${inputClass} w-20 tabular-nums`}
                  value={componentForm.display_order}
                  onChange={(event) =>
                    setComponentForm((current) => ({ ...current, display_order: event.target.value }))
                  }
                />
              </Field>
              <label className="flex items-center gap-2 pb-2 text-xs text-(--foreground)">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-(--primary)"
                  checked={componentForm.is_optional}
                  onChange={(event) =>
                    setComponentForm((current) => ({ ...current, is_optional: event.target.checked }))
                  }
                />
                Optional
              </label>
              <Button variant="subtle" onClick={addComponent} disabled={busy === "component-add"}>
                {busy === "component-add" ? "Adding" : "Add component"}
              </Button>
            </div>

            {loadingComponents ? (
              <div className="mt-3 glass-inner h-24 motion-safe:animate-pulse rounded-xl" aria-hidden="true" />
            ) : components.length === 0 ? (
              <div className="mt-3">
                <Empty>No assessment components configured for this subject.</Empty>
              </div>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-xl border border-(--border-subtle)">
                <table className="min-w-full text-left text-xs tabular-nums">
                  <thead className="bg-(--surface-secondary)">
                    <tr className="border-b border-(--border-subtle)">
                      {["Name", "Type", "Full marks", "Pass marks", "Weight %", "Order", "Optional", ""].map((label) => (
                        <th key={label} className="px-3 py-2 font-medium text-(--muted-foreground)">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {components.map((row) => {
                      const draft = componentDrafts[row.id] ?? {};
                      return (
                        <tr key={row.id} className="border-b border-(--border-subtle)/60 last:border-b-0">
                          <td className="px-3 py-2">
                            <input
                              className={`${inputClass} w-40`}
                              value={draft.name ?? ""}
                              onChange={(event) => setComponentValue(row.id, "name", event.target.value)}
                              aria-label={`Name for ${row.name}`}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Select
                              value={draft.component_type ?? "theory"}
                              onChange={(event) => setComponentValue(row.id, "component_type", event.target.value)}
                              aria-label={`Type for ${row.name}`}
                            >
                              {COMPONENT_TYPES.map((type) => (
                                <option key={type.value} value={type.value}>{type.label}</option>
                              ))}
                            </Select>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              className={`${inputClass} w-24`}
                              value={draft.max_marks ?? ""}
                              onChange={(event) => setComponentValue(row.id, "max_marks", event.target.value)}
                              aria-label={`Full marks for ${row.name}`}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              className={`${inputClass} w-24`}
                              value={draft.pass_marks ?? ""}
                              onChange={(event) => setComponentValue(row.id, "pass_marks", event.target.value)}
                              aria-label={`Pass marks for ${row.name}`}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              className={`${inputClass} w-24`}
                              value={draft.weight_percent ?? ""}
                              onChange={(event) => setComponentValue(row.id, "weight_percent", event.target.value)}
                              aria-label={`Weight for ${row.name}`}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              className={`${inputClass} w-20`}
                              value={draft.display_order ?? ""}
                              onChange={(event) => setComponentValue(row.id, "display_order", event.target.value)}
                              aria-label={`Display order for ${row.name}`}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-(--primary)"
                              checked={Boolean(draft.is_optional)}
                              onChange={(event) => setComponentValue(row.id, "is_optional", event.target.checked)}
                              aria-label={`Optional for ${row.name}`}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="subtle"
                                onClick={() => saveComponent(row.id)}
                                disabled={busy === `component-${row.id}`}
                              >
                                Save
                              </Button>
                              <Button
                                variant="danger"
                                onClick={() => deleteComponent(row.id)}
                                disabled={busy === `component-${row.id}`}
                              >
                                Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </>
  );
};

export default AssessmentSetup;
