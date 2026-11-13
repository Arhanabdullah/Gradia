-- ============================================================
-- GRADIA · Coordinator and Exam Cell read access
-- ============================================================
-- Additive migration.
--
-- Coordinator is deliberately READ-ONLY. It gets SELECT policies on the
-- academic and result tables so it can monitor, analyse and print across
-- the whole institution. It gets no INSERT/UPDATE/DELETE policy anywhere,
-- and the existing write helpers (is_admin, is_hod, ...) return false for
-- it, so every workflow RPC also refuses the call.
--
-- Exam Cell also needs the same read surface to configure and approve
-- results. Its write policies live in the next migration.
--
-- RLS policies are permissive (OR-ed), so adding a policy here widens
-- access without touching any existing policy or helper.
-- ============================================================

-- ---------- role helpers ----------
create or replace function public.is_coordinator()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.has_role(array['coordinator']::public.user_role[]);
$$;

create or replace function public.is_exam_cell()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.has_role(array['exam_cell']::public.user_role[]);
$$;

-- Shared read-only monitoring scope.
create or replace function public.is_monitor()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_coordinator() or public.is_exam_cell();
$$;

-- ---------- profiles and academic structure ----------
drop policy if exists "profiles monitor read" on public.profiles;
create policy "profiles monitor read" on public.profiles
  for select to authenticated using (public.is_monitor());

drop policy if exists "classes monitor read" on public.classes;
create policy "classes monitor read" on public.classes
  for select to authenticated using (public.is_monitor());

drop policy if exists "subjects monitor read" on public.subjects;
create policy "subjects monitor read" on public.subjects
  for select to authenticated using (public.is_monitor());

drop policy if exists "exams monitor read" on public.exams;
create policy "exams monitor read" on public.exams
  for select to authenticated using (public.is_monitor());

drop policy if exists "exam groups monitor read" on public.exam_groups;
create policy "exam groups monitor read" on public.exam_groups
  for select to authenticated using (public.is_monitor());

drop policy if exists "class subjects monitor read" on public.class_subjects;
create policy "class subjects monitor read" on public.class_subjects
  for select to authenticated using (public.is_monitor());

drop policy if exists "teacher assignments monitor read" on public.teacher_assignments;
create policy "teacher assignments monitor read" on public.teacher_assignments
  for select to authenticated using (public.is_monitor());

drop policy if exists "student enrollments monitor read" on public.student_enrollments;
create policy "student enrollments monitor read" on public.student_enrollments
  for select to authenticated using (public.is_monitor());

drop policy if exists "class hod monitor read" on public.class_hod_assignments;
create policy "class hod monitor read" on public.class_hod_assignments
  for select to authenticated using (public.is_monitor());

drop policy if exists "department hod monitor read" on public.department_hod_assignments;
create policy "department hod monitor read" on public.department_hod_assignments
  for select to authenticated using (public.is_monitor());

-- ---------- examination data ----------
drop policy if exists "exam subjects monitor read" on public.exam_subjects;
create policy "exam subjects monitor read" on public.exam_subjects
  for select to authenticated using (public.is_monitor());

drop policy if exists "assessment components monitor read" on public.assessment_components;
create policy "assessment components monitor read" on public.assessment_components
  for select to authenticated using (public.is_monitor());

drop policy if exists "marks monitor read" on public.marks;
create policy "marks monitor read" on public.marks
  for select to authenticated using (public.is_monitor());

drop policy if exists "mark revisions monitor read" on public.mark_revisions;
create policy "mark revisions monitor read" on public.mark_revisions
  for select to authenticated using (public.is_monitor());

drop policy if exists "exam submissions monitor read" on public.exam_submissions;
create policy "exam submissions monitor read" on public.exam_submissions
  for select to authenticated using (public.is_monitor());

drop policy if exists "exam submission events monitor read" on public.exam_submission_events;
create policy "exam submission events monitor read" on public.exam_submission_events
  for select to authenticated using (public.is_monitor());

-- ---------- results ----------
drop policy if exists "result sheets monitor read" on public.result_sheets;
create policy "result sheets monitor read" on public.result_sheets
  for select to authenticated using (public.is_monitor());

drop policy if exists "result items monitor read" on public.result_items;
create policy "result items monitor read" on public.result_items
  for select to authenticated using (public.is_monitor());

drop policy if exists "result versions monitor read" on public.result_sheet_versions;
create policy "result versions monitor read" on public.result_sheet_versions
  for select to authenticated using (public.is_monitor());

drop policy if exists "result component items monitor read" on public.result_component_items;
create policy "result component items monitor read" on public.result_component_items
  for select to authenticated using (public.is_monitor());

drop policy if exists "result reviews monitor read" on public.result_reviews;
create policy "result reviews monitor read" on public.result_reviews
  for select to authenticated using (public.is_monitor());

-- ---------- attendance ----------
drop policy if exists "attendance monitor read" on public.attendance;
create policy "attendance monitor read" on public.attendance
  for select to authenticated using (public.is_monitor());

-- ============================================================
-- Coordinator is read-only: assert that no write policy ever names it.
-- (Documentation only; enforcement is the absence of write policies.)
-- ============================================================
comment on function public.is_coordinator() is
  'Coordinator: institution-wide read-only monitoring and printing.';
comment on function public.is_exam_cell() is
  'Exam Cell: result configuration, final approval and publication.';
comment on function public.is_monitor() is
  'True for read-only monitoring roles (coordinator, exam_cell).';
