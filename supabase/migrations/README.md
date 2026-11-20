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

## Attendance migration

| File | Adds |
|---|---|
| `202611110001_attendance.sql` | `attendance` records linked to student, class, subject, academic year and teacher; generated per-subject percentage; validation trigger; scope helpers and RLS |

The table stores `attended_classes` and `total_classes`; `attendance_percentage` is a
generated column (`attended / total * 100`). A unique constraint on
`(student_id, class_id, subject_id, academic_year)` prevents duplicate records, so the
attendance screen upserts instead of inserting. The client calculates overall attendance
as `sum(attended) / sum(total) * 100` across subjects.

The migration is additive and does not touch existing tables. It must be applied after
`202611100003_global_degrees.sql` so the migration chain stays in filename order, although
the attendance table itself does not reference degrees.

## Result workflow and visibility migrations

| File | Changes |
|---|---|
| `202611110002_course_duration_decimal.sql` | `courses.duration_years` becomes `numeric(3,1)` so durations such as `5.5` are accepted |
| `202611120001_exam_subject_visibility.sql` | `can_view_subject()` also allows a subject attached to an exam the caller can already view, so exam schedules no longer hide paper names behind RLS |
| `202611120002_remove_principal_signoff.sql` | Removes the principal sign-off stage; `publish_result_sheet()` accepts `hod_approved` directly and `sign_off_result_sheet()` is disabled |

`202611120002` keeps `principal_signed` publishable for sheets already in flight and leaves
the enum value in place for backward compatibility. The publishing permission still belongs
to the `principal` role; only the intermediate approval stage was removed.

## Grading engine, assessment structure and read paths

| File | Changes |
|---|---|
| `202611140001_academic_grading_engine.sql` | Credit-weighted SGPA/CGPA (`recalculate_result_sheet`), result codes `P/XP/X/F/RW`, promotion rules, `subjects.subject_type`, `subjects.credit_hours` backfill, `profiles.registration_no`, `grade_band_for()` gap-tolerant lookup, readiness gate (`result_sheet_readiness` / `assert_result_sheet_ready`), Exam Cell approval and publish gates, config audit triggers |
| `202611150001_central_assessment_structure.sql` | `assessment_templates` + `assessment_template_components` materialised into `assessment_components`; `subjects.assessment_template_id` / `exam_subjects.assessment_template_id`; `exams.result_kind` and `result_sheets.result_kind` so only End-Semester sheets produce a printable grade card |
| `202611160001_read_policy_fastpaths.sql` | Rewrites the `SELECT` policies on `subjects`, `profiles`, `student_enrollments` and `audit_logs` so the role-wide check is an InitPlan instead of a per-row call (Exam Cell subject scan 910 ms -> 5 ms on 792 rows) |
| `202611170001_component_papers.sql` | One schedulable paper per assessment component (`is_conducted`, `exam_date`, `start_time`, `end_time`, `duration_minutes`, `room`, `teacher_id`, `instructions`, `allow_overlap`); practical-only labs; `add_exam_subject` / `remove_exam_subject`; `update_assessment_component_schedule`; Exam Cell access to examination scheduling |
| `202611180001_paper_schedule_mode.sql` | `schedule_mode` (`formal` / `classwork`) on `assessment_template_components` and `assessment_components`; classwork trigger clears scheduling fields; `update_assessment_component_schedule` accepts `duration_minutes`, rejects schedules on classwork and derives `end_time` |
| `202611180002_retire_legacy_exam_groups.sql` | Destructive, guarded cleanup of the five empty legacy internal groups (`IA 1`, `IA 2`, `Quiz`, `Assignment`, `Project`) plus cancelled groups, after writing a full backup to `audit_logs` |
| `202611190001_schedule_conflict_guards.sql` | Extends `validate_assessment_component_schedule` with cross-group room and invigilator collision checks; adds the `schedule_conflicts()` read RPC the class scheduler calls before saving |
| `202611200001_classwork.sql` | `classwork_items` and `classwork_submissions` with RLS; `publish_classwork_item()` originally created an internal exam and `exam_subjects` row, now superseded by `202611200007`; `submit_classwork()`, `review_classwork_submission()` and `notify_classwork_deadlines()` |
| `202611200002_semester_exam_cleanup.sql` | Removes legacy exam groups created before 2026-11-20 that have no marks, result sheets, submissions or classwork; copies every removed group into `exam_cleanup_backup_20261120`; adds `restore_exam_cleanup_20261120()` |
| `202611200003_lab_direct_marks.sql` | `lab_direct_marks_eligible()` and a readiness exception so a practical subject with every paper off can carry one direct mark out of 100 in `marks` |
| `202611200004_department_exam_rooms.sql` | Automatic semester structure: `create_exam_group` accepts a per-class subject map, `update_assessment_component_schedule` accepts `p_room_class_id` for a room per class in a department group, and invigilator writes are retired |
| `202611200005_classwork_quiz_fixed_marks.sql` | Quiz joins assignment and project as a classwork kind; fixed marks of 8 for quiz, 8 for assignment and 6 for project are enforced by trigger, while historical rows keep their published marks |
| `202611200006_classwork_exam_names.sql` | Made legacy Classwork exam names unique by kind and subject; superseded by `202611200007`, which stops Classwork from creating exams |
| `202611200007_classwork_without_exams.sql` | Classwork publishing only notifies the class; backs up and deletes the 60 standalone Classwork exam shells so only the 2026-27 semester examinations remain |
| `202611200008_demo_requests.sql` | Public landing-page demo requests with admin-only read/update RLS; renamed from the colliding `202611130001_demo_requests.sql` |

