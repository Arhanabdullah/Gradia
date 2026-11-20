-- ============================================================
-- GRADIA - Classwork: assignments and projects
-- ============================================================
-- Historical migration. 202611200007 supersedes the exam creation below:
-- publishing classwork no longer creates an exam or exam_subjects row.
--
-- Assignments and projects are not examinations. They have a deadline, not a
-- date, room or invigilator. This migration gives them their own tables and
-- workflow while keeping marks in the existing `marks` table, so Marks Entry and
-- Result Management keep working unchanged.
--
-- Each classwork item owns one internal `exams` row and one `exam_subjects` row
-- when it is published. That is what lets a teacher open Marks Entry, pick the
-- classwork item by name and enter marks for the class. The item itself only
-- tracks the brief and the submissions.
--
-- Nothing here is applied automatically. Review and run it with
--   npx supabase db push --remote
-- or paste it into the SQL editor after checking the project.

create table if not exists public.classwork_items (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'assignment'
                  check (kind in ('assignment', 'project')),
  class_id        uuid not null references public.classes(id) on delete cascade,
  subject_id      uuid not null references public.subjects(id) on delete cascade,
  teacher_id      uuid references public.profiles(id) on delete set null,
  title           text not null check (length(btrim(title)) > 0),
  description     text not null default '',
  instructions    text not null default '',
  max_marks       numeric(6,2) not null default 100 check (max_marks > 0),
  deadline        timestamptz,
  -- Created on publish. Null while the item is still a draft.
  exam_id         uuid references public.exams(id) on delete set null,
  exam_subject_id uuid references public.exam_subjects(id) on delete set null,
  published       boolean not null default false,
  published_at    timestamptz,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists classwork_items_class_idx
  on public.classwork_items (class_id, subject_id, deadline desc);
create index if not exists classwork_items_teacher_idx
  on public.classwork_items (teacher_id, created_at desc);
create index if not exists classwork_items_published_idx
  on public.classwork_items (class_id, published, deadline)
  where published;

create table if not exists public.classwork_submissions (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references public.classwork_items(id) on delete cascade,
  student_id   uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'submitted'
               check (status in ('draft', 'submitted', 'returned', 'graded')),
  answer       text not null default '',
  file_url     text,
  submitted_at timestamptz,
  feedback     text not null default '',
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (item_id, student_id)
);

create index if not exists classwork_submissions_item_idx
  on public.classwork_submissions (item_id, status);
create index if not exists classwork_submissions_student_idx
  on public.classwork_submissions (student_id, created_at desc);

drop trigger if exists set_updated_at on public.classwork_items;
create trigger set_updated_at
  before update on public.classwork_items
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.classwork_submissions;
create trigger set_updated_at
  before update on public.classwork_submissions
  for each row execute function public.set_updated_at();

-- ============================================================
-- RLS
-- ============================================================
alter table public.classwork_items      enable row level security;
alter table public.classwork_submissions enable row level security;

drop policy if exists "read classwork items" on public.classwork_items;
create policy "read classwork items"
on public.classwork_items for select to authenticated
using (
  public.is_admin()
  or public.is_exam_cell()
  or public.teaches_class_subject(class_id, subject_id)
  or public.is_class_hod(class_id)
  or (
    published
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'student' and p.class_id = classwork_items.class_id
    )
  )
);

drop policy if exists "teachers write classwork items" on public.classwork_items;
create policy "teachers write classwork items"
on public.classwork_items for all to authenticated
using (public.is_admin() or public.is_exam_cell() or public.teaches_class_subject(class_id, subject_id))
with check (public.is_admin() or public.is_exam_cell() or public.teaches_class_subject(class_id, subject_id));

drop policy if exists "read classwork submissions" on public.classwork_submissions;
create policy "read classwork submissions"
on public.classwork_submissions for select to authenticated
using (
  student_id = auth.uid()
  or exists (
    select 1 from public.classwork_items i
    where i.id = classwork_submissions.item_id
      and (
        public.is_admin()
        or public.is_exam_cell()
        or public.teaches_class_subject(i.class_id, i.subject_id)
        or public.is_class_hod(i.class_id)
      )
  )
);

drop policy if exists "students write own submissions" on public.classwork_submissions;
create policy "students write own submissions"
on public.classwork_submissions for insert to authenticated
with check (
  student_id = auth.uid()
  and exists (
    select 1 from public.classwork_items i
    where i.id = classwork_submissions.item_id and i.published
  )
);

drop policy if exists "students update own submissions" on public.classwork_submissions;
create policy "students update own submissions"
on public.classwork_submissions for update to authenticated
using (student_id = auth.uid())
with check (student_id = auth.uid());

drop policy if exists "teachers review submissions" on public.classwork_submissions;
create policy "teachers review submissions"
on public.classwork_submissions for update to authenticated
using (
  exists (
    select 1 from public.classwork_items i
    where i.id = classwork_submissions.item_id
      and (public.is_admin() or public.is_exam_cell() or public.teaches_class_subject(i.class_id, i.subject_id))
  )
)
with check (
  exists (
    select 1 from public.classwork_items i
    where i.id = classwork_submissions.item_id
      and (public.is_admin() or public.is_exam_cell() or public.teaches_class_subject(i.class_id, i.subject_id))
  )
);

