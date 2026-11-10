// Duplicate planning for the universal import wizard.
//
// Given the resolved file rows and the existing-record index a module built,
// this decides what every row will do (create, update, skip or fail) before a
// single write happens. Keeping it separate from the React component makes the
// rules explicit and testable.

import { errorSummary } from "./schemaUtils";

export function recordTokens(record) {
  return [...new Set([record.identity, ...(record.altIdentities ?? [])].filter(Boolean))];
}

function lookupInPlan(map, keys) {
  for (const key of keys) {
    const hit = map.get(key);
    if (hit) return hit;
  }
  return null;
}

export function planRecords(records, existingMap, strategy) {
  const valid = records.filter((record) => !record.errors?.length);
  const groups = new Map();
  for (const record of valid) {
    for (const token of recordTokens(record)) {
      if (!groups.has(token)) groups.set(token, []);
      groups.get(token).push(record);
    }
  }

  const annotated = records.map((record) => {
    if (record.errors?.length) {
      return {
        ...record,
        action: "invalid",
        planStatus: "invalid",
        reason: errorSummary(record.errors),
      };
    }

    const conflict = new Set();
    for (const token of recordTokens(record)) {
      const group = groups.get(token);
      if (group && group.length > 1) group.forEach((item) => conflict.add(item));
    }
    if (conflict.size === 0) conflict.add(record);
    const survivor = [...conflict].reduce((chosen, item) => {
      if (strategy === "update") return item.rowNumber > chosen.rowNumber ? item : chosen;
      return item.rowNumber < chosen.rowNumber ? item : chosen;
    }, record);
    if (survivor !== record) {
      return {
        ...record,
        action: "skip",
        planStatus: "skip",
        reason:
          strategy === "update"
            ? `Superseded by row ${survivor.rowNumber}. The last occurrence is used.`
            : `Duplicate of row ${survivor.rowNumber} in this file.`,
      };
    }

    const existingHit = lookupInPlan(existingMap, recordTokens(record));
    if (existingHit?.ambiguous) {
      return {
        ...record,
        action: "failed",
        planStatus: "failed",
        reason: `Multiple existing records match this row (${existingHit.count}). Fix the duplicates in Gradia first.`,
      };
    }
    if (existingHit?.row) {
      if (strategy === "update") {
        return {
          ...record,
          action: "update",
          planStatus: "update",
          existing: existingHit.row,
          reason: "Existing record will be updated.",
        };
      }
      return {
        ...record,
        action: "skip",
        planStatus: "skip",
        existing: existingHit.row,
        reason: strategy === "new" ? "Already exists. Only new records are imported." : "Duplicate skipped.",
      };
    }
    return { ...record, action: "create", planStatus: "create", reason: "New record." };
  });

  const summary = { total: annotated.length, create: 0, update: 0, skip: 0, invalid: 0, failed: 0 };
  for (const record of annotated) summary[record.planStatus] += 1;
  return { records: annotated, summary };
}

export function summarizeOutcomes(outcomes) {
  const summary = { total: outcomes.length, created: 0, updated: 0, skipped: 0, failed: 0, invalid: 0 };
  for (const outcome of outcomes) {
    if (outcome.status === "created") summary.created += 1;
    else if (outcome.status === "updated") summary.updated += 1;
    else if (outcome.status === "skipped") summary.skipped += 1;
    else if (outcome.status === "invalid") summary.invalid += 1;
    else summary.failed += 1;
  }
  return summary;
}
