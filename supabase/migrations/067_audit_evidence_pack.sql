-- IFRS 15 Audit Evidence Pack (Gap 6)
-- company_id is TEXT to match firm tenancy.

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

NOTIFY pgrst, 'reload schema';
