// Assessment structure constants and display helpers.
//
// The database owns every calculation (see
// supabase/migrations/202611150001_central_assessment_structure.sql). This
// module only names things and previews what a component contributes, so the
// same wording appears in Assessment Setup and Marks Entry.

export const SUBJECT_TYPES = [
  { id: "theory", label: "Theory" },
  { id: "lab", label: "Practical" },
  { id: "project", label: "Project" },
];

export const TEMPLATE_MODES = [
  { id: "detailed", label: "Detailed breakdown" },
  { id: "direct", label: "Direct final marks" },
];

export const AGGREGATIONS = [
  { id: "direct", label: "Direct" },
  { id: "average", label: "Group average" },
  { id: "scaled", label: "Scaled" },
];

export const COMPONENT_TYPES = [
  { id: "internal", label: "Internal assessment" },
  { id: "quiz", label: "Quiz" },
  { id: "assignment", label: "Assignment" },
  { id: "practical", label: "Practical" },
  { id: "theory", label: "Theory" },
  { id: "esa", label: "End semester assessment" },
  { id: "overall", label: "Overall" },
];

// How a paper is run. Formal papers are invigilated; classwork is marked in
// class and never carries a date, room or invigilator.
export const SCHEDULE_MODES = [
  { id: "formal", label: "Formal paper" },
  { id: "classwork", label: "Classwork" },
];

const labelOf = (rows, id, fallback = "") => rows.find((row) => row.id === id)?.label ?? fallback;

export const subjectTypeLabel = (id) => labelOf(SUBJECT_TYPES, id, id ?? "");
export const templateModeLabel = (id) => labelOf(TEMPLATE_MODES, id, id ?? "");
export const aggregationLabel = (id) => labelOf(AGGREGATIONS, id, id ?? "");
export const componentTypeLabel = (id) => labelOf(COMPONENT_TYPES, id, id ?? "");
export const scheduleModeLabel = (id) => labelOf(SCHEDULE_MODES, id, id ?? "");

// Compact number text for marks and weights: 20, 12.5, 7.25.
export function numberText(value, fallback = "") {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return String(Math.round(numeric * 100) / 100);
}

// Marks a component adds to the subject total at full marks. Rows in an
// `average` group share one group total, so each carries its own share.
export function componentContribution(component) {
  if (!component) return 0;
  if (component.aggregation === "scaled") {
    return Number(component.scale_to ?? component.weight_percent ?? component.max_marks ?? 0);
  }
  return Number(component.weight_percent ?? component.max_marks ?? 0);
}

// Average groups collapse into one contribution: the group average scaled to
// the group's combined weight.
export function averageGroups(components) {
  const groups = new Map();
  (components ?? []).forEach((row) => {
    if (row.aggregation !== "average") return;
    const code = (row.group_code ?? "").trim() || row.name;
    const group = groups.get(code) ?? { code, weight: 0, max: 0, count: 0 };
    group.weight += Number(row.weight_percent ?? 0);
    group.max = Math.max(group.max, Number(row.max_marks ?? 0));
    group.count += 1;
    groups.set(code, group);
  });
  return [...groups.values()];
}

// Everything the structure contributes to the subject total. A blueprint is
// only applicable when this equals the template total (the database enforces
// the same rule).
export function templateContributionTotal(components) {
  let total = 0;
  (components ?? []).forEach((row) => {
    if (row.aggregation === "average") return;
    total += componentContribution(row);
  });
  averageGroups(components).forEach((group) => {
    total += group.weight;
  });
  return Math.round(total * 100) / 100;
}

export function contributionPreview(component) {
  if (!component) return "";
  if (component.aggregation === "scaled") {
    return `${numberText(component.scale_from)} scaled to ${numberText(component.scale_to)}`;
  }
  if (component.aggregation === "average") {
    return `Averaged in group ${component.group_code || "IA"}`;
  }
  return `Contributes ${numberText(componentContribution(component))}`;
}

// One-line label for the component picker in Marks Entry.
export function componentOptionLabel(component) {
  if (!component) return "";
  const parts = [component.name, `max ${numberText(component.max_marks)}`];
  if (component.aggregation === "scaled") {
    parts.push(`${numberText(component.scale_from)} to ${numberText(component.scale_to)}`);
  } else if (component.aggregation === "average") {
    parts.push(`group ${component.group_code || "IA"}`);
  } else if (
    component.weight_percent != null &&
    Number(component.weight_percent) !== Number(component.max_marks)
  ) {
    parts.push(`contributes ${numberText(component.weight_percent)}`);
  }
  if (component.is_external) parts.push("external");
  return parts.join(", ");
}

export function templateMatchesSubjectType(template, subjectType) {
  if (!template) return false;
  if (!subjectType || subjectType === "project") return true;
  return template.subject_type === subjectType;
}
