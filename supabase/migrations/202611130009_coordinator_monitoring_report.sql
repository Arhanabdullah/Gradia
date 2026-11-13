-- ============================================================
-- GRADIA · Coordinator monitoring report
-- ============================================================
-- Read-only aggregate used by the coordinator dashboard. Aggregating in
-- SQL keeps the client from downloading every result item and attendance
-- row just to compute averages.
--
-- The function is security definer but starts with require_active_user()
-- and refuses anyone who is not a monitoring role. It only returns
-- aggregates, never row-level student data.
-- ============================================================

create or replace function public.coordinator_monitoring_report(
  p_department text default null,
  p_class_id   uuid default null,
  p_exam_id    uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform public.require_active_user();

  if not public.is_monitor() then
    raise exception 'You do not have permission to view the monitoring report'
      using errcode = 'insufficient_privilege';
  end if;

  with active_students as (
    select p.id, p.class_id
    from public.profiles p
    where p.role = 'student' and p.is_active
  ),
  student_classes as (
    select
      s.id as student_id,
      coalesce(s.class_id, latest.class_id) as class_id
    from active_students s
    left join lateral (
      select en.class_id
      from public.student_enrollments en
      where en.student_id = s.id and en.status = 'active'
      order by en.enrolled_on desc nulls last
      limit 1
    ) latest on true
  ),
  published as (
    select rs.id, rs.class_id, rs.exam_id
    from public.result_sheets rs
    where rs.status = 'published'
      and (p_class_id is null or rs.class_id = p_class_id)
      and (p_exam_id is null or rs.exam_id = p_exam_id)
  ),
  item_rows as (
    select ri.*, ps.class_id, ps.exam_id
    from public.result_items ri
    join published ps on ps.id = ri.sheet_id
  ),
  class_stats as (
    select
      c.id,
      c.name,
      c.academic_year,
      c.semester,
      c.section,
      coalesce(c.department, 'Unassigned') as department,
      (select count(*) from student_classes sc where sc.class_id = c.id) as students,
      (select count(*) from public.class_subjects cs where cs.class_id = c.id) as subject_offerings,
      (
        select round(avg(ir.percentage)::numeric, 2)
        from item_rows ir where ir.class_id = c.id
      ) as average_percentage,
      (
        select round((100.0 * count(*) filter (where ir.is_pass) / nullif(count(*), 0))::numeric, 2)
        from item_rows ir where ir.class_id = c.id
      ) as pass_rate,
      (
        select round((100.0 * sum(a.attended_classes) / nullif(sum(a.total_classes), 0))::numeric, 2)
        from public.attendance a
        join student_classes sc on sc.student_id = a.student_id
        where sc.class_id = c.id
      ) as attendance_percentage
    from public.classes c
    where (p_class_id is null or c.id = p_class_id)
      and (
        p_department is null
        or coalesce(c.department, 'Unassigned') = p_department
      )
  ),
  department_stats as (
    select
      cs.department,
      count(*) as classes,
      sum(cs.students) as students,
      sum(cs.subject_offerings) as subject_offerings,
      round(avg(cs.average_percentage)::numeric, 2) as average_percentage,
      round(avg(cs.pass_rate)::numeric, 2) as pass_rate,
      round(avg(cs.attendance_percentage)::numeric, 2) as attendance_percentage
    from class_stats cs
    group by cs.department
  ),
  subject_stats as (
    select
      s.id,
      s.name,
      s.code,
      coalesce(d.name, 'Unassigned') as department,
      count(ir.id) as entries,
      round(avg(ir.percentage)::numeric, 2) as average_percentage,
      round((100.0 * count(*) filter (where ir.is_pass) / nullif(count(*), 0))::numeric, 2) as pass_rate,
      (
        select round((100.0 * sum(a.attended_classes) / nullif(sum(a.total_classes), 0))::numeric, 2)
        from public.attendance a
        where a.subject_id = s.id
      ) as attendance_percentage
    from public.subjects s
    left join public.departments d on d.id = s.department_id
    left join item_rows ir on ir.subject_id = s.id
    where (
      p_department is null
      or coalesce(d.name, 'Unassigned') = p_department
    )
    group by s.id, s.name, s.code, d.name
  )
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'students', (select count(*) from active_students),
      'teachers', (select count(*) from public.profiles where role = 'teacher' and is_active),
      'classes', (select count(*) from public.classes),
      'subjects', (select count(*) from public.subjects),
      'published_sheets', (select count(*) from published),
      'attendance_records', (select count(*) from public.attendance)
    ),
    'departments', coalesce(
      (select jsonb_agg(to_jsonb(ds) order by ds.department) from department_stats ds),
      '[]'::jsonb
    ),
    'classes', coalesce(
      (select jsonb_agg(to_jsonb(cs) order by cs.name) from class_stats cs),
      '[]'::jsonb
    ),
    'subjects', coalesce(
      (select jsonb_agg(to_jsonb(ss) order by ss.code) from subject_stats ss),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.coordinator_monitoring_report(text, uuid, uuid) from anon, public;
grant  execute on function public.coordinator_monitoring_report(text, uuid, uuid) to authenticated;
