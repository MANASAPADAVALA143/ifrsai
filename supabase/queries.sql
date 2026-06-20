-- IFRS AI - Supabase Queries
-- Run these in Supabase Dashboard → SQL Editor as needed

-- =============================================================================
-- AUTH QUERIES
-- =============================================================================

-- List users
SELECT id, email, created_at, last_sign_in_at
FROM auth.users
ORDER BY created_at DESC;

-- Count users
SELECT COUNT(*) AS user_count FROM auth.users;

-- Sessions
SELECT * FROM auth.sessions;

-- =============================================================================
-- IFRS 16 PORTFOLIO (after running backend/migrations/003_ifrs16_persistence.sql)
-- =============================================================================

-- All IFRS 16 leases for a firm
SELECT lease_id, lease_name, status, summary_data, created_at
FROM ifrs16_leases
WHERE firm_id = 'default'
ORDER BY created_at DESC;

-- Portfolio summary (computed in app; raw roll-up)
SELECT
  firm_id,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE status NOT IN ('deleted', 'terminated')) AS active_count
FROM ifrs16_leases
GROUP BY firm_id;

-- =============================================================================
-- IFRS 16 COMPARATIVE (after running backend/migrations/004_ifrs16_period_snapshots.sql)
-- =============================================================================

-- Firm fiscal year settings
SELECT firm_id, fiscal_year_end, currency, country, ibr_default
FROM ifrs16_firm_settings
ORDER BY firm_id;

-- Period snapshots for a firm
SELECT period_label, status, period_start, period_end,
       rou_closing, ll_closing, pl_total, lease_count_active, closed_at
FROM ifrs16_period_snapshots
WHERE firm_id = 'default'
ORDER BY period_end DESC;

-- Comparative view (current + prior year side by side)
SELECT current_period, prior_period, rou_closing_curr, rou_closing_prior,
       ll_closing_curr, ll_closing_prior, pl_total_curr, pl_total_prior
FROM ifrs16_comparative_view
WHERE firm_id = 'default';

-- =============================================================================
-- LEGACY LEASES TABLE (supabase/schema.sql — not wired to IFRS 16 app yet)
-- =============================================================================

-- All leases
SELECT * FROM leases ORDER BY created_at DESC;

-- Active leases only
SELECT * FROM leases WHERE status = 'active';

-- Lease by ID
SELECT * FROM leases WHERE lease_id = 'LEASE-2026-525612';

-- Summary stats
SELECT 
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE status = 'active') AS active_count,
  COALESCE(SUM(lease_liability), 0) AS total_liability,
  COALESCE(SUM(rou_asset), 0) AS total_rou
FROM leases;

-- Leases expiring in next 12 months
SELECT lease_id, lessee_name, end_date, monthly_payment
FROM leases
WHERE status = 'active' 
  AND end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '12 months'
ORDER BY end_date;
