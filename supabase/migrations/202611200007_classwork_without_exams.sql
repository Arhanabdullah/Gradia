-- ============================================================
-- GRADIA - Classwork no longer creates examinations
-- ============================================================
-- Classwork is an assignment and deadline workflow only. Marks for quiz,
-- assignment and project are already assessment components of the semester
-- examination, so publishing classwork must not create a standalone exam or
-- exam_subjects row.
--
-- This migration:
--   1. backs up every Classwork-created exam with its exam_subjects and marks,
--   2. repoints publish_classwork_item() so it only publishes and notifies,
--   3. clears legacy Classwork exam links and deletes those standalone exams.
-- The four 2026-27 semester examinations inside exam groups are untouched.

create table if not exists public.classwork_exam_cleanup_backup_20261120 (
  exam_id       uuid primary key,
  exam          jsonb not null,
  exam_subjects jsonb not null default '[]'::jsonb,
  marks         jsonb not null default '[]'::jsonb,
  deleted_at    timestamptz not null default now()
);

drop table if exists pg_temp.cw_exam_cleanup_targets;

create temp table cw_exam_cleanup_targets on commit drop as
select distinct e.id
from public.exams e
join public.classwork_items ci on ci.exam_id = e.id
where e.exam_group_id is null
  and e.academic_year = '2026-27'
  and not exists (
    select 1 from public.result_sheets rs where rs.exam_id = e.id
  );

insert into public.classwork_exam_cleanup_backup_20261120 (
  exam_id, exam, exam_subjects, marks
)
select
  e.id,
  to_jsonb(e),
  coalesce((
    select jsonb_agg(to_jsonb(es) order by es.id)
    from public.exam_subjects es
    where es.exam_id = e.id
  ), '[]'::jsonb),
  coalesce((
    select jsonb_agg(to_jsonb(m) order by m.created_at, m.id)
    from public.marks m
    where m.exam_id = e.id
  ), '[]'::jsonb)
from pg_temp.cw_exam_cleanup_targets t
join public.exams e on e.id = t.id
on conflict (exam_id) do nothing;

create or replace function public.publish_classwork_item(p_item_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item    public.classwork_items;
  v_student record;
begin
  perform public.require_active_user();
  select * into v_item from public.classwork_items where id = p_item_id;
  if not found then
    raise exception 'Classwork item not found' using errcode = 'no_data_found';
  end if;

  if not (public.is_admin() or public.is_exam_cell() or public.teaches_class_subject(v_item.class_id, v_item.subject_id)) then
    raise exception 'You can only publish classwork for your own class and subject'
      using errcode = 'insufficient_privilege';
  end if;

  -- The legacy exam_id columns stay for backward compatibility but are never
  -- written again. Assessment marks belong to the semester examination.
  update public.classwork_items
  set published = true,
      published_at = coalesce(published_at, now()),
      exam_id = null,
      exam_subject_id = null
  where id = v_item.id;

  for v_student in
    select p.id
    from public.profiles p
    where p.role = 'student'
      and p.is_active
      and p.class_id = v_item.class_id
  loop
    insert into public.notifications (user_id, title, body, type, link, payload)
    values (
      v_student.id,
      format('New %s: %s', v_item.kind, v_item.title),
      case
        when v_item.deadline is null then format('%s has been published.', v_item.title)
        else format('%s is due %s.', v_item.title, to_char(v_item.deadline, 'DD Mon YYYY, HH24:MI'))
      end,
      'classwork',
      '/app/classwork',
      jsonb_build_object('item_id', v_item.id, 'kind', v_item.kind, 'deadline', v_item.deadline)
    );
  end loop;

  return v_item.id;
end;
$$;

update public.classwork_items ci
set exam_id = null,
    exam_subject_id = null
where ci.exam_id in (select id from pg_temp.cw_exam_cleanup_targets);

delete from public.exams e
where e.id in (select id from pg_temp.cw_exam_cleanup_targets);

