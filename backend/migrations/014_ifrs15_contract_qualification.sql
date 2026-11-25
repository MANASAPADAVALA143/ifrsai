-- IFRS 15 Step 1 Contract Qualification Gate (IFRS 15.9)
-- New table: one qualification assessment per contract, per firm.
-- Existing contracts are unaffected: qualification_status defaults to 'not_required'
-- on the portfolios table until the firm opts in via require_step1_gate flag.
-- Rollback: DROP TABLE ifrs15_contract_qualifications;
--           ALTER TABLE ifrs15_portfolios DROP COLUMN IF EXISTS qualification_status;

-- ── 1. Qualification assessments ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ifrs15_contract_qualifications (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id                     TEXT NOT NULL,
  portfolio_id                UUID REFERENCES ifrs15_portfolios(id) ON DELETE SET NULL,
  contract_id                 TEXT NOT NULL,

  -- Five IFRS 15.9 criteria — each has a boolean result, preparer note, and evidence ref
  c1_approval                 BOOLEAN,          -- parties have approved and are committed
  c1_note                     TEXT,
  c1_evidence_ref             TEXT,

  c2_rights                   BOOLEAN,          -- rights to goods/services identified
  c2_note                     TEXT,
  c2_evidence_ref             TEXT,

  c3_payment_terms            BOOLEAN,          -- payment terms identified
  c3_note                     TEXT,
  c3_evidence_ref             TEXT,

  c4_commercial_substance     BOOLEAN,          -- contract has commercial substance
  c4_note                     TEXT,
  c4_evidence_ref             TEXT,

  c5_collection_probable      BOOLEAN,          -- collection of consideration is probable
  c5_note                     TEXT,
  c5_evidence_ref             TEXT,

  -- Preparer identifies missing evidence
  missing_evidence_notes      TEXT,

  -- Workflow
  status                      TEXT NOT NULL DEFAULT 'not_started',
    -- not_started | in_progress | submitted | passed | failed | rejected

  preparer_id                 TEXT,
  submitted_at                TIMESTAMPTZ,
  reviewer_id                 TEXT,
  reviewed_at                 TIMESTAMPTZ,
  approved_by                 TEXT,
  approved_at                 TIMESTAMPTZ,
  rejection_reason            TEXT,

  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- Constraint: reviewer cannot be the same person as preparer (enforced at app layer too)
-- The database-level check covers direct SQL access as well.
ALTER TABLE ifrs15_contract_qualifications
  ADD CONSTRAINT chk_qual_no_self_approval
  CHECK (reviewer_id IS NULL OR reviewer_id <> preparer_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ifrs15_qual_firm_contract
  ON ifrs15_contract_qualifications(firm_id, contract_id);

CREATE INDEX IF NOT EXISTS idx_ifrs15_qual_firm_status
  ON ifrs15_contract_qualifications(firm_id, status);

CREATE INDEX IF NOT EXISTS idx_ifrs15_qual_portfolio
  ON ifrs15_contract_qualifications(portfolio_id);

-- ── 2. Audit trail for qualifications ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ifrs15_qualification_audit (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_id  UUID REFERENCES ifrs15_contract_qualifications(id) ON DELETE CASCADE,
  action            TEXT NOT NULL,
  actor             TEXT,
  old_value         JSONB,
  new_value         JSONB,
  note              TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ifrs15_qual_audit_qual_id
  ON ifrs15_qualification_audit(qualification_id);

-- ── 3. Gate flag on portfolios ───────────────────────────────────────────────
-- Existing rows get 'not_required' so nothing breaks.

ALTER TABLE ifrs15_portfolios
  ADD COLUMN IF NOT EXISTS qualification_status TEXT DEFAULT 'not_required';

-- ── 4. Gate flag on firms ────────────────────────────────────────────────────
-- Set require_step1_gate = true on a firm to enforce the gate for new contracts.

ALTER TABLE firms
  ADD COLUMN IF NOT EXISTS require_step1_gate BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS require_vc_gate    BOOLEAN DEFAULT FALSE;

-- ── 5. Auto-update trigger ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_ifrs15_qual_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ifrs15_qual_updated_at ON ifrs15_contract_qualifications;
CREATE TRIGGER ifrs15_qual_updated_at
  BEFORE UPDATE ON ifrs15_contract_qualifications
  FOR EACH ROW EXECUTE FUNCTION update_ifrs15_qual_updated_at();

-- ── 6. Grants ─────────────────────────────────────────────────────────────────

GRANT ALL ON TABLE ifrs15_contract_qualifications  TO anon, authenticated, service_role;
GRANT ALL ON TABLE ifrs15_qualification_audit      TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
