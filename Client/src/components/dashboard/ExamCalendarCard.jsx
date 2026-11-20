import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import ExamCalendar from "../exams/ExamCalendar";
import { flattenPapers } from "../../lib/exams";

const EXAM_ROLES = ["admin", "teacher", "hod", "exam_cell"];

const EXAM_GROUP_SELECT = `
  id, name, exam_type, starts_on, ends_on, status,
  exams (
    id, class_id, name, exam_type, result_kind, starts_on, ends_on,
    classes ( id, name, section, semester, academic_year, course_id ),
    exam_subjects (
      id, subject_id, exam_date,
      subjects ( id, name, code, subject_type ),
      assessment_components (
        id, name, code, component_type, is_conducted,
        exam_date, start_time, end_time, duration_minutes, room
      )
    )
  )
`;

// Dashboard card. It reads the same semester papers as the examination page, so
// a schedule, reschedule or deletion shows up here as soon as the tables change.
export default function ExamCalendarCard({ className = "" }) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [papers, setPapers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadFailure } = await supabase
      .from("exam_groups")
      .select(EXAM_GROUP_SELECT)
      .in("exam_type", ["semester", "final", "major"])
      .order("starts_on", { ascending: true });

    if (loadFailure) {
      setError(true);
      setLoading(false);
      return;
    }

    setError(false);
    setPapers(flattenPapers(data ?? []).filter((paper) => paper.resultKind === "semester" && paper.date));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();

    const channel = supabase
      .channel(`dashboard-exam-calendar-${profile?.id ?? "guest"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "assessment_components" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "exam_groups" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "exams" }, load)
      .subscribe();

    const onFocus = () => load();
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
      supabase.removeChannel(channel);
    };
  }, [load, profile?.id]);

  const canOpenExams = EXAM_ROLES.includes(profile?.role);
  const subtitle = useMemo(() => {
    if (loading) return "Loading scheduled papers";
    if (error) return "Could not load the examination calendar";
    if (papers.length === 0) return "No papers scheduled yet";
    return "Every dated paper from the semester examination, by paper date";
  }, [loading, error, papers.length]);

  return (
    <div className={className}>
      <ExamCalendar
        papers={papers}
        title="Examination calendar"
        subtitle={subtitle}
        onSelect={(paper) => {
          if (!canOpenExams || !paper?.classId) return;
          navigate("/app/exams", { state: { classId: paper.classId } });
        }}
      />
      {canOpenExams ? (
        <p className="mt-2 text-right">
          <Link to="/app/exams" className="text-xs text-(--primary) hover:underline">
            Open semester examinations
          </Link>
        </p>
      ) : null}
    </div>
  );
}
