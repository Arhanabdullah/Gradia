-- ============================================================
-- GRADIA - Secure the Classwork cleanup backup table
-- ============================================================
-- Supabase's security advisor flagged this table because it was created in
-- public without row level security. The backup contains deleted examination
-- payloads, so only active admins may read it and nobody may write to it
-- through the client. Service-role maintenance functions continue to work.

alter table public.classwork_exam_cleanup_backup_20261120 enable row level security;

drop policy if exists "classwork cleanup backup admin read" on public.classwork_exam_cleanup_backup_20261120;
create policy "classwork cleanup backup admin read"
  on public.classwork_exam_cleanup_backup_20261120
  for select to authenticated
  using (public.is_admin());
