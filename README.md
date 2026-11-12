# Gradia

### Student Result Management System (Supabase-backed)

Gradia is a full-stack Student Result Management System for managing, reviewing, approving, and publishing student academic results.

The system provides different interfaces and permissions for students, teachers, administrators, HODs, and principals, creating a structured result management and approval workflow.

**Stack:** React 19 + Vite + Tailwind 4 (client) · Supabase (Postgres + Auth + Row Level Security + Edge Functions).

## 🚀 Running the app

```bash
cd Client
npm install
npm run dev
```

### Environment (`.env`, see `.env.example`):

```
VITE_SUPABASE_URL=https://<your-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```

## 🗄️ Start a new Supabase project

1. **Run the baseline schema:** `supabase/schema.sql` once in the Supabase SQL Editor (tables, RLS, workflow RPCs, auto-profile trigger). **Do not re-run after applying migrations.**

2. **Add your admin account:** In **Authentication → Users → Add user**, create your admin account (leave "Auto Confirm User" on).

3. **Make yourself admin:** In the SQL Editor, uncomment the last block of `supabase/schema.sql` and run it with your email:
   ```sql
   update public.profiles set role = 'admin' where email = 'your-email@example.com';
   ```

4. **Deploy Edge Functions:**
   ```bash
   npx supabase functions deploy create-user --project-ref <your-ref>
   npx supabase functions deploy set-user-active --project-ref <your-ref>
   ```
   `SUPABASE_SERVICE_ROLE_KEY` is injected automatically; it must never live in the client.

5. **Apply academic migrations (Phase 2 first, then Phase 3, then Phase 4):**
   Run each migration file in `supabase/migrations/` in order via the SQL Editor or `npx supabase db push`.
   Migration order — see `supabase/migrations/README.md`.

6. **Seed real departments, courses, and degrees** in Supabase before creating new classes. No institution-specific values are invented.

---

## 👥 Team Members

| Name |
|---|
| Nayab Nasim |
| Ashish Kumar |
| Soumalya Roy |
| Shreyansh Soumya |
| Arhan Abdullah |

---

## 🎯 Project Objective

The objective of Gradia is to provide a centralized platform for managing student academic results while reducing manual work and improving the accuracy, transparency, and efficiency of the result publication process.

The system follows a role-based workflow where teachers enter marks, administrators compile results, the HOD reviews and approves them, and the Principal provides the final sign-off before results are published to students.

---

## 🔄 Result Management Workflow

```text
Teacher
│
▼
Enter Marks
│
▼
Are all marks entered?
   │
   ├── No ──► Marks Incomplete
   │              │
   │              └──────► Enter Marks Again
   │
   └── Yes
          │
          ▼
     Admin Compiles
     Result Sheet
          │
          ▼
      HOD Reviews
      Result Sheet
          │
          ▼
       Approved by HOD?
          │
      ┌───┴────┐
      │        │
   No       Yes
      │        │
      ▼        ▼
 Send Back   Principal
  for         Signs Off
 Correction     │
      │        ▼
      └────► Publish Result
                 │
                 ▼
            Notify Students
```

## 📦 Import Feature

Admins can upload Excel/CSV/JSON files for bulk creation of records:

| Module | Screen | Roles | Strategies |
|---|---|---|---|
| Departments | Academics, Departments tab | admin | new, skip, update |
| Courses | Academics, Courses tab | admin | new, skip, update |
| Classes | Academics, Classes tab | admin | new, skip, update |
| Subjects | Academics, Subjects tab | admin | new, skip, update |
| Class subjects | Academics, Subjects tab | admin | new, skip, update |
| Users | Users | admin | new, skip |
| Exams | Exams | admin | new, skip, update |
| Marks | Marks Entry | admin, teacher | new, skip, update |

**Details:**
- File size cap: 10 MB, row cap: 5,000
- Validation: required fields, email shape, integer ranges (semester 1–12, max marks 1–1000, marks 0–subject maximum), foreign keys resolved against reference data, ambiguous names rejected, duplicate file rows reduced to one survivor
- Result sheets and result items are deliberately blocked from direct import — snapshots are RPC-controlled and immutable
- The wizard never calls `result_sheets` or `result_items`

After import, verify that each row appears in its screen, and run `npm run lint` and `npm run build` to confirm everything passes.

---

## 🎯 Degree System (Phase 4+)

