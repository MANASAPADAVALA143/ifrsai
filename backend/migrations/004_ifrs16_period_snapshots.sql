-- IFRS 16 Comparative Period Reporting
-- Period snapshots + firm fiscal year settings
-- Prerequisite: 003_ifrs16_persistence.sql (lease portfolio tables)

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS ifrs16_firm_settings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id         TEXT UNIQUE NOT NULL,
    firm_name       TEXT,
    fiscal_year_end TEXT NOT NULL DEFAULT '12-31',
    currency        TEXT DEFAULT 'AED',
    country         TEXT DEFAULT 'UAE',
    ibr_default     NUMERIC(8,6) DEFAULT 0.055,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ifrs16_period_snapshots (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id             TEXT NOT NULL,
    entity_name         TEXT,
    period_label        TEXT NOT NULL,
    period_type         TEXT NOT NULL DEFAULT 'annual',
    period_start        DATE NOT NULL,
    period_end          DATE NOT NULL,
    fiscal_year_end     TEXT NOT NULL,
    status              TEXT DEFAULT 'draft',
    closed_at           TIMESTAMPTZ,
    closed_by           TEXT,
    reopened_at         TIMESTAMPTZ,
    reopened_by         TEXT,
    rou_opening         NUMERIC(18,2) DEFAULT 0,
    rou_additions       NUMERIC(18,2) DEFAULT 0,
    rou_depreciation    NUMERIC(18,2) DEFAULT 0,
    rou_disposals       NUMERIC(18,2) DEFAULT 0,
    rou_remeasurements  NUMERIC(18,2) DEFAULT 0,
    rou_closing         NUMERIC(18,2) DEFAULT 0,
    ll_opening          NUMERIC(18,2) DEFAULT 0,
    ll_new_leases       NUMERIC(18,2) DEFAULT 0,
    ll_interest         NUMERIC(18,2) DEFAULT 0,
    ll_payments         NUMERIC(18,2) DEFAULT 0,
    ll_modifications    NUMERIC(18,2) DEFAULT 0,
    ll_terminations     NUMERIC(18,2) DEFAULT 0,
    ll_remeasurements   NUMERIC(18,2) DEFAULT 0,
    ll_closing          NUMERIC(18,2) DEFAULT 0,
    ll_current          NUMERIC(18,2) DEFAULT 0,
    ll_non_current      NUMERIC(18,2) DEFAULT 0,
    pl_depreciation     NUMERIC(18,2) DEFAULT 0,
    pl_interest         NUMERIC(18,2) DEFAULT 0,
    pl_short_term       NUMERIC(18,2) DEFAULT 0,
    pl_low_value        NUMERIC(18,2) DEFAULT 0,
    pl_variable         NUMERIC(18,2) DEFAULT 0,
    pl_total            NUMERIC(18,2) DEFAULT 0,
    cf_principal        NUMERIC(18,2) DEFAULT 0,
    cf_interest         NUMERIC(18,2) DEFAULT 0,
    cf_short_term       NUMERIC(18,2) DEFAULT 0,
    cf_low_value        NUMERIC(18,2) DEFAULT 0,
    cf_total            NUMERIC(18,2) DEFAULT 0,
    mat_less_1yr        NUMERIC(18,2) DEFAULT 0,
    mat_1_to_2yr        NUMERIC(18,2) DEFAULT 0,
    mat_2_to_3yr        NUMERIC(18,2) DEFAULT 0,
    mat_3_to_4yr        NUMERIC(18,2) DEFAULT 0,
    mat_4_to_5yr        NUMERIC(18,2) DEFAULT 0,
    mat_over_5yr        NUMERIC(18,2) DEFAULT 0,
    mat_total           NUMERIC(18,2) DEFAULT 0,
    lease_count_active      INTEGER DEFAULT 0,
    lease_count_new         INTEGER DEFAULT 0,
    lease_count_modified    INTEGER DEFAULT 0,
    lease_count_terminated  INTEGER DEFAULT 0,
    lease_count_expired     INTEGER DEFAULT 0,
    lease_details       JSONB,
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (firm_id, period_label, entity_name)
);

