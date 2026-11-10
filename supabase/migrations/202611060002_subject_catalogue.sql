-- ============================================================
-- GRADIA · Phase 2 · Global subject catalogue
-- ============================================================
-- Makes the catalogue authoritative and keeps every legacy link valid.
--
-- Authority model after this migration:
--   subjects          global catalogue (no class/teacher ownership)
--   course_subjects   which subjects a course prescribes
--   class_subjects    which subjects a class offers   (authoritative)
--   teacher_assignments  who teaches a class_subject  (authoritative)
--
-- subjects.class_id / subjects.teacher_id are RETAINED but deprecated.
-- Nothing reads them as authority after Phase 5. Dropping them is a
-- separate, later migration once the frontend no longer references them.
-- ============================================================

-- ---------- catalogue columns ----------
alter table public.subjects
  add column if not exists department_id uuid references public.departments(id) on delete set null;
alter table public.subjects
  add column if not exists description text;
alter table public.subjects
  add column if not exists credit_hours numeric(4,1);
alter table public.subjects
  add column if not exists is_active boolean not null default true;
alter table public.subjects
  add column if not exists updated_at timestamptz not null default now();
alter table public.subjects
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

do $$ begin
  alter table public.subjects
    add constraint subjects_credit_hours_non_negative
    check (credit_hours is null or credit_hours >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.subjects
    add constraint subjects_max_marks_positive
    check (max_marks is null or max_marks > 0);
exception
  when duplicate_object then null;
  when check_violation then
    raise warning 'Skipped subjects_max_marks_positive: existing subjects have max_marks <= 0.';
end $$;

drop trigger if exists set_updated_at on public.subjects;
create trigger set_updated_at
  before update on public.subjects
  for each row execute function public.set_updated_at();

create index if not exists subjects_department_id_idx
  on public.subjects (department_id);

-- A subject code is unique inside its department. Legacy rows have no
-- department, so they are exempt (PostgreSQL treats NULLs as distinct)
-- which keeps this migration safe on un-normalized data.
do $$ begin
  create unique index if not exists subjects_department_code_unique
    on public.subjects (department_id, code)
    where department_id is not null and code is not null and btrim(code) <> '';
exception when unique_violation then
  raise warning 'Skipped subjects_department_code_unique: duplicate subject codes exist in one department. Resolve them, then re-create the index.';
end $$;

-- ---------- derive the subject's department from its legacy class ----------
update public.subjects s
set department_id = c.department_id
from public.classes cl
join public.courses c on c.id = cl.course_id
where s.department_id is null
  and s.class_id = cl.id
  and c.department_id is not null;

-- ---------- courses prescribe subjects ----------
create table if not exists public.course_subjects (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  level       integer,          -- year of study, when the course prescribes one
  term_number integer,          -- term within the year, when known
  is_elective boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint course_subjects_course_subject_unique unique (course_id, subject_id),
  constraint course_subjects_level_positive check (level is null or level > 0),
  constraint course_subjects_term_positive  check (term_number is null or term_number > 0)
);

create index if not exists course_subjects_subject_id_idx
  on public.course_subjects (subject_id);
create index if not exists course_subjects_course_id_idx
  on public.course_subjects (course_id);

insert into public.course_subjects (course_id, subject_id)
select distinct cl.course_id, cs.subject_id
from public.class_subjects cs
join public.classes cl on cl.id = cs.class_id
where cl.course_id is not null
on conflict (course_id, subject_id) do nothing;

-- ---------- teacher assignments reference class_subjects ----------
alter table public.teacher_assignments
  add column if not exists class_subject_id uuid references public.class_subjects(id) on delete cascade;
alter table public.teacher_assignments
  add column if not exists is_primary boolean not null default true;
alter table public.teacher_assignments
  add column if not exists assigned_by uuid references public.profiles(id) on delete set null;

update public.teacher_assignments ta
set class_subject_id = cs.id
from public.class_subjects cs
where ta.class_subject_id is null
  and cs.class_id = ta.class_id
  and cs.subject_id = ta.subject_id;

create index if not exists teacher_assignments_class_subject_id_idx
  on public.teacher_assignments (class_subject_id);

-- Future-proofing for multiple teachers per class subject. This does not
-- conflict with the legacy (class_id, subject_id) unique constraint, which
-- is intentionally kept until ManageClasses stops upserting on it (Phase 5).
create unique index if not exists teacher_assignments_class_subject_teacher_unique
  on public.teacher_assignments (class_subject_id, teacher_id)
  where class_subject_id is not null;

-- At most one primary teacher per class subject.
do $$ begin
  create unique index if not exists teacher_assignments_one_primary
    on public.teacher_assignments (class_subject_id)
    where is_primary and class_subject_id is not null;
exception when unique_violation then
  raise warning 'Skipped teacher_assignments_one_primary: a class subject has multiple primary teachers. Fix and re-create the index.';
end $$;

-- Enforce the new FK everywhere it is already backfilled. Safe to skip on
-- un-migrated rows: the column is only made NOT NULL when no NULLs remain.
do $$ begin
  if not exists (select 1 from public.teacher_assignments where class_subject_id is null) then
    alter table public.teacher_assignments alter column class_subject_id set not null;
  end if;
end $$;

-- ---------- normalize legacy subject ownership into class_subjects ----------
-- Migration 202611050002 already backfilled subjects.class_id -> class_subjects.
-- This is a no-op safety net for databases that skipped that step.
insert into public.class_subjects (class_id, subject_id)
select s.class_id, s.id
from public.subjects s
where s.class_id is not null
on conflict (class_id, subject_id) do nothing;

-- ============================================================
-- RLS (interim: tightened in Phase 3)
-- ============================================================
alter table public.course_subjects enable row level security;

drop policy if exists "authenticated read course subjects" on public.course_subjects;
create policy "authenticated read course subjects" on public.course_subjects
  for select to authenticated using (true);
drop policy if exists "admin manage course subjects" on public.course_subjects;
create policy "admin manage course subjects" on public.course_subjects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Existing class_subjects / teacher_assignments policies are left untouched.
