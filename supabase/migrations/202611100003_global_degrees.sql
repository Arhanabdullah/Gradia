-- ============================================================
-- GRADIA · Global degrees (remove department scoping)
-- ============================================================
-- 202611100002 introduced degrees scoped to a single department. In practice a
-- degree such as BSc or MSc can be offered by several departments, while the
-- department belongs on the course. This migration makes degrees global:
--   * drops degrees.department_id
--   * makes degree name and code unique across the catalogue
--   * keeps department on courses/classes/profiles
--   * keeps class degree aligned with its course degree
--   * keeps profile degree aligned with its course/class degree
--
-- Safe to run once. Existing degree rows are preserved. A deployment that
-- already contains department-scoped degrees must not have the same name or
-- code in two departments, because the new global unique constraints reject
-- duplicates. The live catalogue was empty when this migration was introduced.
-- ============================================================

-- ---------- 1. replace the consistency function before dropping its column ----------
create or replace function public.enforce_degree_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_course_degree uuid;
  v_class_degree  uuid;
begin
  if tg_table_name = 'classes' then
    if new.degree_id is not null and new.course_id is not null then
      select degree_id into v_course_degree
      from public.courses where id = new.course_id;
      if not found then
        raise exception 'Selected course was not found';
      end if;
      if v_course_degree is not null and v_course_degree is distinct from new.degree_id then
        raise exception 'Class degree must match the course degree';
      end if;
    end if;
  elsif tg_table_name = 'profiles' then
    if new.degree_id is not null then
      if new.course_id is not null then
        select degree_id into v_course_degree
        from public.courses where id = new.course_id;
        if not found then
          raise exception 'Selected course was not found';
        end if;
        if v_course_degree is not null and v_course_degree is distinct from new.degree_id then
          raise exception 'Profile degree must match the course degree';
        end if;
      end if;
      if new.class_id is not null then
        select degree_id into v_class_degree
        from public.classes where id = new.class_id;
        if not found then
          raise exception 'Selected class was not found';
        end if;
        if v_class_degree is not null and v_class_degree is distinct from new.degree_id then
          raise exception 'Profile degree must match the class degree';
        end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Courses no longer need a degree/department check; both are independent.
drop trigger if exists enforce_degree_scope on public.courses;

-- Classes and profiles keep the consistency trigger.
drop trigger if exists enforce_degree_scope on public.classes;
create trigger enforce_degree_scope
  before insert or update on public.classes
  for each row execute function public.enforce_degree_scope();

drop trigger if exists enforce_degree_scope on public.profiles;
create trigger enforce_degree_scope
  before insert or update on public.profiles
  for each row execute function public.enforce_degree_scope();

-- ---------- 2. remove the department scope from degrees ----------
alter table if exists public.degrees
  drop constraint if exists degrees_department_name_unique;
alter table if exists public.degrees
  drop constraint if exists degrees_department_code_unique;
drop index if exists public.degrees_department_id_idx;
alter table if exists public.degrees
  drop column if exists department_id;

-- ---------- 3. global uniqueness ----------
alter table public.degrees drop constraint if exists degrees_name_unique;
alter table public.degrees add constraint degrees_name_unique unique (name);
alter table public.degrees drop constraint if exists degrees_code_unique;
alter table public.degrees add constraint degrees_code_unique unique (code);

-- ---------- 4. verification (read-only) ----------
-- select count(*) from public.degrees;
-- select count(*) from information_schema.columns
--   where table_schema = 'public' and table_name = 'degrees' and column_name = 'department_id';
-- select count(*) from public.courses where degree_id is null;
-- select count(*) from public.classes where degree_id is null;
-- select count(*) from public.profiles where role in ('student', 'hod') and degree_id is null;
