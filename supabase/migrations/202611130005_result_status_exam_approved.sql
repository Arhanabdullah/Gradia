-- ============================================================
-- GRADIA · Exam Cell approval statuses
-- ============================================================
-- Additive enum values. Kept in its own migration because PostgreSQL
-- requires a new enum value to be committed before another statement
-- can use it.
--
--   hod_approved -> exam_approved -> published   (Exam Cell path)
--   hod_approved -> published                    (Principal path)
--   exam_rejected                                (returned for correction)
-- ============================================================

alter type public.sheet_status add value if not exists 'exam_approved';
alter type public.sheet_status add value if not exists 'exam_rejected';

comment on type public.sheet_status is
  'draft | compiled | hod_approved | hod_rejected | principal_signed | exam_approved | exam_rejected | published';
