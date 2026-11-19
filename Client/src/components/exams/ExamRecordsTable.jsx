import { useEffect, useMemo, useState } from "react";
import { Button, StatusChip } from "../ui";
import ExamGroupCard from "./ExamGroupCard";
import {
  activityLabel,
  comparePapers,
  formatExamDate,
  groupIsPublished,
  paperTitle,
  teacherLabel,
  timeRange,
} from "../../lib/exams";

const thClass =
  "whitespace-nowrap px-3 py-2 text-left text-[11px] font-medium text-(--muted-foreground)";
const tdClass = "px-3 py-2 align-top text-xs text-(--foreground)";

function ModalShell({ labelledBy, onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-(--background)/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onMouseDown={onClose}
    >
      <div
        className="glass-inner max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl p-5"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// One row per schedulable paper. The row carries every academic label so the
// record can be read without opening anything, and the actions reuse the
// existing scheduler, paper dialog and subject tools instead of duplicating them.
export default function ExamRecordsTable({
  papers,
  profile,
  teachers = [],
  degrees = [],
  departments = [],
  courses = [],
  subjects = [],
  classSubjects = [],
  templates = [],
  templateComponents = [],
  canManageGroup,
  canDeleteGroup,
  onEdit,
  onReschedule,
  onDelete,
  onChanged,
  onNotify,
}) {
  const [viewPaper, setViewPaper] = useState(null);
  const [deletePaper, setDeletePaper] = useState(null);

  const courseById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
  const departmentById = useMemo(
    () => new Map(departments.map((department) => [department.id, department])),
    [departments],
  );
  const degreeById = useMemo(() => new Map(degrees.map((degree) => [degree.id, degree])), [degrees]);
  const teacherById = useMemo(() => new Map(teachers.map((teacher) => [teacher.id, teacher])), [teachers]);

  useEffect(() => {
    if (!viewPaper && !deletePaper) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      setViewPaper(null);
      setDeletePaper(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [viewPaper, deletePaper]);

  const sorted = useMemo(
    () => [...papers].sort((a, b) => comparePapers(a, b) || paperTitle(a).localeCompare(paperTitle(b))),
    [papers],
  );

  const departmentName = (paper) => {
    const departmentId = courseById.get(paper.courseId)?.department_id ?? paper.departmentId;
    return departmentById.get(departmentId)?.name ?? paper.group?.departments?.name ?? "Not set";
  };

  const courseName = (paper) => paper.courseName || courseById.get(paper.courseId)?.name || "Not set";
  const degreeName = (paper) => degreeById.get(paper.degreeId)?.name ?? "";
  const teacherName = (paper) => {
    if (!paper.teacherId) return "Not assigned";
    const teacher = teacherById.get(paper.teacherId);
    return teacher ? teacherLabel(teacher) : "Assigned teacher";
  };

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-(--border-subtle)">
        <table className="min-w-full text-left text-xs">
          <caption className="sr-only">Scheduled examination papers</caption>
          <thead className="bg-(--surface-secondary)">
            <tr className="border-b border-(--border-subtle)">
              <th scope="col" className={thClass}>Examination type</th>
              <th scope="col" className={thClass}>Subject</th>
              <th scope="col" className={thClass}>Department</th>
              <th scope="col" className={thClass}>Course</th>
              <th scope="col" className={thClass}>Academic year</th>
              <th scope="col" className={thClass}>Batch</th>
              <th scope="col" className={thClass}>Class</th>
              <th scope="col" className={thClass}>Semester</th>
              <th scope="col" className={thClass}>Date</th>
              <th scope="col" className={thClass}>Teacher</th>
              <th scope="col" className={thClass}>Status</th>
              <th scope="col" className={thClass}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((paper) => {
              const published = groupIsPublished(paper.group);
              const manageable = !published && canManageGroup(paper.group);
              const deletable = !published && canDeleteGroup(paper.group);
              return (
                <tr key={paper.key} className="border-b border-(--border-subtle)/60 last:border-b-0">
                  <td className={tdClass}>
                    <p className="font-medium">{activityLabel(paper.activity)}</p>
                    <p className="mt-0.5 text-[11px] text-(--muted-foreground)">
                      {paper.component?.name ?? paper.examName}
                    </p>
                  </td>
                  <td className={tdClass}>
                    <p className="font-medium">{paper.subjectName}</p>
                    <p className="mt-0.5 text-[11px] text-(--muted-foreground)">
                      {paper.subjectCode || "No code"}
                      {paper.maxMarks != null ? `, max ${paper.maxMarks}` : ""}
                    </p>
                  </td>
                  <td className={tdClass}>{departmentName(paper)}</td>
                  <td className={tdClass}>
                    <p>{courseName(paper)}</p>
                    {degreeName(paper) ? (
                      <p className="mt-0.5 text-[11px] text-(--muted-foreground)">{degreeName(paper)}</p>
                    ) : null}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap`}>{paper.academicYear || "Not set"}</td>
                  <td className={tdClass}>{paper.batch || "Not set"}</td>
                  <td className={tdClass}>{paper.className}</td>
                  <td className={`${tdClass} whitespace-nowrap`}>
                    {paper.semester != null ? `Semester ${paper.semester}` : "Not set"}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap`}>
                    <p>{formatExamDate(paper.date)}</p>
                    <p className="mt-0.5 text-[11px] text-(--muted-foreground)">
                      {timeRange(paper.start, paper.end)}
                    </p>
                  </td>
                  <td className={tdClass}>{teacherName(paper)}</td>
                  <td className={tdClass}>
                    <StatusChip status={paper.status} />
                    {published ? (
                      <span className="mt-1 block">
                        <StatusChip status="published" />
                      </span>
                    ) : null}
                  </td>
                  <td className={tdClass}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button type="button" variant="subtle" onClick={() => setViewPaper(paper)}>
                        View
                      </Button>
                      {manageable ? (
                        <>
                          <Button type="button" variant="subtle" onClick={() => onEdit(paper.group)}>
                            Edit
                          </Button>
                          <Button type="button" variant="subtle" onClick={() => onReschedule(paper)}>
                            Reschedule
                          </Button>
                        </>
                      ) : null}
                      {deletable ? (
                        <Button type="button" variant="subtle" onClick={() => setDeletePaper(paper)}>
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {viewPaper ? (
        <ModalShell labelledBy="exam-record-view" onClose={() => setViewPaper(null)}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs text-(--muted-foreground)">Examination record</p>
              <h3 id="exam-record-view" className="mt-1 text-lg font-semibold tracking-tight text-(--foreground)">
                {paperTitle(viewPaper)}
              </h3>
              <p className="mt-1 text-xs text-(--muted-foreground)">
                {activityLabel(viewPaper.activity)}, {viewPaper.className}
              </p>
            </div>
            <Button type="button" variant="subtle" onClick={() => setViewPaper(null)}>
              Close
            </Button>
          </div>
          <div className="mt-4">
            <ExamGroupCard
              group={viewPaper.group}
              teachers={teachers}
              degrees={degrees}
              subjects={subjects}
              classSubjects={classSubjects}
              templates={templates}
              templateComponents={templateComponents}
              canManage={canManageGroup(viewPaper.group)}
              canEditSubjects={profile?.role === "admin" || profile?.role === "exam_cell"}
              onEditSchedule={onEdit}
              onChanged={() => {
                onChanged?.();
                setViewPaper(null);
              }}
              onNotify={onNotify}
            />
          </div>
        </ModalShell>
      ) : null}

      {deletePaper ? (
        <ModalShell labelledBy="exam-record-delete" onClose={() => setDeletePaper(null)}>
          <h3 id="exam-record-delete" className="text-lg font-semibold tracking-tight text-(--foreground)">
            Delete this examination?
          </h3>
          <p className="mt-2 text-sm text-(--muted-foreground)">
            {deletePaper.examName} will be removed with every subject and paper in its group, including{" "}
            {deletePaper.className}. Marks and published results cannot be deleted, so the database will refuse
            the change when they exist.
          </p>
          <div className="mt-4 rounded-lg border border-(--border-subtle) bg-(--surface-secondary)/40 px-3 py-2 text-xs text-(--muted-foreground)">
            {paperTitle(deletePaper)}
            {deletePaper.date ? `, ${formatExamDate(deletePaper.date)}` : ""}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="subtle" onClick={() => setDeletePaper(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                const target = deletePaper;
                setDeletePaper(null);
                onDelete(target);
              }}
            >
              Delete examination
            </Button>
          </div>
        </ModalShell>
      ) : null}
    </>
  );
}
