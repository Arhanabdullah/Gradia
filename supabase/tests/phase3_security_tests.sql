-- ============================================================
-- GRADIA - Phase 3 security tests
-- ============================================================
-- STAGING ONLY. This script inserts fixture rows, exercises RLS and
-- the workflow RPCs as real database roles, then ROLLS EVERYTHING BACK.
--
-- It refuses to start unless you pass:
--     -v allow_security_tests=yes
--
-- Run with psql, not the Supabase SQL editor, because it switches roles:
--     psql "$STAGING_DATABASE_URL" -v allow_security_tests=yes \
--          -f supabase/tests/phase3_security_tests.sql
--
-- The fixtures assume the Phase 2 + Phase 3 migrations are applied.
-- ============================================================

\if :{?allow_security_tests}
\else
  \echo 'Refusing to run: pass -v allow_security_tests=yes against a STAGING database.'
  \quit
\endif

\set ON_ERROR_STOP on
\echo '=== GRADIA Phase 3 security tests (transaction will be rolled back) ==='
begin;

-- ============================================================
-- Fixture identifiers
-- ============================================================
-- admin            10000000-0000-4000-8000-000000000001
-- adminInactive    10000000-0000-4000-8000-000000000002
-- teacherA         20000000-0000-4000-8000-000000000011
-- teacherB         20000000-0000-4000-8000-000000000012
-- teacherInactive  20000000-0000-4000-8000-000000000013
-- hodA             30000000-0000-4000-8000-000000000021
-- hodB             30000000-0000-4000-8000-000000000022
-- principal        40000000-0000-4000-8000-000000000031
-- studentA         50000000-0000-4000-8000-000000000041
-- studentB         50000000-0000-4000-8000-000000000042
-- attacker         60000000-0000-4000-8000-000000000051
--
-- deptA            a1000000-0000-4000-8000-000000000001
-- deptB            a1000000-0000-4000-8000-000000000002
-- courseA          a2000000-0000-4000-8000-000000000001
-- courseB          a2000000-0000-4000-8000-000000000002
-- classA           a3000000-0000-4000-8000-000000000001
-- classB           a3000000-0000-4000-8000-000000000002
--
-- subjectA         b1000000-0000-4000-8000-000000000001 (classA)
-- subjectB         b1000000-0000-4000-8000-000000000002 (classB)
-- subjectC         b1000000-0000-4000-8000-000000000003 (classA, inactive teacher)
-- subjectD         b1000000-0000-4000-8000-000000000004 (classA, teacherB)
--
-- examA            c1000000-0000-4000-8000-000000000001 (published)
-- examB            c1000000-0000-4000-8000-000000000002 (published)
-- examC            c1000000-0000-4000-8000-000000000003 (compiled)
-- examD            c1000000-0000-4000-8000-000000000004 (mark entry)
-- examE            c1000000-0000-4000-8000-000000000005 (compile test)
--
-- sheetA           d1000000-0000-4000-8000-000000000001
-- sheetB           d1000000-0000-4000-8000-000000000002
-- sheetC           d1000000-0000-4000-8000-000000000003
-- sheetD           d1000000-0000-4000-8000-000000000004
--
-- versionA         d2000000-0000-4000-8000-000000000001
-- versionB         d2000000-0000-4000-8000-000000000002
-- versionC         d2000000-0000-4000-8000-000000000003
-- versionD         d2000000-0000-4000-8000-000000000004
--
-- itemA            d3000000-0000-4000-8000-000000000001
-- itemB            d3000000-0000-4000-8000-000000000002
-- itemC            d3000000-0000-4000-8000-000000000003
-- itemD            d3000000-0000-4000-8000-000000000004
-- ============================================================

create schema gradia_tests;

-- ---------- fixture helpers ----------
create or replace function gradia_tests.make_user(
  p_id    uuid,
  p_email text,
  p_meta  jsonb
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    p_email, '', now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, p_meta,
    '', '', '', ''
  );
end;
$$;

revoke all on function gradia_tests.make_user(uuid, text, jsonb) from public;

-- ---------- assertion helpers ----------
create or replace function gradia_tests.expect_count(
  p_label  text,
  p_actual bigint,
  p_expected bigint
)
returns void
language plpgsql
as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL: % - expected %, got %', p_label, p_expected, p_actual;
  end if;
  raise notice 'PASS: %', p_label;
end;
$$;

