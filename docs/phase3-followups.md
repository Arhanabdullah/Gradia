# Phase 3 follow-ups

Status: written after the Phase 3 commit `7dcbbc1`. No database was
contacted, no migration was applied, and no Edge Function was deployed while
producing this document. All statements below are from static inspection of
the repository.

This file records the issues that were deliberately left out of Phase 3 so
they can be scheduled into the correct later phase instead of being fixed by
accident in a security migration.

## P3-F1 - ManageUsers is not wired to `set-user-active`

Where:

- `Client/src/pages/admin/ManageUsers.jsx` line 112 calls
  `supabase.from("profiles").update({ is_active: ... })` directly.
- `supabase/functions/set-user-active/index.js` exists but is never invoked
  by the client.

Current behaviour:

- An active admin can set `profiles.is_active = false` through PostgREST.
  Phase 3 RLS and `enforce_profile_privileges()` allow that.
- The auth user is **not** banned, so the account can still obtain a new
  JWT. Every Phase 3 policy and guarded RPC still refuses the account, so
  data access is blocked, but the auth session remains valid.
- The Edge Function's self-deactivation guard and last-active-admin guard
  are not exercised by the UI. The UI currently hides the toggle for
  `admin` rows (line 230), which hides the most obvious cases but does not
  replace the server-side guard.
- A direct API call (not through this screen) can still deactivate an admin
  because the database only checks "caller is an active admin", not
  "another admin remains".
- The Edge Function's last-admin count excludes the target but includes the
  caller. Because the caller must already be an active admin and cannot
  target themselves, the count can never be zero in a normal request. The
  guard is therefore defensive and effectively unreachable; the real
  single-admin protection is the self-deactivation ban. It is also not
  concurrency-safe: two admins can deactivate each other at the same time
  and both pass the count check. The README's manual check "deactivate the
  second admin while only one active admin remains, expect 400" does not
  describe the current behaviour. Either remove that expectation or replace
  the guard with a serialized/locked check if last-admin protection is a
  hard requirement.

Recommended change (Phase 4 or a dedicated security follow-up):

1. Replace the direct `profiles.update` in `toggleActive` with
   `supabase.functions.invoke("set-user-active", { body: { user_id, active } })`.
2. Surface `data.error` and `fnError` in the existing `loadError` state.
3. Disable the control for the current user and keep the admin-row guard.
4. Refresh the list from the server after the call.
5. Add a staging check for: self-deactivation returns 400, last active admin
   returns 400, normal account deactivation bans auth login, reactivation
   restores login.

Do not change this file as part of a migration-only commit.

## P3-F2 - Subject HOD scope has no backing table

Where:

- `create-user` accepts `role = "hod"`, `hod_type = "subject"` and writes
  `profiles.hod_type` and `profiles.hod_subject_id`.
- Phase 3 helpers `is_class_hod`, `is_department_hod` and the HOD branch of
  `can_view_subject` only read `class_hod_assignments` and
  `department_hod_assignments`.
- No table maps a subject HOD to a subject or a class subject.

Consequence:

- A subject HOD is an active `hod` with no class or department assignment.
- `can_view_class` returns false for every class, so the account sees no
  classes, no students in class scope, no result sheets and no marks.
- `can_view_subject` does not use `profiles.hod_subject_id`; the subject HOD
  gets no subject visibility either.
- The `ManageUsers` screen displays the subject HOD label, which makes the
  account look configured even though it has no effective scope.

Recommended change (Phase 4/5, together with the HOD UI):

1. Add `subject_hod_assignments (subject_id, hod_id, is_primary)` or make
   the subject HOD a `class_subject` scoped assignment.
2. Extend `is_class_hod`, `can_view_subject`, `can_view_profile` and
   `can_view_sheet` to resolve the subject scope.
3. Create the scope row in `create-user` for `hod_type = "subject"`.
4. Add a staging test that a subject HOD sees exactly the subjects/classes
   they own and nothing else.

Until then, subject HOD accounts should not be created on a real project.

## P3-F3 - Legacy subject and class assignment reads

Phase 3 made `class_subjects` and `teacher_assignments` authoritative in the
database, but several screens still read the legacy columns. New records
created by `ManageClasses` no longer populate those legacy columns.

Affected reads:

