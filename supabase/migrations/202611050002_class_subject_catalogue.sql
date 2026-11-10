-- Gradia: separate subject catalogue from class-subject assignments.
-- Run after 202611050001_gradia_academic_structure.sql.
-- Existing subject rows and their class/teacher links are preserved and migrated.

ALTER TABLE public.subjects ALTER COLUMN class_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.class_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT class_subjects_class_subject_unique UNIQUE (class_id, subject_id)
);

CREATE TABLE IF NOT EXISTS public.teacher_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teacher_assignments_class_subject_unique UNIQUE (class_id, subject_id)
);

-- Migrate legacy subject.class_id relationships into the new join table.
INSERT INTO public.class_subjects (class_id, subject_id)
SELECT class_id, id
FROM public.subjects
WHERE class_id IS NOT NULL
ON CONFLICT (class_id, subject_id) DO NOTHING;

-- Migrate legacy subject.teacher_id allocations to class-specific assignments.
INSERT INTO public.teacher_assignments (class_id, subject_id, teacher_id)
SELECT class_id, id, teacher_id
FROM public.subjects
WHERE class_id IS NOT NULL AND teacher_id IS NOT NULL
ON CONFLICT (class_id, subject_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS class_subjects_subject_id_idx ON public.class_subjects(subject_id);
CREATE INDEX IF NOT EXISTS teacher_assignments_teacher_id_idx ON public.teacher_assignments(teacher_id);
CREATE INDEX IF NOT EXISTS teacher_assignments_class_id_idx ON public.teacher_assignments(class_id);

ALTER TABLE public.class_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read class subjects" ON public.class_subjects;
CREATE POLICY "authenticated read class subjects" ON public.class_subjects
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admin manage class subjects" ON public.class_subjects;
CREATE POLICY "admin manage class subjects" ON public.class_subjects
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "authenticated read teacher assignments" ON public.teacher_assignments;
CREATE POLICY "authenticated read teacher assignments" ON public.teacher_assignments
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admin manage teacher assignments" ON public.teacher_assignments;
CREATE POLICY "admin manage teacher assignments" ON public.teacher_assignments
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
