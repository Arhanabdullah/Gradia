# Gradia database migrations

## Bootstrap order (important)

Gradia did not start with a baseline migration; the baseline is `supabase/schema.sql`.
Apply things in this order:

1. `supabase/schema.sql` — original baseline (classes, profiles, subjects, exams, marks,
   result sheets, notifications, RLS, workflow RPCs).
2. `202611050001_gradia_academic_structure.sql` — departments, courses, profile/class
   extension columns, replaced `handle_new_user()`.
3. `202611050002_class_subject_catalogue.sql` — `class_subjects`, `teacher_assignments`,
   legacy backfill.
4. `202611060000_phase2_preflight.sql` — fails fast if 1–3 are missing.
5. `202611060001` … `202611060006` — Phase 2 academic architecture (below).

> Do **not** re-run `schema.sql` after the migrations. It replaces `handle_new_user()`
> with the older version and would drop the Phase 2 trigger behaviour.

## Phase 2 migrations

| File | Adds |
|---|---|
| `202611060000_phase2_preflight.sql` | Guards: refuses to run on an un-bootstrapped database |
| `202611060001_academic_sessions_terms.sql` | `academic_sessions`, `academic_terms`, `classes.academic_term_id/level/is_active`, `set_updated_at()` |
| `202611060002_subject_catalogue.sql` | `course_subjects`; `subjects` catalogue columns; `teacher_assignments.class_subject_id/is_primary` |
| `202611060003_enrollments_hod.sql` | `student_enrollments`, `class_hod_assignments`, `department_hod_assignments`, `profiles.phone/updated_at`, role-validation triggers |
| `202611060004_exams_components_marks.sql` | `exam_subjects`, `assessment_components`, `marks.assessment_component_id/status/remarks`, `validate_mark()`, `mark_revisions` |
| `202611060005_result_versioning.sql` | `result_sheet_versions`, `result_component_items`, `result_reviews`, immutability guards |
| `202611060006_config_audit_notifications.sql` | `institution_settings`, `grading_schemes`, `grade_bands`, `audit_logs`, `notification_preferences`, richer `notifications` |

Every Phase 2 migration is **additive and idempotent**: `create … if not exists`,
`add column if not exists`, guarded constraint/index creation. No table, column or
function from the original schema is dropped or renamed.

## Phase 3 migrations

Apply after the Phase 2 chain, in filename order.

| File | Changes |
|---|---|
| `202611070001_security_helpers.sql` | Active-account helpers (`is_active_user`, `app_role`, `has_role`, `require_active_user`, `require_role`), scope helpers (`teaches_class`, `is_class_hod`, `can_view_*`), policy indexes, function grants |
| `202611070002_security_triggers.sql` | `handle_new_user()` no longer trusts `user_metadata`; `enforce_profile_privileges()` blocks non-admin role/activation/scope changes; `enforce_notification_update()` limits users to `is_read` |
| `202611070003_security_policies.sql` | Full replacement of every RLS policy with active-account and academic-scope predicates; no `force row level security` |
| `202611070004_secure_workflow_rpcs.sql` | Same four workflow RPCs with `require_role()` guards, version snapshot, review trail and notification fan-out |

Key behaviours after Phase 3:

- New auth users always start as active `student`. The `create-user` Edge Function
  applies the validated role/scope with the service role afterwards.
- A deactivated account reads nothing (every policy requires an active profile) and
  cannot call any guarded RPC. `set-user-active` additionally bans the auth user.
- Published `result_sheets`, versions, items and component items are immutable for
  every role, including admin. Corrections must create a new version (Phase 4/7).
- Clients have no INSERT/UPDATE/DELETE policy on workflow tables (`result_sheets`,
  `result_sheet_versions`, `result_items`, `result_component_items`,
  `result_reviews`, `audit_logs`, `mark_revisions`). Only RPCs/triggers write them.
- `handle_new_user()` and `enforce_profile_privileges()` override the versions in
  `schema.sql` and `202611050001`. Never re-run those after Phase 3.

## Phase 4 migrations

Apply after the Phase 3 chain, in filename order.

| File | Changes |
|---|---|
| `202611090001_exam_scheduling.sql` | `exam_groups`, `exam_subjects` scheduling fields, exam scope RPCs and status workflow |
| `202611100001_multi_teacher_class_subjects.sql` | Drops the legacy one-teacher-per-class-subject constraint; keeps `(class_subject_id, teacher_id)` and the one-primary index |
| `202611100002_degrees_academic_structure.sql` | `degrees` catalogue between departments and courses; nullable `degree_id` on `courses`, `classes`, `profiles`; degree/department consistency triggers; degree RLS |
| `202611100003_global_degrees.sql` | Removes `degrees.department_id`; degrees become a global catalogue with unique name and code; class/profile degree consistency kept |

### Degrees

`202611100002` and `202611100003` are additive and **do not backfill or invent data**:

- Degrees are a global catalogue shared by every department. `202611100003` removes the
  department column, so a degree such as BSc or MSc can be offered by several departments.
  Degree names and codes are unique across the catalogue.
