GRADIA CLASSES & SUBJECTS UPDATE

FRONTEND FILE:
Client/src/pages/admin/ManageClasses.jsx
Copy this file into your existing Client/src/pages/admin/ folder and replace the old ManageClasses.jsx.

DATABASE MIGRATIONS:
1) If migration 202611050001_gradia_academic_structure.sql has NOT been run, run it first.
2) Then run 202611050002_class_subject_catalogue.sql.
3) If migration 202611050001 has already been run successfully, run ONLY 202611050002.
Run migrations in Supabase SQL Editor, or use the Supabase CLI migration workflow after reviewing the SQL.

IMPORTANT:
- Back up the project and database before applying migrations.
- Do not run the first migration a second time if it has already been applied; its CREATE/ALTER statements are mostly idempotent, but treat migrations as one-time operations.
- This change keeps legacy subjects.class_id and subjects.teacher_id columns for compatibility, while new assignments are stored in class_subjects and teacher_assignments.
- Seed real departments and courses in Supabase before creating new classes. No institution-specific values are invented.
- The page expects departments and courses tables/columns from migration 202611050001.
- Existing subject-to-class and subject-to-teacher links are copied into the new assignment tables by migration 202611050002.
