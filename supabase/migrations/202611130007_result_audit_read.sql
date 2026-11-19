-- ============================================================
-- GRADIA · Exam Cell audit visibility
-- ============================================================
-- Exam Cell is accountable for configuration, approval and publication,
-- so it can read the audit trail. Coordinator deliberately cannot.
-- Audit rows are still written only by security-definer triggers/RPCs;
-- there is no client write policy.
-- ============================================================

drop policy if exists "audit logs exam cell read" on public.audit_logs;
create policy "audit logs exam cell read" on public.audit_logs
  for select to authenticated using (public.is_exam_cell());

-- Result review trail is already covered by the monitor read policy from
-- 202611130002. This index keeps the Exam Cell history view responsive.
create index if not exists result_reviews_reviewer_role_idx
  on public.result_reviews (reviewer_role, created_at desc);
