-- ============================================================
-- GRADIA · Coordinator and Exam Cell roles
-- ============================================================
-- Additive migration. Only the enum values are added here so the new
-- values are committed before later migrations reference them.
--
-- Coordinator  read-only institution-wide monitoring and printing
-- Exam Cell    result configuration, final approval and publication
--
-- Existing roles and all existing rows are untouched.

alter type public.user_role add value if not exists 'coordinator';
alter type public.user_role add value if not exists 'exam_cell';

comment on type public.user_role is
  'student | teacher | hod | principal | admin | coordinator | exam_cell';
