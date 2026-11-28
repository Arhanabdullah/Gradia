# Gradia 2.0 implementation roadmap

## Scope and honesty

The requested transformation into a complete academic ERP is larger than a single safe change. This document records the current state, gaps, conflicts, and a phased plan. It does not claim that Gradia 2.0 is complete.

One concrete first slice was implemented in this session: a centralized notification dropdown in the dashboard header, realtime updates, unread count, mark read, mark all read, a full notifications page available to every role, and no new dependencies. The rest of the roadmap below is not implemented yet.

## 1. Repository analysis

### Stack and structure

- Single npm package in `Client/`. React 19, Vite 7, Tailwind 4, plain JavaScript/JSX. No TypeScript anywhere.
- Client talks directly to Supabase. There is no Express API layer. `Client/src/lib/supabase.js` creates the client; `Client/src/lib/db.js` has `callRpc`, `fetchTable`, `insertRow`, `updateRow`, `deleteRow`.
- Auth and profile loading live in `Client/src/context/AuthContext.jsx`. Roles are `student | teacher | hod | principal | admin | coordinator | exam_cell`. Deactivated profiles read nothing and cannot call guarded RPCs. Admin-created accounts only; no public signup.
- Routing is in `Client/src/App.jsx`. Every `/app` route is gated by `RequireRole`. Pages are lazy loaded behind `AppLoader` inside `Suspense`, with `ErrorBoundary` in `DashboardLayout`.
- Navigation is the single `NAV_BY_ROLE` table in `Client/src/components/dashboard/DashboardSidebar.jsx`. Landing-page `ProductPreview` reuses `DashboardSidebar fluid` and `DashboardHeader` with no props; `PREVIEW_ITEMS`/`fluid` fallbacks must stay.
- Shared primitives are in `Client/src/components/ui.jsx`. Charts use Recharts and shared `chartAxis`/`chartTooltip` in `Client/src/components/charts/ChartsConfig.js`. Motion uses Framer Motion. `prefers-reduced-motion` is handled globally in `Client/src/index.css`.
- Print output is built in `Client/src/lib/print.js`; student grade cards open a print-to-PDF popup. Coordinator reports use `printReportDocument`.
- Exam and assessment helpers are in `Client/src/lib/exams.js`, `Client/src/lib/assessment.js`, `Client/src/lib/status.js`, `Client/src/lib/attendance.js`. Bulk import lives in `Client/src/components/import/` and `Client/src/import/`, capped at 10 MB and 5,000 rows, and never writes `result_sheets`/`result_items`.
- Supabase schema is source of truth in `supabase/migrations/`, ordered per `supabase/migrations/README.md`. `supabase/schema.sql` is stale baseline; do not treat it as current. Only server code is `supabase/functions/`: `create-user`, `update-user`, `delete-user`, `set-user-active`, `demo-request`.
- No tests, no CI. Only `npm run lint` and `npm run build` from `Client/`. No new dependencies without explicit justification. No service-role key in the client; only `VITE_`-prefixed anon key.

### Existing product features to preserve

