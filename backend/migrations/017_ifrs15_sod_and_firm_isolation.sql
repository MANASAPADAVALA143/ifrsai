-- Phase 0 housekeeping: SOD patches + IFRS 16 isolation notes
--
-- This migration documents the application-layer isolation approach for IFRS 16
-- and adds an index to support firm-scoped queries on the leases table.
--
-- Context: The backend uses SUPABASE_SERVICE_ROLE_KEY which bypasses RLS.
-- Isolation is therefore enforced by explicit firm_id filters in Python
-- (backend/app/services/ifrs16_db.py — patched separately).
-- The RLS policies in migration 006 remain as defence-in-depth if the key
-- is ever changed to anon/authenticated.
--
-- Rollback: safe to re-run (all statements are idempotent).

-- Ensure leases table has firm_id (original schema used auth.uid()-based isolation)
ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS firm_id TEXT;

-- Index for firm-scoped lease queries
CREATE INDEX IF NOT EXISTS idx_leases_firm_id
  ON leases(firm_id)
  WHERE firm_id IS NOT NULL;

-- ifrs15_portfolios: add firm_id index if missing (should exist from migration 002)
CREATE INDEX IF NOT EXISTS idx_ifrs15_portfolios_firm_id_2
  ON ifrs15_portfolios(firm_id);

-- ifrs15_contract_modifications: ensure firm-level index
CREATE INDEX IF NOT EXISTS idx_ifrs15_mods_company_id
  ON ifrs15_contract_modifications(company_id);

-- ifrs15_evidence_packs: ensure firm-level index
CREATE INDEX IF NOT EXISTS idx_ifrs15_evidence_packs_company_id
  ON ifrs15_evidence_packs(company_id);

-- Document the Phase 0 control flags (added in migration 014)
-- require_step1_gate: when TRUE, new contracts for this firm are blocked from
--   calculation until Step 1 qualification passes.
-- require_vc_gate: when TRUE, contracts with variable consideration are blocked
--   from calculation until a VC assessment is approved.
--
-- Both default FALSE so existing firms are unaffected.
-- Set to TRUE when onboarding a new paying customer:
--   UPDATE firms SET require_step1_gate = TRUE, require_vc_gate = TRUE
--   WHERE firm_id = '<new_firm>';

NOTIFY pgrst, 'reload schema';
