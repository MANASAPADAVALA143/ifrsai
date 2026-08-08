-- APPLY ONLY ON IFRS.ai: https://supabase.com/dashboard/project/udjqtsaggtwwwdfhcnao/sql/new
-- Do NOT run this on finreportaicommercial / FinReport AI.

-- 064 billing recon
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

GRANT ALL ON TABLE ifrs15_billing_transactions TO anon, authenticated, service_role;
GRANT ALL ON TABLE ifrs15_gl_postings TO anon, authenticated, service_role;
GRANT ALL ON TABLE ifrs15_recon_results TO anon, authenticated, service_role;

-- 065 modifications
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

GRANT ALL ON TABLE ifrs15_contract_modifications TO anon, authenticated, service_role;
GRANT ALL ON TABLE ifrs15_modification_audit TO anon, authenticated, service_role;

-- 066 RPO
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

GRANT ALL ON TABLE ifrs15_rpo_contracts TO anon, authenticated, service_role;
GRANT ALL ON TABLE ifrs15_rpo_snapshots TO anon, authenticated, service_role;
GRANT ALL ON TABLE ifrs15_rpo_contract_detail TO anon, authenticated, service_role;

-- 067 evidence pack
CREATE TABLE IF NOT EXISTS ifrs15_evidence_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  period TEXT NOT NULL,
  period_type TEXT DEFAULT 'monthly',
  pack_ref TEXT,
  status TEXT DEFAULT 'generating',
  generated_at TIMESTAMPTZ,
  generated_by TEXT,
  section_controls BOOLEAN DEFAULT FALSE,
  section_contracts BOOLEAN DEFAULT FALSE,
  section_calculations BOOLEAN DEFAULT FALSE,
  section_modifications BOOLEAN DEFAULT FALSE,
  section_billing_recon BOOLEAN DEFAULT FALSE,
  section_rpo BOOLEAN DEFAULT FALSE,
  section_checklist BOOLEAN DEFAULT FALSE,
  completeness_score NUMERIC(5,2) DEFAULT 0,
  checklist_items_total INTEGER DEFAULT 0,
  checklist_items_met INTEGER DEFAULT 0,
  contracts_count INTEGER DEFAULT 0,
  modifications_count INTEGER DEFAULT 0,
  recon_exceptions_count INTEGER DEFAULT 0,
  recon_exceptions_resolved INTEGER DEFAULT 0,
  je_count INTEGER DEFAULT 0,
  je_manual_count INTEGER DEFAULT 0,
  ai_controls_narrative TEXT,
  ai_executive_summary TEXT,
  prepared_by TEXT,
  reviewed_by TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  issued_to TEXT,
  issued_at TIMESTAMPTZ,
  pdf_path TEXT,
  excel_path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ifrs15_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id UUID REFERENCES ifrs15_evidence_packs(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  period TEXT NOT NULL,
  section TEXT NOT NULL,
  item_code TEXT NOT NULL,
  requirement TEXT NOT NULL,
  ifrs_reference TEXT,
  status TEXT DEFAULT 'not_assessed',
  evidence_available BOOLEAN DEFAULT FALSE,
  evidence_source TEXT,
  notes TEXT,
  gap_description TEXT,
  recommended_action TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ifrs15_evidence_packs_scope
  ON ifrs15_evidence_packs(company_id, period, period_type);
CREATE INDEX IF NOT EXISTS idx_ifrs15_checklist_pack_section
  ON ifrs15_checklist_items(pack_id, section);
CREATE INDEX IF NOT EXISTS idx_ifrs15_checklist_company_period_status
  ON ifrs15_checklist_items(company_id, period, status);

GRANT ALL ON TABLE ifrs15_evidence_packs TO anon, authenticated, service_role;
GRANT ALL ON TABLE ifrs15_checklist_items TO anon, authenticated, service_role;

SELECT pg_notification_queue_usage();
NOTIFY pgrst, 'reload schema';

SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'ifrs15_billing_transactions',
    'ifrs15_gl_postings',
    'ifrs15_recon_results',
    'ifrs15_contract_modifications',
    'ifrs15_modification_audit',
    'ifrs15_rpo_contracts',
    'ifrs15_rpo_snapshots',
    'ifrs15_rpo_contract_detail',
    'ifrs15_evidence_packs',
    'ifrs15_checklist_items'
  )
ORDER BY 1;
