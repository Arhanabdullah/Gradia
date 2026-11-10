// Sample workbooks and downloadable import reports.
//
// Templates mirror the module field list so the headers can be auto-matched by
// the wizard. Reports always pass through safeSpreadsheetCell before being
// written, which neutralises spreadsheet formula injection from imported data.

import { REPORT_STATUS_LABEL, cellText, downloadBlob, safeSpreadsheetCell } from "./schemaUtils";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function loadXlsx() {
  const module = await import("xlsx");
  return module.default ?? module;
}

function fileStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export function templateSheetName(module) {
  return `${module.title.replace(/[^a-z0-9]+/gi, "_")}_Import_Template.xlsx`;
}

function templateInstructions(module) {
  const rows = [
    [`${module.title} import template`],
    [module.description],
    [],
    ["How to use this template"],
    ["1", "Enter one record per row on the Import data sheet. Do not rename the column headers."],
    ["2", "Delete the example rows before uploading. They are only there to show the expected values."],
    ["3", "Save the file as .xlsx, .xls, .csv or .json. The upload limit is 10 MB and 5,000 data rows."],
    ["4", "Open the matching Gradia screen, choose Import from file, then upload the completed template."],
    [],
    ["Rules"],
    ["Accepted date format", "YYYY-MM-DD, for example 2026-09-01. Excel date cells are also read."],
    ["Required fields", "Columns marked Required must be mapped and must contain a value in every row."],
    ["Duplicates", "The import wizard checks existing Gradia records before anything is written."],
    ["Security", "The import runs as your signed-in account. Row-level security still applies to every row."],
  ];
  if (module.id === "users") {
    rows.push(["Passwords", "Leave Password blank to generate a temporary password. The import report shows it once."]);
  }
  if (module.id === "marks") {
    rows.push(["Marks", "Marks must be a number between 0 and the subject maximum marks."]);
  }
  if (module.fields.some((field) => field.key === "degree")) {
    rows.push([
      "Degree matching",
      "Degree values are matched by name or code against the shared degree catalogue. They must already exist; imports never create a degree, and a class or profile degree must match its course and class degree.",
    ]);
  }
  if (module.fields.some((field) => field.key === "course")) {
    rows.push([
      "Course matching",
      "Course values are matched by name or code against existing Courses in the selected department and degree. They must already exist; imports never create a course.",
    ]);
  }
  rows.push([], ["Column reference"], ["Column", "Required", "Accepted values and notes", "Example"]);
  for (const field of module.fields) {
    rows.push([
      field.label,
      field.required ? "Yes" : "No",
      field.help ?? field.aliases?.slice(0, 3).join(", ") ?? "",
      field.example ?? "",
    ]);
  }
  return rows;
}

export function buildTemplateSheets(module) {
  const headers = module.fields.map((field) => field.label);
  const examples = (module.exampleRows ?? []).map((row) =>
    module.fields.map((_, index) => row[index] ?? ""),
  );
  return {
    data: [headers, ...examples],
    instructions: templateInstructions(module),
  };
}

export async function downloadImportTemplate(module) {
  const XLSX = await loadXlsx();
  const workbook = XLSX.utils.book_new();
  const sheets = buildTemplateSheets(module);

  const dataSheet = XLSX.utils.aoa_to_sheet(sheets.data);
  dataSheet["!cols"] = module.fields.map((field) => ({
    wch: Math.max(16, Math.min(42, field.label.length + 6)),
  }));
  dataSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  module.fields.forEach((field, index) => {
    if (!field.required) return;
    const address = XLSX.utils.encode_cell({ r: 0, c: index });
    if (!dataSheet[address]) dataSheet[address] = { t: "s", v: field.label };
    dataSheet[address].c = [
      {
        a: "Gradia",
        t: `Required field. ${field.help ?? "Enter a value in every row."}`,
      },
    ];
  });
  XLSX.utils.book_append_sheet(workbook, dataSheet, "Import data");

  const instructionSheet = XLSX.utils.aoa_to_sheet(sheets.instructions);
  instructionSheet["!cols"] = [{ wch: 30 }, { wch: 12 }, { wch: 58 }, { wch: 26 }];
  XLSX.utils.book_append_sheet(workbook, instructionSheet, "Instructions");

  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  downloadBlob(new Blob([output], { type: XLSX_MIME }), module.templateName ?? templateSheetName(module));
}

function reportRows(module, results) {
  const header = [
    "Row",
    "Status",
    "Record",
    ...module.fields.map((field) => field.label),
    "Message",
    "Temporary password",
  ];
  const rows = results.map((result) => [
    result.rowNumber,
    REPORT_STATUS_LABEL[result.status] ?? result.status,
    result.label ?? "",
    ...module.fields.map((field) => cellText(result.values?.[field.key])),
    result.message ?? "",
    result.meta?.password ?? "",
  ]);
  return [header, ...rows];
}

function csvCell(value) {
  const safe = safeSpreadsheetCell(value);
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildReportCsv(module, results) {
  return `\uFEFF${reportRows(module, results)
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")}`;
}

function summaryRows(module, fileName, summary, results) {
  return [
    ["Gradia import report"],
    [],
    ["Module", module.title],
    ["File", fileName ?? ""],
    ["Generated", new Date().toISOString()],
    [],
    ["Total uploaded records", summary.total],
    ["Imported", summary.created],
    ["Updated", summary.updated],
    ["Skipped", summary.skipped],
    ["Invalid data", summary.invalid],
    ["Failed", summary.failed],
    [],
    ["Row", "Status", "Record", "Message"],
    ...results
      .filter((result) => ["failed", "invalid"].includes(result.status))
      .map((result) => [
        result.rowNumber,
        REPORT_STATUS_LABEL[result.status] ?? result.status,
        result.label ?? "",
        result.message ?? "",
      ]),
  ];
}

export async function downloadImportReport({ module, fileName, summary, results, format = "csv" }) {
  const base = `Gradia_${module.title.replace(/[^a-z0-9]+/gi, "_")}_Import_Report_${fileStamp()}`;
  if (format === "csv") {
    const blob = new Blob([buildReportCsv(module, results)], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `${base}.csv`);
    return;
  }

  const XLSX = await loadXlsx();
  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows(module, fileName, summary, results));
  summarySheet["!cols"] = [{ wch: 26 }, { wch: 14 }, { wch: 32 }, { wch: 64 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

  const detailRows = reportRows(module, results).map((row) => row.map(safeSpreadsheetCell));
  const detailSheet = XLSX.utils.aoa_to_sheet(detailRows);
  detailSheet["!cols"] = detailRows[0].map((_, index) => ({ wch: index === 0 ? 8 : 24 }));
  XLSX.utils.book_append_sheet(workbook, detailSheet, "Rows");

  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  downloadBlob(new Blob([output], { type: XLSX_MIME }), `${base}.xlsx`);
}