- Role-adaptive dashboard, users directory, admin user edit/delete, admin-created accounts, HOD scope via `class_hod_assignments`/`department_hod_assignments`/`classes.hod_id`.
- Academic structure: departments, courses, classes, global degrees, academic sessions/terms, subject catalogue, `class_subjects`, `teacher_assignments`, enrollments. Legacy `subjects.class_id`/`subjects.teacher_id` are deprecated.
- Semester-first examination scheduling. `create_exam_group` materializes template components. `add_exam_subject`. `update_assessment_component_schedule`. Conflict guards. `ExamCalendar`. Assessment setup IA1, IA2, ESA, Quiz, Assignment, Project. Practical/direct-marks lab mode. Classwork is separate from examinations (`classwork_items`, `classwork_submissions`), not a marks source.
- Marks entry. `marks`, `mark_revisions`, `marks_submission_components`. Assessment components. `recalculate_result_sheet`. Credit-weighted SGPA/CGPA. Result codes P, XP, X, F, RW. `assert_result_sheet_ready`. `lab_direct_marks_eligible`.
- Result workflow: `compiled -> hod_approved | hod_rejected -> exam_approved | exam_rejected -> published`. `compile_result_sheet`, `review_result_sheet`, `exam_approve_result_sheet`, `publish_result_sheet`. Legacy `principal_signed` rows remain publishable. Principal sign-off stage was removed. Student notifications on publication.
- Published results are immutable. DB triggers block deleting a published sheet, returning it to an earlier status, changing `published_at`, and writing to published items/components/versions. No correction-version RPC is exposed. Result snapshots: `result_sheets`, `result_items`, `result_sheet_versions`, `result_component_items`, `result_reviews`, `result_student_summaries`.
- Attendance: `attendance_records`, imports, teacher/admin/HOD entry, `AttendanceSummary`, coordinator attendance metrics. Attendance vs academic performance analysis is not yet a full analytics module.
- Classwork: teacher/admin/exam-cell publishing, student submission, teacher review, notifications, classwork import, no exam creation.
- Analytics: `Overview` stats, `PerformanceChart`, `SubjectPerformanceChart`, `ResultPipelineChart`, `RecentResults`, student `MyResults`, SGPA/CGPA, `result_student_summaries`, coordinator `coordinator_monitoring_report`, result archive, printable monitoring report. `PerformanceChart` etc. use real queries.
- Notifications: `notifications` table with `type`, `link`, `payload`, `is_read`, `read_at`; `notification_preferences` (`in_app`, `email`, `events`); realtime INSERT; own-row RLS; notification tamper guard allows only read-state changes; publication/classwork triggers insert notifications. Student full page exists. No header dropdown existed before this session. No notification preferences UI. No category filter. No timetable/helpdesk/revaluation triggers.
- Institution settings, grading schemes, grade bands, `audit_logs`, `result_reviews`. `audit_result_sheet_status`, profile audit. Admin-readable audit. No general helpdesk.
- Edge functions admin-only except public `demo-request`. `demo-request` uses Resend server-side secret `RESEND_API_KEY`.

### Strict design preservation

Do not change colour palette, branding/logo, typography, layout language, or replace the app. Preserve glass tokens in `Client/src/index.css`, light/dark `.dark`, `localStorage` theme, `:focus-visible`, reduced-motion, `transition-colors`/`transition-transform` not `transition-all`, sentence-case labels, no tracked caps, min 11px, `tabular-nums`, no new dependencies, no card-inside-card, no literal colours in markup. Use `Client/src/components/ui.jsx`. Keep every existing link, field, name, id, key, type, href, handler, Supabase call, RPC name, route, and prop. Add markup inside owning component. Keep landing fallbacks. The repo has conflicting font notes: `AGENTS.md` says Newsreader + Geist; `DESIGN.md` says Instrument Serif + Plus Jakarta Sans. Do not silently switch; verify `index.css` and resolve with repo owner before touching typography. This session did not change typography or tokens.

### Findings: incomplete, bugs, duplicates, weaknesses

- `Client/src/src/components/AppLoader.jsx` duplicates `Client/src/components/AppLoader.jsx`. App imports the real one. Remove the unused duplicate only after confirming no imports.
- `DESIGN.md` vs `AGENTS.md` font mismatch. `AGENTS.md` says design locked; resolve before any typography work.
- Notifications page is real-time INSERT only in the existing page; this session adds UPDATE/DELETE handling in the dropdown. Existing page still lacks category filters, preferences UI, read-at display, admin announcements UI, and full revaluation/timetable/helpdesk categories. Existing page mark-all-read does not set `user_id` explicitly; RLS covers it. No revaluation or timetable or helpdesk tables exist.
- `notification_preferences` exists but nothing enforces it for in-app/email; no email sender in app; no preferences UI. `events` JSONB is unused. `read_at` is set by trigger but not shown. Existing page still only subscribes INSERT.
- Analytics are partial. No unified student analytics page. No SGPA/CGPA progression graph beyond score-per-exam plus latest SGPA/CGPA. No subject-wise drill-down across roles. No class-vs-class comparison. No highest/lowest/average across authorized filters. No declining/at-risk list. No attendance-vs-performance correlation. No academic-year/semester/course/subject/student filters in one module. No downloadable analytics exports beyond print. No revaluation metrics.
- No revaluation/result-correction workflow. Result version tables exist and `guard_result_sheet_mutation` says a published sheet can be re-versioned, but no revaluation tables, RPCs, UI, document uploads, faculty recommendation, HOD review, exam-cell finalization, or revised grade-card output. Current repo statement says no correction-version workflow is exposed and published sheets cannot be rebuilt or recalculated.
- No helpdesk ticket system. No timetable-change triggers. No assignment-deadline scheduler. No attendance-alert scheduler. No administrative-announcement workflow.
- Marks entry blocks writes after publication. Revaluation would need a new additive revision path; it must not mutate published versions. See conflicts below.
- `schema.sql` stale; `DESIGN.md` stale remnants inside migrations encoding; duplicate `src/src`. No test suite.
- `result_student_summaries` and `result_sheet_versions` must be used for analytics; do not recompute SGPA/CGPA in the browser. `gradeFor` in `status.js` is fallback only; persisted grades win. No invented metrics.
- `CoordinatorReports` prints but has no CSV/XLSX export. `printReportDocument` exists. `xlsx` is already a dependency but analytics export should reuse existing import utilities or print; no new dependency.
- `Notifications.jsx` marks read without checking update error. `markAllRead` uses `.eq("is_read", false)`. Realtime channel only INSERT in existing page. Harmless but incomplete.
- `DashboardHeader` landing preview path has no profile; `NotificationCenter` returns null when `profile` is null. `PREVIEW_ITEMS`/`fluid` remain intact.
- `RequireRole` for `notifications` previously restricted to students. This session opens it to every active role; sidebar still only lists notifications for students, but header dropdown links work.