`202611160001` only reorders how the existing predicates are evaluated: the scoped
helpers (`can_view_subject`, `can_view_profile`, `is_class_hod`, `teaches_class`) still
decide every non-monitor case, and the admin/principal branch is the same early return
those helpers already take. Row counts were compared per role before and after. Keep the
`(select …)` wrapper when editing these policies; without it the planner falls back to
one helper call per row.

### Component papers

A semester examination now schedules each assessment component as its own paper, so a
theory subject carries IA1, IA2, Quiz, Assignment, Project and the End Semester paper,
and a practical subject carries its practical papers only. The structure still comes from
the central templates; the papers only add scheduling and a conducted switch.

- A paper switched off (`is_conducted = false`) is not marked, is excluded from
  `assessment_component_total`, and the subject percentage is normalised over the papers
  that were conducted. The structure must still total 100 configured marks.
- `submit_exam_marks` counts only conducted papers, `result_sheet_readiness` reports
  `missing_conducted`, and `skip_non_conducted_component_item` keeps a skipped paper out
  of the compiled snapshot even if a stray mark exists.
- Switching a paper off after marks were entered is rejected; a published examination
  cannot be re-scheduled at all.
- Practical subjects (`subjects.subject_type = 'lab'` or an `LS` code) are rejected from
  internal and theory examinations by both `create_exam_group` and `add_exam_subject`.
- A practical subject whose papers are all switched off (Practical Record, Viva and
  Practical Examination) is a **direct-marks** lab. Marks Entry then shows one entry out
  of 100 per student, stored in `marks` with no component id. `lab_direct_marks_eligible()`
  exempts it from the `missing_conducted` readiness error, while `missing_marks` still
  requires a mark for every student. `recalculate_result_sheet` already grades a
  component-free mark as a raw mark out of 100, so no snapshot or grade-card change is
  needed. Switching papers off after marks exist is still rejected, so choose this mode
  before marks entry.
- `add_exam_subject` / `remove_exam_subject` and `update_assessment_component_schedule`
  act group-wide for dates, times and the conducted flag, so every class in a department
  examination stays in step. Admin and Exam Cell can change a subject list; a teacher can
  only re-schedule papers for subjects they teach.
- `create_exam_group` accepts an optional `p_class_subjects` map, so classes in one
  department group can offer different subject sets while sharing the same paper dates.
  Subject teachers are resolved from `teacher_assignments` for each class, never from the
  scheduling payload.
- With `p_room_class_id`, `update_assessment_component_schedule` writes the room only on
  that class's copy of the paper. Invigilator writes are ignored; existing `teacher_id`
  values stay as historical data.

### Automatic semester structure and department rooms

`202611200004` removes the manual "Create semester examination" step. The page creates the
group from assigned classes and subjects as soon as a valid hierarchy is chosen:

- **Per class** creates one semester group for the selected class.
- **Department-wide** creates one group per course and academic year from the selected
  classes, with one exam per selected class. Paper dates, times and durations are shared;
  each class keeps its own room in the subject breakdown. The UI shows the union of
  subjects assigned across the group, so a subject offered by only some classes is
  scheduled once for those classes and is still visible to the rest of the group.
- Removing a class from a department group deletes only that class's exam and suppresses
  automatic recreation for the rest of the session.
- Invigilator selection is retired from scheduling UI, import and RPC writes. The existing
  invigilator conflict guard remains for historical rows, and no published result is
  rewritten.

### Classwork is not an examination

`202611200005` adds `quiz` to `classwork_items.kind` alongside `assignment` and `project`. A before-insert/update trigger sets `max_marks` to 8 for a quiz, 8 for an assignment and 6 for a project on every new or changed row. A historical row with a non-fixed scale keeps its marks while its kind and marks stay unchanged. The value is now an internal database detail; the Classwork screen no longer shows fixed marks.

`202611200006` briefly fixed the old exam-backed publish flow by adding kind and subject to generated exam names. `202611200007` supersedes it: `publish_classwork_item()` no longer inserts into `exams` or `exam_subjects`, and the Classwork screen has no Marks Entry link. Marks for quiz, assignment and project are entered against the matching classwork components of the semester examination, and Marks Entry lists only semester exam types.

