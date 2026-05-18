-- IFRS 15 portfolio + audit log persistence (firm_id tenancy)

-- Portfolio contracts table
CREATE TABLE IF NOT EXISTS ifrs15_portfolios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       TEXT NOT NULL,
  contract_name TEXT NOT NULL,
  contract_data JSONB NOT NULL,
  summary_data  JSONB,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ifrs15_portfolios_firm_id
  ON ifrs15_portfolios(firm_id);
CREATE INDEX IF NOT EXISTS idx_ifrs15_portfolios_created_at
  ON ifrs15_portfolios(created_at DESC);

-- Audit log table
CREATE TABLE IF NOT EXISTS ifrs15_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     TEXT NOT NULL,
  action      TEXT NOT NULL,
  contract_id UUID REFERENCES ifrs15_portfolios(id) ON DELETE SET NULL,
  user_id     TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ifrs15_audit_firm_id
  ON ifrs15_audit_log(firm_id);
CREATE INDEX IF NOT EXISTS idx_ifrs15_audit_created_at
  ON ifrs15_audit_log(created_at DESC);

-- Auto-update updated_at on portfolio changes
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ifrs15_portfolios_updated_at ON ifrs15_portfolios;
CREATE TRIGGER ifrs15_portfolios_updated_at
  BEFORE UPDATE ON ifrs15_portfolios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