## 2. Conflicts with repository rules and requested features

- Strict user requirement "Published results must never be silently overwritten. Maintain complete version history" aligns with repo immutability, but user also asks Exam Cell to "publish a revised result" and "generate updated grade cards." Repo `AGENTS.md` says published results are immutable, no correction-version workflow, published sheet cannot be rebuilt or recalculated. Proposed implementation must not weaken `guard_result_sheet_mutation`, `guard_result_version_mutation`, `guard_result_item_mutation`, `guard_result_component_item_mutation`, RLS, or RPCs. A revaluation should create a new immutable revision version and preserve original; "publish revised result" should point current output at a new version, not rewrite history. This requires repo-owner confirmation because `AGENTS.md` currently says no correction-version workflow and published sheets cannot be rebuilt. Do not implement revaluation migration without that confirmation.
- Marks writes are blocked after publication. Revaluation must not bypass `exam_results_published`. Revised marks should be stored in revaluation tables/version snapshots, not by editing `marks` on a published exam. Original remains auditable.
- Helpdesk, timetable, revaluation, announcements, analytics are not existing roles/tables. Adding them is additive, but new RLS must use security-definer helpers, not inline subqueries against RLS'd tables.
- `AGENTS.md` says no new dependencies. `DESIGN.md` says no new dependencies. No UI/analytics library should be added; Recharts and existing `xlsx` are enough. `@dnd-kit`, date pickers, etc. are out unless explicitly approved.
- User says preserve current architecture/design; repo says no entire redesign, no colour/branding/logo/typography changes. This roadmap adds modules; it does not redesign.
- Notification email preferences cannot work without an email provider. In-app can use existing `notification_preferences`. Email would need Edge Function/Resend; no email sender in notifications today. Do not pretend email is sent. `demo-request` already uses Resend for demo only.
- "Downloadable analytics reports" can use existing print + `xlsx`; no invented metrics. Download must use authorized rows only.
- Roles are fixed enum. No new role unless explicitly approved. Principal cannot publish revaluation unless repo rules say; Exam Cell is final gate before publication. Do not reintroduce principal sign-off.

## 3. Phased roadmap

### Phase 0: Hygiene and safe first slice

Goal: clean baseline without changing behavior.

1. Remove unused `Client/src/src/components/AppLoader.jsx` after grep confirms no imports.
2. Resolve `DESIGN.md`/`AGENTS.md` font documentation. Do not change CSS until verified.
3. Keep `npm run lint` and `npm run build` clean. No formatter. No tests infrastructure in this repo.
4. Document schema invariants. Do not re-run `schema.sql` on migrated DB. Apply additive migrations in order. `npx supabase db push --remote` per repo docs. Verify post-migration counts.
5. Session implemented: `NotificationCenter.jsx`, header integration, notifications route open to every role. No DB migration. No new dependency. No token change.

### Phase 1: Notification center completion (build on existing tables)

Keep existing notifications working. Extend additively.

