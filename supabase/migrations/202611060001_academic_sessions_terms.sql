-- ============================================================
-- GRADIA · Phase 2 · Academic sessions, terms and class placement
-- ============================================================
-- Additive migration. Nothing is dropped or renamed.
--
-- Why dates are nullable on legacy rows:
--   Existing classes only carry the free-text academic_year/semester
--   values. There is no historical start/end date to recover, and this
--   project must not invent institutional calendar rules. New sessions
--   and terms are validated to have a sane date range when dates are
--   supplied; the admin UI (Phase 6) requires them for new records.
-- ============================================================

-- ---------- shared updated_at trigger ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------- academic sessions ----------
create table if not exists public.academic_sessions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,          -- e.g. "2025/2026"
  start_date date,
  end_date   date,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academic_sessions_dates_valid
    check (start_date is null or end_date is null or end_date > start_date)
);

-- at most one current session (guarded: pre-existing data may conflict)
do $$ begin
  create unique index if not exists academic_sessions_one_current
    on public.academic_sessions (is_current) where is_current;
exception when unique_violation then
  raise warning 'Skipped academic_sessions_one_current: more than one current session exists. Fix and re-create the index.';
end $$;

drop trigger if exists set_updated_at on public.academic_sessions;
create trigger set_updated_at
  before update on public.academic_sessions
  for each row execute function public.set_updated_at();

-- ---------- academic terms / semesters ----------
create table if not exists public.academic_terms (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.academic_sessions(id) on delete cascade,
  name        text not null,                -- e.g. "Semester 1"
  term_number integer not null,
  start_date  date,
  end_date    date,
  is_current  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint academic_terms_number_positive check (term_number > 0),
  constraint academic_terms_dates_valid
    check (start_date is null or end_date is null or end_date > start_date),
  constraint academic_terms_session_name_unique   unique (session_id, name),
  constraint academic_terms_session_number_unique unique (session_id, term_number)
);

-- at most one current term per session
do $$ begin
  create unique index if not exists academic_terms_one_current_per_session
    on public.academic_terms (session_id) where is_current;
exception when unique_violation then
  raise warning 'Skipped academic_terms_one_current_per_session: a session has multiple current terms. Fix and re-create the index.';
end $$;

drop trigger if exists set_updated_at on public.academic_terms;
create trigger set_updated_at
  before update on public.academic_terms
  for each row execute function public.set_updated_at();

create index if not exists academic_terms_session_id_idx
  on public.academic_terms (session_id);

-- ---------- classes: normalized placement ----------
alter table public.classes
  add column if not exists academic_term_id uuid references public.academic_terms(id) on delete set null;
alter table public.classes
  add column if not exists level integer;
alter table public.classes
  add column if not exists is_active boolean not null default true;

do $$ begin
  alter table public.classes
    add constraint classes_level_positive check (level is null or level > 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.classes
    add constraint classes_semester_positive check (semester is null or semester > 0);
exception
  when duplicate_object then null;
  when check_violation then
    raise warning 'Skipped classes_semester_positive: existing classes have a non-positive semester.';
end $$;

create index if not exists classes_academic_term_id_idx
  on public.classes (academic_term_id);

-- ---------- backfill from the legacy classes.academic_year / semester ----------
-- Only rows that actually carry a legacy year are touched.

insert into public.academic_sessions (name)
select distinct btrim(c.academic_year)
from public.classes c
where c.academic_year is not null and btrim(c.academic_year) <> ''
on conflict (name) do nothing;

insert into public.academic_terms (session_id, name, term_number)
select s.id,
       'Term ' || coalesce(c.semester, 1),
       coalesce(c.semester, 1)
from public.classes c
join public.academic_sessions s on s.name = btrim(c.academic_year)
where c.academic_year is not null and btrim(c.academic_year) <> ''
  and (c.semester is null or c.semester > 0)
group by s.id, coalesce(c.semester, 1)
on conflict (session_id, term_number) do nothing;

update public.classes c
set academic_term_id = t.id
from public.academic_terms t
join public.academic_sessions s on s.id = t.session_id
where c.academic_term_id is null
  and c.academic_year is not null
  and btrim(c.academic_year) <> ''
  and s.name = btrim(c.academic_year)
  and t.term_number = coalesce(c.semester, 1);

-- ---------- class identity within the academic structure ----------
-- A class is identified by course + term + section. Rows that predate
-- course/term normalization keep working because the index is partial.
do $$ begin
  create unique index if not exists classes_identity_unique
    on public.classes (course_id, academic_term_id, (coalesce(section, '')))
    where course_id is not null and academic_term_id is not null;
exception when unique_violation then
  raise warning 'Skipped classes_identity_unique: duplicate course/term/section classes exist. Resolve them, then re-create the index.';
end $$;

-- ============================================================
-- RLS (interim: tightened in Phase 3)
-- ============================================================
alter table public.academic_sessions enable row level security;
alter table public.academic_terms    enable row level security;

drop policy if exists "authenticated read academic sessions" on public.academic_sessions;
create policy "authenticated read academic sessions" on public.academic_sessions
  for select to authenticated using (true);
drop policy if exists "admin manage academic sessions" on public.academic_sessions;
create policy "admin manage academic sessions" on public.academic_sessions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read academic terms" on public.academic_terms;
create policy "authenticated read academic terms" on public.academic_terms
  for select to authenticated using (true);
drop policy if exists "admin manage academic terms" on public.academic_terms;
create policy "admin manage academic terms" on public.academic_terms
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
