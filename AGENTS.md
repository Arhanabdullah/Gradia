# AGENTS.md — Gradia (Student Result Management System)

Single npm package (`Client/`) + Supabase backend. All app code is plain JavaScript (JSX); no TypeScript anywhere.

> **Design system is locked.** The Hallmark redesign (see `DESIGN.md` at the repo root) keeps the glass token system in `Client/src/index.css` (light + `.dark`), Newsreader (display) + Geist (UI) faces, and sentences-case untracked labels. All interactive elements rely on the global `:focus-visible` ring and `prefers-reduced-motion` fallback in `index.css` — never add `outline-none` without a replacement ring, never use `transition-all`, never tracked-caps `uppercase` labels, no em-dash/middle-dot/glued-arrow copy, min text size 11px. Shared primitives live in `Client/src/components/ui.jsx` (all 8 control states).

## Architecture

- `Client/` — React 19 + Vite 7 + Tailwind 4. Talks **directly** to Supabase (no Express/API layer of our own).
  - `src/lib/supabase.js` (client), `src/lib/db.js` (RPC helpers), `src/lib/status.js` (constants), `src/lib/theme.js` (dark-mode toggle), `src/lib/exams.js` (exam utilities).
  - `src/context/AuthContext.jsx` — session + profile; fetches `*, classes ( name ), departments ( name ), courses ( name ), degrees ( name )`. Profile also includes `degree_id`, `department_id`, `course_id`, `class_id`, `hod_type`, `hod_subject_id`, `is_active`, `student_id`, `teacher_id`, `username`, `phone`, `updated_at`.
  - `src/components/ui.jsx` — shared form/card/chip primitives; all 8 control states.
  - `src/components/dashboard/DashboardLayout.jsx` — role-driven sidebar nav (one place to add pages); `App.jsx` gates every route via `<RequireRole role="…">`.
  - `src/pages/` — `Landing` (public), `Login`, role-adaptive `Overview`, and per-role folders: `admin/`, `teacher/`, `hod/`, `principal/`, `student/`.
  - `src/components/import/` — File import wizard for bulk data (Excel/CSV/JSON).
  - Students download published results as print-to-PDF: `src/pages/student/MyResults.jsx` `downloadSheet()` writes plain HTML (no Tailwind) into a popup and calls `print()`.

- `supabase/schema.sql` — the legacy baseline (Phase 1). Run once in the Supabase SQL Editor; **do not re-run on a migrated database**. Bootstrap order lives in `supabase/migrations/README.md`.

- `supabase/migrations/` — Phased migrations (Phase 2, 3, 4) that extend the baseline schema:
  - `202611050001_gradia_academic_structure.sql` — departments, courses, profile extensions, triggers.
  - `202611050002_class_subject_catalogue.sql` — `class_subjects`, `teacher_assignments` tables.
  - `202611060001-0006` — academic sessions, subjects, enrollments, HOD assignments, exams/components/marks, result versioning, audit/logs/notifications.
  - `202611070001-0004` — Phase 3 security helpers, triggers, RLS policies, guarded workflow RPCs.
  - `202611090001` — Exam scheduling fields.
  - `202611100001-0003` — Degrees, class subject scheduling, multi-teacher assignments.

- `supabase/functions/` — Edge Functions (server-side code):
  - `create-user/index.js` — Admin-only account creation with validated role/scope.
  - `set-user-active/index.js` — Toggle `is_active` + ban/unban auth session.

## Workflow (enforced in the DB, not the UI)

`marks` (teacher) → `compile_result_sheet` (admin) → `review_result_sheet` approve/reject (HOD) → `sign_off_result_sheet` → `publish_result_sheet` (principal; also inserts student `notifications`). Statuses: `compiled → hod_approved | hod_rejected → principal_signed → published`.

- Never write `result_sheets`/`result_items` from the client — snapshots are RPC-controlled and RLS blocks direct writes.
- Result versioning (`result_sheet_versions`, `result_component_items`, `result_reviews`) supports corrections via new versions.
- Client must never hold the service-role key; only the anon key lives in `Client/.env` (`VITE_`-prefixed).

## Migration Flow

1. Run `supabase/schema.sql` once in Supabase SQL Editor.
2. Add your admin account via **Authentication → Users → Add user**.
3. Uncomment and run the admin grant block in `schema.sql`.
4. Deploy Edge Functions:
   ```bash
   npx supabase functions deploy create-user --project-ref <ref>
   npx supabase functions deploy set-user-active --project-ref <ref>
   ```
5. Apply migrations (in order) via `npx supabase db push` or SQL Editor, or use the staging runbook in `supabase/migrations/README.md`.

## Commands

- From `Client/`: `npm run dev`, `npm run build`, `npm run lint` (ESLint — the only check; no tests, no CI).
- `npm audit` flags dev-only vite advisories; don't chase them.

## Gotchas

- **The landing page shares dashboard components.** `ProductPreview.jsx` renders `<DashboardSidebar fluid />` and `<DashboardHeader />` with no props — the sidebar has `PREVIEW_ITEMS`/`fluid` fallbacks and the header hides auth controls when `profile` is null. Preserve those fallbacks or the landing page crashes (`items.map` of undefined).
- **Import feature** allows admins to upload Excel/CSV/JSON for bulk creation of departments, courses, classes, subjects, users, exams, and marks. File size cap: 10 MB, row cap: 5,000. No direct writes to `result_sheets`/`result_items`.
- **Subject HOD scope** requires `subject_hod_assignments` table (Phase 5). Creating a subject HOD on a Phase 3/4 database leaves them with no effective scope.
- **Published results are immutable.** Corrections require a new version via Phase 4/7 workflows.
- **Degrees are required** for new students, courses, classes, and department HODs after Phase 3/4 migration. Existing records may have `degree_id = NULL`.
- **Legacy `subjects.class_id` and `subjects.teacher_id`** columns are preserved but deprecated; use `class_subjects` and `teacher_assignments` instead.
- **ESLint quirk (verified):** this config's `no-unused-vars` does **not** count JSX usage, which is why `eslint.config.js` runs `react/jsx-uses-vars` and ignores the rule under `src/context/**`. Don't remove them — lint will flood false `motion is unused` errors.
- **Role enum** is a Postgres type: `student | teacher | hod | principal | admin`. Roles/activation are admin-only (RLS blocks self-update). Deactivated profiles cannot read anything or call RPCs.
- **Write per-row permission checks** as security-definer helpers (`app_role`, `is_admin`, `is_class_hod`, `is_subject_teacher`, `is_sheet_hod`, `teaches_class`, `require_role`), never inline subqueries against RLS'd tables (recursion risk).
- **Login expects "Confirm email" OFF** in Supabase Auth (admin-managed accounts); the Edge Function sets `email_confirm: true` per user anyway.
- **Theming:** `.dark` class on `<html>` via `src/lib/theme.js`, called from `main.jsx`; persisted in `localStorage`.

## Sidebar Navigation by Role

| Role | Routes |
|------|--------|
| admin | `/app` (Overview), `/app/users`, `/app/classes`, `/app/exams`, `/app/sheets` |
| teacher | `/app` (Overview), `/app/exams`, `/app/marks` |
| hod | `/app` (Overview), `/app/exams`, `/app/review` |
| principal | `/app` (Overview), `/app/publish` |
| student | `/app` (Overview), `/app/results`, `/app/notifications` |

## Environment

```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-public-key>
```