-- ============================================================
-- GRADIA · Exam Cell configuration
-- ============================================================
-- Additive migration.
--
-- 1. Result-format configuration on institution_settings.
-- 2. Decimal subject full marks (existing integers are preserved).
-- 3. Exam Cell audit columns on sheets and versions.
-- 4. Per-student SGPA/CGPA summary table.
-- 5. Component-level marks uniqueness (multiple rows per subject).
-- 6. Exam Cell write policies for configuration tables only.
--
-- Existing rows, marks, results and grading bands are untouched.
-- ============================================================

-- ---------- 1. institution result format ----------
alter table public.institution_settings
  add column if not exists result_format jsonb not null default '{}'::jsonb;

-- ---------- 2. decimal full marks ----------
alter table public.subjects
  alter column max_marks type numeric(7,2) using max_marks::numeric;

-- ---------- 3. exam cell audit columns ----------
alter table public.result_sheets
  add column if not exists exam_approved_by uuid references public.profiles(id) on delete set null;
alter table public.result_sheets
  add column if not exists exam_approved_at timestamptz;
alter table public.result_sheets
  add column if not exists exam_remarks text default '';

alter table public.result_sheet_versions
  add column if not exists exam_approved_by uuid references public.profiles(id) on delete set null;
alter table public.result_sheet_versions
  add column if not exists exam_remarks text default '';

-- Credit at compile time so a later catalogue edit cannot rewrite a
-- historical SGPA/CGPA.
alter table public.result_items
  add column if not exists credit_hours numeric(4,1);

-- ---------- 4. per-student summary ----------
create table if not exists public.result_student_summaries (
  id                uuid primary key default gen_random_uuid(),
  sheet_id          uuid not null references public.result_sheets(id) on delete cascade,
  version_id        uuid references public.result_sheet_versions(id) on delete set null,
  student_id        uuid not null references public.profiles(id) on delete cascade,
  total_marks       numeric(10,2) not null default 0,
  max_marks         numeric(10,2) not null default 0,
  percentage        numeric(5,2),
  total_credits     numeric(6,1) not null default 0,
  earned_credits    numeric(6,1) not null default 0,
  total_grade_points numeric(10,2) not null default 0,
  sgpa              numeric(4,2),
  cgpa              numeric(4,2),
  overall_grade     text,
  is_pass           boolean,
  computed_at       timestamptz not null default now(),
  constraint result_student_summaries_unique unique (sheet_id, student_id)
);

create index if not exists result_student_summaries_student_id_idx
  on public.result_student_summaries (student_id);

alter table public.result_student_summaries enable row level security;

drop policy if exists "result summaries read" on public.result_student_summaries;
create policy "result summaries read" on public.result_student_summaries
  for select to authenticated using (
    public.is_monitor()
    or (
      public.can_view_sheet(sheet_id)
      and (
        public.has_role(array['admin', 'principal', 'hod']::public.user_role[])
        or student_id = auth.uid()
      )
    )
  );

-- ---------- 5. marks uniqueness per component ----------
-- The legacy constraint allowed one row per student/subject/exam, which
-- blocks IA + Quiz + Assignment + ESA rows. Keep NULLS NOT DISTINCT so a
-- legacy row without a component still has exactly one slot.
alter table public.marks
  drop constraint if exists marks_exam_id_subject_id_student_id_key;
drop index if exists marks_exam_id_subject_id_student_id_key;

create unique index if not exists marks_exam_subject_student_component_unique
  on public.marks (exam_id, subject_id, student_id, assessment_component_id)
  nulls not distinct;

-- ---------- 6. exam cell configuration policies ----------
drop policy if exists "institution settings exam cell write" on public.institution_settings;
create policy "institution settings exam cell write" on public.institution_settings
  for all to authenticated using (public.is_exam_cell()) with check (public.is_exam_cell());

drop policy if exists "grading schemes exam cell write" on public.grading_schemes;
create policy "grading schemes exam cell write" on public.grading_schemes
  for all to authenticated using (public.is_exam_cell()) with check (public.is_exam_cell());

drop policy if exists "grade bands exam cell write" on public.grade_bands;
create policy "grade bands exam cell write" on public.grade_bands
  for all to authenticated using (public.is_exam_cell()) with check (public.is_exam_cell());

-- Subject full marks and credit hours are configuration. Insert/delete of
-- the subject catalogue stays admin-only.
drop policy if exists "subjects exam cell update" on public.subjects;
create policy "subjects exam cell update" on public.subjects
  for update to authenticated using (public.is_exam_cell()) with check (public.is_exam_cell());

-- Exam subjects can be edited; new/removed exam subjects are only allowed
-- while no marks exist for the examination.
drop policy if exists "exam subjects exam cell update" on public.exam_subjects;
create policy "exam subjects exam cell update" on public.exam_subjects
  for update to authenticated using (public.is_exam_cell()) with check (public.is_exam_cell());

drop policy if exists "exam subjects exam cell insert" on public.exam_subjects;
create policy "exam subjects exam cell insert" on public.exam_subjects
  for insert to authenticated
  with check (public.is_exam_cell() and not public.exam_has_marks(exam_id));

drop policy if exists "exam subjects exam cell delete" on public.exam_subjects;
create policy "exam subjects exam cell delete" on public.exam_subjects
  for delete to authenticated
  using (public.is_exam_cell() and not public.exam_has_marks(exam_id));

drop policy if exists "assessment components exam cell write" on public.assessment_components;
create policy "assessment components exam cell write" on public.assessment_components
  for all to authenticated using (public.is_exam_cell()) with check (public.is_exam_cell());

-- Deleting a component with marks would null those marks through the FK.
-- Refuse it in the database as well as the UI.
create or replace function public.guard_assessment_component_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.marks m where m.assessment_component_id = old.id) then
    raise exception 'This assessment component already has marks and cannot be removed'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists guard_assessment_component_delete on public.assessment_components;
create trigger guard_assessment_component_delete
  before delete on public.assessment_components
  for each row execute function public.guard_assessment_component_delete();

-- Exam Cell can discard a rejected sheet so it can be recompiled.
drop policy if exists "result sheets exam cell delete" on public.result_sheets;
create policy "result sheets exam cell delete" on public.result_sheets
  for delete to authenticated
  using (public.is_exam_cell() and status <> 'published');
