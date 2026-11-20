-- ============================================================
-- GRADIA · Direct marks for practical subjects
-- ============================================================
-- A practical subject (subject_type = 'lab' or an LS code) normally carries
-- three papers: Practical Record, Viva and the Practical Examination. When all
-- of them are switched off, there is no paper to mark. The teacher then enters
-- one mark out of 100 for the subject instead of a mark per paper.
--
-- The mark stays in public.marks with assessment_component_id = null, so the
-- existing unique slot, validate_mark trigger, RLS policies, submission lock
-- and revision history all keep working. recalculate_result_sheet already
-- handles a null-component mark as a raw mark out of the exam subject maximum
-- (100 after materialisation), so no calculation branch changes here.
--
-- Only approval readiness needs to change: a subject with a structure but no
-- conducted paper is normally a hard error, but a lab in this direct state is
-- valid once every student has a mark.
--
-- Published sheets stay immutable: papers cannot be switched off after marks
-- exist, and the scheduling RPC still refuses any change to a published exam.
-- ============================================================

-- ---------- 1. eligibility ----------
create or replace function public.lab_direct_marks_eligible(
  p_exam_id    uuid,
  p_subject_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.is_practical_subject(p_subject_id)
    and exists (
      select 1
      from public.exam_subjects es
      where es.exam_id = p_exam_id
        and es.subject_id = p_subject_id
        -- The structure must exist. A subject with no components is a
        -- misconfiguration, not a direct-mark lab.
        and exists (
          select 1 from public.assessment_components ac
          where ac.exam_subject_id = es.id
        )
        -- Every lab paper, including Practical Record, is switched off.
        and not exists (
          select 1 from public.assessment_components ac
          where ac.exam_subject_id = es.id
            and coalesce(ac.is_conducted, true)
        )
    ),
    false
  );
$$;

revoke execute on function public.lab_direct_marks_eligible(uuid, uuid) from anon, authenticated, public;

-- ---------- 2. readiness accepts a direct-lab subject ----------
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

  -- A subject with a structure but no conducted paper cannot be graded.
  -- The exception is a lab with every paper deliberately off: its direct mark
  -- is covered by v_missing_marks above and graded by the legacy raw-mark
  -- branch of recalculate_result_sheet.
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
    )
    and not public.lab_direct_marks_eligible(v_sheet.exam_id, es.subject_id);

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

-- The approval screen calls this RPC directly; keep its existing grant.
revoke execute on function public.result_sheet_readiness(uuid) from anon, public;
grant execute on function public.result_sheet_readiness(uuid) to authenticated;
