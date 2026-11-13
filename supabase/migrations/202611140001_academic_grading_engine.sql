-- ============================================================
-- GRADIA · Academic grading engine and grade card
-- ============================================================
-- Additive migration. Extends the existing result engine with the
-- credit-weighted SGPA/CGPA model, result codes, promotion rules and
-- the configuration needed by the printable grade card.
--
-- Reuses (never duplicates):
--   grading_schemes / grade_bands
--   assessment_components
--   subjects.credit_hours / max_marks
--   result_items / result_student_summaries / result_component_items
--   institution_settings.result_format
--   audit_logs
--
-- New configuration:
--   grading_schemes.theory_pass_percent / lab_pass_percent
--   subjects.subject_type
--   institution_settings.promotion_rules
--
-- New snapshot columns:
--   result_items.earned_points / is_withheld / result_code
--   result_student_summaries.backlog_count / withheld_count /
--     result_code / promotion_eligible / sgpa_exact / cgpa_exact
--
-- Existing rows, marks and published results are untouched. The default
-- grade bands are repaired in place (F is a failing band, ranges are
-- contiguous, display order is meaningful) and the active result format
-- gains the grade-card flags without dropping unknown keys.
-- ============================================================

-- ---------- 1. grading scheme pass thresholds ----------
alter table public.grading_schemes
  add column if not exists theory_pass_percent numeric(5,2) not null default 40;
alter table public.grading_schemes
  add column if not exists lab_pass_percent numeric(5,2) not null default 45;

do $$ begin
  alter table public.grading_schemes
    add constraint grading_schemes_theory_pass_valid
    check (theory_pass_percent >= 0 and theory_pass_percent <= 100);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.grading_schemes
    add constraint grading_schemes_lab_pass_valid
    check (lab_pass_percent >= 0 and lab_pass_percent <= 100);
exception when duplicate_object then null; end $$;

-- ---------- 2. subject type ----------
alter table public.subjects
  add column if not exists subject_type text not null default 'theory';

do $$ begin
  alter table public.subjects
    add constraint subjects_subject_type_valid
    check (subject_type in ('theory', 'lab', 'project'));
exception when duplicate_object then null; end $$;

-- Backfill the obvious labs from the existing catalogue. Explicit values
-- set by the Exam Cell later are never overwritten because this runs once.
update public.subjects
set subject_type = 'lab'
where subject_type = 'theory'
  and (
    code ilike 'LS%'
    or name ilike '%lab%'
    or name ilike '%practical%'
  );

-- ---------- 3. registration number ----------
alter table public.profiles
  add column if not exists registration_no text;

create unique index if not exists profiles_registration_no_unique
  on public.profiles (lower(btrim(registration_no)))
  where registration_no is not null and btrim(registration_no) <> '';

-- ---------- 4. result item snapshot columns ----------
alter table public.result_items
  add column if not exists earned_points numeric(10,2) not null default 0;
alter table public.result_items
  add column if not exists is_withheld boolean not null default false;
alter table public.result_items
  add column if not exists result_code text;

do $$ begin
  alter table public.result_items
    add constraint result_items_result_code_valid
    check (result_code is null or result_code in ('P', 'F', 'X', 'RW'));
exception when duplicate_object then null; end $$;

-- ---------- 5. per-student summary columns ----------
alter table public.result_student_summaries
  add column if not exists backlog_count integer not null default 0;
alter table public.result_student_summaries
  add column if not exists withheld_count integer not null default 0;
alter table public.result_student_summaries
  add column if not exists result_code text;
alter table public.result_student_summaries
  add column if not exists promotion_eligible boolean;
alter table public.result_student_summaries
  add column if not exists sgpa_exact numeric(8,4);
alter table public.result_student_summaries
  add column if not exists cgpa_exact numeric(8,4);

-- ---------- 6. promotion rules ----------
alter table public.institution_settings
  add column if not exists promotion_rules jsonb not null
  default '{"max_backlogs": 2, "min_sgpa": null, "min_credit_percent": null}'::jsonb;

-- ---------- 7. repair the default grade bands ----------
-- The original default seeded every band with display_order = 1, marked F
-- as a pass and left gaps between integer ranges (for example 89.5 matched
-- nothing). Only the recognised default labels are touched, so a custom
-- scheme is never rewritten.
do $$
declare
  v_scheme uuid;