create or replace function gradia_tests.expect_at_least(
  p_label  text,
  p_actual bigint,
  p_minimum bigint
)
returns void
language plpgsql
as $$
begin
  if p_actual is null or p_actual < p_minimum then
    raise exception 'FAIL: % - expected at least %, got %', p_label, p_minimum, p_actual;
  end if;
  raise notice 'PASS: %', p_label;
end;
$$;

create or replace function gradia_tests.expect_text(
  p_label  text,
  p_actual text,
  p_expected text
)
returns void
language plpgsql
as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL: % - expected %, got %', p_label, p_expected, p_actual;
  end if;
  raise notice 'PASS: %', p_label;
end;
$$;

create or replace function gradia_tests.expect_rows(
  p_label    text,
  p_sql      text,
  p_expected bigint
)
returns void
language plpgsql
as $$
declare
  v_count bigint;
begin
  execute p_sql;
  get diagnostics v_count = row_count;
  if v_count is distinct from p_expected then
    raise exception 'FAIL: % - expected % row(s), got %', p_label, p_expected, v_count;
  end if;
  raise notice 'PASS: %', p_label;
end;
$$;

create or replace function gradia_tests.expect_error(
  p_label text,
  p_sql   text
)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception
    when insufficient_privilege or check_violation or unique_violation
      or no_data_found or foreign_key_violation then
      raise notice 'PASS: % (blocked: %)', p_label, sqlerrm;
      return;
    when others then
      raise exception 'FAIL: % raised an unexpected error: % (%)',
        p_label, sqlerrm, sqlstate;
  end;

  raise exception 'FAIL: % was allowed', p_label;
end;
$$;

grant usage on schema gradia_tests to authenticated;
grant execute on all functions in schema gradia_tests to authenticated;
revoke all on function gradia_tests.make_user(uuid, text, jsonb) from authenticated, public;

-- ============================================================
-- Fixtures (inserted as the migration role, before switching roles)
-- ============================================================
\echo '--- creating fixtures ---'

select gradia_tests.make_user('10000000-0000-4000-8000-000000000001', 'admin@gradia.test',           '{"name":"Admin","username":"admin"}');
select gradia_tests.make_user('10000000-0000-4000-8000-000000000002', 'admin-inactive@gradia.test',  '{"name":"Former Admin","username":"admin_inactive"}');
select gradia_tests.make_user('20000000-0000-4000-8000-000000000011', 'teacher-a@gradia.test',       '{"name":"Teacher A","username":"teacher_a"}');
select gradia_tests.make_user('20000000-0000-4000-8000-000000000012', 'teacher-b@gradia.test',       '{"name":"Teacher B","username":"teacher_b"}');
select gradia_tests.make_user('20000000-0000-4000-8000-000000000013', 'teacher-inactive@gradia.test','{"name":"Inactive Teacher","username":"teacher_inactive"}');
select gradia_tests.make_user('30000000-0000-4000-8000-000000000021', 'hod-a@gradia.test',           '{"name":"HOD A","username":"hod_a"}');
select gradia_tests.make_user('30000000-0000-4000-8000-000000000022', 'hod-b@gradia.test',           '{"name":"HOD B","username":"hod_b"}');
select gradia_tests.make_user('40000000-0000-4000-8000-000000000031', 'principal@gradia.test',       '{"name":"Principal","username":"principal"}');
select gradia_tests.make_user('50000000-0000-4000-8000-000000000041', 'student-a@gradia.test',       '{"name":"Student A","username":"student_a"}');
select gradia_tests.make_user('50000000-0000-4000-8000-000000000042', 'student-b@gradia.test',       '{"name":"Student B","username":"student_b"}');

-- Metadata must not be able to mint an admin.
select gradia_tests.make_user(
  '60000000-0000-4000-8000-000000000051',
  'attacker@gradia.test',
  '{"name":"Attacker","username":"attacker","role":"admin","class_id":"a3000000-0000-4000-8000-000000000002"}'::jsonb
);

insert into public.departments (id, name, code) values
  ('a1000000-0000-4000-8000-000000000001', 'Dept A', 'DA'),
  ('a1000000-0000-4000-8000-000000000002', 'Dept B', 'DB');

insert into public.courses (id, department_id, name, code) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Course A', 'CA'),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'Course B', 'CB');

insert into public.classes (id, name, department, course_id) values
  ('a3000000-0000-4000-8000-000000000001', 'Class A', 'Dept A', 'a2000000-0000-4000-8000-000000000001'),
  ('a3000000-0000-4000-8000-000000000002', 'Class B', 'Dept B', 'a2000000-0000-4000-8000-000000000002');

