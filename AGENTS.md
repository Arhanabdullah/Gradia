# AGENTS.md — Gradia (Student Result Management System)

Single npm package (`Client/`) + Supabase backend. All app code is plain JavaScript (JSX); no TypeScript anywhere.

> **Design system is locked.** The Hallmark redesign (see `DESIGN.md` at the repo root) keeps the glass token system in `Client/src/index.css` (light + `.dark`), Newsreader (display) + Geist (UI) faces, and sentences-case untracked labels. All interactive elements rely on the global `:focus-visible` ring and `prefers-reduced-motion` fallback in `index.css` — never add `outline-none` without a replacement ring, never use `transition-all`, never tracked-caps `uppercase` labels, no em-dash/middle-dot/glued-arrow copy, min text size 11px. Shared primitives live in `Client/src/components/ui.jsx` (all 8 control states).

## Architecture

- `Client/` — React 19 + Vite 7 + Tailwind 4. Talks **directly** to Supabase (no Express/API layer of our own).
  - `src/lib/supabase.js` (client), `src/lib/db.js` (RPC helpers), `src/lib/status.js` (constants), `src/lib/theme.js` (dark-mode toggle), `src/lib/exams.js` (exam utilities), `src/lib/print.js` (grade-card document builder).
  - `src/context/AuthContext.jsx` — session + profile; fetches `*, classes ( name ), departments ( name ), courses ( name ), degrees ( name )`. Profile also includes `degree_id`, `department_id`, `course_id`, `class_id`, `hod_type`, `hod_subject_id`, `is_active`, `student_id`, `teacher_id`, `username`, `phone`, `updated_at`. Exposes `sessionReady` so deep links survive the first async `getSession()`.
  - `src/components/ui.jsx` — shared form/card/chip primitives; all 8 control states.
  - `src/components/dashboard/DashboardSidebar.jsx` — the single `NAV_BY_ROLE` table (one place to add pages), plus `PREVIEW_ITEMS`/`fluid` fallbacks for the landing page. `src/components/dashboard/DashboardLayout.jsx` is the shell (skip link, collapsible sidebar, `#main-content`, `BackToTop`, `ErrorBoundary` + `Suspense` around `<Outlet />`); `App.jsx` gates every route via `<RequireRole role="…">` / `<RequireRole roles={[…]}>` and lazy-loads each screen behind `AppLoader`.
  - `src/pages/` — `Landing` (public), `Login`, `RequestDemo`, `NotFound`, role-adaptive `Overview`, and per-role folders: `admin/`, `teacher/`, `hod/`, `principal/`, `student/`, `exam_cell/`, `coordinator/`.
  - `src/components/import/` — file import wizard for bulk data (Excel/CSV/JSON). 10 MB file cap, 5,000 row cap. Never writes `result_sheets`/`result_items`.
- `supabase/migrations/` — **the source of truth** for schema, RLS, helpers and workflow RPCs. Apply with `npx supabase db push --remote`. `supabase/schema.sql` is the original baseline and is now **stale** (it predates the Exam Cell, coordinator, grading engine and registration-number work); do not treat it as current. Bootstrap order lives in `supabase/migrations/README.md`.
- `supabase/functions/` — the only server code (plain-JS Edge Functions):
  - `create-user/index.js` — admin-only account creation with validated role/scope.
  - `set-user-active/index.js` — toggle `is_active` + ban/unban the auth session.
  - `demo-request/index.js` — public landing-page demo form; emails the request through Resend (`RESEND_API_KEY` lives in function secrets, never in the client).
- Accounts are **admin-created only** (no public signup). The trigger `handle_new_user` builds `profiles` from `user_metadata` (`name`, `username`, `role`, `department`, `class_id`, `registration_no`).
- Students download published results as a print-to-PDF grade card: `src/lib/print.js` builds the Techno India style document (plain HTML, no Tailwind) and `src/pages/student/MyResults.jsx` opens it in a popup and calls `print()`.

