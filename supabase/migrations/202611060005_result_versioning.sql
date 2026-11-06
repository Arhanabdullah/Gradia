-- ============================================================
-- GRADIA · Phase 2 · Versioned result sheets
-- ============================================================
-- Additive migration.
--
-- Every result sheet gets at least one immutable version snapshot.
-- Corrections in Phase 4/7 insert version N+1; the previously published
-- version is never rewritten. The existing result_items / result_sheets
-- columns stay exactly as they are, so today's compile/review/publish
-- RPCs keep working untouched.
-- ============================================================

-- ---------- version table ----------
create table if not exists public.result_sheet_versions (
  id               uuid primary key default gen_random_uuid(),
  sheet_id         uuid not null references public.result_sheets(id) on delete cascade,
  version_number   integer not null,
  status           public.sheet_status not null default 'draft',
  compiled_by      uuid references public.profiles(id) on delete set null,
  reviewed_by      uuid references public.profiles(id) on delete set null,
  signed_by        uuid references public.profiles(id) on delete set null,
  published_by     uuid references public.profiles(id) on delete set null,
  hod_remarks      text default '',
  principal_remarks text default '',
  correction_reason text,
  compiled_at      timestamptz,
  published_at     timestamptz,
  snapshot         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  constraint result_sheet_versions_number_positive check (version_number > 0),
  constraint result_sheet_versions_unique unique (sheet_id, version_number)
);

create index if not exists result_sheet_versions_sheet_id_idx
  on public.result_sheet_versions (sheet_id, version_number desc);

-- ---------- sheet points at its current version ----------
alter table public.result_sheets
  add column if not exists current_version_number integer not null default 1;
alter table public.result_sheets
  add column if not exists current_version_id uuid references public.result_sheet_versions(id) on delete set null;

do $$ begin
  alter table public.result_sheets
    add constraint result_sheets_version_positive check (current_version_number > 0);
exception when duplicate_object then null; end $$;

-- ---------- seed version 1 from existing sheets ----------
insert into public.result_sheet_versions (
  sheet_id, version_number, status, compiled_by, reviewed_by, signed_by,
  published_by, hod_remarks, principal_remarks, compiled_at, published_at, snapshot
)
select
  s.id,
  1,
  s.status,
  s.compiled_by,
  s.hod_reviewed_by,
  case when s.status in ('principal_signed', 'published') then s.principal_signed_by end,
  case when s.status = 'published' then s.principal_signed_by end,
  coalesce(s.hod_remarks, ''),
  coalesce(s.principal_remarks, ''),
  s.created_at,
  s.published_at,
  jsonb_build_object(
    'seeded_from', 'phase2_backfill',
    'exam_id', s.exam_id,
    'class_id', s.class_id,
    'items', coalesce(
      (
        select jsonb_agg(to_jsonb(ri) - 'id')
        from public.result_items ri
        where ri.sheet_id = s.id
      ),
      '[]'::jsonb
    )
  )
from public.result_sheets s
on conflict (sheet_id, version_number) do nothing;

update public.result_sheets s
set current_version_id = v.id,
    current_version_number = v.version_number
from public.result_sheet_versions v
where v.sheet_id = s.id
  and v.version_number = 1
  and s.current_version_id is null;

-- ---------- result items gain version + grading detail ----------
alter table public.result_items
  add column if not exists version_id uuid references public.result_sheet_versions(id) on delete cascade;
alter table public.result_items
  add column if not exists grade text;
alter table public.result_items
  add column if not exists grade_point numeric(4,2);
alter table public.result_items
  add column if not exists is_pass boolean;
alter table public.result_items
  add column if not exists percentage numeric(5,2);
alter table public.result_items
  add column if not exists remarks text;

create index if not exists result_items_version_id_idx
  on public.result_items (version_id);

update public.result_items ri
set version_id = s.current_version_id
from public.result_sheets s
where ri.version_id is null
  and ri.sheet_id = s.id
  and s.current_version_id is not null;

-- ---------- component-level snapshot ----------
create table if not exists public.result_component_items (
  id              uuid primary key default gen_random_uuid(),
  result_item_id  uuid not null references public.result_items(id) on delete cascade,
  component_id    uuid references public.assessment_components(id) on delete set null,
  component_name  text not null,
  component_type  text not null default 'theory',
  max_marks       numeric(7,2) not null,
  marks_obtained  numeric(7,2),
  status          text not null default 'present',
  display_order   integer not null default 1,
  created_at      timestamptz not null default now(),
  constraint result_component_items_unique unique (result_item_id, component_name),
  constraint result_component_items_status_valid
    check (status in ('present', 'absent', 'exempt', 'withheld')),
  constraint result_component_items_max_positive check (max_marks > 0)
);

create index if not exists result_component_items_result_item_id_idx
  on public.result_component_items (result_item_id);