| File | Line | Legacy dependency | Effect after the catalogue split |
|---|---|---|---|
| `Client/src/pages/teacher/MarksEntry.jsx` | 38-43 | `subjects.class_id` and `subjects.teacher_id` | A teacher sees no subjects for a newly catalogued subject, even after `class_subjects` and `teacher_assignments` are created. `ManageClasses` inserts `class_id: null, teacher_id: null`. |
| `Client/src/pages/Overview.jsx` | 32, 75 | `subjects.teacher_id` | "My subjects" count and the marks chart are zero for new assignments. |
| `Client/src/pages/Overview.jsx` | 103-112 | `classes.hod_id` and `subjects.class_id` | A department HOD created through `department_hod_assignments` sees no classes here; subject counts are zero for new catalogue subjects. |
| `Client/src/pages/Overview.jsx` | 94 | `subjects.class_id` | Student "Subjects in class" count is wrong for catalogue subjects. |
| `Client/src/pages/admin/AdminSheets.jsx` | 26, 49-54 | `subjects.class_id` | Compile-readiness counts are zero for catalogue subjects, so the screen can say "no students or subjects" while marks exist. |
| `Client/src/pages/admin/ManageClasses.jsx` | 132 | `teacher_assignments` upsert on `(class_id, subject_id)` | Keeps the legacy unique constraint and prevents multiple teachers per class subject. |

Related database deferrals documented in `supabase/migrations/README.md`:

- `marks` unique `(exam_id, subject_id, student_id)` prevents component-level
  marks. `MarksEntry.jsx` line 132 still upserts on that key.
- `teacher_assignments` unique `(class_id, subject_id)` prevents multiple
  teachers per class subject. `ManageClasses.jsx` line 132 still upserts on
  that key.
- `result_items` unique `(sheet_id, student_id, subject_id)` means
  `compile_result_sheet()` cannot snapshot two marks for the same
  student/subject. This becomes a blocker as soon as the `marks` unique
  constraint is replaced with a component-aware key.

Recommended change (Phase 5, in one atomic change):

1. Switch `MarksEntry` to resolve subjects through `teacher_assignments` and
   `class_subjects`, not `subjects.teacher_id`.
2. Switch `Overview` and `AdminSheets` to the join tables.
3. Drop the legacy `marks` unique constraint and add the component-aware one
   in the same migration that changes the upsert key.
4. Drop the legacy `teacher_assignments` unique constraint and change the
   upsert to `class_subject_id, teacher_id` in the same migration.
5. Revisit `result_items` uniqueness at the same time.

## P3-F4 - `AdminSheets.removeSheet()` ignores the delete error

Where: `Client/src/pages/admin/AdminSheets.jsx` lines 81-86.

Current behaviour:

- The delete is a direct PostgREST call; the return value is ignored.
- The component reloads immediately, so a failed delete looks like a no-op
  and no error is shown.
- The Delete button is only rendered for non-published sheets (line 156),
  so the published-sheet guard is normally not reachable. A stale list, a
  status change between load and click, an RLS change or a network failure
  can still produce a failed delete with no feedback.
- `guard_result_sheet_mutation()` and
  `result sheets admin delete` both protect published sheets. A published
  sheet must be corrected by a new version, not deleted.

Recommended change (Phase 4, with the correction workflow):

1. Capture `{ error }` from the delete.
2. Show `error.message` in the existing `message` area and keep the row.
3. Keep the published-row guard, and add an explicit "Corrections are
   created as a new version" action once that RPC exists.

## P3-F5 - Published result corrections do not exist yet

Current behaviour:

- `result_sheets`, `result_sheet_versions`, `result_items` and
  `result_component_items` are immutable once published.
- `compile_result_sheet(p_exam_id)` refuses to compile if **any** sheet
  exists for the exam, including a published one.
- There is no RPC that creates version N+1, no correction reason field is
  written, and no UI path to request or publish a correction.
- `result_sheet_versions` and `result_reviews` already have the shape for a
  correction trail (`version_number`, `correction_reason`, `decision`), but
  nothing uses it yet.

Consequence: a published result cannot be corrected through the application.
The only workaround is a privileged manual database change, which is exactly
what the immutability rules are meant to prevent.

Recommended change (Phase 4 for the API, Phase 7 for the UI):

1. Add `create_result_correction(p_sheet_id, p_reason)`:
   - require an active admin;
   - require the current version to be published;
   - insert version N+1 with `correction_reason`, status `compiled`;
   - clone the items and component items into the new version;
   - leave the published version untouched.
2. Add a review/sign/publish path for the new version that reuses
   `review_result_sheet`, `sign_off_result_sheet` and
   `publish_result_sheet`, or add version-aware variants.
