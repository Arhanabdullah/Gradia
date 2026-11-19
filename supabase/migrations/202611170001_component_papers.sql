-- ============================================================
-- GRADIA · Component papers and practical-only labs
-- ============================================================
-- Additive migration. Turns the assessment structure into a schedulable set
-- of papers inside one examination:
--
--   * a theory subject carries IA1, IA2, Quiz, Assignment, Project and ESA
--   * a practical subject carries practical components only
--   * every component can be scheduled (date, time, room, invigilator) and
--     switched off when it is not conducted
--   * marks, readiness and the grade calculation ignore components that were
--     not conducted, and the subject percentage is normalised over the
--     components that were conducted
--
-- A subject is practical when subjects.subject_type = 'lab' or its code starts
-- with LS followed by a digit, so a mistyped catalogue row still behaves as a
-- lab. The database stays the only place that calculates results.
--
-- Reuses (never duplicates):
--   assessment_components      materialised papers per exam subject
--   marks                      one row per student x paper
--   result_component_items     compiled snapshot
--   exam_subjects / exams      scope and result kind
--   audit_logs                 configuration trail
-- ============================================================

-- ---------- 1. practical subject helper ----------
create or replace function public.is_practical_subject(p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select s.subject_type = 'lab'
             or upper(coalesce(s.code, '')) ~ '^LS[0-9]'
      from public.subjects s
      where s.id = p_subject_id
    ),
    false
  );
$$;

-- ---------- 2. paper scheduling columns ----------
alter table public.assessment_components
  add column if not exists is_conducted boolean not null default true;
alter table public.assessment_components
  add column if not exists exam_date date;
alter table public.assessment_components
  add column if not exists start_time time;
alter table public.assessment_components
  add column if not exists end_time time;
alter table public.assessment_components
  add column if not exists duration_minutes integer;
alter table public.assessment_components
  add column if not exists room text;
alter table public.assessment_components
  add column if not exists teacher_id uuid references public.profiles(id) on delete set null;
alter table public.assessment_components
  add column if not exists instructions text not null default '';
alter table public.assessment_components
  add column if not exists allow_overlap boolean not null default false;

do $$ begin
  alter table public.assessment_components
    add constraint assessment_components_time_range_valid
    check (start_time is null or end_time is null or end_time > start_time);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.assessment_components
    add constraint assessment_components_duration_positive
    check (duration_minutes is null or duration_minutes > 0);
exception when duplicate_object then null; end $$;

create index if not exists assessment_components_date_time_idx
  on public.assessment_components (exam_date, start_time);
create index if not exists assessment_components_teacher_id_idx
  on public.assessment_components (teacher_id);

-- ---------- 3. paper schedule triggers ----------
create or replace function public.set_assessment_component_duration()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.start_time is not null and new.end_time is not null then
    new.duration_minutes := greatest(
      1,
      round(extract(epoch from (new.end_time - new.start_time)) / 60)::integer
    );
  end if;
  return new;
end;
$$;

drop trigger if exists set_assessment_component_duration on public.assessment_components;
create trigger set_assessment_component_duration
  before insert or update on public.assessment_components
  for each row execute function public.set_assessment_component_duration();

-- Papers for one class may not overlap unless the row allows it. The check
-- spans every examination of that class, so a semester paper cannot collide
-- with a legacy subject paper either.
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
  end if;

  return new;
end;
$$;

drop trigger if exists validate_assessment_component_schedule on public.assessment_components;
create trigger validate_assessment_component_schedule
  before insert or update on public.assessment_components
  for each row execute function public.validate_assessment_component_schedule();

-- A published sheet is an issued document. Its papers cannot be rescheduled
-- or switched off afterwards.
create or replace function public.guard_published_assessment_component()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam_subject uuid;
  v_published    boolean;
begin
  v_exam_subject := case when tg_op = 'DELETE' then old.exam_subject_id else new.exam_subject_id end;

  select exists (
    select 1
    from public.exam_subjects es
    join public.result_sheets rs on rs.exam_id = es.exam_id
    where es.id = v_exam_subject
      and rs.status = 'published'
  ) into v_published;

  if v_published and (
    tg_op = 'DELETE'
    or (
      tg_op = 'UPDATE'
      and (
        new.is_conducted is distinct from old.is_conducted
        or new.exam_date is distinct from old.exam_date
        or new.start_time is distinct from old.start_time
        or new.end_time is distinct from old.end_time
        or new.max_marks is distinct from old.max_marks
        or new.weight_percent is distinct from old.weight_percent
      )
    )
  ) then
    raise exception 'This examination already published its result. Papers cannot be changed.'
      using errcode = 'check_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists guard_published_assessment_component on public.assessment_components;