## Workflow (enforced in the DB, not the UI)
`marks` (teacher) → `compile_result_sheet` (admin or Exam Cell) → `review_result_sheet` approve/reject (HOD) → `exam_approve_result_sheet` approve/reject (Exam Cell) → `publish_result_sheet` (Exam Cell or principal; also inserts student `notifications`). Statuses: `compiled → hod_approved | hod_rejected → exam_approved | exam_rejected → published`. The principal sign-off step was removed; Exam Cell approval is the final gate before publication. Legacy `principal_signed` rows remain publishable.
- Never write `result_sheets`/`result_items` from the client — snapshots are RPC-controlled and RLS blocks direct writes.
- **Published results are immutable.** DB triggers block deleting a published sheet, moving it back to an earlier status, changing its publication timestamp, and writing to published items/components/versions. There is no correction-version workflow yet, so a published sheet cannot be rebuilt or recalculated — plan for it to stay as issued.
- `recalculate_result_sheet` owns grades, earned points, result codes and SGPA/CGPA. Exam Cell approval and publication call `assert_result_sheet_ready` first, which blocks on ungraded items, missing marks and missing credits (a subject with no `credit_hours` blocks the sheet).
- Grading is credit-weighted: SGPA = semester earned points / semester credits, CGPA = cumulative earned points / cumulative credits (never an average of SGPAs). Withheld (`RW`) items earn no points and are excluded from the denominators.
- Client must never hold the service-role key; only the anon key lives in `Client/.env` (`VITE_`-prefixed).

## Migration Flow

1. Add your admin account via **Authentication → Users → Add user**.
2. Uncomment and run the admin grant block in `supabase/schema.sql` (fresh projects only).
3. Deploy Edge Functions:
   ```bash
   npx supabase functions deploy create-user --project-ref <ref>
   npx supabase functions deploy set-user-active --project-ref <ref>
   npx supabase functions deploy demo-request --project-ref <ref>
   ```
4. Apply migrations (in order) via `npx supabase db push` or the SQL Editor, or use the staging runbook in `supabase/migrations/README.md`.
5. `supabase/schema.sql` is the legacy baseline (Phase 1): run it once on a fresh project only, never on a migrated database.

## Commands

- From `Client/`: `npm run dev`, `npm run build`, `npm run lint` (ESLint — the only check; no tests, no CI).
- `npm audit` flags dev-only vite advisories; don't chase them.

## Gotchas

- **The landing page shares dashboard components.** `ProductPreview.jsx` renders `<DashboardSidebar fluid />` and `<DashboardHeader />` with no props — the sidebar has `PREVIEW_ITEMS`/`fluid` fallbacks and the header hides auth controls when `profile` is null. Preserve those fallbacks or the landing page crashes (`items.map` of undefined). Charts stay lazy-loaded there behind `chartFallback`.
- **Import feature** allows admins to upload Excel/CSV/JSON for bulk creation of departments, courses, classes, subjects, users, exams, and marks. File size cap: 10 MB, row cap: 5,000. No direct writes to `result_sheets`/`result_items`.
- ESLint quirk (verified): this config's `no-unused-vars` does **not** count JSX usage, which is why `eslint.config.js` runs `react/jsx-uses-vars` and ignores the rule under `src/context/**`. Don't remove them — lint will flood false `motion is unused` errors.
- Role enum is a Postgres type: `student | teacher | hod | principal | admin | coordinator | exam_cell`. Roles/activation are admin-only (RLS blocks self-update); deactivated profiles cannot read anything or call RPCs.
- HOD review resolves through `class_hod_assignments`, `department_hod_assignments` or the legacy `classes.hod_id` — an HOD with none of those assigned cannot review any sheet. `profiles.department`/`class_id` do not grant HOD scope.
- Write per-row permission checks as security-definer helpers (`app_role`, `is_admin`, `is_class_hod`, `is_subject_teacher`, `is_sheet_hod`), never inline subqueries against RLS'd tables (recursion risk).
- Legacy `subjects.class_id` and `subjects.teacher_id` columns are preserved but deprecated; use `class_subjects` and `teacher_assignments` instead.
- Login expects "Confirm email" OFF in Supabase Auth (admin-managed accounts); the Edge Function sets `email_confirm: true` per user anyway.
- Theming: `.dark` class on `<html>` via `src/lib/theme.js`, called from `main.jsx`; persisted in `localStorage`.

## Sidebar Navigation by Role

| Role | Routes |
|------|--------|
| admin | `/app` (Overview), `/app/directory`, `/app/users`, `/app/classes`, `/app/exams`, `/app/attendance`, `/app/sheets` |
| teacher | `/app` (Overview), `/app/directory`, `/app/exams`, `/app/marks`, `/app/attendance` |
| hod | `/app` (Overview), `/app/directory`, `/app/exams`, `/app/attendance`, `/app/review` |
| principal | `/app` (Overview), `/app/directory`, `/app/publish` |
| student | `/app` (Overview), `/app/results`, `/app/notifications` |
| coordinator | `/app` (Overview), `/app/reports`, `/app/archive`, `/app/directory` |
| exam_cell | `/app` (Overview), `/app/exams`, `/app/config`, `/app/assessment`, `/app/approval`, `/app/sheets`, `/app/archive`, `/app/directory` |

## Environment

```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-public-key>
```

`RESEND_API_KEY` belongs in the `demo-request` function secrets (server-side only), never in `Client/.env`.
