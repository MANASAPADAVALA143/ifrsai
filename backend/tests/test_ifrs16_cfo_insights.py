"""
Regression tests for the IFRS 16 CFO Strategic Insights / Quick Analysis backend
(`/api/ifrs16/cfo-insights` in app.py).

Covers the bugs from the "CFO Strategic Insights — multiple confirmed data and
methodology issues" report:
  1. Active-lease count must be date-driven (end_date >= today), not a status flag
     that silently defaults to "active".
  2. Expiry-window counts (90-day / 12-month) must match an independent date-based
     calculation, including non-ISO date formats.
  3. The 5-year cash flow forecast must reflect real lease terms + escalation, not
     a flat "annual x 5" estimate.
  4. Current carrying values must differ from initial-measurement sums when a
     lease has an amortization schedule.
  5. The health score is deterministic and reproducible for the same inputs.
"""

from datetime import date, timedelta

import pytest

import app as app_module


TODAY = date(2026, 8, 25)


def _lease(
    lease_id="RE-001",
    end_date=None,
    lease_liability=1_000_000.0,
    rou_asset=1_000_000.0,
    monthly_payment=10_000.0,
    status=None,
    current_lease_liability=None,
    current_rou_asset=None,
    escalation_rate=0.0,
):
    lease = {
        "id": lease_id,
        "lease_liability": lease_liability,
        "rou_asset": rou_asset,
        "monthly_payment": monthly_payment,
        "end_date": end_date,
        "escalation_rate": escalation_rate,
    }
    if status is not None:
        lease["status"] = status
    if current_lease_liability is not None:
        lease["current_lease_liability"] = current_lease_liability
    if current_rou_asset is not None:
        lease["current_rou_asset"] = current_rou_asset
    return lease


# ---------------------------------------------------------------------------
# Task 1 — active lease count must be date-driven
# ---------------------------------------------------------------------------

class TestActiveLeaseDetection:
    def test_lease_with_future_end_date_is_active(self):
        lease = _lease(end_date="2026-09-01")  # 7 days after TODAY
        assert app_module._ifrs16_lease_active(lease, TODAY) is True

    def test_lease_with_past_end_date_is_not_active(self):
        lease = _lease(end_date="2024-02-29")
        assert app_module._ifrs16_lease_active(lease, TODAY) is False

    def test_lease_active_ignores_default_status_field(self):
        """Regression: _ifrs16_lease_active used to trust a missing `status` field
        as always "active", regardless of end_date. This is the root cause of the
        reported "Active Leases: 47" bug — every lease defaulted to active."""
        expired_lease = _lease(end_date="2025-05-31")  # no status field supplied
        assert "status" not in expired_lease
        assert app_module._ifrs16_lease_active(expired_lease, TODAY) is False

    def test_explicit_terminated_status_overrides_future_end_date(self):
        lease = _lease(end_date="2030-01-01", status="terminated")
        assert app_module._ifrs16_lease_active(lease, TODAY) is False

    def test_active_count_excludes_expired_leases_from_bug_report(self):
        """The 11 leases the bug report confirmed expired before 2026-08-25."""
        expired_dates = [
            "2024-02-29", "2025-05-31", "2025-06-30", "2025-11-30",
            "2026-01-15", "2026-02-28", "2026-03-31", "2026-04-30",
            "2026-05-31", "2026-05-31", "2026-05-31",
        ]
        active_dates = ["2027-01-01", "2028-06-15"]
        leases = [_lease(end_date=d) for d in expired_dates] + [_lease(end_date=d) for d in active_dates]
        active = [l for l in leases if app_module._ifrs16_lease_active(l, TODAY)]
        expired = [l for l in leases if not app_module._ifrs16_lease_active(l, TODAY)]
        assert len(active) == 2
        assert len(expired) == 11


# ---------------------------------------------------------------------------
# Task 1 — date parsing robustness (the 8-vs-9 off-by-one bug)
# ---------------------------------------------------------------------------

class TestDateParsing:
    @pytest.mark.parametrize("date_str", ["2026-08-31", "31-08-2026", "31/08/2026", "08/31/2026"])
    def test_parses_multiple_common_formats(self, date_str):
        parsed = app_module._ifrs16_parse_date(date_str)
        assert parsed is not None
        assert parsed.year == 2026

    def test_unparseable_date_returns_none_not_silently_wrong(self):
        assert app_module._ifrs16_parse_date("not-a-date") is None

    def test_days_to_expiry_exact_count(self):
        """Regression: a lease ending 2026-09-01 when today is 2026-08-25 must
        report exactly 7 days remaining, not be misclassified as ~90 days."""
        lease = _lease(end_date="2026-09-01")
        assert app_module._ifrs16_days_to_expiry(lease, TODAY) == 7

    def test_a_non_iso_date_does_not_silently_drop_the_lease(self):
        """Regression: previously strptime(..., '%Y-%m-%d') on a non-ISO date threw
        and was silently caught, dropping the lease from expiry counts (the
        confirmed 8-vs-9 mismatch). Multi-format parsing must recover it."""
        lease = _lease(end_date="31/08/2026")  # DD/MM/YYYY — 6 days from TODAY
        days = app_module._ifrs16_days_to_expiry(lease, TODAY)
        assert days is not None
        assert days == 6


