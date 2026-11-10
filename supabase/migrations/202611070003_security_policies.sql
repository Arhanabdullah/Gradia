-- ============================================================
-- GRADIA · Phase 3 · Row Level Security
-- ============================================================
-- Replaces every policy with a scope-aware version. Ground rules:
--   * Every policy requires an ACTIVE account (helpers enforce it).
--   * Academic scope is derived from real relationships:
--     teacher_assignments / class_subjects for teachers,
--     class_hod_assignments / department_hod_assignments for HODs,
--     profiles.class_id / student_enrollments for students.
--   * No policy sub-queries an RLS-protected table directly; only the
--     SECURITY DEFINER helpers do, which avoids recursion.
--   * Clients never write workflow tables (result_sheets, versions,
--     items, reviews); those are RPC/service-role only.
-- ============================================================

-- ---------- profiles ----------
drop policy if exists "authenticated read profiles" on public.profiles;
drop policy if exists "admin insert profiles"        on public.profiles;
drop policy if exists "admin update profiles"        on public.profiles;
drop policy if exists "admin delete profiles"        on public.profiles;
drop policy if exists "profiles read"                on public.profiles;
drop policy if exists "profiles admin insert"        on public.profiles;
drop policy if exists "profiles admin update"        on public.profiles;
drop policy if exists "profiles admin delete"        on public.profiles;

create policy "profiles read" on public.profiles
  for select to authenticated using (public.can_view_profile(id));
create policy "profiles admin insert" on public.profiles
  for insert to authenticated with check (public.is_admin());
create policy "profiles admin update" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "profiles admin delete" on public.profiles
  for delete to authenticated using (public.is_admin() and id <> auth.uid());

-- ---------- classes ----------
drop policy if exists "authenticated read classes" on public.classes;
drop policy if exists "admin write classes"        on public.classes;
drop policy if exists "classes read"               on public.classes;
drop policy if exists "classes admin write"        on public.classes;

create policy "classes read" on public.classes
  for select to authenticated using (public.can_view_class(id));
create policy "classes admin write" on public.classes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- subjects ----------
drop policy if exists "authenticated read subjects" on public.subjects;
drop policy if exists "admin write subjects"        on public.subjects;
drop policy if exists "subjects read"               on public.subjects;
drop policy if exists "subjects admin write"        on public.subjects;

create policy "subjects read" on public.subjects
  for select to authenticated using (public.can_view_subject(id));
create policy "subjects admin write" on public.subjects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- exams ----------
drop policy if exists "authenticated read exams" on public.exams;
drop policy if exists "admin write exams"        on public.exams;
drop policy if exists "exams read"               on public.exams;
drop policy if exists "exams admin write"        on public.exams;

create policy "exams read" on public.exams
  for select to authenticated using (public.can_view_exam(id));
create policy "exams admin write" on public.exams
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- structural catalogue ----------
drop policy if exists "authenticated read departments" on public.departments;
drop policy if exists "admin manage departments"       on public.departments;
drop policy if exists "departments read"               on public.departments;
drop policy if exists "departments admin write"        on public.departments;

create policy "departments read" on public.departments
  for select to authenticated using (public.is_active_user());
create policy "departments admin write" on public.departments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read courses" on public.courses;
drop policy if exists "admin manage courses"       on public.courses;
drop policy if exists "courses read"               on public.courses;
drop policy if exists "courses admin write"        on public.courses;

create policy "courses read" on public.courses
  for select to authenticated using (public.is_active_user());
create policy "courses admin write" on public.courses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read academic sessions" on public.academic_sessions;
drop policy if exists "admin manage academic sessions"       on public.academic_sessions;
drop policy if exists "academic sessions read"               on public.academic_sessions;
drop policy if exists "academic sessions admin write"        on public.academic_sessions;

create policy "academic sessions read" on public.academic_sessions
  for select to authenticated using (public.is_active_user());
create policy "academic sessions admin write" on public.academic_sessions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read academic terms" on public.academic_terms;
drop policy if exists "admin manage academic terms"       on public.academic_terms;
drop policy if exists "academic terms read"               on public.academic_terms;
drop policy if exists "academic terms admin write"        on public.academic_terms;

