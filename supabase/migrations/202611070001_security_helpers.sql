-- ============================================================
-- GRADIA · Phase 3 · Security helpers and indexes
-- ============================================================
-- Every helper is SECURITY DEFINER with a pinned search_path. Policies
-- call these helpers instead of sub-querying RLS-protected tables, which
-- removes recursion risk and keeps the policy expressions readable.
--
-- Deactivation is enforced here: every helper requires the caller to be
-- an ACTIVE profile. A deactivated account keeps a valid JWT but every
-- policy evaluates to false and every guarded RPC refuses to run.
--
-- Roles: student | teacher | hod | principal | admin (unchanged).
-- ============================================================

-- ---------- identity / role helpers ----------
create or replace function public.is_active_user()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
  );
$$;

-- Role is only returned for an active account, so a deactivated user has
-- no role at all from the database's point of view.
create or replace function public.app_role()
returns public.user_role
language sql stable security definer set search_path = public, pg_temp
as $$
  select role from public.profiles
  where id = auth.uid() and is_active;
$$;

create or replace function public.has_role(p_roles public.user_role[])
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and role = any (p_roles)
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.has_role(array['admin']::public.user_role[]);
$$;

create or replace function public.is_principal()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.has_role(array['principal']::public.user_role[]);
$$;

create or replace function public.is_hod()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.has_role(array['hod']::public.user_role[]);
$$;

create or replace function public.is_teacher()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.has_role(array['teacher']::public.user_role[]);
$$;

create or replace function public.is_student()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.has_role(array['student']::public.user_role[]);
$$;

