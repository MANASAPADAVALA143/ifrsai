-- Same schema as backend/migrations/009_ifrs15_billing_gl_recon.sql
-- company_id is TEXT to match existing firm_id tenancy.

CREATE TABLE IF NOT EXISTS ifrs15_billing_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  contract_id TEXT,
  transaction_ref TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  contract_type TEXT NOT NULL,
  billing_date DATE NOT NULL,
  amount NUMERIC(18,4) NOT NULL,
  currency TEXT DEFAULT 'AED',
  billing_system TEXT,
  external_ref TEXT,
  milestone_ref TEXT,
  customer_id TEXT,
  status TEXT DEFAULT 'unmatched',
  period TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ifrs15_gl_postings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  contract_id TEXT,
  posting_date DATE NOT NULL,
  account_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  debit NUMERIC(18,4) DEFAULT 0,
  credit NUMERIC(18,4) DEFAULT 0,
  journal_ref TEXT,
  period TEXT NOT NULL,
  posting_type TEXT,
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ifrs15_recon_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  contract_id TEXT,
  recon_run_at TIMESTAMPTZ DEFAULT NOW(),
  period TEXT NOT NULL,
  contract_type TEXT NOT NULL,
  billing_total NUMERIC(18,4) DEFAULT 0,
  gl_revenue_total NUMERIC(18,4) DEFAULT 0,
  gl_deferred_total NUMERIC(18,4) DEFAULT 0,
  gl_receivable_total NUMERIC(18,4) DEFAULT 0,
  variance NUMERIC(18,4) DEFAULT 0,
  variance_pct NUMERIC(8,4) DEFAULT 0,
  status TEXT DEFAULT 'pending',
  exceptions JSONB DEFAULT '[]',
  ai_commentary TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ifrs15_billing_company_period
  ON ifrs15_billing_transactions(company_id, period);
CREATE INDEX IF NOT EXISTS idx_ifrs15_billing_company_contract
  ON ifrs15_billing_transactions(company_id, contract_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ifrs15_billing_ref
  ON ifrs15_billing_transactions(company_id, transaction_ref);

CREATE INDEX IF NOT EXISTS idx_ifrs15_gl_company_period
  ON ifrs15_gl_postings(company_id, period);
CREATE INDEX IF NOT EXISTS idx_ifrs15_gl_company_contract
  ON ifrs15_gl_postings(company_id, contract_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ifrs15_gl_journal
  ON ifrs15_gl_postings(company_id, COALESCE(journal_ref, ''), account_code);

CREATE INDEX IF NOT EXISTS idx_ifrs15_recon_company_period
  ON ifrs15_recon_results(company_id, period);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ifrs15_recon_scope
  ON ifrs15_recon_results(company_id, period, COALESCE(contract_id, ''), contract_type);
