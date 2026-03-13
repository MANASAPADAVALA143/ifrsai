-- IFRS AI - Supabase Schema
-- Run this in Supabase Dashboard → SQL Editor → New query → paste and Run

-- =============================================================================
-- 1. LEASES TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id VARCHAR(100) UNIQUE NOT NULL,
  lessee_name VARCHAR(255),
  lessor_name VARCHAR(255),
  asset_description TEXT,
  commencement_date DATE,
  end_date DATE,
  lease_term_months INT,
  monthly_payment NUMERIC,
  discount_rate NUMERIC,
  lease_liability NUMERIC,
  rou_asset NUMERIC,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_leases_lease_id ON leases(lease_id);
CREATE INDEX IF NOT EXISTS idx_leases_status ON leases(status);
CREATE INDEX IF NOT EXISTS idx_leases_created_at ON leases(created_at DESC);

-- Enable RLS
ALTER TABLE leases ENABLE ROW LEVEL SECURITY;

-- RLS policies (allow authenticated users)
DROP POLICY IF EXISTS "Allow authenticated read" ON leases;
CREATE POLICY "Allow authenticated read" ON leases FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert" ON leases;
CREATE POLICY "Allow authenticated insert" ON leases FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated update" ON leases;
CREATE POLICY "Allow authenticated update" ON leases FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated delete" ON leases;
CREATE POLICY "Allow authenticated delete" ON leases FOR DELETE TO authenticated USING (true);

-- =============================================================================
-- 2. LEASE AMORTIZATION SCHEDULE (optional)
-- =============================================================================
CREATE TABLE IF NOT EXISTS lease_amortization_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id UUID REFERENCES leases(id) ON DELETE CASCADE,
  period INT,
  period_date DATE,
  opening_balance NUMERIC,
  payment NUMERIC,
  interest NUMERIC,
  principal NUMERIC,
  closing_balance NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_amort_lease_id ON lease_amortization_schedule(lease_id);
ALTER TABLE lease_amortization_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read amort" ON lease_amortization_schedule FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert amort" ON lease_amortization_schedule FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated delete amort" ON lease_amortization_schedule FOR DELETE TO authenticated USING (true);