-- ---------- academic scope: teaching ----------
create or replace function public.teaches_class(p_class uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_active_user()
    and exists (
      select 1 from public.teacher_assignments ta
      where ta.class_id = p_class and ta.teacher_id = auth.uid()
    );
$$;

create or replace function public.teaches_class_subject(p_class uuid, p_subject uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_active_user()
    and (
      exists (
        select 1
        from public.teacher_assignments ta
        join public.class_subjects cs on cs.id = ta.class_subject_id
        where cs.class_id = p_class
          and cs.subject_id = p_subject
          and ta.teacher_id = auth.uid()
      )
      or exists (
        -- legacy rows created before class_subject_id existed
        select 1 from public.teacher_assignments ta
        where ta.class_id = p_class
          and ta.subject_id = p_subject
          and ta.teacher_id = auth.uid()
      )
    );
$$;

create or replace function public.teaches_exam_subject(p_exam uuid, p_subject uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.exams e
    where e.id = p_exam
      and public.teaches_class_subject(e.class_id, p_subject)
  );
$$;

-- Authoritative replacement for the legacy subjects.teacher_id check.
create or replace function public.is_subject_teacher(p_subject uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_active_user()
    and exists (
      select 1 from public.teacher_assignments ta
      where ta.subject_id = p_subject and ta.teacher_id = auth.uid()
    );
$$;

-- ---------- academic scope: HOD ----------
create or replace function public.is_class_hod(p_class uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_hod()
    and (
      exists (
        select 1 from public.class_hod_assignments a
        where a.class_id = p_class and a.hod_id = auth.uid()
      )
      or exists (
        select 1 from public.department_hod_assignments d
        where d.hod_id = auth.uid() and d.department_id is not null
          and d.department_id = (
            select co.department_id
            from public.classes c
            join public.courses co on co.id = c.course_id
            where c.id = p_class
          )
      )
      or exists (
        -- legacy pointer retained for existing data
        select 1 from public.classes c
        where c.id = p_class and c.hod_id = auth.uid()
      )
    );
$$;

create or replace function public.is_department_hod(p_department uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_hod()
    and exists (
      select 1 from public.department_hod_assignments d
      where d.department_id = p_department and d.hod_id = auth.uid()
    );
$$;

create or replace function public.is_exam_hod(p_exam uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.exams e
    where e.id = p_exam and public.is_class_hod(e.class_id)
  );
$$;

create or replace function public.is_sheet_hod(p_sheet uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.result_sheets s
    where s.id = p_sheet and public.is_class_hod(s.class_id)
  );
$$;

-- ---------- visibility: class / subject / exam ----------
create or replace function public.can_view_class(p_class uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when not public.is_active_user() then false
    when public.has_role(array['admin', 'principal']::public.user_role[]) then true
    when public.is_hod() then public.is_class_hod(p_class)
    when public.is_teacher() then public.teaches_class(p_class)
    when public.is_student() then (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.class_id = p_class
      )
      or exists (
        select 1 from public.student_enrollments en
        where en.student_id = auth.uid()
          and en.class_id = p_class
          and en.status = 'active'
      )
    )
    else false
  end;
$$;

create or replace function public.can_view_subject(p_subject uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when not public.is_active_user() then false
    when public.has_role(array['admin', 'principal']::public.user_role[]) then true
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

create or replace function public.can_view_exam(p_exam uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when not public.is_active_user() then false
    when public.has_role(array['admin', 'principal']::public.user_role[]) then true
    else exists (
      select 1 from public.exams e
      where e.id = p_exam and public.can_view_class(e.class_id)
    )
  end;
$$;

create or replace function public.can_view_exam_subject(p_exam_subject uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.exam_subjects es
    where es.id = p_exam_subject and public.can_view_exam(es.exam_id)
  );
$$;

-- ---------- visibility: results ----------
create or replace function public.exam_results_published(p_exam uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.result_sheets s
    where s.exam_id = p_exam and s.status = 'published'
  );
$$;

create or replace function public.is_published_sheet(p_sheet uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.result_sheets s
    where s.id = p_sheet and s.status = 'published'
  );
$$;

create or replace function public.is_published_version(p_version uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.result_sheet_versions v
    where v.id = p_version and v.published_at is not null
  );
$$;

create or replace function public.can_view_sheet(p_sheet uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when not public.is_active_user() then false
    when public.has_role(array['admin', 'principal']::public.user_role[]) then true
    when public.is_hod() then public.is_sheet_hod(p_sheet)
    when public.is_student() then exists (
      select 1
      from public.result_sheets s
      where s.id = p_sheet
        and s.status = 'published'
        and (
          s.class_id = (select p.class_id from public.profiles p where p.id = auth.uid())
          or exists (
            select 1 from public.student_enrollments en
            where en.student_id = auth.uid()
              and en.class_id = s.class_id
              and en.status = 'active'
          )
        )
    )
    else false
  end;
$$;

create or replace function public.can_view_result_item(p_item uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.result_items ri
    where ri.id = p_item
      and public.can_view_sheet(ri.sheet_id)
      and (
        public.has_role(array['admin', 'principal', 'hod']::public.user_role[])
        or ri.student_id = auth.uid()
      )
  );
$$;

create or replace function public.can_view_component_item(p_component_item uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.result_component_items rci
    join public.result_items ri on ri.id = rci.result_item_id
    where rci.id = p_component_item
      and public.can_view_sheet(ri.sheet_id)
      and (
        public.has_role(array['admin', 'principal', 'hod']::public.user_role[])
        or ri.student_id = auth.uid()
      )
  );
$$;

-- ---------- visibility: profiles ----------
-- Directory-style scope: self, admin, principal, the HOD's classes and
-- department, and a teacher's own students. Nobody else.
create or replace function public.can_view_profile(p_profile uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when not public.is_active_user() then false
    when p_profile = auth.uid() then true
    when public.has_role(array['admin', 'principal']::public.user_role[]) then true
    when public.is_hod() then (
      exists (
        select 1
        from public.profiles p
        join public.classes c on c.id = p.class_id
        where p.id = p_profile and public.is_class_hod(c.id)
      )
      or exists (
        select 1 from public.teacher_assignments ta
        where ta.teacher_id = p_profile and public.is_class_hod(ta.class_id)
      )
      or exists (
        select 1 from public.profiles p
        where p.id = p_profile
          and p.department_id is not null
          and public.is_department_hod(p.department_id)
      )
    )
    when public.is_teacher() then (
      exists (
        select 1
        from public.profiles s
        join public.teacher_assignments ta on ta.class_id = s.class_id
        where s.id = p_profile and ta.teacher_id = auth.uid()
      )
      or exists (
        select 1
        from public.student_enrollments en
        join public.teacher_assignments ta on ta.class_id = en.class_id
        where en.student_id = p_profile
          and ta.teacher_id = auth.uid()
          and en.status = 'active'
      )
    )
    else false
  end;
$$;

-- ---------- guards used by RPCs ----------
create or replace function public.require_active_user()
returns void
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.profiles where id = auth.uid() and is_active
  ) then
    raise exception 'This account is inactive'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create or replace function public.require_role(p_roles public.user_role[])
returns void
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  perform public.require_active_user();

  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = any (p_roles)
  ) then
    raise exception 'You do not have permission to perform this action'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- ============================================================
-- Indexes backing the policy predicates
-- ============================================================
create index if not exists profiles_class_id_idx       on public.profiles (class_id);
create index if not exists profiles_role_active_idx    on public.profiles (role, is_active);
create index if not exists classes_hod_id_idx          on public.classes (hod_id);
create index if not exists exams_class_id_idx          on public.exams (class_id);
create index if not exists class_subjects_class_id_idx on public.class_subjects (class_id);
create index if not exists marks_exam_subject_idx      on public.marks (exam_id, subject_id);
create index if not exists marks_entered_by_idx        on public.marks (entered_by);
create index if not exists result_sheets_class_id_idx  on public.result_sheets (class_id);
create index if not exists result_sheets_status_idx    on public.result_sheets (status);
create index if not exists result_items_student_id_idx on public.result_items (student_id);
create index if not exists teacher_assignments_teacher_class_idx
  on public.teacher_assignments (teacher_id, class_id);
create index if not exists student_enrollments_student_status_idx
  on public.student_enrollments (student_id, status);
create index if not exists class_hod_assignments_hod_class_idx
  on public.class_hod_assignments (hod_id, class_id);
create index if not exists department_hod_assignments_hod_idx
  on public.department_hod_assignments (hod_id, department_id);

-- ============================================================
-- Function permissions
-- ============================================================
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'is_active_user', 'app_role', 'has_role',
        'is_admin', 'is_principal', 'is_hod', 'is_teacher', 'is_student',
        'teaches_class', 'teaches_class_subject', 'teaches_exam_subject',
        'is_subject_teacher', 'is_class_hod', 'is_department_hod',
        'is_exam_hod', 'is_sheet_hod',
        'can_view_class', 'can_view_subject', 'can_view_exam',
        'can_view_exam_subject', 'exam_results_published',
        'is_published_sheet', 'is_published_version',
        'can_view_sheet', 'can_view_result_item', 'can_view_component_item',
        'can_view_profile',
        'require_active_user', 'require_role'
      )
  loop
    execute format('revoke execute on function %s from anon, public', fn.sig);
    execute format('grant execute on function %s to authenticated', fn.sig);
  end loop;
end $$;
