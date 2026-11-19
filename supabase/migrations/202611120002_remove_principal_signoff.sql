-- ============================================================
-- GRADIA · Publish directly after HOD approval
-- ============================================================
-- The principal sign-off step is removed from the result workflow.
-- Admin compiles the sheet, the HOD approves it, and it becomes publishable
-- immediately. Existing sheets already in 'principal_signed' remain
-- publishable so no in-flight work is lost.

-- ---------- 1. principal sign-off is no longer part of the workflow ----------
create or replace function public.sign_off_result_sheet(
  p_sheet_id uuid,
  p_remarks  text default ''
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Principal sign-off is no longer required. Publish the HOD-approved sheet directly.'
    using errcode = 'check_violation';
end;
$$;

revoke execute on function public.sign_off_result_sheet(uuid, text) from anon, public, authenticated;

-- ---------- 2. publish an HOD-approved sheet directly ----------
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

  if v_sheet.status not in ('hod_approved', 'principal_signed') then
    raise exception 'This sheet has not been approved by the HOD yet'
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

-- create or replace keeps the existing execute grants; keep the surface
-- explicit so a future rebuild cannot accidentally widen it.
revoke execute on function public.publish_result_sheet(uuid) from anon, public;
grant  execute on function public.publish_result_sheet(uuid) to authenticated;
