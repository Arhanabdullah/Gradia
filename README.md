# Gradia

### Student Result Management System (Supabase-backed)

Gradia is a full-stack Student Result Management System designed to simplify and digitize the process of managing, reviewing, approving, and publishing student academic results.

The system provides different interfaces and permissions for students, teachers, administrators, HODs, and principals, creating a structured result management and approval workflow.

**Stack:** React 19 + Vite + Tailwind 4 (client) · Supabase (Postgres + Auth + Row Level Security + Edge Functions).

## 🚀 Running the app

```bash
cd Client
npm install
npm run dev
```

Environment (`.env`, see `.env.example`):

```
VITE_SUPABASE_URL=https://<your-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```

## 🗄️ Start a new Supabase project

1. Run `supabase/schema.sql` once in the Supabase SQL Editor (tables, RLS, workflow RPCs, auto-profile trigger).
2. In **Authentication → Users → Add user**, create your admin account.
3. At the bottom of `schema.sql`, uncomment the `update public.profiles set role = 'admin' ...` block and run it with your email.
4. Deploy the account-creation Edge Function:
   ```bash
   npx supabase functions deploy create-user --project-ref <your-ref>
   ```
   `SUPABASE_SERVICE_ROLE_KEY` is injected automatically; it must never live in the client.


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
