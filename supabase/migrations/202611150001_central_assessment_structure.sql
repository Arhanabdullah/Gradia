-- ============================================================
-- GRADIA · Central assessment structure
-- ============================================================
-- Additive migration. Introduces reusable assessment templates so the
-- Exam Cell configures a structure once and applies it to subjects,
-- instead of rebuilding components for every exam subject.
--
-- Reuses (never duplicates):
--   assessment_components          materialised components per exam subject
--   marks                          one row per student x component
--   exam_subjects / subjects       scope and subject type
--   result_sheets / result_items   compiled snapshots
--   grading_schemes / grade_bands  grading and pass thresholds
--   audit_logs                     configuration trail
--
-- New configuration:
--   assessment_templates           reusable blueprint (theory / lab / project)
--   assessment_template_components ordered component definitions
--   subjects.assessment_template_id
--   exam_subjects.assessment_template_id
--   assessment_components aggregation metadata
--   exams.result_kind              auto | internal | semester
--   result_sheets.result_kind      snapshot taken at compile time
--
-- Theory blueprint (exactly 100 marks):
--   IA1 20 + IA2 20 -> average treated as 20
--   ESA 80 -> (obtained / 80) * 60
--   Quiz 8 + Assignment 6 + Project 6
--   Final = IA average + converted ESA + Quiz + Assignment + Project
--
-- Practical blueprints:
--   detailed breakdown (weighted components) or direct final marks out of 100
--
-- Only an official semester result (exam_type semester / final / major, or
-- exams.result_kind = 'semester') may issue a printable grade card. Internal
-- assessments stay visible on the dashboard and never print a grade card.
-- ============================================================

-- ---------- 1. reusable templates ----------
create table if not exists public.assessment_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  subject_type  text not null default 'theory',
  mode          text not null default 'detailed',
  total_marks   numeric(7,2) not null default 100,
  description   text not null default '',
  is_default    boolean not null default false,
  is_active     boolean not null default true,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint assessment_templates_name_subject_unique unique (name, subject_type),
  constraint assessment_templates_subject_type_valid
    check (subject_type in ('theory', 'lab', 'project')),
  constraint assessment_templates_mode_valid
    check (mode in ('detailed', 'direct')),
  constraint assessment_templates_total_positive check (total_marks > 0)
);

create unique index if not exists assessment_templates_one_default
  on public.assessment_templates (subject_type)
  where is_default and is_active;

create table if not exists public.assessment_template_components (
  id             uuid primary key default gen_random_uuid(),
  template_id    uuid not null references public.assessment_templates(id) on delete cascade,
  name           text not null,
  code           text not null default '',
  component_type text not null default 'internal',
  max_marks      numeric(7,2) not null,
  pass_marks     numeric(7,2),
  weight_percent numeric(6,2) not null default 0,
  aggregation    text not null default 'direct',
  group_code     text not null default '',
  scale_from     numeric(7,2),
  scale_to       numeric(7,2),
  display_order  integer not null default 1,
  is_optional    boolean not null default false,
  is_external    boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint assessment_template_components_name_unique unique (template_id, name),
  constraint assessment_template_components_name_present check (btrim(name) <> ''),
  constraint assessment_template_components_max_positive check (max_marks > 0),
  constraint assessment_template_components_pass_valid
    check (pass_marks is null or (pass_marks >= 0 and pass_marks <= max_marks)),
  constraint assessment_template_components_weight_valid
    check (weight_percent >= 0 and weight_percent <= 100),
  constraint assessment_template_components_aggregation_valid
    check (aggregation in ('direct', 'average', 'scaled')),
  constraint assessment_template_components_scaled_valid
    check (
      aggregation <> 'scaled'
      or (scale_from is not null and scale_from > 0 and scale_to is not null and scale_to > 0)
    ),
  constraint assessment_template_components_average_valid
    check (aggregation <> 'average' or btrim(group_code) <> '')
);

-- ---------- 2. template links and component metadata ----------
alter table public.subjects
  add column if not exists assessment_template_id uuid
  references public.assessment_templates(id) on delete set null;

alter table public.exam_subjects
  add column if not exists assessment_template_id uuid
  references public.assessment_templates(id) on delete set null;

alter table public.assessment_components
  add column if not exists code text;
alter table public.assessment_components
  add column if not exists aggregation text not null default 'direct';
alter table public.assessment_components
  add column if not exists group_code text;
alter table public.assessment_components
  add column if not exists scale_from numeric(7,2);
alter table public.assessment_components
  add column if not exists scale_to numeric(7,2);
alter table public.assessment_components
  add column if not exists is_external boolean not null default false;
alter table public.assessment_components
  add column if not exists assessment_template_id uuid
  references public.assessment_templates(id) on delete set null;

