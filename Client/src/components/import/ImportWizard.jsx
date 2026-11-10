import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { Button, Card, Field, Select } from "../ui";
import { ACCEPT_ATTRIBUTE, MAX_FILE_BYTES, MAX_IMPORT_ROWS, parseFile } from "../../import/parseFile";
import { downloadImportReport, downloadImportTemplate } from "../../import/templates";
import { planRecords, summarizeOutcomes } from "../../import/plan";
import {
  REPORT_STATUS_LABEL,
  cellText,
  formatBytes,
  mapWithConcurrency,
  normHeader,
} from "../../import/schemaUtils";

const STEPS = [
  { id: "upload", label: "Upload" },
  { id: "map", label: "Match columns" },
  { id: "review", label: "Review" },
  { id: "confirm", label: "Confirm" },
  { id: "import", label: "Import" },
  { id: "report", label: "Report" },
];

const STRATEGY_COPY = {
  new: {
    label: "Import only new records",
    description: "Existing records and repeated rows are skipped. Nothing already in Gradia is overwritten.",
  },
  skip: {
    label: "Skip duplicates",
    description: "Rows that already exist are skipped and listed in the report. The rest are imported.",
  },
  update: {
    label: "Update existing records",
    description: "Existing records are updated with the values in the file. Repeated rows use the last occurrence.",
  },
};

function buildAutoMapping(module, headers) {
  const mapping = {};
  const used = new Set();
  for (const field of module.fields) {
    const candidates = [field.label, field.key, ...(field.aliases ?? [])].map(normHeader);
    const index = headers.findIndex(
      (header, position) => !used.has(position) && candidates.includes(normHeader(header)),
    );
    if (index !== -1) {
      mapping[field.key] = headers[index];
      used.add(index);
    }
  }
  return mapping;
}

function StatusPill({ status }) {
  const styles = {
    create: ["Ready", "border-(--success)/40 text-(--success)"],
    created: ["Imported", "border-(--success)/40 text-(--success)"],
    update: ["Update", "border-(--primary)/50 text-(--primary)"],
    updated: ["Updated", "border-(--primary)/50 text-(--primary)"],
    skip: ["Skip", "border-(--border) text-(--muted-foreground)"],
    skipped: ["Skipped", "border-(--border) text-(--muted-foreground)"],
    invalid: ["Invalid", "border-(--danger)/40 text-(--danger)"],
    failed: ["Failed", "border-(--danger)/40 text-(--danger)"],
  };
  const [label, className] = styles[status] ?? [status, "border-(--border) text-(--muted-foreground)"];
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}>
      {label}
    </span>
  );
}

