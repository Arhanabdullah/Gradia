# AGENTS.md — Gradia (Student Result Management System)

Single npm package (`Client/`) + Supabase backend. All app code is plain JavaScript (JSX); no TypeScript anywhere.

> **Design system is locked.** The Hallmark redesign (see `DESIGN.md` at the repo root) keeps the glass token system in `Client/src/index.css` (light + `.dark`), Newsreader (display) + Geist (UI) faces, and sentences-case untracked labels. All interactive elements rely on the global `:focus-visible` ring and `prefers-reduced-motion` fallback in `index.css` — never add `outline-none` without a replacement ring, never use `transition-all`, never tracked-caps `uppercase` labels, no em-dash/middle-dot/glued-arrow copy, min text size 11px. Shared primitives live in `Client/src/components/ui.jsx` (all 8 control states).

## Architecture
- `Client/` — React 19 + Vite 7 + Tailwind 4. Talks **directly** to Supabase (no Express/API layer of our own).
  - `src/lib/supabase.js` (client), `src/context/AuthContext.jsx` (session + profile; fetches `*, classes ( name )`), `src/components/ui.jsx` (shared form/card/chip primitives; non-component constants live in `src/lib/status.js`), `src/lib/db.js` (fetch/insert/RPC helpers).
  - `src/components/dashboard/DashboardLayout.jsx` — role-driven sidebar nav (one place to add pages); `App.jsx` gates every route via `<RequireRole role="…">`.
  - `src/pages/` — `Landing` (public), `Login`, role-adaptive `Overview`, and per-role folders: `admin/`, `teacher/`, `hod/`, `principal/`, `student/`, `exam_cell/`, `coordinator/`.
- `supabase/migrations/` — **the source of truth** for schema, RLS, helpers and workflow RPCs. Apply with `npx supabase db push --remote`. `supabase/schema.sql` is the original baseline and is now **stale** (it predates the Exam Cell, coordinator, grading engine and registration-number work); do not treat it as current.
  - `supabase/functions/create-user/index.js` — the only server code: Edge Function (plain JS) so admins can create accounts from the UI. Deploy: `npx supabase functions deploy create-user --project-ref <ref>` (auto-injected env, no config needed). Bootstrap steps live in the root README.
- Accounts are **admin-created only** (no public signup). The trigger `handle_new_user` builds `profiles` from `user_metadata` (`name`, `username`, `role`, `department`, `class_id`, `registration_no`).
- Students download published results as a print-to-PDF grade card: `src/lib/print.js` builds the Techno India style document (plain HTML, no Tailwind) and `src/pages/student/MyResults.jsx` opens it in a popup and calls `print()`.

## Workflow (enforced in the DB, not the UI)
`marks` (teacher) → `compile_result_sheet` (admin or Exam Cell) → `review_result_sheet` approve/reject (HOD) → `exam_approve_result_sheet` approve/reject (Exam Cell) → `publish_result_sheet` (Exam Cell or principal; also inserts student `notifications`). Statuses: `compiled → hod_approved | hod_rejected → exam_approved | exam_rejected → published`. The principal sign-off step was removed; Exam Cell approval is the final gate before publication. Legacy `principal_signed` rows remain publishable.
- Never write `result_sheets`/`result_items` from the client — snapshots are RPC-controlled and RLS blocks direct writes.
- **Published results are immutable.** DB triggers block deleting a published sheet, moving it back to an earlier status, changing its publication timestamp, and writing to published items/components/versions. There is no correction-version workflow yet, so a published sheet cannot be rebuilt or recalculated — plan for it to stay as issued.
- `recalculate_result_sheet` owns grades, earned points, result codes and SGPA/CGPA. Exam Cell approval and publication call `assert_result_sheet_ready` first, which blocks on ungraded items, missing marks and missing credits (a subject with no `credit_hours` blocks the sheet).
- Grading is credit-weighted: SGPA = semester earned points / semester credits, CGPA = cumulative earned points / cumulative credits (never an average of SGPAs). Withheld (`RW`) items earn no points and are excluded from the denominators.
- Client must never hold the service-role key; only the anon key lives in `Client/.env` (`VITE_`-prefixed).

## Commands
- From `Client/`: `npm run dev`, `npm run build`, `npm run lint` (ESLint — the only check; no tests, no CI).
- `npm audit` flags dev-only vite advisories; don't chase them.

## Gotchas
- **The landing page shares dashboard components.** `ProductPreview.jsx` renders `<DashboardSidebar fluid />` and `<DashboardHeader />` with no props — the sidebar has `PREVIEW_ITEMS`/`fluid` fallbacks and the header hides auth controls when `profile` is null. Preserve those fallbacks or the landing page crashes (`items.map` of undefined).
- ESLint quirk (verified): this config's `no-unused-vars` does **not** count JSX usage, which is why `eslint.config.js` runs `react/jsx-uses-vars` and ignores the rule under `src/context/**`. Don't remove them — lint will flood false `motion is unused` errors.
- Role enum is a Postgres type: `student | teacher | hod | principal | admin | coordinator | exam_cell`. Roles/activation are admin-only (RLS blocks self-update).
- HOD review resolves through `class_hod_assignments`, `department_hod_assignments` or the legacy `classes.hod_id` — an HOD with none of those assigned cannot review any sheet. `profiles.department`/`class_id` do not grant HOD scope.
- Write per-row permission checks as security-definer helpers (`app_role`, `is_admin`, `is_class_hod`, `is_subject_teacher`, `is_sheet_hod`), never inline subqueries against RLS'd tables (recursion risk).
- Login expects "Confirm email" OFF in Supabase Auth (admin-managed accounts); the Edge Function sets `email_confirm: true` per user anyway.
- Theming: `.dark` class on `<html>` via `src/lib/theme.js`, called from `main.jsx`; persisted in `localStorage`.
