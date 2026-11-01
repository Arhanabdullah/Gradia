# AGENTS.md — Gradia (Student Result Management System)

Single npm package (`Client/`) + Supabase backend. All app code is plain JavaScript (JSX); no TypeScript anywhere.

## Architecture
- `Client/` — React 19 + Vite 7 + Tailwind 4. Talks **directly** to Supabase (no Express/API layer of our own).
  - `src/lib/supabase.js` (client), `src/context/AuthContext.jsx` (session + profile; fetches `*, classes ( name )`), `src/components/ui.jsx` (shared form/card/chip primitives; non-component constants live in `src/lib/status.js`), `src/lib/db.js` (fetch/insert/RPC helpers).
  - `src/components/dashboard/DashboardLayout.jsx` — role-driven sidebar nav (one place to add pages); `App.jsx` gates every route via `<RequireRole role="…">`.
  - `src/pages/` — `Landing` (public), `Login`, role-adaptive `Overview`, and per-role folders: `admin/`, `teacher/`, `hod/`, `principal/`, `student/`.
- `supabase/schema.sql` — the entire backend: tables, RLS, workflow RPCs, auto-profile trigger. **Re-runnable** (tolerant enums/tables, drop-first policies). Run once in the Supabase SQL editor; it is the source of truth for permissions and workflow.
  - `supabase/functions/create-user/index.js` — the only server code: Edge Function (plain JS) so admins can create accounts from the UI. Deploy: `npx supabase functions deploy create-user --project-ref <ref>` (auto-injected env, no config needed). Bootstrap steps live in the root README.
- Accounts are **admin-created only** (no public signup). The trigger `handle_new_user` builds `profiles` from `user_metadata` (`name`, `username`, `role`, `department`, `class_id`).
- Students download published results as print-to-PDF: `src/pages/student/MyResults.jsx` `downloadSheet()` writes plain HTML (no Tailwind) into a popup and calls `print()`.

## Workflow (enforced in the DB, not the UI)
`marks` (teacher) → `compile_result_sheet` (admin) → `review_result_sheet` approve/reject (HOD) → `sign_off_result_sheet` → `publish_result_sheet` (principal; also inserts student `notifications`). Statuses: `compiled → hod_approved | hod_rejected → principal_signed → published`.
- Never write `result_sheets`/`result_items` from the client — snapshots are RPC-controlled and RLS blocks direct writes.
- Client must never hold the service-role key; only the anon key lives in `Client/.env` (`VITE_`-prefixed).

## Commands
- From `Client/`: `npm run dev`, `npm run build`, `npm run lint` (ESLint — the only check; no tests, no CI).
- `npm audit` flags dev-only vite advisories; don't chase them.

## Gotchas
- **The landing page shares dashboard components.** `ProductPreview.jsx` renders `<DashboardSidebar fluid />` and `<DashboardHeader />` with no props — the sidebar has `PREVIEW_ITEMS`/`fluid` fallbacks and the header hides auth controls when `profile` is null. Preserve those fallbacks or the landing page crashes (`items.map` of undefined).
- ESLint quirk (verified): this config's `no-unused-vars` does **not** count JSX usage, which is why `eslint.config.js` runs `react/jsx-uses-vars` and ignores the rule under `src/context/**`. Don't remove them — lint will flood false `motion is unused` errors.
- Role enum is a Postgres type: `student | teacher | hod | principal | admin`. Roles/activation are admin-only (RLS blocks self-update).
- Write per-row permission checks as security-definer helpers (`app_role`, `is_admin`, `is_class_hod`, `is_subject_teacher`, `is_sheet_hod`), never inline subqueries against RLS'd tables (recursion risk).
- Login expects "Confirm email" OFF in Supabase Auth (admin-managed accounts); the Edge Function sets `email_confirm: true` per user anyway.
- Theming: `.dark` class on `<html>` via `src/lib/theme.js`, called from `main.jsx`; persisted in `localStorage`.