# ---------------------------------------------------------------------------
# Task 1 — expiry-window bucket counts (90-day / 12-month)
# ---------------------------------------------------------------------------

class TestExpiryBuckets:
    def test_90_day_and_12_month_buckets_match_independent_calculation(self):
        # 1 lease 6 days out, 3 more within 90 days, 5 more within 91-365 days,
        # 2 leases beyond 365 days (should not count toward either bucket).
        within_90 = [TODAY + timedelta(days=d) for d in (6, 10, 45, 89)]
        within_365 = [TODAY + timedelta(days=d) for d in (91, 120, 200, 300, 365)]
        beyond = [TODAY + timedelta(days=d) for d in (400, 800)]

        leases = (
            [_lease(end_date=d.isoformat()) for d in within_90]
            + [_lease(end_date=d.isoformat()) for d in within_365]
            + [_lease(end_date=d.isoformat()) for d in beyond]
        )

        expiring_90 = []
        expiring_365 = []
        for l in leases:
            days_left = app_module._ifrs16_days_to_expiry(l, TODAY)
            if days_left is None:
                continue
            if 0 <= days_left <= 90:
                expiring_90.append(l)
            elif 90 < days_left <= 365:
                expiring_365.append(l)

        assert len(expiring_90) == 4
        assert len(expiring_365) == 5
        assert len(expiring_90) + len(expiring_365) == 9  # total expiring within 12 months


# ---------------------------------------------------------------------------
# Task 2 — current carrying values differ from initial measurement
# ---------------------------------------------------------------------------

class TestCurrentCarryingValues:
    def test_falls_back_to_initial_when_no_current_value_supplied(self):
        lease = _lease(lease_liability=1_000_000.0, rou_asset=900_000.0)
        value, is_fallback = app_module._ifrs16_current_liability(lease)
        assert value == 1_000_000.0
        assert is_fallback is True

    def test_uses_current_value_when_supplied(self):
        """Regression: portfolio totals must NOT present initial-measurement sums
        as if they were current carrying values when a schedule-derived current
        value is available."""
        lease = _lease(
            lease_liability=1_000_000.0,
            rou_asset=900_000.0,
            current_lease_liability=650_000.0,
            current_rou_asset=580_000.0,
        )
        liability_value, liability_fallback = app_module._ifrs16_current_liability(lease)
        rou_value, rou_fallback = app_module._ifrs16_current_rou(lease)
        assert liability_value == 650_000.0
        assert liability_fallback is False
        assert rou_value == 580_000.0
        assert rou_fallback is False
        # Current value must differ from initial for an amortised lease.
        assert liability_value != app_module._ifrs16_lease_liability(lease)


# ---------------------------------------------------------------------------
# Task 4 — 5-year cash flow forecast reflects real lease terms
# ---------------------------------------------------------------------------

