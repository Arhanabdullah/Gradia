-- ============================================================
-- GRADIA · Automatic semester structure and department rooms
-- ============================================================
-- Additive migration. The semester page no longer asks an administrator to
-- create a group: it creates one from the assigned class structure. A
-- department-wide group holds one exam per class and shares every paper date
-- and time across the group, while each class keeps its own room.
--
-- Two RPC signatures change:
--
--   create_exam_group(..., p_class_subjects jsonb default null)
--     Optional map of class id -> subject array, so classes in one
--     department group can offer different subject sets. The flat
--     p_subjects array remains the union of those sets. Assigned teachers are
--     always resolved per class from teacher_assignments; a payload can no
--     longer push one teacher into every class.
--
--   update_assessment_component_schedule(..., p_room_class_id uuid default null)
--     Date, time, duration and conducted stay group-wide. When a room class
--     is supplied, only that class's room is written; the other classes keep
--     their own room. Invigilator writes are ignored so the retired scheduling
--     option cannot set one through an old client.
--
-- Existing invigilator values are left untouched: this migration removes the
-- option, it does not rewrite historical data. Published sheets are unchanged.
-- ============================================================

-- ---------- 1. class-aware subject lists and no payload teacher override ----------
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_exam_group'
  loop
    execute format('drop function %s', fn.sig);
  end loop;
end $$;

