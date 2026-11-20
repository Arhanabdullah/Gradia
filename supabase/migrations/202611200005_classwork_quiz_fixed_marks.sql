-- ============================================================
-- GRADIA - Classwork quiz and fixed marks
-- ============================================================
-- Quiz joins assignment and project as a classwork kind. Each kind carries a
-- fixed internal mark so teachers cannot inflate a short activity:
--
--   quiz        8
--   assignment  8
--   project     6
--
-- Existing rows keep their published marks. The trigger enforces the fixed
-- scale on every new row and whenever a row's kind or marks are changed.

alter table public.classwork_items
  drop constraint if exists classwork_items_kind_check;

alter table public.classwork_items
  add constraint classwork_items_kind_check
  check (kind in ('assignment', 'quiz', 'project'));

create or replace function public.classwork_fixed_marks(p_kind text)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_kind
    when 'quiz' then 8::numeric
    when 'assignment' then 8::numeric
    when 'project' then 6::numeric
    else null::numeric
  end;
$$;

create or replace function public.set_classwork_fixed_marks()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_fixed numeric;
  v_legacy boolean := false;
begin
  v_fixed := public.classwork_fixed_marks(new.kind);
  if v_fixed is null then
    raise exception 'Unknown classwork kind: %', new.kind
      using errcode = 'check_violation';
  end if;

  -- A historical row with a non-fixed scale is left alone while its kind and
  -- marks stay untouched, so published marks and result sheets are not rewritten.
  if tg_op = 'UPDATE' then
    v_legacy := old.kind = new.kind
      and old.max_marks = new.max_marks
      and old.max_marks <> v_fixed;
  end if;

  if not v_legacy then
    new.max_marks := v_fixed;
  end if;

  return new;
end;
$$;

drop trigger if exists set_classwork_fixed_marks on public.classwork_items;
create trigger set_classwork_fixed_marks
  before insert or update of kind, max_marks on public.classwork_items
  for each row execute function public.set_classwork_fixed_marks();