- The department stays on courses, classes and profiles. A course links its own
  department and degree; a class keeps its course's department and degree.
- Existing courses, classes and student/HOD profiles keep `degree_id = NULL` until an
  administrator assigns a real degree. The new client requires a degree for every new
  course, class, student and department HOD.
- A class degree must match its course degree, and a profile degree must match its
  course or class degree. Database triggers enforce this for direct API writes as well.
- Changing a course degree updates its classes automatically.
- `degree_id` is part of the protected profile scope in `enforce_profile_privileges()`,
  so only an active admin (or the service role) can change it.
- Deleting a degree still used by a course, class or profile is blocked by
  `on delete restrict`.

Deployment order for this change: apply `202611100002` and `202611100003`, deploy the
degree-aware client and the updated `create-user` Edge Function, then assign degrees to
existing records through Academics → Degrees / Courses / Classes and Users → Edit.

`202611100003` rejects duplicate degree names or codes. A deployment that already created
department-scoped degrees must merge or rename duplicates before applying it. The live
catalogue was empty when the migration was introduced.

## Known sequencing deferrals

Two legacy constraints are intentionally kept through Phase 2 because current UI code
depends on them. Removing them without the matching UI change would break the app.

1. **`marks` unique `(exam_id, subject_id, student_id)`**
   `MarksEntry.jsx` upserts with `onConflict: "exam_id,subject_id,student_id"`.
   Component-wise marks need `(exam_id, subject_id, component_id, student_id)`, which
   requires dropping the old constraint **and** updating that upsert in the same change.
   Scheduled for Phase 5/7.

2. **`teacher_assignments` unique `(class_id, subject_id)`** — resolved by
   `202611100001_multi_teacher_class_subjects.sql`. `ManageClasses.jsx` now links
   teacher rows through `class_subject_id`, requires at least one teacher per class
   subject and supports multiple teachers. Apply the migration only after that client
   change is deployed. The partial `(class_subject_id, teacher_id)` and
   one-primary indexes remain in force.

## Applying

Never apply these against production directly. Use a staging project first:

```bash
# from the repo root, with the CLI linked to the STAGING project
npx supabase link --project-ref <staging-ref>
npx supabase db push --dry-run
npx supabase db push
```

The linked project ref in `supabase/.temp/` must match the client `.env` project before
pushing. See `Phase 2` notes in the project report; `config.toml` currently disagrees
with the linked ref and must be reconciled first.

## Post-migration verification

Run these read-only checks after applying. All should return `0` unless noted.

```sql
-- every legacy subject with a class link has a class_subjects row
select count(*) from public.subjects s
where s.class_id is not null
  and not exists (select 1 from public.class_subjects cs
                  where cs.class_id = s.class_id and cs.subject_id = s.id);

-- every teacher assignment points at a class_subject
select count(*) from public.teacher_assignments where class_subject_id is null;

-- every mark has an exam_subject row
select count(*) from public.marks m
where not exists (select 1 from public.exam_subjects es
                  where es.exam_id = m.exam_id and es.subject_id = m.subject_id);

-- every result sheet has a version 1 and a current version
select count(*) from public.result_sheets
where current_version_id is null
   or not exists (select 1 from public.result_sheet_versions v
                  where v.sheet_id = id and v.version_number = 1);

-- every student profile with a class has an enrollment
select count(*) from public.profiles p
where p.role = 'student' and p.class_id is not null
  and not exists (select 1 from public.student_enrollments e
                  where e.student_id = p.id and e.class_id = p.class_id);
```

Row-count sanity (should match the legacy counts):

```sql
select
  (select count(*) from public.subjects)              as subjects,
  (select count(*) from public.class_subjects)        as class_subjects,
  (select count(*) from public.teacher_assignments)   as teacher_assignments,
  (select count(*) from public.result_sheets)         as sheets,
  (select count(*) from public.result_sheet_versions) as versions,
  (select count(*) from public.result_items)          as items,
  (select count(*) from public.result_component_items) as component_items;
```

## Phase 3 verification

Read-only checks after applying Phase 3:

```sql
-- every table with policies has RLS enabled
select c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
  and not c.relrowsecurity;

-- helpers exist and are SECURITY DEFINER
select p.proname, p.prosecdef
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('is_active_user','app_role','require_role','can_view_sheet');

-- clients must not be able to write workflow tables
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('result_sheets','result_sheet_versions','result_items',
                    'result_component_items','result_reviews','audit_logs','mark_revisions')
  and cmd in ('INSERT','UPDATE','DELETE','ALL');
-- expected: only `result sheets admin delete` (DELETE, status <> published)
```

Behavioral checks live in `supabase/tests/phase3_security_tests.sql`; they are
authored but **not executed** as of Phase 3. See `supabase/tests/README.md`.

## Rollback

Phase 2 is additive, so rollback means dropping the new objects, in reverse order.
That is destructive and must never be run against a database holding real marks.
Prefer restoring the pre-migration dump.
