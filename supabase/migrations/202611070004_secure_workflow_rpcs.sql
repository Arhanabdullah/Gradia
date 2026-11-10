-- ============================================================
-- GRADIA · Phase 3 · Secure workflow RPCs
-- ============================================================
-- Re-creates the four workflow functions with the same signatures the
-- frontend already calls, but:
--   * every call requires an ACTIVE account via require_role(), which
--     also replaces the old `app_role() <> 'principal'` check (that
--     check was NULL-unsafe: an inactive/unknown user slipped through
--     because NULL <> 'principal' is NULL, not true);
--   * compile creates version 1 of the sheet so the review/sign/publish
--     steps can keep an immutable trail;
--   * review/sign/publish append to result_reviews;
--   * publish freezes the version and notifies the class.
--
-- All four remain SECURITY DEFINER with a pinned search_path. Clients
-- still cannot write result_sheets / versions / items directly: there
-- is no INSERT/UPDATE policy for them, only these functions.
-- ============================================================

-- ---------- admin: compile an exam into a result sheet ----------
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
  perform public.require_role(array['admin']::public.user_role[]);

  select * into v_exam from public.exams where id = p_exam_id;
  if not found then
    raise exception 'Exam not found' using errcode = 'no_data_found';
  end if;

  if exists (select 1 from public.result_sheets where exam_id = p_exam_id) then
    raise exception 'A result sheet already exists for this exam'
      using errcode = 'unique_violation';
  end if;

  select count(*) into v_students
  from public.profiles
  where class_id = v_exam.class_id
    and role = 'student'
    and is_active;

  if v_students = 0 then
    raise exception 'No active students found in this class'
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

  insert into public.result_items (
    sheet_id, student_id, subject_id, marks_obtained, max_marks, version_id
  )
  select
    v_sheet,
    m.student_id,
    m.subject_id,
    m.marks_obtained,
    coalesce(es.max_marks, s.max_marks, 100),
    v_version
  from public.marks m
  join public.subjects s on s.id = m.subject_id
  left join public.exam_subjects es
    on es.exam_id = m.exam_id and es.subject_id = m.subject_id
  where m.exam_id = p_exam_id;

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
    auth.uid(), 'admin', 'result_sheet.compiled', 'result_sheets', v_sheet::text,
    jsonb_build_object('exam_id', p_exam_id, 'class_id', v_exam.class_id, 'version', 1)
  );

  return v_sheet;
end;
$$;

-- ---------- HOD: approve or reject a compiled sheet ----------
create or replace function public.review_result_sheet(
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
  perform public.require_role(array['hod']::public.user_role[]);

  select * into v_sheet from public.result_sheets where id = p_sheet_id;
  if not found then
    raise exception 'Result sheet not found' using errcode = 'no_data_found';
  end if;

  if not public.is_sheet_hod(p_sheet_id) then
    raise exception 'Only the HOD of this class can review this sheet'
      using errcode = 'insufficient_privilege';
  end if;

  if v_sheet.status <> 'compiled' then
    raise exception 'This sheet is not awaiting HOD review'
      using errcode = 'check_violation';
  end if;

  v_status := (case when p_approve then 'hod_approved' else 'hod_rejected' end)::public.sheet_status;
  v_remarks := coalesce(p_remarks, '');

  update public.result_sheets
  set status = v_status,
      hod_reviewed_by = auth.uid(),
      hod_remarks = v_remarks,
      updated_at = now()
  where id = p_sheet_id;

  if v_sheet.current_version_id is not null then
    update public.result_sheet_versions
    set status = v_status,
        reviewed_by = auth.uid(),
        hod_remarks = v_remarks
    where id = v_sheet.current_version_id;
  end if;

  insert into public.result_reviews (
    sheet_id, version_id, reviewer_id, reviewer_role, decision, remarks
  ) values (
    p_sheet_id, v_sheet.current_version_id, auth.uid(), 'hod',
    case when p_approve then 'approved' else 'rejected' end,
    v_remarks
  );
end;
$$;

-- ---------- principal: sign off an HOD-approved sheet ----------
create or replace function public.sign_off_result_sheet(
  p_sheet_id uuid,
  p_remarks  text default ''
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sheet   public.result_sheets%rowtype;
  v_remarks text;
begin
  perform public.require_role(array['principal']::public.user_role[]);

  select * into v_sheet from public.result_sheets where id = p_sheet_id;
  if not found then
    raise exception 'Result sheet not found' using errcode = 'no_data_found';
  end if;

  if v_sheet.status <> 'hod_approved' then
    raise exception 'This sheet has not been approved by the HOD yet'
      using errcode = 'check_violation';
  end if;

  v_remarks := coalesce(p_remarks, '');

  update public.result_sheets
  set status = 'principal_signed',
      principal_signed_by = auth.uid(),
      principal_remarks = v_remarks,
      updated_at = now()
  where id = p_sheet_id;

  if v_sheet.current_version_id is not null then
    update public.result_sheet_versions
    set status = 'principal_signed',
        signed_by = auth.uid(),
        principal_remarks = v_remarks
    where id = v_sheet.current_version_id;
  end if;

  insert into public.result_reviews (
    sheet_id, version_id, reviewer_id, reviewer_role, decision, remarks
  ) values (
    p_sheet_id, v_sheet.current_version_id, auth.uid(), 'principal', 'signed', v_remarks
  );
end;
$$;

-- ---------- principal: publish a signed-off sheet ----------
create or replace function public.publish_result_sheet(p_sheet_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sheet     public.result_sheets%rowtype;
  v_exam_name text;
begin
  perform public.require_role(array['principal']::public.user_role[]);

  select * into v_sheet from public.result_sheets where id = p_sheet_id;
  if not found then
    raise exception 'Result sheet not found' using errcode = 'no_data_found';
  end if;

  if v_sheet.status <> 'principal_signed' then
    raise exception 'This sheet has not been signed off by the principal yet'
      using errcode = 'check_violation';
  end if;

  select e.name into v_exam_name from public.exams e where e.id = v_sheet.exam_id;

  update public.result_sheets
  set status = 'published',
      published_at = now(),
      updated_at = now()
  where id = p_sheet_id;

  -- Freeze the version snapshot. guard_result_version_mutation() blocks
  -- any later change once published_at is set.
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
    p_sheet_id, v_sheet.current_version_id, auth.uid(), 'principal', 'published', ''
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

-- ---------- function permissions (unchanged surface) ----------
revoke execute on function public.compile_result_sheet(uuid) from anon, public;
grant  execute on function public.compile_result_sheet(uuid) to authenticated;

revoke execute on function public.review_result_sheet(uuid, boolean, text) from anon, public;
grant  execute on function public.review_result_sheet(uuid, boolean, text) to authenticated;

revoke execute on function public.sign_off_result_sheet(uuid, text) from anon, public;
grant  execute on function public.sign_off_result_sheet(uuid, text) to authenticated;

revoke execute on function public.publish_result_sheet(uuid) from anon, public;
grant  execute on function public.publish_result_sheet(uuid) to authenticated;
