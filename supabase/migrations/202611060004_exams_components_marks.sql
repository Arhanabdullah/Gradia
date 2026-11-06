-- ============================================================
-- GRADIA · Phase 2 · Examinations, assessment components, marks
-- ============================================================
-- Additive migration.
--
-- exams                 one examination event for a class
-- exam_subjects         which subjects the examination covers
-- assessment_components theory / practical / internal breakdown per subject
-- marks                 one row per student x exam_subject x component
-- mark_revisions        append-only history of mark changes
--
-- Compatibility notes:
--   * marks.marks_obtained stays NOT NULL. Non-present statuses
--     (absent/exempt/withheld) store 0 and the status is authoritative,
--     so a missing mark is never silently read as a real zero.
--   * marks.assessment_component_id is nullable for legacy rows and for
--     the current marks screen; Phase 5 makes the UI always send it.
--   * The legacy unique (exam_id, subject_id, student_id) is retained
--     because MarksEntry.jsx upserts on it today.
-- ============================================================

-- ---------- exams ----------
alter table public.exams
  add column if not exists academic_term_id uuid references public.academic_terms(id) on delete set null;
alter table public.exams
  add column if not exists exam_type text not null default 'standard';
alter table public.exams
  add column if not exists status text not null default 'draft';
alter table public.exams
  add column if not exists starts_on date;
alter table public.exams
  add column if not exists ends_on date;
alter table public.exams
  add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.exams
  add column if not exists updated_at timestamptz not null default now();

