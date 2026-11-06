-- ============================================================
-- GRADIA · Phase 2 · Enrollments, HOD scope and profile fields
-- ============================================================
-- Additive migration.
--   * profiles gains phone + updated_at (identity module requirements)
--   * student_enrollments is the historical record of class membership
--   * class_hod_assignments / department_hod_assignments give HODs an
--     explicit academic scope instead of only classes.hod_id
--
-- profiles.class_id is RETAINED as a convenience pointer for the current
-- class (many existing screens read it). enrollments become the history.
-- ============================================================

-- ---------- identity fields ----------
alter table public.profiles
  add column if not exists phone text;
alter table public.profiles
  add column if not exists updated_at timestamptz not null default now();

do $$ begin
  alter table public.profiles
    add constraint profiles_email_present check (email is null or position('@' in email) > 1);
exception when duplicate_object then null; end $$;

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------- student enrollments (historical) ----------
create table if not exists public.student_enrollments (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references public.profiles(id) on delete cascade,
  class_id         uuid not null references public.classes(id) on delete cascade,
  academic_term_id uuid references public.academic_terms(id) on delete set null,
  status           text not null default 'active',
  enrolled_on      date not null default current_date,
  ended_on         date,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint student_enrollments_status_valid
    check (status in ('active', 'completed', 'withdrawn', 'transferred')),
  constraint student_enrollments_dates_valid
    check (ended_on is null or ended_on >= enrolled_on)
);

create index if not exists student_enrollments_student_id_idx
  on public.student_enrollments (student_id);
create index if not exists student_enrollments_class_id_idx
  on public.student_enrollments (class_id);
create index if not exists student_enrollments_term_id_idx
  on public.student_enrollments (academic_term_id);

-- One enrollment per student/class/term (terms absent treated as one bucket).
do $$ begin
  create unique index if not exists student_enrollments_unique
    on public.student_enrollments (
      student_id,
      class_id,
      (coalesce(academic_term_id, '00000000-0000-0000-0000-000000000000'::uuid))
    );
exception when unique_violation then
  raise warning 'Skipped student_enrollments_unique: duplicate enrollments exist. Resolve them, then re-create the index.';
end $$;

-- A student has at most one active class per term.
do $$ begin
  create unique index if not exists student_enrollments_one_active_per_term
    on public.student_enrollments (student_id, (coalesce(academic_term_id, '00000000-0000-0000-0000-000000000000'::uuid)))
    where status = 'active';
exception when unique_violation then
  raise warning 'Skipped student_enrollments_one_active_per_term: a student has multiple active enrollments in one term.';
end $$;

drop trigger if exists set_updated_at on public.student_enrollments;
create trigger set_updated_at
  before update on public.student_enrollments
  for each row execute function public.set_updated_at();

insert into public.student_enrollments (student_id, class_id, academic_term_id, status)
select p.id, p.class_id, c.academic_term_id, 'active'
from public.profiles p
join public.classes c on c.id = p.class_id
where p.role = 'student'
  and p.class_id is not null
on conflict do nothing;

-- ---------- HOD scope ----------
create table if not exists public.class_hod_assignments (
  id         uuid primary key default gen_random_uuid(),
  class_id   uuid not null references public.classes(id) on delete cascade,
  hod_id     uuid not null references public.profiles(id) on delete cascade,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  constraint class_hod_assignments_unique unique (class_id, hod_id)
);

create index if not exists class_hod_assignments_hod_id_idx
  on public.class_hod_assignments (hod_id);

do $$ begin
  create unique index if not exists class_hod_assignments_one_primary
    on public.class_hod_assignments (class_id) where is_primary;
exception when unique_violation then
  raise warning 'Skipped class_hod_assignments_one_primary: a class has multiple primary HODs.';
end $$;

create table if not exists public.department_hod_assignments (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  hod_id        uuid not null references public.profiles(id) on delete cascade,
  is_primary    boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint department_hod_assignments_unique unique (department_id, hod_id)
);

create index if not exists department_hod_assignments_hod_id_idx
  on public.department_hod_assignments (hod_id);