3. Append to `result_reviews` and `audit_logs` for every step.
4. Notify students only when the correction version is published.
5. Add a UI entry point on `AdminSheets` and a reason field.
6. Add staging tests for: old version still readable, new version not
   readable until published, published correction cannot be re-published,
   student sees the new version.

## Additional findings for staging

These are not Phase 3 regressions, but they affect the staging run:

1. **The Phase 2 and Phase 3 commits are not self-contained.**
   `supabase/migrations/202611050001_gradia_academic_structure.sql` and
   `202611050002_class_subject_catalogue.sql` are still untracked. A clean
   clone cannot reproduce the database. Commit them before staging, or the
   staging run depends on uncommitted local files.

2. **The baseline is not a migration.** `supabase/schema.sql` must be
   applied manually before `supabase db push`. On an empty project the first
   timestamped migration (`202611050001`) fails because `public.profiles`
   does not exist yet.

3. **Migration history may already be out of sync.** Earlier work may have
   been applied through the SQL editor rather than `supabase db push`. Check
   `supabase migration list` before pushing. If the remote history is
   incomplete, use `supabase migration repair --status applied <version>`
   only after verifying the objects already exist; never re-run a migration
   blindly on a database with real marks.

4. **`supabase/.temp/` is partly tracked.** `linked-project.json` and
   `cli-latest` are in Git even though they are local CLI state. They now
   disagree with `config.toml` and `Client/.env`. After the staging project
   is chosen, untrack `.temp` and add it to `.gitignore` in a separate,
   approved commit.

5. **`phase3_security_tests.sql` refuses on variable presence, not value.**
   `\if :{?allow_security_tests}` is true for any value, including
   `-v allow_security_tests=no`. The README says "pass yes", but the guard
   only checks that the variable exists. Treat this as a convenience guard,
   not a safety control, and only run the file against staging.

6. **`create-user` subject-HOD branch has no scope row.** See P3-F2.

7. **`create-user` enrollment upsert has no explicit conflict target.**
   The `student_enrollments` unique key is an expression index
   `(student_id, class_id, coalesce(academic_term_id, ...))`, but the
   `upsert(..., { ignoreDuplicates: true })` call does not pass
   `onConflict`. Verify on staging that re-creating or reusing a student does
   not surface a duplicate error; if it does, pass the matching conflict
   target or handle the error explicitly.

8. **Index overlap.** `teacher_assignments_class_subject_id_idx` is created
   in both `202611060002` and `202611070001` with the same definition (the
   second is a no-op due to `if not exists`). Several Phase 3 indexes overlap
   existing ones:
   - `teacher_assignments_teacher_id_idx` + `teacher_assignments_teacher_class_idx`
   - `class_hod_assignments_hod_id_idx` + `class_hod_assignments_hod_class_idx`
   - `department_hod_assignments_hod_id_idx` + `department_hod_assignments_hod_idx`
   - `exams_class_id_idx` vs the leading column of `exams (class_id, name) unique`
   - `marks_exam_subject_idx` vs the leading columns of the legacy marks unique
   These are not migration errors, but they add write cost. Consolidate them
   in a later performance migration, not in Phase 3.

9. **`institution_settings.default_grading_scheme_id` is declared twice**
   (in the `create table` and again with `add column if not exists`). Harmless,
   but redundant.

10. **Published sheet immutability is narrower than it looks.**
    `guard_result_sheet_mutation()` freezes the status and `published_at` of
    a published sheet, but it does not freeze `compiled_by`,
    `hod_reviewed_by`, `principal_signed_by`, remarks or `updated_at`.
    Clients have no UPDATE policy, so only RPCs/service role can reach this,
    but a future correction RPC should not mutate the published row. Freeze
    all non-version columns or move them to the version table.

11. **Deleting a profile is destructive.** `profiles admin delete` allows an
    active admin to delete another profile. Foreign keys cascade marks,
    result items, enrollments, assignments, notifications and preferences.
    There is no soft-delete or retention guard. Keep profile deletion out of
    the UI; deactivate with `set-user-active` instead.

12. **Published results can disappear after a class change.**
    `can_view_sheet()` for students accepts `profiles.class_id` or an
    **active** `student_enrollments` row. A student moved to a new class
    loses access to their older published sheets unless the old enrollment
    is still active. If historical results must remain visible, allow any
    enrollment row for the sheet's class, not only `status = 'active'`.
