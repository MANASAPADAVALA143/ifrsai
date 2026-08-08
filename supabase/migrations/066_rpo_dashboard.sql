-- IFRS 15 §120 RPO portfolio dashboard
-- company_id / contract_id are TEXT to match firm tenancy.

CREATE TABLE IF NOT EXISTS ifrs15_rpo_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  contract_ref TEXT NOT NULL,
  contract_type TEXT,
  customer_name TEXT,
  transaction_price NUMERIC(18,4) DEFAULT 0,
  revenue_recognised NUMERIC(18,4) DEFAULT 0,
  start_date DATE,
  end_date DATE,
  original_term_months INTEGER,
  currency TEXT DEFAULT 'AED',
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, contract_ref)
);

CREATE TABLE IF NOT EXISTS ifrs15_rpo_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  period TEXT NOT NULL,

  total_rpo NUMERIC(18,4) DEFAULT 0,
  total_contracts INTEGER DEFAULT 0,
  active_contracts INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'AED',
  ltm_revenue NUMERIC(18,4),

  bucket_lt_1yr NUMERIC(18,4) DEFAULT 0,
  bucket_1_2yr NUMERIC(18,4) DEFAULT 0,
  bucket_2_5yr NUMERIC(18,4) DEFAULT 0,
  bucket_gt_5yr NUMERIC(18,4) DEFAULT 0,

  rpo_uae_real_estate NUMERIC(18,4) DEFAULT 0,
  rpo_saas_subscription NUMERIC(18,4) DEFAULT 0,
  rpo_professional_services NUMERIC(18,4) DEFAULT 0,
  rpo_other NUMERIC(18,4) DEFAULT 0,

  rpo_coverage_ratio NUMERIC(8,4),
  weighted_avg_remaining_months NUMERIC(8,2),
  at_risk_rpo NUMERIC(18,4) DEFAULT 0,
  new_bookings_qtd NUMERIC(18,4) DEFAULT 0,

  ai_narrative TEXT,
  ai_disclosure_draft TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, period)
);

CREATE TABLE IF NOT EXISTS ifrs15_rpo_contract_detail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID REFERENCES ifrs15_rpo_snapshots(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  contract_id TEXT,
  contract_ref TEXT,
  contract_type TEXT,
  customer_name TEXT,

  transaction_price NUMERIC(18,4),
  revenue_recognised NUMERIC(18,4),
  rpo NUMERIC(18,4),
  rpo_pct NUMERIC(8,4),
  progress_pct NUMERIC(8,4),

  start_date DATE,
  end_date DATE,
  months_remaining NUMERIC(8,2),
  time_bucket TEXT,

  practical_expedient_applies BOOLEAN DEFAULT FALSE,
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ifrs15_rpo_snap_company_period
  ON ifrs15_rpo_snapshots(company_id, period);
CREATE INDEX IF NOT EXISTS idx_ifrs15_rpo_detail_snap_company
  ON ifrs15_rpo_contract_detail(snapshot_id, company_id);
CREATE INDEX IF NOT EXISTS idx_ifrs15_rpo_detail_company_type
  ON ifrs15_rpo_contract_detail(company_id, contract_type);
CREATE INDEX IF NOT EXISTS idx_ifrs15_rpo_src_company
  ON ifrs15_rpo_contracts(company_id);
