-- ============================================================
-- GRADIA — Supabase schema. Run this ONCE in the SQL Editor.
-- ============================================================
-- Bootstrap order:
--   1. Run this whole file.
--   2. Dashboard → Authentication → Users → "Add user"
--      (your email + a password, leave "Auto Confirm User" on).
--   3. Uncomment and run the last block to make yourself admin.
-- ============================================================

-- ---------- ENUMS (tolerant of a previous partial run) ----------
do $$ begin
  create type public.user_role as enum (
    'student', 'teacher', 'hod', 'principal', 'admin'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.sheet_status as enum (
    'draft',
    'compiled',
    'hod_approved',
    'hod_rejected',
    'principal_signed',
    'published'
  );
exception when duplicate_object then null; end $$;

-- ---------- CLASSES ----------
create table if not exists public.classes (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,            -- e.g. "CSE - Semester 3"
  department text not null,            -- e.g. "CSE"
  hod_id     uuid,
  created_at timestamptz not null default now()
);

-- ---------- PROFILES (one row per auth.users) ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text unique not null,
  name       text not null default '',
  email      text not null,
  role       public.user_role not null default 'student',
  department text,
  class_id   uuid,                     -- students only
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

do $$ begin
  alter table public.classes
    add constraint classes_hod_fkey
    foreign key (hod_id) references public.profiles(id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.profiles
    add constraint profiles_class_fkey
    foreign key (class_id) references public.classes(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------- SUBJECTS ----------
create table if not exists public.subjects (
  id         uuid primary key default gen_random_uuid(),
  class_id   uuid not null references public.classes(id) on delete cascade,
  name       text not null,            -- e.g. "Data Structures"
  code       text not null,            -- e.g. "CS201"
  teacher_id uuid references public.profiles(id) on delete set null,
  max_marks  int not null default 100,
  created_at timestamptz not null default now()
);

-- ---------- EXAMS ----------
create table if not exists public.exams (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references public.classes(id) on delete cascade,
  name          text not null,            -- e.g. "Midterm 2025"
  academic_year text,                     -- e.g. "2025-26" (academic session)
  created_at    timestamptz not null default now(),
  unique (class_id, name)
);

-- older databases: add the session column without touching existing rows
alter table public.exams add column if not exists academic_year text;

-- ---------- MARKS (raw entries by teachers) ----------
create table if not exists public.marks (
  id             uuid primary key default gen_random_uuid(),
  exam_id        uuid not null references public.exams(id) on delete cascade,
  subject_id     uuid not null references public.subjects(id) on delete cascade,
  student_id     uuid not null references public.profiles(id) on delete cascade,
  marks_obtained numeric not null,
  entered_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (exam_id, subject_id, student_id)
);

-- ---------- RESULT SHEETS (the approval workflow) ----------
create table if not exists public.result_sheets (
  id                  uuid primary key default gen_random_uuid(),
  exam_id             uuid not null references public.exams(id) on delete cascade,
  class_id            uuid not null references public.classes(id) on delete cascade,
  status              public.sheet_status not null default 'draft',
  compiled_by         uuid references public.profiles(id) on delete set null,
  hod_reviewed_by     uuid references public.profiles(id) on delete set null,
  hod_remarks         text default '',
  principal_signed_by uuid references public.profiles(id) on delete set null,
  principal_remarks   text default '',
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (exam_id, class_id)
);

-- ---------- RESULT ITEMS (snapshot per student x subject) ----------
create table if not exists public.result_items (
  id             uuid primary key default gen_random_uuid(),
  sheet_id       uuid not null references public.result_sheets(id) on delete cascade,
  student_id     uuid not null references public.profiles(id) on delete cascade,
  subject_id     uuid not null references public.subjects(id) on delete cascade,
  marks_obtained numeric not null,
  max_marks      numeric not null default 100,
  unique (sheet_id, student_id, subject_id)
);

-- ---------- NOTIFICATIONS (in-app only) ----------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  title      text not null,
  body       text not null default '',
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================
-- AUTO-CREATE PROFILE WHEN AN AUTH USER IS CREATED
-- (works for dashboard-created and edge-function-created users;
--  extra fields like name/role/class come from user_metadata)
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, name, email, role, department, class_id)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'username', ''),
      'user_' || substr(replace(new.id::text, '-', ''), 1, 8)
    ),
    coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1)),
    new.email,
    coalesce(
      (nullif(new.raw_user_meta_data->>'role', ''))::public.user_role,
      'student'
    ),
    nullif(new.raw_user_meta_data->>'department', ''),
    (nullif(new.raw_user_meta_data->>'class_id', ''))::uuid
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- SECURITY-DEFINER HELPERS (avoid RLS recursion)
-- ============================================================
create or replace function public.app_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (
  select 1 from public.profiles where id = auth.uid() and role = 'admin'
) $$;

