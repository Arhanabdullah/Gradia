// Gradia — secure admin-only account creation.
// Deploy: npx supabase functions deploy create-user --project-ref <project-ref>
//
// Security model:
//   * The caller must be an ACTIVE admin profile (checked with the service
//     client, so RLS can never widen the check).
//   * Role and academic scope are NEVER taken from user_metadata. The auth
//     trigger creates a plain student, then this function applies the
//     validated role/scope with the service role.
//   * If the profile update fails, the auth user is deleted so no orphan
//     account is left behind.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const allowedRoles = new Set(["student", "teacher", "hod", "principal", "admin"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value) => uuidPattern.test(value);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) return json({ error: "Server configuration is incomplete" }, 500);

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Unauthorized" }, 401);
    const callerClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: caller, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !caller?.user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: callerProfile, error: profileError } = await admin
      .from("profiles")
      .select("role, is_active")
      .eq("id", caller.user.id)
      .maybeSingle();
    if (profileError) {
      console.error("create-user: caller profile lookup failed", profileError.message);
      return json({ error: "Could not verify your account" }, 500);
    }
    if (!callerProfile || callerProfile.role !== "admin" || !callerProfile.is_active) {
      return json({ error: "Only active admins can create accounts" }, 403);
    }

    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const name = String(body.name ?? "").trim();
    const username = String(body.username ?? "").trim() || email.split("@")[0];
    const role = String(body.role ?? "student").toLowerCase();
    const studentId = String(body.student_id ?? "").trim();
    const teacherId = String(body.teacher_id ?? "").trim();
    const departmentId = String(body.department_id ?? "").trim();
    const degreeId = String(body.degree_id ?? "").trim();
    const courseId = String(body.course_id ?? "").trim();
    const classId = String(body.class_id ?? "").trim();
    const hodType = String(body.hod_type ?? "").trim();
    const hodSubjectId = String(body.hod_subject_id ?? "").trim();

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: "A valid email address is required" }, 400);
    if (password.length < 6) return json({ error: "Password must contain at least 6 characters" }, 400);
    if (!name) return json({ error: "Full name is required" }, 400);
    if (!allowedRoles.has(role)) return json({ error: "Invalid account role" }, 400);
    if (!username) return json({ error: "Username is required" }, 400);

    const scopeIds = { departmentId, degreeId, courseId, classId, hodSubjectId };
    for (const [key, value] of Object.entries(scopeIds)) {
      if (value && !isUuid(value)) return json({ error: `Invalid ${key} identifier` }, 400);
    }

    if (role === "student" && (!studentId || !departmentId || !degreeId || !courseId || !classId)) {
      return json({ error: "Students require Student ID, Department, Degree, Course and Class" }, 400);
    }
    if (role === "teacher" && !teacherId) return json({ error: "Teacher ID is required" }, 400);
    if (role === "hod" && !["department", "subject"].includes(hodType)) {
      return json({ error: "Choose Department HOD or Subject HOD" }, 400);
    }
    if (role === "hod" && hodType === "department" && (!departmentId || !degreeId)) {
      return json({ error: "Select a department and degree for this HOD" }, 400);
    }
    if (role === "hod" && hodType === "subject" && !hodSubjectId) {
      return json({ error: "Select a subject for this HOD" }, 400);
    }

    if (role === "student") {
      const [{ data: department }, { data: degree }, { data: course }, { data: klass }] = await Promise.all([
        admin.from("departments").select("id").eq("id", departmentId).maybeSingle(),
        admin.from("degrees").select("id").eq("id", degreeId).maybeSingle(),
        admin.from("courses").select("id, department_id, degree_id").eq("id", courseId).maybeSingle(),
        admin.from("classes").select("id, course_id, degree_id").eq("id", classId).maybeSingle(),
      ]);
      if (!department) return json({ error: "Selected department was not found" }, 400);
      if (!degree) {
        return json({ error: "Selected degree was not found" }, 400);
      }
      if (!course || course.department_id !== departmentId) {
        return json({ error: "Selected course does not belong to the selected department" }, 400);
      }
      if (course.degree_id && course.degree_id !== degreeId) {
        return json({ error: "Selected course does not belong to the selected degree" }, 400);
      }
      if (!klass) return json({ error: "Selected class was not found" }, 400);
      if (klass.course_id && klass.course_id !== courseId) {
        return json({ error: "Selected class does not belong to the selected course" }, 400);
      }
      if (klass.degree_id && klass.degree_id !== degreeId) {
        return json({ error: "Selected class does not belong to the selected degree" }, 400);
      }
    }
    if (role === "hod" && hodType === "department") {
      const [{ data: department }, { data: degree }] = await Promise.all([
        admin.from("departments").select("id").eq("id", departmentId).maybeSingle(),
        admin.from("degrees").select("id").eq("id", degreeId).maybeSingle(),
      ]);
      if (!department) return json({ error: "Selected department was not found" }, 400);
      if (!degree) {
        return json({ error: "Selected degree was not found" }, 400);
      }
      if (courseId) {
        const { data: course } = await admin
          .from("courses")
          .select("id, department_id, degree_id")
          .eq("id", courseId)
          .maybeSingle();
        if (!course || course.department_id !== departmentId) {
          return json({ error: "Selected course does not belong to the selected department" }, 400);
        }
        if (course.degree_id && course.degree_id !== degreeId) {
          return json({ error: "Selected course does not belong to the selected degree" }, 400);
        }
      }
    }
    if (role === "hod" && hodType === "subject") {
      const { data } = await admin.from("subjects").select("id").eq("id", hodSubjectId).maybeSingle();
      if (!data) return json({ error: "Selected subject was not found" }, 400);
    }

    if (studentId) {
      const { data } = await admin.from("profiles").select("id").eq("student_id", studentId).maybeSingle();
      if (data) return json({ error: "This Student ID is already in use" }, 409);
    }
    if (teacherId) {
      const { data } = await admin.from("profiles").select("id").eq("teacher_id", teacherId).maybeSingle();
      if (data) return json({ error: "This Teacher ID is already in use" }, 409);
    }

    const { data: usernameTaken } = await admin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();
    if (usernameTaken) return json({ error: "This username is already in use" }, 409);

    // Only non-privileged fields travel in metadata. The trigger ignores
    // any role/scope keys even if a caller adds them manually.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, username },
    });
    if (createError) {
      const duplicate = /already|exists|registered/i.test(createError.message ?? "");
      return json({ error: duplicate ? "An account with this email already exists" : "Could not create the account" }, 400);
    }

    const userId = created?.user?.id;
    if (!userId) return json({ error: "Could not create the account" }, 500);

    const patch = {
      name,
      role,
      student_id: role === "student" ? studentId : null,
      teacher_id: role === "teacher" ? teacherId : null,
      department_id:
        role === "student" || (role === "hod" && hodType === "department") ? departmentId : null,
      degree_id:
        role === "student" || (role === "hod" && hodType === "department") ? degreeId : null,
      course_id:
        role === "student" || (role === "hod" && hodType === "department") ? courseId || null : null,
      class_id: role === "student" ? classId : null,
      hod_type: role === "hod" ? hodType : null,
      hod_subject_id: role === "hod" && hodType === "subject" ? hodSubjectId : null,
    };

    const { data: updated, error: updateError } = await admin
      .from("profiles")
      .update(patch)
      .eq("id", userId)
      .select("id")
      .maybeSingle();

    if (updateError || !updated) {
      console.error("create-user: profile update failed", updateError?.message);
      await admin.auth.admin.deleteUser(userId).catch(() => {});
      return json({ error: "Could not finish setting up the account" }, 500);
    }

    // Non-fatal consistency records: the account already works through
    // profiles.class_id, so a failure here is logged instead of rolled back.
    // These tables are optional, so a project that has not applied the
    // academic migration yet simply skips them without noisy logs.
    if (role === "student") {
      const enrollment = {
        student_id: userId,
        class_id: classId,
        status: "active",
      };
      const { data: klass, error: klassError } = await admin
        .from("classes")
        .select("academic_term_id")
        .eq("id", classId)
        .maybeSingle();
      if (!klassError && klass) enrollment.academic_term_id = klass.academic_term_id ?? null;
      const { error: enrollError } = await admin
        .from("student_enrollments")
        .upsert(enrollment, { ignoreDuplicates: true });
      if (enrollError && !isMissingRelation(enrollError)) {
        console.error("create-user: enrollment insert failed", enrollError.message);
      }
    }

    if (role === "hod" && hodType === "department") {
      const { data: primary } = await admin
        .from("department_hod_assignments")
        .select("id")
        .eq("department_id", departmentId)
        .eq("is_primary", true)
        .maybeSingle();
      const { error: hodError } = await admin.from("department_hod_assignments").upsert(
        {
          department_id: departmentId,
          hod_id: userId,
          is_primary: !primary,
        },
        { ignoreDuplicates: true },
      );
      if (hodError && !isMissingRelation(hodError)) {
        console.error("create-user: HOD scope insert failed", hodError.message);
      }
    }

    return json({ id: userId }, 200);
  } catch (error) {
    console.error("create-user: unexpected failure", error?.message);
    return json({ error: "Unexpected error" }, 500);
  }
});

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Optional tables and columns from later academic migrations may not exist on a
// project yet. PostgREST reports that as PGRST205 (missing table) or Postgres
// 42P01, while a missing column is 42703. These are expected, not failures.
const MISSING_RELATION_CODES = new Set(["42P01", "42P02", "42703", "PGRST205"]);

function isMissingRelation(error) {
  if (!error) return false;
  if (MISSING_RELATION_CODES.has(error.code)) return true;
  return /does not exist|schema cache|find the table|find the column/i.test(error.message ?? "");
}