create policy "academic terms read" on public.academic_terms
  for select to authenticated using (public.is_active_user());
create policy "academic terms admin write" on public.academic_terms
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read course subjects" on public.course_subjects;
drop policy if exists "admin manage course subjects"       on public.course_subjects;
drop policy if exists "course subjects read"               on public.course_subjects;
drop policy if exists "course subjects admin write"        on public.course_subjects;

create policy "course subjects read" on public.course_subjects
  for select to authenticated using (public.is_active_user());
create policy "course subjects admin write" on public.course_subjects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- class subject offering ----------
drop policy if exists "authenticated read class subjects" on public.class_subjects;
drop policy if exists "admin manage class subjects"       on public.class_subjects;
drop policy if exists "class subjects read"               on public.class_subjects;
drop policy if exists "class subjects admin write"        on public.class_subjects;

create policy "class subjects read" on public.class_subjects
  for select to authenticated using (public.can_view_class(class_id));
create policy "class subjects admin write" on public.class_subjects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- teacher assignments ----------
drop policy if exists "authenticated read teacher assignments" on public.teacher_assignments;
drop policy if exists "admin manage teacher assignments"       on public.teacher_assignments;
drop policy if exists "teacher assignments read"               on public.teacher_assignments;
drop policy if exists "teacher assignments admin write"        on public.teacher_assignments;

create policy "teacher assignments read" on public.teacher_assignments
  for select to authenticated using (public.can_view_class(class_id));
create policy "teacher assignments admin write" on public.teacher_assignments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- enrollments ----------
drop policy if exists "read enrollments"                on public.student_enrollments;
drop policy if exists "admin manage enrollments"        on public.student_enrollments;
drop policy if exists "student enrollments read"        on public.student_enrollments;
drop policy if exists "student enrollments admin write" on public.student_enrollments;

create policy "student enrollments read" on public.student_enrollments
  for select to authenticated using (
    public.is_active_user()
    and (
      public.has_role(array['admin', 'principal']::public.user_role[])
      or student_id = auth.uid()
      or public.is_class_hod(class_id)
      or public.teaches_class(class_id)
    )
  );
create policy "student enrollments admin write" on public.student_enrollments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- HOD scope tables ----------
drop policy if exists "authenticated read class hod" on public.class_hod_assignments;
drop policy if exists "admin manage class hod"       on public.class_hod_assignments;
drop policy if exists "class hod read"               on public.class_hod_assignments;
drop policy if exists "class hod admin write"        on public.class_hod_assignments;

create policy "class hod read" on public.class_hod_assignments
  for select to authenticated using (
    public.is_active_user()
    and (
      public.has_role(array['admin', 'principal']::public.user_role[])
      or hod_id = auth.uid()
      or public.is_class_hod(class_id)
    )
  );
create policy "class hod admin write" on public.class_hod_assignments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read department hod" on public.department_hod_assignments;
drop policy if exists "admin manage department hod"       on public.department_hod_assignments;
drop policy if exists "department hod read"               on public.department_hod_assignments;
drop policy if exists "department hod admin write"        on public.department_hod_assignments;

create policy "department hod read" on public.department_hod_assignments
  for select to authenticated using (
    public.is_active_user()
    and (
      public.has_role(array['admin', 'principal']::public.user_role[])
      or hod_id = auth.uid()
      or public.is_department_hod(department_id)
    )
  );
create policy "department hod admin write" on public.department_hod_assignments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- examination catalogue ----------
drop policy if exists "authenticated read exam subjects" on public.exam_subjects;
drop policy if exists "admin manage exam subjects"       on public.exam_subjects;
drop policy if exists "exam subjects read"               on public.exam_subjects;
drop policy if exists "exam subjects admin write"        on public.exam_subjects;

create policy "exam subjects read" on public.exam_subjects
  for select to authenticated using (public.can_view_exam(exam_id));
