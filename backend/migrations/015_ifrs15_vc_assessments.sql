-- IFRS 15 Variable Consideration Structured Assessment (IFRS 15.56-58)
-- Captures the preparer's structured assessment of VC estimation method,
-- factor analysis, and constraint test separately from the calculation inputs.
-- Rollback: DROP TABLE ifrs15_vc_assessments;

-- ── 1. VC assessment table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ifrs15_vc_assessments (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id                   TEXT NOT NULL,
  portfolio_id              UUID REFERENCES ifrs15_portfolios(id) ON DELETE SET NULL,
  contract_id               TEXT NOT NULL,

  -- Method selection (IFRS 15.54)
  method                    TEXT NOT NULL DEFAULT 'expected_value',
    -- expected_value | most_likely_amount

  -- Expected value inputs (used when method = expected_value)
  ev_scenario_high_amount   NUMERIC(18,4),
  ev_scenario_high_prob     NUMERIC(8,6),   -- probability 0.000000 – 1.000000
  ev_scenario_base_amount   NUMERIC(18,4),
  ev_scenario_base_prob     NUMERIC(8,6),
  ev_scenario_low_amount    NUMERIC(18,4),
  ev_scenario_low_prob      NUMERIC(8,6),
  ev_calculated_amount      NUMERIC(18,4),  -- computed by API, not user-entered

  -- Most likely amount input (used when method = most_likely_amount)
  mla_amount                NUMERIC(18,4),

  -- The VC amount that feeds the calculation (approved by reviewer)
  approved_vc_amount        NUMERIC(18,4),

  -- IFRS 15.57 constraint factors — seven factors, each assessed individually.
  -- Preparer states whether the factor is present and its severity.
  -- AI must NOT determine the highly-probable threshold; that is the preparer's judgment.

  -- Factor 1: Amount highly susceptible to factors outside entity's influence
  f1_present                BOOLEAN,
  f1_severity               TEXT,   -- low | medium | high
  f1_note                   TEXT,

  -- Factor 2: Uncertainty not expected to be resolved for a long time
  f2_present                BOOLEAN,
  f2_severity               TEXT,
  f2_note                   TEXT,

  -- Factor 3: Entity's experience is limited or has limited predictive value
  f3_present                BOOLEAN,
  f3_severity               TEXT,
  f3_note                   TEXT,

  -- Factor 4: Entity has practice of offering concessions or changing payment terms
  f4_present                BOOLEAN,
  f4_severity               TEXT,
  f4_note                   TEXT,

  -- Factor 5: Contract has a large number and broad range of possible consideration amounts
  f5_present                BOOLEAN,
  f5_severity               TEXT,
  f5_note                   TEXT,

  -- Preparer's conclusion: is the constraint applicable?
  constraint_applied        BOOLEAN,

  -- Amount after constraint (what actually enters the transaction price)
  constrained_vc_amount     NUMERIC(18,4),

  -- Preparer's written commentary (required before submission)
  preparer_commentary       TEXT,
  evidence_ref              TEXT,

  -- Reviewer notes
  reviewer_notes            TEXT,

  -- Workflow
  status                    TEXT NOT NULL DEFAULT 'draft',
    -- draft | submitted | under_review | approved | rejected

  preparer_id               TEXT,
  submitted_at              TIMESTAMPTZ,
  reviewer_id               TEXT,
  reviewed_at               TIMESTAMPTZ,
  approved_by               TEXT,
  approved_at               TIMESTAMPTZ,
  rejection_reason          TEXT,

  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ifrs15_vc_assessments
  ADD CONSTRAINT chk_vc_no_self_approval
  CHECK (reviewer_id IS NULL OR reviewer_id <> preparer_id);

ALTER TABLE ifrs15_vc_assessments
  ADD CONSTRAINT chk_vc_method
  CHECK (method IN ('expected_value', 'most_likely_amount'));

ALTER TABLE ifrs15_vc_assessments
  ADD CONSTRAINT chk_vc_status
  CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected'));

-- One active assessment per contract (latest wins; superseded ones stay for audit)
CREATE INDEX IF NOT EXISTS idx_ifrs15_vc_firm_contract_status
  ON ifrs15_vc_assessments(firm_id, contract_id, status);

CREATE INDEX IF NOT EXISTS idx_ifrs15_vc_portfolio
  ON ifrs15_vc_assessments(portfolio_id);

-- ── 2. Audit trail ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ifrs15_vc_audit (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id    UUID REFERENCES ifrs15_vc_assessments(id) ON DELETE CASCADE,
  action           TEXT NOT NULL,
  actor            TEXT,
  old_value        JSONB,
  new_value        JSONB,
  note             TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ifrs15_vc_audit_assessment_id
  ON ifrs15_vc_audit(assessment_id);

-- ── 3. Auto-update trigger ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_ifrs15_vc_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ifrs15_vc_updated_at ON ifrs15_vc_assessments;
CREATE TRIGGER ifrs15_vc_updated_at
  BEFORE UPDATE ON ifrs15_vc_assessments
  FOR EACH ROW EXECUTE FUNCTION update_ifrs15_vc_updated_at();

-- ── 4. Grants ─────────────────────────────────────────────────────────────────

GRANT ALL ON TABLE ifrs15_vc_assessments TO anon, authenticated, service_role;
GRANT ALL ON TABLE ifrs15_vc_audit        TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
