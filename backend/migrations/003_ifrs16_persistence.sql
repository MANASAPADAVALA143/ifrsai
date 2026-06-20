-- IFRS 16 lease portfolio + modification + audit persistence (firm_id tenancy)
-- Modeled on 002_ifrs15_persistence.sql — lease_data JSONB stores full frontend entry

-- Optional firms registry (shared with multi-product tenancy)
CREATE TABLE IF NOT EXISTS firms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     TEXT UNIQUE NOT NULL,
  firm_name   TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Primary lease store — source of truth is lease_data (LeaseRepositoryEntry shape)
CREATE TABLE IF NOT EXISTS ifrs16_leases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       TEXT NOT NULL,
  lease_id      TEXT NOT NULL,
  lease_name    TEXT,
  lease_data    JSONB NOT NULL,
  summary_data  JSONB,
  status        TEXT DEFAULT 'active',
  user_id       TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (firm_id, lease_id)
);

CREATE INDEX IF NOT EXISTS idx_ifrs16_leases_firm_id
  ON ifrs16_leases(firm_id);
CREATE INDEX IF NOT EXISTS idx_ifrs16_leases_lease_id
  ON ifrs16_leases(lease_id);
CREATE INDEX IF NOT EXISTS idx_ifrs16_leases_status
  ON ifrs16_leases(status);
CREATE INDEX IF NOT EXISTS idx_ifrs16_leases_created_at
  ON ifrs16_leases(created_at DESC);

-- Modification events (structured history)
CREATE TABLE IF NOT EXISTS ifrs16_lease_modifications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id               TEXT NOT NULL,
  lease_row_id          UUID REFERENCES ifrs16_leases(id) ON DELETE CASCADE,
  business_lease_id     TEXT NOT NULL,
  modification_date     DATE,
  modification_type     TEXT NOT NULL,
  modification_reason   TEXT,
  before_state          JSONB,
  after_state           JSONB,
  modification_journal  JSONB,
  gain_loss_amount      NUMERIC(18, 4) DEFAULT 0,
  gain_loss_type        TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  created_by            TEXT
);

CREATE INDEX IF NOT EXISTS idx_ifrs16_mod_firm
  ON ifrs16_lease_modifications(firm_id);
CREATE INDEX IF NOT EXISTS idx_ifrs16_mod_lease
  ON ifrs16_lease_modifications(business_lease_id);

-- Audit log
CREATE TABLE IF NOT EXISTS ifrs16_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     TEXT NOT NULL,
  lease_id    TEXT,
  user_id     TEXT,
  action      TEXT NOT NULL,
  details     JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ifrs16_audit_firm_id
  ON ifrs16_audit_log(firm_id);
CREATE INDEX IF NOT EXISTS idx_ifrs16_audit_created_at
  ON ifrs16_audit_log(created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_ifrs16_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ifrs16_leases_updated_at ON ifrs16_leases;
CREATE TRIGGER ifrs16_leases_updated_at
  BEFORE UPDATE ON ifrs16_leases
  FOR EACH ROW EXECUTE FUNCTION update_ifrs16_updated_at();
