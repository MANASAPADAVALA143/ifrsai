-- Expose 064–067 tables to PostgREST (fixes PGRST205 schema cache misses).
-- Safe to re-run. Missing tables are skipped.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ifrs15_billing_transactions',
    'ifrs15_gl_postings',
    'ifrs15_recon_results',
    'ifrs15_contract_modifications',
    'ifrs15_modification_audit',
    'ifrs15_rpo_contracts',
    'ifrs15_rpo_snapshots',
    'ifrs15_rpo_contract_detail',
    'ifrs15_evidence_packs',
    'ifrs15_checklist_items',
    'ifrs15_principal_agent',
    'ifrs15_pa_audit'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format(
        'GRANT ALL ON TABLE public.%I TO anon, authenticated, service_role',
        t
      );
    END IF;
  END LOOP;
END $$;

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
    'ifrs15_checklist_items',
    'ifrs15_principal_agent',
    'ifrs15_pa_audit'
  )
ORDER BY 1;
