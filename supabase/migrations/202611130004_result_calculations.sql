-- ============================================================
-- GRADIA · Result calculation engine
-- ============================================================
-- Additive migration. Reuses the existing grading tables:
--   institution_settings.default_grading_scheme_id
--   grading_schemes / grade_bands
--   assessment_components.weight_percent
--   subjects.credit_hours
--   result_items.grade / grade_point / percentage
--
-- Calculation policy:
--   * If the subject's components have weights that sum to 100, the
--     component percentage is weighted and scaled to the subject maximum.
--   * Otherwise the raw component/legacy total is used.
--   * Grade and grade point come from the active grading scheme.
--   * SGPA needs credit hours; CGPA uses the latest published attempt
--     per subject and is refreshed again when a sheet is published.
-- ============================================================

-- ---------- helpers ----------
create or replace function public.active_grading_scheme()
returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    (select s.default_grading_scheme_id from public.institution_settings s where s.id),
    (select g.id from public.grading_schemes g where g.is_default order by g.created_at limit 1),
    (select g.id from public.grading_schemes g order by g.created_at limit 1)
  );
$$;

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
    and (p_percentage < gb.max_percent or gb.max_percent >= 100)
  order by gb.display_order
  limit 1;
$$;

-- ---------- sheet recalculation ----------
create or replace function public.recalculate_result_sheet(p_sheet_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sheet          public.result_sheets%rowtype;
  v_scheme         uuid;
  v_item           public.result_items%rowtype;
  v_band           record;
  v_student        record;
  v_max            numeric;
  v_obtained       numeric;
  v_percentage     numeric;
  v_weight_sum     numeric;
  v_component_rows integer;
  v_credit         numeric;
  v_credits        numeric;
  v_points         numeric;
  v_earned         numeric;
  v_is_pass        boolean;
  v_cgpa_credits   numeric;
  v_cgpa_points    numeric;
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

    v_percentage := round(least(100, greatest(0, coalesce(v_percentage, 0))), 2);

    select * into v_band
    from public.grade_band_for(v_scheme, v_percentage);

    v_is_pass := coalesce(v_band.is_pass, false);
    if exists (
      select 1 from public.exam_subjects es
      where es.exam_id = v_sheet.exam_id
        and es.subject_id = v_item.subject_id
        and es.pass_marks is not null
        and v_obtained < es.pass_marks
    ) then
      v_is_pass := false;
    end if;

    select credit_hours into v_credit
    from public.subjects where id = v_item.subject_id;

    update public.result_items
    set marks_obtained = round(coalesce(v_obtained, 0), 2),
        max_marks = round(coalesce(v_max, 100), 2),
        percentage = v_percentage,
        grade = v_band.label,
        grade_point = v_band.grade_point,
        is_pass = v_is_pass,
        credit_hours = coalesce(v_credit, credit_hours)
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
        where credit_hours is not null and grade_point is not null
      ), 0),
      coalesce(sum(credit_hours * grade_point) filter (
        where credit_hours is not null and grade_point is not null
      ), 0),
      coalesce(sum(credit_hours) filter (
        where credit_hours is not null and grade_point is not null and coalesce(is_pass, false)
      ), 0),
      coalesce(bool_and(coalesce(is_pass, false)), false)
    into v_obtained, v_max, v_credits, v_points, v_earned, v_is_pass
    from public.result_items
    where sheet_id = p_sheet_id and student_id = v_student.student_id;

    v_percentage := case
      when v_max > 0 then round((v_obtained / v_max) * 100, 2)
      else null
    end;

    select * into v_band
    from public.grade_band_for(v_scheme, coalesce(v_percentage, 0));

    -- CGPA: latest published attempt per subject, plus the sheet being
    -- calculated so a publish-time recalculation already reflects itself.
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
        and ri.grade_point is not null
      order by
        ri.subject_id,
        (rs.id = p_sheet_id) desc,
        rs.published_at desc nulls last,
        rs.updated_at desc
    ) latest;

    insert into public.result_student_summaries (
      sheet_id, version_id, student_id, total_marks, max_marks, percentage,
      total_credits, earned_credits, total_grade_points, sgpa, cgpa,
      overall_grade, is_pass, computed_at
    ) values (
      p_sheet_id,
      v_sheet.current_version_id,
      v_student.student_id,
      round(v_obtained, 2),
      round(v_max, 2),
      v_percentage,
      v_credits,
      v_earned,
      round(v_points, 2),
      case when v_credits > 0 then round(v_points / v_credits, 2) else null end,
      case when v_cgpa_credits > 0 then round(v_cgpa_points / v_cgpa_credits, 2) else null end,
      v_band.label,
      v_is_pass,
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
      computed_at = excluded.computed_at;
  end loop;

  delete from public.result_student_summaries
  where sheet_id = p_sheet_id
    and student_id not in (
      select student_id from public.result_items where sheet_id = p_sheet_id
    );
end;
$$;

-- ---------- readiness report for Exam Cell review ----------
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

  return jsonb_build_object(
    'sheet_id', p_sheet_id,
    'status', v_sheet.status,
    'items', v_items,
    'students', v_students,
    'ungraded', v_ungraded,
    'missing_marks', v_missing_marks,
    'missing_credits', v_missing_credits,
    'ready', v_items > 0 and v_ungraded = 0 and v_missing_marks = 0
  );
end;
$$;

-- ---------- permissions ----------
revoke execute on function public.active_grading_scheme() from anon, public;
grant  execute on function public.active_grading_scheme() to authenticated;

revoke execute on function public.grade_band_for(uuid, numeric) from anon, public;
grant  execute on function public.grade_band_for(uuid, numeric) to authenticated;

revoke execute on function public.recalculate_result_sheet(uuid) from anon, public;
grant  execute on function public.recalculate_result_sheet(uuid) to authenticated;

revoke execute on function public.result_sheet_readiness(uuid) from anon, public;
grant  execute on function public.result_sheet_readiness(uuid) to authenticated;