function SummaryCard({ label, value, tone = "default" }) {
  const toneClass =
    tone === "success"
      ? "text-(--success)"
      : tone === "danger"
        ? "text-(--danger)"
        : tone === "primary"
          ? "text-(--primary)"
          : "text-(--foreground)";
  return (
    <div className="glass-inner rounded-xl p-3">
      <p className="text-[11px] font-medium text-(--muted-foreground)">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function Notice({ tone = "danger", children }) {
  const className =
    tone === "success"
      ? "border-(--success)/40 bg-(--success-subtle) text-(--success)"
      : tone === "warning"
        ? "border-(--primary)/40 bg-(--primary)/5 text-(--foreground)"
        : "border-(--danger)/40 bg-(--danger-subtle) text-(--danger)";
  return (
    <div role={tone === "success" ? "status" : "alert"} className={`rounded-lg border p-3 text-xs ${className}`}>
      {children}
    </div>
  );
}

export default function ImportWizard({ module, onClose, onComplete, defaults = {} }) {
  const [step, setStep] = useState("upload");
  const [context, setContext] = useState(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState("");
  const [contextVersion, setContextVersion] = useState(0);

  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMapping] = useState({});
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState(null);
  const [strategy, setStrategy] = useState(module.defaultStrategy ?? "new");
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [live, setLive] = useState({ created: 0, updated: 0, skipped: 0, failed: 0, invalid: 0 });
  const [results, setResults] = useState(null);
  const [wizardError, setWizardError] = useState("");
  const [downloading, setDownloading] = useState("");

  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const fileInputRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const runningRef = useRef(running);
  onCloseRef.current = onClose;
  runningRef.current = running;

  const sheet = parsed?.sheets?.[sheetIndex] ?? null;
  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const plan = useMemo(
    () => (prepared ? planRecords(prepared.records, prepared.existingMap, strategy) : null),
    [prepared, strategy],
  );
  const readyCount = plan ? plan.summary.create + plan.summary.update : 0;
  const blockedCount = plan ? plan.summary.invalid + plan.summary.failed : 0;

  useEffect(() => {
    let active = true;
    setContextLoading(true);
    setContextError("");
    module
      .loadContext()
      .then((loaded) => {
        if (active) setContext(loaded);
      })
      .catch((error) => {
        if (active) setContextError(error.message || "Could not load the Gradia reference data.");
      })
      .finally(() => {
        if (active) setContextLoading(false);
      });
    return () => {
      active = false;
    };
  }, [module, contextVersion]);

  useEffect(() => {
    if (!parsed) return;
    const current = parsed.sheets[sheetIndex];
    if (!current) return;
    setMapping(buildAutoMapping(module, current.headers));
  }, [parsed, sheetIndex, module]);

  useEffect(() => {
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !runningRef.current) {
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = panelRef.current?.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!nodes?.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    };
  }, []);

  const handleFile = async (nextFile) => {
    if (!nextFile) return;
    setParsing(true);
    setParseError("");
    setWizardError("");
    setParsed(null);
    setPrepared(null);
    setResults(null);
    setConfirmed(false);
    try {
      const result = await parseFile(nextFile);
      setFile(nextFile);
      setParsed(result);
      setSheetIndex(0);
    } catch (error) {
      setFile(null);
      setParseError(error.message || "The file could not be read.");
    } finally {
      setParsing(false);
    }
  };

  const mappingIssues = useMemo(() => {
    if (!sheet) return [];
    const issues = [];
    for (const field of module.fields) {
      if (field.required && !mapping[field.key]) {
        issues.push(`${field.label} is required but no column is mapped.`);
      }
    }
    const usage = new Map();
    for (const field of module.fields) {
      const header = mapping[field.key];
      if (!header) continue;
      usage.set(header, (usage.get(header) ?? 0) + 1);
    }
    for (const [header, count] of usage.entries()) {
      if (count > 1) issues.push(`The column "${header}" is mapped more than once.`);
    }
    return issues;
  }, [mapping, module.fields, sheet]);

  const unmappedHeaders = useMemo(() => {
    if (!sheet) return [];
    const used = new Set(Object.values(mapping).filter(Boolean));
    return sheet.headers.filter((header) => !used.has(header));
  }, [mapping, sheet]);

  const setFieldMapping = (key, header) => {
    setMapping((current) => ({ ...current, [key]: header }));
    setConfirmed(false);
  };

  const prepare = async () => {
    if (!sheet || !context) return;
    setPreparing(true);
    setWizardError("");
    setConfirmed(false);
    try {
      const headerIndex = new Map(sheet.headers.map((header, index) => [header, index]));
      const records = sheet.rows.map((row, index) => {
        const values = {};
        for (const field of module.fields) {
          const header = mapping[field.key];
          values[field.key] = header ? row[headerIndex.get(header)] ?? "" : "";
        }
        const resolved = module.resolveRow(values, context, index + 2, defaults);
        return { rowNumber: index + 2, values, ...resolved };
      });
      const candidates = records.filter((record) => !record.errors?.length);
      const existingMap = await module.findExisting(candidates, context, defaults);
      setPrepared({ records, existingMap });
      setStep("review");
    } catch (error) {
      setWizardError(error.message || "The file could not be checked.");
    } finally {
      setPreparing(false);
    }
  };

  const startImport = async () => {
    if (!plan || !context || readyCount === 0) return;
    setRunning(true);
    setStep("import");
    setWizardError("");
    setProgress({ done: 0, total: plan.records.length });
    setLive({ created: 0, updated: 0, skipped: 0, failed: 0, invalid: 0 });
    const outcomes = new Array(plan.records.length);

    await mapWithConcurrency(
      plan.records,
      module.concurrency ?? 4,
      async (record, index) => {
        let outcome;
        try {
          if (record.planStatus === "invalid") {
            outcome = { status: "invalid", message: record.reason };
          } else if (record.planStatus === "failed") {
            outcome = { status: "failed", message: record.reason };
          } else if (record.action === "skip") {
            outcome = { status: "skipped", message: record.reason };
          } else {
            const response = await module.execute({
              mode: record.action,
              data: record.data,
              existing: record.existing,
              context,
              record,
            });
            outcome = {
              status: response?.status ?? (record.action === "update" ? "updated" : "created"),
              message: response?.message ?? "",
              meta: response?.meta,
            };
          }
        } catch (error) {
          outcome = { status: "failed", message: error.message || "The record could not be imported." };
        }

        const final = {
          rowNumber: record.rowNumber,
          status: outcome.status,
          label: record.label || `Row ${record.rowNumber}`,
          values: record.values,
          message: outcome.message ?? "",
          meta: outcome.meta,
        };
        outcomes[index] = final;
        setLive((current) => ({
          ...current,
          [final.status]: (current[final.status] ?? 0) + 1,
        }));
        return final;
      },
      (done, total) => setProgress({ done, total }),
    );

    const summary = summarizeOutcomes(outcomes);
    setResults({ outcomes, summary });
    setRunning(false);
    setStep("report");
    onComplete?.({ moduleId: module.id, summary, outcomes });
  };

  const downloadReport = async (format) => {
    if (!results) return;
    setDownloading(format);
    setWizardError("");
    try {
      await downloadImportReport({
        module,
        fileName: file?.name ?? "",
        summary: results.summary,
        results: results.outcomes,
        format,
      });
    } catch (error) {
      setWizardError(error.message || "The report could not be downloaded.");
    } finally {
      setDownloading("");
    }
  };

  const downloadTemplate = async () => {
    setDownloading("template");
    setWizardError("");
    try {
      await downloadImportTemplate(module);
    } catch (error) {
      setWizardError(error.message || "The template could not be downloaded.");
    } finally {
      setDownloading("");
    }
  };

  const resetWizard = () => {
    setStep("upload");
    setFile(null);
    setParsed(null);
    setMapping({});
    setPrepared(null);
    setResults(null);
    setConfirmed(false);
    setStrategy(module.defaultStrategy ?? "new");
    setParseError("");
    setWizardError("");
    setProgress({ done: 0, total: 0 });
    setLive({ created: 0, updated: 0, skipped: 0, failed: 0, invalid: 0 });
    // Records written by the last run must be visible to the next duplicate check.
    setContextVersion((value) => value + 1);
  };

  const close = () => {
    if (!running) onClose();
  };

  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const previewFields = module.fields.filter((field) => mapping[field.key]).slice(0, 5);
  const failedOutcomes = results?.outcomes.filter((item) => ["failed", "invalid"].includes(item.status)) ?? [];
  const createdAccounts = results?.outcomes.filter((item) => item.status === "created" && item.meta?.password) ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-wizard-title"
        className="glass-floating my-4 w-full max-w-5xl overflow-hidden rounded-2xl sm:my-0"
      >
        <header className="flex items-start justify-between gap-4 border-b border-(--border)/60 p-5">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-(--muted-foreground)">Import from file</p>
            <h2 id="import-wizard-title" className="mt-1 text-lg font-semibold tracking-tight text-(--foreground)">
              {module.title}
            </h2>
            <p className="mt-1 text-xs text-(--muted-foreground)">{module.description}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            disabled={running}
            aria-label="Close import wizard"
            className="rounded-lg p-2 text-(--muted-foreground) transition-colors hover:bg-(--primary)/5 hover:text-(--foreground) disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </header>

        <div className="border-b border-(--border)/60 px-5 py-3">
          <ol className="flex items-center gap-1 overflow-x-auto" aria-label="Import progress">
            {STEPS.map((item, index) => {
              const active = item.id === step;
              const complete = index < stepIndex;
              return (
                <li key={item.id} className="flex items-center gap-1">
                  <span
                    aria-current={active ? "step" : undefined}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                      active
                        ? "bg-(--primary-deep) text-white"
                        : complete
                          ? "bg-(--success)/15 text-(--success)"
                          : "border border-(--border) text-(--muted-foreground)"
                    }`}
                  >
                    {complete ? <CheckCircle2 size={12} /> : index + 1}
                  </span>
                  <span
                    className={`whitespace-nowrap text-[11px] ${
                      active ? "font-semibold text-(--foreground)" : "text-(--muted-foreground)"
                    }`}
                  >
                    {item.label}
                  </span>
                  {index < STEPS.length - 1 ? <span className="mx-1 h-px w-3 bg-(--border)" /> : null}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="max-h-[72vh] overflow-y-auto p-5">
          {wizardError ? <div className="mb-4"><Notice>{wizardError}</Notice></div> : null}

          {step === "upload" ? (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-(--foreground)">Choose a file</h3>
                <p className="mt-1 text-xs text-(--muted-foreground)">
                  Drag a file into the area below, or browse. Excel (.xlsx, .xls), CSV and JSON are supported.
                  The limit is {formatBytes(MAX_FILE_BYTES)} and {MAX_IMPORT_ROWS.toLocaleString()} data rows.
                </p>
              </div>

              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  handleFile(event.dataTransfer.files?.[0]);
                }}
                className={`flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center transition-colors ${
                  dragging
                    ? "border-(--primary) bg-(--primary)/5"
                    : "border-(--border) bg-(--surface-secondary)/40 hover:border-(--primary)"
                }`}
              >
                {parsing ? (
                  <>
                    <Loader2 className="animate-spin text-(--primary)" size={22} />
                    <p className="mt-2 text-sm font-medium text-(--foreground)">Reading the file</p>
                    <p className="mt-1 text-[11px] text-(--muted-foreground)">Checking the format, headers and row count.</p>
                  </>
                ) : (
                  <>
                    <Upload className="text-(--primary)" size={22} />
                    <p className="mt-2 text-sm font-medium text-(--foreground)">Drop a file here, or browse</p>
                    <p className="mt-1 text-[11px] text-(--muted-foreground)">.xlsx, .xls, .csv or .json</p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_ATTRIBUTE}
                className="sr-only"
                onChange={(event) => {
                  handleFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />

              {parseError ? <Notice>{parseError}</Notice> : null}

              {parsed ? (
                <div className="glass-inner rounded-xl p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <FileSpreadsheet className="mt-0.5 shrink-0 text-(--primary)" size={18} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-(--foreground)">{file?.name}</p>
                        <p className="mt-0.5 text-[11px] text-(--muted-foreground)">
                          {formatBytes(file?.size ?? 0)}, {parsed.sheets.length} worksheet
                          {parsed.sheets.length === 1 ? "" : "s"}, {parsed.sheets.reduce((sum, item) => sum + item.rows.length, 0).toLocaleString()} data rows
                        </p>
                      </div>
                    </div>
                    <Button type="button" variant="subtle" onClick={() => fileInputRef.current?.click()}>
                      Choose another file
                    </Button>
                  </div>

                  {parsed.sheets.length > 1 ? (
                    <div className="mt-4 max-w-xs">
                      <Field label="Worksheet">
                        <Select
                          value={String(sheetIndex)}
                          onChange={(event) => {
                            setSheetIndex(Number(event.target.value));
                            setPrepared(null);
                            setConfirmed(false);
                          }}
                        >
                          {parsed.sheets.map((item, index) => (
                            <option key={item.name} value={index}>
                              {item.name} ({item.rows.length.toLocaleString()} rows)
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                  ) : null}

                  {parsed.warnings?.length ? (
                    <div className="mt-4">
                      <Notice tone="warning">
                        <p className="font-medium">The parser reported a few warnings.</p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                          {parsed.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                        </ul>
                      </Notice>
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[11px] text-(--muted-foreground)">
                      {sheet ? `${sheet.headers.length} columns, ${sheet.rows.length.toLocaleString()} rows on "${sheet.name}".` : ""}
                    </p>
                    <Button
                      type="button"
                      onClick={() => setStep("map")}
                      disabled={!sheet || sheet.rows.length === 0}
                    >
                      Continue to column matching
                    </Button>
                  </div>
                </div>
              ) : null}

              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-(--foreground)">Start from a sample template</p>
                    <p className="mt-1 text-xs text-(--muted-foreground)">
                      The workbook contains the correct headers, example rows and instructions for this module.
                      Required columns: {module.fields.filter((field) => field.required).map((field) => field.label).join(", ")}.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="subtle"
                    onClick={downloadTemplate}
                    disabled={downloading === "template"}
                  >
                    {downloading === "template" ? <Loader2 className="animate-spin" size={15} /> : <Download size={15} />}
                    {downloading === "template" ? "Preparing..." : "Download template"}
                  </Button>
                </div>
              </Card>

              {contextLoading ? (
                <p className="flex items-center gap-2 text-[11px] text-(--muted-foreground)">
                  <Loader2 className="animate-spin" size={13} /> Loading Gradia reference data.
                </p>
              ) : null}
              {contextError ? (
                <Notice>
                  <p>{contextError}</p>
                  <Button type="button" variant="subtle" className="mt-2" onClick={() => setContextVersion((value) => value + 1)}>
                    Try again
                  </Button>
                </Notice>
              ) : null}
            </div>
          ) : null}

          {step === "map" ? (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-(--foreground)">Match uploaded columns to Gradia fields</h3>
                <p className="mt-1 text-xs text-(--muted-foreground)">
                  We matched what we could automatically. Change any match that does not look right. Required fields
                  are marked, and you can leave optional fields unmapped.
                </p>
              </div>

              {parsed?.sheets.length > 1 ? (
                <div className="max-w-xs">
                  <Field label="Worksheet">
                    <Select
                      value={String(sheetIndex)}
                      onChange={(event) => {
                        setSheetIndex(Number(event.target.value));
                        setPrepared(null);
                        setConfirmed(false);
                      }}
                    >
                      {parsed.sheets.map((item, index) => (
                        <option key={item.name} value={index}>
                          {item.name} ({item.rows.length.toLocaleString()} rows)
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                {module.fields.map((field) => {
                  const header = mapping[field.key] ?? "";
                  const headerIndex = sheet?.headers.indexOf(header) ?? -1;
                  const sample = headerIndex >= 0 ? cellText(sheet?.rows?.[0]?.[headerIndex]) : "";
                  return (
                    <div key={field.key} className="rounded-lg border border-(--border-subtle) p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium text-(--foreground)">
                          {field.label}
                          {field.required ? " *" : ""}
                        </span>
                        <span className={`text-[11px] ${field.required ? "text-(--danger)" : "text-(--muted-foreground)"}`}>
                          {field.required ? "Required" : "Optional"}
                        </span>
                      </div>
                      <div className="mt-2">
                        <Select
                          value={header}
                          onChange={(event) => setFieldMapping(field.key, event.target.value)}
                          aria-label={`Column for ${field.label}`}
                        >
                          <option value="">Not mapped</option>
                          {sheet?.headers.map((item) => (
                            <option key={item} value={item}>{item}</option>
                          ))}
                        </Select>
                      </div>
                      <p className="mt-1.5 truncate text-[11px] text-(--muted-foreground)">
                        {sample ? `First value: ${sample}` : field.help ?? `Example: ${field.example ?? "value"}`}
                      </p>
                    </div>
                  );
                })}
              </div>

              {unmappedHeaders.length ? (
                <Notice tone="warning">
                  <p className="font-medium">Columns that will be ignored</p>
                  <p className="mt-1">{unmappedHeaders.join(", ")}</p>
                </Notice>
              ) : null}

              {mappingIssues.length ? (
                <Notice>
                  <p className="font-medium">Fix these column matches before checking rows</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {mappingIssues.map((issue) => <li key={issue}>{issue}</li>)}
                  </ul>
                </Notice>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <Button type="button" variant="subtle" onClick={() => setStep("upload")}>
                  Back to upload
                </Button>
                <Button
                  type="button"
                  onClick={prepare}
                  disabled={mappingIssues.length > 0 || !context || contextLoading || preparing}
                >
                  {preparing ? <Loader2 className="animate-spin" size={15} /> : null}
                  {preparing ? "Checking rows..." : "Check rows"}
                </Button>
              </div>
            </div>
          ) : null}

          {step === "review" && plan ? (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-(--foreground)">Review the file before importing</h3>
                <p className="mt-1 text-xs text-(--muted-foreground)">
                  Every row is checked against the live Gradia data. Fix the file and start again if anything looks wrong.
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <SummaryCard label="Rows detected" value={plan.summary.total} />
                <SummaryCard label="Ready to import" value={readyCount} tone="success" />
                <SummaryCard label="To update" value={plan.summary.update} tone="primary" />
                <SummaryCard label="Duplicates to skip" value={plan.summary.skip} />
                <SummaryCard label="Rows with errors" value={blockedCount} tone="danger" />
              </div>

              <fieldset className="rounded-xl border border-(--border) p-4">
                <legend className="px-1 text-xs font-semibold text-(--foreground)">If a record already exists</legend>
                <div className="mt-2 space-y-2">
                  {module.duplicateStrategies.map((id) => {
                    const copy = STRATEGY_COPY[id];
                    if (!copy) return null;
                    return (
                      <label
                        key={id}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                          strategy === id ? "border-(--primary) bg-(--primary)/5" : "border-(--border-subtle)"
                        }`}
                      >
                        <input
                          type="radio"
                          name="duplicate-strategy"
                          value={id}
                          checked={strategy === id}
                          onChange={() => {
                            setStrategy(id);
                            setConfirmed(false);
                          }}
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-(--foreground)">{copy.label}</span>
                          <span className="mt-0.5 block text-[11px] text-(--muted-foreground)">{copy.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {readyCount === 0 ? (
                <Notice tone="warning">
                  <p className="font-medium">There are no records ready to import.</p>
                  <p className="mt-1">
                    Every row is either invalid or already exists. Go back to the column matching step, fix the file,
                    or choose a different duplicate strategy.
                  </p>
                </Notice>
              ) : null}

              <div className="overflow-x-auto rounded-xl border border-(--border-subtle)">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-(--surface-secondary)">
                    <tr className="border-b border-(--border-subtle)">
                      <th className="px-3 py-2 font-medium text-(--muted-foreground)">Row</th>
                      <th className="px-3 py-2 font-medium text-(--muted-foreground)">Status</th>
                      <th className="px-3 py-2 font-medium text-(--muted-foreground)">Record</th>
                      {previewFields.map((field) => (
                        <th key={field.key} className="px-3 py-2 font-medium text-(--muted-foreground)">{field.label}</th>
                      ))}
                      <th className="px-3 py-2 font-medium text-(--muted-foreground)">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.records.slice(0, 100).map((record) => (
                      <tr
                        key={record.rowNumber}
                        className={`border-b border-(--border-subtle)/60 last:border-b-0 ${
                          record.planStatus === "invalid" || record.planStatus === "failed"
                            ? "bg-(--danger-subtle)/40"
                            : record.planStatus === "skip"
                              ? "opacity-70"
                              : ""
                        }`}
                      >
                        <td className="px-3 py-2 tabular-nums text-(--muted-foreground)">{record.rowNumber}</td>
                        <td className="px-3 py-2"><StatusPill status={record.planStatus} /></td>
                        <td className="max-w-48 truncate px-3 py-2 text-(--foreground)" title={record.label}>{record.label || "No label"}</td>
                        {previewFields.map((field) => (
                          <td key={field.key} className="max-w-40 truncate px-3 py-2 text-(--muted-foreground)" title={cellText(record.values?.[field.key])}>
                            {cellText(record.values?.[field.key]) || "-"}
                          </td>
                        ))}
                        <td className="max-w-64 truncate px-3 py-2 text-(--muted-foreground)" title={record.reason}>{record.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {plan.records.length > 100 ? (
                <p className="text-[11px] text-(--muted-foreground)">
                  Showing the first 100 of {plan.records.length.toLocaleString()} rows. Every row is checked and imported.
                </p>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <Button type="button" variant="subtle" onClick={() => setStep("map")}>
                  Back to columns
                </Button>
                <Button type="button" onClick={() => setStep("confirm")} disabled={readyCount === 0}>
                  Continue to confirmation
                </Button>
              </div>
            </div>
          ) : null}

          {step === "confirm" && plan ? (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-(--foreground)">Confirm this import</h3>
                <p className="mt-1 text-xs text-(--muted-foreground)">
                  Check the summary once more. Nothing is written until you start the import.
                </p>
              </div>

              <div className="glass-inner rounded-xl p-4">
                <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  {[
                    ["Module", module.title],
                    ["File", file?.name ?? ""],
                    ["Worksheet", sheet?.name ?? ""],
                    ["Total records", plan.summary.total.toLocaleString()],
                    ["Records ready to import", readyCount.toLocaleString()],
                    ["Records to create", plan.summary.create.toLocaleString()],
                    ["Records to update", plan.summary.update.toLocaleString()],
                    ["Records to skip", plan.summary.skip.toLocaleString()],
                    ["Records containing errors", blockedCount.toLocaleString()],
                    ["Duplicate strategy", STRATEGY_COPY[strategy]?.label ?? strategy],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-start justify-between gap-4 border-b border-(--border-subtle)/60 pb-2">
                      <dt className="text-(--muted-foreground)">{label}</dt>
                      <dd className="max-w-[60%] text-right font-medium text-(--foreground)">{value || "-"}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {strategy === "update" ? (
                <Notice tone="warning">
                  <p className="flex items-center gap-2 font-medium"><AlertTriangle size={14} /> Updating overwrites existing values</p>
                  <p className="mt-1">
                    Existing records matched by this file will be updated. Leave this step if you only want to add new records.
                  </p>
                </Notice>
              ) : null}

              {module.id === "users" ? (
                <Notice tone="warning">
                  Accounts are created immediately through the secure create-user function. Account updates are not supported here.
                  Temporary passwords appear in the downloadable report.
                </Notice>
              ) : null}

              {module.id === "marks" ? (
                <Notice tone="warning">
                  Marks are written as your signed-in account. Row-level security still checks that you can enter marks for the selected subject.
                </Notice>
              ) : null}

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-(--border) p-3">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-sm text-(--foreground)">
                  I have reviewed the file and confirm that these records should be imported into Gradia.
                </span>
              </label>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <Button type="button" variant="subtle" onClick={() => setStep("review")}>
                  Back to review
                </Button>
                <Button type="button" onClick={startImport} disabled={!confirmed || readyCount === 0}>
                  {readyCount === 0 ? "Nothing to import" : `Import ${readyCount.toLocaleString()} record${readyCount === 1 ? "" : "s"}`}
                </Button>
              </div>
            </div>
          ) : null}

          {step === "import" ? (
            <div className="space-y-5">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-(--foreground)">
                  <Loader2 className="animate-spin text-(--primary)" size={16} /> Importing records
                </h3>
                <p className="mt-1 text-xs text-(--muted-foreground)">
                  Keep this tab open until the import finishes. Each record is written separately so one failure does not stop the rest.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs text-(--muted-foreground)">
                  <span>{progress.done.toLocaleString()} of {progress.total.toLocaleString()} processed</span>
                  <span className="tabular-nums">{percent}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-(--surface-secondary)">
                  <div
                    className="h-full rounded-full bg-(--primary) transition-[width] duration-300"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <SummaryCard label="Processed" value={progress.done} />
                <SummaryCard label="Imported" value={live.created} tone="success" />
                <SummaryCard label="Updated" value={live.updated} tone="primary" />
                <SummaryCard label="Skipped" value={live.skipped} />
                <SummaryCard label="Failed or invalid" value={live.failed + live.invalid} tone="danger" />
              </div>

              <p className="text-[11px] text-(--muted-foreground)">
                The wizard stays open until every row has been processed. You can download a full report on the next step.
              </p>
            </div>
          ) : null}

          {step === "report" && results ? (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-(--foreground)">Import complete</h3>
                <p className="mt-1 text-xs text-(--muted-foreground)">
                  The table below shows what happened to every row. Download the report for the complete record.
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <SummaryCard label="Total rows" value={results.summary.total} />
                <SummaryCard label="Imported" value={results.summary.created} tone="success" />
                <SummaryCard label="Updated" value={results.summary.updated} tone="primary" />
                <SummaryCard label="Skipped" value={results.summary.skipped} />
                <SummaryCard
                  label="Failed or invalid"
                  value={results.summary.failed + results.summary.invalid}
                  tone="danger"
                />
              </div>

              {results.summary.failed + results.summary.invalid > 0 ? (
                <Notice tone="warning">
                  <p className="font-medium">
                    {results.summary.failed + results.summary.invalid} row{results.summary.failed + results.summary.invalid === 1 ? "" : "s"} were not imported.
                  </p>
                  <p className="mt-1">Download the report to see every reason, then fix those rows and import them again.</p>
                </Notice>
              ) : (
                <Notice tone="success">
                  Every row that was ready has been imported. Existing records were left untouched unless you chose the update strategy.
                </Notice>
              )}

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="subtle" onClick={() => downloadReport("csv")} disabled={downloading !== ""}>
                  {downloading === "csv" ? <Loader2 className="animate-spin" size={15} /> : <Download size={15} />}
                  Download report (CSV)
                </Button>
                <Button type="button" variant="subtle" onClick={() => downloadReport("xlsx")} disabled={downloading !== ""}>
                  {downloading === "xlsx" ? <Loader2 className="animate-spin" size={15} /> : <Download size={15} />}
                  Download report (Excel)
                </Button>
              </div>

              {module.id === "users" && createdAccounts.length ? (
                <div className="rounded-xl border border-(--border) p-4">
                  <p className="text-sm font-medium text-(--foreground)">Temporary passwords</p>
                  <p className="mt-1 text-[11px] text-(--muted-foreground)">
                    Share these securely. The downloaded report contains every created account.
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-(--border-subtle)">
                          <th className="px-2 py-1.5 font-medium text-(--muted-foreground)">Row</th>
                          <th className="px-2 py-1.5 font-medium text-(--muted-foreground)">Account</th>
                          <th className="px-2 py-1.5 font-medium text-(--muted-foreground)">Temporary password</th>
                        </tr>
                      </thead>
                      <tbody>
                        {createdAccounts.slice(0, 20).map((item) => (
                          <tr key={item.rowNumber} className="border-b border-(--border-subtle)/60 last:border-b-0">
                            <td className="px-2 py-1.5 tabular-nums text-(--muted-foreground)">{item.rowNumber}</td>
                            <td className="px-2 py-1.5 text-(--foreground)">{item.label}</td>
                            <td className="px-2 py-1.5 font-mono text-[11px] text-(--foreground)">{item.meta.password}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {createdAccounts.length > 20 ? (
                    <p className="mt-2 text-[11px] text-(--muted-foreground)">
                      Showing 20 of {createdAccounts.length.toLocaleString()} created accounts. Download the report for the rest.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {failedOutcomes.length ? (
                <div className="rounded-xl border border-(--danger)/30 p-4">
                  <p className="text-sm font-medium text-(--foreground)">Rows that need attention</p>
                  <div className="mt-3 max-h-64 overflow-y-auto">
                    <table className="min-w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-(--border-subtle)">
                          <th className="px-2 py-1.5 font-medium text-(--muted-foreground)">Row</th>
                          <th className="px-2 py-1.5 font-medium text-(--muted-foreground)">Status</th>
                          <th className="px-2 py-1.5 font-medium text-(--muted-foreground)">Record</th>
                          <th className="px-2 py-1.5 font-medium text-(--muted-foreground)">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {failedOutcomes.slice(0, 100).map((item) => (
                          <tr key={item.rowNumber} className="border-b border-(--border-subtle)/60 last:border-b-0">
                            <td className="px-2 py-1.5 tabular-nums text-(--muted-foreground)">{item.rowNumber}</td>
                            <td className="px-2 py-1.5">{REPORT_STATUS_LABEL[item.status] ?? item.status}</td>
                            <td className="px-2 py-1.5 text-(--foreground)">{item.label}</td>
                            <td className="px-2 py-1.5 text-(--muted-foreground)">{item.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {failedOutcomes.length > 100 ? (
                    <p className="mt-2 text-[11px] text-(--muted-foreground)">
                      Showing 100 of {failedOutcomes.length.toLocaleString()} rows. Download the report for the rest.
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <Button type="button" variant="subtle" onClick={resetWizard}>
                  Import another file
                </Button>
                <Button type="button" onClick={onClose}>Done</Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