-- Roles and academic scope.
update public.profiles set role = 'admin'     where id = '10000000-0000-4000-8000-000000000001';
update public.profiles set role = 'admin', is_active = false
  where id = '10000000-0000-4000-8000-000000000002';
update public.profiles set role = 'teacher', teacher_id = 'T-A'
  where id = '20000000-0000-4000-8000-000000000011';
update public.profiles set role = 'teacher', teacher_id = 'T-B'
  where id = '20000000-0000-4000-8000-000000000012';
update public.profiles set role = 'teacher', teacher_id = 'T-I', is_active = false
  where id = '20000000-0000-4000-8000-000000000013';
update public.profiles set role = 'hod', department_id = 'a1000000-0000-4000-8000-000000000001', hod_type = 'department'
  where id = '30000000-0000-4000-8000-000000000021';
update public.profiles set role = 'hod', department_id = 'a1000000-0000-4000-8000-000000000002', hod_type = 'department'
  where id = '30000000-0000-4000-8000-000000000022';
update public.profiles set role = 'principal'
  where id = '40000000-0000-4000-8000-000000000031';
update public.profiles set role = 'student', student_id = 'S-A',
  department_id = 'a1000000-0000-4000-8000-000000000001',
  course_id = 'a2000000-0000-4000-8000-000000000001',
  class_id = 'a3000000-0000-4000-8000-000000000001'
  where id = '50000000-0000-4000-8000-000000000041';
update public.profiles set role = 'student', student_id = 'S-B',
  department_id = 'a1000000-0000-4000-8000-000000000002',
  course_id = 'a2000000-0000-4000-8000-000000000002',
  class_id = 'a3000000-0000-4000-8000-000000000002'
  where id = '50000000-0000-4000-8000-000000000042';