Starting with Phase 3/4 migrations, degrees are a global catalogue shared by every department:

- **Degrees** catalogue (BSc, MSc, etc.) has unique name and code across the catalogue
- Each **course** links its own department and degree
- Each **class** keeps its course's department and degree
- Each **student/HOD profile** has `degree_id` that must match its course or class degree
- Database triggers enforce degree consistency for direct API writes
- Changing a course degree updates its classes automatically
- A class degree must match its course degree; a profile degree must match its course or class degree

Deployment order for degree changes:
1. Apply migrations `202611100002` and `202611100003`
2. Deploy updated client and `create-user` Edge Function
3. Assign degrees to existing records via Academics → Degrees / Courses / Classes
4. Changing a course degree updates its classes automatically

## ✅ Post-migration verification

Run these read-only checks after applying migrations. All should return `0` unless noted:

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

Row-count sanity (should match legacy counts):

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

---

## Gotchas & Security Reminders

- **The landing page shares dashboard components.** `ProductPreview.jsx` renders `<DashboardSidebar fluid />` and `<DashboardHeader />` with no props — the sidebar has `PREVIEW_ITEMS`/`fluid` fallbacks and the header hides auth controls when `profile` is null. Preserve those fallbacks or the landing page crashes (`items.map` of undefined).

- **Published results are immutable.** Once a result sheet is `published`, it cannot be deleted or modified. Corrections require creating a new version via the workflow RPCs (Phase 4/7).

- **Legacy `subjects.class_id` and `subjects.teacher_id`** columns are preserved but deprecated. New assignments use `class_subjects` and `teacher_assignments`. Screens that still read legacy columns may show zero results for new catalogue subjects.

- **Result versioning** (`result_sheet_versions`, `result_component_items`, `result_reviews`) supports corrections. A published sheet cannot be overwritten; a new version must be created and republished.

- **Published sheet immutability** — `guard_result_sheet_mutation()` freezes status and `published_at`, but it does NOT freeze `compiled_by`, `hod_reviewed_by`, `principal_signed_by`, remarks, or `updated_at`. Only RPCs/service role can reach these columns. Future correction RPCs should not mutate the published row — consider freezing all non-version columns or moving them to the version table.

- **EGradia did not start with a baseline migration.** The baseline is `supabase/schema.sql`. Apply things in this order:
  1. Run `supabase/schema.sql` once
  2. Then `202611050001_gradia_academic_structure.sql`
  3. Then `202611050002_class_subject_catalogue.sql`
  4. Then Phase 2 `202611060000-0006`
  5. Then Phase 3 `202611070001-0004`
  6. Then Phase 4 `202611090001`, `202611100001-0003`

- **Never re-run `schema.sql` after migrations.** It replaces `handle_new_user()` with an older version and would leave the schema inconsistent.

- **No service-role key anywhere in the client.** The anon key lives in `Client/.env` (`VITE_`-prefixed). Never write `result_sheets`/`result_items` directly from the client — RLS blocks direct writes and snapshots are RPC-controlled.

- **Role enum:** `student | teacher | hod | principal | admin`. Roles are admin-only (RLS blocks self-update). Deactivated accounts read nothing and cannot call any guarded RPC.

- **Login expects "Confirm email" OFF** in Supabase Auth (admin-managed accounts); the Edge Function sets `email_confirm: true` per user anyway.

- **Theming:** `.dark` class on `<html>` via `src/lib/theme.js`, called from `main.jsx`; persisted in `localStorage`.

- **ESLint quirk (verified):** this config's `no-unused-vars` does **not** count JSX usage, which is why `eslint.config.js` runs `react/jsx-uses-vars` and ignores the rule under `src/context/**`. Don't remove them — lint will flood false `motion is unused` errors.

- **Write per-row permission checks** as security-definer helpers (`app_role`, `is_admin`, `is_class_hod`, `is_subject_teacher`, `is_sheet_hod`), never inline subqueries against RLS'd tables (recursion risk).

- **Result sheets statuses:** `draft → compiled → hod_approved | hod_rejected → principal_signed → published`. Published sheets are immutable.

- **Admin-only operations:** Creating accounts, compiling sheets, reviewing/signing/publishing results, managing users, degrees, classes, and subjects.

---

## Client Commands

- From `Client/`: `npm run dev`, `npm run build`, `npm run lint`
- `npm audit` flags dev-only vite advisories; don't chase them