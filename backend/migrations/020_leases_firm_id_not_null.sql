-- CRIT-003 remediation: enforce firm_id NOT NULL on the legacy leases table.
--
-- PREREQUISITE: Run backfill_leases_firm_id.py --apply first and confirm:
--   1. Zero rows remain with firm_id IS NULL
--   2. Zero rows remain with firm_id = 'QUARANTINE'
--
-- This migration will FAIL if any NULL or QUARANTINE rows still exist.
-- Do NOT apply to production until the backfill is fully resolved.
--
-- Rollback: DROP CONSTRAINT and DROP DEFAULT (safe; does not delete data).

-- Safety check: fail loudly if any rows still need resolution.
DO $$
DECLARE
  unresolved_count INT;
BEGIN
  SELECT COUNT(*) INTO unresolved_count
  FROM leases
  WHERE firm_id IS NULL OR firm_id = 'QUARANTINE';

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION
      'Migration blocked: % leases row(s) still have NULL or QUARANTINE firm_id. '
      'Run backfill_leases_firm_id.py --apply and resolve all quarantined rows first.',
      unresolved_count;
  END IF;
END $$;

-- Set a default for future inserts (application layer must always supply firm_id,
-- but this prevents accidental NULLs from non-validated paths).
ALTER TABLE leases
  ALTER COLUMN firm_id SET DEFAULT 'default';

-- Enforce NOT NULL now that all rows are resolved.
ALTER TABLE leases
  ALTER COLUMN firm_id SET NOT NULL;

NOTIFY pgrst, 'reload schema';