insert into public.subjects (id, class_id, name, code, teacher_id, max_marks, department_id) values
  ('b1000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'Subject A', 'SA', '20000000-0000-4000-8000-000000000011', 100, 'a1000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000002', 'Subject B', 'SB', '20000000-0000-4000-8000-000000000012', 100, 'a1000000-0000-4000-8000-000000000002'),
  ('b1000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000001', 'Subject C', 'SC', '20000000-0000-4000-8000-000000000013', 100, 'a1000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000004', 'a3000000-0000-4000-8000-000000000001', 'Subject D', 'SD', '20000000-0000-4000-8000-000000000012', 100, 'a1000000-0000-4000-8000-000000000001');

insert into public.class_subjects (id, class_id, subject_id) values
  ('b2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002'),
  ('b2000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003'),
  ('b2000000-0000-4000-8000-000000000004', 'a3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000004');

insert into public.teacher_assignments (class_id, subject_id, teacher_id, class_subject_id) values
  ('a3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000011', 'b2000000-0000-4000-8000-000000000001'),
  ('a3000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000012', 'b2000000-0000-4000-8000-000000000002'),
  ('a3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000013', 'b2000000-0000-4000-8000-000000000003'),
  ('a3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000012', 'b2000000-0000-4000-8000-000000000004');

insert into public.class_hod_assignments (class_id, hod_id) values
  ('a3000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000021'),
  ('a3000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000022');

insert into public.department_hod_assignments (department_id, hod_id) values
  ('a1000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000021'),
  ('a1000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000022');

insert into public.student_enrollments (student_id, class_id, status) values
  ('50000000-0000-4000-8000-000000000041', 'a3000000-0000-4000-8000-000000000001', 'active'),
  ('50000000-0000-4000-8000-000000000042', 'a3000000-0000-4000-8000-000000000002', 'active');

insert into public.exams (id, class_id, name, academic_year, status) values
  ('c1000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'Exam A', '2026', 'completed'),
  ('c1000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000002', 'Exam B', '2026', 'completed'),
  ('c1000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000001', 'Exam C', '2026', 'completed'),
  ('c1000000-0000-4000-8000-000000000004', 'a3000000-0000-4000-8000-000000000001', 'Exam D', '2026', 'open'),
  ('c1000000-0000-4000-8000-000000000005', 'a3000000-0000-4000-8000-000000000001', 'Exam E', '2026', 'open');

insert into public.exam_subjects (exam_id, subject_id, class_subject_id, max_marks) values
  ('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 100),
  ('c1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', 100),
  ('c1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 100),
  ('c1000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 100),
  ('c1000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000003', 100),
  ('c1000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000004', 'b2000000-0000-4000-8000-000000000004', 100),
  ('c1000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 100);

insert into public.marks (exam_id, subject_id, student_id, marks_obtained, entered_by) values
  ('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000041', 80, '20000000-0000-4000-8000-000000000011'),
  ('c1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000042', 70, '20000000-0000-4000-8000-000000000012'),
  ('c1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000041', 60, '20000000-0000-4000-8000-000000000011'),
  ('c1000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000041', 55, '20000000-0000-4000-8000-000000000011'),
  ('c1000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000041', 65, '20000000-0000-4000-8000-000000000013'),
  ('c1000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000041', 75, '20000000-0000-4000-8000-000000000012'),
  ('c1000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000041', 88, '20000000-0000-4000-8000-000000000011');

-- Sheets are created unpublished first, because the immutability guard
-- blocks inserting items into an already-published version.
insert into public.result_sheets (id, exam_id, class_id, status) values
  ('d1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'draft'),
  ('d1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000002', 'draft'),
  ('d1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000001', 'compiled'),
  ('d1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000004', 'a3000000-0000-4000-8000-000000000001', 'hod_approved');

insert into public.result_sheet_versions (
  id, sheet_id, version_number, status, compiled_by, reviewed_by, signed_by,
  hod_remarks, principal_remarks, compiled_at, published_at, snapshot
) values
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 1, 'draft',
   '10000000-0000-4000-8000-000000000001', null, null, '', '', now(), null, '{"fixture":"A"}'::jsonb),
  ('d2000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000002', 1, 'draft',
   '10000000-0000-4000-8000-000000000001', null, null, '', '', now(), null, '{"fixture":"B"}'::jsonb),
  ('d2000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000003', 1, 'compiled',
   '10000000-0000-4000-8000-000000000001', null, null, '', '', now(), null, '{"fixture":"C"}'::jsonb),
  ('d2000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000004', 1, 'hod_approved',
   '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000021', null, 'ok', '', now(), null, '{"fixture":"D"}'::jsonb);

update public.result_sheets set current_version_id = 'd2000000-0000-4000-8000-000000000001'
  where id = 'd1000000-0000-4000-8000-000000000001';
update public.result_sheets set current_version_id = 'd2000000-0000-4000-8000-000000000002'
  where id = 'd1000000-0000-4000-8000-000000000002';
update public.result_sheets set current_version_id = 'd2000000-0000-4000-8000-000000000003'
  where id = 'd1000000-0000-4000-8000-000000000003';
update public.result_sheets set current_version_id = 'd2000000-0000-4000-8000-000000000004'
  where id = 'd1000000-0000-4000-8000-000000000004';

insert into public.result_items (id, sheet_id, student_id, subject_id, marks_obtained, max_marks, version_id) values
  ('d3000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000041', 'b1000000-0000-4000-8000-000000000001', 80, 100, 'd2000000-0000-4000-8000-000000000001'),
  ('d3000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000042', 'b1000000-0000-4000-8000-000000000002', 70, 100, 'd2000000-0000-4000-8000-000000000002'),
  ('d3000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000041', 'b1000000-0000-4000-8000-000000000001', 60, 100, 'd2000000-0000-4000-8000-000000000003'),
  ('d3000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000041', 'b1000000-0000-4000-8000-000000000001', 55, 100, 'd2000000-0000-4000-8000-000000000004');

update public.result_sheet_versions
set status = 'published', published_at = now()
where id in ('d2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002');

update public.result_sheets
set status = 'published', published_at = now()
where id in ('d1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002');

insert into public.notifications (id, user_id, title, body) values
  ('e1000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000041', 'For student A', 'private'),
  ('e1000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000042', 'For student B', 'private');

-- ============================================================
-- 1. Role escalation through metadata
-- ============================================================
\echo '--- 1. role escalation ---'
select gradia_tests.expect_text(
  'metadata cannot grant admin',
  (select role::text from public.profiles where id = '60000000-0000-4000-8000-000000000051'),
  'student'
);
select gradia_tests.expect_text(
  'metadata cannot choose a class',
  (select coalesce(class_id::text, 'none') from public.profiles where id = '60000000-0000-4000-8000-000000000051'),
  'none'
);

-- ============================================================
-- 2. Profile visibility
-- ============================================================
\echo '--- 2. profile visibility ---'

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
select gradia_tests.expect_count(
  'teacher A sees a student in their class',
  (select count(*) from public.profiles where id = '50000000-0000-4000-8000-000000000041'), 1);
select gradia_tests.expect_count(
  'teacher A cannot see a student from another class',
  (select count(*) from public.profiles where id = '50000000-0000-4000-8000-000000000042'), 0);
reset role;

select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000021","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count(
  'HOD A sees students in their class',
  (select count(*) from public.profiles where id = '50000000-0000-4000-8000-000000000041'), 1);
select gradia_tests.expect_count(
  'HOD A cannot see students outside their scope',
  (select count(*) from public.profiles where id = '50000000-0000-4000-8000-000000000042'), 0);
select gradia_tests.expect_count(
  'HOD A sees their assigned teacher',
  (select count(*) from public.profiles where id = '20000000-0000-4000-8000-000000000011'), 1);
select gradia_tests.expect_count(
  'HOD A cannot see the other HOD',
  (select count(*) from public.profiles where id = '30000000-0000-4000-8000-000000000022'), 0);
reset role;

select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000041","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count(
  'student A sees their own profile',
  (select count(*) from public.profiles where id = '50000000-0000-4000-8000-000000000041'), 1);
select gradia_tests.expect_count(
  'student A cannot see another student profile',
  (select count(*) from public.profiles where id = '50000000-0000-4000-8000-000000000042'), 0);
reset role;

select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000031","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count(
  'principal sees all profiles',
  (select count(*) from public.profiles where id = '50000000-0000-4000-8000-000000000042'), 1);
reset role;

-- ============================================================
-- 3. Class / subject visibility
-- ============================================================
\echo '--- 3. class and subject scope ---'

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count(
  'teacher A sees only their class',
  (select count(*) from public.classes), 1);
select gradia_tests.expect_count(
  'teacher A sees only their subject',
  (select count(*) from public.subjects), 1);
reset role;

select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000041","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count(
  'student A sees only their class',
  (select count(*) from public.classes), 1);
select gradia_tests.expect_count(
  'student A sees only offered subjects',
  (select count(*) from public.subjects), 3);
reset role;

select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000021","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count(
  'HOD A sees only their class',
  (select count(*) from public.classes), 1);
reset role;

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000013","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count(
  'inactive teacher sees no classes',
  (select count(*) from public.classes), 0);
select gradia_tests.expect_count(
  'inactive teacher sees no marks',
  (select count(*) from public.marks), 0);
reset role;

-- ============================================================
-- 4. Marks
-- ============================================================
\echo '--- 4. marks ---'

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
set local role authenticated;
-- Subject A appears in exams A, C, D and E, so teacher A sees 4 rows.
select gradia_tests.expect_count(
  'teacher A reads their own marks only',
  (select count(*) from public.marks), 4);
select gradia_tests.expect_count(
  'teacher A cannot read another class mark',
  (select count(*) from public.marks where subject_id = 'b1000000-0000-4000-8000-000000000002'), 0);
select gradia_tests.expect_count(
  'teacher A cannot read another teacher subject mark',
  (select count(*) from public.marks where subject_id = 'b1000000-0000-4000-8000-000000000004'), 0);

select gradia_tests.expect_rows(
  'teacher A can update their own pre-publication mark',
  $sql$update public.marks set marks_obtained = 56
        where exam_id = 'c1000000-0000-4000-8000-000000000004'
          and subject_id = 'b1000000-0000-4000-8000-000000000001'
          and student_id = '50000000-0000-4000-8000-000000000041'$sql$,
  1);

select gradia_tests.expect_rows(
  'teacher B cannot update teacher A mark',
  $sql$update public.marks set marks_obtained = 99
        where exam_id = 'c1000000-0000-4000-8000-000000000004'
          and subject_id = 'b1000000-0000-4000-8000-000000000001'
          and student_id = '50000000-0000-4000-8000-000000000041'$sql$,
  0);

select gradia_tests.expect_rows(
  'teacher A cannot update a subject outside their assignment',
  $sql$update public.marks set marks_obtained = 99
        where exam_id = 'c1000000-0000-4000-8000-000000000004'
          and subject_id = 'b1000000-0000-4000-8000-000000000003'
          and student_id = '50000000-0000-4000-8000-000000000041'$sql$,
  0);

select gradia_tests.expect_error(
  'teacher A cannot insert a mark for another teacher subject',
  $sql$insert into public.marks (exam_id, subject_id, student_id, marks_obtained, entered_by)
       values ('c1000000-0000-4000-8000-000000000004',
               'b1000000-0000-4000-8000-000000000004',
               '50000000-0000-4000-8000-000000000041',
               50, '20000000-0000-4000-8000-000000000011')$sql$
);

select gradia_tests.expect_error(
  'teacher A cannot forge entered_by',
  $sql$insert into public.marks (exam_id, subject_id, student_id, marks_obtained, entered_by)
       values ('c1000000-0000-4000-8000-000000000004',
               'b1000000-0000-4000-8000-000000000001',
               '50000000-0000-4000-8000-000000000041',
               50, '20000000-0000-4000-8000-000000000012')$sql$
);

select gradia_tests.expect_error(
  'teacher A cannot write a mark for a student outside the class',
  $sql$insert into public.marks (exam_id, subject_id, student_id, marks_obtained, entered_by)
       values ('c1000000-0000-4000-8000-000000000004',
               'b1000000-0000-4000-8000-000000000001',
               '50000000-0000-4000-8000-000000000042',
               50, '20000000-0000-4000-8000-000000000011')$sql$
);

select gradia_tests.expect_rows(
  'teacher A cannot update a mark after publication',
  $sql$update public.marks set marks_obtained = 1
        where exam_id = 'c1000000-0000-4000-8000-000000000001'
          and subject_id = 'b1000000-0000-4000-8000-000000000001'
          and student_id = '50000000-0000-4000-8000-000000000041'$sql$,
  0);
reset role;

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000013","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_rows(
  'inactive teacher cannot update their own mark',
  $sql$update public.marks set marks_obtained = 99
        where exam_id = 'c1000000-0000-4000-8000-000000000004'
          and subject_id = 'b1000000-0000-4000-8000-000000000003'
          and student_id = '50000000-0000-4000-8000-000000000041'$sql$,
  0);
reset role;

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_rows(
  'admin cannot change a mark after publication',
  $sql$update public.marks set marks_obtained = 1
        where exam_id = 'c1000000-0000-4000-8000-000000000001'
          and subject_id = 'b1000000-0000-4000-8000-000000000001'
          and student_id = '50000000-0000-4000-8000-000000000041'$sql$,
  0);
reset role;

-- ============================================================
-- 5. Result sheets and items
-- ============================================================
\echo '--- 5. result sheets and items ---'

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count('admin sees every sheet', (select count(*) from public.result_sheets), 4);
select gradia_tests.expect_count('admin sees every item', (select count(*) from public.result_items), 4);
select gradia_tests.expect_count('admin sees every version', (select count(*) from public.result_sheet_versions), 4);
reset role;

select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000031","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count('principal sees every sheet', (select count(*) from public.result_sheets), 4);
reset role;

select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000021","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count(
  'HOD A sees only their class sheets',
  (select count(*) from public.result_sheets), 3);
select gradia_tests.expect_count(
  'HOD A cannot see another class sheet',
  (select count(*) from public.result_sheets where id = 'd1000000-0000-4000-8000-000000000002'), 0);
select gradia_tests.expect_count(
  'HOD A sees items of their class',
  (select count(*) from public.result_items), 3);
reset role;

select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000022","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count('HOD B sees only their class sheet',
  (select count(*) from public.result_sheets), 1);
reset role;

select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000041","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count(
  'student A sees only their published sheet',
  (select count(*) from public.result_sheets), 1);
select gradia_tests.expect_count(
  'student A sees only their own result item',
  (select count(*) from public.result_items), 1);
select gradia_tests.expect_count(
  'student A cannot see another student result',
  (select count(*) from public.result_items where student_id = '50000000-0000-4000-8000-000000000042'), 0);
select gradia_tests.expect_count(
  'student A sees only the published version',
  (select count(*) from public.result_sheet_versions), 1);
select gradia_tests.expect_rows(
  'student A cannot update a result item',
  $sql$update public.result_items set marks_obtained = 0
        where id = 'd3000000-0000-4000-8000-000000000001'$sql$,
  0);
reset role;

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count(
  'teacher A cannot read result sheets',
  (select count(*) from public.result_sheets), 0);
select gradia_tests.expect_count(
  'teacher A cannot read result items',
  (select count(*) from public.result_items), 0);
reset role;

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_rows(
  'admin cannot update a result item',
  $sql$update public.result_items set marks_obtained = 0
        where id = 'd3000000-0000-4000-8000-000000000001'$sql$,
  0);
select gradia_tests.expect_rows(
  'admin cannot delete a published sheet',
  $sql$delete from public.result_sheets where id = 'd1000000-0000-4000-8000-000000000001'$sql$,
  0);
reset role;

-- ============================================================
-- 6. Workflow RPCs
-- ============================================================
\echo '--- 6. workflow RPCs ---'

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_error(
  'teacher cannot compile a sheet',
  $sql$select public.compile_result_sheet('c1000000-0000-4000-8000-000000000005')$sql$);
reset role;

select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000021","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_error(
  'HOD cannot compile a sheet',
  $sql$select public.compile_result_sheet('c1000000-0000-4000-8000-000000000005')$sql$);
reset role;

select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000031","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_error(
  'principal cannot compile a sheet',
  $sql$select public.compile_result_sheet('c1000000-0000-4000-8000-000000000005')$sql$);
reset role;

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_rows(
  'admin compiles a sheet',
  $sql$select public.compile_result_sheet('c1000000-0000-4000-8000-000000000005')$sql$, 1);
select gradia_tests.expect_error(
  'the same exam cannot be compiled twice',
  $sql$select public.compile_result_sheet('c1000000-0000-4000-8000-000000000005')$sql$);
reset role;

select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000022","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_error(
  'HOD B cannot review a class A sheet',
  $sql$select public.review_result_sheet('d1000000-0000-4000-8000-000000000003', true, 'cross scope')$sql$);
reset role;

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_error(
  'teacher cannot review a sheet',
  $sql$select public.review_result_sheet('d1000000-0000-4000-8000-000000000003', true, 'nope')$sql$);
reset role;

select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000021","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_rows(
  'HOD A approves their class sheet',
  $sql$select public.review_result_sheet('d1000000-0000-4000-8000-000000000003', true, 'approved')$sql$, 1);
select gradia_tests.expect_error(
  'a sheet cannot be reviewed twice',
  $sql$select public.review_result_sheet('d1000000-0000-4000-8000-000000000003', true, 'again')$sql$);
select gradia_tests.expect_error(
  'HOD cannot sign off a sheet',
  $sql$select public.sign_off_result_sheet('d1000000-0000-4000-8000-000000000003', 'nope')$sql$);
reset role;

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_error(
  'admin cannot sign off a sheet',
  $sql$select public.sign_off_result_sheet('d1000000-0000-4000-8000-000000000003', 'nope')$sql$);
select gradia_tests.expect_error(
  'admin cannot publish a sheet',
  $sql$select public.publish_result_sheet('d1000000-0000-4000-8000-000000000003')$sql$);
reset role;

select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000031","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_rows(
  'principal signs off the approved sheet',
  $sql$select public.sign_off_result_sheet('d1000000-0000-4000-8000-000000000003', 'signed')$sql$, 1);
select gradia_tests.expect_error(
  'a sheet cannot be signed twice',
  $sql$select public.sign_off_result_sheet('d1000000-0000-4000-8000-000000000003', 'again')$sql$);
select gradia_tests.expect_rows(
  'principal publishes the signed sheet',
  $sql$select public.publish_result_sheet('d1000000-0000-4000-8000-000000000003')$sql$, 1);
select gradia_tests.expect_error(
  'a sheet cannot be published twice',
  $sql$select public.publish_result_sheet('d1000000-0000-4000-8000-000000000003')$sql$);
reset role;

-- ============================================================
-- 7. Published immutability
-- ============================================================
\echo '--- 7. published immutability ---'

-- Run as the migration role to prove the guard triggers enforce this even
-- when RLS is not in the way.
select gradia_tests.expect_error(
  'published sheet cannot change status',
  $sql$update public.result_sheets set status = 'draft'
        where id = 'd1000000-0000-4000-8000-000000000003'$sql$);
select gradia_tests.expect_error(
  'published sheet cannot be deleted',
  $sql$delete from public.result_sheets where id = 'd1000000-0000-4000-8000-000000000003'$sql$);
select gradia_tests.expect_error(
  'published version cannot change',
  $sql$update public.result_sheet_versions set status = 'draft'
        where id = 'd2000000-0000-4000-8000-000000000003'$sql$);
select gradia_tests.expect_error(
  'published version cannot be deleted',
  $sql$delete from public.result_sheet_versions where id = 'd2000000-0000-4000-8000-000000000003'$sql$);
select gradia_tests.expect_error(
  'published item cannot change',
  $sql$update public.result_items set marks_obtained = 0
        where id = 'd3000000-0000-4000-8000-000000000003'$sql$);
select gradia_tests.expect_error(
  'published item cannot be deleted',
  $sql$delete from public.result_items where id = 'd3000000-0000-4000-8000-000000000003'$sql$);

-- ============================================================
-- 8. Students after publication
-- ============================================================
\echo '--- 8. student view after publication ---'

select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000041","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count(
  'student A now sees both published sheets',
  (select count(*) from public.result_sheets), 2);
select gradia_tests.expect_count(
  'student A now sees both own items',
  (select count(*) from public.result_items), 2);
select gradia_tests.expect_count(
  'student A still cannot see the other class',
  (select count(*) from public.result_sheets where id = 'd1000000-0000-4000-8000-000000000002'), 0);
reset role;

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_rows(
  'teacher A cannot edit marks after the class results publish',
  $sql$update public.marks set marks_obtained = 1
        where exam_id = 'c1000000-0000-4000-8000-000000000003'
          and subject_id = 'b1000000-0000-4000-8000-000000000001'
          and student_id = '50000000-0000-4000-8000-000000000041'$sql$,
  0);
reset role;

-- ============================================================
-- 9. Notifications
-- ============================================================
\echo '--- 9. notifications ---'

select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000041","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count(
  'student A sees their own notifications only',
  (select count(*) from public.notifications), 2);
select gradia_tests.expect_count(
  'student A cannot read student B notifications',
  (select count(*) from public.notifications where id = 'e1000000-0000-4000-8000-000000000002'), 0);
select gradia_tests.expect_rows(
  'student A can mark their own notification read',
  $sql$update public.notifications set is_read = true
        where id = 'e1000000-0000-4000-8000-000000000001'$sql$,
  1);
select gradia_tests.expect_rows(
  'student A cannot mark someone else notification read',
  $sql$update public.notifications set is_read = true
        where id = 'e1000000-0000-4000-8000-000000000002'$sql$,
  0);
select gradia_tests.expect_error(
  'student A cannot forge a notification',
  $sql$insert into public.notifications (user_id, title, body)
       values ('50000000-0000-4000-8000-000000000041', 'fake', 'fake')$sql$);
select gradia_tests.expect_rows(
  'student A cannot delete someone else notification',
  $sql$delete from public.notifications where id = 'e1000000-0000-4000-8000-000000000002'$sql$,
  0);
reset role;

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count(
  'teacher sees no student notifications',
  (select count(*) from public.notifications), 0);
reset role;

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count(
  'admin cannot read another user notifications',
  (select count(*) from public.notifications where user_id = '50000000-0000-4000-8000-000000000041'), 0);
reset role;

-- ============================================================
-- 10. Audit log
-- ============================================================
\echo '--- 10. audit log ---'

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_at_least(
  'admin can read audit logs',
  (select count(*) from public.audit_logs), 1);
select gradia_tests.expect_error(
  'admin cannot write audit logs directly',
  $sql$insert into public.audit_logs (actor_id, action) values (null, 'forged')$sql$);
reset role;

select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000021","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count('HOD cannot read audit logs', (select count(*) from public.audit_logs), 0);
reset role;

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count('teacher cannot read audit logs', (select count(*) from public.audit_logs), 0);
reset role;

select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000031","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count('principal cannot read audit logs', (select count(*) from public.audit_logs), 0);
reset role;

select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000041","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count('student cannot read audit logs', (select count(*) from public.audit_logs), 0);
reset role;

-- ============================================================
-- 11. Inactive accounts
-- ============================================================
\echo '--- 11. inactive accounts ---'

select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000042","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count('student B sees only their own sheet',
  (select count(*) from public.result_sheets), 1);
reset role;

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count('inactive admin cannot read audit logs',
  (select count(*) from public.audit_logs), 0);
select gradia_tests.expect_error(
  'inactive admin cannot compile',
  $sql$select public.compile_result_sheet('c1000000-0000-4000-8000-000000000005')$sql$);
reset role;

-- ============================================================
-- 12. Admin can change role and reactivate an account
-- ============================================================
\echo '--- 12. admin role and activation management ---'

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_rows(
  'admin can change a role',
  $sql$update public.profiles set role = 'teacher'
        where id = '60000000-0000-4000-8000-000000000051'$sql$,
  1);
select gradia_tests.expect_rows(
  'admin can reactivate a teacher',
  $sql$update public.profiles set is_active = true
        where id = '20000000-0000-4000-8000-000000000013'$sql$,
  1);
reset role;

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000013","role":"authenticated"}', true);
set local role authenticated;
select gradia_tests.expect_count(
  'reactivated teacher sees their class again',
  (select count(*) from public.classes), 1);
select gradia_tests.expect_rows(
  'reactivated teacher can edit their pre-publication mark',
  $sql$update public.marks set marks_obtained = 66
        where exam_id = 'c1000000-0000-4000-8000-000000000004'
          and subject_id = 'b1000000-0000-4000-8000-000000000003'
          and student_id = '50000000-0000-4000-8000-000000000041'$sql$,
  1);
reset role;

\echo '=== All Phase 3 security scenarios passed (rolling back) ==='
rollback;
