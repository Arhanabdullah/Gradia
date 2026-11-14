-- Fast read paths for the tables the Exam Cell pages scan in full.
--
-- Each of these tables had two permissive SELECT policies: a per-row scoped
-- helper ("… read") plus a role-wide "… monitor read" (is_monitor()). Postgres
-- ORs them together, but it does not know the role-wide check is a constant for
-- the statement, so it re-runs the expensive per-row helper for every row.
--
-- Wrapping the role checks in a scalar sub-select turns them into an InitPlan:
-- one evaluation per statement instead of one per row. The `(select …)` form is
-- what makes the planner hoist the call, so keep it if this file is edited.
--
-- Measured with EXPLAIN (ANALYZE) against the live data set before the change
-- (scoped helper OR monitor/admin role check, unfiltered scan):
--   subjects (792 rows)              exam_cell 910 ms · coordinator 784 ms
--                                    admin 252 ms · principal 244 ms
--   profiles (269 rows)              exam_cell 285 ms · coordinator 232 ms
--                                    admin 92 ms  · principal 91 ms
--   student_enrollments (240 rows)   exam_cell 198 ms · coordinator 155 ms
--   audit_logs (546 rows)            exam_cell 206 ms · admin 79 ms
--                                    coordinator/principal 157 ms for 0 rows
-- After the change the same scans run in 2-6 ms for those roles, and the row
-- counts returned per role are unchanged (checked for exam_cell, coordinator,
-- admin, principal, teacher and student on every table above).
--
-- Visibility is unchanged: the admin/principal branch below is the same
-- early-return branch can_view_subject() and can_view_profile() already take
-- (active account, then has_role), and the scoped helper still decides every
-- other case. HODs, teachers and students keep the previous behaviour.

-- ---------- subjects ----------
drop policy if exists "subjects monitor read" on public.subjects;
drop policy if exists "subjects read" on public.subjects;

create policy "subjects read" on public.subjects
  for select to authenticated
  using (
    (select public.is_monitor())
    or (select public.is_active_user() and public.has_role(array['admin', 'principal']::public.user_role[]))
    or public.can_view_subject(id)
  );

-- ---------- profiles ----------
drop policy if exists "profiles monitor read" on public.profiles;
drop policy if exists "profiles read" on public.profiles;

create policy "profiles read" on public.profiles
  for select to authenticated
  using (
    (select public.is_monitor())
    or (select public.is_active_user() and public.has_role(array['admin', 'principal']::public.user_role[]))
    or public.can_view_profile(id)
  );

-- ---------- student_enrollments ----------
drop policy if exists "student enrollments monitor read" on public.student_enrollments;
drop policy if exists "student enrollments read" on public.student_enrollments;

create policy "student enrollments read" on public.student_enrollments
  for select to authenticated
  using (
    (select public.is_monitor())
    or (select public.is_active_user() and public.has_role(array['admin', 'principal']::public.user_role[]))
    or (
      (select public.is_active_user())
      and (
        student_id = auth.uid()
        or public.is_class_hod(class_id)
        or public.teaches_class(class_id)
      )
    )
  );

-- ---------- audit_logs ----------
drop policy if exists "audit logs exam cell read" on public.audit_logs;
drop policy if exists "audit logs read" on public.audit_logs;

create policy "audit logs read" on public.audit_logs
  for select to authenticated
  using (
    (select public.is_exam_cell())
    or (select public.is_admin())
  );