begin
  v_scheme := coalesce(
    (select s.default_grading_scheme_id from public.institution_settings s where s.id),
    (select g.id from public.grading_schemes g where g.is_default order by g.created_at limit 1),
    (select g.id from public.grading_schemes g order by g.created_at limit 1)
  );

  if v_scheme is not null then
    update public.grade_bands set min_percent = 90,  max_percent = 100,   grade_point = 10, is_pass = true,  display_order = 1 where scheme_id = v_scheme and label = 'O';
    update public.grade_bands set min_percent = 80,  max_percent = 89.99, grade_point = 9,  is_pass = true,  display_order = 2 where scheme_id = v_scheme and label = 'A+';
    update public.grade_bands set min_percent = 70,  max_percent = 79.99, grade_point = 8,  is_pass = true,  display_order = 3 where scheme_id = v_scheme and label = 'A';
    update public.grade_bands set min_percent = 60,  max_percent = 69.99, grade_point = 7,  is_pass = true,  display_order = 4 where scheme_id = v_scheme and label = 'B+';
    update public.grade_bands set min_percent = 50,  max_percent = 59.99, grade_point = 6,  is_pass = true,  display_order = 5 where scheme_id = v_scheme and label = 'B';
    update public.grade_bands set min_percent = 40,  max_percent = 49.99, grade_point = 5,  is_pass = true,  display_order = 6 where scheme_id = v_scheme and label = 'C';
    update public.grade_bands set min_percent = 0,   max_percent = 39.99, grade_point = 0,  is_pass = false, display_order = 7 where scheme_id = v_scheme and label = 'F';
  end if;
end $$;

-- Gap-tolerant lookup: the highest configured minimum that the percentage
-- reaches wins, so a value between two integer bands still resolves.
create or replace function public.grade_band_for(
  p_scheme     uuid,
  p_percentage numeric
)
returns table (label text, grade_point numeric, is_pass boolean)
language sql stable security definer set search_path = public, pg_temp
as $$
  select gb.label, gb.grade_point, gb.is_pass
  from public.grade_bands gb
  where gb.scheme_id = p_scheme
    and p_percentage >= gb.min_percent
  order by gb.min_percent desc, gb.display_order
  limit 1;
$$;

-- ---------- 8. merge grade-card defaults into the result format ----------
-- Existing keys (including unknown future keys) win; only missing keys and
-- the legacy default title are replaced.
update public.institution_settings s
set result_format =
  jsonb_build_object(
    'title', 'Grade Card',
    'show_credits', true,
    'show_grade_points', true,
    'show_percentage', true,
    'show_sgpa', true,
    'show_cgpa', true,
    'show_reference_table', true,
    'show_formulas', true,
    'footer', '',
    'signatory', 'Controller of Examinations'
  )
  || (s.result_format - 'title')
  || jsonb_build_object(
       'title',
       case
         when coalesce(s.result_format->>'title', '') in ('', 'Statement of Results') then 'Grade Card'
         else s.result_format->>'title'
       end
     )
where s.id;

-- ---------- 9. result recalculation ----------
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

