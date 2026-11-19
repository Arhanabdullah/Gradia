-- ============================================================
-- GRADIA · Component-aware marks submission
-- ============================================================
-- Additive replacement of submit_exam_marks. The old check compared a raw
-- mark-row count with the class size, which stops being meaningful once a
-- subject has several assessment components (IA, Quiz, Assignment, ESA).
--
-- New rule: every active student needs a row for every non-optional
-- component of the exam subject. Legacy examinations still have a single
-- "Overall" component, so their behaviour is unchanged.
--
-- The active-student count now matches the marks screen: a student is in
-- scope through profiles.class_id or an active student_enrollments row.
-- ============================================================

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
    and not ac.is_optional;

  if coalesce(v_required, 0) = 0 then
    -- No required component configured: fall back to one slot per student.
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
      and not ac.is_optional;
  end if;

  if coalesce(v_entered, 0) = 0 then
    raise exception 'Enter at least one mark before submitting' using errcode = 'check_violation';
  end if;

  if v_entered < v_students * v_required then
    raise exception 'Marks are missing for % student/component slot(s)',
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

revoke execute on function public.submit_exam_marks(uuid, uuid) from anon, public;
grant  execute on function public.submit_exam_marks(uuid, uuid) to authenticated;