do $$ begin
  alter table public.exams
    add constraint exams_status_valid
    check (status in ('draft', 'open', 'ongoing', 'completed', 'cancelled'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.exams
    add constraint exams_dates_valid
    check (starts_on is null or ends_on is null or ends_on >= starts_on);
exception when duplicate_object then null; end $$;

drop trigger if exists set_updated_at on public.exams;
create trigger set_updated_at
  before update on public.exams
  for each row execute function public.set_updated_at();

create index if not exists exams_academic_term_id_idx
  on public.exams (academic_term_id);

update public.exams e
set academic_term_id = c.academic_term_id
from public.classes c
where e.academic_term_id is null
  and e.class_id = c.id
  and c.academic_term_id is not null;

-- ---------- exam subjects ----------
create table if not exists public.exam_subjects (
  id               uuid primary key default gen_random_uuid(),
  exam_id          uuid not null references public.exams(id) on delete cascade,
  subject_id       uuid not null references public.subjects(id) on delete restrict,
  class_subject_id uuid references public.class_subjects(id) on delete set null,
  max_marks        numeric(7,2) not null default 100,
  pass_marks       numeric(7,2),
  is_optional      boolean not null default false,
  created_at       timestamptz not null default now(),
  constraint exam_subjects_exam_subject_unique unique (exam_id, subject_id),
  constraint exam_subjects_max_marks_positive check (max_marks > 0),
  constraint exam_subjects_pass_marks_valid
    check (pass_marks is null or (pass_marks >= 0 and pass_marks <= max_marks))
);

create index if not exists exam_subjects_subject_id_idx
  on public.exam_subjects (subject_id);

insert into public.exam_subjects (exam_id, subject_id, class_subject_id, max_marks)
select e.id, cs.subject_id, cs.id, coalesce(s.max_marks, 100)
from public.exams e
join public.class_subjects cs on cs.class_id = e.class_id
join public.subjects s on s.id = cs.subject_id
on conflict (exam_id, subject_id) do nothing;

-- Legacy exams that already hold marks must keep a home for those marks.
insert into public.exam_subjects (exam_id, subject_id, max_marks)
select e.id, m.subject_id, coalesce(s.max_marks, 100)
from public.exams e
join public.marks m on m.exam_id = e.id
left join public.subjects s on s.id = m.subject_id
group by e.id, m.subject_id, s.max_marks
on conflict (exam_id, subject_id) do nothing;

update public.exam_subjects es
set class_subject_id = cs.id
from public.class_subjects cs
join public.exams e on e.class_id = cs.class_id
where es.class_subject_id is null
  and es.exam_id = e.id
  and cs.subject_id = es.subject_id;

-- ---------- assessment components ----------
create table if not exists public.assessment_components (
  id               uuid primary key default gen_random_uuid(),
  exam_subject_id  uuid not null references public.exam_subjects(id) on delete cascade,
  name             text not null,                    -- Internal / Practical / Theory
  component_type   text not null default 'theory',
  max_marks        numeric(7,2) not null,
  pass_marks       numeric(7,2),
  weight_percent   numeric(5,2),
  display_order    integer not null default 1,
  is_optional      boolean not null default false,
  created_at       timestamptz not null default now(),
  constraint assessment_components_unique unique (exam_subject_id, name),
  constraint assessment_components_name_present check (btrim(name) <> ''),
  constraint assessment_components_max_positive check (max_marks > 0),
  constraint assessment_components_pass_valid
    check (pass_marks is null or (pass_marks >= 0 and pass_marks <= max_marks)),
  constraint assessment_components_weight_valid
    check (weight_percent is null or (weight_percent > 0 and weight_percent <= 100))
);

create index if not exists assessment_components_exam_subject_id_idx
  on public.assessment_components (exam_subject_id);

-- One neutral component so existing marks keep a valid parent. Admin can
-- replace it with the real Internal/Practical/Theory split in Phase 6.
insert into public.assessment_components (
  exam_subject_id, name, component_type, max_marks, display_order
)
select es.id, 'Overall', 'overall', es.max_marks, 1
from public.exam_subjects es
on conflict (exam_subject_id, name) do nothing;

-- ---------- marks ----------
alter table public.marks
  add column if not exists assessment_component_id uuid references public.assessment_components(id) on delete set null;
alter table public.marks
  add column if not exists status text not null default 'present';
alter table public.marks
  add column if not exists remarks text;

do $$ begin
  alter table public.marks
    add constraint marks_status_valid
    check (status in ('present', 'absent', 'exempt', 'withheld'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.marks
    add constraint marks_obtained_non_negative
    check (marks_obtained >= 0);
exception
  when duplicate_object then null;
  when check_violation then
    raise warning 'Skipped marks_obtained_non_negative: existing marks contain negative values.';
end $$;

create index if not exists marks_assessment_component_id_idx
  on public.marks (assessment_component_id);
create index if not exists marks_student_id_idx
  on public.marks (student_id);

drop trigger if exists set_updated_at on public.marks;
create trigger set_updated_at
  before update on public.marks
  for each row execute function public.set_updated_at();

update public.marks m
set assessment_component_id = ac.id
from public.exam_subjects es
join public.assessment_components ac
  on ac.exam_subject_id = es.id and ac.name = 'Overall'
where m.assessment_component_id is null
  and es.exam_id = m.exam_id
  and es.subject_id = m.subject_id;

-- ---------- marks validation at the database layer ----------
-- Blocks cross-class writes even for a hand-crafted PostgREST request:
-- the student must belong to (or be enrolled in) the exam's class, and
-- the subject must actually be offered by that class.
create or replace function public.validate_mark()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_exam_class   uuid;
  v_student_class uuid;
  v_role         public.user_role;
  v_max          numeric;
begin
  select class_id into v_exam_class
  from public.exams
  where id = new.exam_id;

  if v_exam_class is null then
    raise exception 'Exam % does not exist', new.exam_id using errcode = 'foreign_key_violation';
  end if;

  select class_id, role into v_student_class, v_role
  from public.profiles
  where id = new.student_id;

  if v_role is null then
    raise exception 'Student % does not exist', new.student_id using errcode = 'foreign_key_violation';
  end if;

  if v_role <> 'student' then
    raise exception 'Marks can only be recorded against student profiles'
      using errcode = 'check_violation';
  end if;

  if v_student_class is distinct from v_exam_class
     and not exists (
       select 1 from public.student_enrollments en
       where en.student_id = new.student_id
         and en.class_id = v_exam_class
         and en.status = 'active'
     ) then
    raise exception 'Student % is not enrolled in the class of exam %',
      new.student_id, new.exam_id using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.class_subjects cs
    where cs.class_id = v_exam_class and cs.subject_id = new.subject_id
  ) then
    raise exception 'Subject % is not offered in the class of exam %',
      new.subject_id, new.exam_id using errcode = 'check_violation';
  end if;

  if new.assessment_component_id is not null then
    select ac.max_marks into v_max
    from public.assessment_components ac
    join public.exam_subjects es on es.id = ac.exam_subject_id
    where ac.id = new.assessment_component_id
      and es.exam_id = new.exam_id
      and es.subject_id = new.subject_id;

    if v_max is null then
      raise exception 'Assessment component % does not belong to exam % / subject %',
        new.assessment_component_id, new.exam_id, new.subject_id using errcode = 'check_violation';
    end if;
  else
    select es.max_marks into v_max
    from public.exam_subjects es
    where es.exam_id = new.exam_id and es.subject_id = new.subject_id;
  end if;

  if v_max is not null and new.marks_obtained > v_max then
    raise exception 'Marks % exceed the maximum % for this assessment',
      new.marks_obtained, v_max using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_mark on public.marks;
create trigger validate_mark
  before insert or update on public.marks
  for each row execute function public.validate_mark();

-- ---------- append-only mark history ----------
create table if not exists public.mark_revisions (
  id                      bigint generated always as identity primary key,
  mark_id                 uuid,
  exam_id                 uuid,
  subject_id              uuid,
  student_id              uuid,
  assessment_component_id uuid,
  previous_marks          numeric,
  new_marks               numeric,
  previous_status         text,
  new_status              text,
  change_type             text not null,
  changed_by              uuid references public.profiles(id) on delete set null,
  changed_at              timestamptz not null default now(),
  constraint mark_revisions_change_type_valid
    check (change_type in ('insert', 'update', 'delete'))
);

create index if not exists mark_revisions_mark_id_idx
  on public.mark_revisions (mark_id, changed_at desc);
create index if not exists mark_revisions_student_id_idx
  on public.mark_revisions (student_id, changed_at desc);

create or replace function public.log_mark_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.marks_obtained is not distinct from old.marks_obtained
       and new.status is not distinct from old.status
       and new.assessment_component_id is not distinct from old.assessment_component_id
       and new.remarks is not distinct from old.remarks then
      return new;
    end if;
  end if;

  insert into public.mark_revisions (
    mark_id, exam_id, subject_id, student_id, assessment_component_id,
    previous_marks, new_marks, previous_status, new_status, change_type, changed_by
  ) values (
    case when tg_op = 'DELETE' then old.id else new.id end,
    case when tg_op = 'DELETE' then old.exam_id else new.exam_id end,
    case when tg_op = 'DELETE' then old.subject_id else new.subject_id end,
    case when tg_op = 'DELETE' then old.student_id else new.student_id end,
    case when tg_op = 'DELETE' then old.assessment_component_id else new.assessment_component_id end,
    case when tg_op in ('UPDATE', 'DELETE') then old.marks_obtained end,
    case when tg_op in ('INSERT', 'UPDATE') then new.marks_obtained end,
    case when tg_op in ('UPDATE', 'DELETE') then old.status end,
    case when tg_op in ('INSERT', 'UPDATE') then new.status end,
    lower(tg_op),
    auth.uid()
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists log_mark_revision on public.marks;
create trigger log_mark_revision
  after insert or update or delete on public.marks
  for each row execute function public.log_mark_revision();

-- ============================================================
-- RLS (interim: tightened in Phase 3)
-- ============================================================
alter table public.exam_subjects         enable row level security;
alter table public.assessment_components enable row level security;
alter table public.mark_revisions        enable row level security;

drop policy if exists "authenticated read exam subjects" on public.exam_subjects;
create policy "authenticated read exam subjects" on public.exam_subjects
  for select to authenticated using (true);
drop policy if exists "admin manage exam subjects" on public.exam_subjects;
create policy "admin manage exam subjects" on public.exam_subjects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read assessment components" on public.assessment_components;
create policy "authenticated read assessment components" on public.assessment_components
  for select to authenticated using (true);
drop policy if exists "admin manage assessment components" on public.assessment_components;
create policy "admin manage assessment components" on public.assessment_components
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Mark history is sensitive: readable by admins until Phase 3 scopes it
-- to the owning teacher / HOD. No client writes at all.
drop policy if exists "admin read mark revisions" on public.mark_revisions;
create policy "admin read mark revisions" on public.mark_revisions
  for select to authenticated using (public.is_admin());
