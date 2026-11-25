-- HIGH-001 remediation: revoke GRANT ALL TO anon on Phase 0 tables.
--
-- Migrations 014-016 each included GRANT ALL TO anon which allows unauthenticated
-- direct PostgREST writes bypassing all FastAPI validation.
--
-- After this migration:
--   anon role     → no access (PostgREST rejects unauthenticated writes)
--   authenticated → SELECT only (read via PostgREST if needed in future)
--   service_role  → full access (Python backend uses this key; unchanged)
--
-- Rollback: safe to re-run; REVOKE of a privilege not held is a no-op.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ifrs15_contract_qualifications') THEN
    REVOKE ALL ON TABLE ifrs15_contract_qualifications FROM anon;
    GRANT SELECT ON TABLE ifrs15_contract_qualifications TO authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ifrs15_vc_assessments') THEN
    REVOKE ALL ON TABLE ifrs15_vc_assessments FROM anon;
    GRANT SELECT ON TABLE ifrs15_vc_assessments TO authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ifrs15_staged_journals') THEN
    REVOKE ALL ON TABLE ifrs15_staged_journals FROM anon;
    GRANT SELECT ON TABLE ifrs15_staged_journals TO authenticated;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
