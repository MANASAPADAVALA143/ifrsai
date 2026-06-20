-- IFRS.ai workspace isolation — extend firms + RLS on IFRS 16 tables
-- Uses existing firms + firm_id (NOT companies / company_id)
-- Safe to re-run

-- STEP 1: Check (run alone first)
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('firms', 'ifrs16_leases', 'ifrs16_lease_modifications', 'ifrs16_audit_log');

ALTER TABLE firms
  ADD COLUMN IF NOT EXISTS slug text UNIQUE,
  ADD COLUMN IF NOT EXISTS modules_enabled jsonb
    DEFAULT '{"ifrs16": true, "ifrs15": false, "ifrs9": false}',
  ADD COLUMN IF NOT EXISTS market text DEFAULT 'UAE',
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'AED';

INSERT INTO firms (firm_id, firm_name, slug, market, currency, modules_enabled)
VALUES (
  'emaar-dev',
  'Emaar Development LLC',
  'emaar-dev',
  'UAE',
  'AED',
  '{"ifrs16": true, "ifrs15": false, "ifrs9": false}'
)
ON CONFLICT (firm_id) DO UPDATE SET
  firm_name = EXCLUDED.firm_name,
  slug = COALESCE(firms.slug, EXCLUDED.slug),
  market = COALESCE(firms.market, EXCLUDED.market),
  currency = COALESCE(firms.currency, EXCLUDED.currency);

INSERT INTO firms (firm_id, firm_name, slug, market, currency, modules_enabled)
VALUES (
  'aldar-dev',
  'Aldar Properties PJSC',
  'aldar-dev',
  'UAE',
  'AED',
  '{"ifrs16": true, "ifrs15": false, "ifrs9": false}'
)
ON CONFLICT (firm_id) DO NOTHING;

ALTER TABLE ifrs16_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE ifrs16_lease_modifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE ifrs16_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ifrs16_leases_firm_isolation ON ifrs16_leases;
CREATE POLICY ifrs16_leases_firm_isolation ON ifrs16_leases
  USING (firm_id = current_setting('app.current_firm_id', TRUE));

DROP POLICY IF EXISTS ifrs16_mods_firm_isolation ON ifrs16_lease_modifications;
CREATE POLICY ifrs16_mods_firm_isolation ON ifrs16_lease_modifications
  USING (firm_id = current_setting('app.current_firm_id', TRUE));

DROP POLICY IF EXISTS ifrs16_audit_firm_isolation ON ifrs16_audit_log;
CREATE POLICY ifrs16_audit_firm_isolation ON ifrs16_audit_log
  USING (firm_id = current_setting('app.current_firm_id', TRUE));

-- Allow authenticated users to list firms for workspace switcher
ALTER TABLE firms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS firms_read_all ON firms;
CREATE POLICY firms_read_all ON firms
  FOR SELECT
  USING (true);
