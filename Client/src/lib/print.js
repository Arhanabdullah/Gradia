import { gradeFor, resultCodeLabel } from "./status";

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

const truthy = (value, fallback = true) =>
  value === undefined || value === null ? fallback : Boolean(value);

const DEFAULT_REFERENCE_BANDS = [
  { label: "O", min_percent: 90, max_percent: 100, grade_point: 10, is_pass: true },
  { label: "A+", min_percent: 80, max_percent: 89.99, grade_point: 9, is_pass: true },
  { label: "A", min_percent: 70, max_percent: 79.99, grade_point: 8, is_pass: true },
  { label: "B+", min_percent: 60, max_percent: 69.99, grade_point: 7, is_pass: true },
  { label: "B", min_percent: 50, max_percent: 59.99, grade_point: 6, is_pass: true },
  { label: "C", min_percent: 40, max_percent: 49.99, grade_point: 5, is_pass: true },
  { label: "F", min_percent: 0, max_percent: 39.99, grade_point: 0, is_pass: false },
];

const numberText = (value, places = 2) => {
  if (value === null || value === undefined || value === "") return "";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return "";
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(places);
};

const decimalText = (value, places = 2) => {
  if (value === null || value === undefined || value === "") return "Not recorded";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return "Not recorded";
  return numeric.toFixed(places);
};

const bandRange = (band) => `${numberText(band.min_percent)} - ${numberText(band.max_percent)}`;

/**
 * Renders a university grade card in a new window and opens the print dialog.
 * Used by the student result page and the coordinator archive so the printed
 * layout stays identical. The card follows the credit-weighted model:
 * percentage, grade, grade point, credit and earned points per subject, then
 * total credits, total earned points, SGPA, CGPA and the final result code.
 */
