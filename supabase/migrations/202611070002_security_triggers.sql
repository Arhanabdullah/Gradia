-- ============================================================
-- GRADIA · Phase 3 · Security triggers
-- ============================================================
-- 1. handle_new_user() no longer trusts user_metadata for privilege.
--    A new auth user always gets a plain, active student profile.
--    Admin provisioning (secure Edge Function, service role) applies
--    the validated role and academic scope afterwards.
-- 2. A profile update can no longer change role / activation / scope
--    unless the caller is an active admin (or the service role).
-- 3. A user can only change the read state of their own notification.
-- ============================================================

-- ---------- 1. safe profile creation ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email    text;
  v_username text;
  v_name     text;
begin
  v_email := coalesce(
    nullif(btrim(new.email), ''),
    'user_' || substr(replace(new.id::text, '-', ''), 1, 8) || '@no-email.local'
  );
  v_username := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
    split_part(v_email, '@', 1)
  );
  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(v_email, '@', 1)
  );

  begin
    insert into public.profiles (id, username, name, email, role, is_active)
    values (new.id, v_username, v_name, v_email, 'student', true);
  exception
    when unique_violation then
      -- profile already exists for this auth user
      if exists (select 1 from public.profiles where id = new.id) then
        return new;
      end if;

      -- username collision: fall back to a deterministic unique handle
      insert into public.profiles (id, username, name, email, role, is_active)
      values (
        new.id,
        'user_' || substr(replace(new.id::text, '-', ''), 1, 8),
        v_name,
        v_email,
        'student',
        true
      )
      on conflict (id) do nothing;
  end;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from anon, public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 2. privilege escalation guard ----------
-- Runs as the invoking role (not SECURITY DEFINER) so current_user is the
-- real API role. Service-role / direct-database sessions are trusted;
-- everything else must be an active admin.
create or replace function public.enforce_profile_privileges()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role
     or new.is_active is distinct from old.is_active
     or new.department_id is distinct from old.department_id
     or new.course_id is distinct from old.course_id
     or new.class_id is distinct from old.class_id
     or new.student_id is distinct from old.student_id
     or new.teacher_id is distinct from old.teacher_id
     or new.hod_type is distinct from old.hod_type
     or new.hod_subject_id is distinct from old.hod_subject_id then

    if current_user in (
      'postgres', 'supabase_admin', 'service_role',
      'supabase_auth_admin', 'authenticator'
    ) then
      return new;
    end if;

    if not public.is_admin() then
      raise exception 'Only an active admin can change role, activation or academic scope'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_profile_privileges() from anon, public;

drop trigger if exists enforce_profile_privileges on public.profiles;
create trigger enforce_profile_privileges
  before update on public.profiles
  for each row execute function public.enforce_profile_privileges();

-- ---------- 3. notification tamper guard ----------
create or replace function public.enforce_notification_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'Notification ownership cannot be changed'
      using errcode = 'insufficient_privilege';
  end if;

  if new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.type is distinct from old.type
     or new.link is distinct from old.link
     or new.payload is distinct from old.payload then
    raise exception 'Only the read status of a notification can be changed'
      using errcode = 'insufficient_privilege';
  end if;

  if new.is_read and new.read_at is null then
    new.read_at := now();
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_notification_update() from anon, public;

drop trigger if exists enforce_notification_update on public.notifications;
create trigger enforce_notification_update
  before update on public.notifications
  for each row execute function public.enforce_notification_update();
