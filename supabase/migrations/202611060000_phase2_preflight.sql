-- ============================================================
-- GRADIA · Phase 2 · Preflight guard
-- ============================================================
-- The Phase 2 migrations extend the existing Gradia schema. They do
-- NOT create the baseline, because the baseline already exists in the
-- live project as supabase/schema.sql + the 20261105 migrations.
--
-- This guard fails fast with a readable message instead of letting the
-- later migrations fail with "relation does not exist". If it raises,
-- nothing in the Phase 2 chain has been applied.
-- ============================================================

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception
      'Gradia baseline missing: public.profiles does not exist. Run supabase/schema.sql first, then the 20261105 migrations.';
  end if;

  if to_regclass('public.classes') is null
     or to_regclass('public.subjects') is null
     or to_regclass('public.exams') is null
     or to_regclass('public.marks') is null
     or to_regclass('public.result_sheets') is null
     or to_regclass('public.result_items') is null then
    raise exception
      'Gradia baseline incomplete: a core table is missing. Run supabase/schema.sql before the Phase 2 migrations.';
  end if;

  if to_regclass('public.departments') is null
     or to_regclass('public.courses') is null
     or to_regclass('public.class_subjects') is null
     or to_regclass('public.teacher_assignments') is null then
    raise exception
      'Gradia migrations 202611050001 and 202611050002 have not been applied. Apply them before the Phase 2 chain.';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_admin'
  ) then
    raise exception
      'Gradia helper functions are missing (public.is_admin). Run supabase/schema.sql before the Phase 2 migrations.';
  end if;
end $$;
