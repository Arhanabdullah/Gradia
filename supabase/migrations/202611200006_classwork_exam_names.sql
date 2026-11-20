-- ============================================================
-- GRADIA - Unique internal exam names for classwork
-- ============================================================
-- Historical migration. 202611200007 supersedes this approach: classwork no
-- longer creates exams at all. Kept for migration history and fresh bootstraps.
--
-- publish_classwork_item previously used only the classwork title as the exam
-- name. exams has UNIQUE (class_id, name), so importing the same title for a
-- second subject in one class failed with exams_class_id_name_key.
--
-- Internal classwork exams now use the kind and subject in the name. If a
-- class still contains an exam with the same generated name, the classwork
-- item's id is appended so every published item gets its own exam. Existing
-- exams, marks, submissions and published results are not renamed or rewritten.

create or replace function public.publish_classwork_item(p_item_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item       public.classwork_items;
  v_class      public.classes;
  v_subject    public.subjects;
  v_exam_id    uuid;
  v_subject_id uuid;
  v_student    record;
  v_exam_type  text;
  v_exam_name  text;
  v_subject_label text;
begin
  perform public.require_active_user();
  select * into v_item from public.classwork_items where id = p_item_id;
  if not found then
    raise exception 'Classwork item not found' using errcode = 'no_data_found';
  end if;

  if not (public.is_admin() or public.is_exam_cell() or public.teaches_class_subject(v_item.class_id, v_item.subject_id)) then
    raise exception 'You can only publish classwork for your own class and subject'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_class from public.classes where id = v_item.class_id;
  if not found then
    raise exception 'Class not found' using errcode = 'no_data_found';
  end if;

  select * into v_subject from public.subjects where id = v_item.subject_id;
  if not found then
    raise exception 'Subject not found' using errcode = 'no_data_found';
  end if;

  v_exam_type := 'assignment';
  v_subject_label := coalesce(nullif(btrim(v_subject.code), ''), v_subject.name, v_item.subject_id::text);
  v_exam_name := format('%s (%s: %s)', v_item.title, initcap(v_item.kind), v_subject_label);

  -- The classwork item id is unique, so it is a safe fallback when a class
  -- already has an exam with the readable name. The loop also covers a legacy
  -- exam that happens to use the fallback name.
  while exists (
    select 1 from public.exams e
    where e.class_id = v_item.class_id and e.name = v_exam_name
  ) loop
    v_exam_name := format('%s [%s]', v_exam_name, v_item.id);
    if exists (
      select 1 from public.exams e
      where e.class_id = v_item.class_id and e.name = v_exam_name
    ) then
      v_exam_name := format('%s [%s]', v_exam_name, gen_random_uuid());
    end if;
  end loop;

  if v_item.exam_id is null then
    insert into public.exams (
      class_id, name, academic_year, exam_type, status,
      starts_on, ends_on, created_by, scope, department_id, course_id, result_kind, instructions
    ) values (
      v_item.class_id,
      v_exam_name,
      v_class.academic_year,
      v_exam_type,
      'open',
      (v_item.deadline at time zone 'utc')::date,
      (v_item.deadline at time zone 'utc')::date,
      v_item.teacher_id,
      'class',
      (select c.department_id from public.courses c where c.id = v_class.course_id),
      v_class.course_id,
      'internal',
      v_item.instructions
    ) returning id into v_exam_id;

    insert into public.exam_subjects (
      exam_id, subject_id, teacher_id, max_marks, pass_marks, instructions
    ) values (
      v_exam_id, v_item.subject_id, v_item.teacher_id, v_item.max_marks,
      round(v_item.max_marks * 0.4, 2), v_item.instructions
    ) returning id into v_subject_id;
  else
    v_exam_id := v_item.exam_id;
    v_subject_id := v_item.exam_subject_id;
  end if;

  update public.classwork_items
  set published = true,
      published_at = coalesce(published_at, now()),
      exam_id = v_exam_id,
      exam_subject_id = v_subject_id
  where id = v_item.id;

  for v_student in
    select p.id
    from public.profiles p
    where p.role = 'student'
      and p.is_active
      and p.class_id = v_item.class_id
  loop
    insert into public.notifications (user_id, title, body, type, link, payload)
    values (
      v_student.id,
      format('New %s: %s', v_item.kind, v_item.title),
      case
        when v_item.deadline is null then format('%s has been published.', v_item.title)
        else format('%s is due %s.', v_item.title, to_char(v_item.deadline, 'DD Mon YYYY, HH24:MI'))
      end,
      'classwork',
      '/app/classwork',
      jsonb_build_object('item_id', v_item.id, 'kind', v_item.kind, 'deadline', v_item.deadline)
    );
  end loop;

  return v_item.id;
end;
$$;

insert into supabase_migrations.schema_migrations (version, statements, name)
values ('202611200006', null, '202611200006_classwork_exam_names.sql')
on conflict (version) do nothing;
