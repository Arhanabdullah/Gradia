-- ============================================================
-- GRADIA · Exam Cell workflow
-- ============================================================
-- Additive replacement of the workflow RPCs. Signatures stay the same;
-- the existing HOD and Principal paths keep working.
--
--   admin / exam_cell  compile_result_sheet
--   hod                review_result_sheet          (unchanged)
--   exam_cell          exam_approve_result_sheet    (new)
--   exam_cell          publish_result_sheet         (status exam_approved)
--   principal          publish_result_sheet         (hod_approved, exam_approved or legacy principal_signed)
--
-- Compilation now aggregates component marks into one row per
-- student/subject, snapshots credit hours, and recalculates grades,
-- percentages, SGPA and CGPA from the configured grading scheme.
-- ============================================================

-- ---------- compile: admin or exam cell ----------
create or replace function public.compile_result_sheet(p_exam_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam     public.exams%rowtype;
  v_sheet    uuid;
  v_version  uuid;
  v_students int;
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

  -- Match the marks-entry roster: a student is in scope through the profile
  -- class or an active enrolment, not the profile class alone.
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

  insert into public.result_sheets (exam_id, class_id, status, compiled_by, current_version_number)
  values (p_exam_id, v_exam.class_id, 'compiled', auth.uid(), 1)
  returning id into v_sheet;

  insert into public.result_sheet_versions (
    sheet_id, version_number, status, compiled_by, compiled_at, snapshot
  ) values (
    v_sheet, 1, 'compiled', auth.uid(), now(),
    jsonb_build_object(
      'exam_id', p_exam_id,
      'class_id', v_exam.class_id,
      'compiled_by', auth.uid()
    )
  )
  returning id into v_version;

  update public.result_sheets
  set current_version_id = v_version
  where id = v_sheet;

  -- One row per student x subject. Component marks are summed first;
  -- recalculate_result_sheet() then applies weighting and grading.
  insert into public.result_items (
    sheet_id, student_id, subject_id, marks_obtained, max_marks, version_id, credit_hours
  )
  select
    v_sheet,
    m.student_id,
    m.subject_id,
    sum(m.marks_obtained),
    coalesce(es.max_marks, s.max_marks, 100),
    v_version,
    s.credit_hours
  from public.marks m
  join public.subjects s on s.id = m.subject_id
  left join public.exam_subjects es
    on es.exam_id = m.exam_id and es.subject_id = m.subject_id
  where m.exam_id = p_exam_id
  group by m.student_id, m.subject_id, es.max_marks, s.max_marks, s.credit_hours;

  -- Component-level snapshot. Legacy marks without a component are
  -- captured as a single "Overall" entry so the snapshot is complete.
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
    jsonb_build_object('exam_id', p_exam_id, 'class_id', v_exam.class_id, 'version', 1)
  );

  return v_sheet;
end;
$$;

-- ---------- exam cell: approve or reject an HOD-approved sheet ----------
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

-- ---------- publish: exam cell or principal ----------
create or replace function public.publish_result_sheet(p_sheet_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sheet       public.result_sheets%rowtype;
  v_exam_name   text;
  v_is_exam     boolean;
  v_is_principal boolean;
  v_reviewer    public.user_role;
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

-- ---------- permissions ----------
revoke execute on function public.compile_result_sheet(uuid) from anon, public;
grant  execute on function public.compile_result_sheet(uuid) to authenticated;

revoke execute on function public.exam_approve_result_sheet(uuid, boolean, text) from anon, public;
grant  execute on function public.exam_approve_result_sheet(uuid, boolean, text) to authenticated;

revoke execute on function public.publish_result_sheet(uuid) from anon, public;
grant  execute on function public.publish_result_sheet(uuid) to authenticated;
