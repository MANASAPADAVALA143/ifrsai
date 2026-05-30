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
