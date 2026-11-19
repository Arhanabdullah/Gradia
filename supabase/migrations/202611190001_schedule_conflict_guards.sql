-- ============================================================
-- GRADIA · Room, invigilator and timing conflict guards
-- ============================================================
-- The class-based scheduler lets one examination hold several papers at
-- different dates, rooms and invigilators. Until now the database only
-- rejected two papers of the same class overlapping in time. This migration
-- adds the other two collisions a scheduler must catch:
--
--   room         two papers in the same room at the same time
--   invigilator  one teacher invigilating two papers at the same time
--
-- Both checks deliberately ignore rows that belong to the same examination
-- group. A department-wide group materialises the same paper into every
-- class with one shared room and invigilator, so those rows are meant to
-- coincide. The class timing check stays as it was and still runs for every
-- class, including classes inside one group.
--
-- Nothing here rewrites existing rows. A conflict that already exists on
-- live data is left untouched: the trigger only fires when a row is inserted
-- or updated, so the scheduler surfaces the old conflict through the helper
-- RPC below instead of blocking unrelated saves.
-- ============================================================

-- ---------- 1. extend the schedule validator ----------
create or replace function public.validate_assessment_component_schedule()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam   uuid;
  v_class  uuid;
  v_group  uuid;
  v_start  date;
  v_end    date;
begin
  if not coalesce(new.is_conducted, true) or new.exam_date is null then
    return new;
  end if;

  select es.exam_id, e.class_id, e.exam_group_id
    into v_exam, v_class, v_group
  from public.exam_subjects es
  join public.exams e on e.id = es.exam_id
  where es.id = new.exam_subject_id;

  if v_class is null then
    raise exception 'Assessment component % has no examination', new.id
      using errcode = 'foreign_key_violation';
  end if;

  if v_group is not null then
    select g.starts_on, g.ends_on
      into v_start, v_end
    from public.exam_groups g
    where g.id = v_group;

    if v_start is not null and new.exam_date < v_start then
      raise exception 'Paper date % is before the examination start date %', new.exam_date, v_start
        using errcode = 'check_violation';
    end if;
    if v_end is not null and new.exam_date > v_end then
      raise exception 'Paper date % is after the examination end date %', new.exam_date, v_end
        using errcode = 'check_violation';
    end if;
  end if;

  if new.start_time is not null
     and new.end_time is not null
     and not coalesce(new.allow_overlap, false) then
    -- 1a. One class cannot sit two papers at once. This keeps the original
    -- behaviour and spans every examination of that class.
    if exists (
      select 1
      from public.assessment_components ac
      join public.exam_subjects es2 on es2.id = ac.exam_subject_id
      join public.exams e2 on e2.id = es2.exam_id
      where ac.id is distinct from new.id
        and e2.class_id = v_class
        and ac.is_conducted
        and ac.exam_date = new.exam_date
        and ac.start_time is not null
        and ac.end_time is not null
        and not ac.allow_overlap
        and new.start_time < ac.end_time
        and new.end_time > ac.start_time
    ) or exists (
      select 1
      from public.exam_subjects es2
      join public.exams e2 on e2.id = es2.exam_id
      where es2.exam_id is distinct from v_exam
        and e2.class_id = v_class
        and es2.exam_date = new.exam_date
        and es2.start_time is not null
        and es2.end_time is not null
        and not es2.allow_overlap
        and new.start_time < es2.end_time
        and new.end_time > es2.start_time
    ) then
      raise exception 'Another paper is already scheduled for this class at that time'
        using errcode = 'check_violation';
    end if;

    -- 1b. A room cannot host two different examinations at once. Rows inside
    -- the same group are skipped because group propagation shares a room on
    -- purpose.
    if new.room is not null and btrim(new.room) <> '' and exists (
      select 1
      from public.assessment_components ac
      join public.exam_subjects es2 on es2.id = ac.exam_subject_id
      join public.exams e2 on e2.id = es2.exam_id
      where ac.id is distinct from new.id
        and ac.is_conducted
        and ac.room is not null
        and lower(btrim(ac.room)) = lower(btrim(new.room))
        and ac.exam_date = new.exam_date
        and ac.start_time is not null
        and ac.end_time is not null
        and not ac.allow_overlap
        and new.start_time < ac.end_time
        and new.end_time > ac.start_time
        and not (v_group is not null and e2.exam_group_id = v_group)
    ) then
      raise exception 'Room "%" is already booked for another examination at that time', btrim(new.room)
        using errcode = 'check_violation';
    end if;

    -- 1c. One invigilator cannot cover two papers at once. As above, a group
    -- shares its invigilator across classes by design.
    if new.teacher_id is not null and exists (
      select 1
      from public.assessment_components ac
      join public.exam_subjects es2 on es2.id = ac.exam_subject_id
      join public.exams e2 on e2.id = es2.exam_id
      where ac.id is distinct from new.id
        and ac.is_conducted
        and ac.teacher_id = new.teacher_id
        and ac.exam_date = new.exam_date
        and ac.start_time is not null
        and ac.end_time is not null
        and not ac.allow_overlap
        and new.start_time < ac.end_time
        and new.end_time > ac.start_time
        and not (v_group is not null and e2.exam_group_id = v_group)
    ) then
      raise exception 'The selected invigilator is already assigned to another examination at that time'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- ---------- 2. helper for callers that want a pre-flight check ----------
