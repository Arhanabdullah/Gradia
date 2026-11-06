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

## Known sequencing deferrals

Two legacy constraints are intentionally kept through Phase 2 because current UI code
depends on them. Removing them without the matching UI change would break the app.

1. **`marks` unique `(exam_id, subject_id, student_id)`**
   `MarksEntry.jsx` upserts with `onConflict: "exam_id,subject_id,student_id"`.
   Component-wise marks need `(exam_id, subject_id, component_id, student_id)`, which
   requires dropping the old constraint **and** updating that upsert in the same change.
   Scheduled for Phase 5/7.

2. **`teacher_assignments` unique `(class_id, subject_id)`**
   `ManageClasses.jsx` upserts with `onConflict: "class_id,subject_id"`.
   Multiple teachers per class subject needs this constraint dropped **and** the upsert
   switched to `class_subject_id,teacher_id`. The new unique indexes are already in place;
   the swap is scheduled for Phase 5.

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

## Rollback

Phase 2 is additive, so rollback means dropping the new objects, in reverse order.
That is destructive and must never be run against a database holding real marks.
Prefer restoring the pre-migration dump.