`202611200007` backed up all 60 standalone Classwork exam shells (including 40 legacy marks) into `classwork_exam_cleanup_backup_20261120`, cleared their links from `classwork_items` and deleted the exams. The four 2026-27 semester examinations inside exam groups were untouched. New imports never create an exam; a publish failure still deletes the unpublished Classwork row.

### Demo requests

`202611200008` creates `public.demo_requests` for the public landing-page form. Anonymous users can insert only; admins can read and update requests through RLS. The `demo-request` Edge Function uses the service role to insert the request and create admin notifications, then sends best-effort email through Resend when `RESEND_API_KEY` is configured. The file was renamed from `202611130001_demo_requests.sql` because that timestamp already belonged to the coordinator/exam-cell roles migration; a repeated timestamp makes Supabase skip one file.

### Formal papers and classwork

`202611180001` splits the papers of a subject into two kinds, configured once in the
assessment structure and copied to every exam subject by `materialize_assessment_template`:

- **formal** — a paper with a date, start time, duration and room. This covers IA1, IA2,
  ESA, the practical exam and the viva. Invigilator selection is retired; historical
  `teacher_id` values are preserved but never written by the scheduler.
- **classwork** — a marked activity with no date, room or invigilator: quiz, assignment,
  project and the practical record. A trigger clears those columns on any classwork row,
  and `update_assessment_component_schedule` raises `check_violation` if a caller tries to
  schedule one. The conducted toggle still works, so a skipped activity stays out of the
  subject total.

`update_assessment_component_schedule` now takes `duration_minutes` for formal papers and
derives `end_time` from the start time plus the duration. A missing or zero duration on a
formal paper is rejected. Scheduling still acts group-wide by component code and still
refuses to switch off a paper that already has marks.

`202611180002` is **destructive** and must run only after `202611180001`. It removes the
five standalone legacy internal groups and any cancelled groups, but only when the group
has no result sheet, marks or marks submission. Before deleting, it writes the group, its
exams, subjects and components into `audit_logs` (`exam_group.legacy_cleanup`). Re-running
is a no-op. Back up `exam_groups`, `exams`, `exam_subjects` and `assessment_components`
before applying it to a database that holds real data.

The client degrades gracefully while `202611180001` is unapplied: `ManageExams.jsx`
retries its `schedule_mode` selects without the column, and `isClassworkComponent()` falls
back to the classwork component codes. Saving a formal paper still needs the migration,
because the older RPC ignores `duration_minutes`.

### Semester examination cleanup

`202611200002` retires the standalone scheduling groups that the old IA1, IA2, ESA, Quiz,
Practical and Viva screens created. It is destructive but reversible:

- it only considers groups created before `2026-11-20 00:00 UTC`, so a semester
  examination scheduled after this rollout is never touched;
- a group is skipped when it has any marks, any result sheet (whatever the status), any
  marks submission or any classwork item, so historical marks and published results
  survive;
- every removed group, its exams, subjects and components are copied into
  `public.exam_cleanup_backup_20261120` before deletion;
- rollback is `select public.restore_exam_cleanup_20261120();` as an administrator. It
  re-inserts the backed-up rows and marks each backup row as restored.

Back up the four examination tables before applying it to a database with real data.

### Schedule conflict guards

`202611190001` keeps every paper inside one class free of clashes and stops two classes
from sharing a room at the same time. It still checks invigilator clashes for historical
rows, although the scheduler no longer writes invigilators:

- `validate_assessment_component_schedule` still rejects a class overlap inside the same
  examination group, then also rejects a formal paper in a **different** group that
  overlaps it in the same room or with the same invigilator. Same-group propagation is
  skipped on purpose: `update_assessment_component_schedule` applies a paper group-wide, so
  checking siblings would reject the very rows it is about to write.
- `schedule_conflicts(p_exam_date, p_start_time, p_end_time, p_room, p_teacher_id,
  p_class_id, p_exam_group_id, p_exclude_component_id)` returns the clashing papers for a
  proposed slot. It is the authoritative pre-flight check for callers whose RLS view hides
  other classes. The class scheduler validates locally against the papers it can read so
  the form gives instant feedback; the trigger remains the final guard on every write.
- A paper with `allow_overlap` is exempt, matching the existing same-group behaviour.

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
pushing. `supabase/config.toml` and the linked ref are both set to that production
project; verify with `npx supabase migration list --remote=<ref>` if either changes.

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

-- classwork papers must not carry scheduling fields (after 202611180001)
select count(*) from public.assessment_components
where schedule_mode = 'classwork'
  and (exam_date is not null or start_time is not null
       or room is not null or teacher_id is not null);

-- fixed classwork marks (after 202611200005): 8, 8 and 6
select public.classwork_fixed_marks('quiz') as quiz,
       public.classwork_fixed_marks('assignment') as assignment,
       public.classwork_fixed_marks('project') as project;
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
