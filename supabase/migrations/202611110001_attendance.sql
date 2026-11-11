-- ============================================================
-- GRADIA · Attendance records
-- ============================================================
-- Additive migration. No existing table, row or workflow is changed.
--
-- One row stores the attendance position for one student in one
-- class + subject + academic year. A teacher records the number of
-- classes attended and the number of classes conducted; the
-- percentage is a generated column so it can never drift from the
-- two counts.
--
--   subject percentage = attended_classes / total_classes * 100
--   overall percentage = sum(attended) / sum(total) * 100
--
-- The overall value is calculated by the client from the rows; the
-- database stores and validates the per-subject record.
-- ============================================================

-- ---------- attendance ----------
create table if not exists public.attendance (
  id                    uuid primary key default gen_random_uuid(),
  student_id            uuid not null references public.profiles(id) on delete cascade,
  class_id              uuid not null references public.classes(id) on delete cascade,
  subject_id            uuid not null references public.subjects(id) on delete restrict,
  academic_year         text not null,
  teacher_id            uuid not null references public.profiles(id) on delete restrict,
  recorded_by           uuid references public.profiles(id) on delete set null,
  attended_classes      integer not null,
  total_classes         integer not null,
  -- nullif keeps a hand-crafted total_classes = 0 from raising a division
  -- error before the check constraint below can report the real problem.
  attendance_percentage numeric(5,2) generated always as (
    round(attended_classes::numeric * 100 / nullif(total_classes, 0), 2)
  ) stored,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint attendance_student_class_subject_year_unique
    unique (student_id, class_id, subject_id, academic_year),
  constraint attendance_academic_year_present
    check (btrim(academic_year) <> ''),
  constraint attendance_attended_non_negative
    check (attended_classes >= 0),
  constraint attendance_total_positive
    check (total_classes > 0),
  constraint attendance_attended_within_total
    check (attended_classes <= total_classes)
);

create index if not exists attendance_student_id_idx
  on public.attendance (student_id);
create index if not exists attendance_class_subject_idx
  on public.attendance (class_id, subject_id);
create index if not exists attendance_teacher_id_idx
  on public.attendance (teacher_id);
create index if not exists attendance_academic_year_idx
  on public.attendance (academic_year);

-- ---------- validation ----------
-- Mirrors validate_mark(): a hand-crafted PostgREST write cannot link a
-- student to a class they are not in, a subject the class does not offer,
-- or a teacher who is not assigned to that class + subject.
create or replace function public.validate_attendance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role          public.user_role;
  v_student_class uuid;
  v_class_year    text;
  v_caller_role   public.user_role;
begin
  select role, class_id into v_role, v_student_class
  from public.profiles
  where id = new.student_id;

  if v_role is null then
    raise exception 'Student % does not exist', new.student_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_role <> 'student' then
    raise exception 'Attendance can only be recorded against student profiles'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.class_subjects cs
    where cs.class_id = new.class_id and cs.subject_id = new.subject_id
  ) then
    raise exception 'Subject % is not offered in class %', new.subject_id, new.class_id
      using errcode = 'check_violation';
  end if;

  if v_student_class is distinct from new.class_id
     and not exists (
       select 1 from public.student_enrollments en
       where en.student_id = new.student_id
         and en.class_id = new.class_id
         and en.status = 'active'
     ) then
    raise exception 'Student % is not enrolled in class %', new.student_id, new.class_id
      using errcode = 'check_violation';
  end if;

  select academic_year into v_class_year
  from public.classes
  where id = new.class_id;

  if v_class_year is not null
     and btrim(v_class_year) <> ''
     and new.academic_year is distinct from v_class_year then
    raise exception 'Academic year % does not match the class academic year %',
      new.academic_year, v_class_year
      using errcode = 'check_violation';
  end if;

  -- A teacher or HOD always records under their own identity. An admin
  -- may enter attendance on behalf of an assigned teacher.
  select role into v_caller_role
  from public.profiles
  where id = auth.uid() and is_active;

  if v_caller_role in ('teacher', 'hod') then
    new.teacher_id := auth.uid();
  end if;

  perform public.assert_profile_roles(
    new.teacher_id,
    array['teacher', 'hod', 'admin']::public.user_role[],
    'Attendance teacher'
  );

  if not exists (
    select 1 from public.teacher_assignments ta
    where ta.class_id = new.class_id
      and ta.subject_id = new.subject_id
      and ta.teacher_id = new.teacher_id
  ) then
    raise exception 'Teacher % is not assigned to subject % in class %',
      new.teacher_id, new.subject_id, new.class_id
      using errcode = 'check_violation';
  end if;

  new.recorded_by := coalesce(auth.uid(), new.recorded_by);

  return new;
end;
$$;

drop trigger if exists validate_attendance on public.attendance;
create trigger validate_attendance
  before insert or update on public.attendance
  for each row execute function public.validate_attendance();

drop trigger if exists set_updated_at on public.attendance;
create trigger set_updated_at
  before update on public.attendance
  for each row execute function public.set_updated_at();

-- ---------- scope helpers ----------
-- Read: self, admin/principal, the class HOD, or a teacher assigned to
-- that class + subject.
create or replace function public.can_view_attendance(
  p_student uuid,
  p_class   uuid,
  p_subject uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when not public.is_active_user() then false
    when public.has_role(array['admin', 'principal']::public.user_role[]) then true
    when public.is_student() then p_student = auth.uid()
    when public.is_hod() then public.is_class_hod(p_class)
    when public.is_teacher() then public.teaches_class_subject(p_class, p_subject)
    else false
  end;
$$;

-- Write: admin, or a teacher/HOD assigned to that class + subject.
create or replace function public.can_manage_attendance(
  p_class   uuid,
  p_subject uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_user()
    and (
      public.is_admin()
      or (
        public.has_role(array['teacher', 'hod']::public.user_role[])
        and public.teaches_class_subject(p_class, p_subject)
      )
    );
$$;

revoke execute on function public.can_view_attendance(uuid, uuid, uuid) from anon, public;
revoke execute on function public.can_manage_attendance(uuid, uuid) from anon, public;
grant execute on function public.can_view_attendance(uuid, uuid, uuid) to authenticated;
grant execute on function public.can_manage_attendance(uuid, uuid) to authenticated;

-- ---------- row level security ----------
alter table public.attendance enable row level security;

drop policy if exists "attendance read"   on public.attendance;
drop policy if exists "attendance insert" on public.attendance;
drop policy if exists "attendance update" on public.attendance;
drop policy if exists "attendance delete" on public.attendance;

create policy "attendance read" on public.attendance
  for select to authenticated
  using (public.can_view_attendance(student_id, class_id, subject_id));

create policy "attendance insert" on public.attendance
  for insert to authenticated
  with check (public.can_manage_attendance(class_id, subject_id));

create policy "attendance update" on public.attendance
  for update to authenticated
  using (public.can_manage_attendance(class_id, subject_id))
  with check (public.can_manage_attendance(class_id, subject_id));

create policy "attendance delete" on public.attendance
  for delete to authenticated
  using (public.can_manage_attendance(class_id, subject_id));

-- ---------- verification (read-only) ----------
-- select count(*) from public.attendance;
-- select * from public.attendance where attendance_percentage > 100;