- Reuse `notifications`. Do not allow client inserts; triggers/RPCs/service-role insert. Own-row read/update/delete only. Only read state mutable.
- Categories: map `type` to categories. Current types include `results_published`, `classwork`, `general`, classwork notification types, `results_published`. Revaluation/timetable/helpdesk/announcement types would be added later. No category enum unless needed; keep `type` text. Add filter in UI. Do not break existing `statusChipClass`.
- Full page for every role. Keep student behavior. Add `read_at`. Mark read updates `is_read`; trigger sets `read_at`. Mark all read own rows. Realtime INSERT/UPDATE/DELETE. `link` internal `/app/...`; `safeLink` only allows `/`. `payload` jsonb read-only.
- Preferences: add UI reading/writing own `notification_preferences`. `in_app`, `email`, `events`. Keep defaults `in_app=true`, `email=false`, `events={}`. Enforce `in_app` when inserting? Careful: system triggers currently insert regardless. Phase 1 should make triggers respect preferences for optional categories, not mandatory results. Do not silently disable required academic notices. Email must be separate; no fake email.
- Notification dropdown uses native button, `aria-expanded`, `aria-controls`, Escape, outside click, no `role="menu"` without full menu keyboard. `Button` type="button". No `transition-all`. No new CSS tokens. Modern Web Guidance `viewport-aware-dropdowns` suggests native Popover + CSS anchor positioning with fallbacks; current controlled dropdown is simpler and preserves design. A future pass can use `popover="auto"` + `@supports`, but not required for this slice.
- Triggers to add later: revaluation update, assignment deadline, attendance alert, timetable change, administrative announcement, helpdesk ticket update. Must insert through security-definer. Deadlines need scheduling (`pg_cron`/Edge scheduled function) or app reminder; not invented.

### Phase 2: Advanced academic analytics

Goal: one analytics module using actual authorized records. Do not create sample data.

Existing foundation: `result_items`, `result_student_summaries`, `result_sheets`, `result_sheet_versions`, `student_enrollments`, `class_subjects`, `subjects`, `classes`, `departments`, `courses`, `degrees`, `academic_sessions`, `academic_terms`, `attendance_records`, `marks`. `coordinator_monitoring_report`. Recharts.

Recommended approach: add security-definer RPCs/views, not client-side aggregation over thousands. Preserve RLS. No service-role. Authorized scope: student own; teacher assigned; HOD scope; exam_cell/admin/principal per current policies; coordinator read-only per `202611130002`. No invented numbers; `Not recorded`/null when no data. Do not analyze unpublished results unless role may see; default analytics on published semester results. Keep `isSemesterSheet`. Do not count internal papers in SGPA/CGPA. `RW` excluded from denominators. Withheld not backlog. Credit-weighted; never average SGPAs. CGPA cumulative points / cumulative credits.

Features mapped to request:

- Individual student performance analytics. New `/app/analytics` or extend `MyResults` + coordinator. Reuse `result_student_summaries`. Show percentage, SGPA, CGPA, grade, pass/fail, backlogs, withheld, credits, subject breakdown.
- Semester-wise tracking. Order by `academic_sessions`, `academic_terms`, `classes.semester`, exam `academic_year`. Do not infer semester from name. `isSemesterSheet` semantics.
- SGPA/CGPA progression graphs. Use persisted `sgpa`/`cgpa` per sheet; only official semester results. `MyResults` currently has score-per-exam; add SGPA/CGPA line chart. Keep `chartAxis`/`chartTooltip`.
- Subject-wise analysis. highest/lowest/average marks, pass/fail %, count. `result_items`. Subject filter. Class/department comparison.
- Class performance comparison. `coordinator_monitoring_report` class table. Add class-vs-class. `can_view_class`.
- Department performance. `coordinator_monitoring_report` department table. `departments`. Add degree/course.
- Highest, lowest, average marks. SQL min/max/avg over `result_items`; not hardcoded. Keep `null` if no data.
- Pass percentage/failure percentage. Use `result_student_summaries.is_pass`/`result_code` and `result_items.is_pass`. Define pass = `is_pass` true and not withheld; `RW` separate. Do not count missing as fail. `XP` passing with backlog. `X` not promoted. Document.
- Attendance vs academic performance. Join `attendance_records` to `result_items` by student/class/subject/period. `AttendanceSummary`. Correlation only with sufficient N; no causal claims. Attendance % not recalculated in JS if SQL can. No invented. Attendance totals applied per class on entry; keep.
- Declining students. Compare consecutive semester `sgpa`/`percentage`; define threshold; require at least 2 semesters; flag negative delta. Not fabricate.
- Academic support / at-risk. Rule-based: failing subjects, backlogs, low SGPA, low attendance, declining trend, missing marks. `assert_result_sheet_ready` prevents ungraded publish; still show not recorded for gaps. Authorized roles only. No automated discipline. Notification optional later; teacher action.
- Downloadable analytics reports. CSV/XLSX using existing `xlsx`; print via `printReportDocument`. Include filters, generated time, institution, no unauthorized rows. No new dependency.
- Filters: academic year, semester, department, course, subject, individual student. Existing `CoordinatorReports` has department/class/exam/search. Extend; don't break. `Academic year`/`semester` from `classes`/`academic_sessions`. `course` from `courses`. `subject`. `student`.
- Charts: Recharts. `useChartMotion`. axis labels >=11px. `tabular-nums`. `prefers-reduced-motion`. No `transition-all`. No invented trend arrows. `PerformanceChart`, `SubjectPerformanceChart` preserve. `SubjectPerformanceChart` etc. not rename.
- Keep existing `coordinator_monitoring_report` signature. Add new RPCs additively; don't alter `recalculate_result_sheet`. Analytics reads; grading remains DB. `printReportDocument` existing.

