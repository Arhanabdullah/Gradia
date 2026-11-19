import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { callRpc } from "../../lib/db";
import { Button, Card, Empty, Field, Select, inputClass } from "../../components/ui";
import DashboardHeader from "../../components/dashboard/DashboardHeader";
import AssessmentTemplateEditor from "../../components/assessment/AssessmentTemplateEditor";
import {
  COMPONENT_TYPES,
  numberText,
  subjectTypeLabel,
  templateContributionTotal,
  templateMatchesSubjectType,
} from "../../lib/assessment";
import { examTypeLabel, resolvedResultKind, resultKindLabel } from "../../lib/exams";

const EMPTY_COMPONENT = {
  name: "",
  component_type: "internal",
  max_marks: "",
  pass_marks: "",
  weight_percent: "",
  display_order: "1",
  is_optional: false,
  is_external: false,
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
  const [subjectTemplateId, setSubjectTemplateId] = useState("");
  const [marksCount, setMarksCount] = useState(0);

  const [templates, setTemplates] = useState([]);
  const [templateComponents, setTemplateComponents] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  const [replaceExam, setReplaceExam] = useState(false);
  const [replaceSubject, setReplaceSubject] = useState(false);

  const [loadingExams, setLoadingExams] = useState(true);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [loadingComponents, setLoadingComponents] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    const [templatesRes, componentsRes] = await Promise.all([
      supabase
        .from("assessment_templates")
        .select("id, name, subject_type, mode, total_marks, description, is_default, is_active, created_at")
        .order("subject_type")
        .order("created_at"),
      supabase
        .from("assessment_template_components")
        .select(
          "id, template_id, name, code, component_type, max_marks, pass_marks, weight_percent, aggregation, group_code, scale_from, scale_to, display_order, is_optional, is_external",
        )
        .order("display_order"),
    ]);
    setTemplates(templatesRes.data ?? []);
    setTemplateComponents(componentsRes.error ? [] : componentsRes.data ?? []);
    setLoadingTemplates(false);
    if (templatesRes.error) setError(templatesRes.error.message);
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    supabase
      .from("exams")
      .select("id, name, academic_year, class_id, exam_type, result_kind, classes ( name )")
      .order("created_at", { ascending: false })
      .then(({ data, error: examsError }) => {
        setExams(data ?? []);
        setLoadingExams(false);
        if (examsError) setError(examsError.message);
      });
  }, []);

  const loadExamSubjects = useCallback(async (id) => {
    const [subjectsRes, marksRes] = await Promise.all([
      supabase
        .from("exam_subjects")
        .select(
          "id, subject_id, max_marks, pass_marks, is_optional, assessment_template_id, subjects ( id, name, code, subject_type, assessment_template_id, credit_hours ), assessment_components ( id )",
        )
        .eq("exam_id", id)
        .order("subject_id"),
      supabase.from("marks").select("id", { count: "exact", head: true }).eq("exam_id", id),
    ]);
    if (subjectsRes.error) throw new Error(subjectsRes.error.message);
    const rows = subjectsRes.data ?? [];
    setExamSubjects(rows);
    setMarksCount(marksRes.count ?? 0);
    return rows;
  }, []);

  useEffect(() => {
    setExamSubjects([]);
    setExamSubjectId("");
    setComponents([]);
    setMarksCount(0);
    if (!examId) return undefined;
    let cancelled = false;
    setLoadingSubjects(true);
    loadExamSubjects(examId)
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingSubjects(false);
      });
    return () => {
      cancelled = true;
    };
  }, [examId, loadExamSubjects]);

  const selectedExam = exams.find((row) => row.id === examId) ?? null;
  const examSubject = examSubjects.find((row) => row.id === examSubjectId) ?? null;
  const examResultKind = resolvedResultKind(selectedExam);

  const subjectTemplates = useMemo(
    () =>
      templates.filter(
        (row) =>
          row.is_active &&
          templateMatchesSubjectType(row, examSubject?.subjects?.subject_type ?? ""),
      ),
    [templates, examSubject],
  );

  const missingStructure = useMemo(
    () => examSubjects.filter((row) => (row.assessment_components?.length ?? 0) === 0),
    [examSubjects],
  );

  const loadComponents = async (id) => {
    if (!id) {
      setComponents([]);
      setComponentDrafts({});
      return;
    }
    const { data, error: componentsError } = await supabase
      .from("assessment_components")
      .select(
        "id, exam_subject_id, name, code, component_type, max_marks, pass_marks, weight_percent, aggregation, group_code, scale_from, scale_to, display_order, is_optional, is_external, assessment_template_id",
      )
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
            is_external: row.is_external,
          },
        ]),
      ),
    );
  };

  const selectExamSubject = async (id) => {
    setExamSubjectId(id);
    setMessage("");
    setError("");
    setReplaceSubject(false);
    const row = examSubjects.find((item) => item.id === id);
    setSubjectDraft({
      max_marks: row ? String(row.max_marks ?? "") : "",
      pass_marks: row?.pass_marks == null ? "" : String(row.pass_marks),
    });
    setSubjectTemplateId(row?.assessment_template_id ?? "");
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

  const contributionTotal = useMemo(
    () =>
      templateContributionTotal(
        components.map((row) => ({ ...row, ...(componentDrafts[row.id] ?? {}) })),
      ),
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

  const applyExamTemplates = async () => {
    if (!examId) return;
    setBusy("apply-exam");
    setError("");
    setMessage("");
    try {
      const data = await callRpc("apply_assessment_templates_to_exam", {
        p_exam_id: examId,
        p_replace: replaceExam,
      });
      const applied = Number(data?.applied ?? 0);
      const skipped = Number(data?.skipped ?? 0);
      setMessage(
        `Applied templates to ${applied} subject${applied === 1 ? "" : "s"}${
          skipped > 0 ? `, skipped ${skipped}` : ""
        }.`,
      );
      const rows = await loadExamSubjects(examId);
      if (examSubjectId) {
        const updated = rows.find((row) => row.id === examSubjectId);
        setSubjectTemplateId(updated?.assessment_template_id ?? "");
        setSubjectDraft({
          max_marks: updated ? String(updated.max_marks ?? "") : "",
          pass_marks: updated?.pass_marks == null ? "" : String(updated.pass_marks),
        });
        await loadComponents(examSubjectId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const applySubjectTemplate = async () => {
    if (!examSubject) return;
    setBusy("apply-subject");
    setError("");
    setMessage("");
    try {
      const data = await callRpc("apply_assessment_template", {
        p_exam_subject_id: examSubject.id,
        p_template_id: subjectTemplateId || null,
        p_replace: replaceSubject,
      });
      setMessage(
        `Applied the template to ${examSubject.subjects?.code ?? "this subject"} (${
          data?.components ?? 0
        } components).`,
      );
      const rows = await loadExamSubjects(examId);
      const updated = rows.find((row) => row.id === examSubject.id);
      setSubjectTemplateId(updated?.assessment_template_id ?? "");
      setSubjectDraft({
        max_marks: updated ? String(updated.max_marks ?? "") : "",
        pass_marks: updated?.pass_marks == null ? "" : String(updated.pass_marks),
      });
      await loadComponents(examSubject.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const saveSubjectDefault = async () => {
    if (!examSubject) return;
    setBusy("subject-default");
    setError("");
    setMessage("");
    try {
      await callRpc("set_subject_assessment_template", {
        p_subject_id: examSubject.subject_id,
        p_template_id: subjectTemplateId || null,
      });
      setMessage(
        "Subject default saved. New examinations for this subject inherit it automatically.",
      );
      await loadExamSubjects(examId);
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
      setError("Component contribution must be above zero and at most 100.");
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
        is_external: componentForm.is_external,
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
    const row = components.find((item) => item.id === id);
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
    if (row?.aggregation !== "scaled" && weight !== null && (weight <= 0 || weight > 100)) {
      setError("Component contribution must be above zero and at most 100.");
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
          weight_percent: row?.aggregation === "scaled" ? row.weight_percent : weight,
          display_order: numberOrNull(draft.display_order) ?? 1,
          is_optional: draft.is_optional,
          is_external: draft.is_external,
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
        subtitle="Configure reusable assessment structures, then apply them to examinations and subjects."
      />

      {message ? <p role="status" className="mt-4 text-xs text-(--success)">{message}</p> : null}
      {error ? <p role="alert" className="mt-4 text-xs text-(--danger)">{error}</p> : null}

      <AssessmentTemplateEditor
        templates={templates}
        templateComponents={templateComponents}
        loading={loadingTemplates}
        reload={loadTemplates}
        onMessage={setMessage}
        onError={setError}
      />

      <Card className="mt-4">
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
                  {row.subjects?.code} {row.subjects?.name}, {row.assessment_components?.length ?? 0} component
                  {(row.assessment_components?.length ?? 0) === 1 ? "" : "s"}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {selectedExam ? (
          <>
            <p className="mt-3 text-xs text-(--muted-foreground)">
              {selectedExam.classes?.name ? `${selectedExam.classes.name}, ` : ""}
              {examTypeLabel(selectedExam.exam_type)}, {resultKindLabel(examResultKind).toLowerCase()}.
              {marksCount} mark row{marksCount === 1 ? "" : "s"} recorded for this examination.
              {marksCount > 0
                ? " Structures cannot be rebuilt for a subject that already has marks."
                : ""}
            </p>
            {examResultKind === "semester" ? (
              <p className="mt-1 text-[11px] text-(--muted-foreground)">
                Every marked subject needs a configured structure before this semester result can be
                compiled, approved and published.
                {missingStructure.length > 0
                  ? ` ${missingStructure.length} subject${
                      missingStructure.length === 1 ? "" : "s"
                    } without components: ${missingStructure
                      .map((row) => row.subjects?.code ?? "subject")
                      .join(", ")}.`
                  : ""}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="subtle" onClick={applyExamTemplates} disabled={busy === "apply-exam"}>
                {busy === "apply-exam" ? "Applying" : "Apply default templates"}
              </Button>
              <label className="flex items-center gap-2 text-xs text-(--foreground)">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-(--primary)"
                  checked={replaceExam}
                  onChange={(event) => setReplaceExam(event.target.checked)}
                />
                Replace existing components
              </label>
            </div>
          </>
        ) : null}
      </Card>

      {examSubject ? (
        <>
          <Card className="mt-4">
            <p className="text-sm font-medium text-(--foreground)">
              {examSubject.subjects?.code} {examSubject.subjects?.name}
              <span className="ml-2 text-xs font-normal text-(--muted-foreground)">
                {subjectTypeLabel(examSubject.subjects?.subject_type)}
                {examSubject.subjects?.credit_hours != null
                  ? `, ${numberText(examSubject.subjects.credit_hours)} credits`
                  : ""}
              </span>
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Assessment template">
                <Select
                  value={subjectTemplateId}
                  onChange={(event) => setSubjectTemplateId(event.target.value)}
                >
                  <option value="">Use the subject default</option>
                  {subjectTemplates.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                      {row.is_default ? " (default)" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Subject full marks">
                <input
                  type="number"
                  className={`${inputClass} tabular-nums`}
                  value={subjectDraft.max_marks}
                  onChange={(event) =>
                    setSubjectDraft((current) => ({ ...current, max_marks: event.target.value }))
                  }
                />
              </Field>
              <Field label="Subject pass marks">
                <input
                  type="number"
                  className={`${inputClass} tabular-nums`}
                  value={subjectDraft.pass_marks}
                  onChange={(event) =>
                    setSubjectDraft((current) => ({ ...current, pass_marks: event.target.value }))
                  }
                  placeholder="Optional"
                />
              </Field>
              <div className="flex items-end">
                <Button onClick={saveExamSubject} disabled={busy === "subject"}>
                  {busy === "subject" ? "Saving" : "Save subject"}
                </Button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="subtle" onClick={applySubjectTemplate} disabled={busy === "apply-subject"}>
                {busy === "apply-subject" ? "Applying" : "Apply template to this subject"}
              </Button>
              <Button variant="subtle" onClick={saveSubjectDefault} disabled={busy === "subject-default"}>
                {busy === "subject-default" ? "Saving" : "Save as subject default"}
              </Button>
              <label className="flex items-center gap-2 text-xs text-(--foreground)">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-(--primary)"
                  checked={replaceSubject}
                  onChange={(event) => setReplaceSubject(event.target.checked)}
                />
                Replace existing components
              </label>
            </div>
            <p className="mt-2 text-[11px] text-(--muted-foreground)">
              Applying a template rewrites this exam subject&apos;s components and sets its full marks
              to the template total. It is only possible before marks exist.
            </p>
          </Card>

          <Card className="mt-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-(--foreground)">Assessment components</p>
                <p className="mt-1 text-xs text-(--muted-foreground)">
                  These are the components marks are entered against. A component applied from a
                  template keeps its aggregation, group and scale; edit those on the template.
                </p>
              </div>
              <p className="text-xs tabular-nums text-(--muted-foreground)">
                Contributes {numberText(contributionTotal)}
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
                    <option key={type.id} value={type.id}>{type.label}</option>
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
              <Field label="Contribution">
                <input
                  type="number"
                  className={`${inputClass} w-28 tabular-nums`}
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
              <label className="flex items-center gap-2 pb-2 text-xs text-(--foreground)">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-(--primary)"
                  checked={componentForm.is_external}
                  onChange={(event) =>
                    setComponentForm((current) => ({ ...current, is_external: event.target.checked }))
                  }
                />
                External
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
                      {[
                        "Name",
                        "Type",
                        "Full marks",
                        "Pass marks",
                        "Contribution",
                        "Structure",
                        "Order",
                        "Optional",
                        "External",
                        "",
                      ].map((label) => (
                        <th key={label} className="px-3 py-2 font-medium text-(--muted-foreground)">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {components.map((row) => {
                      const draft = componentDrafts[row.id] ?? {};
                      const scaled = row.aggregation === "scaled";
                      const structure =
                        row.aggregation === "average"
                          ? `Group ${row.group_code || "IA"} average`
                          : scaled
                            ? `${numberText(row.scale_from)} scaled to ${numberText(row.scale_to)}`
                            : row.is_external
                              ? "Direct, external"
                              : "Direct";
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
                                <option key={type.id} value={type.id}>{type.label}</option>
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
                              disabled={scaled}
                              aria-label={`Contribution for ${row.name}`}
                            />
                          </td>
                          <td className="px-3 py-2 text-(--muted-foreground)">{structure}</td>
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
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-(--primary)"
                              checked={Boolean(draft.is_external)}
                              onChange={(event) => setComponentValue(row.id, "is_external", event.target.checked)}
                              aria-label={`External for ${row.name}`}
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