create or replace function public.create_exam_group(
  p_name             text,
  p_exam_type        text,
  p_scope            text,
  p_department_id    uuid,
  p_course_id        uuid,
  p_academic_year    text,
  p_academic_term_id uuid,
  p_class_ids        uuid[],
  p_starts_on        date,
  p_ends_on          date,
  p_instructions     text,
  p_status           text,
  p_subjects         jsonb,
  p_class_subjects   jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid             uuid := auth.uid();
  v_group           uuid;
  v_class           uuid;
  v_class_key       text;
  v_exam            uuid;
  v_exam_subject_id uuid;
  v_subject         jsonb;
  v_class_subjects  jsonb;
  v_component       jsonb;
  v_component_code  text;
  v_subject_id      uuid;
  v_teacher         uuid;
  v_date            date;
  v_start           time;
  v_end             time;
  v_max             numeric;
  v_pass            numeric;
  v_practical       boolean;
  v_result_kind     text;
  v_conducted       integer;
  v_component_papers boolean := false;
  v_seen            uuid[] := '{}';
  v_regular         text[] := array[
    'class_test', 'unit_test', 'internal_assessment', 'assignment', 'practical'
  ];
begin
  perform public.require_active_user();

  if not (public.is_admin() or public.is_teacher() or public.is_exam_cell()) then
    raise exception 'Only administrators, Exam Cell and teachers can create examinations'
      using errcode = 'insufficient_privilege';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Examination name is required' using errcode = 'check_violation';
  end if;

  if p_exam_type is null or p_exam_type not in (
    'class_test', 'unit_test', 'internal_assessment', 'mid_term',
    'semester', 'practical', 'assignment', 'major', 'final'
  ) then
    raise exception 'Unknown examination type: %', p_exam_type using errcode = 'check_violation';
  end if;

  if public.is_teacher() and not (p_exam_type = any (v_regular)) then
    raise exception 'Teachers cannot create % examinations', p_exam_type
      using errcode = 'insufficient_privilege';
  end if;

  if p_scope is null or p_scope not in ('class', 'department') then
    raise exception 'Examination scope must be class or department' using errcode = 'check_violation';
  end if;

  if p_status is null or p_status not in ('draft', 'open', 'ongoing', 'completed', 'cancelled') then
    raise exception 'Unknown examination status: %', p_status using errcode = 'check_violation';
  end if;

  if p_scope = 'class' and coalesce(array_length(p_class_ids, 1), 0) <> 1 then
    raise exception 'A class examination must select exactly one class'
      using errcode = 'check_violation';
  end if;

  if p_scope = 'department' and (
    p_department_id is null
    or p_course_id is null
    or coalesce(array_length(p_class_ids, 1), 0) = 0
  ) then
    raise exception 'A department examination needs a department, course and at least one class'
      using errcode = 'check_violation';
  end if;

  if p_starts_on is not null and p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'The end date cannot be before the start date' using errcode = 'check_violation';
  end if;

  if p_subjects is null
     or jsonb_typeof(p_subjects) <> 'array'
     or jsonb_array_length(p_subjects) = 0 then
    raise exception 'At least one subject is required' using errcode = 'check_violation';
  end if;

  v_result_kind := case
    when p_exam_type in ('semester', 'final', 'major') then 'semester'
    else 'internal'
  end;

  -- Validate classes once.
  foreach v_class in array p_class_ids loop
    if not exists (select 1 from public.classes c where c.id = v_class) then
      raise exception 'Class % was not found', v_class using errcode = 'foreign_key_violation';
    end if;

    if p_department_id is not null and not exists (
      select 1 from public.classes c
      join public.courses co on co.id = c.course_id
      where c.id = v_class and co.department_id = p_department_id
    ) then
      raise exception 'Class % is outside the selected department', v_class
        using errcode = 'check_violation';
    end if;

    if p_course_id is not null and not exists (
      select 1 from public.classes c
      where c.id = v_class and c.course_id = p_course_id
    ) then
      raise exception 'Class % is outside the selected course', v_class
        using errcode = 'check_violation';
    end if;

    if public.is_teacher() and not public.teaches_class(v_class) then
      raise exception 'You do not teach class %', v_class using errcode = 'insufficient_privilege';
    end if;

    if exists (
      select 1 from public.exams e
      where e.class_id = v_class
        and lower(btrim(e.name)) = lower(btrim(p_name))
        and coalesce(e.academic_year, '') = coalesce(p_academic_year, '')
    ) then
      raise exception 'A "%" examination already exists for one of the selected classes', p_name
        using errcode = 'unique_violation';
    end if;
  end loop;

  -- Reject duplicate subjects before writing anything.
  for v_subject in select value from jsonb_array_elements(p_subjects) loop
    v_subject_id := nullif(v_subject->>'subject_id', '')::uuid;
    if v_subject_id is null then
      raise exception 'Every subject row needs a subject_id' using errcode = 'check_violation';
    end if;
    if v_subject_id = any (v_seen) then
      raise exception 'The same subject was added twice' using errcode = 'check_violation';
    end if;
    v_seen := array_append(v_seen, v_subject_id);
  end loop;

  -- Optional per-class subject lists. Each entry must name a class in this
  -- group and only use subjects from the union above.
  if p_class_subjects is not null then
    if jsonb_typeof(p_class_subjects) <> 'object' then
      raise exception 'Class subjects must be an object keyed by class id'
        using errcode = 'check_violation';
    end if;

    for v_class_key, v_class_subjects in
      select key, value from jsonb_each(p_class_subjects)
    loop
      if jsonb_typeof(v_class_subjects) <> 'array' then
        raise exception 'Subjects for class % must be an array', v_class_key
          using errcode = 'check_violation';
      end if;
      if not exists (select 1 from unnest(p_class_ids) cid where cid::text = v_class_key) then
        raise exception 'Class % is not part of this examination group', v_class_key
          using errcode = 'check_violation';
      end if;
      for v_subject in select value from jsonb_array_elements(v_class_subjects) loop
        v_subject_id := nullif(v_subject->>'subject_id', '')::uuid;
        if v_subject_id is null or not (v_subject_id = any (v_seen)) then
          raise exception 'Class subjects must use the subjects listed for this examination'
            using errcode = 'check_violation';
        end if;
      end loop;
    end loop;
  end if;

  insert into public.exam_groups (
    name, exam_type, scope, department_id, course_id, academic_year,
    academic_term_id, starts_on, ends_on, instructions, status, created_by
  ) values (
    btrim(p_name), p_exam_type, p_scope, p_department_id, p_course_id,
    p_academic_year, p_academic_term_id, p_starts_on, p_ends_on,
    coalesce(p_instructions, ''), p_status, v_uid
  ) returning id into v_group;

  foreach v_class in array p_class_ids loop
    v_class_subjects := p_subjects;
    if p_class_subjects is not null and p_class_subjects ? (v_class::text) then
      v_class_subjects := p_class_subjects -> (v_class::text);
      -- A class with no assigned subjects has no exam to schedule.
      if jsonb_array_length(v_class_subjects) = 0 then
        continue;
      end if;
    end if;

    insert into public.exams (
      class_id, name, academic_year, exam_type, status, starts_on, ends_on,
      academic_term_id, created_by, exam_group_id, scope, department_id,
      course_id, instructions
    ) values (
      v_class, btrim(p_name), p_academic_year, p_exam_type, p_status,
      p_starts_on, p_ends_on, p_academic_term_id, v_uid, v_group, p_scope,
      p_department_id, p_course_id, coalesce(p_instructions, '')
    ) returning id into v_exam;

    for v_subject in select value from jsonb_array_elements(v_class_subjects) loop
      v_subject_id := (v_subject->>'subject_id')::uuid;

      if not exists (
        select 1 from public.class_subjects cs
        where cs.class_id = v_class and cs.subject_id = v_subject_id
      ) then
        raise exception 'Subject % is not offered by class %', v_subject_id, v_class
          using errcode = 'check_violation';
      end if;

      if public.is_teacher() and not public.teaches_class_subject(v_class, v_subject_id) then
        raise exception 'You do not teach subject % in class %', v_subject_id, v_class
          using errcode = 'insufficient_privilege';
      end if;

      v_practical := public.is_practical_subject(v_subject_id);

      if p_exam_type = 'practical' and not v_practical then
        raise exception 'Subject % is a theory subject. A practical examination only takes practical subjects.', v_subject_id
          using errcode = 'check_violation';
      end if;

      if p_exam_type <> 'practical' and v_result_kind <> 'semester' and v_practical then
        raise exception 'Subject % is a practical subject. Practical subjects are assessed on practical papers only.', v_subject_id
          using errcode = 'check_violation';
      end if;

      -- Subject teachers come from the class allocation, never from the
      -- scheduling payload. Marks Entry depends on this per-class assignment.
      select ta.teacher_id into v_teacher
      from public.teacher_assignments ta
      where ta.class_id = v_class and ta.subject_id = v_subject_id
      order by ta.created_at
      limit 1;

      if v_teacher is not null and not exists (
        select 1 from public.profiles p
        where p.id = v_teacher and p.role = 'teacher' and p.is_active
      ) then
        raise exception 'Assigned teacher % is not an active teacher', v_teacher
          using errcode = 'check_violation';
      end if;

      v_max := coalesce(nullif(v_subject->>'max_marks', '')::numeric, 100);
      v_pass := nullif(v_subject->>'pass_marks', '')::numeric;

      if v_max <= 0 then
        raise exception 'Maximum marks must be greater than zero' using errcode = 'check_violation';
      end if;
      if v_pass is not null and (v_pass < 0 or v_pass > v_max) then
        raise exception 'Passing marks must be between 0 and the maximum marks'
          using errcode = 'check_violation';
      end if;

      v_date := nullif(v_subject->>'exam_date', '')::date;
      v_start := nullif(v_subject->>'start_time', '')::time;
      v_end := nullif(v_subject->>'end_time', '')::time;

      if v_start is not null and v_end is not null and v_end <= v_start then
        raise exception 'The end time must be after the start time' using errcode = 'check_violation';
      end if;

      insert into public.exam_subjects (
        exam_id, subject_id, class_subject_id, max_marks, pass_marks,
        is_optional, exam_date, start_time, end_time, teacher_id, room,
        instructions, allow_overlap
      ) values (
        v_exam,
        v_subject_id,
        (
          select cs.id from public.class_subjects cs
          where cs.class_id = v_class and cs.subject_id = v_subject_id
          limit 1
        ),
        v_max,
        v_pass,
        coalesce((v_subject->>'is_optional')::boolean, false),
        v_date,
        v_start,
        v_end,
        v_teacher,
        nullif(v_subject->>'room', ''),
        coalesce(v_subject->>'instructions', ''),
        coalesce((v_subject->>'allow_overlap')::boolean, false)
      ) returning id into v_exam_subject_id;

      if v_subject ? 'components' then
        if jsonb_typeof(v_subject->'components') <> 'array' then
          raise exception 'Component papers must be an array' using errcode = 'check_violation';
        end if;

        if v_result_kind <> 'semester' then
          raise exception 'Component papers are only available for semester examinations'
            using errcode = 'check_violation';
        end if;

        if jsonb_array_length(v_subject->'components') > 0 then
          update public.assessment_components
          set is_conducted = false
          where exam_subject_id = v_exam_subject_id;

          for v_component in select value from jsonb_array_elements(v_subject->'components') loop
            v_component_code := upper(btrim(coalesce(v_component->>'code', '')));

            if v_component_code = '' then
              raise exception 'Every component paper needs a code' using errcode = 'check_violation';
            end if;

            if not exists (
              select 1 from public.assessment_components c
              where c.exam_subject_id = v_exam_subject_id
                and upper(coalesce(c.code, '')) = v_component_code
            ) then
              raise exception 'Paper % is not part of the assessment structure for subject %',
                v_component_code, v_subject_id
                using errcode = 'check_violation';
            end if;

            update public.assessment_components
            set is_conducted = coalesce((v_component->>'is_conducted')::boolean, true),
                exam_date = nullif(v_component->>'exam_date', '')::date,
                start_time = nullif(v_component->>'start_time', '')::time,
                end_time = nullif(v_component->>'end_time', '')::time,
                room = nullif(v_component->>'room', ''),
                -- Invigilator scheduling is retired. Old payloads are ignored.
                teacher_id = null,
                allow_overlap = coalesce((v_component->>'allow_overlap')::boolean, false)
            where exam_subject_id = v_exam_subject_id
              and upper(coalesce(code, '')) = v_component_code;
          end loop;

          select count(*) into v_conducted
          from public.assessment_components
          where exam_subject_id = v_exam_subject_id
            and is_conducted;

          if v_conducted = 0 then
            raise exception 'Choose at least one paper to conduct for subject %', v_subject_id
              using errcode = 'check_violation';
          end if;

          update public.exam_subjects
          set exam_date = (
                select min(c.exam_date)
                from public.assessment_components c
                where c.exam_subject_id = v_exam_subject_id
                  and c.is_conducted
                  and c.exam_date is not null
              ),
              start_time = null,
              end_time = null,
              duration_minutes = null,
              room = null
          where id = v_exam_subject_id;

          v_component_papers := true;
        end if;
      end if;
    end loop;
  end loop;

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_table, entity_id, details
  ) values (
    v_uid, public.app_role(), 'exam_group.created', 'exam_groups', v_group::text,
    jsonb_build_object(
      'name', p_name,
      'type', p_exam_type,
      'scope', p_scope,
      'classes', to_jsonb(p_class_ids),
      'subject_count', jsonb_array_length(p_subjects),
      'per_class_subjects', p_class_subjects is not null,
      'component_papers', v_component_papers
    )
  );

  return v_group;
