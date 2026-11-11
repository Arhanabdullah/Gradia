-- ============================================================
-- GRADIA · Exam paper subject visibility
-- ============================================================
-- A teacher or HOD can view an exam paper row for a class they can see even
-- when they do not teach that particular subject. The subjects RLS policy hid
-- the embedded subject, so the exam schedule UI fell back to the placeholder
-- "Subject" for every paper outside the viewer's own subjects.
--
-- Allow reading subject details when the subject is attached to any exam the
-- user can already view. This keeps the existing role-based rules intact and
-- only extends them to exam schedules the user is allowed to see.

create or replace function public.can_view_subject(p_subject uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when not public.is_active_user() then false
    when public.has_role(array['admin', 'principal']::public.user_role[]) then true
    when exists (
      select 1
      from public.exam_subjects es
      where es.subject_id = p_subject
        and public.can_view_exam(es.exam_id)
    ) then true
    when public.is_hod() then (
      exists (
        select 1
        from public.class_subjects cs
        where cs.subject_id = p_subject and public.is_class_hod(cs.class_id)
      )
      or exists (
        select 1 from public.subjects s
        where s.id = p_subject
          and s.department_id is not null
          and public.is_department_hod(s.department_id)
      )
    )
    when public.is_teacher() then public.is_subject_teacher(p_subject)
    when public.is_student() then exists (
      select 1 from public.class_subjects cs
      where cs.subject_id = p_subject and public.can_view_class(cs.class_id)
    )
    else false
  end;
$$;
