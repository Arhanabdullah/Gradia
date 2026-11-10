// File parsing for the universal import wizard.
//
// The parser is deliberately independent of any Supabase table: it only turns
// an uploaded file into plain sheets of headers + rows. Module definitions in
// modules.js decide what each value means and whether it is valid.

import Papa from "papaparse";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;
export const ACCEPTED_EXTENSIONS = ["csv", "xlsx", "xls", "json"];
export const ACCEPT_ATTRIBUTE = ".csv,.xlsx,.xls,.json";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS_MIME = "application/vnd.ms-excel";
const ALLOWED_MIME = {
  csv: ["text/csv", "application/csv", "text/plain", XLS_MIME, "application/octet-stream", ""],
  xlsx: [XLSX_MIME, "application/octet-stream", ""],
  xls: [XLS_MIME, "application/octet-stream", ""],
  json: ["application/json", "text/json", "text/plain", "application/octet-stream", ""],
};

function extensionOf(name) {
  const match = /\.([a-z0-9]+)$/i.exec(String(name ?? ""));
  return match ? match[1].toLowerCase() : "";
}

function decodeText(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buffer.slice(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer.slice(2));
  }
  return new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/, "");
}

function looksBinary(buffer) {
  const bytes = new Uint8Array(buffer).slice(0, 512);
  return bytes.some((byte) => byte === 0);
}

function validateMagic(extension, buffer) {
  const bytes = new Uint8Array(buffer).slice(0, 16);
  if (extension === "xlsx") {
    if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
      throw new Error("This file is not a valid .xlsx workbook. Save it again as Excel Workbook (.xlsx) and retry.");
    }
    return;
  }
  if (extension === "xls") {
    const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    if (!ole.every((byte, index) => bytes[index] === byte)) {
      throw new Error("This file is not a valid .xls workbook. Save it again as Excel 97-2003 (.xls) or .xlsx and retry.");
    }
    return;
  }
  if (looksBinary(buffer)) {
    throw new Error(
      extension === "json"
        ? "This does not look like a JSON text file. Export it again as UTF-8 JSON and retry."
        : "This does not look like a CSV text file. Export it again as UTF-8 CSV and retry.",
    );
  }
}

function normaliseMime(file, extension) {
  const mime = String(file.type ?? "").toLowerCase();
  if (!mime) return;
  const allowed = ALLOWED_MIME[extension] ?? [];
  if (!allowed.includes(mime)) {
    throw new Error(
      `The file type reported by the browser (${mime}) does not match .${extension}. Choose the correct file or export it again.`,
    );
  }
}

function cellValue(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return value;
}

function makeHeaders(rawHeaders) {
  const used = new Map();
  return rawHeaders.map((raw, index) => {
    const cleaned = String(raw ?? "").replace(/\s+/g, " ").trim();
    const base = cleaned || `Column ${index + 1}`;
    const key = base.toLowerCase();
    const seen = used.get(key) ?? 0;
    used.set(key, seen + 1);
    return seen === 0 ? base : `${base} (${seen + 1})`;
  });
}

function aoaToSheet(name, aoa) {
  const nonEmpty = (row) =>
    Array.isArray(row) && row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== "");
  const rows = (aoa ?? []).filter(nonEmpty);
  if (!rows.length) return null;

  const width = rows.reduce((max, row) => Math.max(max, row.length), 1);
  const headerRow = Array.from({ length: width }, (_, index) => cellValue(rows[0][index]));
  const headers = makeHeaders(headerRow);
  const dataRows = rows.slice(1).map((row) =>
    headers.map((_, index) => cellValue(row[index])),
  );
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new Error(
      `The worksheet "${name}" has ${dataRows.length.toLocaleString()} data rows. The limit is ${MAX_IMPORT_ROWS.toLocaleString()}. Split the file and import it in smaller batches.`,
    );
  }
  return { name, headers, rows: dataRows };
}

