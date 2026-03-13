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
-- LEASES QUERIES
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
