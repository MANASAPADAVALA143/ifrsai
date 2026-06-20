-- IFRS 9 persistence patch — creates missing tables from 005 partial run
-- Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS
-- Does NOT modify ifrs9_portfolios (already exists)

-- Prerequisite: ifrs9_portfolios must exist (FK on portfolio_row_id)
CREATE TABLE IF NOT EXISTS ifrs9_calculation_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id               TEXT NOT NULL,
  portfolio_row_id      UUID REFERENCES ifrs9_portfolios(id) ON DELETE SET NULL,
  portfolio_id          TEXT NOT NULL,
  run_label             TEXT,
  approach              TEXT DEFAULT 'general',
  reporting_date        DATE,
  ecl_results           JSONB NOT NULL,
  journal_outputs       JSONB,
  ecl_movement          JSONB,
  staging_result        JSONB,
  classification_result JSONB,
  input_snapshot        JSONB,
  applicable_ecl        NUMERIC(18, 4),
  total_ead             NUMERIC(18, 4),
  coverage_ratio        NUMERIC(8, 4),
  user_id               TEXT,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ifrs9_runs_firm_id
  ON ifrs9_calculation_runs(firm_id);
CREATE INDEX IF NOT EXISTS idx_ifrs9_runs_portfolio_id
  ON ifrs9_calculation_runs(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_ifrs9_runs_portfolio_row
  ON ifrs9_calculation_runs(portfolio_row_id);
CREATE INDEX IF NOT EXISTS idx_ifrs9_runs_created_at
  ON ifrs9_calculation_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS ifrs9_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       TEXT NOT NULL,
  portfolio_id  TEXT,
  user_id       TEXT,
  action        TEXT NOT NULL,
  details       JSONB,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ifrs9_audit_firm_id
  ON ifrs9_audit_log(firm_id);
CREATE INDEX IF NOT EXISTS idx_ifrs9_audit_created_at
  ON ifrs9_audit_log(created_at DESC);

ALTER TABLE ifrs9_calculation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ifrs9_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ifrs9_runs_firm_isolation ON ifrs9_calculation_runs;
CREATE POLICY ifrs9_runs_firm_isolation ON ifrs9_calculation_runs
  USING (firm_id = current_setting('app.current_firm_id', TRUE));

DROP POLICY IF EXISTS ifrs9_audit_firm_isolation ON ifrs9_audit_log;
CREATE POLICY ifrs9_audit_firm_isolation ON ifrs9_audit_log
  USING (firm_id = current_setting('app.current_firm_id', TRUE));