insert into public.result_component_items (
  result_item_id, component_id, component_name, component_type,
  max_marks, marks_obtained, status, display_order
)
select
  ri.id,
  ac.id,
  ac.name,
  ac.component_type,
  ac.max_marks,
  m.marks_obtained,
  m.status,
  ac.display_order
from public.result_items ri
join public.result_sheets s on s.id = ri.sheet_id
join public.marks m
  on m.exam_id = s.exam_id
 and m.student_id = ri.student_id
 and m.subject_id = ri.subject_id
join public.assessment_components ac on ac.id = m.assessment_component_id
on conflict (result_item_id, component_name) do nothing;

-- ---------- review trail ----------
create table if not exists public.result_reviews (
  id            uuid primary key default gen_random_uuid(),
  sheet_id      uuid not null references public.result_sheets(id) on delete cascade,
  version_id    uuid references public.result_sheet_versions(id) on delete set null,
  reviewer_id   uuid references public.profiles(id) on delete set null,
  reviewer_role public.user_role not null,
  decision      text not null,
  remarks       text not null default '',
  created_at    timestamptz not null default now(),
  constraint result_reviews_decision_valid
    check (decision in ('approved', 'rejected', 'revision_requested', 'signed', 'published'))
);

create index if not exists result_reviews_sheet_id_idx
  on public.result_reviews (sheet_id, created_at desc);

-- ============================================================
-- Immutability guards
-- ============================================================
-- A published version is frozen. Corrections must create a new version,
-- so the insert path for an unpublished version stays open.
create or replace function public.guard_result_version_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.published_at is not null then
    raise exception 'Published result versions are immutable; create a new version instead'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_result_version_mutation on public.result_sheet_versions;
create trigger guard_result_version_mutation
  before update or delete on public.result_sheet_versions
  for each row execute function public.guard_result_version_mutation();

create or replace function public.guard_result_item_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_version uuid;
begin
  v_version := case when tg_op = 'DELETE' then old.version_id else new.version_id end;

  if v_version is not null and exists (
    select 1 from public.result_sheet_versions
    where id = v_version and published_at is not null
  ) then
    raise exception 'Published result items are immutable; create a new version instead'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_result_item_mutation on public.result_items;
create trigger guard_result_item_mutation
  before insert or update or delete on public.result_items
  for each row execute function public.guard_result_item_mutation();

create or replace function public.guard_result_component_item_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_item    uuid;
  v_version uuid;
begin
  v_item := case when tg_op = 'DELETE' then old.result_item_id else new.result_item_id end;

  select version_id into v_version
  from public.result_items
  where id = v_item;

  if v_version is not null and exists (
    select 1 from public.result_sheet_versions
    where id = v_version and published_at is not null
  ) then
    raise exception 'Published component marks are immutable; create a new version instead'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_result_component_item_mutation on public.result_component_items;
create trigger guard_result_component_item_mutation
  before insert or update or delete on public.result_component_items
  for each row execute function public.guard_result_component_item_mutation();

-- A published sheet can be re-versioned, but never un-published or deleted.
create or replace function public.guard_result_sheet_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'published' then
      raise exception 'Published result sheets cannot be deleted; create a correction version instead'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if old.status = 'published' then
    if new.status <> 'published' then
      raise exception 'A published result sheet cannot return to an earlier status'
        using errcode = 'insufficient_privilege';
    end if;
    if new.published_at is distinct from old.published_at then
      raise exception 'A published result sheet cannot change its publication timestamp'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_result_sheet_mutation on public.result_sheets;
create trigger guard_result_sheet_mutation
  before update or delete on public.result_sheets
  for each row execute function public.guard_result_sheet_mutation();

-- ============================================================
-- RLS (interim: tightened in Phase 3)
-- ============================================================
alter table public.result_sheet_versions   enable row level security;
alter table public.result_component_items  enable row level security;
alter table public.result_reviews          enable row level security;

drop policy if exists "admin read result versions" on public.result_sheet_versions;
create policy "admin read result versions" on public.result_sheet_versions
  for select to authenticated using (public.is_admin());
drop policy if exists "principal read result versions" on public.result_sheet_versions;
create policy "principal read result versions" on public.result_sheet_versions
  for select to authenticated using (public.app_role() = 'principal');

drop policy if exists "admin read result component items" on public.result_component_items;
create policy "admin read result component items" on public.result_component_items
  for select to authenticated using (public.is_admin());

drop policy if exists "admin read result reviews" on public.result_reviews;
create policy "admin read result reviews" on public.result_reviews
  for select to authenticated using (public.is_admin());
drop policy if exists "principal read result reviews" on public.result_reviews;
create policy "principal read result reviews" on public.result_reviews
  for select to authenticated using (public.app_role() = 'principal');