function parseCsv(text, name) {
  const result = Papa.parse(text, {
    header: false,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
    transform: (value) => value,
  });
  const warnings = (result.errors ?? [])
    .slice(0, 3)
    .map((error) => `Row ${(error.row ?? 0) + 1}: ${error.message}`);
  const sheet = aoaToSheet(name, result.data ?? []);
  if (!sheet) throw new Error("The CSV file does not contain any readable rows.");
  return { sheet, warnings };
}

function parseJson(text, name) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`This JSON file could not be read: ${error.message}`);
  }

  let list = null;
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === "object") {
    list = ["rows", "data", "records", "items"].map((key) => parsed[key]).find(Array.isArray) ?? null;
  }
  if (!list) {
    throw new Error("JSON imports need an array of records, or an object with a rows, data, records or items array.");
  }
  if (!list.length) throw new Error("The JSON file does not contain any records.");

  if (list.every((item) => Array.isArray(item))) {
    const sheet = aoaToSheet(name, list);
    if (!sheet) throw new Error("The JSON file does not contain a header row followed by records.");
    return sheet;
  }

  if (list.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
    const keys = [];
    for (const item of list) {
      for (const key of Object.keys(item)) {
        if (!keys.includes(key)) keys.push(key);
      }
    }
    if (!keys.length) throw new Error("The JSON records do not contain any columns.");
    const aoa = [keys, ...list.map((item) => keys.map((key) => cellValue(item[key])))];
    const sheet = aoaToSheet(name, aoa);
    if (!sheet) throw new Error("The JSON file does not contain any records.");
    return sheet;
  }

  throw new Error("JSON imports must contain records with the same shape. Mixing arrays and objects is not supported.");
}

async function parseWorkbook(buffer) {
  const module = await import("xlsx");
  const XLSX = module.default ?? module;
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });
  const sheets = [];
  for (const name of workbook.SheetNames ?? []) {
    const worksheet = workbook.Sheets[name];
    if (!worksheet || !worksheet["!ref"]) continue;
    const aoa = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: true,
      defval: "",
      blankrows: false,
    });
    const sheet = aoaToSheet(name, aoa);
    if (sheet) sheets.push(sheet);
  }
  if (!sheets.length) throw new Error("The workbook does not contain any readable worksheets.");
  return sheets;
}

/**
 * Parse an uploaded file into one or more sheets of headers and rows.
 * Throws an Error with a user-facing message for invalid or unreadable files.
 */
export async function parseFile(file) {
  if (!file) throw new Error("Choose a file to import.");
  const extension = extensionOf(file.name);
  if (!ACCEPTED_EXTENSIONS.includes(extension)) {
    throw new Error("Unsupported file type. Choose a .xlsx, .xls, .csv or .json file.");
  }
  if (file.size === 0) throw new Error("That file is empty. Add a header row and at least one record.");
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The maximum size is 10 MB. Split the file and try again.`,
    );
  }
  normaliseMime(file, extension);
  const buffer = await file.arrayBuffer();
  validateMagic(extension, buffer);

  let sheets;
  let warnings = [];
  if (extension === "csv") {
    const parsed = parseCsv(decodeText(buffer), file.name.replace(/\.[^.]+$/, "") || "CSV data");
    sheets = [parsed.sheet];
    warnings = parsed.warnings;
  } else if (extension === "json") {
    const text = decodeText(buffer).trim();
    if (!text.startsWith("{") && !text.startsWith("[")) {
      throw new Error("This does not look like a JSON document. A JSON import must start with { or [.");
    }
    sheets = [parseJson(text, file.name.replace(/\.[^.]+$/, "") || "JSON data")];
  } else {
    sheets = await parseWorkbook(buffer);
  }

  const totalRows = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
  if (!totalRows) {
    throw new Error("The file has a header row but no data rows. Add at least one record and try again.");
  }

  return {
    fileName: file.name,
    extension,
    size: file.size,
    sheets,
    warnings,
  };
}
