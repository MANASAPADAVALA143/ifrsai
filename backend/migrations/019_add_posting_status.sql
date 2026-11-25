-- HIGH-002 remediation: add 'posting' intermediate status to prevent double-posting.
--
-- The CAS claim in post_journal transitions approved → posting atomically.
-- A second concurrent request finds status != 'approved' and fails the CAS,
-- returning a 409 instead of pushing to ERP a second time.
--
-- This migration extends the CHECK constraint to allow the new status.
-- Rollback: re-run the ALTER to restore the original constraint.

ALTER TABLE ifrs15_staged_journals
  DROP CONSTRAINT IF EXISTS ifrs15_staged_journals_status_check;

ALTER TABLE ifrs15_staged_journals
  ADD CONSTRAINT ifrs15_staged_journals_status_check
  CHECK (status IN ('draft', 'pending_review', 'approved', 'posting', 'posted', 'failed', 'reversed'));

NOTIFY pgrst, 'reload schema';