create policy "exam subjects admin write" on public.exam_subjects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read assessment components" on public.assessment_components;
drop policy if exists "admin manage assessment components"       on public.assessment_components;
drop policy if exists "assessment components read"               on public.assessment_components;
drop policy if exists "assessment components admin write"        on public.assessment_components;

create policy "assessment components read" on public.assessment_components
  for select to authenticated using (public.can_view_exam_subject(exam_subject_id));
create policy "assessment components admin write" on public.assessment_components
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- marks ----------
drop policy if exists "teacher/admin/hod read marks" on public.marks;
drop policy if exists "teacher/admin write marks"    on public.marks;
drop policy if exists "marks read"                   on public.marks;
drop policy if exists "marks scoped write"           on public.marks;

create policy "marks read" on public.marks
  for select to authenticated using (
    public.is_active_user()
    and (
      public.is_admin()
      or public.is_exam_hod(exam_id)
      or public.teaches_exam_subject(exam_id, subject_id)
      or entered_by = auth.uid()
    )
  );

-- Teachers may only touch their own entries, for their own class+subject,
-- and never after the results of that exam are published. Admins are held
-- to the same publication rule so snapshots cannot silently diverge.
create policy "marks scoped write" on public.marks
  for all to authenticated
  using (
    not public.exam_results_published(exam_id)
    and (
      public.is_admin()
      or (
        public.is_active_user()
        and public.teaches_exam_subject(exam_id, subject_id)
        and entered_by = auth.uid()
      )
    )
  )
  with check (
    not public.exam_results_published(exam_id)
    and (
      public.is_admin()
      or (
        public.is_active_user()
        and public.teaches_exam_subject(exam_id, subject_id)
        and entered_by = auth.uid()
      )
    )
  );

-- ---------- mark history ----------
drop policy if exists "admin read mark revisions" on public.mark_revisions;
drop policy if exists "mark revisions read"       on public.mark_revisions;

create policy "mark revisions read" on public.mark_revisions
  for select to authenticated using (
    public.is_active_user()
    and (
      public.is_admin()
      or public.is_exam_hod(exam_id)
      or public.teaches_exam_subject(exam_id, subject_id)
      or changed_by = auth.uid()
    )
  );

-- ---------- result sheets ----------
drop policy if exists "role-based read sheets" on public.result_sheets;
drop policy if exists "admin delete sheets"    on public.result_sheets;
drop policy if exists "result sheets read"      on public.result_sheets;
drop policy if exists "result sheets admin delete" on public.result_sheets;

create policy "result sheets read" on public.result_sheets
  for select to authenticated using (public.can_view_sheet(id));

-- Draft/rejected sheets can be discarded by an admin. Published sheets
-- are protected here and again by the Phase 2 immutability trigger.
create policy "result sheets admin delete" on public.result_sheets
  for delete to authenticated using (public.is_admin() and status <> 'published');

-- ---------- result items ----------
drop policy if exists "role-based read items" on public.result_items;
drop policy if exists "result items read"     on public.result_items;

create policy "result items read" on public.result_items
  for select to authenticated using (public.can_view_result_item(id));

-- ---------- result versions ----------
drop policy if exists "admin read result versions"     on public.result_sheet_versions;
drop policy if exists "principal read result versions" on public.result_sheet_versions;
drop policy if exists "result versions read"           on public.result_sheet_versions;

create policy "result versions read" on public.result_sheet_versions
  for select to authenticated using (
    public.can_view_sheet(sheet_id)
    and (
      public.has_role(array['admin', 'principal', 'hod']::public.user_role[])
      or public.is_published_version(id)
    )
  );

-- ---------- component snapshots ----------
drop policy if exists "admin read result component items" on public.result_component_items;
drop policy if exists "result component items read"       on public.result_component_items;

create policy "result component items read" on public.result_component_items
  for select to authenticated using (public.can_view_component_item(id));

-- ---------- review trail ----------
drop policy if exists "admin read result reviews"     on public.result_reviews;
drop policy if exists "principal read result reviews" on public.result_reviews;
drop policy if exists "result reviews read"           on public.result_reviews;

