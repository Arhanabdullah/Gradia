import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { callRpc } from "../../lib/db";
import { Button, Card, Empty, Field, Select, inputClass } from "../ui";
import {
  AGGREGATIONS,
  COMPONENT_TYPES,
  SUBJECT_TYPES,
  TEMPLATE_MODES,
  averageGroups,
  numberText,
  subjectTypeLabel,
  templateContributionTotal,
} from "../../lib/assessment";

const EMPTY_TEMPLATE = {
  name: "",
  subject_type: "theory",
  mode: "detailed",
  total_marks: "100",
  description: "",
};

const EMPTY_COMPONENT = {
  name: "",
  code: "",
  component_type: "internal",
  max_marks: "",
  weight_percent: "",
  aggregation: "direct",
  group_code: "",
  scale_from: "",
  scale_to: "",
  display_order: "1",
  is_optional: false,
  is_external: false,
};

const numberOrNull = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isNaN(numeric) ? null : numeric;
};

const draftFor = (row) => ({
  name: row.name ?? "",
  code: row.code ?? "",
  component_type: row.component_type ?? "internal",
  max_marks: String(row.max_marks ?? ""),
  weight_percent: row.weight_percent == null ? "" : String(row.weight_percent),
  aggregation: row.aggregation ?? "direct",
  group_code: row.group_code ?? "",
  scale_from: row.scale_from == null ? "" : String(row.scale_from),
  scale_to: row.scale_to == null ? "" : String(row.scale_to),
  display_order: String(row.display_order ?? 1),
  is_optional: Boolean(row.is_optional),
  is_external: Boolean(row.is_external),
});

const payloadFor = (draft) => {
  const max = numberOrNull(draft.max_marks);
  const weight = numberOrNull(draft.weight_percent);
  const aggregation = draft.aggregation ?? "direct";
  const scaleFrom = aggregation === "scaled" ? numberOrNull(draft.scale_from) : null;
  const scaleTo = aggregation === "scaled" ? numberOrNull(draft.scale_to) : null;

  return {
    name: (draft.name ?? "").trim(),
    code: (draft.code ?? "").trim(),
    component_type: draft.component_type ?? "internal",
    max_marks: max,
    // A scaled component contributes its scale target, so the stored weight
    // always mirrors the conversion the engine applies.
    weight_percent: aggregation === "scaled" ? scaleTo : weight,
    aggregation,
    group_code: aggregation === "average" ? (draft.group_code ?? "").trim() : "",
    scale_from: scaleFrom,
    scale_to: scaleTo,
    display_order: numberOrNull(draft.display_order) ?? 1,
    is_optional: Boolean(draft.is_optional),
    is_external: Boolean(draft.is_external),
  };
};

const validate = (draft) => {
  const payload = payloadFor(draft);
  if (!payload.name) return "A component needs a name.";
  if (payload.max_marks === null || payload.max_marks <= 0) {
    return "Component full marks must be greater than zero.";
  }
  if (payload.aggregation === "scaled") {
    if (!payload.scale_from || payload.scale_from <= 0 || !payload.scale_to || payload.scale_to <= 0) {
      return "A scaled component needs a source and a target above zero.";
    }
  } else if (
    payload.weight_percent === null ||
    payload.weight_percent < 0 ||
    payload.weight_percent > 100
  ) {
    return "The contribution must sit between zero and 100.";
  }
  if (payload.aggregation === "average" && !payload.group_code) {
    return "An averaged component needs a group code, for example IA.";
  }
  return "";
};

