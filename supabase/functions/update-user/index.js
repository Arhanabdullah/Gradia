// Gradia — secure admin-only account editing.
// Deploy: npx supabase functions deploy update-user --project-ref <project-ref>
//
// The browser never receives the service-role key. This function verifies the
// caller is an ACTIVE admin, validates every role-specific scope value, updates
// public.profiles, syncs optional scope tables, and finally updates Auth with
// the editable identity fields and any new password.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const allowedRoles = new Set([
  "student",
  "teacher",
  "hod",
  "principal",
  "admin",
  "coordinator",
  "exam_cell",
]);
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

    const { data: callerProfile, error: callerProfileError } = await admin
      .from("profiles")
      .select("role, is_active")
      .eq("id", caller.user.id)
      .maybeSingle();
    if (callerProfileError) {
      console.error("update-user: caller profile lookup failed", callerProfileError.message);
      return json({ error: "Could not verify your account" }, 500);
    }
    if (!callerProfile || callerProfile.role !== "admin" || !callerProfile.is_active) {
      return json({ error: "Only active admins can edit accounts" }, 403);
    }

    const body = await req.json();
    const userId = String(body.user_id ?? "").trim();
    if (!isUuid(userId)) return json({ error: "A valid user id is required" }, 400);

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (targetError) {
      console.error("update-user: target lookup failed", targetError.message);
      return json({ error: "Could not load the account" }, 500);
    }
    if (!target) return json({ error: "Account not found" }, 404);

    const email = String(body.email ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").trim();
    const username = String(body.username ?? "").trim() || email.split("@")[0];
    const phone = String(body.phone ?? "").trim();
    const password = String(body.password ?? "");
    const role = String(body.role ?? "").trim().toLowerCase();
    const studentId = String(body.student_id ?? "").trim();
    const registrationNo = String(body.registration_no ?? "").trim();
    const teacherId = String(body.teacher_id ?? "").trim();
    const departmentId = String(body.department_id ?? "").trim();
    const degreeId = String(body.degree_id ?? "").trim();
    const courseId = String(body.course_id ?? "").trim();
    const classId = String(body.class_id ?? "").trim();
    const hodType = String(body.hod_type ?? "").trim();
    const hodSubjectId = String(body.hod_subject_id ?? "").trim();

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: "A valid email address is required" }, 400);
    if (!name) return json({ error: "Full name is required" }, 400);
    if (!username) return json({ error: "Username is required" }, 400);
    if (password && password.length < 6) return json({ error: "Password must contain at least 6 characters" }, 400);
    if (!allowedRoles.has(role)) return json({ error: "Invalid account role" }, 400);

    for (const [key, value] of Object.entries({ departmentId, degreeId, courseId, classId, hodSubjectId })) {
      if (value && !isUuid(value)) return json({ error: `Invalid ${key} identifier` }, 400);
    }

    if (userId === caller.user.id && role !== target.role) {
      return json({ error: "You cannot change the role of your own account" }, 400);
    }
    if (target.role === "admin" && role !== "admin") {
      const { count, error: countError } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin")
        .eq("is_active", true)
        .neq("id", userId);
      if (countError) {
        console.error("update-user: admin count failed", countError.message);
        return json({ error: "Could not check administrator coverage" }, 500);
      }
      if (!count) return json({ error: "The last active administrator cannot lose admin access" }, 400);
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
      if (!degree) return json({ error: "Selected degree was not found" }, 400);
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
      if (!degree) return json({ error: "Selected degree was not found" }, 400);
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

    const [{ data: usernameTaken }, { data: studentIdTaken }, { data: teacherIdTaken }] = await Promise.all([
      admin.from("profiles").select("id").eq("username", username).neq("id", userId).maybeSingle(),
      studentId
        ? admin.from("profiles").select("id").eq("student_id", studentId).neq("id", userId).maybeSingle()
        : Promise.resolve({ data: null }),
      teacherId
        ? admin.from("profiles").select("id").eq("teacher_id", teacherId).neq("id", userId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (usernameTaken) return json({ error: "This username is already in use" }, 409);
    if (studentIdTaken) return json({ error: "This Student ID is already in use" }, 409);
    if (teacherIdTaken) return json({ error: "This Teacher ID is already in use" }, 409);

    if (registrationNo) {
      if (registrationNo.length > 60) {
        return json({ error: "Registration number must be 60 characters or fewer" }, 400);
      }
      const { data: registrationTaken } = await admin
        .from("profiles")
        .select("id")
        .ilike("registration_no", registrationNo)
        .neq("id", userId)
        .maybeSingle();
      if (registrationTaken) return json({ error: "This registration number is already in use" }, 409);
    }

    const patch = {
      name,
      username,
      email,
      phone: phone || null,
      role,
      student_id: role === "student" ? studentId : null,
      registration_no: role === "student" ? registrationNo || null : null,
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
    const originalPatch = {
      name: target.name,
      username: target.username,
      email: target.email,
      phone: target.phone ?? null,
      role: target.role,
      student_id: target.student_id ?? null,
      registration_no: target.registration_no ?? null,
      teacher_id: target.teacher_id ?? null,
      department_id: target.department_id ?? null,
      degree_id: target.degree_id ?? null,
      course_id: target.course_id ?? null,
      class_id: target.class_id ?? null,
      hod_type: target.hod_type ?? null,
      hod_subject_id: target.hod_subject_id ?? null,
    };

    const applyProfilePatch = async (values) => {
      let result = await admin
        .from("profiles")
        .update(values)
        .eq("id", userId)
        .select("id")
        .maybeSingle();
      if (result.error && result.error.code === "42703") {
        const { registration_no: _ignored, ...fallback } = values;
        result = await admin
          .from("profiles")
          .update(fallback)
          .eq("id", userId)
          .select("id")
          .maybeSingle();
      }
      return result;
    };

    const { error: updateError } = await applyProfilePatch(patch);
    if (updateError) {
      console.error("update-user: profile update failed", updateError.message);
      return json({ error: "Could not update the account" }, 500);
    }

    if (role === "hod" && hodType === "department") {
      const { data: primary } = await admin
        .from("department_hod_assignments")
        .select("id")
        .eq("department_id", departmentId)
        .eq("is_primary", true)
        .neq("hod_id", userId)
        .maybeSingle();
      const { error: scopeError } = await admin.from("department_hod_assignments").upsert(
        { department_id: departmentId, hod_id: userId, is_primary: !primary },
        { onConflict: "department_id,hod_id" },
      );
      if (scopeError && !isMissingRelation(scopeError)) {
        console.error("update-user: HOD scope update failed", scopeError.message);
      }
    } else {
      const { error: scopeError } = await admin
        .from("department_hod_assignments")
        .delete()
        .eq("hod_id", userId);
      if (scopeError && !isMissingRelation(scopeError)) {
        console.error("update-user: HOD scope clear failed", scopeError.message);
      }
    }

    if (role === "student") {
      const enrollment = { student_id: userId, class_id: classId, status: "active" };
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
        console.error("update-user: enrollment update failed", enrollError.message);
      }
    } else {
      const { error: enrollError } = await admin
        .from("student_enrollments")
        .delete()
        .eq("student_id", userId);
      if (enrollError && !isMissingRelation(enrollError)) {
        console.error("update-user: enrollment clear failed", enrollError.message);
      }
    }

    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    const authPatch = {
      email,
      user_metadata: {
        ...(authUser?.user?.user_metadata ?? {}),
        name,
        username,
        role,
      },
    };
    if (password) authPatch.password = password;

    const { error: authError } = await admin.auth.admin.updateUserById(userId, authPatch);
    if (authError) {
      await applyProfilePatch(originalPatch);
      console.error("update-user: auth update failed", authError.message);
      return json({ error: "Could not update the login email or password" }, 400);
    }

    return json({ id: userId }, 200);
  } catch (error) {
    console.error("update-user: unexpected failure", error?.message);
    return json({ error: "Unexpected error" }, 500);
  }
});

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const MISSING_RELATION_CODES = new Set(["42P01", "42P02", "42703", "PGRST205"]);

function isMissingRelation(error) {
  if (!error) return false;
  if (MISSING_RELATION_CODES.has(error.code)) return true;
  return /does not exist|schema cache|find the table|find the column/i.test(error.message ?? "");
}
