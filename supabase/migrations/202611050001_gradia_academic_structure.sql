-- Gradia academic structure and role-specific identifiers.
-- Safe to run once; existing profiles/classes are retained.

CREATE TABLE IF NOT EXISTS public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  code text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  name text NOT NULL,
  code text,
  duration_years integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT courses_department_name_unique UNIQUE (department_id, name),
  CONSTRAINT courses_duration_positive CHECK (duration_years IS NULL OR duration_years > 0)
);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS student_id text,
  ADD COLUMN IF NOT EXISTS teacher_id text,
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hod_type text,
  ADD COLUMN IF NOT EXISTS hod_subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL;

ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS academic_year text,
  ADD COLUMN IF NOT EXISTS semester integer,
  ADD COLUMN IF NOT EXISTS section text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_student_id_unique
  ON public.profiles (student_id) WHERE student_id IS NOT NULL AND student_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS profiles_teacher_id_unique
  ON public.profiles (teacher_id) WHERE teacher_id IS NOT NULL AND teacher_id <> '';
CREATE INDEX IF NOT EXISTS profiles_department_id_idx ON public.profiles (department_id);
CREATE INDEX IF NOT EXISTS profiles_course_id_idx ON public.profiles (course_id);
CREATE INDEX IF NOT EXISTS classes_course_id_idx ON public.classes (course_id);

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_hod_type_check
    CHECK (hod_type IS NULL OR hod_type IN ('department', 'subject'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read departments" ON public.departments;
CREATE POLICY "authenticated read departments" ON public.departments
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admin manage departments" ON public.departments;
CREATE POLICY "admin manage departments" ON public.departments
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "authenticated read courses" ON public.courses;
CREATE POLICY "authenticated read courses" ON public.courses
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admin manage courses" ON public.courses;
CREATE POLICY "admin manage courses" ON public.courses
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Recreate the auth trigger function so role-specific metadata is persisted.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id, username, name, email, role, department, class_id,
    student_id, teacher_id, department_id, course_id, hod_type, hod_subject_id
  ) VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'username', ''),
      'user_' || SUBSTR(REPLACE(NEW.id::text, '-', ''), 1, 8)),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'name', ''), SPLIT_PART(NEW.email, '@', 1)),
    NEW.email,
    COALESCE((NULLIF(NEW.raw_user_meta_data->>'role', ''))::public.user_role, 'student'),
    NULLIF(NEW.raw_user_meta_data->>'department', ''),
    NULLIF(NEW.raw_user_meta_data->>'class_id', '')::uuid,
    NULLIF(NEW.raw_user_meta_data->>'student_id', ''),
    NULLIF(NEW.raw_user_meta_data->>'teacher_id', ''),
    NULLIF(NEW.raw_user_meta_data->>'department_id', '')::uuid,
    NULLIF(NEW.raw_user_meta_data->>'course_id', '')::uuid,
    NULLIF(NEW.raw_user_meta_data->>'hod_type', ''),
    NULLIF(NEW.raw_user_meta_data->>'hod_subject_id', '')::uuid
  );
  RETURN NEW;
END;
$$;

-- Note: departments and courses are intentionally not seeded with guessed values.
-- Add your institution's real departments/courses before registering students.