export function printResultDocument({
  institution,
  sheet,
  student,
  items = [],
  summary = null,
  format = {},
  bands = [],
  publishedAt = null,
}) {
  const win = window.open("", "_blank", "width=880,height=960");
  if (!win) {
    alert("Popup blocked. Please allow popups for this site to download results.");
    return;
  }

  const rows = items ?? [];
  const totalCredits =
    summary?.total_credits != null
      ? Number(summary.total_credits)
      : rows.reduce((sum, item) => sum + Number(item.credit_hours ?? 0), 0);
  const totalEarnedPoints =
    summary?.total_grade_points != null
      ? Number(summary.total_grade_points)
      : rows.reduce((sum, item) => sum + Number(item.earned_points ?? 0), 0);

  const examName = sheet?.exams?.name ?? sheet?.name ?? "Examination";
  const year = sheet?.exams?.academic_year ?? sheet?.academic_year ?? null;
  const issued = publishedAt || sheet?.published_at;
  const issuedLabel = issued ? new Date(issued).toLocaleDateString() : new Date().toLocaleDateString();

  const institutionName = institution?.name ?? "Institution";
  const institutionLine = [institution?.address, institution?.email, institution?.phone]
    .filter(Boolean)
    .map(escapeHtml)
    .join(", ");

  const title = format?.title || "Grade Card";
  const showSgpa = truthy(format?.show_sgpa, true);
  const showCgpa = truthy(format?.show_cgpa, true);
  const showReferenceTable = truthy(format?.show_reference_table, true);
  const showFormulas = truthy(format?.show_formulas, true);
  const footer = format?.footer || "This grade card is generated from the published result of record.";
  const signatory = format?.signatory || "Controller of Examinations";

  const studentName = student?.name ?? "Not recorded";
  const rollNumber = student?.student_id ?? student?.username ?? "Not recorded";
  const registrationNo = student?.registration_no ?? "Not recorded";
  const programme =
    student?.degrees?.name ??
    student?.courses?.name ??
    student?.classes?.name ??
    sheet?.classes?.name ??
    "Not recorded";
  const department =
    student?.departments?.name ??
    student?.classes?.department ??
    sheet?.classes?.department ??
    "Not recorded";
  const semester = student?.classes?.semester ?? sheet?.classes?.semester ?? null;
  const section = student?.classes?.section ?? sheet?.classes?.section ?? null;

  const code = summary?.result_code ?? null;
  const resultText = code
    ? `${code} - ${resultCodeLabel[code] ?? code}`
    : summary?.is_pass === false
      ? "F - Fail"
      : summary?.is_pass === true
        ? "P - Pass"
        : "Not recorded";
  const promotionText =
    summary?.promotion_eligible == null
      ? null
      : summary.promotion_eligible
        ? "Eligible"
        : "Not eligible";

  const bodyRows = rows.length
    ? rows
        .map((item) => {
          const credit = item.credit_hours;
          const grade = item.grade ?? gradeFor(item.percentage) ?? "";
          const points = item.grade_point;
          const earned =
            item.earned_points != null
              ? item.earned_points
              : credit != null && points != null
                ? Number(credit) * Number(points)
                : null;
          return `<tr>
            <td>${escapeHtml(item.subjects?.code ?? "")}</td>
            <td>${escapeHtml(item.subjects?.name ?? "")}</td>
            <td class="num">${escapeHtml(numberText(credit))}</td>
            <td class="num grade">${escapeHtml(grade)}</td>
            <td class="num">${escapeHtml(numberText(points))}</td>
            <td class="num">${escapeHtml(numberText(earned))}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="6" class="empty">No subject results recorded.</td></tr>`;

  const referenceBands = (bands && bands.length ? bands : DEFAULT_REFERENCE_BANDS)
    .slice()
    .sort((a, b) => Number(b.min_percent) - Number(a.min_percent));

  const referenceRows = referenceBands
    .map(
      (band) => `<tr>
        <td class="grade">${escapeHtml(band.label)}</td>
        <td>${escapeHtml(bandRange(band))}%</td>
        <td class="num">${escapeHtml(numberText(band.grade_point))}</td>
        <td>${band.is_pass === false ? "Fail" : "Pass"}</td>
      </tr>`,
    )
    .join("");

  const summaryCells = [
    ["Total credits", numberText(totalCredits) || "Not recorded"],
    ["Total earned points", numberText(totalEarnedPoints) || "Not recorded"],
    ...(showSgpa ? [["SGPA", decimalText(summary?.sgpa ?? summary?.sgpa_exact)]] : []),
    ...(showCgpa ? [["CGPA", decimalText(summary?.cgpa ?? summary?.cgpa_exact)]] : []),
    ["Result", resultText],
    ...(promotionText ? [["Promotion", promotionText]] : []),
    ["Backlogs", numberText(summary?.backlog_count ?? 0) || "0"],
  ];
  if (summary?.withheld_count > 0) {
    summaryCells.push(["Withheld subjects", numberText(summary.withheld_count)]);
  }

  const summaryHtml = summaryCells
    .map(
      ([label, value]) =>
        `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
    )
    .join("");

  const studentMeta = [
    ["Student name", studentName],
    ["Roll number", rollNumber],
    ["Registration number", registrationNo],
    ["Programme", programme],
    ["Department", department],
    ["Academic year", year ?? "Not recorded"],
    ["Semester", semester != null ? String(semester) : "Not recorded"],
    ...(section ? [["Section", section]] : []),
    ["Examination", examName],
  ];

  const studentHtml = studentMeta
    .map(
      ([label, value]) =>
        `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
    )
    .join("");

  win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(examName)}${year ? ` (${escapeHtml(year)})` : ""} - ${escapeHtml(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; color: #172033; padding: 34px 40px 40px; font-size: 13px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 3px solid #26324f; padding-bottom: 14px; }
  .brand { font-size: 25px; letter-spacing: 0.2px; color: #1c2540; }
  .brand small { display: block; font-size: 11px; color: #667085; margin-top: 4px; font-family: Arial, sans-serif; letter-spacing: 0.1px; }
  .head-right { text-align: right; font-family: Arial, sans-serif; font-size: 11px; color: #667085; line-height: 1.6; }
  .head-right strong { display: block; color: #26324f; font-size: 12px; letter-spacing: 0.6px; text-transform: uppercase; }
  h1 { font-size: 21px; margin: 22px 0 2px; font-weight: 600; color: #1c2540; }
  .subtitle { color: #667085; font-size: 12px; font-family: Arial, sans-serif; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 28px; margin-top: 16px; padding: 14px 16px; border: 1px solid #d7dce5; background: #f8f9fb; }
  .meta div, .summary div { display: flex; justify-content: space-between; gap: 12px; }
  .meta span, .summary span { color: #667085; font-family: Arial, sans-serif; font-size: 11px; }
  .meta strong, .summary strong { font-weight: 600; color: #1c2540; text-align: right; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12.5px; }
  th, td { border: 1px solid #d7dce5; padding: 8px 10px; text-align: left; }
  th { background: #26324f; color: #ffffff; font-size: 10.5px; letter-spacing: 0.4px; text-transform: uppercase; font-family: Arial, sans-serif; font-weight: 600; }
  tbody tr:nth-child(even) { background: #fafbfc; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .grade { color: #26324f; font-weight: 700; text-align: center; }
  th.grade { text-align: center; }
  .total td { font-weight: 700; background: #eef1f6; border-top: 2px solid #26324f; }
  .empty { text-align: center; color: #667085; padding: 18px; }
  .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 28px; margin-top: 16px; padding: 14px 16px; border: 1px solid #d7dce5; background: #f8f9fb; }
  h2 { font-size: 13px; margin: 24px 0 8px; color: #1c2540; font-family: Arial, sans-serif; letter-spacing: 0.4px; text-transform: uppercase; }
  .ref { margin-top: 0; font-size: 12px; }
  .ref th { background: #eef1f6; color: #26324f; }
  .formulas { margin-top: 4px; padding-left: 18px; color: #374151; font-family: Arial, sans-serif; font-size: 11.5px; line-height: 1.8; }
  .stamp { margin-top: 26px; display: flex; justify-content: space-between; gap: 20px; font-size: 10.5px; color: #667085; font-family: Arial, sans-serif; }
  .sign { margin-top: 42px; text-align: right; font-size: 12px; color: #1c2540; }
  .sign span { display: block; margin-top: 2px; font-size: 10.5px; color: #667085; font-family: Arial, sans-serif; }
  .foot { margin-top: 26px; border-top: 1px solid #d7dce5; padding-top: 10px; font-size: 10.5px; color: #667085; text-align: center; font-family: Arial, sans-serif; }
  @page { size: A4; margin: 12mm; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <div class="head">
    <div class="brand">${escapeHtml(institutionName)}<small>${escapeHtml(institutionLine || "Student Result Management System")}</small></div>
    <div class="head-right"><strong>${escapeHtml(title)}</strong>Issued ${escapeHtml(issuedLabel)}</div>
  </div>
  <h1>${escapeHtml(examName)}</h1>
  <p class="subtitle">${year ? `Academic year ${escapeHtml(year)}` : "Published result of record"}</p>

  <div class="meta">${studentHtml}</div>

  <table>
    <thead><tr>
      <th>Subject code</th>
      <th>Subject</th>
      <th class="num">Credit</th>
      <th class="grade">Grade</th>
      <th class="num">Points</th>
      <th class="num">Earned points</th>
    </tr></thead>
    <tbody>
      ${bodyRows}
      <tr class="total">
        <td colspan="2">Total</td>
        <td class="num">${escapeHtml(numberText(totalCredits))}</td>
        <td class="grade"></td>
        <td class="num"></td>
        <td class="num">${escapeHtml(numberText(totalEarnedPoints))}</td>
      </tr>
    </tbody>
  </table>

  <div class="summary">${summaryHtml}</div>

  ${showReferenceTable ? `<h2>Grade reference</h2>
  <table class="ref">
    <thead><tr><th>Grade</th><th>Percentage range</th><th class="num">Grade point</th><th>Result</th></tr></thead>
    <tbody>${referenceRows}</tbody>
  </table>` : ""}

  ${showFormulas ? `<h2>Calculation formulae</h2>
  <ul class="formulas">
    <li>Percentage = (Marks obtained / Maximum marks) x 100</li>
    <li>Earned points = Credit x Grade point</li>
    <li>SGPA = Total earned points / Total credits</li>
    <li>CGPA = Cumulative earned points / Cumulative credits</li>
  </ul>` : ""}

  <div class="stamp"><span>Generated by Gradia, ${escapeHtml(new Date().toLocaleString())}</span><span>Digitally generated document</span></div>
  <div class="sign">${escapeHtml(signatory)}<span>${escapeHtml(institutionName)}</span></div>
  <div class="foot">${escapeHtml(footer)}</div>
</body>
</html>`);
  win.document.close();
  win.focus();
  win.print();
}

export default printResultDocument;

/**
 * Prints a tabular monitoring report. Rows are plain arrays of cell values.
 */
export function printReportDocument({ institution, title, subtitle, sections = [] }) {
  const win = window.open("", "_blank", "width=960,height=900");
  if (!win) {
    alert("Popup blocked. Please allow popups for this site to print reports.");
    return;
  }

  const institutionName = institution?.name ?? "Institution";
  const institutionLine = [institution?.address, institution?.email, institution?.phone]
    .filter(Boolean)
    .map(escapeHtml)
    .join(", ");

  const body = sections
    .map((section) => {
      const header = (section.columns ?? [])
        .map((column) => `<th>${escapeHtml(column)}</th>`)
        .join("");
      const rows = (section.rows ?? [])
        .map(
          (row) =>
            `<tr>${row
              .map((cell) => `<td>${escapeHtml(cell)}</td>`)
              .join("")}</tr>`,
        )
        .join("");
      return `<section>
        <h2>${escapeHtml(section.heading ?? "")}</h2>
        ${section.note ? `<p class="muted">${escapeHtml(section.note)}</p>` : ""}
        <table>
          <thead><tr>${header}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${(section.columns ?? []).length}">No rows</td></tr>`}</tbody>
        </table>
      </section>`;
    })
    .join("");

  win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; color: #111827; padding: 40px; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #6d5430; padding-bottom: 14px; }
  .brand { font-size: 24px; }
  .brand small { display: block; font-size: 11px; color: #6b7280; margin-top: 3px; }
  .muted { color: #6b7280; font-size: 11px; }
  h1 { font-size: 20px; margin: 26px 0 4px; font-weight: 500; }
  h2 { font-size: 14px; margin: 24px 0 8px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #e5e7eb; padding: 7px 9px; text-align: left; }
  th { background: #f3f4f6; font-size: 11px; }
  .foot { margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 10px; font-size: 11px; color: #9ca3af; text-align: center; }
  @media print { body { padding: 24px; } }
</style>
</head>
<body>
  <div class="head">
    <div class="brand">${escapeHtml(institutionName)}<small>${escapeHtml(institutionLine || "Student Result Management System")}</small></div>
    <div class="muted">Generated ${escapeHtml(new Date().toLocaleString())}</div>
  </div>
  <h1>${escapeHtml(title)}</h1>
  ${subtitle ? `<p class="muted">${escapeHtml(subtitle)}</p>` : ""}
  ${body}
  <div class="foot">Generated by Gradia. Read-only monitoring report.</div>
</body>
</html>`);
  win.document.close();
  win.focus();
  win.print();
}

