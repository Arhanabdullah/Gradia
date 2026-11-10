-- ============================================================
-- GRADIA · Phase 2 · Institution settings, grading, audit, notifications
-- ============================================================
-- Additive migration. No existing row is modified except where a new
-- column needs a safe default.
--
-- Grading is intentionally NOT seeded with letter bands: doing so would
-- invent an institution's academic rules. A single empty default scheme
-- is created so the admin UI has something to attach bands to.
-- ============================================================

-- ---------- institution settings (single row) ----------
create table if not exists public.institution_settings (
  id                boolean primary key default true,
  name              text not null default 'Institution',
  short_name        text,
  address           text,
  email             text,
  phone             text,
  logo_url          text,
  timezone          text not null default 'UTC',
  default_grading_scheme_id uuid,
  updated_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint institution_settings_singleton check (id)
);

alter table public.institution_settings
  add column if not exists default_grading_scheme_id uuid;

drop trigger if exists set_updated_at on public.institution_settings;
create trigger set_updated_at
  before update on public.institution_settings
  for each row execute function public.set_updated_at();

insert into public.institution_settings (id, name)
values (true, 'Institution')
on conflict (id) do nothing;

-- ---------- grading ----------
create table if not exists public.grading_schemes (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  create unique index if not exists grading_schemes_one_default
    on public.grading_schemes (is_default) where is_default;
exception when unique_violation then
  raise warning 'Skipped grading_schemes_one_default: more than one default scheme exists.';
end $$;

drop trigger if exists set_updated_at on public.grading_schemes;
create trigger set_updated_at
  before update on public.grading_schemes
  for each row execute function public.set_updated_at();

create table if not exists public.grade_bands (
  id            uuid primary key default gen_random_uuid(),
  scheme_id     uuid not null references public.grading_schemes(id) on delete cascade,
  label         text not null,
  min_percent   numeric(5,2) not null,
  max_percent   numeric(5,2) not null,
  grade_point   numeric(4,2),
  is_pass       boolean not null default true,
  display_order integer not null default 1,
  created_at    timestamptz not null default now(),
  constraint grade_bands_unique unique (scheme_id, label),
  constraint grade_bands_label_present check (btrim(label) <> ''),
  constraint grade_bands_range_valid
    check (min_percent >= 0 and max_percent <= 100 and max_percent > min_percent)
);

create index if not exists grade_bands_scheme_id_idx
  on public.grade_bands (scheme_id, display_order);

insert into public.grading_schemes (name, is_default)
select 'Default', true
where not exists (select 1 from public.grading_schemes);

alter table public.institution_settings
  drop constraint if exists institution_settings_grading_scheme_fkey;
alter table public.institution_settings
  add constraint institution_settings_grading_scheme_fkey
  foreign key (default_grading_scheme_id)
  references public.grading_schemes(id) on delete set null;

-- ---------- audit log ----------
create table if not exists public.audit_logs (
  id           bigint generated always as identity primary key,
  actor_id     uuid references public.profiles(id) on delete set null,
  actor_role   public.user_role,
  action       text not null,
  entity_table text,
  entity_id    text,
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);
create index if not exists audit_logs_entity_idx
  on public.audit_logs (entity_table, entity_id);

-- Only the fields that matter for accountability are recorded. No PII
-- bulk copy of the profiles row.
create or replace function public.audit_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.role is not distinct from old.role
       and new.is_active is not distinct from old.is_active
       and new.department_id is not distinct from old.department_id
       and new.course_id is not distinct from old.course_id
       and new.class_id is not distinct from old.class_id then
      return new;
    end if;
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, entity_table, entity_id, details)
  values (
    auth.uid(),
    public.app_role(),
    case when tg_op = 'UPDATE' then 'profile.updated' else 'profile.created' end,
    'profiles',
    new.id::text,
    jsonb_build_object(
      'before', case when tg_op = 'UPDATE' then jsonb_build_object(
        'role', old.role,
        'is_active', old.is_active,
        'department_id', old.department_id,
        'course_id', old.course_id,
        'class_id', old.class_id
      ) else null end,
      'after', jsonb_build_object(
        'role', new.role,
        'is_active', new.is_active,
        'department_id', new.department_id,
        'course_id', new.course_id,
        'class_id', new.class_id
      )
    )
  );

  return new;
end;
$$;

drop trigger if exists audit_profile_changes on public.profiles;
create trigger audit_profile_changes
  after insert or update on public.profiles
  for each row execute function public.audit_profile_changes();

create or replace function public.audit_result_sheet_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.audit_logs (actor_id, actor_role, action, entity_table, entity_id, details)
    values (
      auth.uid(),
      public.app_role(),
      'result_sheet.status_changed',
      'result_sheets',
      new.id::text,
      jsonb_build_object('from', old.status, 'to', new.status)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists audit_result_sheet_status on public.result_sheets;
create trigger audit_result_sheet_status
  after update on public.result_sheets
  for each row execute function public.audit_result_sheet_status();

-- ---------- notification preferences + richer notifications ----------
create table if not exists public.notification_preferences (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  in_app     boolean not null default true,
  email      boolean not null default false,
  events     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.notification_preferences;
create trigger set_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

alter table public.notifications
  add column if not exists type text not null default 'general';
alter table public.notifications
  add column if not exists link text;
alter table public.notifications
  add column if not exists payload jsonb not null default '{}'::jsonb;
alter table public.notifications
  add column if not exists read_at timestamptz;

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, is_read, created_at desc);

-- ============================================================
-- RLS (interim: tightened in Phase 3)
-- ============================================================
alter table public.institution_settings     enable row level security;
alter table public.grading_schemes          enable row level security;
alter table public.grade_bands              enable row level security;
alter table public.audit_logs               enable row level security;
alter table public.notification_preferences enable row level security;

drop policy if exists "authenticated read institution settings" on public.institution_settings;
create policy "authenticated read institution settings" on public.institution_settings
  for select to authenticated using (true);
drop policy if exists "admin manage institution settings" on public.institution_settings;
create policy "admin manage institution settings" on public.institution_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read grading schemes" on public.grading_schemes;
create policy "authenticated read grading schemes" on public.grading_schemes
  for select to authenticated using (true);
drop policy if exists "admin manage grading schemes" on public.grading_schemes;
create policy "admin manage grading schemes" on public.grading_schemes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read grade bands" on public.grade_bands;
create policy "authenticated read grade bands" on public.grade_bands
  for select to authenticated using (true);
drop policy if exists "admin manage grade bands" on public.grade_bands;
create policy "admin manage grade bands" on public.grade_bands
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Audit records are admin-readable only. There is deliberately no client
-- write policy: rows are written by security-definer trigger functions.
drop policy if exists "admin read audit logs" on public.audit_logs;
create policy "admin read audit logs" on public.audit_logs
  for select to authenticated using (public.is_admin());

drop policy if exists "read own notification preferences" on public.notification_preferences;
create policy "read own notification preferences" on public.notification_preferences
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "write own notification preferences" on public.notification_preferences;
create policy "write own notification preferences" on public.notification_preferences
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "update own notification preferences" on public.notification_preferences;
create policy "update own notification preferences" on public.notification_preferences
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