create trigger guard_published_assessment_component
  before update or delete on public.assessment_components
  for each row execute function public.guard_published_assessment_component();

-- ---------- 4. subject total ignores papers that were not conducted ----------
-- Returns NULL when the exam subject is not template-based, so the caller
-- keeps the legacy component behaviour. Otherwise it returns the subject
-- percentage out of 100, normalised over the papers that were conducted:
--   direct  : obtained / max_marks * weight_percent
--   scaled  : obtained / scale_from * scale_to
--   average : group average / group max * group weight
-- earned / conducted weight * 100
create or replace function public.assessment_component_total(
  p_exam_id    uuid,
  p_subject_id uuid,
  p_student_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ac as (
    select c.*, m.marks_obtained
    from public.assessment_components c
    left join public.marks m
      on m.assessment_component_id = c.id
     and m.exam_id = p_exam_id
     and m.subject_id = p_subject_id
     and m.student_id = p_student_id
    where c.exam_subject_id = (
      select es.id
      from public.exam_subjects es
      where es.exam_id = p_exam_id
        and es.subject_id = p_subject_id
    )
  ),
  conducted as (
    select * from ac where coalesce(is_conducted, true)
  ),
  grouped as (
    select
      group_code,
      avg(coalesce(marks_obtained, 0)) as avg_marks,
      max(max_marks) as group_max,
      sum(coalesce(weight_percent, 0)) as group_weight
    from conducted
    where aggregation = 'average'
      and coalesce(group_code, '') <> ''
    group by group_code
  ),
  lines as (
    select case
      when aggregation = 'direct' then
        case
          when max_marks > 0
            then coalesce(marks_obtained, 0) / max_marks
                 * coalesce(weight_percent, max_marks)
          else 0
        end
      when aggregation = 'scaled' then
        case
          when coalesce(scale_from, max_marks) > 0
            then coalesce(marks_obtained, 0) / coalesce(scale_from, max_marks)
                 * coalesce(scale_to, weight_percent, max_marks)
          else 0
        end
      else 0
    end as contribution
    from conducted
    where aggregation in ('direct', 'scaled')
  ),
  group_lines as (
    select case
      when group_max > 0 then avg_marks / group_max * group_weight
      else 0
    end as contribution
    from grouped
  ),
  totals as (
    select
      coalesce((select sum(contribution) from lines), 0)
        + coalesce((select sum(contribution) from group_lines), 0) as earned,
      coalesce(
        (select sum(coalesce(weight_percent, max_marks, 0))
         from conducted where aggregation = 'direct'),
        0
      )
      + coalesce(
        (select sum(coalesce(scale_to, weight_percent, max_marks, 0))
         from conducted where aggregation = 'scaled'),
        0
      )
      + coalesce((select sum(group_weight) from grouped), 0) as weight
  )
  select case
    when not exists (
      select 1 from ac where assessment_template_id is not null
    ) then null
    when (select weight from totals) <= 0 then null
    else round(
      least(100, greatest(0,
        (select earned from totals) / (select weight from totals) * 100
      )), 2)
  end;
$$;

-- ---------- 5. readiness ignores papers that were not conducted ----------
create or replace function public.result_sheet_readiness(p_sheet_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sheet                   public.result_sheets%rowtype;
  v_items                   integer;
  v_students                integer;
  v_ungraded                integer;
  v_missing_marks           integer;
  v_missing_credits         integer;
  v_missing_components      integer;
  v_missing_conducted       integer;
  v_missing_component_marks integer;
  v_withheld                integer;
  v_result_kind             text;
begin
  perform public.require_active_user();

  if not (
    public.is_admin()
    or public.is_exam_cell()
    or public.is_hod()
    or public.is_principal()
  ) then
    raise exception 'You do not have permission to inspect this result sheet'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_sheet from public.result_sheets where id = p_sheet_id;
  if not found then
    raise exception 'Result sheet not found' using errcode = 'no_data_found';
  end if;

  v_result_kind := coalesce(
    nullif(v_sheet.result_kind, ''),
    public.resolved_exam_result_kind(v_sheet.exam_id),
    'internal'
  );

  select count(*), count(distinct student_id)
    into v_items, v_students
  from public.result_items where sheet_id = p_sheet_id;

  select count(*) into v_ungraded
  from public.result_items
  where sheet_id = p_sheet_id
    and (grade is null or percentage is null);

  select count(*) into v_missing_credits
  from public.result_items
  where sheet_id = p_sheet_id
    and (credit_hours is null or credit_hours <= 0);

  select count(*) into v_missing_marks
  from public.result_items ri
  where ri.sheet_id = p_sheet_id
    and not exists (
      select 1 from public.marks m
      where m.exam_id = v_sheet.exam_id
        and m.subject_id = ri.subject_id
        and m.student_id = ri.student_id
    );

  select count(*) into v_missing_components
  from public.exam_subjects es
  where es.exam_id = v_sheet.exam_id
    and exists (
      select 1 from public.marks m
      where m.exam_id = v_sheet.exam_id and m.subject_id = es.subject_id
    )
    and not exists (
      select 1 from public.assessment_components c
      where c.exam_subject_id = es.id
    );

  -- A subject with a structure but no conducted paper can never be graded.
  select count(*) into v_missing_conducted
  from public.exam_subjects es
  where es.exam_id = v_sheet.exam_id
    and exists (
      select 1 from public.marks m
      where m.exam_id = v_sheet.exam_id and m.subject_id = es.subject_id
    )
    and exists (
      select 1 from public.assessment_components c
      where c.exam_subject_id = es.id
    )
    and not exists (
      select 1 from public.assessment_components c
      where c.exam_subject_id = es.id and c.is_conducted
    );

  -- Required paper slots without a mark. Only conducted papers are checked;
  -- a paper switched off is deliberately excluded from the subject total.
  select count(*) into v_missing_component_marks
  from public.result_items ri
  join public.exam_subjects es
    on es.exam_id = v_sheet.exam_id
   and es.subject_id = ri.subject_id
  join public.assessment_components ac
    on ac.exam_subject_id = es.id
   and not ac.is_optional
   and ac.is_conducted
  where ri.sheet_id = p_sheet_id
    and exists (
      select 1 from public.assessment_components tc
      where tc.exam_subject_id = es.id
        and tc.assessment_template_id is not null
    )
    and not exists (
      select 1 from public.marks m
      where m.exam_id = v_sheet.exam_id
        and m.subject_id = ri.subject_id
        and m.student_id = ri.student_id
        and m.assessment_component_id = ac.id
    );

  select count(*) into v_withheld
  from public.result_items
  where sheet_id = p_sheet_id and coalesce(is_withheld, false);

  return jsonb_build_object(
    'sheet_id', p_sheet_id,
    'status', v_sheet.status,
    'result_kind', v_result_kind,
    'items', v_items,
    'students', v_students,
    'ungraded', v_ungraded,
    'missing_marks', v_missing_marks,
    'missing_credits', v_missing_credits,
    'missing_components', v_missing_components,
    'missing_conducted', v_missing_conducted,
    'missing_component_marks', v_missing_component_marks,
    'withheld', v_withheld,
    'ready', v_items > 0
      and v_ungraded = 0
      and v_missing_marks = 0
      and v_missing_credits = 0
      and v_missing_component_marks = 0
      and (v_result_kind <> 'semester' or (v_missing_components = 0 and v_missing_conducted = 0))
  );
end;
$$;

create or replace function public.assert_result_sheet_ready(p_sheet_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_readiness jsonb;
begin
  v_readiness := public.result_sheet_readiness(p_sheet_id);

  if not coalesce((v_readiness->>'ready')::boolean, false) then
    raise exception 'This result sheet is not ready for approval or publication (% ungraded, % missing marks, % missing credits, % subjects without components, % subjects without a conducted paper, % missing paper marks)',
      coalesce(v_readiness->>'ungraded', '0'),
      coalesce(v_readiness->>'missing_marks', '0'),
      coalesce(v_readiness->>'missing_credits', '0'),
      coalesce(v_readiness->>'missing_components', '0'),
      coalesce(v_readiness->>'missing_conducted', '0'),
      coalesce(v_readiness->>'missing_component_marks', '0')
      using errcode = 'check_violation';
  end if;
end;
$$;

-- ---------- 6. marks submission counts conducted papers only ----------
create or replace function public.submit_exam_marks(
  p_exam_id    uuid,
  p_subject_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid        uuid := auth.uid();
  v_class      uuid;
  v_status     text;
  v_students   int;
  v_required   int;
  v_entered    int;
  v_submission uuid;
begin
  perform public.require_active_user();

  select e.class_id into v_class from public.exams e where e.id = p_exam_id;
  if v_class is null then
    raise exception 'Exam was not found' using errcode = 'no_data_found';
  end if;

  if not (
    public.is_admin()
    or (
      public.is_teacher()
      and public.teaches_class_subject(v_class, p_subject_id)
    )
  ) then
    raise exception 'You do not teach this subject in this class'
      using errcode = 'insufficient_privilege';
  end if;

  if public.exam_results_published(p_exam_id) then
    raise exception 'Results for this examination are already published'
      using errcode = 'check_violation';
  end if;

  select id, status into v_submission, v_status
  from public.exam_submissions
  where exam_id = p_exam_id and subject_id = p_subject_id
  for update;

  if v_status = 'approved' then
    raise exception 'These marks are already approved' using errcode = 'check_violation';
  end if;
  if v_status = 'submitted' or v_status = 'under_review' then
    raise exception 'These marks are already awaiting review' using errcode = 'check_violation';
  end if;

  select count(distinct p.id) into v_students
  from public.profiles p
  where p.role = 'student'
    and p.is_active
    and (
      p.class_id = v_class
      or exists (
        select 1 from public.student_enrollments en
        where en.student_id = p.id
          and en.class_id = v_class
          and en.status = 'active'
      )
    );

  if v_students = 0 then
    raise exception 'No active students are enrolled in this class'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_required
  from public.exam_subjects es
  join public.assessment_components ac on ac.exam_subject_id = es.id
  where es.exam_id = p_exam_id
    and es.subject_id = p_subject_id
    and not ac.is_optional
    and ac.is_conducted;

  if coalesce(v_required, 0) = 0 then
    -- No required conducted paper: fall back to one slot per student.
    v_required := 1;
    select count(distinct m.student_id) into v_entered
    from public.marks m
    where m.exam_id = p_exam_id
      and m.subject_id = p_subject_id;
  else
    select count(*) into v_entered
    from public.marks m
    join public.assessment_components ac on ac.id = m.assessment_component_id
    where m.exam_id = p_exam_id
      and m.subject_id = p_subject_id
      and not ac.is_optional
      and ac.is_conducted;
  end if;

  if coalesce(v_entered, 0) = 0 then
    raise exception 'Enter at least one mark before submitting' using errcode = 'check_violation';
  end if;

  if v_entered < v_students * v_required then
    raise exception 'Marks are missing for % student/paper slot(s)',
      (v_students * v_required) - v_entered
      using errcode = 'check_violation';
  end if;

  if v_submission is null then
    insert into public.exam_submissions (
      exam_id, subject_id, class_id, status, submitted_by, submitted_at
    ) values (
      p_exam_id, p_subject_id, v_class, 'submitted', v_uid, now()
    ) returning id into v_submission;
  else
    update public.exam_submissions
    set status = 'submitted',
        submitted_by = v_uid,
        submitted_at = now(),
        reviewed_by = null,
        reviewed_at = null,
        approved_by = null,
        approved_at = null,
        review_remarks = null
    where id = v_submission;
  end if;

  insert into public.exam_submission_events (submission_id, action, actor_id)
  values (v_submission, 'submitted', v_uid);

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_table, entity_id, details
  ) values (
    v_uid, public.app_role(), 'marks.submitted', 'exam_submissions',
    v_submission::text,
    jsonb_build_object('exam_id', p_exam_id, 'subject_id', p_subject_id, 'class_id', v_class)
  );
end;
$$;

-- ---------- 7. template resolution respects the practical family ----------
-- A practical subject always resolves to a lab blueprint, even when its
-- catalogue row was typed as theory by mistake.
create or replace function public.resolved_template_for_subject(p_subject_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_subject  public.subjects%rowtype;
  v_family   text;
  v_template uuid;
begin
  select * into v_subject from public.subjects where id = p_subject_id;
  if not found then
    return null;
  end if;

  v_family := case
    when public.is_practical_subject(p_subject_id) then 'lab'
    else coalesce(v_subject.subject_type, 'theory')
  end;

  if v_subject.assessment_template_id is not null then
    select t.id into v_template
    from public.assessment_templates t
    where t.id = v_subject.assessment_template_id
      and t.is_active
      and (
        t.subject_type = v_family
        or (v_family = 'project' and t.subject_type = 'theory')
      );
    if v_template is not null then
      return v_template;
    end if;
  end if;

  select t.id into v_template
  from public.assessment_templates t
  where t.is_active
    and t.is_default
    and t.subject_type = v_family
  order by t.created_at
  limit 1;
  if v_template is not null then
    return v_template;
  end if;

  select t.id into v_template
  from public.assessment_templates t
  where t.is_active
    and t.is_default
    and t.subject_type = 'theory'
  order by t.created_at
  limit 1;

  return v_template;
end;
$$;

-- ---------- 8. applying a template keeps the subject family ----------
create or replace function public.apply_assessment_template(
  p_exam_subject_id uuid,
  p_template_id     uuid default null,
  p_replace         boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam_subject public.exam_subjects%rowtype;
  v_subject      public.subjects%rowtype;
  v_template_id  uuid;
  v_family       text;
  v_count        integer;
begin
  if not (public.is_admin() or public.is_exam_cell()) then
    raise exception 'You do not have permission to configure assessment structures'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_exam_subject
  from public.exam_subjects
  where id = p_exam_subject_id;

  if not found then
    raise exception 'Exam subject not found' using errcode = 'no_data_found';
  end if;

  select * into v_subject from public.subjects where id = v_exam_subject.subject_id;

  if exists (
    select 1 from public.marks m
    where m.exam_id = v_exam_subject.exam_id
      and m.subject_id = v_exam_subject.subject_id
  ) then
    raise exception 'Marks already exist for this subject. Assessment components cannot be rebuilt.'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.assessment_components c
    where c.exam_subject_id = p_exam_subject_id
  ) and not p_replace then
    raise exception 'This subject already has assessment components. Choose replace to apply the template.'
      using errcode = 'check_violation';
  end if;

  v_template_id := coalesce(
    p_template_id,
    v_exam_subject.assessment_template_id,
    public.resolved_template_for_subject(v_exam_subject.subject_id)
  );

  if v_template_id is null then
    raise exception 'No assessment template is available for this subject type'
      using errcode = 'check_violation';
  end if;

  v_family := case
    when public.is_practical_subject(v_subject.id) then 'lab'
    else coalesce(v_subject.subject_type, 'theory')
  end;

  if not exists (
    select 1 from public.assessment_templates t
    where t.id = v_template_id
      and t.is_active
      and (
        t.subject_type = v_family
        or (v_family = 'project' and t.subject_type = 'theory')
      )
  ) then
    raise exception 'Choose a template that matches the subject type'
      using errcode = 'check_violation';
  end if;

  v_count := public.materialize_assessment_template(p_exam_subject_id, v_template_id);

  insert into public.audit_logs (actor_id, actor_role, action, entity_table, entity_id, details)
  values (
    auth.uid(), public.app_role(), 'assessment_template.applied',
    'exam_subjects', p_exam_subject_id::text,
    jsonb_build_object('template_id', v_template_id, 'components', v_count)
  );

  return jsonb_build_object(
    'exam_subject_id', p_exam_subject_id,
    'template_id', v_template_id,
    'components', v_count
  );
end;
$$;

create or replace function public.set_subject_assessment_template(
  p_subject_id  uuid,
  p_template_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subject public.subjects%rowtype;
  v_family  text;
begin
  if not (public.is_admin() or public.is_exam_cell()) then
    raise exception 'You do not have permission to configure assessment structures'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_subject from public.subjects where id = p_subject_id;
  if not found then
    raise exception 'Subject not found' using errcode = 'no_data_found';
  end if;

  v_family := case
    when public.is_practical_subject(v_subject.id) then 'lab'
    else coalesce(v_subject.subject_type, 'theory')
  end;

  if p_template_id is not null and not exists (
    select 1 from public.assessment_templates t
    where t.id = p_template_id
      and t.is_active
      and (
        t.subject_type = v_family
        or (v_family = 'project' and t.subject_type = 'theory')
      )
  ) then
    raise exception 'Choose a template that matches the subject type'
      using errcode = 'check_violation';
  end if;

  update public.subjects
  set assessment_template_id = p_template_id
  where id = p_subject_id;

  -- Future examinations inherit the subject default. Existing exam subjects
  -- that already have marks or components keep their current structure.
  update public.exam_subjects es
  set assessment_template_id = p_template_id
  where es.subject_id = p_subject_id
    and not exists (
      select 1 from public.marks m
      where m.exam_id = es.exam_id and m.subject_id = es.subject_id
    )
    and not exists (
      select 1 from public.assessment_components c
      where c.exam_subject_id = es.id
    );

  insert into public.audit_logs (actor_id, actor_role, action, entity_table, entity_id, details)
  values (
    auth.uid(), public.app_role(), 'subject.assessment_template',
    'subjects', p_subject_id::text,
    jsonb_build_object('template_id', p_template_id)
  );
end;
$$;

-- ---------- 9. exam cell can view and edit examinations ----------
create or replace function public.can_view_exam(p_exam uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when not public.is_active_user() then false
    when public.has_role(array['admin', 'principal']::public.user_role[]) then true
    when public.is_monitor() then true
    else exists (
      select 1 from public.exams e
      where e.id = p_exam and public.can_view_class(e.class_id)
    )
  end;
$$;

create or replace function public.can_view_exam_group(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when not public.is_active_user() then false
    when public.has_role(array['admin', 'principal']::public.user_role[]) then true
    when public.is_monitor() then true
    when public.is_hod() then exists (
      select 1
      from public.exam_groups g
      where g.id = p_group
        and (
          (g.department_id is not null and public.is_department_hod(g.department_id))
          or exists (
            select 1 from public.exams e
            where e.exam_group_id = g.id and public.is_class_hod(e.class_id)
          )
        )
    )
    when public.is_teacher() then exists (
      select 1 from public.exams e
      where e.exam_group_id = p_group and public.teaches_class(e.class_id)
    )
    when public.is_student() then exists (
      select 1 from public.exams e
      where e.exam_group_id = p_group and public.can_view_class(e.class_id)
    )
    else false
  end;
$$;

create or replace function public.can_edit_exam(p_exam uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_user() and exists (
    select 1
    from public.exams e
    where e.id = p_exam
      and not public.exam_results_published(e.id)
      and (
        public.is_admin()
        or public.is_exam_cell()
        or (
          public.is_teacher()
          and e.created_by = auth.uid()
          and e.scope = 'class'
          and e.exam_type = any (array[
            'class_test', 'unit_test', 'internal_assessment', 'assignment', 'practical'
          ])
          and e.status in ('draft', 'open')
          and public.teaches_class(e.class_id)
        )
      )
  );
$$;

create or replace function public.can_edit_exam_subject(p_exam uuid, p_subject uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.can_edit_exam(p_exam)
    and (
      public.is_admin()
      or public.is_exam_cell()
      or exists (
        select 1 from public.exams e
        where e.id = p_exam
          and public.teaches_class_subject(e.class_id, p_subject)
      )
    );
$$;

create or replace function public.can_edit_exam_group(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_user()
    and (
      public.is_admin()
      or public.is_exam_cell()
      or (
        public.is_teacher()
        and exists (
          select 1 from public.exam_groups g
          where g.id = p_group and g.created_by = auth.uid() and g.scope = 'class'
        )
        and exists (
          select 1 from public.exams e where e.exam_group_id = p_group
        )
        and not exists (
          select 1 from public.exams e
          where e.exam_group_id = p_group and not public.can_edit_exam(e.id)
        )
      )
    );
$$;

-- ---------- 10. scheduling a group accepts component papers ----------
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
  p_subjects         jsonb
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
  v_exam            uuid;
  v_exam_subject_id uuid;
  v_subject         jsonb;
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

  insert into public.exam_groups (
    name, exam_type, scope, department_id, course_id, academic_year,
    academic_term_id, starts_on, ends_on, instructions, status, created_by
  ) values (
    btrim(p_name), p_exam_type, p_scope, p_department_id, p_course_id,
    p_academic_year, p_academic_term_id, p_starts_on, p_ends_on,
    coalesce(p_instructions, ''), p_status, v_uid
  ) returning id into v_group;

  foreach v_class in array p_class_ids loop
    insert into public.exams (
      class_id, name, academic_year, exam_type, status, starts_on, ends_on,
      academic_term_id, created_by, exam_group_id, scope, department_id,
      course_id, instructions
    ) values (
      v_class, btrim(p_name), p_academic_year, p_exam_type, p_status,
      p_starts_on, p_ends_on, p_academic_term_id, v_uid, v_group, p_scope,
      p_department_id, p_course_id, coalesce(p_instructions, '')
    ) returning id into v_exam;

    for v_subject in select value from jsonb_array_elements(p_subjects) loop
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

      v_teacher := nullif(v_subject->>'teacher_id', '')::uuid;
      if v_teacher is null then
        select ta.teacher_id into v_teacher
        from public.teacher_assignments ta
        where ta.class_id = v_class and ta.subject_id = v_subject_id
        order by ta.created_at
        limit 1;
      end if;

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

      -- Component papers are only meaningful for an official semester
      -- examination. The insert trigger has already materialised the
      -- subject's blueprint, so this block only records the choices.
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
                teacher_id = nullif(v_component->>'teacher_id', '')::uuid,
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

          -- The subject keeps the first paper date for list views and
          -- filters. The paper rows remain the source of truth.
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
      'component_papers', v_component_papers
    )
  );

  return v_group;
end;
$$;

-- ---------- 11. add and remove subjects on an existing examination ----------
create or replace function public.add_exam_subject(
  p_exam_id     uuid,
  p_subject_id  uuid,
  p_teacher_id  uuid default null,
  p_max_marks   numeric default null,
  p_pass_marks  numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam         public.exams%rowtype;
  v_subject      public.subjects%rowtype;
  v_target       record;
  v_class_subject uuid;
  v_teacher      uuid;
  v_practical    boolean;
  v_result_kind  text;
  v_max          numeric;
  v_template     uuid;
  v_first        uuid;
  v_added        integer := 0;
begin
  perform public.require_active_user();

  if not (public.is_admin() or public.is_exam_cell()) then
    raise exception 'Only administrators and Exam Cell can change an examination subject list'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_exam from public.exams where id = p_exam_id;
  if not found then
    raise exception 'Exam not found' using errcode = 'no_data_found';
  end if;

  select * into v_subject from public.subjects where id = p_subject_id;
  if not found then
    raise exception 'Subject not found' using errcode = 'no_data_found';
  end if;

  if exists (
    select 1
    from public.exams e
    join public.result_sheets rs on rs.exam_id = e.id
    where e.id = p_exam_id
      and rs.status = 'published'
  ) or (
    v_exam.exam_group_id is not null
    and exists (
      select 1
      from public.exams e
      join public.result_sheets rs on rs.exam_id = e.id
      where e.exam_group_id = v_exam.exam_group_id
        and rs.status = 'published'
    )
  ) then
    raise exception 'Published examinations cannot be changed'
      using errcode = 'check_violation';
  end if;

  v_practical := public.is_practical_subject(p_subject_id);
  v_result_kind := public.resolved_exam_result_kind(p_exam_id);

  if v_exam.exam_type = 'practical' and not v_practical then
    raise exception 'A practical examination only takes practical subjects'
      using errcode = 'check_violation';
  end if;

  if v_exam.exam_type <> 'practical' and v_result_kind <> 'semester' and v_practical then
    raise exception 'Practical subjects are assessed on practical papers only'
      using errcode = 'check_violation';
  end if;

  v_template := public.resolved_template_for_subject(p_subject_id);

  for v_target in
    select e.id as exam_id, e.class_id
    from public.exams e
    where e.id = p_exam_id
       or (v_exam.exam_group_id is not null and e.exam_group_id = v_exam.exam_group_id)
    order by (e.id = p_exam_id) desc
  loop
    if exists (
      select 1 from public.exam_subjects es
      where es.exam_id = v_target.exam_id and es.subject_id = p_subject_id
    ) then
      continue;
    end if;

    select cs.id into v_class_subject
    from public.class_subjects cs
    where cs.class_id = v_target.class_id and cs.subject_id = p_subject_id
    limit 1;

    if v_class_subject is null then
      continue;
    end if;

    v_teacher := coalesce(
      p_teacher_id,
      (
        select ta.teacher_id from public.teacher_assignments ta
        where ta.class_id = v_target.class_id and ta.subject_id = p_subject_id
        order by ta.created_at
        limit 1
      )
    );

    if v_teacher is not null and not exists (
      select 1 from public.profiles p
      where p.id = v_teacher and p.role = 'teacher' and p.is_active
    ) then
      raise exception 'Assigned teacher is not an active teacher'
        using errcode = 'check_violation';
    end if;

    v_max := coalesce(
      p_max_marks,
      case
        when v_result_kind = 'semester' and v_template is not null then
          (select t.total_marks from public.assessment_templates t where t.id = v_template)
        else v_subject.max_marks
      end,
      100
    );

    insert into public.exam_subjects (
      exam_id, subject_id, class_subject_id, max_marks, pass_marks, teacher_id
    ) values (
      v_target.exam_id,
      p_subject_id,
      v_class_subject,
      v_max,
      p_pass_marks,
      v_teacher
    ) returning id into v_class_subject;

    if v_first is null then
      v_first := v_class_subject;
    end if;
    v_added := v_added + 1;
  end loop;

  if v_added = 0 then
    raise exception 'That subject is already in this examination or is not offered by its classes'
      using errcode = 'check_violation';
  end if;

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_table, entity_id, details
  ) values (
    auth.uid(), public.app_role(), 'exam_subject.added', 'exams', p_exam_id::text,
    jsonb_build_object('subject_id', p_subject_id, 'classes', v_added)
  );

  return v_first;
end;
$$;

create or replace function public.remove_exam_subject(p_exam_subject_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam    uuid;
  v_subject uuid;
  v_group   uuid;
  v_removed integer;
begin
  perform public.require_active_user();

  if not (public.is_admin() or public.is_exam_cell()) then
    raise exception 'Only administrators and Exam Cell can change an examination subject list'
      using errcode = 'insufficient_privilege';
  end if;

  select es.exam_id, es.subject_id, e.exam_group_id
    into v_exam, v_subject, v_group
  from public.exam_subjects es
  join public.exams e on e.id = es.exam_id
  where es.id = p_exam_subject_id;

  if v_exam is null then
    raise exception 'Exam subject was not found' using errcode = 'no_data_found';
  end if;

  if exists (
    select 1
    from public.exams e
    join public.result_sheets rs on rs.exam_id = e.id
    where e.id = v_exam
      and rs.status = 'published'
  ) or (
    v_group is not null
    and exists (
      select 1
      from public.exams e
      join public.result_sheets rs on rs.exam_id = e.id
      where e.exam_group_id = v_group
        and rs.status = 'published'
    )
  ) then
    raise exception 'Published examinations cannot be changed'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from public.marks m
    where m.subject_id = v_subject
      and m.exam_id in (
        select e.id from public.exams e
        where e.id = v_exam
           or (v_group is not null and e.exam_group_id = v_group)
      )
  ) then
    raise exception 'Marks already exist for this subject. It cannot be removed from the examination.'
      using errcode = 'check_violation';
  end if;

  delete from public.exam_subjects es
  using public.exams e
  where es.exam_id = e.id
    and es.subject_id = v_subject
    and (
      es.id = p_exam_subject_id
      or (v_group is not null and e.exam_group_id = v_group)
    );

  get diagnostics v_removed = row_count;

  insert into public.audit_logs (
    actor_id, actor_role, action, entity_table, entity_id, details
  ) values (
    auth.uid(), public.app_role(), 'exam_subject.removed', 'exams', v_exam::text,
    jsonb_build_object('subject_id', v_subject, 'removed', v_removed)
  );
end;
$$;

-- ---------- 12. edit a paper's schedule ----------
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

  v_code := upper(coalesce(v_component.code, ''));
  v_conducted := coalesce((p_patch->>'is_conducted')::boolean, v_component.is_conducted);

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
      end_time = case when p_patch ? 'end_time'
                      then nullif(p_patch->>'end_time', '')::time
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
      'is_conducted', v_conducted,
      'patch', p_patch
    )
  );
end;
$$;

-- ---------- 13. compiled snapshot skips papers that were not conducted ----------
create or replace function public.skip_non_conducted_component_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.component_id is not null and exists (
    select 1 from public.assessment_components ac
    where ac.id = new.component_id
      and not ac.is_conducted
  ) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists skip_non_conducted_component_item on public.result_component_items;
create trigger skip_non_conducted_component_item
  before insert on public.result_component_items
  for each row execute function public.skip_non_conducted_component_item();

-- ---------- 14. permissions ----------
revoke execute on function public.is_practical_subject(uuid) from anon, authenticated, public;
revoke execute on function public.assessment_component_total(uuid, uuid, uuid) from anon, authenticated, public;
revoke execute on function public.set_assessment_component_duration() from anon, authenticated, public;
revoke execute on function public.validate_assessment_component_schedule() from anon, authenticated, public;
revoke execute on function public.guard_published_assessment_component() from anon, authenticated, public;
revoke execute on function public.skip_non_conducted_component_item() from anon, authenticated, public;
revoke execute on function public.add_exam_subject(uuid, uuid, uuid, numeric, numeric) from anon, public;
revoke execute on function public.remove_exam_subject(uuid) from anon, public;
revoke execute on function public.update_assessment_component_schedule(uuid, jsonb) from anon, public;

grant execute on function public.add_exam_subject(uuid, uuid, uuid, numeric, numeric) to authenticated;
grant execute on function public.remove_exam_subject(uuid) to authenticated;
grant execute on function public.update_assessment_component_schedule(uuid, jsonb) to authenticated;

-- ---------- 15. backfill ----------
-- Every existing component is a conducted paper. Nothing is switched off by
-- this migration, so legacy internal assessments keep working unchanged.
update public.assessment_components
set is_conducted = true
where is_conducted is null;
