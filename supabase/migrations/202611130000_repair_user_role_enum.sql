-- Repair for databases that applied the old duplicate 202611130001 timestamp
-- to demo_requests instead of the coordinator/exam-cell roles migration.
-- The values are added idempotently and this file sorts before 202611130002,
-- where the first ::public.user_role[] cast needs them to exist.

alter type public.user_role add value if not exists 'coordinator';
alter type public.user_role add value if not exists 'exam_cell';

comment on type public.user_role is
  'student | teacher | hod | principal | admin | coordinator | exam_cell';