### Phase 3: Revaluation / result correction system

Conflict: implement only after repo-owner confirms relaxing the current "no correction-version workflow" note. The DB triggers already prevent mutating published history; revaluation should not require dropping them. Reuse `result_sheet_versions` + `result_reviews` where possible. Original published version remains immutable. New version inserted, not updated in place. `result_sheets` published status stays published; `published_at` unchanged. Current output pointer can move only via new security-definer RPC. No `recalculate_result_sheet` on a published original. No client writes. Preserve grade-card `print.js`. No silent overwrite. `marks` on published exam remains blocked.

Proposed additive schema (not implemented):

- `revaluation_requests`: id, sheet_id, student_id, subject_id, version_id, requested_by, semester, reason, status, documents, created_at, updated_at. Status e.g. `submitted`, `faculty_review`, `hod_review`, `exam_cell_review`, `approved`, `rejected`, `published_revision`, `withdrawn`. Use existing roles.
- `revaluation_documents`: request_id, storage_path, uploaded_by, created_at. Supabase Storage private bucket; own-row/scoped read; no public. Not implemented. If docs not required, skip. Do not hardcode.
- `revaluation_recommendations`: request_id, actor_id, actor_role, revised_marks jsonb, justification, remarks, created_at. Faculty revises marks; original snapshot preserved. Faculty assigned to subject only (`is_subject_teacher`, `teaches_exam_subject`). HOD scope `is_sheet_hod`/`is_class_hod`/`is_department_hod`. Exam Cell `is_exam_cell`. Student own.
- `revaluation_audit`: append-only events; also insert `audit_logs`. No client writes. `result_reviews` can record decisions but not enough for request lifecycle. Keep `result_reviews` for sheet approvals; add revaluation audit. No editing history.
- `result_sheet_versions` new version N+1 for exam-cell finalization. Copy original snapshot; apply approved revised marks in new `result_items`/`result_component_items` for new `version_id`; recalculate into new version; never update old version. `correction_reason`, `published_by`, `published_at`. Set `current_version_id`/`current_version_number` via security-definer. Keep original `published_at`. Notify students. Maintain previous versions readable. Exam Cell finalizes; not silently. If repo wants no result mutation, a separate `result_revisions` read model can point to original + revision without touching `result_sheets`.
- Notifications `type='revaluation_update'`, link to request/revised grade card. Notification on submit, faculty action, HOD decision, exam-cell finalization, publication, rejection. No silent.
- Revised grade card: `print.js` must render version used; original grade card remains reproducible. `result_student_summaries` must be per version/sheet carefully. Current `result_student_summaries` keyed by sheet; need inspect before implementing. Do not break `MyResults`. If not version-aware, use revised snapshot not `recalculate` on original. This is a key open question.
- RLS: student can create own request for own published item; read own; not read other students. Teacher reads assigned. HOD reads scope. Exam Cell reads. `app_role`, `is_admin`, `is_class_hod`, `is_subject_teacher`, `is_sheet_hod`, `is_exam_cell`. `require_active_user`, `require_role`. No inline RLS subqueries. No service-role client. No direct writes. `SECURITY DEFINER` RPCs with `search_path=public,pg_temp`, `revoke ... from anon,public`, `grant ... to authenticated`.
- RPCs additive: `submit_revaluation_request`, `faculty_review_revaluation`, `hod_review_revaluation`, `exam_finalize_revaluation`, `withdraw_revaluation_request`. Exact names not chosen. No implementation. Do not rename existing `review_result_sheet`/`exam_approve_result_sheet`/`publish_result_sheet`.
- Keep `assert_result_sheet_ready` for normal publish. Revaluation revised version must also be ready: no missing marks/credits/ungraded. `recalculate_result_sheet` for revised version only. `RW` semantics. Not silently pass. No correction to already revised after publish without new revaluation.
- Conflict restated: current repo says published sheet cannot be rebuilt/recalculated. Revaluation needs explicit product + DB change. Recommend not mutating published version; create new version. Get repo-owner approval. Do not drop immutability triggers. 

