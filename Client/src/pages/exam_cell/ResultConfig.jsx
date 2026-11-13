import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Button, Card, Empty, Field, SearchField, Select, inputClass } from "../../components/ui";
import DashboardHeader from "../../components/dashboard/DashboardHeader";

const DEFAULT_FORMAT = {
  title: "Grade Card",
  show_credits: true,
  show_grade_points: true,
  show_percentage: true,
  show_sgpa: true,
  show_cgpa: true,
  show_reference_table: true,
  show_formulas: true,
  footer: "",
  signatory: "Controller of Examinations",
};

const EMPTY_BAND = {
  label: "",
  min_percent: "",
  max_percent: "",
  grade_point: "",
  is_pass: true,
  display_order: "1",
};

const numberOrNull = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isNaN(numeric) ? null : numeric;
};

const ResultConfig = () => {
  const [schemes, setSchemes] = useState([]);
  const [bands, setBands] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [schemeId, setSchemeId] = useState("");

  const [format, setFormat] = useState(DEFAULT_FORMAT);
  const [schemeConfig, setSchemeConfig] = useState({
    theory_pass_percent: "40",
    lab_pass_percent: "45",
  });
  const [promotion, setPromotion] = useState({
    max_backlogs: "2",
    min_sgpa: "",
    min_credit_percent: "",
  });
  const [bandForm, setBandForm] = useState(EMPTY_BAND);
  const [bandDrafts, setBandDrafts] = useState({});
  const [subjectDrafts, setSubjectDrafts] = useState({});
  const [newScheme, setNewScheme] = useState("");
  const [subjectSearch, setSubjectSearch] = useState("");
  const [bulkCredit, setBulkCredit] = useState("");
  const [bulkType, setBulkType] = useState("any");
  const [bulkScope, setBulkScope] = useState("missing");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadSettings = async () => {
    const { data, error: settingsError } = await supabase
      .from("institution_settings")
      .select("name, short_name, default_grading_scheme_id, result_format, promotion_rules")
      .maybeSingle();
    if (settingsError) throw new Error(settingsError.message);
    setFormat({ ...DEFAULT_FORMAT, ...(data?.result_format ?? {}) });
    const rules = data?.promotion_rules ?? {};
    setPromotion({
      max_backlogs: rules.max_backlogs == null ? "2" : String(rules.max_backlogs),
      min_sgpa: rules.min_sgpa == null ? "" : String(rules.min_sgpa),
      min_credit_percent:
        rules.min_credit_percent == null ? "" : String(rules.min_credit_percent),
    });
    return data;
  };

  const loadSchemes = async () => {
    const { data, error: schemesError } = await supabase
      .from("grading_schemes")
      .select("id, name, is_default, theory_pass_percent, lab_pass_percent, created_at")
      .order("created_at");
    if (schemesError) throw new Error(schemesError.message);
    setSchemes(data ?? []);
    return data ?? [];
  };

  const applySchemeConfig = (rows, id) => {
    const row = rows.find((item) => item.id === id);
    setSchemeConfig({
      theory_pass_percent: row?.theory_pass_percent == null ? "40" : String(row.theory_pass_percent),
      lab_pass_percent: row?.lab_pass_percent == null ? "45" : String(row.lab_pass_percent),
    });
  };

  const loadBands = async (id) => {
    if (!id) {
      setBands([]);
      setBandDrafts({});
      return;
    }
    const { data, error: bandsError } = await supabase
      .from("grade_bands")
      .select("id, scheme_id, label, min_percent, max_percent, grade_point, is_pass, display_order")
      .eq("scheme_id", id)
      .order("display_order");
    if (bandsError) throw new Error(bandsError.message);
    setBands(data ?? []);
    setBandDrafts(
      Object.fromEntries(
        (data ?? []).map((row) => [
          row.id,
          {
            label: row.label,
            min_percent: String(row.min_percent ?? ""),
            max_percent: String(row.max_percent ?? ""),
            grade_point: row.grade_point == null ? "" : String(row.grade_point),
            is_pass: row.is_pass,
            display_order: String(row.display_order ?? 1),
          },
        ]),
      ),
    );
  };

  const loadSubjects = async () => {
    const { data, error: subjectsError } = await supabase
      .from("subjects")
      .select("id, name, code, max_marks, credit_hours, subject_type, departments ( name )")
      .order("code");
    if (subjectsError) throw new Error(subjectsError.message);
    setSubjects(data ?? []);
    setSubjectDrafts(
      Object.fromEntries(
        (data ?? []).map((row) => [
          row.id,
          {
            max_marks: String(row.max_marks ?? ""),
            credit_hours: row.credit_hours == null ? "" : String(row.credit_hours),
            subject_type: row.subject_type ?? "theory",
          },
        ]),
      ),
    );
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [data, schemeRows] = await Promise.all([loadSettings(), loadSchemes()]);
        if (cancelled) return;
        const active =
          data?.default_grading_scheme_id ??
          schemeRows.find((row) => row.is_default)?.id ??
          schemeRows[0]?.id ??
          "";
        setSchemeId(active);
        applySchemeConfig(schemeRows, active);
        await loadBands(active);
        await loadSubjects();
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeScheme = useMemo(
    () => schemes.find((row) => row.id === schemeId) ?? null,
    [schemes, schemeId],
  );

  const changeScheme = async (id, rows = schemes) => {
    setSchemeId(id);
    setError("");
    setMessage("");
    try {
      applySchemeConfig(rows, id);
      await loadBands(id);
      const { error: saveError } = await supabase
        .from("institution_settings")
        .update({ default_grading_scheme_id: id || null })
        .eq("id", true);
      if (saveError) throw new Error(saveError.message);
      setMessage("Active grading scheme updated.");
      await loadSettings();
    } catch (err) {
      setError(err.message);
    }
  };

  const saveFormat = async () => {
    setBusy("format");
    setError("");
    setMessage("");
    try {
      const { error: saveError } = await supabase
        .from("institution_settings")
        .update({ result_format: format })
        .eq("id", true);
      if (saveError) throw new Error(saveError.message);
      setMessage("Result format saved.");
      await loadSettings();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const saveSchemeConfig = async () => {
    if (!schemeId) {
      setError("Select a grading scheme first.");
      return;
    }
    const theory = numberOrNull(schemeConfig.theory_pass_percent);
    const lab = numberOrNull(schemeConfig.lab_pass_percent);
    if (theory === null || theory < 0 || theory > 100) {
      setError("Theory pass percentage must sit between 0 and 100.");
      return;
    }
    if (lab === null || lab < 0 || lab > 100) {
      setError("Lab pass percentage must sit between 0 and 100.");
      return;
    }
    setBusy("scheme-config");
    setError("");
    setMessage("");
    try {
      const { error: updateError } = await supabase
        .from("grading_schemes")
        .update({ theory_pass_percent: theory, lab_pass_percent: lab })
        .eq("id", schemeId);
      if (updateError) throw new Error(updateError.message);
      const rows = await loadSchemes();
      applySchemeConfig(rows, schemeId);
      setMessage("Pass thresholds saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const savePromotion = async () => {
    const maxBacklogs = numberOrNull(promotion.max_backlogs);
    const minSgpa = numberOrNull(promotion.min_sgpa);
    const minCreditPercent = numberOrNull(promotion.min_credit_percent);
    if (maxBacklogs === null || maxBacklogs < 0) {
      setError("Maximum allowed backlogs must be zero or more.");
      return;
    }
    if (minSgpa !== null && (minSgpa < 0 || minSgpa > 10)) {
      setError("Minimum SGPA must sit between 0 and 10.");
      return;
    }
    if (minCreditPercent !== null && (minCreditPercent < 0 || minCreditPercent > 100)) {
      setError("Minimum credit percentage must sit between 0 and 100.");
      return;
    }
    setBusy("promotion");
    setError("");
    setMessage("");
    try {
      const { error: updateError } = await supabase
        .from("institution_settings")
        .update({
          promotion_rules: {
            max_backlogs: maxBacklogs,
            min_sgpa: minSgpa,
            min_credit_percent: minCreditPercent,
          },
        })
        .eq("id", true);
      if (updateError) throw new Error(updateError.message);
      setMessage("Promotion rules saved.");
      await loadSettings();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const createScheme = async () => {
    const name = newScheme.trim();
    if (!name) {
      setError("Enter a grading scheme name.");
      return;
    }
    setBusy("scheme");
    setError("");
    setMessage("");
    try {
      const { data, error: insertError } = await supabase
        .from("grading_schemes")
        .insert({ name, is_default: false })
        .select("id")
        .single();
      if (insertError) throw new Error(insertError.message);
      setNewScheme("");
      const rows = await loadSchemes();
      setMessage(`Grading scheme "${name}" created. Select it to add grade bands.`);
      if (data?.id) await changeScheme(data.id, rows);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const addBand = async () => {
    if (!schemeId) {
      setError("Select a grading scheme first.");
      return;
    }
    const min = numberOrNull(bandForm.min_percent);
    const max = numberOrNull(bandForm.max_percent);
    if (!bandForm.label.trim() || min === null || max === null) {
      setError("A grade band needs a label, a minimum and a maximum percentage.");
      return;
    }
    if (min < 0 || max > 100 || max <= min) {
      setError("Grade band range must sit between 0 and 100, with the maximum above the minimum.");
      return;
    }
    setBusy("band-add");
    setError("");
    setMessage("");
    try {
      const { error: insertError } = await supabase.from("grade_bands").insert({
        scheme_id: schemeId,
        label: bandForm.label.trim(),
        min_percent: min,
        max_percent: max,
        grade_point: numberOrNull(bandForm.grade_point),
        is_pass: bandForm.is_pass,
        display_order: numberOrNull(bandForm.display_order) ?? 1,
      });
      if (insertError) throw new Error(insertError.message);
      setBandForm(EMPTY_BAND);
      await loadBands(schemeId);
      setMessage("Grade band added.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const saveBand = async (id) => {
    const draft = bandDrafts[id];
    const min = numberOrNull(draft?.min_percent);
    const max = numberOrNull(draft?.max_percent);
    if (!draft?.label?.trim() || min === null || max === null || max <= min) {
      setError("Check the grade band label and percentage range before saving.");
      return;
    }
    setBusy(`band-${id}`);
    setError("");
    setMessage("");
    try {
      const { error: updateError } = await supabase
        .from("grade_bands")
        .update({
          label: draft.label.trim(),
          min_percent: min,
          max_percent: max,
          grade_point: numberOrNull(draft.grade_point),
          is_pass: draft.is_pass,
          display_order: numberOrNull(draft.display_order) ?? 1,
        })
        .eq("id", id);
      if (updateError) throw new Error(updateError.message);
      await loadBands(schemeId);
      setMessage("Grade band updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const deleteBand = async (id) => {
    if (!window.confirm("Delete this grade band? Historical results keep their recorded grade.")) return;
    setBusy(`band-${id}`);
    setError("");
    setMessage("");
    try {
      const { error: deleteError } = await supabase.from("grade_bands").delete().eq("id", id);
      if (deleteError) throw new Error(deleteError.message);
      await loadBands(schemeId);
      setMessage("Grade band deleted.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const saveSubject = async (id) => {
    const draft = subjectDrafts[id];
    const max = numberOrNull(draft?.max_marks);
    const credit = numberOrNull(draft?.credit_hours);
    const subjectType = draft?.subject_type ?? "theory";
    if (max === null || max <= 0) {
      setError("Subject full marks must be greater than zero.");
      return;
    }
    if (credit !== null && credit < 0) {
      setError("Credit hours cannot be negative.");
      return;
    }
    if (!["theory", "lab", "project"].includes(subjectType)) {
      setError("Choose a valid subject type.");
      return;
    }
    setBusy(`subject-${id}`);
    setError("");
    setMessage("");
    try {
      const { error: updateError } = await supabase
        .from("subjects")
        .update({ max_marks: max, credit_hours: credit, subject_type: subjectType })
        .eq("id", id);
      if (updateError) throw new Error(updateError.message);
      await loadSubjects();
      setMessage("Subject configuration saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const visibleSubjects = subjects.filter((row) => {
    const needle = subjectSearch.trim().toLowerCase();
    if (!needle) return true;
    return [row.code, row.name, row.departments?.name]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
  });

  const subjectsMissingCredits = useMemo(
    () => subjects.filter((row) => row.credit_hours == null).length,
    [subjects],
  );

  const bulkMatches = useMemo(
    () =>
      subjects.filter((row) => {
        if (bulkType !== "any" && (row.subject_type ?? "theory") !== bulkType) return false;
        if (bulkScope === "missing" && row.credit_hours != null) return false;
        return true;
      }),
    [subjects, bulkType, bulkScope],
  );

  const applyBulkCredits = async () => {
    const credit = numberOrNull(bulkCredit);
    if (credit === null || credit < 0) {
      setError("Enter a credit value of zero or more.");
      return;
    }
    if (bulkMatches.length === 0) {
      setError("No subjects match that filter.");
      return;
    }
    setBusy("bulk-credits");
    setError("");
    setMessage("");
    try {
      let query = supabase.from("subjects").update({ credit_hours: credit });
      if (bulkType !== "any") query = query.eq("subject_type", bulkType);
      if (bulkScope === "missing") query = query.is("credit_hours", null);
      const { error: updateError } = await query;
      if (updateError) throw new Error(updateError.message);
      await loadSubjects();
      setMessage(
        `Credit hours set for ${bulkMatches.length} subject${bulkMatches.length === 1 ? "" : "s"}.`,
      );
      setBulkCredit("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const setFormatValue = (key, value) => setFormat((current) => ({ ...current, [key]: value }));

  const setBandValue = (id, key, value) =>
    setBandDrafts((current) => ({ ...current, [id]: { ...current[id], [key]: value } }));

  const setSubjectValue = (id, key, value) =>
    setSubjectDrafts((current) => ({ ...current, [id]: { ...current[id], [key]: value } }));

  return (
    <>
      <DashboardHeader
        title="Result configuration"
        subtitle="Configure result format, grading schemes, grade bands, full marks and credits."
      />

      {loading ? (
        <div className="mt-6 space-y-3" aria-hidden="true">
          {[0, 1, 2].map((key) => (
            <div key={key} className="glass-inner h-40 motion-safe:animate-pulse rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {message ? <p role="status" className="mt-4 text-xs text-(--success)">{message}</p> : null}
          {error ? <p role="alert" className="mt-4 text-xs text-(--danger)">{error}</p> : null}

          <Card className="mt-6">
            <p className="text-sm font-medium text-(--foreground)">Result format</p>
            <p className="mt-1 text-xs text-(--muted-foreground)">
              These settings drive the student result page and every printed result document.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Document title">
                <input
                  className={inputClass}
                  value={format.title}
                  onChange={(event) => setFormatValue("title", event.target.value)}
                />
              </Field>
              <Field label="Signatory">
                <input
                  className={inputClass}
                  value={format.signatory}
                  onChange={(event) => setFormatValue("signatory", event.target.value)}
                />
              </Field>
              <Field label="Footer note">
                <input
                  className={inputClass}
                  value={format.footer}
                  onChange={(event) => setFormatValue("footer", event.target.value)}
                  placeholder="Optional note printed at the foot of the document"
                />
              </Field>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["show_sgpa", "Show SGPA"],
                ["show_cgpa", "Show CGPA"],
                ["show_reference_table", "Show grade reference"],
                ["show_formulas", "Show formulae"],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-xs text-(--foreground)">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-(--primary)"
                    checked={Boolean(format[key])}
                    onChange={(event) => setFormatValue(key, event.target.checked)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="mt-4">
              <Button onClick={saveFormat} disabled={busy === "format"}>
                {busy === "format" ? "Saving" : "Save result format"}
              </Button>
            </div>
          </Card>

          <Card className="mt-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-(--foreground)">Grading scheme</p>
                <p className="mt-1 text-xs text-(--muted-foreground)">
                  The active scheme supplies grade labels, grade points and pass rules for new compilations.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Active scheme">
                  <Select value={schemeId} onChange={(event) => changeScheme(event.target.value)}>
                    <option value="">No active scheme</option>
                    {schemes.map((row) => (
                      <option key={row.id} value={row.id}>{row.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="New scheme">
                  <input
                    className={inputClass}
                    value={newScheme}
                    onChange={(event) => setNewScheme(event.target.value)}
                    placeholder="Scheme name"
                  />
                </Field>
                <Button variant="subtle" onClick={createScheme} disabled={busy === "scheme"}>
                  {busy === "scheme" ? "Creating" : "Create scheme"}
                </Button>
              </div>
            </div>

            <p className="mt-4 text-xs text-(--muted-foreground)">
              {activeScheme
                ? `Configuring grade bands for ${activeScheme.name}.`
                : "Select or create a scheme to configure grade bands."}
            </p>

            {schemeId ? (
              <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-(--border-subtle) p-3">
                <Field label="Theory pass %">
                  <input
                    type="number"
                    className={`${inputClass} w-28 tabular-nums`}
                    value={schemeConfig.theory_pass_percent}
                    onChange={(event) =>
                      setSchemeConfig((current) => ({
                        ...current,
                        theory_pass_percent: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Lab pass %">
                  <input
                    type="number"
                    className={`${inputClass} w-28 tabular-nums`}
                    value={schemeConfig.lab_pass_percent}
                    onChange={(event) =>
                      setSchemeConfig((current) => ({
                        ...current,
                        lab_pass_percent: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Button
                  variant="subtle"
                  onClick={saveSchemeConfig}
                  disabled={busy === "scheme-config"}
                >
                  {busy === "scheme-config" ? "Saving" : "Save pass thresholds"}
                </Button>
                <p className="w-full text-[11px] text-(--muted-foreground)">
                  A subject below its pass percentage is graded F with zero points, even when the
                  grade band would otherwise pass.
                </p>
              </div>
            ) : null}

            {schemeId ? (
              <>
                <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-(--border-subtle) p-3">
                  <Field label="Label">
                    <input
                      className={`${inputClass} w-24`}
                      value={bandForm.label}
                      onChange={(event) => setBandForm((current) => ({ ...current, label: event.target.value }))}
                      placeholder="A"
                    />
                  </Field>
                  <Field label="Min %">
                    <input
                      type="number"
                      className={`${inputClass} w-24 tabular-nums`}
                      value={bandForm.min_percent}
                      onChange={(event) => setBandForm((current) => ({ ...current, min_percent: event.target.value }))}
                    />
                  </Field>
                  <Field label="Max %">
                    <input
                      type="number"
                      className={`${inputClass} w-24 tabular-nums`}
                      value={bandForm.max_percent}
                      onChange={(event) => setBandForm((current) => ({ ...current, max_percent: event.target.value }))}
                    />
                  </Field>
                  <Field label="Grade point">
                    <input
                      type="number"
                      className={`${inputClass} w-24 tabular-nums`}
                      value={bandForm.grade_point}
                      onChange={(event) => setBandForm((current) => ({ ...current, grade_point: event.target.value }))}
                    />
                  </Field>
                  <Field label="Order">
                    <input
                      type="number"
                      className={`${inputClass} w-20 tabular-nums`}
                      value={bandForm.display_order}
                      onChange={(event) => setBandForm((current) => ({ ...current, display_order: event.target.value }))}
                    />
                  </Field>
                  <label className="flex items-center gap-2 pb-2 text-xs text-(--foreground)">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-(--primary)"
                      checked={bandForm.is_pass}
                      onChange={(event) => setBandForm((current) => ({ ...current, is_pass: event.target.checked }))}
                    />
                    Counts as pass
                  </label>
                  <Button variant="subtle" onClick={addBand} disabled={busy === "band-add"}>
                    {busy === "band-add" ? "Adding" : "Add band"}
                  </Button>
                </div>

                {bands.length === 0 ? (
                  <div className="mt-3">
                    <Empty>No grade bands yet. Add the first band above.</Empty>
                  </div>
                ) : (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-(--border-subtle)">
                    <table className="min-w-full text-left text-xs tabular-nums">
                      <thead className="bg-(--surface-secondary)">
                        <tr className="border-b border-(--border-subtle)">
                          {["Label", "Min %", "Max %", "Grade point", "Order", "Pass", ""].map((label) => (
                            <th key={label} className="px-3 py-2 font-medium text-(--muted-foreground)">{label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {bands.map((row) => {
                          const draft = bandDrafts[row.id] ?? {};
                          return (
                            <tr key={row.id} className="border-b border-(--border-subtle)/60 last:border-b-0">
                              <td className="px-3 py-2">
                                <input
                                  className={`${inputClass} w-24`}
                                  value={draft.label ?? ""}
                                  onChange={(event) => setBandValue(row.id, "label", event.target.value)}
                                  aria-label={`Label for grade band ${row.label}`}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  className={`${inputClass} w-24`}
                                  value={draft.min_percent ?? ""}
                                  onChange={(event) => setBandValue(row.id, "min_percent", event.target.value)}
                                  aria-label={`Minimum percentage for grade band ${row.label}`}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  className={`${inputClass} w-24`}
                                  value={draft.max_percent ?? ""}
                                  onChange={(event) => setBandValue(row.id, "max_percent", event.target.value)}
                                  aria-label={`Maximum percentage for grade band ${row.label}`}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  className={`${inputClass} w-24`}
                                  value={draft.grade_point ?? ""}
                                  onChange={(event) => setBandValue(row.id, "grade_point", event.target.value)}
                                  aria-label={`Grade point for grade band ${row.label}`}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  className={`${inputClass} w-20`}
                                  value={draft.display_order ?? ""}
                                  onChange={(event) => setBandValue(row.id, "display_order", event.target.value)}
                                  aria-label={`Display order for grade band ${row.label}`}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 accent-(--primary)"
                                  checked={Boolean(draft.is_pass)}
                                  onChange={(event) => setBandValue(row.id, "is_pass", event.target.checked)}
                                  aria-label={`Counts as pass for grade band ${row.label}`}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex justify-end gap-2">
                                  <Button variant="subtle" onClick={() => saveBand(row.id)} disabled={busy === `band-${row.id}`}>
                                    Save
                                  </Button>
                                  <Button variant="danger" onClick={() => deleteBand(row.id)} disabled={busy === `band-${row.id}`}>
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
              </>
            ) : null}
          </Card>

          <Card className="mt-4">
            <p className="text-sm font-medium text-(--foreground)">Promotion rules</p>
            <p className="mt-1 text-xs text-(--muted-foreground)">
              These thresholds decide the result code. A student within the backlog limit passes with
              backlog (XP); a student beyond it is not promoted (X).
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Field label="Maximum allowed backlogs">
                <input
                  type="number"
                  className={`${inputClass} tabular-nums`}
                  value={promotion.max_backlogs}
                  onChange={(event) =>
                    setPromotion((current) => ({ ...current, max_backlogs: event.target.value }))
                  }
                />
              </Field>
              <Field label="Minimum SGPA (optional)">
                <input
                  type="number"
                  step="0.01"
                  className={`${inputClass} tabular-nums`}
                  value={promotion.min_sgpa}
                  onChange={(event) =>
                    setPromotion((current) => ({ ...current, min_sgpa: event.target.value }))
                  }
                  placeholder="No minimum"
                />
              </Field>
              <Field label="Minimum credit percent (optional)">
                <input
                  type="number"
                  step="0.01"
                  className={`${inputClass} tabular-nums`}
                  value={promotion.min_credit_percent}
                  onChange={(event) =>
                    setPromotion((current) => ({
                      ...current,
                      min_credit_percent: event.target.value,
                    }))
                  }
                  placeholder="No minimum"
                />
              </Field>
            </div>
            <div className="mt-4">
              <Button onClick={savePromotion} disabled={busy === "promotion"}>
                {busy === "promotion" ? "Saving" : "Save promotion rules"}
              </Button>
            </div>
          </Card>

          <Card className="mt-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-(--foreground)">Subject full marks and credits</p>
                <p className="mt-1 text-xs text-(--muted-foreground)">
                  Full marks feed the percentage calculation. Credit hours feed SGPA and CGPA.
                </p>
              </div>
              <SearchField
                label="Search subjects"
                value={subjectSearch}
                onChange={setSubjectSearch}
                placeholder="Code, subject or department"
              />
            </div>

            <div className="mt-4 rounded-xl border border-(--border-subtle) bg-(--surface-secondary)/60 p-3">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Bulk credit hours">
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    className={`${inputClass} w-28 tabular-nums`}
                    value={bulkCredit}
                    onChange={(event) => setBulkCredit(event.target.value)}
                    placeholder="e.g. 3"
                  />
                </Field>
                <Field label="Subject type">
                  <Select
                    value={bulkType}
                    onChange={(event) => setBulkType(event.target.value)}
                    aria-label="Bulk subject type filter"
                  >
                    <option value="any">Any type</option>
                    <option value="theory">Theory</option>
                    <option value="lab">Lab</option>
                    <option value="project">Project</option>
                  </Select>
                </Field>
                <Field label="Apply to">
                  <Select
                    value={bulkScope}
                    onChange={(event) => setBulkScope(event.target.value)}
                    aria-label="Bulk credit scope"
                  >
                    <option value="missing">Subjects missing credits</option>
                    <option value="all">All matching subjects</option>
                  </Select>
                </Field>
                <Button
                  variant="subtle"
                  onClick={applyBulkCredits}
                  disabled={busy === "bulk-credits" || bulkMatches.length === 0}
                >
                  {busy === "bulk-credits"
                    ? "Applying"
                    : `Set credits for ${bulkMatches.length}`}
                </Button>
              </div>
              <p className="mt-2 text-xs text-(--muted-foreground)">
                {subjectsMissingCredits === 0
                  ? "Every subject has credit hours."
                  : `${subjectsMissingCredits} of ${subjects.length} subjects still need credit hours.`}{" "}
                Results cannot be approved until every subject on a sheet has credits.
              </p>
            </div>

            {visibleSubjects.length === 0 ? (
              <div className="mt-3">
                <Empty>No subjects match this search.</Empty>
              </div>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-xl border border-(--border-subtle)">
                <table className="min-w-full text-left text-xs tabular-nums">
                  <thead className="bg-(--surface-secondary)">
                    <tr className="border-b border-(--border-subtle)">
                      {["Code", "Subject", "Department", "Type", "Full marks", "Credit hours", ""].map((label) => (
                        <th key={label} className="px-3 py-2 font-medium text-(--muted-foreground)">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSubjects.map((row) => {
                      const draft = subjectDrafts[row.id] ?? {};
                      return (
                        <tr key={row.id} className="border-b border-(--border-subtle)/60 last:border-b-0">
                          <td className="px-3 py-2 text-(--foreground)">{row.code}</td>
                          <td className="px-3 py-2 text-(--foreground)">{row.name}</td>
                          <td className="px-3 py-2 text-(--muted-foreground)">{row.departments?.name ?? "Not assigned"}</td>
                          <td className="px-3 py-2">
                            <Select
                              value={draft.subject_type ?? "theory"}
                              onChange={(event) => setSubjectValue(row.id, "subject_type", event.target.value)}
                              aria-label={`Subject type for ${row.code}`}
                            >
                              <option value="theory">Theory</option>
                              <option value="lab">Lab</option>
                              <option value="project">Project</option>
                            </Select>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              className={`${inputClass} w-28`}
                              value={draft.max_marks ?? ""}
                              onChange={(event) => setSubjectValue(row.id, "max_marks", event.target.value)}
                              aria-label={`Full marks for ${row.code}`}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              className={`${inputClass} w-28`}
                              value={draft.credit_hours ?? ""}
                              onChange={(event) => setSubjectValue(row.id, "credit_hours", event.target.value)}
                              aria-label={`Credit hours for ${row.code}`}
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button
                              variant="subtle"
                              onClick={() => saveSubject(row.id)}
                              disabled={busy === `subject-${row.id}`}
                            >
                              Save
                            </Button>
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
      )}
    </>
  );
};

export default ResultConfig;