create or replace function public.is_class_hod(p_class uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (
  select 1
  from public.classes c
  join public.profiles p on p.id = c.hod_id
  where c.id = p_class and p.id = auth.uid()
) $$;

create or replace function public.is_subject_teacher(p_subject uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (
  select 1 from public.subjects where id = p_subject and teacher_id = auth.uid()
) $$;

create or replace function public.is_sheet_hod(p_sheet uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (
  select 1
  from public.result_sheets s
  join public.classes c on c.id = s.class_id
  where s.id = p_sheet and c.hod_id = auth.uid()
) $$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles       enable row level security;
alter table public.classes        enable row level security;
alter table public.subjects       enable row level security;
alter table public.exams          enable row level security;
alter table public.marks          enable row level security;
alter table public.result_sheets  enable row level security;
alter table public.result_items   enable row level security;
alter table public.notifications  enable row level security;

-- drop any policies from a previous run so this file stays re-runnable
drop policy if exists "authenticated read profiles" on public.profiles;
drop policy if exists "admin insert profiles" on public.profiles;
drop policy if exists "admin update profiles" on public.profiles;
drop policy if exists "admin delete profiles" on public.profiles;
drop policy if exists "authenticated read classes" on public.classes;
drop policy if exists "admin write classes" on public.classes;
drop policy if exists "authenticated read subjects" on public.subjects;
drop policy if exists "admin write subjects" on public.subjects;
drop policy if exists "authenticated read exams" on public.exams;
drop policy if exists "admin write exams" on public.exams;
drop policy if exists "teacher/admin/hod read marks" on public.marks;
drop policy if exists "teacher/admin write marks" on public.marks;
drop policy if exists "role-based read sheets" on public.result_sheets;
drop policy if exists "admin delete sheets" on public.result_sheets;
drop policy if exists "role-based read items" on public.result_items;
drop policy if exists "read own notifications" on public.notifications;
drop policy if exists "update own notifications" on public.notifications;
drop policy if exists "delete own notifications" on public.notifications;

-- profiles: everyone logged-in can read names; writes are admin-only
create policy "authenticated read profiles"
  on public.profiles for select to authenticated using (true);
create policy "admin insert profiles"
  on public.profiles for insert to authenticated with check (is_admin());
create policy "admin update profiles"
  on public.profiles for update to authenticated using (is_admin());
create policy "admin delete profiles"
  on public.profiles for delete to authenticated using (is_admin());

-- classes / subjects / exams: read by all logged-in, write by admin
create policy "authenticated read classes"
  on public.classes for select to authenticated using (true);
create policy "admin write classes"
  on public.classes for all to authenticated
  using (is_admin()) with check (is_admin());

create policy "authenticated read subjects"
  on public.subjects for select to authenticated using (true);
create policy "admin write subjects"
  on public.subjects for all to authenticated
  using (is_admin()) with check (is_admin());

create policy "authenticated read exams"
  on public.exams for select to authenticated using (true);
create policy "admin write exams"
  on public.exams for all to authenticated
  using (is_admin()) with check (is_admin());

-- marks: teachers see/write marks for THEIR subjects; admin + that class's
-- HOD can read; students never see raw marks (only published results)
create policy "teacher/admin/hod read marks"
  on public.marks for select to authenticated using (
    is_admin()
    or is_subject_teacher(subject_id)
    or (exists (
      select 1 from public.exams e
      where e.id = exam_id and is_class_hod(e.class_id)
    ))
    or entered_by = auth.uid()
  );
create policy "teacher/admin write marks"
  on public.marks for all to authenticated using (
    is_admin()
    or (is_subject_teacher(subject_id) and entered_by = auth.uid())
  ) with check (
    is_admin()
    or (is_subject_teacher(subject_id) and entered_by = auth.uid())
  );

-- result sheets: admin, that class's HOD, principal, and students can read
-- a published sheet of their own class; no client writes (RPC only)
create policy "role-based read sheets"
  on public.result_sheets for select to authenticated using (
    is_admin()
    or app_role() = 'principal'
    or (app_role() = 'hod' and is_class_hod(class_id))
    or (
      app_role() = 'student'
      and status = 'published'
      and class_id = (select class_id from public.profiles where id = auth.uid())
    )
  );
create policy "admin delete sheets"
  on public.result_sheets for delete to authenticated using (is_admin());

-- result items follow their sheet's visibility
create policy "role-based read items"
  on public.result_items for select to authenticated using (
    is_admin()
    or exists (
      select 1 from public.result_sheets s
      where s.id = sheet_id
        and (
          app_role() = 'principal'
          or app_role() = 'hod' and is_sheet_hod(s.id)
          or (
            app_role() = 'student'
            and s.status = 'published'
            and student_id = auth.uid()
          )
        )
    )
  );

-- notifications: only your own
create policy "read own notifications"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy "update own notifications"
  on public.notifications for update to authenticated
  using (user_id = auth.uid());
create policy "delete own notifications"
  on public.notifications for delete to authenticated
  using (user_id = auth.uid());

-- ============================================================
-- WORKFLOW RPCs (enforce: admin compiles, HOD reviews, principal signs & publishes)
-- ============================================================

-- Admin: compile marks of an exam into a result sheet (snapshot).
create or replace function public.compile_result_sheet(p_exam_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_exam  public.exams%rowtype;
  v_sheet uuid;
  v_students int;
begin
  if not is_admin() then
    raise exception 'Only admins can compile result sheets';
  end if;

  select * into v_exam from public.exams where id = p_exam_id;
  if not found then raise exception 'Exam not found'; end if;

  if exists (select 1 from public.result_sheets where exam_id = p_exam_id) then
    raise exception 'A result sheet already exists for this exam';
  end if;

  select count(*) into v_students
  from public.profiles
  where class_id = v_exam.class_id and role = 'student' and is_active;

  if v_students = 0 then
    raise exception 'No active students found in this class';
  end if;

  insert into public.result_sheets (exam_id, class_id, status, compiled_by)
  values (p_exam_id, v_exam.class_id, 'compiled', auth.uid())
  returning id into v_sheet;

  insert into public.result_items
    (sheet_id, student_id, subject_id, marks_obtained, max_marks)
  select
    v_sheet, m.student_id, m.subject_id, m.marks_obtained, s.max_marks
  from public.marks m
  join public.subjects s on s.id = m.subject_id
  where m.exam_id = p_exam_id;

  return v_sheet;
end;
$$;

-- HOD: approve or reject a compiled sheet.
create or replace function public.review_result_sheet(
  p_sheet_id uuid,
  p_approve  boolean,
  p_remarks  text default ''
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_sheet public.result_sheets%rowtype;
begin
  select * into v_sheet from public.result_sheets where id = p_sheet_id;
  if not found then raise exception 'Result sheet not found'; end if;

  if not is_sheet_hod(p_sheet_id) then
    raise exception 'Only the HOD of this class can review this sheet';
  end if;

  if v_sheet.status <> 'compiled' then
    raise exception 'This sheet is not awaiting HOD review';
  end if;

  update public.result_sheets
  set status = (case when p_approve then 'hod_approved' else 'hod_rejected' end)::public.sheet_status,
      hod_reviewed_by = auth.uid(),
      hod_remarks = p_remarks,
      updated_at = now()
  where id = p_sheet_id;
end;
$$;

-- Principal: sign off an HOD-approved sheet.
create or replace function public.sign_off_result_sheet(
  p_sheet_id uuid,
  p_remarks  text default ''
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_sheet public.result_sheets%rowtype;
begin
  if app_role() <> 'principal' then
    raise exception 'Only the principal can sign off result sheets';
  end if;

  select * into v_sheet from public.result_sheets where id = p_sheet_id;
  if not found then raise exception 'Result sheet not found'; end if;

  if v_sheet.status <> 'hod_approved' then
    raise exception 'This sheet has not been approved by the HOD yet';
  end if;

  update public.result_sheets
  set status = 'principal_signed',
      principal_signed_by = auth.uid(),
      principal_remarks = p_remarks,
      updated_at = now()
  where id = p_sheet_id;
end;
$$;

-- Principal: publish a signed-off sheet → notifies every student in the class.
create or replace function public.publish_result_sheet(p_sheet_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_sheet public.result_sheets%rowtype;
  v_exam_name text;
begin
  if app_role() <> 'principal' then
    raise exception 'Only the principal can publish results';
  end if;

  select * into v_sheet from public.result_sheets where id = p_sheet_id;
  if not found then raise exception 'Result sheet not found'; end if;

  select e.name into v_exam_name from public.exams e where e.id = v_sheet.exam_id;

  if v_sheet.status <> 'principal_signed' then
    raise exception 'This sheet has not been signed off by the principal yet';
  end if;

  update public.result_sheets
  set status = 'published', published_at = now(), updated_at = now()
  where id = p_sheet_id;

  insert into public.notifications (user_id, title, body)
  select p.id,
         'Results published',
         'Results for "' || v_exam_name || '" are now available on your dashboard.'
  from public.profiles p
  where p.class_id = v_sheet.class_id
    and p.role = 'student'
    and p.is_active;
end;
$$;

-- ============================================================
-- FUNCTION PERMISSIONS (anon key can't call the RPCs)
-- ============================================================
revoke execute
  on function public.compile_result_sheet(uuid)
  from anon, public;
grant execute
  on function public.compile_result_sheet(uuid)
  to authenticated;

revoke execute
  on function public.review_result_sheet(uuid, boolean, text)
  from anon, public;
grant execute
  on function public.review_result_sheet(uuid, boolean, text)
  to authenticated;

revoke execute
  on function public.sign_off_result_sheet(uuid, text)
  from anon, public;
grant execute
  on function public.sign_off_result_sheet(uuid, text)
  to authenticated;

revoke execute
  on function public.publish_result_sheet(uuid)
  from anon, public;
grant execute
  on function public.publish_result_sheet(uuid)
  to authenticated;

-- ============================================================
-- BOOTSTRAP: make the user you created in the dashboard an admin.
-- Uncomment, fill your email, and run.
-- ============================================================
-- update public.profiles
-- set role = 'admin'
-- where email = 'your-email@example.com';