### Phase 4: Extend notifications for new workflows

Once Phase 1-3 tables exist, add triggers. Revaluation update. Assignment creation already classwork notification; assignment deadlines need scheduler. Attendance alerts need threshold + not spam. Timetable changes need a timetable table; none exists. Important administrative announcements need admin UI + recipient scope; none exists. Helpdesk ticket updates need helpdesk tables; none exists. Do not fake. 

### Phase 5: QA, security, performance

- `npm run lint`, `npm run build`. No tests currently; add tests only if test infra approved. SQL verification queries from `README.md`. `select` checks. RLS review. `revoke execute ... from anon,public`. `require_active_user`. `search_path`. No service-role. No client `result_sheets` writes. No dummy data. No invented metrics. No hardcoded school names/degrees. No em dash/middle-dot/arrow copy per design. No `outline-none` without replacement. No `uppercase` tracked caps. No new colors. No `transition-all`. Min 11px. `focus-visible`. `tabular-nums`. `prefers-reduced-motion`. Four data states. Eight control states. Skeletons. Error inline. No `AppLoader` duplicate. Keep `PREVIEW_ITEMS`. Keep landing fallbacks. Keep `NAV_BY_ROLE`. Keep `RequireRole`. 
- Performance: SQL indexes; avoid N+1; `Promise.all`; `cancelled`; `React.memo` where useful; no global re-render; Recharts `ResponsiveContainer`; no huge client aggregation. Published results immutable snapshot for stable analytics. Realtime notification channel cleanup. `removeChannel`.
- Accessibility: keyboard, focus, labels, `aria-*`, `role=alert`, no color-only. `Empty`. 
- No claim complete without running lint/build and DB verification. 

## 4. What this session changed

- Added `Client/src/components/dashboard/NotificationCenter.jsx`.
- `DashboardHeader.jsx` renders `NotificationCenter` for signed-in users; no change for landing preview.
- `App.jsx` opens `/app/notifications` to every role.
- Added `docs/GRADIA_2_ROADMAP.md`.
- Did not change `Client/src/index.css`, tokens, typography, branding, `ui.jsx`, result tables, workflow RPCs, RLS, migrations, or existing pages' wiring. No new dependency. No hardcoded data. No test data. No service-role key. No DB writes beyond normal notification read-state updates already allowed.
- Did not implement advanced analytics, revaluation, helpdesk, timetable, announcements, preferences UI, email, or DB migrations. Those are roadmap items, not claims.

## 5. Recommended next concrete slice

Pick one. The safest is Phase 1 notification preferences + category filter + page polish (no DB migration for filters; preferences use existing table). Next safe slice without DB changes is Phase 2 analytics using existing `result_student_summaries` + `coordinator_monitoring_report` read-only. Revaluation must wait for repo-owner confirmation on current published-result immutability. No need to redesign. No need for new dependency.

## 6. Verification

For any code slice: run `npm run lint` and `npm run build` from `Client/`. For DB slices: apply additive migration in order; run repo post-migration checks; verify no client `result_sheets`/`result_items` writes; verify RLS; verify no service-role key. Do not claim tests passed unless run. Do not claim published result correction works unless DB verified. This roadmap itself does not require lint/build; no app code changed in the roadmap file. Notification slice requires lint/build; results recorded in session output, not in this file.
