-- ============================================================
-- GRADIA · Phase 4 · Examination scheduling, scope and marks submission
-- ============================================================
-- Additive migration. Depends on:
--   202611060004_exams_components_marks.sql  (exams/exam_subjects/marks shape)
--   202611070003_security_policies.sql       (scoped RLS)
--   202611070004_secure_workflow_rpcs.sql    (compile/review/sign/publish)
--
-- Design notes:
--   * `exams` stays one row per class. marks and result_sheets point at it,
--     and compile_result_sheet(p_exam_id) is per class, so replacing it would
--     break the working result workflow.
--   * `exam_groups` is the scheduling container. A class exam has one group
--     with one exams row; a department-wide exam has one group with one exams
--     row per eligible class. All rows share the group's dates/status.
--   * exam_subjects carries the per-subject schedule. A group-wide edit
--     propagates the same date/time to every class through a guarded RPC.
--   * exam_submissions records the DRAFT -> SUBMITTED -> UNDER REVIEW ->
--     APPROVED / RETURNED stage before the existing result-sheet RPCs run.
--     Publication still only happens through publish_result_sheet().
--
-- Nothing existing is dropped or rewritten. Legacy exams are grouped 1:1 and
-- their exam_subjects rows already exist from 202611060004.
-- ============================================================

-- ============================================================
-- 1. Examination groups
-- ============================================================
create table if not exists public.exam_groups (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  exam_type        text not null default 'class_test',
  scope            text not null default 'class',
  department_id    uuid references public.departments(id) on delete set null,
  course_id        uuid references public.courses(id) on delete set null,
  academic_year    text,
  academic_term_id uuid references public.academic_terms(id) on delete set null,
  starts_on        date,
  ends_on          date,
  instructions     text not null default '',
  status           text not null default 'draft',
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint exam_groups_scope_valid
    check (scope in ('class', 'department')),
  constraint exam_groups_status_valid
    check (status in ('draft', 'open', 'ongoing', 'completed', 'cancelled')),
  constraint exam_groups_dates_valid
    check (starts_on is null or ends_on is null or ends_on >= starts_on)
);

do $$ begin
  alter table public.exam_groups
    add constraint exam_groups_type_valid
    check (exam_type in (
      'class_test', 'unit_test', 'internal_assessment', 'mid_term',
      'semester', 'practical', 'assignment', 'major', 'final', 'standard'
    ));
exception when duplicate_object then null; end $$;

create index if not exists exam_groups_department_id_idx
  on public.exam_groups (department_id);
create index if not exists exam_groups_course_id_idx
  on public.exam_groups (course_id);
create index if not exists exam_groups_status_idx
  on public.exam_groups (status);
create index if not exists exam_groups_created_by_idx
  on public.exam_groups (created_by);

drop trigger if exists set_updated_at on public.exam_groups;
create trigger set_updated_at
  before update on public.exam_groups
  for each row execute function public.set_updated_at();

-- ============================================================
-- 2. exams: group pointer, scope and instruction columns
-- ============================================================
alter table public.exams
  add column if not exists exam_group_id uuid references public.exam_groups(id) on delete set null;
alter table public.exams
  add column if not exists scope text not null default 'class';
alter table public.exams
  add column if not exists department_id uuid references public.departments(id) on delete set null;
alter table public.exams
  add column if not exists course_id uuid references public.courses(id) on delete set null;
alter table public.exams
  add column if not exists instructions text not null default '';

-- Normalise legacy values before adding the type check.
update public.exams
set exam_type = 'standard'
where exam_type is null
   or exam_type not in (
     'class_test', 'unit_test', 'internal_assessment', 'mid_term',
     'semester', 'practical', 'assignment', 'major', 'final', 'standard'
   );