end;
$$;

-- ---------- 2. shared schedule, room per class ----------
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'update_assessment_component_schedule'
  loop
    execute format('drop function %s', fn.sig);
  end loop;
end $$;

create or replace function public.update_assessment_component_schedule(
  p_component_id  uuid,
  p_patch         jsonb,
  p_room_class_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_component public.assessment_components%rowtype;
  v_exam      uuid;
  v_subject   uuid;
  v_group     uuid;
  v_code      text;
  v_conducted boolean;
  v_duration  integer;
begin
  perform public.require_active_user();

  select ac.* into v_component
  from public.assessment_components ac
  where ac.id = p_component_id;

  if not found then
    raise exception 'Assessment component not found' using errcode = 'no_data_found';
  end if;

  select es.exam_id, es.subject_id, e.exam_group_id
    into v_exam, v_subject, v_group
  from public.exam_subjects es
  join public.exams e on e.id = es.exam_id
  where es.id = v_component.exam_subject_id;

  if not (
    public.is_admin()
    or public.is_exam_cell()
    or public.can_edit_exam_subject(v_exam, v_subject)
  ) then
    raise exception 'You do not have permission to change this paper schedule'
      using errcode = 'insufficient_privilege';
  end if;

  if p_room_class_id is not null and not exists (
    select 1
    from public.exams e
    where e.class_id = p_room_class_id
      and (e.id = v_exam or (v_group is not null and e.exam_group_id = v_group))
  ) then
    raise exception 'The room class is not part of this examination group'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from public.exams e
    join public.result_sheets rs on rs.exam_id = e.id
    where (e.id = v_exam or (v_group is not null and e.exam_group_id = v_group))
      and rs.status = 'published'
  ) then
    raise exception 'Published examinations cannot be changed'
      using errcode = 'check_violation';
  end if;

  if coalesce(v_component.schedule_mode, 'formal') = 'classwork' then
    if (p_patch ? 'exam_date' and nullif(p_patch->>'exam_date', '') is not null)
       or (p_patch ? 'start_time' and nullif(p_patch->>'start_time', '') is not null)
       or (p_patch ? 'end_time' and nullif(p_patch->>'end_time', '') is not null)
       or (p_patch ? 'duration_minutes' and nullif(p_patch->>'duration_minutes', '') is not null)
       or (p_patch ? 'room' and nullif(p_patch->>'room', '') is not null)
       or (p_patch ? 'allow_overlap' and coalesce((p_patch->>'allow_overlap')::boolean, false))
    then
      raise exception 'Classwork activities are not scheduled: they have no date, room or invigilator.'
        using errcode = 'check_violation';
    end if;
  end if;

  v_code := upper(coalesce(v_component.code, ''));
  v_conducted := coalesce((p_patch->>'is_conducted')::boolean, v_component.is_conducted);
  v_duration := case
    when p_patch ? 'duration_minutes' then nullif(p_patch->>'duration_minutes', '')::integer
    else null
  end;

  if v_duration is not null and v_duration <= 0 then
    raise exception 'Duration must be a positive number of minutes'
      using errcode = 'check_violation';
  end if;

  if not v_conducted and exists (
    select 1
    from public.marks m
    join public.assessment_components ac on ac.id = m.assessment_component_id
    join public.exam_subjects es on es.id = ac.exam_subject_id
    join public.exams e on e.id = es.exam_id
    where m.exam_id = es.exam_id
      and es.subject_id = v_subject
      and (es.exam_id = v_exam or (v_group is not null and e.exam_group_id = v_group))
      and (
        ac.id = p_component_id
        or (v_code <> '' and upper(coalesce(ac.code, '')) = v_code)
      )
  ) then
    raise exception 'This paper already has marks and cannot be switched off.'
      using errcode = 'check_violation';
  end if;

  -- Date, time, duration and the conducted flag stay shared across the group.
  -- A room is only shared when no room class was supplied (class scope).
  update public.assessment_components ac
  set is_conducted = v_conducted,
      exam_date = case when p_patch ? 'exam_date'
                       then nullif(p_patch->>'exam_date', '')::date
                       else ac.exam_date end,
      start_time = case when p_patch ? 'start_time'
                        then nullif(p_patch->>'start_time', '')::time
                        else ac.start_time end,
      end_time = case
        when p_patch ? 'end_time' then nullif(p_patch->>'end_time', '')::time
        when p_patch ? 'duration_minutes' then
          case
            when v_duration is null then null
            else (
              case when p_patch ? 'start_time'
                   then nullif(p_patch->>'start_time', '')::time
                   else ac.start_time end
              + make_interval(mins => v_duration)
            )::time
          end
        else ac.end_time end,
      room = case when p_patch ? 'room' and p_room_class_id is null
                  then nullif(p_patch->>'room', '')
                  else ac.room end,
      -- Invigilator scheduling is retired; teacher_id is left as historical
      -- data and is never changed by this RPC.
      allow_overlap = case when p_patch ? 'allow_overlap'
                           then coalesce((p_patch->>'allow_overlap')::boolean, false)
                           else ac.allow_overlap end
  from public.exam_subjects es
  join public.exams e on e.id = es.exam_id
  where ac.exam_subject_id = es.id
    and es.subject_id = v_subject
    and (es.exam_id = v_exam or (v_group is not null and e.exam_group_id = v_group))
    and (
      ac.id = p_component_id
      or (v_code <> '' and upper(coalesce(ac.code, '')) = v_code)
    );

  -- The room belongs to one class in a department group, so write it only on
  -- that class's copy of the paper. Conflict triggers still run per row.
  if p_room_class_id is not null and p_patch ? 'room' then
    update public.assessment_components ac
    set room = nullif(p_patch->>'room', '')
    from public.exam_subjects es
    join public.exams e on e.id = es.exam_id
    where ac.exam_subject_id = es.id
      and e.class_id = p_room_class_id
      and (e.id = v_exam or (v_group is not null and e.exam_group_id = v_group))
      and es.subject_id = v_subject
      and (
        ac.id = p_component_id
        or (v_code <> '' and upper(coalesce(ac.code, '')) = v_code)
      );
  end if;

  update public.exam_subjects es
  set exam_date = (
        select min(ac.exam_date)
        from public.assessment_components ac
        where ac.exam_subject_id = es.id
          and ac.is_conducted
          and ac.exam_date is not null
      ),
      start_time = null,
      end_time = null,
      duration_minutes = null,
      room = null
  where es.id in (
    select es2.id
    from public.exam_subjects es2
    join public.exams e on e.id = es2.exam_id
    where es2.subject_id = v_subject
      and (es2.exam_id = v_exam or (v_group is not null and e.exam_group_id = v_group))
  );

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_table, entity_id, details
  ) values (
    auth.uid(), public.app_role(), 'assessment_component.scheduled',
    'assessment_components', p_component_id::text,
    jsonb_build_object(
      'exam_id', v_exam,
      'subject_id', v_subject,
      'code', v_code,
      'schedule_mode', coalesce(v_component.schedule_mode, 'formal'),
      'is_conducted', v_conducted,
      'room_class_id', p_room_class_id,
      'patch', p_patch
    )
  );
end;
$$;

-- ---------- 3. permissions ----------
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_exam_group', 'update_assessment_component_schedule')
  loop
    execute format('revoke execute on function %s from anon, public', fn.sig);
    execute format('grant execute on function %s to authenticated', fn.sig);
  end loop;
end $$;