-- Returns every collision the trigger would reject, so a caller can show them
-- inline before it saves. The class scheduler keeps a local copy of the same
-- checks because it already holds the visible papers and needs instant
-- feedback; this RPC is the authoritative version for callers whose RLS view
-- hides other classes (a teacher, for example).
create or replace function public.schedule_conflicts(
  p_exam_date              date,
  p_start_time             time,
  p_end_time               time,
  p_room                   text default null,
  p_teacher_id             uuid default null,
  p_class_id               uuid default null,
  p_exam_group_id          uuid default null,
  p_exclude_component_id   uuid default null
)
returns table (
  conflict_kind  text,
  message        text,
  exam_id        uuid,
  exam_subject_id uuid,
  component_id   uuid,
  class_id       uuid,
  subject_id     uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_active_user();

  if p_exam_date is null or p_start_time is null or p_end_time is null
     or p_end_time <= p_start_time then
    return;
  end if;

  -- Class timing.
  if p_class_id is not null then
    return query
    select
      'class'::text,
      format('Another paper is already scheduled for this class at %s', to_char(p_start_time, 'HH24:MI')),
      e2.id,
      es2.id,
      ac.id,
      e2.class_id,
      es2.subject_id
    from public.assessment_components ac
    join public.exam_subjects es2 on es2.id = ac.exam_subject_id
    join public.exams e2 on e2.id = es2.exam_id
    where ac.is_conducted
      and (p_exclude_component_id is null or ac.id <> p_exclude_component_id)
      and e2.class_id = p_class_id
      and ac.exam_date = p_exam_date
      and ac.start_time is not null
      and ac.end_time is not null
      and not ac.allow_overlap
      and p_start_time < ac.end_time
      and p_end_time > ac.start_time;
  end if;

  -- Room booking across other examinations.
  if p_room is not null and btrim(p_room) <> '' then
    return query
    select
      'room'::text,
      format('Room "%s" is already booked at %s', btrim(p_room), to_char(p_start_time, 'HH24:MI')),
      e2.id,
      es2.id,
      ac.id,
      e2.class_id,
      es2.subject_id
    from public.assessment_components ac
    join public.exam_subjects es2 on es2.id = ac.exam_subject_id
    join public.exams e2 on e2.id = es2.exam_id
    where ac.is_conducted
      and (p_exclude_component_id is null or ac.id <> p_exclude_component_id)
      and ac.room is not null
      and lower(btrim(ac.room)) = lower(btrim(p_room))
      and ac.exam_date = p_exam_date
      and ac.start_time is not null
      and ac.end_time is not null
      and not ac.allow_overlap
      and p_start_time < ac.end_time
      and p_end_time > ac.start_time
      and not (p_exam_group_id is not null and e2.exam_group_id = p_exam_group_id);
  end if;

  -- Invigilator booking across other examinations.
  if p_teacher_id is not null then
    return query
    select
      'invigilator'::text,
      format('The invigilator is already assigned at %s', to_char(p_start_time, 'HH24:MI')),
      e2.id,
      es2.id,
      ac.id,
      e2.class_id,
      es2.subject_id
    from public.assessment_components ac
    join public.exam_subjects es2 on es2.id = ac.exam_subject_id
    join public.exams e2 on e2.id = es2.exam_id
    where ac.is_conducted
      and (p_exclude_component_id is null or ac.id <> p_exclude_component_id)
      and ac.teacher_id = p_teacher_id
      and ac.exam_date = p_exam_date
      and ac.start_time is not null
      and ac.end_time is not null
      and not ac.allow_overlap
      and p_start_time < ac.end_time
      and p_end_time > ac.start_time
      and not (p_exam_group_id is not null and e2.exam_group_id = p_exam_group_id);
  end if;
end;
$$;

-- ---------- 3. permissions ----------
revoke execute on function public.schedule_conflicts(date, time, time, text, uuid, uuid, uuid, uuid) from anon, public;
grant execute on function public.schedule_conflicts(date, time, time, text, uuid, uuid, uuid, uuid) to authenticated;