do $$ begin
  alter table public.exams
    add constraint exams_scope_valid
    check (scope in ('class', 'department'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.exams
    add constraint exams_type_valid
    check (exam_type in (
      'class_test', 'unit_test', 'internal_assessment', 'mid_term',
      'semester', 'practical', 'assignment', 'major', 'final', 'standard'
    ));
exception when duplicate_object then null; end $$;

create index if not exists exams_exam_group_id_idx
  on public.exams (exam_group_id);
create unique index if not exists exams_group_class_unique
  on public.exams (exam_group_id, class_id)
  where exam_group_id is not null;

-- One group per legacy exam. Re-running is safe: grouped exams are skipped.
do $$
declare
  r record;
  g uuid;
begin
  for r in
    select e.id, e.name, e.exam_type, e.status, e.academic_year,
           e.academic_term_id, e.starts_on, e.ends_on, e.created_by,
           c.course_id, co.department_id
    from public.exams e
    join public.classes c on c.id = e.class_id
    left join public.courses co on co.id = c.course_id
    where e.exam_group_id is null
  loop
    insert into public.exam_groups (
      name, exam_type, scope, department_id, course_id, academic_year,
      academic_term_id, starts_on, ends_on, created_by, status
    ) values (
      r.name,
      coalesce(nullif(r.exam_type, 'standard'), 'class_test'),
      'class',
      r.department_id,
      r.course_id,
      r.academic_year,
      r.academic_term_id,
      r.starts_on,
      r.ends_on,
      r.created_by,
      coalesce(nullif(r.status, ''), 'draft')
    ) returning id into g;

    update public.exams
    set exam_group_id = g,
        scope = 'class',
        department_id = r.department_id,
        course_id = r.course_id
    where id = r.id;
  end loop;
end $$;

-- ============================================================
-- 3. exam_subjects: per-subject schedule
-- ============================================================
alter table public.exam_subjects
  add column if not exists exam_date date;
alter table public.exam_subjects
  add column if not exists start_time time;
alter table public.exam_subjects
  add column if not exists end_time time;
alter table public.exam_subjects
  add column if not exists duration_minutes integer;
alter table public.exam_subjects
  add column if not exists teacher_id uuid references public.profiles(id) on delete set null;
alter table public.exam_subjects
  add column if not exists room text;
alter table public.exam_subjects
  add column if not exists instructions text not null default '';
alter table public.exam_subjects
  add column if not exists allow_overlap boolean not null default false;
alter table public.exam_subjects
  add column if not exists updated_at timestamptz not null default now();

do $$ begin
  alter table public.exam_subjects
    add constraint exam_subjects_time_range_valid
    check (start_time is null or end_time is null or end_time > start_time);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.exam_subjects
    add constraint exam_subjects_duration_positive
    check (duration_minutes is null or duration_minutes > 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.exam_subjects
    add constraint exam_subjects_pass_marks_within_max
    check (pass_marks is null or (pass_marks >= 0 and pass_marks <= max_marks));
exception when duplicate_object then null; end $$;

create index if not exists exam_subjects_date_time_idx
  on public.exam_subjects (exam_date, start_time);
create index if not exists exam_subjects_teacher_id_idx
  on public.exam_subjects (teacher_id);

drop trigger if exists set_updated_at on public.exam_subjects;
create trigger set_updated_at
  before update on public.exam_subjects
  for each row execute function public.set_updated_at();

-- Duration is always derived from the clock times when both are supplied.
create or replace function public.set_exam_subject_duration()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.start_time is not null and new.end_time is not null then
    new.duration_minutes := greatest(
      1,
      round(extract(epoch from (new.end_time - new.start_time)) / 60)::integer
    );
  end if;
  return new;
end;
$$;

drop trigger if exists set_exam_subject_duration on public.exam_subjects;
create trigger set_exam_subject_duration
  before insert or update on public.exam_subjects
  for each row execute function public.set_exam_subject_duration();

-- Reject overlapping papers for the same class, unless explicitly allowed.
create or replace function public.validate_exam_subject_schedule()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_class     uuid;
  v_group     uuid;
  v_start     date;
  v_end       date;
begin
  select e.class_id, e.exam_group_id
  into v_class, v_group
  from public.exams e
  where e.id = new.exam_id;

  if v_class is null then
    raise exception 'Exam % does not exist', new.exam_id
      using errcode = 'foreign_key_violation';
  end if;

  if new.exam_date is not null and v_group is not null then
    select g.starts_on, g.ends_on
    into v_start, v_end
    from public.exam_groups g
    where g.id = v_group;

    if v_start is not null and new.exam_date < v_start then
      raise exception 'Subject date % is before the examination start date %', new.exam_date, v_start
        using errcode = 'check_violation';
    end if;
    if v_end is not null and new.exam_date > v_end then
      raise exception 'Subject date % is after the examination end date %', new.exam_date, v_end
        using errcode = 'check_violation';
    end if;
  end if;

  if new.exam_date is not null
     and new.start_time is not null
     and new.end_time is not null
     and not new.allow_overlap then
    if exists (
      select 1
      from public.exam_subjects es
      join public.exams e2 on e2.id = es.exam_id
      where es.id is distinct from new.id
        and e2.class_id = v_class
        and es.exam_date = new.exam_date
        and es.start_time is not null
        and es.end_time is not null
        and not es.allow_overlap
        and new.start_time < es.end_time
        and new.end_time > es.start_time
    ) then
      raise exception 'Another subject is already scheduled for this class at that time'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_exam_subject_schedule on public.exam_subjects;
create trigger validate_exam_subject_schedule
  before insert or update on public.exam_subjects
  for each row execute function public.validate_exam_subject_schedule();

-- ============================================================
-- 4. Marks submission and approval trail
-- ============================================================
create table if not exists public.exam_submissions (
  id              uuid primary key default gen_random_uuid(),
  exam_id         uuid not null references public.exams(id) on delete cascade,
  subject_id      uuid not null references public.subjects(id) on delete restrict,
  class_id        uuid not null references public.classes(id) on delete cascade,
  status          text not null default 'draft',
  submitted_by    uuid references public.profiles(id) on delete set null,
  submitted_at    timestamptz,
  reviewed_by     uuid references public.profiles(id) on delete set null,
  reviewed_at     timestamptz,
  approved_by     uuid references public.profiles(id) on delete set null,
  approved_at     timestamptz,
  review_remarks  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint exam_submissions_unique unique (exam_id, subject_id),
  constraint exam_submissions_status_valid
    check (status in ('draft', 'submitted', 'under_review', 'approved', 'returned'))
);

create index if not exists exam_submissions_exam_id_idx
  on public.exam_submissions (exam_id);
create index if not exists exam_submissions_class_id_idx
  on public.exam_submissions (class_id);
create index if not exists exam_submissions_status_idx
  on public.exam_submissions (status);

drop trigger if exists set_updated_at on public.exam_submissions;
create trigger set_updated_at
  before update on public.exam_submissions
  for each row execute function public.set_updated_at();

create table if not exists public.exam_submission_events (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.exam_submissions(id) on delete cascade,
  action         text not null,
  actor_id       uuid references public.profiles(id) on delete set null,
  remarks        text,
  created_at     timestamptz not null default now(),
  constraint exam_submission_events_action_valid
    check (action in ('submitted', 'review_started', 'approved', 'returned', 'reopened'))
);

create index if not exists exam_submission_events_submission_id_idx
  on public.exam_submission_events (submission_id);

-- ============================================================
-- 5. Scope helpers (SECURITY DEFINER, used by policies and RPCs)
-- ============================================================
create or replace function public.is_exam_subject_locked(p_exam uuid, p_subject uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.exam_submissions s
    where s.exam_id = p_exam
      and s.subject_id = p_subject
      and s.status in ('submitted', 'under_review', 'approved')
  );
$$;

create or replace function public.exam_has_marks(p_exam uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.marks m where m.exam_id = p_exam
  );
$$;

create or replace function public.can_view_exam_group(p_group uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when not public.is_active_user() then false
    when public.has_role(array['admin', 'principal']::public.user_role[]) then true
    when public.is_hod() then exists (
      select 1
      from public.exam_groups g
      where g.id = p_group
        and (
          (g.department_id is not null and public.is_department_hod(g.department_id))
          or exists (
            select 1 from public.exams e
            where e.exam_group_id = g.id and public.is_class_hod(e.class_id)
          )
        )
    )
    when public.is_teacher() then exists (
      select 1 from public.exams e
      where e.exam_group_id = p_group and public.teaches_class(e.class_id)
    )
    when public.is_student() then exists (
      select 1 from public.exams e
      where e.exam_group_id = p_group and public.can_view_class(e.class_id)
    )
    else false
  end;
$$;

create or replace function public.can_edit_exam(p_exam uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_active_user() and exists (
    select 1
    from public.exams e
    where e.id = p_exam
      and (
        public.is_admin()
        or (
          public.is_teacher()
          and e.created_by = auth.uid()
          and e.scope = 'class'
          and e.exam_type = any (array[
            'class_test', 'unit_test', 'internal_assessment', 'assignment', 'practical'
          ])
          and e.status in ('draft', 'open')
          and public.teaches_class(e.class_id)
          and not public.exam_results_published(e.id)
        )
      )
  );
$$;

create or replace function public.can_edit_exam_subject(p_exam uuid, p_subject uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.can_edit_exam(p_exam)
    and (
      public.is_admin()
      or exists (
        select 1 from public.exams e
        where e.id = p_exam
          and public.teaches_class_subject(e.class_id, p_subject)
      )
    );
$$;

create or replace function public.can_edit_exam_group(p_group uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_active_user()
    and (
      public.is_admin()
      or (
        public.is_teacher()
        and exists (
          select 1 from public.exam_groups g
          where g.id = p_group and g.created_by = auth.uid() and g.scope = 'class'
        )
        and exists (
          select 1 from public.exams e where e.exam_group_id = p_group
        )
        and not exists (
          select 1 from public.exams e
          where e.exam_group_id = p_group and not public.can_edit_exam(e.id)
        )
      )
    );
$$;

create or replace function public.can_view_exam_submission(p_submission uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.exam_submissions s
    where s.id = p_submission
      and public.is_active_user()
      and (
        public.is_admin()
        or public.is_principal()
        or public.is_exam_hod(s.exam_id)
        or public.teaches_class_subject(s.class_id, s.subject_id)
      )
  );
$$;

-- ============================================================
-- 6. Row Level Security
-- ============================================================
alter table public.exam_groups           enable row level security;
alter table public.exam_submissions      enable row level security;
alter table public.exam_submission_events enable row level security;

drop policy if exists "exam groups read"          on public.exam_groups;
drop policy if exists "exam groups admin write"   on public.exam_groups;
drop policy if exists "exam groups teacher update" on public.exam_groups;

create policy "exam groups read" on public.exam_groups
  for select to authenticated using (public.can_view_exam_group(id));
create policy "exam groups admin write" on public.exam_groups
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "exam groups teacher update" on public.exam_groups
  for update to authenticated
  using (public.can_edit_exam_group(id))
  with check (public.can_edit_exam_group(id));

drop policy if exists "exams teacher insert" on public.exams;
drop policy if exists "exams teacher update" on public.exams;
drop policy if exists "exams teacher delete" on public.exams;

create policy "exams teacher insert" on public.exams
  for insert to authenticated
  with check (
    public.is_active_user()
    and public.is_teacher()
    and scope = 'class'
    and created_by = auth.uid()
    and exam_type = any (array[
      'class_test', 'unit_test', 'internal_assessment', 'assignment', 'practical'
    ])
    and public.teaches_class(class_id)
  );

create policy "exams teacher update" on public.exams
  for update to authenticated
  using (
    public.is_active_user()
    and public.is_teacher()
    and created_by = auth.uid()
    and scope = 'class'
    and exam_type = any (array[
      'class_test', 'unit_test', 'internal_assessment', 'assignment', 'practical'
    ])
    and status in ('draft', 'open')
    and public.teaches_class(class_id)
    and not public.exam_results_published(id)
  )
  with check (
    public.is_active_user()
    and public.is_teacher()
    and created_by = auth.uid()
    and scope = 'class'
    and exam_type = any (array[
      'class_test', 'unit_test', 'internal_assessment', 'assignment', 'practical'
    ])
    and status in ('draft', 'open')
    and public.teaches_class(class_id)
    and not public.exam_results_published(id)
  );

create policy "exams teacher delete" on public.exams
  for delete to authenticated
  using (
    public.is_active_user()
    and public.is_teacher()
    and created_by = auth.uid()
    and scope = 'class'
    and status in ('draft', 'open')
    and public.teaches_class(class_id)
    and not public.exam_has_marks(id)
    and not public.exam_results_published(id)
  );

drop policy if exists "exam subjects teacher insert" on public.exam_subjects;
drop policy if exists "exam subjects teacher update" on public.exam_subjects;
drop policy if exists "exam subjects teacher delete" on public.exam_subjects;

create policy "exam subjects teacher insert" on public.exam_subjects
  for insert to authenticated
  with check (public.can_edit_exam_subject(exam_id, subject_id));

create policy "exam subjects teacher update" on public.exam_subjects
  for update to authenticated
  using (public.can_edit_exam_subject(exam_id, subject_id))
  with check (public.can_edit_exam_subject(exam_id, subject_id));

create policy "exam subjects teacher delete" on public.exam_subjects
  for delete to authenticated
  using (public.can_edit_exam_subject(exam_id, subject_id));

drop policy if exists "exam submissions read" on public.exam_submissions;
create policy "exam submissions read" on public.exam_submissions
  for select to authenticated using (public.can_view_exam_submission(id));

drop policy if exists "exam submission events read" on public.exam_submission_events;
create policy "exam submission events read" on public.exam_submission_events
  for select to authenticated using (public.can_view_exam_submission(submission_id));

-- Marks become read-only as soon as the teacher submits, and stay locked
-- until the reviewer returns them or an admin reopens them.
drop policy if exists "marks scoped write" on public.marks;
create policy "marks scoped write" on public.marks
  for all to authenticated
  using (
    not public.exam_results_published(exam_id)
    and not public.is_exam_subject_locked(exam_id, subject_id)
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
    and not public.is_exam_subject_locked(exam_id, subject_id)
    and (
      public.is_admin()
      or (
        public.is_active_user()
        and public.teaches_exam_subject(exam_id, subject_id)
        and entered_by = auth.uid()
      )
    )
  );

-- ============================================================
-- 7. Create / schedule RPCs
-- ============================================================
create or replace function public.create_exam_group(
  p_name             text,
  p_exam_type        text,
  p_scope            text,
  p_department_id    uuid,
  p_course_id        uuid,
  p_academic_year    text,
  p_academic_term_id uuid,
  p_class_ids        uuid[],
  p_starts_on        date,
  p_ends_on          date,
  p_instructions     text,
  p_status           text,
  p_subjects         jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid          uuid := auth.uid();
  v_group        uuid;
  v_class        uuid;
  v_exam         uuid;
  v_subject      jsonb;
  v_subject_id   uuid;
  v_teacher      uuid;
  v_date         date;
  v_start        time;
  v_end          time;
  v_max          numeric;
  v_pass         numeric;
  v_seen         uuid[] := '{}';
  v_regular      text[] := array[
    'class_test', 'unit_test', 'internal_assessment', 'assignment', 'practical'
  ];
begin
  perform public.require_active_user();

  if not (public.is_admin() or public.is_teacher()) then
    raise exception 'Only administrators and teachers can create examinations'
      using errcode = 'insufficient_privilege';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Examination name is required' using errcode = 'check_violation';
  end if;

  if p_exam_type is null or p_exam_type not in (
    'class_test', 'unit_test', 'internal_assessment', 'mid_term',
    'semester', 'practical', 'assignment', 'major', 'final'
  ) then
    raise exception 'Unknown examination type: %', p_exam_type using errcode = 'check_violation';
  end if;

  if public.is_teacher() and not (p_exam_type = any (v_regular)) then
    raise exception 'Teachers cannot create % examinations', p_exam_type
      using errcode = 'insufficient_privilege';
  end if;

  if p_scope is null or p_scope not in ('class', 'department') then
    raise exception 'Examination scope must be class or department' using errcode = 'check_violation';
  end if;

  if p_status is null or p_status not in ('draft', 'open', 'ongoing', 'completed', 'cancelled') then
    raise exception 'Unknown examination status: %', p_status using errcode = 'check_violation';
  end if;

  if p_scope = 'class' and coalesce(array_length(p_class_ids, 1), 0) <> 1 then
    raise exception 'A class examination must select exactly one class'
      using errcode = 'check_violation';
  end if;

  if p_scope = 'department' and (
    p_department_id is null
    or p_course_id is null
    or coalesce(array_length(p_class_ids, 1), 0) = 0
  ) then
    raise exception 'A department examination needs a department, course and at least one class'
      using errcode = 'check_violation';
  end if;

  if p_starts_on is not null and p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'The end date cannot be before the start date' using errcode = 'check_violation';
  end if;

  if p_subjects is null
     or jsonb_typeof(p_subjects) <> 'array'
     or jsonb_array_length(p_subjects) = 0 then
    raise exception 'At least one subject is required' using errcode = 'check_violation';
  end if;

  -- Validate classes once.
  foreach v_class in array p_class_ids loop
    if not exists (select 1 from public.classes c where c.id = v_class) then
      raise exception 'Class % was not found', v_class using errcode = 'foreign_key_violation';
    end if;

    if p_department_id is not null and not exists (
      select 1 from public.classes c
      join public.courses co on co.id = c.course_id
      where c.id = v_class and co.department_id = p_department_id
    ) then
      raise exception 'Class % is outside the selected department', v_class
        using errcode = 'check_violation';
    end if;

    if p_course_id is not null and not exists (
      select 1 from public.classes c
      where c.id = v_class and c.course_id = p_course_id
    ) then
      raise exception 'Class % is outside the selected course', v_class
        using errcode = 'check_violation';
    end if;

    if public.is_teacher() and not public.teaches_class(v_class) then
      raise exception 'You do not teach class %', v_class using errcode = 'insufficient_privilege';
    end if;

    if exists (
      select 1 from public.exams e
      where e.class_id = v_class
        and lower(btrim(e.name)) = lower(btrim(p_name))
        and coalesce(e.academic_year, '') = coalesce(p_academic_year, '')
    ) then
      raise exception 'A "%" examination already exists for one of the selected classes', p_name
        using errcode = 'unique_violation';
    end if;
  end loop;

  -- Reject duplicate subjects before writing anything.
  for v_subject in select value from jsonb_array_elements(p_subjects) loop
    v_subject_id := nullif(v_subject->>'subject_id', '')::uuid;
    if v_subject_id is null then
      raise exception 'Every subject row needs a subject_id' using errcode = 'check_violation';
    end if;
    if v_subject_id = any (v_seen) then
      raise exception 'The same subject was added twice' using errcode = 'check_violation';
    end if;
    v_seen := array_append(v_seen, v_subject_id);
  end loop;

  insert into public.exam_groups (
    name, exam_type, scope, department_id, course_id, academic_year,
    academic_term_id, starts_on, ends_on, instructions, status, created_by
  ) values (
    btrim(p_name), p_exam_type, p_scope, p_department_id, p_course_id,
    p_academic_year, p_academic_term_id, p_starts_on, p_ends_on,
    coalesce(p_instructions, ''), p_status, v_uid
  ) returning id into v_group;

  foreach v_class in array p_class_ids loop
    insert into public.exams (
      class_id, name, academic_year, exam_type, status, starts_on, ends_on,
      academic_term_id, created_by, exam_group_id, scope, department_id,
      course_id, instructions
    ) values (
      v_class, btrim(p_name), p_academic_year, p_exam_type, p_status,
      p_starts_on, p_ends_on, p_academic_term_id, v_uid, v_group, p_scope,
      p_department_id, p_course_id, coalesce(p_instructions, '')
    ) returning id into v_exam;

    for v_subject in select value from jsonb_array_elements(p_subjects) loop
      v_subject_id := (v_subject->>'subject_id')::uuid;

      if not exists (
        select 1 from public.class_subjects cs
        where cs.class_id = v_class and cs.subject_id = v_subject_id
      ) then
        raise exception 'Subject % is not offered by class %', v_subject_id, v_class
          using errcode = 'check_violation';
      end if;

      if public.is_teacher() and not public.teaches_class_subject(v_class, v_subject_id) then
        raise exception 'You do not teach subject % in class %', v_subject_id, v_class
          using errcode = 'insufficient_privilege';
      end if;

      v_teacher := nullif(v_subject->>'teacher_id', '')::uuid;
      if v_teacher is null then
        select ta.teacher_id into v_teacher
        from public.teacher_assignments ta
        where ta.class_id = v_class and ta.subject_id = v_subject_id
        order by ta.created_at
        limit 1;
      end if;

      if v_teacher is not null and not exists (
        select 1 from public.profiles p
        where p.id = v_teacher and p.role = 'teacher' and p.is_active
      ) then
        raise exception 'Assigned teacher % is not an active teacher', v_teacher
          using errcode = 'check_violation';
      end if;

      v_max := coalesce(nullif(v_subject->>'max_marks', '')::numeric, 100);
      v_pass := nullif(v_subject->>'pass_marks', '')::numeric;

      if v_max <= 0 then
        raise exception 'Maximum marks must be greater than zero' using errcode = 'check_violation';
      end if;
      if v_pass is not null and (v_pass < 0 or v_pass > v_max) then
        raise exception 'Passing marks must be between 0 and the maximum marks'
          using errcode = 'check_violation';
      end if;

      v_date := nullif(v_subject->>'exam_date', '')::date;
      v_start := nullif(v_subject->>'start_time', '')::time;
      v_end := nullif(v_subject->>'end_time', '')::time;

      if v_start is not null and v_end is not null and v_end <= v_start then
        raise exception 'The end time must be after the start time' using errcode = 'check_violation';
      end if;

      insert into public.exam_subjects (
        exam_id, subject_id, class_subject_id, max_marks, pass_marks,
        is_optional, exam_date, start_time, end_time, teacher_id, room,
        instructions, allow_overlap
      ) values (
        v_exam,
        v_subject_id,
        (
          select cs.id from public.class_subjects cs
          where cs.class_id = v_class and cs.subject_id = v_subject_id
          limit 1
        ),
        v_max,
        v_pass,
        coalesce((v_subject->>'is_optional')::boolean, false),
        v_date,
        v_start,
        v_end,
        v_teacher,
        nullif(v_subject->>'room', ''),
        coalesce(v_subject->>'instructions', ''),
        coalesce((v_subject->>'allow_overlap')::boolean, false)
      );
    end loop;
  end loop;

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_table, entity_id, details
  ) values (
    v_uid, public.app_role(), 'exam_group.created', 'exam_groups', v_group::text,
    jsonb_build_object(
      'name', p_name,
      'type', p_exam_type,
      'scope', p_scope,
      'classes', to_jsonb(p_class_ids),
      'subject_count', jsonb_array_length(p_subjects)
    )
  );

  return v_group;
end;
$$;

create or replace function public.update_exam_subject_schedule(
  p_exam_subject_id uuid,
  p_exam_date       date,
  p_start_time      time,
  p_end_time        time,
  p_max_marks       numeric default null,
  p_pass_marks      numeric default null,
  p_teacher_id      uuid default null,
  p_instructions    text default null,
  p_room            text default null,
  p_allow_overlap   boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_exam      uuid;
  v_subject   uuid;
  v_group     uuid;
  v_max       numeric;
  v_pass      numeric;
begin
  perform public.require_active_user();

  select es.exam_id, es.subject_id, e.exam_group_id, es.max_marks, es.pass_marks
  into v_exam, v_subject, v_group, v_max, v_pass
  from public.exam_subjects es
  join public.exams e on e.id = es.exam_id
  where es.id = p_exam_subject_id;

  if v_exam is null then
    raise exception 'Exam subject was not found' using errcode = 'no_data_found';
  end if;

  if not public.can_edit_exam_subject(v_exam, v_subject) then
    raise exception 'You do not have permission to edit this schedule'
      using errcode = 'insufficient_privilege';
  end if;

  v_max := coalesce(p_max_marks, v_max);
  v_pass := coalesce(p_pass_marks, v_pass);

  if v_max is null or v_max <= 0 then
    raise exception 'Maximum marks must be greater than zero' using errcode = 'check_violation';
  end if;
  if v_pass is not null and (v_pass < 0 or v_pass > v_max) then
    raise exception 'Passing marks must be between 0 and the maximum marks'
      using errcode = 'check_violation';
  end if;

  if p_start_time is not null and p_end_time is not null and p_end_time <= p_start_time then
    raise exception 'The end time must be after the start time' using errcode = 'check_violation';
  end if;

  -- A department-wide exam keeps one schedule per subject across every class.
  update public.exam_subjects es
  set exam_date = p_exam_date,
      start_time = p_start_time,
      end_time = p_end_time,
      max_marks = v_max,
      pass_marks = v_pass,
      teacher_id = p_teacher_id,
      instructions = coalesce(p_instructions, es.instructions),
      room = p_room,
      allow_overlap = coalesce(p_allow_overlap, false)
  where es.subject_id = v_subject
    and (
      es.id = p_exam_subject_id
      or (
        v_group is not null
        and es.exam_id in (
          select e2.id from public.exams e2 where e2.exam_group_id = v_group
        )
      )
    );

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_table, entity_id, details
  ) values (
    v_uid, public.app_role(), 'exam_subject.scheduled', 'exam_subjects',
    p_exam_subject_id::text,
    jsonb_build_object(
      'exam_id', v_exam,
      'subject_id', v_subject,
      'date', p_exam_date,
      'start', p_start_time,
      'end', p_end_time
    )
  );
end;
$$;

create or replace function public.set_exam_group_status(
  p_group_id uuid,
  p_status   text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  perform public.require_active_user();

  if p_status is null or p_status not in ('draft', 'open', 'ongoing', 'completed', 'cancelled') then
    raise exception 'Unknown examination status: %', p_status using errcode = 'check_violation';
  end if;

  if not public.can_edit_exam_group(p_group_id) then
    raise exception 'You do not have permission to change this examination'
      using errcode = 'insufficient_privilege';
  end if;

  update public.exam_groups set status = p_status where id = p_group_id;
  update public.exams set status = p_status where exam_group_id = p_group_id;

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_table, entity_id, details
  ) values (
    v_uid, public.app_role(), 'exam_group.status_changed', 'exam_groups',
    p_group_id::text, jsonb_build_object('status', p_status)
  );
end;
$$;

-- ============================================================
-- 8. Marks submission RPCs
-- ============================================================
create or replace function public.submit_exam_marks(
  p_exam_id    uuid,
  p_subject_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid        uuid := auth.uid();
  v_class      uuid;
  v_status     text;
  v_students   int;
  v_entered    int;
  v_submission uuid;
begin
  perform public.require_active_user();

  select e.class_id into v_class from public.exams e where e.id = p_exam_id;
  if v_class is null then
    raise exception 'Exam was not found' using errcode = 'no_data_found';
  end if;

  if not (
    public.is_admin()
    or (
      public.is_teacher()
      and public.teaches_class_subject(v_class, p_subject_id)
    )
  ) then
    raise exception 'You do not teach this subject in this class'
      using errcode = 'insufficient_privilege';
  end if;

  if public.exam_results_published(p_exam_id) then
    raise exception 'Results for this examination are already published'
      using errcode = 'check_violation';
  end if;

  select id, status into v_submission, v_status
  from public.exam_submissions
  where exam_id = p_exam_id and subject_id = p_subject_id
  for update;

  if v_status = 'approved' then
    raise exception 'These marks are already approved' using errcode = 'check_violation';
  end if;
  if v_status = 'submitted' or v_status = 'under_review' then
    raise exception 'These marks are already awaiting review' using errcode = 'check_violation';
  end if;

  select count(*) into v_students
  from public.profiles
  where class_id = v_class and role = 'student' and is_active;

  select count(*) into v_entered
  from public.marks
  where exam_id = p_exam_id and subject_id = p_subject_id;

  if v_entered = 0 then
    raise exception 'Enter at least one mark before submitting' using errcode = 'check_violation';
  end if;
  if v_entered < v_students then
    raise exception 'Marks are missing for % student(s)', v_students - v_entered
      using errcode = 'check_violation';
  end if;

  if v_submission is null then
    insert into public.exam_submissions (
      exam_id, subject_id, class_id, status, submitted_by, submitted_at
    ) values (
      p_exam_id, p_subject_id, v_class, 'submitted', v_uid, now()
    ) returning id into v_submission;
  else
    update public.exam_submissions
    set status = 'submitted',
        submitted_by = v_uid,
        submitted_at = now(),
        reviewed_by = null,
        reviewed_at = null,
        approved_by = null,
        approved_at = null,
        review_remarks = null
    where id = v_submission;
  end if;

  insert into public.exam_submission_events (submission_id, action, actor_id)
  values (v_submission, 'submitted', v_uid);

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_table, entity_id, details
  ) values (
    v_uid, public.app_role(), 'marks.submitted', 'exam_submissions',
    v_submission::text,
    jsonb_build_object('exam_id', p_exam_id, 'subject_id', p_subject_id, 'class_id', v_class)
  );
end;
$$;

create or replace function public.review_exam_marks(
  p_exam_id    uuid,
  p_subject_id uuid,
  p_approve    boolean,
  p_remarks    text default ''
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid        uuid := auth.uid();
  v_submission uuid;
  v_status     text;
begin
  perform public.require_active_user();

  if not (public.is_admin() or public.is_exam_hod(p_exam_id)) then
    raise exception 'You are not the reviewer for this examination'
      using errcode = 'insufficient_privilege';
  end if;

  select id, status into v_submission, v_status
  from public.exam_submissions
  where exam_id = p_exam_id and subject_id = p_subject_id
  for update;

  if v_submission is null then
    raise exception 'Marks have not been submitted yet' using errcode = 'check_violation';
  end if;

  if v_status not in ('submitted', 'under_review') then
    raise exception 'Marks are not awaiting review' using errcode = 'check_violation';
  end if;

  if v_status = 'submitted' then
    insert into public.exam_submission_events (submission_id, action, actor_id)
    values (v_submission, 'review_started', v_uid);
  end if;

  update public.exam_submissions
  set status = case when p_approve then 'approved' else 'returned' end,
      reviewed_by = v_uid,
      reviewed_at = now(),
      approved_by = case when p_approve then v_uid else null end,
      approved_at = case when p_approve then now() else null end,
      review_remarks = coalesce(p_remarks, '')
  where id = v_submission;

  insert into public.exam_submission_events (submission_id, action, actor_id, remarks)
  values (
    v_submission,
    case when p_approve then 'approved' else 'returned' end,
    v_uid,
    coalesce(p_remarks, '')
  );

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_table, entity_id, details
  ) values (
    v_uid, public.app_role(),
    case when p_approve then 'marks.approved' else 'marks.returned' end,
    'exam_submissions', v_submission::text,
    jsonb_build_object('exam_id', p_exam_id, 'subject_id', p_subject_id, 'remarks', p_remarks)
  );
end;
$$;

create or replace function public.reopen_exam_marks(
  p_exam_id    uuid,
  p_subject_id uuid,
  p_remarks    text default ''
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid        uuid := auth.uid();
  v_submission uuid;
begin
  perform public.require_role(array['admin']::public.user_role[]);

  select id into v_submission
  from public.exam_submissions
  where exam_id = p_exam_id and subject_id = p_subject_id
  for update;

  if v_submission is null then
    raise exception 'Marks have not been submitted yet' using errcode = 'check_violation';
  end if;

  if public.exam_results_published(p_exam_id) then
    raise exception 'Published results cannot be reopened here' using errcode = 'check_violation';
  end if;

  update public.exam_submissions
  set status = 'returned',
      approved_by = null,
      approved_at = null,
      review_remarks = coalesce(p_remarks, '')
  where id = v_submission;

  insert into public.exam_submission_events (submission_id, action, actor_id, remarks)
  values (v_submission, 'reopened', v_uid, coalesce(p_remarks, ''));

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_table, entity_id, details
  ) values (
    v_uid, public.app_role(), 'marks.reopened', 'exam_submissions',
    v_submission::text,
    jsonb_build_object('exam_id', p_exam_id, 'subject_id', p_subject_id, 'remarks', p_remarks)
  );
end;
$$;

-- Compilation can only start once every submitted subject is approved.
-- Legacy exams with no submission rows keep their current behaviour.
create or replace function public.guard_exam_compile_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.exam_submissions s
    where s.exam_id = new.exam_id and s.status <> 'approved'
  ) then
    raise exception 'All subjects must be approved before compiling this examination'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_exam_compile_approval on public.result_sheets;
create trigger guard_exam_compile_approval
  before insert on public.result_sheets
  for each row execute function public.guard_exam_compile_approval();

-- ============================================================
-- 9. Function permissions
-- ============================================================
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'is_exam_subject_locked', 'exam_has_marks', 'can_view_exam_group',
        'can_edit_exam', 'can_edit_exam_subject', 'can_edit_exam_group',
        'can_view_exam_submission', 'create_exam_group',
        'update_exam_subject_schedule', 'set_exam_group_status',
        'submit_exam_marks', 'review_exam_marks', 'reopen_exam_marks',
        'guard_exam_compile_approval'
      )
  loop
    execute format('revoke execute on function %s from anon, public', fn.sig);
    execute format('grant execute on function %s to authenticated', fn.sig);
  end loop;
end $$;
