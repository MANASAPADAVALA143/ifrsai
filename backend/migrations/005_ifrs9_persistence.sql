-- IFRS 9 ECL portfolio + calculation run persistence (firm_id tenancy)
-- JSONB hybrid pattern — matches 003_ifrs16_persistence.sql / 004_ifrs16_period_snapshots.sql
-- Prerequisite: firms table optional (003); update_updated_at() from 004

CREATE TABLE IF NOT EXISTS ifrs9_portfolios (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id           TEXT NOT NULL,
  portfolio_id      TEXT NOT NULL,
  portfolio_name    TEXT,
  instrument_data   JSONB NOT NULL,
  summary_data      JSONB,
  status            TEXT DEFAULT 'draft',
  user_id           TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (firm_id, portfolio_id)
);

CREATE INDEX IF NOT EXISTS idx_ifrs9_portfolios_firm_id
  ON ifrs9_portfolios(firm_id);
CREATE INDEX IF NOT EXISTS idx_ifrs9_portfolios_portfolio_id
  ON ifrs9_portfolios(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_ifrs9_portfolios_status
  ON ifrs9_portfolios(status);
CREATE INDEX IF NOT EXISTS idx_ifrs9_portfolios_created_at
  ON ifrs9_portfolios(created_at DESC);

-- Normalized calculation runs (audit trail + reconciliation outputs)
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

-- Audit log (portfolio actions)
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

-- Reuse shared updated_at trigger (created in 004)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ifrs9_portfolios_updated_at ON ifrs9_portfolios;
CREATE TRIGGER ifrs9_portfolios_updated_at
  BEFORE UPDATE ON ifrs9_portfolios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Row Level Security (matches 004_ifrs16_period_snapshots.sql)
ALTER TABLE ifrs9_portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE ifrs9_calculation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ifrs9_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ifrs9_portfolios_firm_isolation ON ifrs9_portfolios;
CREATE POLICY ifrs9_portfolios_firm_isolation ON ifrs9_portfolios
  USING (firm_id = current_setting('app.current_firm_id', TRUE));

DROP POLICY IF EXISTS ifrs9_runs_firm_isolation ON ifrs9_calculation_runs;
CREATE POLICY ifrs9_runs_firm_isolation ON ifrs9_calculation_runs
  USING (firm_id = current_setting('app.current_firm_id', TRUE));

DROP POLICY IF EXISTS ifrs9_audit_firm_isolation ON ifrs9_audit_log;
CREATE POLICY ifrs9_audit_firm_isolation ON ifrs9_audit_log
  USING (firm_id = current_setting('app.current_firm_id', TRUE));
