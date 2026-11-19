-- ============================================================
-- GRADIA · Course duration decimals
-- ============================================================
-- Courses such as MBBS run for 5.5 years, but duration_years was created as
-- an integer. This migration widens the column to one decimal place while
-- keeping every existing value and the positive-value check.
--
-- Safe to run once. Re-running is harmless because the column is already
-- numeric(3,1) and the constraint is recreated.
-- ============================================================

alter table public.courses
  alter column duration_years type numeric(3,1)
  using duration_years::numeric(3,1);

-- Keep the invariant explicit in case an older deployment lost the constraint.
alter table public.courses
  drop constraint if exists courses_duration_positive;

alter table public.courses
  add constraint courses_duration_positive
  check (duration_years is null or duration_years > 0);
