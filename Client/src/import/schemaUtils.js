// Shared helpers for the universal import engine.
// All values coming from a file are treated as untrusted text until a module
// explicitly parses or resolves them.

export const norm = (value) => String(value ?? "").trim().toLowerCase();

export const normHeader = (value) =>
  norm(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const text = (value) => String(value ?? "").trim();

export const optionalText = (value) => {
  const cleaned = text(value);
  return cleaned ? cleaned : null;
};

export const isEmail = (value) => /^\S+@\S+\.\S+$/.test(text(value));

export function asNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  const cleaned = String(value).trim().replace(/,/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function asInt(value) {
  const parsed = asNumber(value);
  if (parsed === null) return null;
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

export const normaliseDate = (value) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? Number.NaN : value.toISOString().slice(0, 10);
  }
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? Number.NaN : parsed.toISOString().slice(0, 10);
};

export const cellText = (value) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  return String(value).trim();
};

export function generatePassword(length = 10) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const symbols = "!@#$%";
  const size = Math.max(8, Number(length) || 10);
  const bytes = new Uint8Array(size);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  const password = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
  password[0] = symbols[bytes[0] % symbols.length];
  return password.join("");
}

export function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function errorSummary(errors = []) {
  return errors
    .map((error) => (error.field ? `${error.field}: ${error.message}` : error.message))
    .join("; ");
}

// Runs `worker` over items with a bounded number of in-flight requests so a
// large import never blocks the browser or floods PostgREST.
export async function mapWithConcurrency(items, limit, worker, onTick) {
  const list = items ?? [];
  if (!list.length) return [];
  const results = new Array(list.length);
  let cursor = 0;
  let done = 0;
  const width = Math.max(1, Math.min(Number(limit) || 1, list.length));

  const runners = Array.from({ length: width }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      results[index] = await worker(list[index], index);
      done += 1;
      onTick?.(done, list.length);
    }
  });

  await Promise.all(runners);
  return results;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Excel and CSV consumers treat leading = + - @ and control characters as
// formulas/commands. Prefixing with an apostrophe keeps the value inert while
// still displaying it. Used for every generated report/template cell.
export function safeSpreadsheetCell(value) {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  return /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
}

export function token(prefix, ...parts) {
  const cleaned = parts.map((part) => norm(part));
  if (cleaned.some((part) => !part)) return [];
  return [`${prefix}:${cleaned.join(":")}`];
}

export function findUnique(map, value) {
  const key = norm(value);
  if (!key) return null;
  const hit = map.get(key);
  if (!hit) return null;
  return Array.isArray(hit) ? (hit.length === 1 ? hit[0] : null) : hit;
}

export function groupBy(list, keyFn) {
  const map = new Map();
  for (const item of list ?? []) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export function uniqueBy(list, keyFn) {
  const map = new Map();
  for (const item of list ?? []) {
    const key = keyFn(item);
    if (key && !map.has(key)) map.set(key, item);
  }
  return map;
}

export const REPORT_STATUS_LABEL = {
  created: "Imported",
  updated: "Updated",
  skipped: "Skipped",
  failed: "Failed",
  invalid: "Invalid data",
};