CREATE TABLE IF NOT EXISTS ifrs16_lease_period_snapshots (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id         UUID NOT NULL REFERENCES ifrs16_period_snapshots(id) ON DELETE CASCADE,
    firm_id             TEXT NOT NULL,
    lease_id            TEXT,
    lease_name          TEXT NOT NULL,
    entity_name         TEXT,
    asset_type          TEXT,
    currency            TEXT,
    rou_closing         NUMERIC(18,2) DEFAULT 0,
    ll_closing          NUMERIC(18,2) DEFAULT 0,
    ll_current          NUMERIC(18,2) DEFAULT 0,
    ll_non_current      NUMERIC(18,2) DEFAULT 0,
    rou_depreciation    NUMERIC(18,2) DEFAULT 0,
    ll_interest         NUMERIC(18,2) DEFAULT 0,
    ll_payments         NUMERIC(18,2) DEFAULT 0,
    lease_status        TEXT,
    commencement_date   DATE,
    lease_end_date      DATE,
    ibr                 NUMERIC(8,6),
    payment_amount      NUMERIC(18,4),
    amortization_snapshot JSONB,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_firm_period
    ON ifrs16_period_snapshots(firm_id, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_firm_label
    ON ifrs16_period_snapshots(firm_id, period_label);
CREATE INDEX IF NOT EXISTS idx_snapshots_status
    ON ifrs16_period_snapshots(status);
CREATE INDEX IF NOT EXISTS idx_lease_snapshots_snapshot
    ON ifrs16_lease_period_snapshots(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_firm_settings_firm
    ON ifrs16_firm_settings(firm_id);

DROP TRIGGER IF EXISTS ifrs16_snapshots_updated_at ON ifrs16_period_snapshots;
CREATE TRIGGER ifrs16_snapshots_updated_at
    BEFORE UPDATE ON ifrs16_period_snapshots
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS ifrs16_firm_settings_updated_at ON ifrs16_firm_settings;
CREATE TRIGGER ifrs16_firm_settings_updated_at
    BEFORE UPDATE ON ifrs16_firm_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE ifrs16_period_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ifrs16_lease_period_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ifrs16_firm_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS snapshots_firm_isolation ON ifrs16_period_snapshots;
CREATE POLICY snapshots_firm_isolation ON ifrs16_period_snapshots
    USING (firm_id = current_setting('app.current_firm_id', TRUE));

DROP POLICY IF EXISTS lease_snapshots_firm_isolation ON ifrs16_lease_period_snapshots;
CREATE POLICY lease_snapshots_firm_isolation ON ifrs16_lease_period_snapshots
    USING (firm_id = current_setting('app.current_firm_id', TRUE));

DROP POLICY IF EXISTS firm_settings_isolation ON ifrs16_firm_settings;
CREATE POLICY firm_settings_isolation ON ifrs16_firm_settings
    USING (firm_id = current_setting('app.current_firm_id', TRUE));

CREATE OR REPLACE VIEW ifrs16_comparative_view AS
SELECT
    curr.firm_id,
    curr.entity_name,
    curr.period_label                           AS current_period,
    prior.period_label                          AS prior_period,
    curr.rou_opening                            AS rou_opening_curr,
    curr.rou_additions                          AS rou_additions_curr,
    curr.rou_depreciation                       AS rou_depreciation_curr,
    curr.rou_disposals                          AS rou_disposals_curr,
    curr.rou_remeasurements                     AS rou_remeasurements_curr,
    curr.rou_closing                            AS rou_closing_curr,
    prior.rou_closing                           AS rou_opening_prior,
    prior.rou_additions                         AS rou_additions_prior,
    prior.rou_depreciation                      AS rou_depreciation_prior,
    prior.rou_disposals                         AS rou_disposals_prior,
    prior.rou_remeasurements                    AS rou_remeasurements_prior,
    prior.rou_closing                           AS rou_closing_prior,
    curr.ll_opening                             AS ll_opening_curr,
    curr.ll_new_leases                          AS ll_new_leases_curr,
    curr.ll_interest                            AS ll_interest_curr,
    curr.ll_payments                            AS ll_payments_curr,
    curr.ll_modifications                       AS ll_modifications_curr,
    curr.ll_terminations                        AS ll_terminations_curr,
    curr.ll_closing                             AS ll_closing_curr,
    curr.ll_current                             AS ll_current_curr,
    curr.ll_non_current                         AS ll_non_current_curr,
    prior.ll_closing                            AS ll_closing_prior,
    prior.ll_current                            AS ll_current_prior,
    prior.ll_non_current                        AS ll_non_current_prior,
    curr.pl_depreciation                        AS pl_depreciation_curr,
    curr.pl_interest                            AS pl_interest_curr,
    curr.pl_short_term                          AS pl_short_term_curr,
    curr.pl_low_value                           AS pl_low_value_curr,
    curr.pl_total                               AS pl_total_curr,
    prior.pl_depreciation                       AS pl_depreciation_prior,
    prior.pl_interest                           AS pl_interest_prior,
    prior.pl_short_term                         AS pl_short_term_prior,
    prior.pl_low_value                          AS pl_low_value_prior,
    prior.pl_total                              AS pl_total_prior,
    curr.cf_total                               AS cf_total_curr,
    prior.cf_total                              AS cf_total_prior,
    curr.mat_less_1yr                           AS mat_less_1yr_curr,
    curr.mat_1_to_2yr                           AS mat_1_to_2yr_curr,
    curr.mat_2_to_3yr                           AS mat_2_to_3yr_curr,
    curr.mat_3_to_4yr                           AS mat_3_to_4yr_curr,
    curr.mat_4_to_5yr                           AS mat_4_to_5yr_curr,
    curr.mat_over_5yr                           AS mat_over_5yr_curr,
    curr.mat_total                              AS mat_total_curr,
    prior.mat_less_1yr                          AS mat_less_1yr_prior,
    prior.mat_1_to_2yr                          AS mat_1_to_2yr_prior,
    prior.mat_2_to_3yr                          AS mat_2_to_3yr_prior,
    prior.mat_3_to_4yr                          AS mat_3_to_4yr_prior,
    prior.mat_4_to_5yr                          AS mat_4_to_5yr_prior,
    prior.mat_over_5yr                          AS mat_over_5yr_prior,
    prior.mat_total                             AS mat_total_prior
FROM ifrs16_period_snapshots curr
LEFT JOIN ifrs16_period_snapshots prior
    ON prior.firm_id = curr.firm_id
    AND prior.entity_name IS NOT DISTINCT FROM curr.entity_name
    AND prior.period_end = (curr.period_end - INTERVAL '1 year')
    AND prior.status = 'closed'
WHERE curr.status = 'closed';