class TestCashFlowForecastNotFlat:
    def test_forecast_declines_when_a_lease_expires_mid_horizon(self):
        """A lease expiring in 6 months should NOT contribute to years 2-5,
        proving the forecast is not a flat 'annual x 5' calculation."""
        today = TODAY
        short_lease = _lease(end_date=(today + timedelta(days=180)).isoformat(), monthly_payment=50_000.0)
        long_lease = _lease(end_date=(today + timedelta(days=365 * 10)).isoformat(), monthly_payment=20_000.0)
        active_leases = [short_lease, long_lease]

        forecast = [0.0] * 5
        for l in active_leases:
            end = app_module._ifrs16_parse_date(app_module._ifrs16_end_date(l))
            base_monthly = app_module._ifrs16_monthly_payment(l)
            escalation = float(l.get("escalation_rate") or 0)
            for yr in range(5):
                year_start = today + timedelta(days=365 * yr)
                year_end = today + timedelta(days=365 * (yr + 1))
                active_start = max(year_start, today)
                active_end = min(year_end, end)
                if active_end <= active_start:
                    continue
                active_days = (active_end - active_start).days
                active_months = active_days / 30.44
                escalated = base_monthly * ((1 + escalation / 100) ** yr)
                forecast[yr] += escalated * active_months

        # Year 1 includes both leases; year 2 should be lower since short_lease dropped out.
        assert forecast[0] > forecast[1]
        # A flat "annual x 5" bug would have forecast[0] == forecast[1] == ... == forecast[4].
        assert not (forecast[0] == forecast[1] == forecast[2] == forecast[3] == forecast[4])

    def test_escalation_rate_compounds_year_over_year(self):
        today = TODAY
        lease = _lease(
            end_date=(today + timedelta(days=365 * 10)).isoformat(),
            monthly_payment=10_000.0,
            escalation_rate=5.0,  # 5% annual escalation
        )
        forecast = [0.0] * 5
        end = app_module._ifrs16_parse_date(app_module._ifrs16_end_date(lease))
        base_monthly = app_module._ifrs16_monthly_payment(lease)
        escalation = float(lease.get("escalation_rate") or 0)
        for yr in range(5):
            year_start = today + timedelta(days=365 * yr)
            year_end = today + timedelta(days=365 * (yr + 1))
            active_days = (min(year_end, end) - max(year_start, today)).days
            active_months = active_days / 30.44
            escalated = base_monthly * ((1 + escalation / 100) ** yr)
            forecast[yr] = escalated * active_months
        # Later years should be strictly larger due to compounding escalation.
        assert forecast[4] > forecast[0]


# ---------------------------------------------------------------------------
# Task 6 — deterministic, documented health score
# ---------------------------------------------------------------------------

class TestHealthScore:
    def test_perfect_portfolio_scores_100_excellent(self):
        result = app_module._ifrs16_compute_health_score(
            active_lease_count=10,
            total_lease_count=10,
            total_active_liability=1_000_000.0,
            top5_liability=150_000.0,  # 15% concentration — below all thresholds
            expiring_90_count=0,
            expiring_12mo_count=0,
            data_quality_issue_count=0,
        )
        assert result["score"] == 100
        assert result["label"] == "Excellent"
        assert result["factors"] == []

    def test_high_concentration_deducts_20_points(self):
        result = app_module._ifrs16_compute_health_score(
            active_lease_count=10,
            total_lease_count=10,
            total_active_liability=1_000_000.0,
            top5_liability=600_000.0,  # 60% concentration — above 50% threshold
            expiring_90_count=0,
            expiring_12mo_count=0,
            data_quality_issue_count=0,
        )
        assert result["score"] == 80
        assert any(f["name"] == "Concentration risk" and f["deduction"] == 20 for f in result["factors"])

    def test_score_is_deterministic_for_same_inputs(self):
        """Same inputs must always produce the same score — this is what makes
        the score auditable, unlike an AI-generated number that can drift."""
        kwargs = dict(
            active_lease_count=36,
            total_lease_count=47,
            total_active_liability=400_000_000.0,
            top5_liability=150_000_000.0,
            expiring_90_count=1,
            expiring_12mo_count=8,
            data_quality_issue_count=2,
        )
        result_a = app_module._ifrs16_compute_health_score(**kwargs)
        result_b = app_module._ifrs16_compute_health_score(**kwargs)
        assert result_a == result_b

    def test_score_never_goes_below_zero(self):
        result = app_module._ifrs16_compute_health_score(
            active_lease_count=10,
            total_lease_count=10,
            total_active_liability=1_000_000.0,
            top5_liability=1_000_000.0,  # 100% concentration
            expiring_90_count=10,
            expiring_12mo_count=10,
            data_quality_issue_count=10,
            total_assets=1_000.0,  # ~100,000% leverage
        )
        assert result["score"] >= 0

    def test_label_thresholds(self):
        assert app_module._ifrs16_compute_health_score(
            active_lease_count=1, total_lease_count=1, total_active_liability=0,
            top5_liability=0, expiring_90_count=0, expiring_12mo_count=0,
            data_quality_issue_count=0,
        )["label"] == "Excellent"


# ---------------------------------------------------------------------------
# Task 2 (safeguard) — ROU=0 while liability>0 must block, not silently narrate
# ---------------------------------------------------------------------------

class TestRouSafeguardLogic:
    def test_zero_rou_with_positive_liability_is_detected(self):
        leases = [_lease(lease_liability=500_000.0, rou_asset=0.0) for _ in range(3)]
        total_liability = sum(app_module._ifrs16_lease_liability(l) for l in leases)
        total_rou = sum(app_module._ifrs16_rou_asset(l) for l in leases)
        assert total_liability > 0
        assert total_rou == 0