const AssessmentTemplateEditor = ({
  templates,
  templateComponents,
  loading,
  reload,
  onMessage,
  onError,
}) => {
  const [selectedId, setSelectedId] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_TEMPLATE);
  const [drafts, setDrafts] = useState({});
  const [componentForm, setComponentForm] = useState(EMPTY_COMPONENT);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (creating) return;
    if (selectedId && templates.some((row) => row.id === selectedId)) return;
    setSelectedId(templates[0]?.id ?? "");
  }, [templates, selectedId, creating]);

  const selected = templates.find((row) => row.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) return;
    setForm({
      name: selected.name ?? "",
      subject_type: selected.subject_type ?? "theory",
      mode: selected.mode ?? "detailed",
      total_marks: String(selected.total_marks ?? "100"),
      description: selected.description ?? "",
    });
  }, [selected]);

  const rows = useMemo(
    () =>
      templateComponents
        .filter((row) => row.template_id === selectedId)
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.name.localeCompare(b.name)),
    [templateComponents, selectedId],
  );

  useEffect(() => {
    setDrafts(Object.fromEntries(rows.map((row) => [row.id, draftFor(row)])));
    setComponentForm((current) => ({
      ...EMPTY_COMPONENT,
      display_order: String((rows.at(-1)?.display_order ?? 0) + 1),
      component_type: current.component_type ?? "internal",
    }));
  }, [rows]);

  const contributionTotal = useMemo(() => templateContributionTotal(rows), [rows]);
  const groups = useMemo(() => averageGroups(rows), [rows]);
  const totalTarget = numberOrNull(form.total_marks) ?? 0;
  const totalMatches = Math.abs(contributionTotal - totalTarget) < 0.01;

  const setDraft = (id, key, value) =>
    setDrafts((current) => ({ ...current, [id]: { ...current[id], [key]: value } }));

  const changeAggregation = (id, value) => {
    setDrafts((current) => {
      const draft = current[id];
      if (!draft) return current;
      const next = { ...draft, aggregation: value };
      if (value === "scaled") {
        next.scale_from = draft.scale_from || draft.max_marks;
        next.scale_to = draft.scale_to || draft.weight_percent || draft.max_marks;
        next.weight_percent = next.scale_to;
      }
      if (value === "average" && !draft.group_code) next.group_code = "IA";
      return { ...current, [id]: next };
    });
  };

  const changeScaleTo = (id, value) =>
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], scale_to: value, weight_percent: value },
    }));

  const startNew = () => {
    setCreating(true);
    setSelectedId("");
    setForm(EMPTY_TEMPLATE);
    setDrafts({});
    setComponentForm(EMPTY_COMPONENT);
    onMessage("");
    onError("");
  };

  const saveTemplate = async () => {
    const name = form.name.trim();
    const total = numberOrNull(form.total_marks);
    if (!name) return onError("Give the template a name.");
    if (total === null || total <= 0) return onError("The template total must be greater than zero.");

    setBusy("template");
    onMessage("");
    onError("");
    try {
      const payload = {
        name,
        subject_type: form.subject_type,
        mode: form.mode,
        total_marks: total,
        description: form.description.trim(),
      };
      if (creating) {
        const { data, error } = await supabase
          .from("assessment_templates")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        await reload();
        setCreating(false);
        setSelectedId(data.id);
        onMessage("Assessment template created.");
      } else if (selected) {
        const { error } = await supabase
          .from("assessment_templates")
          .update(payload)
          .eq("id", selected.id);
        if (error) throw new Error(error.message);
        onMessage("Assessment template saved.");
      }
      await reload();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy("");
    }
  };

  const makeDefault = async () => {
    if (!selected) return;
    setBusy("default");
    onMessage("");
    onError("");
    try {
      await callRpc("set_default_assessment_template", {
        p_template_id: selected.id,
        p_is_default: !selected.is_default,
      });
      onMessage(
        selected.is_default
          ? "This template is no longer the default for its subject type."
          : "This template is now the default for its subject type.",
      );
      await reload();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy("");
    }
  };

  const deleteTemplate = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete the template "${selected.name}"? Templates in use cannot be deleted.`)) return;
    setBusy("delete");
    onMessage("");
    onError("");
    try {
      const { error } = await supabase.from("assessment_templates").delete().eq("id", selected.id);
      if (error) throw new Error(error.message);
      setSelectedId("");
      onMessage("Assessment template deleted.");
      await reload();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy("");
    }
  };

  const saveComponent = async (id) => {
    const draft = drafts[id];
    const problem = validate(draft);
    if (problem) return onError(problem);

    setBusy(`component-${id}`);
    onMessage("");
    onError("");
    try {
      const { error } = await supabase
        .from("assessment_template_components")
        .update(payloadFor(draft))
        .eq("id", id);
      if (error) throw new Error(error.message);
      onMessage("Component saved.");
      await reload();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy("");
    }
  };

  const addComponent = async () => {
    if (!selected) return;
    const problem = validate(componentForm);
    if (problem) return onError(problem);

    setBusy("component-add");
    onMessage("");
    onError("");
    try {
      const { error } = await supabase
        .from("assessment_template_components")
        .insert({ ...payloadFor(componentForm), template_id: selected.id });
      if (error) throw new Error(error.message);
      setComponentForm((current) => ({
        ...EMPTY_COMPONENT,
        display_order: String(Number(current.display_order || 1) + 1),
      }));
      onMessage("Component added.");
      await reload();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy("");
    }
  };

  const deleteComponent = async (id) => {
    if (!window.confirm("Delete this component from the template?")) return;
    setBusy(`component-${id}`);
    onMessage("");
    onError("");
    try {
      const { error } = await supabase.from("assessment_template_components").delete().eq("id", id);
      if (error) throw new Error(error.message);
      onMessage("Component deleted.");
      await reload();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy("");
    }
  };

  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-(--foreground)">Assessment templates</p>
          <p className="mt-1 text-xs text-(--muted-foreground)">
            Configure a structure once, then apply it to every subject of that type.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Template">
            <Select
              value={creating ? "" : selectedId}
              onChange={(event) => {
                setCreating(false);
                setSelectedId(event.target.value);
                onMessage("");
                onError("");
              }}
              disabled={loading}
            >
              {creating ? <option value="">New template</option> : null}
              {templates.length === 0 && !creating ? <option value="">No templates yet</option> : null}
              {templates.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}, {subjectTypeLabel(row.subject_type)}
                  {row.is_default ? ", default" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="subtle" onClick={startNew} disabled={busy === "template"}>
            New template
          </Button>
        </div>
      </div>

      {!selected && !creating ? (
        <div className="mt-4">
          <Empty>No assessment template configured yet.</Empty>
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Name">
              <input
                className={inputClass}
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Theory, internal and ESA"
              />
            </Field>
            <Field label="Subject type">
              <Select
                value={form.subject_type}
                onChange={(event) => setForm((current) => ({ ...current, subject_type: event.target.value }))}
              >
                {SUBJECT_TYPES.map((type) => (
                  <option key={type.id} value={type.id}>{type.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Mode">
              <Select
                value={form.mode}
                onChange={(event) => setForm((current) => ({ ...current, mode: event.target.value }))}
              >
                {TEMPLATE_MODES.map((mode) => (
                  <option key={mode.id} value={mode.id}>{mode.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Total marks">
              <input
                type="number"
                className={`${inputClass} tabular-nums`}
                value={form.total_marks}
                onChange={(event) => setForm((current) => ({ ...current, total_marks: event.target.value }))}
              />
            </Field>
            <Field label="Description">
              <input
                className={inputClass}
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="What this structure covers"
              />
            </Field>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={saveTemplate} disabled={busy === "template"}>
              {busy === "template" ? "Saving" : creating ? "Create template" : "Save template"}
            </Button>
            {selected ? (
              <>
                <Button variant="subtle" onClick={makeDefault} disabled={busy === "default"}>
                  {selected.is_default ? "Remove default" : "Make default"}
                </Button>
                <Button variant="danger" onClick={deleteTemplate} disabled={busy === "delete"}>
                  Delete template
                </Button>
                {selected.is_default ? (
                  <span className="text-[11px] text-(--muted-foreground)">
                    Default for {subjectTypeLabel(selected.subject_type).toLowerCase()} subjects.
                  </span>
                ) : null}
              </>
            ) : null}
          </div>

          {selected ? (
            <>
              <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-(--foreground)">Components</p>
                  <p className="mt-1 text-xs text-(--muted-foreground)">
                    Contribution is the mark the component adds to the subject total. Averaged
                    components share one group total; scaled components convert a source mark into
                    a target mark.
                  </p>
                </div>
                <p
                  className={`text-xs tabular-nums ${
                    totalMatches ? "text-(--success)" : "text-(--danger)"
                  }`}
                >
                  Contributes {numberText(contributionTotal)} of {numberText(totalTarget)}
                  {totalMatches ? "" : ", totals must match before the template can be applied"}
                </p>
              </div>

              {groups.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-(--muted-foreground) tabular-nums">
                  {groups.map((group) => (
                    <li key={group.code}>
                      Group {group.code} averages {group.count} component
                      {group.count === 1 ? "" : "s"} out of {numberText(group.max)}, contributes{" "}
                      {numberText(group.weight)}
                    </li>
                  ))}
                </ul>
              ) : null}

              {rows.length === 0 ? (
                <div className="mt-3">
                  <Empty>This template has no components yet.</Empty>
                </div>
              ) : (
                <div className="mt-3 overflow-x-auto rounded-xl border border-(--border-subtle)">
                  <table className="min-w-full text-left text-xs tabular-nums">
                    <thead className="bg-(--surface-secondary)">
                      <tr className="border-b border-(--border-subtle)">
                        {[
                          "Name",
                          "Code",
                          "Type",
                          "Full marks",
                          "Contribution",
                          "Aggregation",
                          "Group",
                          "From",
                          "To",
                          "Order",
                          "Optional",
                          "External",
                          "",
                        ].map((label) => (
                          <th key={label} className="px-15 py-2 font-medium text-(--muted-foreground)">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const draft = drafts[row.id] ?? draftFor(row);
                        const scaled = draft.aggregation === "scaled";
                        return (
                          <tr key={row.id} className="border-b border-(--border-subtle)/60 last:border-b-0">
                            <td className="px-3 py-2">
                              <input
                                className={`${inputClass} w-36`}
                                value={draft.name}
                                onChange={(event) => setDraft(row.id, "name", event.target.value)}
                                aria-label={`Name for ${row.name}`}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                className={`${inputClass} w-24`}
                                value={draft.code}
                                onChange={(event) => setDraft(row.id, "code", event.target.value)}
                                aria-label={`Code for ${row.name}`}
                                placeholder="IA1"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Select
                                value={draft.component_type}
                                onChange={(event) => setDraft(row.id, "component_type", event.target.value)}
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
                                className={`${inputClass} w-20`}
                                value={draft.max_marks}
                                onChange={(event) => setDraft(row.id, "max_marks", event.target.value)}
                                aria-label={`Full marks for ${row.name}`}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                className={`${inputClass} w-20`}
                                value={scaled ? draft.scale_to : draft.weight_percent}
                                onChange={(event) =>
                                  scaled
                                    ? changeScaleTo(row.id, event.target.value)
                                    : setDraft(row.id, "weight_percent", event.target.value)
                                }
                                aria-label={`Contribution for ${row.name}`}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Select
                                value={draft.aggregation}
                                onChange={(event) => changeAggregation(row.id, event.target.value)}
                                aria-label={`Aggregation for ${row.name}`}
                              >
                                {AGGREGATIONS.map((option) => (
                                  <option key={option.id} value={option.id}>{option.label}</option>
                                ))}
                              </Select>
                            </td>
                            <td className="px-3 py-2">
                              <input
                                className={`${inputClass} w-16`}
                                value={draft.group_code}
                                onChange={(event) => setDraft(row.id, "group_code", event.target.value)}
                                disabled={draft.aggregation !== "average"}
                                aria-label={`Group for ${row.name}`}
                                placeholder="IA"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                className={`${inputClass} w-20`}
                                value={draft.scale_from}
                                onChange={(event) => setDraft(row.id, "scale_from", event.target.value)}
                                disabled={!scaled}
                                aria-label={`Scale source for ${row.name}`}
                                placeholder={scaled ? "" : "n/a"}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                className={`${inputClass} w-20`}
                                value={draft.scale_to}
                                onChange={(event) => changeScaleTo(row.id, event.target.value)}
                                disabled={!scaled}
                                aria-label={`Scale target for ${row.name}`}
                                placeholder={scaled ? "" : "n/a"}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                className={`${inputClass} w-16`}
                                value={draft.display_order}
                                onChange={(event) => setDraft(row.id, "display_order", event.target.value)}
                                aria-label={`Order for ${row.name}`}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-(--primary)"
                                checked={draft.is_optional}
                                onChange={(event) => setDraft(row.id, "is_optional", event.target.checked)}
                                aria-label={`Optional for ${row.name}`}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-(--primary)"
                                checked={draft.is_external}
                                onChange={(event) => setDraft(row.id, "is_external", event.target.checked)}
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

              <div className="mt-4 rounded-xl border border-(--border-subtle) p-3">
                <p className="text-xs font-medium text-(--foreground)">Add a component</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Name">
                    <input
                      className={inputClass}
                      value={componentForm.name}
                      onChange={(event) =>
                        setComponentForm((current) => ({ ...current, name: event.target.value }))
                      }
                      placeholder="Quiz"
                    />
                  </Field>
                  <Field label="Code">
                    <input
                      className={inputClass}
                      value={componentForm.code}
                      onChange={(event) =>
                        setComponentForm((current) => ({ ...current, code: event.target.value }))
                      }
                      placeholder="QUIZ"
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
                      className={`${inputClass} tabular-nums`}
                      value={componentForm.max_marks}
                      onChange={(event) =>
                        setComponentForm((current) => ({ ...current, max_marks: event.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Contribution">
                    <input
                      type="number"
                      className={`${inputClass} tabular-nums`}
                      value={
                        componentForm.aggregation === "scaled"
                          ? componentForm.scale_to
                          : componentForm.weight_percent
                      }
                      onChange={(event) =>
                        setComponentForm((current) =>
                          current.aggregation === "scaled"
                            ? { ...current, scale_to: event.target.value, weight_percent: event.target.value }
                            : { ...current, weight_percent: event.target.value },
                        )
                      }
                    />
                  </Field>
                  <Field label="Aggregation">
                    <Select
                      value={componentForm.aggregation}
                      onChange={(event) => {
                        const value = event.target.value;
                        setComponentForm((current) => {
                          const next = { ...current, aggregation: value };
                          if (value === "scaled") {
                            next.scale_from = current.scale_from || current.max_marks;
                            next.scale_to = current.scale_to || current.weight_percent || current.max_marks;
                            next.weight_percent = next.scale_to;
                          }
                          if (value === "average" && !current.group_code) next.group_code = "IA";
                          return next;
                        });
                      }}
                    >
                      {AGGREGATIONS.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Group">
                    <input
                      className={inputClass}
                      value={componentForm.group_code}
                      onChange={(event) =>
                        setComponentForm((current) => ({ ...current, group_code: event.target.value }))
                      }
                      disabled={componentForm.aggregation !== "average"}
                      placeholder="IA"
                    />
                  </Field>
                  <Field label="Order">
                    <input
                      type="number"
                      className={`${inputClass} tabular-nums`}
                      value={componentForm.display_order}
                      onChange={(event) =>
                        setComponentForm((current) => ({ ...current, display_order: event.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Scale from">
                    <input
                      type="number"
                      className={`${inputClass} tabular-nums`}
                      value={componentForm.scale_from}
                      onChange={(event) =>
                        setComponentForm((current) => ({ ...current, scale_from: event.target.value }))
                      }
                      disabled={componentForm.aggregation !== "scaled"}
                    />
                  </Field>
                  <Field label="Scale to">
                    <input
                      type="number"
                      className={`${inputClass} tabular-nums`}
                      value={componentForm.scale_to}
                      onChange={(event) =>
                        setComponentForm((current) => ({
                          ...current,
                          scale_to: event.target.value,
                          weight_percent: event.target.value,
                        }))
                      }
                      disabled={componentForm.aggregation !== "scaled"}
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
                </div>
                <div className="mt-3">
                  <Button variant="subtle" onClick={addComponent} disabled={busy === "component-add"}>
                    {busy === "component-add" ? "Adding" : "Add component"}
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </>
      )}
    </Card>
  );
};

export default AssessmentTemplateEditor;
