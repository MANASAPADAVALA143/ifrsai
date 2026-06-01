"""Quarterly revenue schedule — SPA inception date (IFRS 15.9)."""

from backend.app.services.ifrs15_realestate import generate_quarterly_revenue_schedule


def _base_data(**overrides):
    data = {
        "contract_value": 2_000_000,
        "construction_start": "2023-01-01",
        "spa_execution_date": "2024-01-15",
        "expected_handover": "2025-09-30",
        "current_date": "2024-12-31",
        "costs_incurred_to_date": 1_300_000,
        "total_estimated_costs": 2_000_000,
        "revenue_recognition_trigger": "earlier_of_both",
        "spa_handover_date": "2025-09-30",
        "escrow_receipts": [],
    }
    data.update(overrides)
    return data


def test_schedule_starts_from_spa_not_construction():
    schedule = generate_quarterly_revenue_schedule(_base_data())
    assert schedule, "expected non-empty schedule"
    periods = [row["period"] for row in schedule]
    assert all("2023" not in p for p in periods), f"pre-SPA quarters must be excluded: {periods}"
    assert periods[0].startswith("Q1 2024") or "2024" in periods[0]
    assert all("2024" in p for p in periods)


def test_cumulative_revenue_at_measurement_date():
    schedule = generate_quarterly_revenue_schedule(_base_data())
    last = schedule[-1]
    assert last["cumulative_revenue"] == 1_300_000
    assert last["completion_pct"] == 65.0


def test_even_quarterly_split_four_quarters_2024():
    schedule = generate_quarterly_revenue_schedule(_base_data())
    assert len(schedule) == 4
    assert [row["period"] for row in schedule] == [
        "Q1 2024",
        "Q2 2024",
        "Q3 2024",
        "Q4 2024",
    ]
    for row in schedule:
        assert row["revenue_recognised"] == 325_000
    assert sum(row["revenue_recognised"] for row in schedule) == 1_300_000


def test_prior_and_current_period_quarterly_split():
    schedule = generate_quarterly_revenue_schedule(
        _base_data(revenue_prior_period=1_026_000)
    )
    assert [row["period"] for row in schedule] == [
        "Q1 2024",
        "Q2 2024",
        "Q3 2024",
        "Q4 2024",
    ]
    assert [row["revenue_recognised"] for row in schedule] == [
        342_000,
        342_000,
        342_000,
        274_000,
    ]
    assert [row["cumulative_revenue"] for row in schedule] == [
        342_000,
        684_000,
        1_026_000,
        1_300_000,
    ]


def test_period_bounds_include_spa_start_on_first_quarter():
    schedule = generate_quarterly_revenue_schedule(_base_data())
    first = schedule[0]
    assert first["period_start"] == "2024-01-15"
    assert first["period_end"] >= "2024-03-31"[:10] or first["period_end"].startswith("2024")


def test_no_spa_date_falls_back_to_construction_start():
    data = _base_data()
    del data["spa_execution_date"]
    schedule = generate_quarterly_revenue_schedule(data)
    assert schedule
    assert any("2023" in row["period"] for row in schedule)


def test_report_request_preserves_spa_execution_date():
    from app import RealEstateReportRequest

    req = RealEstateReportRequest(
        rera_registration_number="1234567890",
        contract_value=2_000_000,
        construction_start="2023-01-01",
        spa_execution_date="2024-01-15",
        contract_date="2024-01-15",
        expected_handover="2025-09-30",
        current_date="2024-12-31",
        costs_incurred_to_date=1_300_000,
        total_estimated_costs=2_000_000,
    )
    body = req.model_dump()
    assert body.get("spa_execution_date") == "2024-01-15"
    assert body.get("contract_date") == "2024-01-15"


def test_report_engine_excludes_pre_spa_quarters_via_api_body():
    from app import RealEstateReportRequest
    from backend.app.services.ifrs15_realestate import RealEstateReportEngine

    req = RealEstateReportRequest(
        rera_registration_number="1234567890",
        contract_value=2_000_000,
        construction_start="2023-01-01",
        spa_execution_date="2024-01-15",
        expected_handover="2025-09-30",
        current_date="2024-12-31",
        costs_incurred_to_date=1_300_000,
        total_estimated_costs=2_000_000,
        revenue_prior_period=1_026_000,
    )
    report = RealEstateReportEngine().build(req.model_dump())
    periods = [row["period"] for row in report["period_schedule"]]
    assert periods == ["Q1 2024", "Q2 2024", "Q3 2024", "Q4 2024"]
    assert [row["revenue_recognised"] for row in report["period_schedule"]] == [
        342_000,
        342_000,
        342_000,
        274_000,
    ]
    q2 = report["period_schedule"][1]
    assert q2["cumulative_revenue"] == 684_000
    vat_periods = [row["period"] for row in report["vat"]["alignment_table"]]
    assert vat_periods == periods
    assert report["period_schedule"][-1]["cumulative_revenue"] == 1_300_000
    assert report["schedule_validation"]["valid"] is True
    assert report["vat"]["total_vat"] == 65_000


def test_schedule_uses_off_plan_revenue_not_stale_quarter_count():
    """Even with 8 pre-SPA quarter slots, off-plan revenue_to_date drives the spread."""
    from backend.app.services.ifrs15_realestate import (
        _spread_period_revenues,
        validate_quarterly_schedule_total,
    )

    # Simulates filtered UI: 4 quarters after SPA, totals from off-plan
    revenues = _spread_period_revenues(4, 1_300_000, 1_026_000, 274_000)
    assert revenues == [342_000, 342_000, 342_000, 274_000]
    schedule = [{"revenue_recognised": r} for r in revenues]
    check = validate_quarterly_schedule_total(schedule, 1_300_000)
    assert check["valid"] is True
