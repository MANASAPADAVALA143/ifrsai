-- Principal vs Agent assessments (IFRS 15.B34–B38)
-- company_id is TEXT to match firm tenancy. Runs after 067 (evidence pack).
-- Note: 068_ifrs15_api_grants.sql is a grants-only patch; this file creates the tables.

CREATE TABLE IF NOT EXISTS ifrs15_principal_agent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  contract_id TEXT,
  contract_ref TEXT,
  assessment_ref TEXT,
  assessment_date DATE NOT NULL,
  contract_type TEXT,
  customer_name TEXT,
  counterparty_name TEXT,
  transaction_description TEXT NOT NULL,
  gross_amount NUMERIC(18,4),
  commission_rate NUMERIC(8,4),
  currency TEXT DEFAULT 'AED',
  indicator_1_responsibility TEXT,
  indicator_1_notes TEXT,
  indicator_2_inventory TEXT,
  indicator_2_notes TEXT,
  indicator_3_pricing TEXT,
  indicator_3_notes TEXT,
  has_inventory_risk BOOLEAN,
  sets_price_independently BOOLEAN,
  primary_obligor BOOLEAN,
  can_redirect_good BOOLEAN,
  third_party_involved BOOLEAN DEFAULT TRUE,
  indicator_1_score INTEGER,
  indicator_2_score INTEGER,
  indicator_3_score INTEGER,
  total_score INTEGER,
  ai_determination TEXT,
  ai_confidence TEXT,
  ai_reasoning TEXT,
  ai_risk_flag TEXT,
  ai_revenue_impact TEXT,
  ai_key_judgment TEXT,
  human_determination TEXT,
  human_override_reason TEXT,
  final_determination TEXT,
  gross_revenue NUMERIC(18,4),
  net_revenue NUMERIC(18,4),
  revenue_difference NUMERIC(18,4),
  assessment_memo TEXT,
  status TEXT DEFAULT 'draft',
  prepared_by TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ifrs15_pa_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID REFERENCES ifrs15_principal_agent(id),
  action TEXT NOT NULL,
  actor TEXT,
  old_value JSONB,
  new_value JSONB,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ifrs15_pa_company_status
  ON ifrs15_principal_agent(company_id, status);
CREATE INDEX IF NOT EXISTS idx_ifrs15_pa_company_determination
  ON ifrs15_principal_agent(company_id, final_determination);
CREATE INDEX IF NOT EXISTS idx_ifrs15_pa_audit_assessment
  ON ifrs15_pa_audit(assessment_id);

GRANT ALL ON TABLE ifrs15_principal_agent TO anon, authenticated, service_role;
GRANT ALL ON TABLE ifrs15_pa_audit TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