do $$ begin
  create unique index if not exists department_hod_assignments_one_primary
    on public.department_hod_assignments (department_id) where is_primary;
exception when unique_violation then
  raise warning 'Skipped department_hod_assignments_one_primary: a department has multiple primary HODs.';
end $$;

insert into public.class_hod_assignments (class_id, hod_id)
select c.id, c.hod_id
from public.classes c
where c.hod_id is not null
on conflict (class_id, hod_id) do nothing;

insert into public.department_hod_assignments (department_id, hod_id)
select p.department_id, p.id
from public.profiles p
where p.role = 'hod'
  and p.department_id is not null
on conflict (department_id, hod_id) do nothing;

-- ---------- role validation for scoped assignments ----------
-- Roles live on profiles and must match the assignment being created.
-- security definer: reading profiles must not depend on the caller's RLS.
create or replace function public.assert_profile_roles(
  p_profile uuid,
  p_roles   public.user_role[],
  p_label   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_profile is null then
    return;
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_profile and role = any (p_roles)
  ) then
    raise exception '% (%) must have one of these roles: %',
      p_label, p_profile, array_to_string(p_roles, ', ')
      using errcode = 'check_violation';
  end if;
end;
$$;

revoke execute on function public.assert_profile_roles(uuid, public.user_role[], text) from anon, public;
grant execute on function public.assert_profile_roles(uuid, public.user_role[], text) to authenticated;

create or replace function public.validate_teacher_assignment_role()
returns trigger language plpgsql set search_path = public as $$
begin
  perform public.assert_profile_roles(
    new.teacher_id,
    array['teacher', 'hod', 'admin']::public.user_role[],
    'Assigned teacher'
  );
  return new;
end $$;

drop trigger if exists validate_role on public.teacher_assignments;
create trigger validate_role
  before insert or update on public.teacher_assignments
  for each row execute function public.validate_teacher_assignment_role();

create or replace function public.validate_enrollment_role()
returns trigger language plpgsql set search_path = public as $$
begin
  perform public.assert_profile_roles(
    new.student_id,
    array['student']::public.user_role[],
    'Enrolled student'
  );
  return new;
end $$;

drop trigger if exists validate_role on public.student_enrollments;
create trigger validate_role
  before insert or update on public.student_enrollments
  for each row execute function public.validate_enrollment_role();

create or replace function public.validate_hod_role()
returns trigger language plpgsql set search_path = public as $$
begin
  perform public.assert_profile_roles(
    new.hod_id,
    array['hod']::public.user_role[],
    'Assigned HOD'
  );
  return new;
end $$;

drop trigger if exists validate_role on public.class_hod_assignments;
create trigger validate_role
  before insert or update on public.class_hod_assignments
  for each row execute function public.validate_hod_role();

drop trigger if exists validate_role on public.department_hod_assignments;
create trigger validate_role
  before insert or update on public.department_hod_assignments
  for each row execute function public.validate_hod_role();

-- ============================================================
-- RLS (interim: tightened in Phase 3)
-- ============================================================
alter table public.student_enrollments            enable row level security;
alter table public.class_hod_assignments          enable row level security;
alter table public.department_hod_assignments     enable row level security;

drop policy if exists "read enrollments" on public.student_enrollments;
create policy "read enrollments" on public.student_enrollments
  for select to authenticated using (
    public.is_admin()
    or student_id = auth.uid()
    or public.app_role() in ('teacher', 'hod', 'principal')
  );
drop policy if exists "admin manage enrollments" on public.student_enrollments;
create policy "admin manage enrollments" on public.student_enrollments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read class hod" on public.class_hod_assignments;
create policy "authenticated read class hod" on public.class_hod_assignments
  for select to authenticated using (true);
drop policy if exists "admin manage class hod" on public.class_hod_assignments;
create policy "admin manage class hod" on public.class_hod_assignments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read department hod" on public.department_hod_assignments;
create policy "authenticated read department hod" on public.department_hod_assignments
  for select to authenticated using (true);
drop policy if exists "admin manage department hod" on public.department_hod_assignments;
create policy "admin manage department hod" on public.department_hod_assignments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