-- ---------- 10. readiness report for Exam Cell review ----------
create or replace function public.result_sheet_readiness(p_sheet_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sheet           public.result_sheets%rowtype;
  v_items           integer;
  v_students        integer;
  v_ungraded        integer;
  v_missing_marks   integer;
  v_missing_credits integer;
  v_withheld        integer;
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

  select count(*) into v_withheld
  from public.result_items
  where sheet_id = p_sheet_id and coalesce(is_withheld, false);

  return jsonb_build_object(
    'sheet_id', p_sheet_id,
    'status', v_sheet.status,
    'items', v_items,
    'students', v_students,
    'ungraded', v_ungraded,
    'missing_marks', v_missing_marks,
    'missing_credits', v_missing_credits,
    'withheld', v_withheld,
    'ready', v_items > 0
      and v_ungraded = 0
      and v_missing_marks = 0
      and v_missing_credits = 0
  );
end;
$$;

-- Approval and publication both refuse an incomplete sheet. Withheld
-- results are reported but never block a sheet, because a withheld result
-- is an official outcome rather than a missing mark.
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
    raise exception 'This result sheet is not ready for approval or publication (% ungraded, % missing marks, % missing credits)',
      coalesce(v_readiness->>'ungraded', '0'),
      coalesce(v_readiness->>'missing_marks', '0'),
      coalesce(v_readiness->>'missing_credits', '0')
      using errcode = 'check_violation';
  end if;
end;
$$;

-- ---------- 11. Exam Cell approval with readiness gate ----------
create or replace function public.exam_approve_result_sheet(
  p_sheet_id uuid,
  p_approve  boolean,
  p_remarks  text default ''
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sheet   public.result_sheets%rowtype;
  v_status  public.sheet_status;
  v_remarks text;
begin
  perform public.require_role(array['exam_cell']::public.user_role[]);

  select * into v_sheet from public.result_sheets where id = p_sheet_id;
  if not found then
    raise exception 'Result sheet not found' using errcode = 'no_data_found';
  end if;

  if v_sheet.status <> 'hod_approved' then
    raise exception 'This sheet is not awaiting Exam Cell approval'
      using errcode = 'check_violation';
  end if;

  v_status := (case when p_approve then 'exam_approved' else 'exam_rejected' end)::public.sheet_status;
  v_remarks := coalesce(p_remarks, '');

  -- Recalculate before recording the decision so a calculation failure
  -- leaves the sheet in the HOD-approved state, ready to retry.
  if p_approve then
    perform public.recalculate_result_sheet(p_sheet_id);
    perform public.assert_result_sheet_ready(p_sheet_id);
  end if;

  update public.result_sheets
  set status = v_status,
      exam_approved_by = auth.uid(),
      exam_approved_at = now(),
      exam_remarks = v_remarks,
      updated_at = now()
  where id = p_sheet_id;

  if v_sheet.current_version_id is not null then
    update public.result_sheet_versions
    set status = v_status,
        exam_approved_by = auth.uid(),
        exam_remarks = v_remarks
    where id = v_sheet.current_version_id;
  end if;

  insert into public.result_reviews (
    sheet_id, version_id, reviewer_id, reviewer_role, decision, remarks
  ) values (
    p_sheet_id, v_sheet.current_version_id, auth.uid(), 'exam_cell',
    case when p_approve then 'approved' else 'rejected' end,
    v_remarks
  );

  insert into public.audit_logs (actor_id, actor_role, action, entity_table, entity_id, details)
  values (
    auth.uid(), public.app_role(),
    case when p_approve then 'result_sheet.exam_approved' else 'result_sheet.exam_rejected' end,
    'result_sheets', p_sheet_id::text,
    jsonb_build_object('remarks', v_remarks)
  );
end;
$$;

-- ---------- 12. publication with readiness gate ----------
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
    'Results published',
    'Results for "' || coalesce(v_exam_name, 'your examination') || '" are now available on your dashboard.',
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

-- ---------- 13. configuration audit trail ----------
create or replace function public.audit_result_config()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity text := tg_table_name;
  v_id     text;
begin
  v_id := case when tg_op = 'DELETE' then old.id::text else new.id::text end;

  insert into public.audit_logs (actor_id, actor_role, action, entity_table, entity_id, details)
  values (
    auth.uid(),
    public.app_role(),
    v_entity || '.' || lower(tg_op),
    v_entity,
    v_id,
    jsonb_build_object(
      'before', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
      'after', case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
    )
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists audit_grading_schemes on public.grading_schemes;
create trigger audit_grading_schemes
  after insert or update or delete on public.grading_schemes
  for each row execute function public.audit_result_config();

drop trigger if exists audit_grade_bands on public.grade_bands;
create trigger audit_grade_bands
  after insert or update or delete on public.grade_bands
  for each row execute function public.audit_result_config();

drop trigger if exists audit_institution_settings on public.institution_settings;
create trigger audit_institution_settings
  after insert or update or delete on public.institution_settings
  for each row execute function public.audit_result_config();

-- ---------- 14. profile creation carries the registration number ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id, username, name, email, role, department, class_id, registration_no
  )
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'username', ''),
      'user_' || substr(replace(new.id::text, '-', ''), 1, 8)
    ),
    coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1)),
    new.email,
    coalesce(
      (nullif(new.raw_user_meta_data->>'role', ''))::public.user_role,
      'student'
    ),
    nullif(new.raw_user_meta_data->>'department', ''),
    (nullif(new.raw_user_meta_data->>'class_id', ''))::uuid,
    nullif(btrim(new.raw_user_meta_data->>'registration_no'), '')
  );
  return new;
end;
$$;

-- ---------- 15. permissions ----------
revoke execute on function public.grade_band_for(uuid, numeric) from anon, public;
grant  execute on function public.grade_band_for(uuid, numeric) to authenticated;

revoke execute on function public.recalculate_result_sheet(uuid) from anon, public;
grant  execute on function public.recalculate_result_sheet(uuid) to authenticated;

revoke execute on function public.result_sheet_readiness(uuid) from anon, public;
grant  execute on function public.result_sheet_readiness(uuid) to authenticated;

revoke execute on function public.assert_result_sheet_ready(uuid) from anon, public;
grant  execute on function public.assert_result_sheet_ready(uuid) to authenticated;

revoke execute on function public.exam_approve_result_sheet(uuid, boolean, text) from anon, public;
grant  execute on function public.exam_approve_result_sheet(uuid, boolean, text) to authenticated;

revoke execute on function public.publish_result_sheet(uuid) from anon, public;
grant  execute on function public.publish_result_sheet(uuid) to authenticated;