do $$ begin
  alter table public.assessment_components
    add constraint assessment_components_aggregation_valid
    check (aggregation in ('direct', 'average', 'scaled'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.assessment_components
    add constraint assessment_components_scaled_valid
    check (
      aggregation <> 'scaled'
      or (scale_from is not null and scale_from > 0 and scale_to is not null and scale_to > 0)
    );
exception when duplicate_object then null; end $$;

-- ---------- 3. official result kind ----------
alter table public.exams
  add column if not exists result_kind text not null default 'auto';

do $$ begin
  alter table public.exams
    add constraint exams_result_kind_valid
    check (result_kind in ('auto', 'internal', 'semester'));
exception when duplicate_object then null; end $$;

alter table public.result_sheets
  add column if not exists result_kind text not null default 'internal';

do $$ begin
  alter table public.result_sheets
    add constraint result_sheets_result_kind_valid
    check (result_kind in ('internal', 'semester'));
exception when duplicate_object then null; end $$;

-- ---------- 4. helpers ----------
-- 'auto' follows the examination type: a semester, final or major
-- examination is an official End Semester Assessment result.
create or replace function public.resolved_exam_result_kind(p_exam_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when e.result_kind in ('internal', 'semester') then e.result_kind
    when e.exam_type in ('semester', 'final', 'major') then 'semester'
    else 'internal'
  end
  from public.exams e
  where e.id = p_exam_id;
$$;

-- Subject override, then the default for the subject type, then the theory
-- default so a project subject always resolves to a usable blueprint.
create or replace function public.resolved_template_for_subject(p_subject_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    s.assessment_template_id,
    (
      select t.id
      from public.assessment_templates t
      where t.is_active
        and t.is_default
        and t.subject_type = coalesce(s.subject_type, 'theory')
      order by t.created_at
      limit 1
    ),
    (
      select t.id
      from public.assessment_templates t
      where t.is_active
        and t.is_default
        and t.subject_type = 'theory'
      order by t.created_at
      limit 1
    )
  )
  from public.subjects s
  where s.id = p_subject_id;
$$;

-- ---------- 5. default blueprints ----------
do $$
declare
  v_theory    uuid;
  v_lab_det   uuid;
  v_lab_dir   uuid;
begin
  -- The default slot is claimed at the end of this block, and only when it is
  -- still free, so re-running the migration never fights the partial index.
  insert into public.assessment_templates (
    name, subject_type, mode, total_marks, description, is_default
  ) values (
    'Theory, internal and ESA', 'theory', 'detailed', 100,
    'IA1 and IA2 average to 20, ESA converts 80 to 60, quiz 8, assignment 6 and project 6.',
    false
  )
  on conflict (name, subject_type) do update
    set mode = excluded.mode,
        total_marks = excluded.total_marks,
        description = excluded.description,
        updated_at = now()
  returning id into v_theory;

  insert into public.assessment_templates (
    name, subject_type, mode, total_marks, description, is_default
  ) values (
    'Practical, detailed breakdown', 'lab', 'detailed', 100,
    'Continuous practical record 30, viva 20 and end semester practical 50.',
    false
  )
  on conflict (name, subject_type) do update
    set mode = excluded.mode,
        total_marks = excluded.total_marks,
        description = excluded.description,
        updated_at = now()
  returning id into v_lab_det;

  insert into public.assessment_templates (
    name, subject_type, mode, total_marks, description, is_default
  ) values (
    'Practical, final marks out of 100', 'lab', 'direct', 100,
    'One final practical mark entered directly out of 100.',
    false
  )
  on conflict (name, subject_type) do update
    set mode = excluded.mode,
        total_marks = excluded.total_marks,
        description = excluded.description,
        updated_at = now()
  returning id into v_lab_dir;

  -- Theory: IA1 + IA2 average (10 + 10 weight), ESA 80 -> 60, Quiz 8,
  -- Assignment 6, Project 6. Weights add up to exactly 100.
  insert into public.assessment_template_components (
    template_id, name, code, component_type, max_marks, weight_percent,
    aggregation, group_code, scale_from, scale_to, display_order, is_external
  )
  select * from (values
    (v_theory, 'IA1', 'IA1', 'internal',   20::numeric, 10::numeric, 'average', 'IA', null::numeric, null::numeric, 1, false),
    (v_theory, 'IA2', 'IA2', 'internal',   20::numeric, 10::numeric, 'average', 'IA', null::numeric, null::numeric, 2, false),
    (v_theory, 'ESA', 'ESA', 'esa',        80::numeric, 60::numeric, 'scaled',  '',   80::numeric,   60::numeric,   3, true),
    (v_theory, 'Quiz', 'QUIZ', 'quiz',      8::numeric,  8::numeric, 'direct',  '',   null::numeric, null::numeric, 4, false),
    (v_theory, 'Assignment', 'ASSIGNMENT', 'assignment', 6::numeric, 6::numeric, 'direct', '', null::numeric, null::numeric, 5, false),
    (v_theory, 'Project', 'PROJECT', 'theory', 6::numeric, 6::numeric, 'direct', '', null::numeric, null::numeric, 6, false)
  ) as seed(template_id, name, code, component_type, max_marks, weight_percent, aggregation, group_code, scale_from, scale_to, display_order, is_external)
  where not exists (
    select 1 from public.assessment_template_components c
    where c.template_id = seed.template_id and c.name = seed.name
  );

  -- Practical, detailed: three direct components out of 100.
  insert into public.assessment_template_components (
    template_id, name, code, component_type, max_marks, weight_percent,
    aggregation, display_order, is_external
  )
  select * from (values
    (v_lab_det, 'Practical record', 'PRACTICAL_RECORD', 'practical', 30::numeric, 30::numeric, 'direct', 1, false),
    (v_lab_det, 'Viva', 'VIVA', 'practical', 20::numeric, 20::numeric, 'direct', 2, false),
    (v_lab_det, 'Practical exam', 'PRACTICAL_EXAM', 'practical', 50::numeric, 50::numeric, 'direct', 3, true)
  ) as seed(template_id, name, code, component_type, max_marks, weight_percent, aggregation, display_order, is_external)
  where not exists (
    select 1 from public.assessment_template_components c
    where c.template_id = seed.template_id and c.name = seed.name
  );

  -- Practical, direct: one final mark out of 100.
  insert into public.assessment_template_components (
    template_id, name, code, component_type, max_marks, weight_percent,
    aggregation, display_order, is_external
  )
  select v_lab_dir, 'Final practical', 'FINAL', 'practical', 100, 100, 'direct', 1, true
  where not exists (
    select 1 from public.assessment_template_components c
    where c.template_id = v_lab_dir and c.name = 'Final practical'
  );

  -- Only claim the default slot when it is still free.
  update public.assessment_templates t
  set is_default = true, updated_at = now()
  where t.id in (v_theory, v_lab_det)
    and not exists (
      select 1 from public.assessment_templates x
      where x.subject_type = t.subject_type
        and x.is_default
        and x.is_active
        and x.id <> t.id
    );
end $$;

-- ---------- 6. materialise a template onto an exam subject ----------
-- Internal helper: no permission check, so the exam-subject trigger can use
-- it. Public RPCs below perform the permission and safety checks.
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
    display_order, is_optional, is_external, assessment_template_id
  )
  select
    p_exam_subject_id, c.name, c.code, c.component_type, c.max_marks,
    c.pass_marks, c.weight_percent, c.aggregation, c.group_code,
    c.scale_from, c.scale_to, c.display_order, c.is_optional,
    c.is_external, p_template_id
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

-- ---------- 7. template total for one student (backend-only maths) ----------
-- Returns NULL when the exam subject is not template-based, so the caller
-- keeps the legacy component behaviour. Otherwise it returns the final
-- subject mark out of 100:
--   direct  : obtained / max_marks * weight_percent
--   scaled  : obtained / scale_from * scale_to
--   average : group average / group max * group weight
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
  grouped as (
    select
      group_code,
      avg(coalesce(marks_obtained, 0)) as avg_marks,
      max(max_marks) as group_max,
      sum(coalesce(weight_percent, 0)) as group_weight
    from ac
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
    from ac
    where aggregation in ('direct', 'scaled')
  ),
  group_lines as (
    select case
      when group_max > 0 then avg_marks / group_max * group_weight
      else 0
    end as contribution
    from grouped
  )
  select case
    when not exists (
      select 1 from ac where assessment_template_id is not null
    ) then null
    else round(
      least(100, greatest(0,
        coalesce((select sum(contribution) from lines), 0)
        + coalesce((select sum(contribution) from group_lines), 0)
      )), 2)
  end;
$$;

-- ---------- 8. apply a template to one exam subject ----------
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

  if not exists (
    select 1 from public.assessment_templates t
    where t.id = v_template_id
      and t.is_active
      and (t.subject_type = v_subject.subject_type or v_subject.subject_type = 'project')
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

-- ---------- 9. apply defaults to a whole examination ----------
create or replace function public.apply_assessment_templates_to_exam(
  p_exam_id uuid,
  p_replace boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row      record;
  v_template uuid;
  v_applied  integer := 0;
  v_skipped  integer := 0;
begin
  if not (public.is_admin() or public.is_exam_cell()) then
    raise exception 'You do not have permission to configure assessment structures'
      using errcode = 'insufficient_privilege';
  end if;

  for v_row in
    select es.id, es.subject_id
    from public.exam_subjects es
    where es.exam_id = p_exam_id
  loop
    if exists (
      select 1 from public.marks m
      where m.exam_id = p_exam_id and m.subject_id = v_row.subject_id
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if exists (
      select 1 from public.assessment_components c
      where c.exam_subject_id = v_row.id
    ) and not p_replace then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_template := public.resolved_template_for_subject(v_row.subject_id);
    if v_template is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    perform public.materialize_assessment_template(v_row.id, v_template);
    v_applied := v_applied + 1;
  end loop;

  insert into public.audit_logs (actor_id, actor_role, action, entity_table, entity_id, details)
  values (
    auth.uid(), public.app_role(), 'assessment_template.applied_to_exam',
    'exams', p_exam_id::text,
    jsonb_build_object('applied', v_applied, 'skipped', v_skipped)
  );

  return jsonb_build_object(
    'exam_id', p_exam_id,
    'applied', v_applied,
    'skipped', v_skipped
  );
end;
$$;

-- ---------- 10. subject-level default template ----------
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
begin
  if not (public.is_admin() or public.is_exam_cell()) then
    raise exception 'You do not have permission to configure assessment structures'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_subject from public.subjects where id = p_subject_id;
  if not found then
    raise exception 'Subject not found' using errcode = 'no_data_found';
  end if;

  if p_template_id is not null and not exists (
    select 1 from public.assessment_templates t
    where t.id = p_template_id
      and t.is_active
      and (t.subject_type = v_subject.subject_type or v_subject.subject_type = 'project')
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

-- ---------- 11. one default per subject type ----------
create or replace function public.set_default_assessment_template(
  p_template_id uuid,
  p_is_default  boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text;
begin
  if not (public.is_admin() or public.is_exam_cell()) then
    raise exception 'You do not have permission to configure assessment structures'
      using errcode = 'insufficient_privilege';
  end if;

  select subject_type into v_type
  from public.assessment_templates
  where id = p_template_id;

  if not found then
    raise exception 'Assessment template not found' using errcode = 'no_data_found';
  end if;

  if p_is_default then
    update public.assessment_templates
    set is_default = false, updated_at = now()
    where subject_type = v_type
      and id <> p_template_id
      and is_default;
  end if;

  update public.assessment_templates
  set is_default = p_is_default, updated_at = now()
  where id = p_template_id;

  insert into public.audit_logs (actor_id, actor_role, action, entity_table, entity_id, details)
  values (
    auth.uid(), public.app_role(), 'assessment_template.default',
    'assessment_templates', p_template_id::text,
    jsonb_build_object('is_default', p_is_default, 'subject_type', v_type)
  );
end;
$$;

-- ---------- 12. automatic application for official semester exams ----------
create or replace function public.auto_apply_assessment_template()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_template uuid;
begin
  if public.resolved_exam_result_kind(new.exam_id) <> 'semester' then
    return new;
  end if;

  if exists (
    select 1 from public.assessment_components c
    where c.exam_subject_id = new.id
  ) then
    return new;
  end if;

  v_template := public.resolved_template_for_subject(new.subject_id);
  if v_template is not null then
    perform public.materialize_assessment_template(new.id, v_template);
  end if;

  return new;
end;
$$;

drop trigger if exists auto_apply_assessment_template on public.exam_subjects;
create trigger auto_apply_assessment_template
  after insert on public.exam_subjects
  for each row execute function public.auto_apply_assessment_template();

-- ---------- 13. compile: snapshot result kind and require structure ----------
create or replace function public.compile_result_sheet(p_exam_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam         public.exams%rowtype;
  v_sheet        uuid;
  v_version      uuid;
  v_students     int;
  v_result_kind  text;
  v_unstructured text;
begin
  perform public.require_active_user();

  if not (public.is_admin() or public.is_exam_cell()) then
    raise exception 'You do not have permission to compile results'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_exam from public.exams where id = p_exam_id;
  if not found then
    raise exception 'Exam not found' using errcode = 'no_data_found';
  end if;

  if exists (select 1 from public.result_sheets where exam_id = p_exam_id) then
    raise exception 'A result sheet already exists for this exam'
      using errcode = 'unique_violation';
  end if;

  select count(distinct p.id) into v_students
  from public.profiles p
  where p.role = 'student'
    and p.is_active
    and (
      p.class_id = v_exam.class_id
      or exists (
        select 1 from public.student_enrollments en
        where en.student_id = p.id
          and en.class_id = v_exam.class_id
          and en.status = 'active'
      )
    );

  if v_students = 0 then
    raise exception 'No active students found in this class'
      using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.marks where exam_id = p_exam_id) then
    raise exception 'No marks have been entered for this examination yet'
      using errcode = 'check_violation';
  end if;

  v_result_kind := public.resolved_exam_result_kind(p_exam_id);

  -- A semester result must be structured before it can be compiled. Internal
  -- assessments keep working with a single overall component.
  if v_result_kind = 'semester' then
    select string_agg(distinct s.code, ', ' order by s.code)
      into v_unstructured
    from public.exam_subjects es
    join public.subjects s on s.id = es.subject_id
    where es.exam_id = p_exam_id
      and exists (
        select 1 from public.marks m
        where m.exam_id = p_exam_id and m.subject_id = es.subject_id
      )
      and not exists (
        select 1 from public.assessment_components c
        where c.exam_subject_id = es.id
      );

    if v_unstructured is not null then
      raise exception 'Configure assessment components for % before compiling a semester result', v_unstructured
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.result_sheets (
    exam_id, class_id, status, compiled_by, current_version_number, result_kind
  )
  values (
    p_exam_id, v_exam.class_id, 'compiled', auth.uid(), 1, v_result_kind
  )
  returning id into v_sheet;

  insert into public.result_sheet_versions (
    sheet_id, version_number, status, compiled_by, compiled_at, snapshot
  ) values (
    v_sheet, 1, 'compiled', auth.uid(), now(),
    jsonb_build_object(
      'exam_id', p_exam_id,
      'class_id', v_exam.class_id,
      'result_kind', v_result_kind,
      'compiled_by', auth.uid()
    )
  )
  returning id into v_version;

  update public.result_sheets
  set current_version_id = v_version
  where id = v_sheet;

  insert into public.result_items (
    sheet_id, student_id, subject_id, marks_obtained, max_marks, version_id, credit_hours
  )
  select
    v_sheet,
    m.student_id,
    m.subject_id,
    sum(m.marks_obtained),
    coalesce(
      (select t.total_marks
       from public.assessment_templates t
       where t.id = es.assessment_template_id),
      es.max_marks,
      s.max_marks,
      100
    ),
    v_version,
    s.credit_hours
  from public.marks m
  join public.subjects s on s.id = m.subject_id
  left join public.exam_subjects es
    on es.exam_id = m.exam_id and es.subject_id = m.subject_id
  where m.exam_id = p_exam_id
  group by m.student_id, m.subject_id, es.assessment_template_id, es.max_marks, s.max_marks, s.credit_hours;

  insert into public.result_component_items (
    result_item_id, component_id, component_name, component_type,
    max_marks, marks_obtained, status, display_order
  )
  select
    ri.id,
    ac.id,
    coalesce(ac.name, 'Overall'),
    coalesce(ac.component_type, 'overall'),
    coalesce(ac.max_marks, ri.max_marks),
    m.marks_obtained,
    m.status,
    coalesce(ac.display_order, 1)
  from public.result_items ri
  join public.marks m
    on m.exam_id = p_exam_id
   and m.student_id = ri.student_id
   and m.subject_id = ri.subject_id
  left join public.assessment_components ac on ac.id = m.assessment_component_id
  where ri.sheet_id = v_sheet
  on conflict (result_item_id, component_name) do nothing;

  perform public.recalculate_result_sheet(v_sheet);

  update public.result_sheet_versions
  set snapshot = jsonb_build_object(
    'exam_id', p_exam_id,
    'class_id', v_exam.class_id,
    'result_kind', v_result_kind,
    'compiled_by', auth.uid(),
    'items', coalesce(
      (
        select jsonb_agg(to_jsonb(ri) - 'id')
        from public.result_items ri
        where ri.sheet_id = v_sheet
      ),
      '[]'::jsonb
    )
  )
  where id = v_version;

  insert into public.audit_logs (actor_id, actor_role, action, entity_table, entity_id, details)
  values (
    auth.uid(), public.app_role(), 'result_sheet.compiled', 'result_sheets', v_sheet::text,
    jsonb_build_object(
      'exam_id', p_exam_id,
      'class_id', v_exam.class_id,
      'version', 1,
      'result_kind', v_result_kind
    )
  );

  return v_sheet;
end;
$$;

-- ---------- 14. recalculation with template-aware subject totals ----------
create or replace function public.recalculate_result_sheet(p_sheet_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sheet             public.result_sheets%rowtype;
  v_scheme            uuid;
  v_theory_pass       numeric;
  v_lab_pass          numeric;
  v_item              public.result_items%rowtype;
  v_student           record;
  v_max               numeric;
  v_obtained          numeric;
  v_percentage        numeric;
  v_weight_sum        numeric;
  v_component_rows    integer;
  v_template_total    numeric;
  v_credit            numeric;
  v_effective_credit  numeric;
  v_subject_type      text;
  v_pass_threshold    numeric;
  v_withheld          boolean;
  v_absent            boolean;
  v_exam_pass_fail    boolean;
  v_is_pass           boolean;
  v_grade             text;
  v_grade_point       numeric;
  v_result_code       text;
  v_band_label        text;
  v_band_point        numeric;
  v_band_pass         boolean;
  v_credits           numeric;
  v_points            numeric;
  v_earned_credits    numeric;
  v_backlogs          integer;
  v_withheld_count    integer;
  v_cgpa_credits      numeric;
  v_cgpa_points       numeric;
  v_sgpa_exact        numeric;
  v_cgpa_exact        numeric;
  v_overall_grade     text;
  v_promotion         jsonb;
  v_max_backlogs      integer;
  v_min_sgpa          numeric;
  v_min_credit_pct    numeric;
  v_credit_pct        numeric;
  v_promotion_ok      boolean;
  v_summary_code      text;
begin
  perform public.require_active_user();

  if not (public.is_admin() or public.is_exam_cell() or public.is_principal()) then
    raise exception 'You do not have permission to recalculate results'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_sheet from public.result_sheets where id = p_sheet_id;
  if not found then
    raise exception 'Result sheet not found' using errcode = 'no_data_found';
  end if;

  v_scheme := public.active_grading_scheme();

  if v_scheme is null then
    raise exception 'No active grading scheme is configured'
      using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.grade_bands gb where gb.scheme_id = v_scheme) then
    raise exception 'The active grading scheme has no grade bands'
      using errcode = 'check_violation';
  end if;

  select coalesce(g.theory_pass_percent, 40), coalesce(g.lab_pass_percent, 45)
    into v_theory_pass, v_lab_pass
  from public.grading_schemes g
  where g.id = v_scheme;

  v_theory_pass := coalesce(v_theory_pass, 40);
  v_lab_pass := coalesce(v_lab_pass, 45);

  select coalesce(s.promotion_rules, '{}'::jsonb) into v_promotion
  from public.institution_settings s
  where s.id;

  v_max_backlogs := coalesce(nullif(v_promotion->>'max_backlogs', '')::integer, 2);
  v_min_sgpa := nullif(v_promotion->>'min_sgpa', '')::numeric;
  v_min_credit_pct := nullif(v_promotion->>'min_credit_percent', '')::numeric;

  for v_item in
    select * from public.result_items where sheet_id = p_sheet_id
  loop
    v_max := null;
    v_obtained := null;
    v_percentage := null;

    -- Template-based subjects return the final mark out of 100. Subjects
    -- without a template keep the legacy component behaviour below.
    v_template_total := public.assessment_component_total(
      v_sheet.exam_id, v_item.subject_id, v_item.student_id
    );

    if v_template_total is not null then
      v_obtained := v_template_total;
      v_max := 100;
      v_percentage := round(least(100, greatest(0, v_template_total)), 2);
    else
      select es.max_marks into v_max
      from public.exam_subjects es
      where es.exam_id = v_sheet.exam_id
        and es.subject_id = v_item.subject_id;

      -- Component rows that actually have a mark for this student.
      select count(*), coalesce(sum(ac.weight_percent), 0)
        into v_component_rows, v_weight_sum
      from public.marks m
      join public.assessment_components ac on ac.id = m.assessment_component_id
      where m.exam_id = v_sheet.exam_id
        and m.subject_id = v_item.subject_id
        and m.student_id = v_item.student_id;

      if v_component_rows > 0 then
        if abs(v_weight_sum - 100) < 0.01 then
          -- Weighted component percentage.
          select coalesce(sum(
                   case
                     when ac.max_marks > 0
                       then (m.marks_obtained / ac.max_marks) * ac.weight_percent
                     else 0
                   end
                 ), 0)
            into v_percentage
          from public.marks m
          join public.assessment_components ac on ac.id = m.assessment_component_id
          where m.exam_id = v_sheet.exam_id
            and m.subject_id = v_item.subject_id
            and m.student_id = v_item.student_id;

          v_max := coalesce(v_max, v_item.max_marks, 100);
          v_obtained := round((v_percentage / 100) * v_max, 2);
        else
          -- Raw total across components.
          select coalesce(sum(m.marks_obtained), 0), coalesce(sum(ac.max_marks), 0)
            into v_obtained, v_max
          from public.marks m
          join public.assessment_components ac on ac.id = m.assessment_component_id
          where m.exam_id = v_sheet.exam_id
            and m.subject_id = v_item.subject_id
            and m.student_id = v_item.student_id;

          if v_max is null or v_max <= 0 then
            v_max := coalesce(
              (select es.max_marks from public.exam_subjects es
               where es.exam_id = v_sheet.exam_id and es.subject_id = v_item.subject_id),
              v_item.max_marks,
              100
            );
          end if;
          v_percentage := case when v_max > 0 then (v_obtained / v_max) * 100 else 0 end;
        end if;
      else
        -- Legacy marks with no component id.
        select coalesce(sum(m.marks_obtained), 0), count(*)
          into v_obtained, v_component_rows
        from public.marks m
        where m.exam_id = v_sheet.exam_id
          and m.subject_id = v_item.subject_id
          and m.student_id = v_item.student_id
          and m.assessment_component_id is null;

        v_max := coalesce(
          (select es.max_marks from public.exam_subjects es
           where es.exam_id = v_sheet.exam_id and es.subject_id = v_item.subject_id),
          v_item.max_marks,
          100
        );

        if v_component_rows = 0 then
          v_obtained := coalesce(v_item.marks_obtained, 0);
          v_max := coalesce(v_item.max_marks, v_max);
        end if;

        v_percentage := case when v_max > 0 then (v_obtained / v_max) * 100 else 0 end;
      end if;
    end if;

    v_obtained := coalesce(v_obtained, 0);
    v_max := coalesce(v_max, 100);
    v_percentage := round(least(100, greatest(0, coalesce(v_percentage, 0))), 2);

    -- Withheld marks take precedence over every other rule. An absent mark
    -- set produces result code X; a failing subject produces F.
    select exists (
      select 1 from public.marks m
      where m.exam_id = v_sheet.exam_id
        and m.subject_id = v_item.subject_id
        and m.student_id = v_item.student_id
        and m.status = 'withheld'
    ) into v_withheld;

    select
      exists (
        select 1 from public.marks m
        where m.exam_id = v_sheet.exam_id
          and m.subject_id = v_item.subject_id
          and m.student_id = v_item.student_id
          and m.status = 'absent'
      )
      and not exists (
        select 1 from public.marks m
        where m.exam_id = v_sheet.exam_id
          and m.subject_id = v_item.subject_id
          and m.student_id = v_item.student_id
          and m.status in ('present', 'exempt')
      )
    into v_absent;

    select coalesce(s.subject_type, 'theory'), s.credit_hours
      into v_subject_type, v_credit
    from public.subjects s
    where s.id = v_item.subject_id;

    v_subject_type := coalesce(v_subject_type, 'theory');
    v_pass_threshold := case when v_subject_type = 'lab' then v_lab_pass else v_theory_pass end;
    v_effective_credit := coalesce(v_credit, v_item.credit_hours);

    select label, grade_point, is_pass
      into v_band_label, v_band_point, v_band_pass
    from public.grade_band_for(v_scheme, v_percentage);

    select exists (
      select 1 from public.exam_subjects es
      where es.exam_id = v_sheet.exam_id
        and es.subject_id = v_item.subject_id
        and es.pass_marks is not null
        and v_obtained < es.pass_marks
    ) into v_exam_pass_fail;

    if v_withheld then
      v_grade := 'RW';
      v_grade_point := 0;
      v_is_pass := false;
      v_result_code := 'RW';
    elsif v_absent then
      v_grade := 'X';
      v_grade_point := 0;
      v_is_pass := false;
      v_result_code := 'X';
    elsif v_percentage >= v_pass_threshold
          and coalesce(v_band_pass, false)
          and not v_exam_pass_fail then
      v_grade := coalesce(v_band_label, 'P');
      v_grade_point := coalesce(v_band_point, 0);
      v_is_pass := true;
      v_result_code := 'P';
    else
      v_grade := 'F';
      v_grade_point := 0;
      v_is_pass := false;
      v_result_code := 'F';
    end if;

    update public.result_items
    set marks_obtained = round(v_obtained, 2),
        max_marks = round(v_max, 2),
        percentage = v_percentage,
        grade = v_grade,
        grade_point = v_grade_point,
        is_pass = v_is_pass,
        credit_hours = v_effective_credit,
        earned_points = case
          when v_is_pass and v_effective_credit is not null
            then round(v_effective_credit * v_grade_point, 2)
          else 0
        end,
        is_withheld = v_withheld,
        result_code = v_result_code
    where id = v_item.id;
  end loop;

  -- ---------- per-student summary ----------
  for v_student in
    select distinct student_id from public.result_items where sheet_id = p_sheet_id
  loop
    select
      coalesce(sum(marks_obtained), 0),
      coalesce(sum(max_marks), 0),
      coalesce(sum(credit_hours) filter (
        where credit_hours is not null and credit_hours > 0 and not coalesce(is_withheld, false)
      ), 0),
      coalesce(sum(earned_points) filter (
        where credit_hours is not null and credit_hours > 0 and not coalesce(is_withheld, false)
      ), 0),
      coalesce(sum(credit_hours) filter (
        where credit_hours is not null and credit_hours > 0
          and coalesce(is_pass, false) and not coalesce(is_withheld, false)
      ), 0),
      (count(*) filter (
        where not coalesce(is_pass, false) and not coalesce(is_withheld, false)
      ))::integer,
      (count(*) filter (where coalesce(is_withheld, false)))::integer
    into v_obtained, v_max, v_credits, v_points, v_earned_credits, v_backlogs, v_withheld_count
    from public.result_items
    where sheet_id = p_sheet_id and student_id = v_student.student_id;

    v_percentage := case
      when v_max > 0 then round((v_obtained / v_max) * 100, 2)
      else null
    end;

    select label into v_band_label
    from public.grade_band_for(v_scheme, coalesce(v_percentage, 0));

    v_overall_grade := case
      when v_withheld_count > 0 then 'RW'
      else v_band_label
    end;

    v_sgpa_exact := case when v_credits > 0 then v_points / v_credits else null end;
    v_credit_pct := case when v_credits > 0 then (v_earned_credits / v_credits) * 100 else null end;

    -- CGPA: latest non-withheld published attempt per subject, plus the
    -- sheet being calculated so a publish-time recalculation reflects itself.
    select
      coalesce(sum(latest.credit_hours), 0),
      coalesce(sum(latest.credit_hours * latest.grade_point), 0)
    into v_cgpa_credits, v_cgpa_points
    from (
      select distinct on (ri.subject_id)
        ri.subject_id, ri.credit_hours, ri.grade_point
      from public.result_items ri
      join public.result_sheets rs on rs.id = ri.sheet_id
      where ri.student_id = v_student.student_id
        and (rs.status = 'published' or rs.id = p_sheet_id)
        and ri.credit_hours is not null
        and ri.credit_hours > 0
        and ri.grade_point is not null
        and not coalesce(ri.is_withheld, false)
      order by
        ri.subject_id,
        (rs.id = p_sheet_id) desc,
        rs.published_at desc nulls last,
        rs.updated_at desc
    ) latest;

    v_cgpa_exact := case when v_cgpa_credits > 0 then v_cgpa_points / v_cgpa_credits else null end;

    v_promotion_ok :=
      v_withheld_count = 0
      and v_backlogs <= v_max_backlogs
      and (v_min_sgpa is null or (v_sgpa_exact is not null and v_sgpa_exact >= v_min_sgpa))
      and (v_min_credit_pct is null or (v_credit_pct is not null and v_credit_pct >= v_min_credit_pct));

    v_summary_code := case
      when v_withheld_count > 0 then 'RW'
      when not v_promotion_ok then 'X'
      when v_backlogs > 0 then 'XP'
      else 'P'
    end;

    insert into public.result_student_summaries (
      sheet_id, version_id, student_id, total_marks, max_marks, percentage,
      total_credits, earned_credits, total_grade_points, sgpa, cgpa,
      overall_grade, is_pass, backlog_count, withheld_count, result_code,
      promotion_eligible, sgpa_exact, cgpa_exact, computed_at
    ) values (
      p_sheet_id,
      v_sheet.current_version_id,
      v_student.student_id,
      round(v_obtained, 2),
      round(v_max, 2),
      v_percentage,
      v_credits,
      v_earned_credits,
      round(v_points, 2),
      case when v_credits > 0 then round(v_points / v_credits, 2) else null end,
      case when v_cgpa_credits > 0 then round(v_cgpa_points / v_cgpa_credits, 2) else null end,
      v_overall_grade,
      (v_backlogs = 0 and v_withheld_count = 0),
      v_backlogs,
      v_withheld_count,
      v_summary_code,
      v_promotion_ok,
      v_sgpa_exact,
      v_cgpa_exact,
      now()
    )
    on conflict (sheet_id, student_id) do update set
      version_id = excluded.version_id,
      total_marks = excluded.total_marks,
      max_marks = excluded.max_marks,
      percentage = excluded.percentage,
      total_credits = excluded.total_credits,
      earned_credits = excluded.earned_credits,
      total_grade_points = excluded.total_grade_points,
      sgpa = excluded.sgpa,
      cgpa = excluded.cgpa,
      overall_grade = excluded.overall_grade,
      is_pass = excluded.is_pass,
      backlog_count = excluded.backlog_count,
      withheld_count = excluded.withheld_count,
      result_code = excluded.result_code,
      promotion_eligible = excluded.promotion_eligible,
      sgpa_exact = excluded.sgpa_exact,
      cgpa_exact = excluded.cgpa_exact,
      computed_at = excluded.computed_at;
  end loop;

  delete from public.result_student_summaries
  where sheet_id = p_sheet_id
    and student_id not in (
      select student_id from public.result_items where sheet_id = p_sheet_id
    );
end;
$$;

-- ---------- 15. readiness includes structure completeness ----------
create or replace function public.result_sheet_readiness(p_sheet_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sheet                  public.result_sheets%rowtype;
  v_items                  integer;
  v_students               integer;
  v_ungraded               integer;
  v_missing_marks          integer;
  v_missing_credits        integer;
  v_missing_components     integer;
  v_missing_component_marks integer;
  v_withheld               integer;
  v_result_kind            text;
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

  -- Exam subjects with marks but no configured components. A semester result
  -- cannot be approved or published without a structure.
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

  -- Required component slots without a mark. Only structured subjects are
  -- checked; legacy single-component examinations are unaffected.
  select count(*) into v_missing_component_marks
  from public.result_items ri
  join public.exam_subjects es
    on es.exam_id = v_sheet.exam_id
   and es.subject_id = ri.subject_id
  join public.assessment_components ac
    on ac.exam_subject_id = es.id
   and not ac.is_optional
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
    'missing_component_marks', v_missing_component_marks,
    'withheld', v_withheld,
    'ready', v_items > 0
      and v_ungraded = 0
      and v_missing_marks = 0
      and v_missing_credits = 0
      and v_missing_component_marks = 0
      and (v_result_kind <> 'semester' or v_missing_components = 0)
  );
end;
$$;

-- Approval and publication both refuse an incomplete sheet. Withheld results
-- are reported but never block a sheet, because a withheld result is an
-- official outcome rather than a missing mark. A semester result additionally
-- needs a configured structure and a mark in every required component.
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
    raise exception 'This result sheet is not ready for approval or publication (% ungraded, % missing marks, % missing credits, % subjects without components, % missing component marks)',
      coalesce(v_readiness->>'ungraded', '0'),
      coalesce(v_readiness->>'missing_marks', '0'),
      coalesce(v_readiness->>'missing_credits', '0'),
      coalesce(v_readiness->>'missing_components', '0'),
      coalesce(v_readiness->>'missing_component_marks', '0')
      using errcode = 'check_violation';
  end if;
end;
$$;

-- ---------- 16. publication: Exam Cell approval is final for semester results ----------
create or replace function public.publish_result_sheet(p_sheet_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sheet        public.result_sheets%rowtype;
  v_exam_name    text;
  v_is_exam      boolean;
  v_is_principal boolean;
  v_reviewer     public.user_role;
  v_result_kind  text;
begin
  perform public.require_active_user();

  v_is_exam := public.is_exam_cell();
  v_is_principal := public.is_principal();

  if not (v_is_exam or v_is_principal) then
    raise exception 'You do not have permission to publish results'
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

  -- Official semester results must pass through the Exam Cell. The principal
  -- can still publish an internal assessment without that extra gate.
  if v_result_kind = 'semester' and v_sheet.status <> 'exam_approved' then
    raise exception 'Semester results must be approved by the Exam Cell before publication'
      using errcode = 'check_violation';
  end if;

  if v_is_exam and not v_is_principal then
    if v_sheet.status <> 'exam_approved' then
      raise exception 'Approve this sheet in the Exam Cell before publishing it'
        using errcode = 'check_violation';
    end if;
  elsif v_sheet.status not in ('hod_approved', 'exam_approved', 'principal_signed') then
    raise exception 'This sheet has not been approved yet'
      using errcode = 'check_violation';
  end if;

  v_reviewer := case when v_is_exam then 'exam_cell'::public.user_role
                     else 'principal'::public.user_role end;

  select e.name into v_exam_name from public.exams e where e.id = v_sheet.exam_id;

  -- Recalculate before the status flips so a calculation failure leaves the
  -- sheet approved and retryable. The CGPA query already counts this sheet.
  perform public.recalculate_result_sheet(p_sheet_id);
  perform public.assert_result_sheet_ready(p_sheet_id);

  update public.result_sheets
  set status = 'published',
      published_at = now(),
      updated_at = now()
  where id = p_sheet_id;

  if v_sheet.current_version_id is not null then
    update public.result_sheet_versions
    set status = 'published',
        published_by = auth.uid(),
        published_at = now()
    where id = v_sheet.current_version_id;
  end if;

  insert into public.result_reviews (
    sheet_id, version_id, reviewer_id, reviewer_role, decision, remarks
  ) values (
    p_sheet_id, v_sheet.current_version_id, auth.uid(), v_reviewer, 'published', ''
  );

  insert into public.notifications (user_id, title, body, type, link)
  select distinct
    p.id,
    case when v_result_kind = 'semester' then 'Semester results published' else 'Results published' end,
    case
      when v_result_kind = 'semester'
        then 'Your semester result for "' || coalesce(v_exam_name, 'your examination') || '" is now available. Your grade card can be downloaded from the results page.'
      else 'Results for "' || coalesce(v_exam_name, 'your examination') || '" are now available on your dashboard.'
    end,
    'results_published',
    '/app/results'
  from public.profiles p
  where p.role = 'student'
    and p.is_active
    and (
      p.class_id = v_sheet.class_id
      or exists (
        select 1 from public.student_enrollments en
        where en.student_id = p.id
          and en.class_id = v_sheet.class_id
          and en.status = 'active'
      )
    );
end;
$$;

-- ---------- 17. guard template deletion ----------
create or replace function public.guard_assessment_template_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.assessment_components c
    where c.assessment_template_id = old.id
  ) or exists (
    select 1 from public.subjects s
    where s.assessment_template_id = old.id
  ) or exists (
    select 1 from public.exam_subjects es
    where es.assessment_template_id = old.id
  ) then
    raise exception 'This assessment template is in use. Deactivate it instead of deleting it.'
      using errcode = 'check_violation';
  end if;

  return old;
end;
$$;

drop trigger if exists guard_assessment_template_delete on public.assessment_templates;
create trigger guard_assessment_template_delete
  before delete on public.assessment_templates
  for each row execute function public.guard_assessment_template_delete();

-- ---------- 18. updated_at and audit triggers ----------
drop trigger if exists set_updated_at on public.assessment_templates;
create trigger set_updated_at
  before update on public.assessment_templates
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.assessment_template_components;
create trigger set_updated_at
  before update on public.assessment_template_components
  for each row execute function public.set_updated_at();

drop trigger if exists audit_assessment_templates on public.assessment_templates;
create trigger audit_assessment_templates
  after insert or update or delete on public.assessment_templates
  for each row execute function public.audit_result_config();

drop trigger if exists audit_assessment_template_components on public.assessment_template_components;
create trigger audit_assessment_template_components
  after insert or update or delete on public.assessment_template_components
  for each row execute function public.audit_result_config();

-- ---------- 19. row level security ----------
alter table public.assessment_templates enable row level security;
alter table public.assessment_template_components enable row level security;

drop policy if exists "assessment templates read" on public.assessment_templates;
create policy "assessment templates read" on public.assessment_templates
  for select to authenticated using (true);

drop policy if exists "assessment templates exam cell write" on public.assessment_templates;
create policy "assessment templates exam cell write" on public.assessment_templates
  for all to authenticated
  using (public.is_admin() or public.is_exam_cell())
  with check (public.is_admin() or public.is_exam_cell());

drop policy if exists "assessment template components read" on public.assessment_template_components;
create policy "assessment template components read" on public.assessment_template_components
  for select to authenticated using (true);

drop policy if exists "assessment template components exam cell write" on public.assessment_template_components;
create policy "assessment template components exam cell write" on public.assessment_template_components
  for all to authenticated
  using (public.is_admin() or public.is_exam_cell())
  with check (public.is_admin() or public.is_exam_cell());

grant select, insert, update, delete on public.assessment_templates to authenticated;
grant select, insert, update, delete on public.assessment_template_components to authenticated;

-- ---------- 20. permissions ----------
-- The internal helpers stay behind security-definer callers. Only the four
-- configuration RPCs and the two read helpers are callable by a signed-in
-- user; every RPC still checks the Exam Cell / admin role itself.
revoke execute on function public.resolved_exam_result_kind(uuid) from anon, public;
revoke execute on function public.resolved_template_for_subject(uuid) from anon, public;
revoke execute on function public.assessment_component_total(uuid, uuid, uuid) from anon, public;
revoke execute on function public.materialize_assessment_template(uuid, uuid) from anon, public;
revoke execute on function public.apply_assessment_template(uuid, uuid, boolean) from anon, public;
revoke execute on function public.apply_assessment_templates_to_exam(uuid, boolean) from anon, public;
revoke execute on function public.set_subject_assessment_template(uuid, uuid) from anon, public;
revoke execute on function public.set_default_assessment_template(uuid, boolean) from anon, public;

grant execute on function public.resolved_exam_result_kind(uuid) to authenticated;
grant execute on function public.resolved_template_for_subject(uuid) to authenticated;
grant execute on function public.apply_assessment_template(uuid, uuid, boolean) to authenticated;
grant execute on function public.apply_assessment_templates_to_exam(uuid, boolean) to authenticated;
grant execute on function public.set_subject_assessment_template(uuid, uuid) to authenticated;
grant execute on function public.set_default_assessment_template(uuid, boolean) to authenticated;

-- ---------- 21. snapshot the result kind on existing sheets ----------
update public.result_sheets rs
set result_kind = public.resolved_exam_result_kind(rs.exam_id)
where rs.result_kind is distinct from public.resolved_exam_result_kind(rs.exam_id);
