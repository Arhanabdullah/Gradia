-- ============================================================
-- GRADIA · Semester examination cleanup
-- ============================================================
-- The examination module is now one Semester Examination per class. Its
-- subjects carry the IA1, IA2, ESA, Quiz, Assignment and Project papers, so the
-- standalone exam groups created by the old scheduling screens are no longer
-- used. This migration removes those old groups and their papers.
--
-- Safety rules:
--
--   1. only groups created before 2026-11-20 are considered, so re-running the
--      migration cannot delete a semester examination scheduled afterwards;
--   2. a group is skipped when it has any marks, any result sheet (whatever the
--      status), any marks submission or any classwork item, so historical marks
--      and published results always survive;
--   3. every group is copied into public.exam_cleanup_backup_20261120 in full
--      before it is deleted;
--   4. public.restore_exam_cleanup_20261120() puts the backed-up groups back.
--
-- Rollback: select public.restore_exam_cleanup_20261120();
-- ============================================================

create table if not exists public.exam_cleanup_backup_20261120 (
  group_id     uuid primary key,
  payload      jsonb not null,
  backed_up_at timestamptz not null default now(),
  restored_at  timestamptz
);

comment on table public.exam_cleanup_backup_20261120 is
  'Full copy of the legacy examination groups removed by the semester examination cleanup on 2026-11-20. Restore with public.restore_exam_cleanup_20261120().';

-- Only administrators may read or restore the backup; it is a recovery aid,
-- not application data.
alter table public.exam_cleanup_backup_20261120 enable row level security;

drop policy if exists "exam cleanup backup admin read" on public.exam_cleanup_backup_20261120;
create policy "exam cleanup backup admin read" on public.exam_cleanup_backup_20261120
  for select to authenticated using (public.is_admin());

do $$
declare
  v_group  public.exam_groups%rowtype;
  v_backup jsonb;
  v_count  integer := 0;
begin
  for v_group in
    select g.*
    from public.exam_groups g
    where g.created_at < timestamptz '2026-11-20 00:00:00+00'
      and not exists (
        select 1
        from public.exams e
        join public.marks m on m.exam_id = e.id
        where e.exam_group_id = g.id
      )
      and not exists (
        select 1
        from public.exams e
        join public.result_sheets rs on rs.exam_id = e.id
        where e.exam_group_id = g.id
      )
      and not exists (
        select 1
        from public.exams e
        join public.exam_submissions s on s.exam_id = e.id
        where e.exam_group_id = g.id
      )
      and not exists (
        select 1
        from public.exams e
        join public.classwork_items ci on ci.exam_id = e.id
        where e.exam_group_id = g.id
      )
  loop
    v_backup := jsonb_build_object(
      'group', to_jsonb(v_group),
      'exams', coalesce((
        select jsonb_agg(to_jsonb(e) order by e.created_at)
        from public.exams e
        where e.exam_group_id = v_group.id
      ), '[]'::jsonb),
      'exam_subjects', coalesce((
        select jsonb_agg(to_jsonb(es) order by es.id)
        from public.exam_subjects es
        join public.exams e on e.id = es.exam_id
        where e.exam_group_id = v_group.id
      ), '[]'::jsonb),
      'assessment_components', coalesce((
        select jsonb_agg(to_jsonb(ac) order by ac.id)
        from public.assessment_components ac
        join public.exam_subjects es on es.id = ac.exam_subject_id
        join public.exams e on e.id = es.exam_id
        where e.exam_group_id = v_group.id
      ), '[]'::jsonb)
    );

    insert into public.exam_cleanup_backup_20261120 (group_id, payload)
    values (v_group.id, v_backup)
    on conflict (group_id) do nothing;

    insert into public.audit_logs (
      actor_id, actor_role, action, entity_table, entity_id, details
    ) values (
      null, null, 'exam_group.semester_cleanup', 'exam_groups', v_group.id::text,
      v_backup
    );

    -- exams.exam_group_id is ON DELETE SET NULL, so the examinations go first.
    -- Subjects, papers and submissions cascade from the exam row.
    delete from public.exams where exam_group_id = v_group.id;
    delete from public.exam_groups where id = v_group.id;
    v_count := v_count + 1;
  end loop;

  raise notice 'Removed % legacy examination groups; backup kept in exam_cleanup_backup_20261120', v_count;
end $$;

create or replace function public.restore_exam_cleanup_20261120()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row   public.exam_cleanup_backup_20261120%rowtype;
  v_count integer := 0;
begin
  perform public.require_active_user();

  if not public.is_admin() then
    raise exception 'Only administrators can restore the examination backup'
      using errcode = 'insufficient_privilege';
  end if;

  for v_row in
    select * from public.exam_cleanup_backup_20261120
    where restored_at is null
    order by backed_up_at
  loop
    if exists (select 1 from public.exam_groups g where g.id = v_row.group_id) then
      update public.exam_cleanup_backup_20261120
      set restored_at = now()
      where group_id = v_row.group_id;
      continue;
    end if;

    insert into public.exam_groups
    select * from jsonb_populate_record(null::public.exam_groups, v_row.payload->'group');

    insert into public.exams
    select (jsonb_populate_record(null::public.exams, item)).*
    from jsonb_array_elements(v_row.payload->'exams') as item;

    insert into public.exam_subjects
    select (jsonb_populate_record(null::public.exam_subjects, item)).*
    from jsonb_array_elements(v_row.payload->'exam_subjects') as item;

    insert into public.assessment_components
    select (jsonb_populate_record(null::public.assessment_components, item)).*
    from jsonb_array_elements(v_row.payload->'assessment_components') as item;

    update public.exam_cleanup_backup_20261120
    set restored_at = now()
    where group_id = v_row.group_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.restore_exam_cleanup_20261120() from anon, public;
grant execute on function public.restore_exam_cleanup_20261120() to authenticated;
