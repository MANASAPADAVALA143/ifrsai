-- IFRS 15 contract modification workflow (IFRS 15.18–21)
-- company_id / contract_id are TEXT to match firm tenancy.

CREATE TABLE IF NOT EXISTS ifrs15_contract_modifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  modification_date DATE NOT NULL,
  modification_ref TEXT,
  description TEXT NOT NULL,
  modification_type TEXT,
  contract_type TEXT NOT NULL,

  original_transaction_price NUMERIC(18,4),
  original_term_months INTEGER,
  months_elapsed INTEGER,
  original_progress_pct NUMERIC(8,4),
  revenue_recognised_to_date NUMERIC(18,4),

  price_change_amount NUMERIC(18,4) DEFAULT 0,
  new_transaction_price NUMERIC(18,4),
  new_term_months INTEGER,
  new_ssp_of_added_services NUMERIC(18,4),
  are_new_services_distinct BOOLEAN,
  are_remaining_services_distinct BOOLEAN,

  ai_treatment TEXT,
  ai_classification_reason TEXT,
  ai_confidence TEXT,
  ai_key_judgment TEXT,
  ai_risk_flag TEXT,
  human_treatment_override TEXT,
  human_override_reason TEXT,

  updated_progress_pct NUMERIC(8,4),
  revenue_should_have_been NUMERIC(18,4),
  catch_up_adjustment NUMERIC(18,4),

  je_ref TEXT,
  je_date DATE,
  je_posted BOOLEAN DEFAULT FALSE,

  modification_memo TEXT,

  status TEXT DEFAULT 'draft',
  prepared_by TEXT,
  reviewed_by TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ifrs15_modification_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modification_id UUID REFERENCES ifrs15_contract_modifications(id),
  action TEXT NOT NULL,
  actor TEXT,
  old_value JSONB,
  new_value JSONB,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ifrs15_mods_company_contract
  ON ifrs15_contract_modifications(company_id, contract_id);
CREATE INDEX IF NOT EXISTS idx_ifrs15_mods_company_status
  ON ifrs15_contract_modifications(company_id, status);
CREATE INDEX IF NOT EXISTS idx_ifrs15_mod_audit_mod_id
  ON ifrs15_modification_audit(modification_id);
