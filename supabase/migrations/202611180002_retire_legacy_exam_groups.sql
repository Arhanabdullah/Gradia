-- ============================================================
-- GRADIA · Retire the legacy internal exam groups
-- ============================================================
-- Scheduling now happens inside one semester examination: a class carries its
-- theory and practical subjects, and each subject carries its own papers.
-- The standalone IA / Quiz / Assignment / Project groups were the old model
-- and are now empty shells, so they are removed.
--
-- This migration is destructive. It is guarded three ways:
--
--   1. it only matches the five legacy groups by name and type, plus groups
--      that are already cancelled;
--   2. it refuses any group that has a result sheet, marks or a marks
--      submission;
--   3. it writes the full group, exam, subject and component rows into
--      audit_logs (action exam_group.legacy_cleanup) before deleting.
--
-- Run it only after 202611180001_paper_schedule_mode.sql. Re-running is a
-- no-op because the matching groups are gone.
-- ============================================================

do $$
declare
  v_group  public.exam_groups%rowtype;
  v_backup jsonb;
  v_count  integer := 0;
begin
  for v_group in
    select g.*
    from public.exam_groups g
    where (
        (
          g.name in ('IA 1', 'IA 2', 'Quiz', 'Assignment', 'Project')
          and g.exam_type in ('internal_assessment', 'class_test', 'assignment', 'practical')
        )
        or g.status = 'cancelled'
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
        join public.marks m on m.exam_id = e.id
        where e.exam_group_id = g.id
      )
      and not exists (
        select 1
        from public.exams e
        join public.exam_submissions s on s.exam_id = e.id
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

    insert into public.audit_logs (
      actor_id, actor_role, action, entity_table, entity_id, details
    ) values (
      null, null, 'exam_group.legacy_cleanup', 'exam_groups', v_group.id::text,
      v_backup
    );

    -- exams.exam_group_id is ON DELETE SET NULL, so the examinations have to
    -- go first. Their subjects, papers, sheets and marks cascade from there.
    delete from public.exams where exam_group_id = v_group.id;
    delete from public.exam_groups where id = v_group.id;

    v_count := v_count + 1;
  end loop;

  raise notice 'Retired % legacy examination groups', v_count;
end $$;
