import gradiaLogoMarkup from "../assets/gradia-logo.svg?raw";
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

const fixedText = (value, places = 2) => {
  if (value === null || value === undefined || value === "") return "";
  const numeric = Number(value);
  return Number.isNaN(numeric) ? "" : numeric.toFixed(places);
};

const decimalText = (value, places = 2) => {
  if (value === null || value === undefined || value === "") return "Not recorded";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return "Not recorded";
  return numeric.toFixed(places);
};

const bandRange = (band) => `${numberText(band.min_percent)} - ${numberText(band.max_percent)}`;

const dateLabel = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
};

const resultParts = (code, summary) => {
  if (code) return { code, label: resultCodeLabel[code] ?? code };
  if (summary?.is_pass === false) return { code: "F", label: "Fail" };
  if (summary?.is_pass === true) return { code: "P", label: "Pass" };
  return { code: "NR", label: "Not recorded" };
};

const printWhenReady = (win) => {
  const run = () => {
    if (!win.closed) {
      win.__fitGradeCard?.();
      win.focus();
      win.print();
    }
  };

  if (!win.document.fonts?.ready) {
    run();
    return;
  }

  const fallback = new Promise((resolve) => win.setTimeout(resolve, 1800));
  Promise.race([win.document.fonts.ready, fallback]).then(run, run);
};

/**
 * Only an official semester result issues a grade card. Internal assessments
 * stay on the dashboard and never produce a printable document.
 */
export function canPrintGradeCard(sheet) {
  return sheet?.result_kind === "semester";
}

