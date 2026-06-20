-- User profiles — links auth.users to firms (automatic workspace assignment)
-- Prerequisite: 006_firms_workspace.sql

INSERT INTO firms (firm_id, firm_name, slug, market, currency)
VALUES ('default', 'Default Workspace', 'default', 'UAE', 'AED')
ON CONFLICT (firm_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  firm_id    TEXT NOT NULL REFERENCES firms(firm_id),
  role       TEXT NOT NULL DEFAULT 'member',
  full_name  TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_firm_id ON profiles(firm_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

CREATE OR REPLACE FUNCTION public.handle_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_profiles_updated_at();

-- Auto-create profile on signup (firm_id from signUp metadata)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_firm_id text;
BEGIN
  v_firm_id := NULLIF(TRIM(NEW.raw_user_meta_data->>'firm_id'), '');
  IF v_firm_id IS NULL OR NOT EXISTS (SELECT 1 FROM firms WHERE firm_id = v_firm_id) THEN
    v_firm_id := 'default';
  END IF;

  INSERT INTO public.profiles (id, firm_id, role, full_name)
  VALUES (
    NEW.id,
    v_firm_id,
    COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'role'), ''), 'member'),
    COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
      split_part(COALESCE(NEW.email, 'user'), '@', 1)
    )
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS users_read_own_profile ON profiles;
CREATE POLICY users_read_own_profile ON profiles
  FOR SELECT USING (id = auth.uid());

DROP POLICY IF EXISTS users_update_own_profile ON profiles;
CREATE POLICY users_update_own_profile ON profiles
  FOR UPDATE USING (id = auth.uid());

DROP POLICY IF EXISTS users_insert_own_profile ON profiles;
CREATE POLICY users_insert_own_profile ON profiles
  FOR INSERT WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS admins_read_all_profiles ON profiles;
CREATE POLICY admins_read_all_profiles ON profiles
  FOR SELECT USING (public.is_profile_admin());

-- Admins can create new client workspaces (use helper to avoid profiles RLS recursion)
DROP POLICY IF EXISTS firms_admin_insert ON firms;
CREATE POLICY firms_admin_insert ON firms
  FOR INSERT WITH CHECK (public.is_profile_admin());

-- Backfill: assign existing auth users to emaar-dev (first admin)
INSERT INTO profiles (id, firm_id, role, full_name)
SELECT
  u.id,
  'emaar-dev',
  'admin',
  COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1))
FROM auth.users u
ON CONFLICT (id) DO UPDATE SET
  firm_id = CASE
    WHEN profiles.firm_id = 'default' THEN 'emaar-dev'
    ELSE profiles.firm_id
  END,
  role = CASE
    WHEN profiles.role = 'member' THEN 'admin'
    ELSE profiles.role
  END;
