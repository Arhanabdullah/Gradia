-- ============================================================
-- GRADIA · Phase 2 · Multiple teachers per class subject
-- ============================================================
-- A class subject must have at least one teacher, but may have more than one.
-- This removes the legacy one-teacher-per-(class, subject) constraint that
-- blocks a second teacher and keeps the newer (class_subject_id, teacher_id)
-- uniqueness introduced by 202611060002.
--
-- Run only after the frontend that assigns teachers through class_subject_id
-- is deployed. Until then, single-teacher assignment keeps working because
-- the child rows still carry class_id and subject_id for the legacy columns.
-- ============================================================

-- ---------- 1. drop the legacy one-teacher constraint ----------
-- The original migration created it as a table constraint. Some databases
-- may instead carry it as a standalone unique index, so handle both.
alter table public.teacher_assignments
  drop constraint if exists teacher_assignments_class_subject_unique;

drop index if exists public.teacher_assignments_class_subject_unique;

-- ---------- 2. keep one row per (class subject, teacher) ----------
create unique index if not exists teacher_assignments_class_subject_teacher_unique
  on public.teacher_assignments (class_subject_id, teacher_id)
  where class_subject_id is not null;

-- ---------- 3. new rows are non-primary unless explicitly promoted ----------
-- The partial index below allows at most one primary teacher per class
-- subject. A default of true would make the second teacher insert fail.
alter table public.teacher_assignments
  alter column is_primary set default false;

-- ---------- 4. backfill any row the earlier migration could not link ----------
update public.teacher_assignments ta
set class_subject_id = cs.id
from public.class_subjects cs
where ta.class_subject_id is null
  and cs.class_id = ta.class_id
  and cs.subject_id = ta.subject_id;

-- ---------- 5. demote duplicate primaries before enforcing the index ----------
with ranked as (
  select id,
         row_number() over (
           partition by class_subject_id
           order by created_at, id
         ) as position
  from public.teacher_assignments
  where is_primary
    and class_subject_id is not null
)
update public.teacher_assignments ta
set is_primary = false
from ranked r
where ta.id = r.id
  and r.position > 1;

do $$ begin
  create unique index if not exists teacher_assignments_one_primary
    on public.teacher_assignments (class_subject_id)
    where is_primary and class_subject_id is not null;
exception when unique_violation then
  raise warning 'Skipped teacher_assignments_one_primary: a class subject still has multiple primary teachers.';
end $$;

-- ---------- 6. helpful lookup for listing a class subject's teachers ----------
create index if not exists teacher_assignments_class_subject_teacher_lookup
  on public.teacher_assignments (class_subject_id, is_primary desc, created_at);

-- RLS for teacher_assignments already allows admins to insert, update and
-- delete. No policy change is needed for multiple rows per class subject.