create policy "result reviews read" on public.result_reviews
  for select to authenticated using (
    public.can_view_sheet(sheet_id)
    and public.has_role(array['admin', 'principal', 'hod']::public.user_role[])
  );

-- ---------- notifications ----------
drop policy if exists "read own notifications"   on public.notifications;
drop policy if exists "update own notifications" on public.notifications;
drop policy if exists "delete own notifications" on public.notifications;
drop policy if exists "notifications read"       on public.notifications;
drop policy if exists "notifications update"     on public.notifications;
drop policy if exists "notifications delete"     on public.notifications;

create policy "notifications read" on public.notifications
  for select to authenticated
  using (public.is_active_user() and user_id = auth.uid());
create policy "notifications update" on public.notifications
  for update to authenticated
  using (public.is_active_user() and user_id = auth.uid())
  with check (public.is_active_user() and user_id = auth.uid());
create policy "notifications delete" on public.notifications
  for delete to authenticated
  using (public.is_active_user() and user_id = auth.uid());

drop policy if exists "read own notification preferences"   on public.notification_preferences;
drop policy if exists "write own notification preferences"  on public.notification_preferences;
drop policy if exists "update own notification preferences" on public.notification_preferences;
drop policy if exists "notification preferences read"       on public.notification_preferences;
drop policy if exists "notification preferences insert"     on public.notification_preferences;
drop policy if exists "notification preferences update"     on public.notification_preferences;

create policy "notification preferences read" on public.notification_preferences
  for select to authenticated
  using (public.is_active_user() and user_id = auth.uid());
create policy "notification preferences insert" on public.notification_preferences
  for insert to authenticated
  with check (public.is_active_user() and user_id = auth.uid());
create policy "notification preferences update" on public.notification_preferences
  for update to authenticated
  using (public.is_active_user() and user_id = auth.uid())
  with check (public.is_active_user() and user_id = auth.uid());

-- ---------- grades and settings ----------
drop policy if exists "authenticated read institution settings" on public.institution_settings;
drop policy if exists "admin manage institution settings"       on public.institution_settings;
drop policy if exists "institution settings read"               on public.institution_settings;
drop policy if exists "institution settings admin write"        on public.institution_settings;

create policy "institution settings read" on public.institution_settings
  for select to authenticated using (public.is_active_user());
create policy "institution settings admin write" on public.institution_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read grading schemes" on public.grading_schemes;
drop policy if exists "admin manage grading schemes"       on public.grading_schemes;
drop policy if exists "grading schemes read"               on public.grading_schemes;
drop policy if exists "grading schemes admin write"        on public.grading_schemes;

create policy "grading schemes read" on public.grading_schemes
  for select to authenticated using (public.is_active_user());
create policy "grading schemes admin write" on public.grading_schemes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read grade bands" on public.grade_bands;
drop policy if exists "admin manage grade bands"       on public.grade_bands;
drop policy if exists "grade bands read"               on public.grade_bands;
drop policy if exists "grade bands admin write"        on public.grade_bands;

create policy "grade bands read" on public.grade_bands
  for select to authenticated using (public.is_active_user());
create policy "grade bands admin write" on public.grade_bands
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- audit ----------
drop policy if exists "admin read audit logs" on public.audit_logs;
drop policy if exists "audit logs read"       on public.audit_logs;

create policy "audit logs read" on public.audit_logs
  for select to authenticated using (public.is_admin());

-- ============================================================
-- Deactivation baseline
-- ============================================================
-- Every policy above is gated by an active-account helper, so a
-- deactivated user matches no row. We deliberately do NOT use
-- `force row level security` here: the workflow functions are
-- SECURITY DEFINER and must keep writing to these tables as the
-- database owner even though clients have no write policy. FORCE
-- RLS would subject those writes to client policies and break the
-- compile/review/sign/publish flow for the table owner.
--
-- Enforcement layers for a deactivated account are therefore:
--   1. require_active_user()/require_role() inside every RPC;
--   2. is_active_user() inside every policy predicate;
--   3. the auth-user ban applied by the set-user-active function.
-- Existing JWTs stay cryptographically valid but read nothing and
-- cannot invoke any guarded function.