/**
 * Renders a credit-weighted grade card as a balanced A4 document in a new
 * window and opens the print dialog. The same document is used by the student
 * result page and the coordinator archive.
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
  if (!canPrintGradeCard(sheet)) {
    alert("Only a published semester result can be printed as a grade card.");
    return;
  }

  const win = window.open("", "_blank", "width=900,height=1000");
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
  const issuedLabel = dateLabel(publishedAt || sheet?.published_at);

  const institutionName = institution?.name ?? "Institution";
  const institutionLine = [institution?.address, institution?.email, institution?.phone]
    .filter(Boolean)
    .map(escapeHtml)
    .join(", ");

  const title = format?.title || "Grade Card";
  const showCredits = truthy(format?.show_credits, true);
  const showPercentage = truthy(format?.show_percentage, true);
  const showGradePoints = truthy(format?.show_grade_points, true);
  const showSgpa = truthy(format?.show_sgpa, true);
  const showCgpa = truthy(format?.show_cgpa, true);
  const showReferenceTable = truthy(format?.show_reference_table, true);
  const showFormulas = truthy(format?.show_formulas, true);
  const verificationCode = format?.verificationCode ?? null;
  const footer =
    format?.footer || "This grade card is generated from the published result of record.";
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

  const result = resultParts(summary?.result_code ?? null, summary);
  const promotionText =
    summary?.promotion_eligible == null
      ? null
      : summary.promotion_eligible
        ? "Eligible"
        : "Not eligible";

  const columnCount =
    2 + Number(showCredits) + Number(showPercentage) + 1 + Number(showGradePoints) + 1;
  const density = rows.length > 14 ? "dense" : rows.length > 10 ? "compact" : "";

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
          const percent =
            item.percentage != null
              ? item.percentage
              : Number(item.max_marks) > 0
                ? (Number(item.marks_obtained) / Number(item.max_marks)) * 100
                : null;
          const percentLabel = fixedText(percent, 2);

          return `<tr>
            <td class="code">${escapeHtml(item.subjects?.code ?? "")}</td>
            <td class="subject subject-col">${escapeHtml(item.subjects?.name ?? "")}</td>
            ${showCredits ? `<td class="num col-credit">${escapeHtml(numberText(credit))}</td>` : ""}
            ${showPercentage ? `<td class="num col-percent">${percentLabel ? `${escapeHtml(percentLabel)}%` : ""}</td>` : ""}
            <td class="num grade col-grade">${escapeHtml(grade)}</td>
            ${showGradePoints ? `<td class="num col-point">${escapeHtml(numberText(points))}</td>` : ""}
            <td class="num col-earned">${escapeHtml(numberText(earned))}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td class="empty" colspan="${columnCount}">No subject results recorded.</td></tr>`;

  const totalRow = `<tr class="total-row">
    <td colspan="2">Total</td>
    ${showCredits ? `<td class="num">${escapeHtml(numberText(totalCredits))}</td>` : ""}
    ${showPercentage ? '<td class="num"></td>' : ""}
    <td class="num grade"></td>
    ${showGradePoints ? '<td class="num"></td>' : ""}
    <td class="num">${escapeHtml(numberText(totalEarnedPoints))}</td>
  </tr>`;

  const referenceBands = (bands && bands.length ? bands : DEFAULT_REFERENCE_BANDS)
    .slice()
    .sort((a, b) => Number(b.min_percent) - Number(a.min_percent));

  const referenceRows = referenceBands
    .map(
      (band) => `<tr>
        <td class="num grade">${escapeHtml(band.label)}</td>
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
  ];

  const summaryHtml = summaryCells
    .map(
      ([label, value]) =>
        `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
    )
    .join("");

  const resultMeta = [
    promotionText ? ["Promotion", promotionText] : null,
    ["Backlogs", numberText(summary?.backlog_count ?? 0) || "0"],
    summary?.withheld_count > 0
      ? ["Withheld", numberText(summary.withheld_count)]
      : null,
  ]
    .filter(Boolean)
    .map(([label, value]) => `<span>${escapeHtml(label)} ${escapeHtml(value)}</span>`)
    .join("");

  const studentMeta = [
    ["Student name", studentName, true],
    ["Roll number", rollNumber],
    ["Registration number", registrationNo],
    ["Programme", programme, true],
    ["Department", department],
    ["Academic year", year ?? "Not recorded"],
    ["Semester", semester != null ? String(semester) : "Not recorded"],
    ["Section", section ?? "Not recorded"],
    ["Examination", examName, true],
  ];

  const studentHtml = studentMeta
    .map(
      ([label, value, full]) =>
        `<div class="profile-item${full ? " full" : ""}">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>`,
    )
    .join("");

  win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(examName)} (${escapeHtml(year ?? "")}) - ${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  :root {
    --ink: #172033;
    --muted: #5f6875;
    --faint: #8a93a1;
    --line: #d8dde5;
    --soft: #f7f8fa;
    --accent: #b8873b;
  }

  @page { size: A4 portrait; margin: 0; }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: #e8ecf1;
    color: var(--ink);
    font-family: "Plus Jakarta Sans", "Segoe UI", Arial, sans-serif;
    font-size: 8.6pt;
    line-height: 1.2;
    padding: 10mm;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page {
    width: 210mm;
    height: 297mm;
    margin: 0 auto;
    padding: 13mm 15mm 10mm;
    overflow: hidden;
    background: #ffffff;
    border: 0.7pt solid var(--line);
    box-shadow: 0 10px 30px rgba(23, 32, 51, 0.12);
  }

  .sheet { width: 100%; height: 100%; display: flex; flex-direction: column; }

  .masthead {
    display: grid;
    grid-template-columns: 62mm 1fr;
    gap: 8mm;
    align-items: center;
    padding-bottom: 3.5mm;
    border-bottom: 1pt solid var(--ink);
    position: relative;
  }

  .masthead::after {
    content: "";
    position: absolute;
    left: 0;
    bottom: -0.6mm;
    width: 34mm;
    height: 1.2pt;
    background: var(--accent);
  }

  .logo svg { display: block; width: 52mm; height: auto; }

  .institution { text-align: right; }
  .institution strong {
    display: block;
    font-family: "Instrument Serif", Georgia, serif;
    font-size: 14pt;
    font-weight: 400;
    color: var(--ink);
  }
  .institution p {
    margin-top: 0.8mm;
    font-size: 8.25pt;
    color: var(--muted);
    line-height: 1.25;
  }

  .title-block { text-align: center; padding: 3.5mm 0 2.5mm; }
  .title-block h1 {
    font-family: "Instrument Serif", Georgia, serif;
    font-size: 18pt;
    font-weight: 400;
    letter-spacing: 0;
    color: var(--ink);
    line-height: 1.1;
  }
  .title-block .exam { margin-top: 1mm; font-size: 9.5pt; font-weight: 600; line-height: 1.2; }
  .title-block .subtitle { margin-top: 0.5mm; font-size: 8.25pt; color: var(--muted); line-height: 1.2; }

  .profile {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1.4mm 3mm;
    padding: 2.5mm 3mm;
    border: 0.7pt solid var(--line);
    background: var(--soft);
    break-inside: avoid;
  }
  .profile-item.full { grid-column: span 2; }
  .profile-item span { display: block; font-size: 8.25pt; color: var(--muted); line-height: 1.15; }
  .profile-item strong {
    display: block;
    margin-top: 0.3mm;
    font-size: 8.6pt;
    color: var(--ink);
    font-weight: 600;
    line-height: 1.15;
    overflow-wrap: anywhere;
  }

  .marks-section { margin-top: 3.5mm; }
  .section-heading {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 4mm;
    margin-bottom: 1.5mm;
  }
  .section-heading h2 {
    font-family: "Instrument Serif", Georgia, serif;
    font-size: 12pt;
    font-weight: 400;
  }
  .section-heading span { font-size: 8.25pt; color: var(--muted); }

  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td {
    border: 0.6pt solid var(--line);
    padding: 1mm 1.6mm;
    vertical-align: middle;
    font-size: 8.25pt;
    line-height: 1.15;
  }
  thead { display: table-header-group; }
  thead th {
    background: var(--ink);
    color: #ffffff;
    font-size: 8.25pt;
    font-weight: 600;
  }
  tbody tr:nth-child(even) { background: #fafbfc; }
  tr { break-inside: avoid; }
  .code { width: 19mm; }
  .subject { overflow-wrap: anywhere; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .grade { text-align: center; font-weight: 700; }
  thead th.grade { text-align: center; }
  .total-row td { background: #f1f3f6; border-top: 1.2pt solid var(--ink); font-weight: 700; }
  .empty { text-align: center; color: var(--muted); padding: 3mm; }
  .compact th, .compact td { padding: 0.6mm 1.2mm; line-height: 1.08; }
  .dense th, .dense td { padding: 0.4mm 1mm; line-height: 1.05; }
  .sheet.compact .formula-strip { display: none; }
  .sheet.compact .attestation { padding-top: 3mm; }
  .sheet.dense .reference-panel, .sheet.dense .formula-strip { display: none; }
  .sheet.dense .lower-grid { grid-template-columns: 1fr; }
  .sheet.dense .attestation { padding-top: 2mm; }

  .lower-grid {
    display: grid;
    grid-template-columns: 1.05fr 0.95fr;
    gap: 3mm;
    margin-top: 3.5mm;
    break-inside: avoid;
  }
  .lower-grid.single { grid-template-columns: 1fr; }
  .panel { border: 0.7pt solid var(--line); background: #ffffff; padding: 2.2mm 2.6mm; }
  .panel h2 {
    font-family: "Instrument Serif", Georgia, serif;
    font-size: 10pt;
    font-weight: 400;
    line-height: 1.1;
    margin-bottom: 1.5mm;
  }
  .metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1mm 3mm; }
  .metric {
    display: flex;
    justify-content: space-between;
    gap: 2mm;
    border-bottom: 0.5pt dotted var(--line);
    padding-bottom: 0.6mm;
    line-height: 1.15;
  }
  .metric span { color: var(--muted); font-size: 8.25pt; }
  .metric strong { font-size: 8.6pt; font-variant-numeric: tabular-nums; text-align: right; line-height: 1.15; }
  .result-band {
    margin-top: 1.8mm;
    padding: 1.5mm 2mm;
    background: var(--ink);
    color: #ffffff;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 2mm;
  }
  .result-band span { font-size: 8.25pt; opacity: 0.8; }
  .result-band strong {
    font-family: "Instrument Serif", Georgia, serif;
    font-size: 10.5pt;
    font-weight: 400;
    line-height: 1.1;
  }
  .result-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5mm 3mm;
    margin-top: 1.2mm;
    font-size: 8.25pt;
    line-height: 1.15;
    color: var(--muted);
  }

  .ref { font-size: 8.25pt; line-height: 1.1; }
  .ref th, .ref td { padding: 0.8mm 1.4mm; }
  .ref th { background: #eef1f5; color: var(--ink); }

  .formula-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 1mm 4mm;
    margin-top: 2.5mm;
    padding: 1.8mm 2mm;
    border-left: 1.5pt solid var(--accent);
    background: #faf8f3;
    font-size: 8.25pt;
    line-height: 1.15;
    color: var(--muted);
  }
  .formula-strip b { color: var(--ink); font-weight: 600; }

  .attestation {
    margin-top: auto;
    padding-top: 4mm;
    display: grid;
    grid-template-columns: 1fr 55mm;
    gap: 10mm;
    align-items: end;
    break-inside: avoid;
  }
  .attestation-note { font-size: 8.25pt; color: var(--muted); line-height: 1.3; }
  .attestation-note strong { display: block; color: var(--ink); font-size: 8.6pt; margin-bottom: 0.8mm; line-height: 1.15; }
  .signature { text-align: center; }
  .signature-line { height: 5mm; border-bottom: 0.7pt solid var(--ink); margin-bottom: 1.5mm; }
  .signature strong { display: block; font-size: 8.6pt; line-height: 1.15; }
  .signature span { display: block; font-size: 8.25pt; color: var(--muted); margin-top: 0.4mm; line-height: 1.15; }

  .page-foot {
    margin-top: 3mm;
    padding-top: 1.5mm;
    border-top: 0.6pt solid var(--line);
    display: flex;
    justify-content: space-between;
    gap: 4mm;
    font-size: 8.25pt;
    line-height: 1.15;
    color: var(--faint);
  }

  @media print {
    body { padding: 0; background: #ffffff; }
    .page { border: 0; box-shadow: none; margin: 0; }
  }
</style>
</head>
<body>
  <div class="page">
    <div class="sheet ${density}">
      <header class="masthead">
        <div class="logo">${gradiaLogoMarkup}</div>
        <div class="institution">
          <strong>${escapeHtml(institutionName)}</strong>
          <p>${escapeHtml(institutionLine || "Student Result Management System")}</p>
        </div>
      </header>

      <section class="title-block">
        <h1>${escapeHtml(title)}</h1>
        <p class="exam">${escapeHtml(examName)}</p>
        <p class="subtitle">${year ? `Academic year ${escapeHtml(year)}, issued ${escapeHtml(issuedLabel)}` : `Issued ${escapeHtml(issuedLabel)}`}</p>
      </section>

      <section class="profile" aria-label="Student details">${studentHtml}</section>

      <section class="marks-section">
        <div class="section-heading">
          <h2>Subject performance</h2>
          <span>Credit-weighted assessment</span>
        </div>
        <table class="${density}">
          <thead>
            <tr>
              <th class="code">Code</th>
              <th>Subject</th>
              ${showCredits ? '<th class="num">Credit</th>' : ""}
              ${showPercentage ? '<th class="num">Percentage</th>' : ""}
              <th class="grade">Grade</th>
              ${showGradePoints ? '<th class="num">Point</th>' : ""}
              <th class="num">Earned</th>
            </tr>
          </thead>
          <tbody>
            ${bodyRows}
            ${totalRow}
          </tbody>
        </table>
      </section>

      <div class="lower-grid${showReferenceTable ? "" : " single"}">
        <section class="panel">
          <h2>Academic summary</h2>
          <div class="metric-grid">${summaryHtml}</div>
          <div class="result-band">
            <span>Result</span>
            <strong>${escapeHtml(result.label)}</strong>
          </div>
          <div class="result-meta">${resultMeta}</div>
        </section>

        ${showReferenceTable ? `<section class="panel reference-panel">
          <h2>Grade reference</h2>
          <table class="ref">
            <thead><tr><th class="grade">Grade</th><th>Percentage range</th><th class="num">Point</th><th>Outcome</th></tr></thead>
            <tbody>${referenceRows}</tbody>
          </table>
        </section>` : ""}
      </div>

      ${showFormulas ? `<div class="formula-strip">
        <span><b>Percentage</b> marks obtained / maximum marks x 100</span>
        <span><b>Earned points</b> credit x grade point</span>
        <span><b>SGPA</b> earned points / semester credits</span>
        <span><b>CGPA</b> cumulative earned points / cumulative credits</span>
      </div>` : ""}

      <section class="attestation">
        <div class="attestation-note">
          <strong>Result of record</strong>
          <p>${escapeHtml(footer)}</p>
        </div>
        <div class="signature">
          <div class="signature-line"></div>
          <strong>${escapeHtml(signatory)}</strong>
          <span>${escapeHtml(institutionName)}</span>
        </div>
      </section>

      <footer class="page-foot">
        <span>Generated by Gradia</span>
        <span>Issued ${escapeHtml(issuedLabel)}, page 1 of 1${verificationCode ? `, document ID ${escapeHtml(verificationCode)}` : ""}</span>
      </footer>
    </div>
  </div>
  <script>
    (function () {
      const fit = () => {
        const page = document.querySelector(".page");
        const sheet = document.querySelector(".sheet");
        if (!page || !sheet) return;

        const style = getComputedStyle(page);
        const available =
          page.getBoundingClientRect().height -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom) -
          parseFloat(style.borderTopWidth) -
          parseFloat(style.borderBottomWidth);

        let scale = 1;
        sheet.style.width = "100%";
        sheet.style.height = "100%";
        sheet.style.transform = "none";

        for (let index = 0; index < 6; index += 1) {
          const inverse = String(100 / scale) + "%";
          sheet.style.width = inverse;
          sheet.style.height = inverse;
          sheet.style.transformOrigin = "top left";
          sheet.style.transform = "scale(" + String(scale) + ")";

          const contentHeight = sheet.scrollHeight * scale;
          if (contentHeight <= available + 1 || scale <= 0.7) break;
          scale = Math.max(0.7, scale * (available / contentHeight));
        }
      };

      window.__fitGradeCard = fit;
      if (document.fonts?.ready) document.fonts.ready.then(fit, fit);
    })();
  </script>
</body>
</html>`);
  win.document.close();
  printWhenReady(win);
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
