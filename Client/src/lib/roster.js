import { supabase } from "./supabase";

// Enrolled students are the source of truth, while profiles.class_id keeps
// older classes working. Mirrors the roster logic used by marks entry.
export async function fetchClassStudents(classId) {
  const { data: enrollments, error: enrollmentError } = await supabase
    .from("student_enrollments")
    .select("student_id")
    .eq("class_id", classId)
    .eq("status", "active");
  if (enrollmentError) throw new Error(enrollmentError.message);

  const enrolledIds = [...new Set((enrollments ?? []).map((row) => row.student_id))];
  const columns = "id, name, username";

  const [enrolledRes, classRes] = await Promise.all([
    enrolledIds.length > 0
      ? supabase
          .from("profiles")
          .select(columns)
          .in("id", enrolledIds)
          .eq("role", "student")
          .eq("is_active", true)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("profiles")
      .select(columns)
      .eq("class_id", classId)
      .eq("role", "student")
      .eq("is_active", true),
  ]);

  const error = enrolledRes.error ?? classRes.error;
  if (error) throw new Error(error.message);

  const map = new Map();
  [...(enrolledRes.data ?? []), ...(classRes.data ?? [])].forEach((student) => map.set(student.id, student));
  return [...map.values()].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}
