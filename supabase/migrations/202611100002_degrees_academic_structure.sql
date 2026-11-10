-- ============================================================
-- GRADIA · Degree layer between departments and courses
-- ============================================================
-- Adds the missing Department -> Degree -> Course -> Class level without
-- inventing placeholder data. Existing courses, classes and profiles are kept;
-- their new degree_id stays NULL until an administrator assigns a real degree.
--
-- The client and the create-user Edge Function require a degree for every new
-- course, class, student and department HOD. Course imports and the Academics
-- screens can fill the degree on older rows afterwards.
--
-- Safe to run once. Every statement is additive or guarded.
-- ============================================================

-- ---------- 1. degrees catalogue ----------
create table if not exists public.degrees (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete restrict,
  name          text not null,
  code          text,
  created_at    timestamptz not null default now(),
  constraint degrees_department_name_unique unique (department_id, name),
  constraint degrees_department_code_unique unique (department_id, code)
);

-- ---------- 2. link the existing hierarchy ----------
alter table public.courses
  add column if not exists degree_id uuid references public.degrees(id) on delete restrict;
alter table public.classes
  add column if not exists degree_id uuid references public.degrees(id) on delete restrict;
alter table public.profiles
  add column if not exists degree_id uuid references public.degrees(id) on delete restrict;

create index if not exists degrees_department_id_idx on public.degrees (department_id);
create index if not exists courses_degree_id_idx on public.courses (degree_id);
create index if not exists classes_degree_id_idx on public.classes (degree_id);
create index if not exists profiles_degree_id_idx on public.profiles (degree_id);

-- ---------- 3. keep the linked records mutually consistent ----------
-- A course degree must belong to the course department, a class degree must
-- belong to the course and department, and a profile degree must belong to the
-- profile department. This protects direct API writes as well as the UI.
create or replace function public.enforce_degree_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_degree_department uuid;
  v_course_department uuid;
  v_course_degree     uuid;
begin
  if tg_table_name = 'courses' then
    if new.degree_id is not null then
      select department_id into v_degree_department
      from public.degrees where id = new.degree_id;
      if v_degree_department is null then
        raise exception 'Selected degree was not found';
      end if;
      if new.department_id is distinct from v_degree_department then
        raise exception 'Course degree must belong to the selected department';
      end if;
    end if;
  elsif tg_table_name = 'classes' then
    if new.degree_id is not null then
      select department_id into v_degree_department
      from public.degrees where id = new.degree_id;
      if v_degree_department is null then
        raise exception 'Selected degree was not found';
      end if;
      if new.course_id is not null then
        select department_id, degree_id into v_course_department, v_course_degree
        from public.courses where id = new.course_id;
        if v_course_department is null then
          raise exception 'Selected course was not found';
        end if;
        if v_course_department is distinct from v_degree_department then
          raise exception 'Class degree must belong to the course department';
        end if;
        if v_course_degree is not null and v_course_degree is distinct from new.degree_id then
          raise exception 'Class degree must match the course degree';
        end if;
      end if;
    end if;
  elsif tg_table_name = 'profiles' then
    if new.degree_id is not null then
      select department_id into v_degree_department
      from public.degrees where id = new.degree_id;
      if v_degree_department is null then
        raise exception 'Selected degree was not found';
      end if;
      if new.department_id is null or new.department_id is distinct from v_degree_department then
        raise exception 'Profile degree must belong to the selected department';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_degree_scope on public.courses;
create trigger enforce_degree_scope
  before insert or update on public.courses
  for each row execute function public.enforce_degree_scope();

drop trigger if exists enforce_degree_scope on public.classes;
create trigger enforce_degree_scope
  before insert or update on public.classes
  for each row execute function public.enforce_degree_scope();

drop trigger if exists enforce_degree_scope on public.profiles;
create trigger enforce_degree_scope
  before insert or update on public.profiles
  for each row execute function public.enforce_degree_scope();

-- When a course degree changes, its classes follow the course so the
-- Department -> Degree -> Course -> Class chain never drifts.
create or replace function public.sync_class_degree_from_course()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.degree_id is distinct from old.degree_id then
    update public.classes
    set degree_id = new.degree_id
    where course_id = new.id
      and degree_id is distinct from new.degree_id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_class_degree_from_course on public.courses;
create trigger sync_class_degree_from_course
  after update of degree_id on public.courses
  for each row execute function public.sync_class_degree_from_course();

-- ---------- 4. degree changes are privileged profile changes ----------
-- This mirrors the Phase 3 guard and adds degree_id to the protected scope.
create or replace function public.enforce_profile_privileges()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role
     or new.is_active is distinct from old.is_active
     or new.department_id is distinct from old.department_id
     or new.degree_id is distinct from old.degree_id
     or new.course_id is distinct from old.course_id
     or new.class_id is distinct from old.class_id
     or new.student_id is distinct from old.student_id
     or new.teacher_id is distinct from old.teacher_id
     or new.hod_type is distinct from old.hod_type
     or new.hod_subject_id is distinct from old.hod_subject_id then

    if current_user in (
      'postgres', 'supabase_admin', 'service_role',
      'supabase_auth_admin', 'authenticator'
    ) then
      return new;
    end if;

    if not public.is_admin() then
      raise exception 'Only an active admin can change role, activation or academic scope'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

-- ---------- 5. RLS: every active account reads, only admins write ----------
alter table public.degrees enable row level security;

drop policy if exists "degrees read"        on public.degrees;
drop policy if exists "degrees admin write" on public.degrees;
create policy "degrees read" on public.degrees
  for select to authenticated using (public.is_active_user());
create policy "degrees admin write" on public.degrees
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- 6. verification (read-only) ----------
-- select count(*) from public.degrees;
-- select count(*) from public.courses where degree_id is null;
-- select count(*) from public.classes where degree_id is null;
-- select count(*) from public.profiles where role in ('student', 'hod') and degree_id is null;
