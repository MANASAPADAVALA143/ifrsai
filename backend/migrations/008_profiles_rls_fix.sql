-- Fix infinite recursion on profiles RLS (Postgres error 42P17 / HTTP 500)
-- The admins_read_all_profiles policy queried profiles inside a profiles policy.
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.is_profile_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_profile_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_profile_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_profile_admin() TO anon;

DROP POLICY IF EXISTS admins_read_all_profiles ON profiles;
CREATE POLICY admins_read_all_profiles ON profiles
  FOR SELECT USING (public.is_profile_admin());

DROP POLICY IF EXISTS firms_admin_insert ON firms;
CREATE POLICY firms_admin_insert ON firms
  FOR INSERT WITH CHECK (public.is_profile_admin());
