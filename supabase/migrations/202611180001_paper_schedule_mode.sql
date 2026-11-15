-- ============================================================
-- GRADIA · Formal papers and classwork activities
-- ============================================================
-- Additive migration. Every assessment component now declares how it runs:
--
--   formal     an invigilated paper: date, start time, duration, room and
--              invigilator (IA1, IA2, ESA, practical exam, viva)
--   classwork  a marked activity done in class: no date, room or invigilator
--              (quiz, assignment, project, practical record)
--
-- The mode lives on the assessment structure, so it is configured once in
-- Assessment Setup and materialised onto every exam subject. A trigger keeps
-- classwork rows free of scheduling fields even if an older caller tries to
-- set them. Marks, readiness and grading are unchanged: classwork is still
-- markable and still carries its conducted toggle, so a skipped activity is
-- excluded from the subject total.
--
-- Nothing here deletes data. Retiring the legacy exam groups lives in
-- 202611180002_retire_legacy_exam_groups.sql.
-- ============================================================

-- ---------- 1. schedule mode on the structure and on each paper ----------
alter table public.assessment_template_components
  add column if not exists schedule_mode text not null default 'formal';
alter table public.assessment_components
  add column if not exists schedule_mode text not null default 'formal';

do $$ begin
  alter table public.assessment_template_components
    add constraint assessment_template_components_schedule_mode_valid
    check (schedule_mode in ('formal', 'classwork'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.assessment_components
    add constraint assessment_components_schedule_mode_valid
    check (schedule_mode in ('formal', 'classwork'));
exception when duplicate_object then null; end $$;

-- ---------- 2. backfill the known classwork components ----------
-- IA1, IA2, ESA, the practical exam and the viva stay formal. Quiz,
-- assignment, project and the practical record are classwork.
update public.assessment_template_components
set schedule_mode = 'classwork'
where schedule_mode <> 'classwork'
  and (
    component_type in ('quiz', 'assignment')
    or upper(btrim(coalesce(code, ''))) in ('QUIZ', 'ASSIGNMENT', 'PROJECT', 'PRACTICAL_RECORD')
  );

update public.assessment_components
set schedule_mode = 'classwork'
where schedule_mode <> 'classwork'
  and (
    component_type in ('quiz', 'assignment')
    or upper(btrim(coalesce(code, ''))) in ('QUIZ', 'ASSIGNMENT', 'PROJECT', 'PRACTICAL_RECORD')
  );

-- ---------- 3. classwork rows never carry a schedule ----------
create or replace function public.normalize_assessment_component_schedule_mode()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(new.schedule_mode, 'formal') = 'classwork' then
    new.exam_date := null;
    new.start_time := null;
    new.end_time := null;
    new.duration_minutes := null;
    new.room := null;
    new.teacher_id := null;
    new.allow_overlap := false;
  end if;
  return new;
end;
$$;

-- Runs before set_assessment_component_duration and
-- validate_assessment_component_schedule (trigger names fire in order).
drop trigger if exists normalize_assessment_component_schedule_mode on public.assessment_components;
create trigger normalize_assessment_component_schedule_mode
  before insert or update on public.assessment_components
  for each row execute function public.normalize_assessment_component_schedule_mode();

-- ---------- 4. materialise the mode with the rest of the structure ----------
create or replace function public.materialize_assessment_template(
  p_exam_subject_id uuid,
  p_template_id     uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam_subject public.exam_subjects%rowtype;
  v_template     public.assessment_templates%rowtype;
  v_weight_total numeric;
  v_count        integer;
begin
  select * into v_exam_subject
  from public.exam_subjects
  where id = p_exam_subject_id;

  if not found then
    raise exception 'Exam subject not found' using errcode = 'no_data_found';
  end if;

  select * into v_template
  from public.assessment_templates
  where id = p_template_id and is_active;

  if not found then
    raise exception 'Assessment template not found or inactive'
      using errcode = 'no_data_found';
  end if;

  if exists (
    select 1 from public.marks m
    where m.exam_id = v_exam_subject.exam_id
      and m.subject_id = v_exam_subject.subject_id
  ) then
    raise exception 'Marks already exist for this subject. Assessment components cannot be rebuilt.'
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(weight_percent), 0)
    into v_weight_total
  from public.assessment_template_components
  where template_id = p_template_id;

  if abs(v_weight_total - v_template.total_marks) > 0.01 then
    raise exception 'Template "%" contributes % marks but its total is %',
      v_template.name, v_weight_total, v_template.total_marks
      using errcode = 'check_violation';
  end if;

  delete from public.assessment_components
  where exam_subject_id = p_exam_subject_id;

  insert into public.assessment_components (
    exam_subject_id, name, code, component_type, max_marks, pass_marks,
    weight_percent, aggregation, group_code, scale_from, scale_to,
    display_order, is_optional, is_external, assessment_template_id,
    schedule_mode
  )
  select
    p_exam_subject_id, c.name, c.code, c.component_type, c.max_marks,
    c.pass_marks, c.weight_percent, c.aggregation, c.group_code,
    c.scale_from, c.scale_to, c.display_order, c.is_optional,
    c.is_external, p_template_id, c.schedule_mode
  from public.assessment_template_components c
  where c.template_id = p_template_id
  order by c.display_order, c.name;

  get diagnostics v_count = row_count;

  update public.exam_subjects
  set assessment_template_id = p_template_id,
      max_marks = v_template.total_marks,
      pass_marks = case
        when pass_marks is null then null
        when pass_marks <= v_template.total_marks then pass_marks
        else null
      end
  where id = p_exam_subject_id;

  return v_count;
end;
$$;

-- ---------- 5. scheduling RPC understands classwork and duration ----------
create or replace function public.update_assessment_component_schedule(
  p_component_id uuid,
  p_patch        jsonb
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

  -- Classwork is marked, not invigilated. Reject a schedule instead of
  -- silently dropping it so an old client cannot pretend it saved one.
  if coalesce(v_component.schedule_mode, 'formal') = 'classwork' then
    if (p_patch ? 'exam_date' and nullif(p_patch->>'exam_date', '') is not null)
       or (p_patch ? 'start_time' and nullif(p_patch->>'start_time', '') is not null)
       or (p_patch ? 'end_time' and nullif(p_patch->>'end_time', '') is not null)
       or (p_patch ? 'duration_minutes' and nullif(p_patch->>'duration_minutes', '') is not null)
       or (p_patch ? 'room' and nullif(p_patch->>'room', '') is not null)
       or (p_patch ? 'teacher_id' and nullif(p_patch->>'teacher_id', '') is not null)
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
      room = case when p_patch ? 'room'
                  then nullif(p_patch->>'room', '')
                  else ac.room end,
      teacher_id = case when p_patch ? 'teacher_id'
                        then nullif(p_patch->>'teacher_id', '')::uuid
                        else ac.teacher_id end,
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

  -- Keep the subject's roll-up date in step with its papers.
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
      'patch', p_patch
    )
  );
end;
$$;

-- ---------- 6. permissions ----------
revoke execute on function public.normalize_assessment_component_schedule_mode() from anon, authenticated, public;
revoke execute on function public.update_assessment_component_schedule(uuid, jsonb) from anon, public;
grant execute on function public.update_assessment_component_schedule(uuid, jsonb) to authenticated;