-- ============================================================
-- Publish: create the internal exam shell and notify the class
-- ============================================================
create or replace function public.publish_classwork_item(p_item_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item    public.classwork_items;
  v_class   public.classes;
  v_exam_id uuid;
  v_subject_id uuid;
  v_student record;
  v_exam_type text;
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

  v_exam_type := 'assignment';

  if v_item.exam_id is null then
    insert into public.exams (
      class_id, name, academic_year, exam_type, status,
      starts_on, ends_on, created_by, scope, department_id, course_id, result_kind, instructions
    ) values (
      v_item.class_id,
      v_item.title,
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

-- ============================================================
-- Student submission
-- ============================================================
create or replace function public.submit_classwork(
  p_item_id uuid,
  p_answer text default null,
  p_file_url text default null,
  p_draft boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.classwork_items;
  v_id uuid;
  v_status text;
begin
  perform public.require_active_user();
  select * into v_item from public.classwork_items where id = p_item_id and published;
  if not found then
    raise exception 'This classwork is not available for submission' using errcode = 'no_data_found';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'student' and p.class_id = v_item.class_id
  ) then
    raise exception 'Only students in this class can submit' using errcode = 'insufficient_privilege';
  end if;

  -- The deadline closes the item, but a submission the teacher returned stays
  -- open so the student can revise and resubmit it.
  if v_item.deadline is not null and now() > v_item.deadline and not p_draft
     and not exists (
       select 1 from public.classwork_submissions s
       where s.item_id = v_item.id
         and s.student_id = auth.uid()
         and s.status = 'returned'
     ) then
    raise exception 'The deadline has passed. Contact your teacher if you still need to submit.'
      using errcode = 'check_violation';
  end if;

  v_status := case when p_draft then 'draft' else 'submitted' end;

  insert into public.classwork_submissions (item_id, student_id, status, answer, file_url, submitted_at)
  values (
    p_item_id, auth.uid(), v_status,
    coalesce(p_answer, ''), nullif(p_file_url, ''),
    case when p_draft then null else now() end
  )
  on conflict (item_id, student_id) do update
    set status = excluded.status,
        answer = excluded.answer,
        file_url = coalesce(excluded.file_url, public.classwork_submissions.file_url),
        submitted_at = coalesce(excluded.submitted_at, public.classwork_submissions.submitted_at),
        feedback = case when excluded.status = 'submitted' then '' else public.classwork_submissions.feedback end,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- ============================================================
-- Teacher review (marks stay in public.marks, entered in Marks Entry)
-- ============================================================
create or replace function public.review_classwork_submission(
  p_submission_id uuid,
  p_status text,
  p_feedback text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.classwork_submissions;
  v_item public.classwork_items;
begin
  perform public.require_active_user();
  if p_status not in ('submitted', 'returned', 'graded') then
    raise exception 'Unknown review status' using errcode = 'check_violation';
  end if;

  select * into v_row from public.classwork_submissions where id = p_submission_id;
  if not found then
    raise exception 'Submission not found' using errcode = 'no_data_found';
  end if;
  select * into v_item from public.classwork_items where id = v_row.item_id;

  if not (public.is_admin() or public.is_exam_cell() or public.teaches_class_subject(v_item.class_id, v_item.subject_id)) then
    raise exception 'You can only review submissions for your own class and subject'
      using errcode = 'insufficient_privilege';
  end if;

  update public.classwork_submissions
  set status = p_status,
      feedback = coalesce(p_feedback, feedback),
      reviewed_at = now()
  where id = p_submission_id;

  insert into public.notifications (user_id, title, body, type, link, payload)
  values (
    v_row.student_id,
    case when p_status = 'returned' then 'Classwork returned' else 'Classwork reviewed' end,
    format('%s: %s', v_item.title, coalesce(nullif(p_feedback, ''), 'Open the classwork page for details.')),
    'classwork',
    '/app/classwork',
    jsonb_build_object('item_id', v_item.id, 'status', p_status)
  );

  return p_submission_id;
end;
$$;

-- ============================================================
-- Approaching deadlines
-- ============================================================
-- Call from a daily cron job (pg_cron) or the Exam Cell dashboard:
--   select public.notify_classwork_deadlines();
-- It notifies only students who have not submitted yet, once per item per day.
create or replace function public.notify_classwork_deadlines()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.classwork_items;
  v_student record;
  v_count integer := 0;
begin
  if auth.uid() is not null then
    perform public.require_active_user();
  end if;

  for v_item in
    select * from public.classwork_items
    where published
      and deadline is not null
      and deadline between now() and now() + interval '48 hours'
  loop
    for v_student in
      select p.id
      from public.profiles p
      where p.role = 'student'
        and p.is_active
        and p.class_id = v_item.class_id
        and not exists (
          select 1 from public.classwork_submissions s
          where s.item_id = v_item.id
            and s.student_id = p.id
            and s.status in ('submitted', 'graded')
        )
        and not exists (
          select 1 from public.notifications n
          where n.user_id = p.id
            and n.type = 'classwork_deadline'
            and n.payload->>'item_id' = v_item.id::text
            and n.created_at > now() - interval '20 hours'
        )
    loop
      insert into public.notifications (user_id, title, body, type, link, payload)
      values (
        v_student.id,
        'Classwork deadline approaching',
        format('%s is due %s.', v_item.title, to_char(v_item.deadline, 'DD Mon YYYY, HH24:MI')),
        'classwork_deadline',
        '/app/classwork',
        jsonb_build_object('item_id', v_item.id, 'deadline', v_item.deadline)
      );
      v_count := v_count + 1;
    end loop;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.publish_classwork_item(uuid) to authenticated;
grant execute on function public.submit_classwork(uuid, text, text, boolean) to authenticated;
grant execute on function public.review_classwork_submission(uuid, text, text) to authenticated;
grant execute on function public.notify_classwork_deadlines() to authenticated;
