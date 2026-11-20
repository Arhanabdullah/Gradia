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
  if (module.id === "classwork") {
    rows.push(
      [],
      ["Classwork rules"],
      ["Kind", "Use assignment, quiz or project."],
      ["Class and subject", "The subject must already be offered by the class. A teacher can only import subjects assigned to them."],
      ["Deadline", "YYYY-MM-DD or YYYY-MM-DD HH:MM. A date without a time uses 23:59 in your local time. Leave blank for no deadline."],
      ["Publishing", "Each row is published when it is imported and notifies the class. No examination or room is created."],
      ["Example rows", "The examples use a class and subject from your account. Replace them with your own rows before uploading."],
    );
  }
  if (String(module.id).startsWith("schedule_")) {
    rows.push(
      [],
      ["Paper scheduling rules"],
      ["Class", "Use the exact class name shown in Gradia, or the name with its section. The semester examination is created automatically from the assigned subjects."],
      ["Subject and paper", "The subject and paper must already exist in the class semester examination. This import never adds a subject or a paper."],
      ["Room", "The room is written for the row's class. Classes in a department-wide group can share paper dates and times while using different rooms."],
      ["Paper", "The paper code from Assessment Setup, for example ESA, IA1 or IA2. Quiz, assignment and project are classwork and are marked in Marks Entry."],
      ["Paper date", "YYYY-MM-DD, for example 2026-12-10, inside the examination window when the examination has one."],
      ["Start and end time", "24-hour HH:MM, for example 09:30 and 13:30, or 12-hour with AM or PM, for example 10:00 AM and 01:00 PM. A bare 01:00 is read as 1 AM."],
      ["Clashes", "A paper that overlaps another paper of the same class is rejected unless Allow overlap is Yes."],
      ["Example rows", "Where available, the examples use a class, subject and paper from your account. Replace them with your own rows before uploading."],
    );
  }
  if (module.id === "exams") {
    rows.push(
      [],
      ["Examination group rules"],
      ["Class", "An existing Gradia class. The import adds every subject offered by the class, or only your assigned subjects for a teacher."],
      ["Exam type", "IA1 when blank. Teachers can import IA1, Quiz, Project, Practical and Viva; IA2 and ESA are reserved for the Exam Cell."],
      ["Starts on and ends on", "YYYY-MM-DD, for example 2026-12-01. The end must be on or after the start. Both can be blank."],
      ["Academic year", "Uses the class academic year when blank. Example rows use the same year as the sample class."],
      ["Example rows", "Where available, the examples use a class from your account. Replace them with your own rows before uploading."],
    );
  }
  if (module.id === "class_subjects") {
    rows.push(
      [],
      ["Teacher matching"],
      ["Teacher ID", "Recommended. Use the Teacher ID shown in Manage users. It stays unique when teachers share a name."],
      ["Teacher name", "Optional when Teacher ID is supplied. Name, username or email must match exactly one teacher; a duplicate name is rejected as ambiguous."],
    );
  }
  if (module.id === "exam_subjects") {
    rows.push(
      [],
      ["Subject schedule rules"],
      ["Existing examination", "Import the examination group first. Each row updates a subject already scheduled on that examination."],
      ["Paper date", "Must sit inside the examination date range. Leave blank to keep the current date."],
      ["Example rows", "Where available, the examples use an existing examination from your account. Replace them with your own rows before uploading."],
    );
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

export function buildTemplateSheets(module, context = {}) {
  const headers = module.fields.map((field) => field.label);
  const source =
    typeof module.exampleRows === "function" ? module.exampleRows(context) : module.exampleRows;
  const examples = (source ?? []).map((row) =>
    module.fields.map((_, index) => row[index] ?? ""),
  );
  return {
    data: [headers, ...examples],
    instructions: templateInstructions(module),
  };
}

export async function downloadImportTemplate(module, context = {}) {
  const XLSX = await loadXlsx();
  const workbook = XLSX.utils.book_new();
  const sheets = buildTemplateSheets(module, context);

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

export async function downloadImportReport({ module, fileName, summary, results, format = "csv" }) {  const base = `Gradia_${module.title.replace(/[^a-z0-9]+/gi, "_")}_Import_Report_${fileStamp()}`;
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

// Failed-row download. The data sheet keeps exactly the template headers, so the
// corrected file can be uploaded again without remapping. A second sheet lists
// the row numbers and the reason each one failed.
export async function downloadFailedRows(module, results) {
  const rows = (results ?? []).filter((result) => ["failed", "invalid"].includes(result.status));
  if (rows.length === 0) return;

  const XLSX = await loadXlsx();
  const workbook = XLSX.utils.book_new();
  const headers = module.fields.map((field) => field.label);
  const dataRows = [
    headers,
    ...rows.map((result) =>
      module.fields.map((field) => safeSpreadsheetCell(cellText(result.values?.[field.key]))),
    ),
  ];

  const dataSheet = XLSX.utils.aoa_to_sheet(dataRows);
  dataSheet["!cols"] = module.fields.map((field) => ({
    wch: Math.max(16, Math.min(42, field.label.length + 6)),
  }));
  XLSX.utils.book_append_sheet(workbook, dataSheet, "Import data");

  const reasonRows = [
    ["Row", "Status", "Problem", ...headers],
    ...rows.map((result) => [
      result.rowNumber,
      REPORT_STATUS_LABEL[result.status] ?? result.status,
      result.message ?? "",
      ...module.fields.map((field) => safeSpreadsheetCell(cellText(result.values?.[field.key]))),
    ]),
  ];
  const reasonSheet = XLSX.utils.aoa_to_sheet(reasonRows);
  reasonSheet["!cols"] = [{ wch: 8 }, { wch: 14 }, { wch: 56 }, ...headers.map(() => ({ wch: 22 }))];
  XLSX.utils.book_append_sheet(workbook, reasonSheet, "Rows to fix");

  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  downloadBlob(
    new Blob([output], { type: XLSX_MIME }),
    `Gradia_${module.title.replace(/[^a-z0-9]+/gi, "_")}_Failed_Rows_${fileStamp()}.xlsx`,
  );
}
