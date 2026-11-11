// Shared attendance calculations. The database stores attended/total counts
// and a generated per-subject percentage; these helpers keep the dashboard and
// profile views using exactly the same formula.

export function attendancePercentage(attended, total) {
  const attendedCount = Number(attended);
  const totalCount = Number(total);
  if (!Number.isFinite(attendedCount) || !Number.isFinite(totalCount) || totalCount <= 0) {
    return null;
  }
  return Math.round((attendedCount / totalCount) * 1000) / 10;
}

export function formatAttendance(value) {
  return value === null || value === undefined || Number.isNaN(Number(value))
    ? "n/a"
    : `${Number(value).toFixed(1)}%`;
}

function subjectMeta(row) {
  const subject = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;
  return {
    id: row.subject_id ?? subject?.id ?? subject?.code ?? subject?.name ?? "unknown",
    name: subject?.name ?? "Subject",
    code: subject?.code ?? "",
  };
}

export function summarizeAttendance(rows = []) {
  const subjects = new Map();
  let attended = 0;
  let total = 0;

  rows.forEach((row) => {
    const attendedCount = Number(row.attended_classes ?? 0);
    const totalCount = Number(row.total_classes ?? 0);
    if (!Number.isFinite(attendedCount) || !Number.isFinite(totalCount) || totalCount <= 0) {
      return;
    }

    attended += attendedCount;
    total += totalCount;

    const meta = subjectMeta(row);
    const current = subjects.get(meta.id) ?? {
      ...meta,
      attended: 0,
      total: 0,
      records: 0,
    };
    current.attended += attendedCount;
    current.total += totalCount;
    current.records += 1;
    subjects.set(meta.id, current);
  });

  const subjectRows = [...subjects.values()]
    .map((subject) => ({
      ...subject,
      percentage: attendancePercentage(subject.attended, subject.total),
    }))
    .sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name));

  return {
    attended,
    total,
    percentage: attendancePercentage(attended, total),
    subjects: subjectRows,
    records: rows.length,
  };
}
