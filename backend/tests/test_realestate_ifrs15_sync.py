"""Sync to IFRS 15 — SPA date, revenue to date, quarterly schedule (Marina Heights)."""

from backend.app.services.ifrs15_realestate import (
    build_ifrs15_calculate_payload,
    generate_quarterly_revenue_schedule,
    merge_realestate_into_calculate_results,
    period_schedule_to_ifrs15_revenue_schedule,
)


def _marina_off_plan():
    return {
        "completion_pct": 65.0,
        "revenue_recognised_to_date": 1_300_000,
        "revenue_current_period": 274_000,
        "contract_asset": 100_000,
        "contract_liability": 0,
        "escrow_balance": 1_200_000,
        "billings_to_date": 1_200_000,
    }


def _marina_data():
    return {
        "contract_value": 2_000_000,
        "construction_start": "2023-01-01",
        "spa_execution_date": "2024-01-15",
        "expected_handover": "2025-09-30",
        "current_date": "2024-12-31",
        "costs_incurred_to_date": 1_300_000,
        "total_estimated_costs": 2_000_000,
        "revenue_prior_period": 1_026_000,
        "escrow_receipts": [],
    }


def test_calculate_payload_uses_spa_date_and_aed():
    schedule = generate_quarterly_revenue_schedule(_marina_data())
    payload = build_ifrs15_calculate_payload(
        off_plan=_marina_off_plan(),
        construction_start="2023-01-01",
        spa_execution_date="2024-01-15",
        expected_handover="2025-09-30",
        contract_value=2_000_000,
        costs_incurred=1_300_000,
        total_costs=2_000_000,
        revenue_prior=1_026_000,
        period_schedule=schedule,
        currency="AED",
    )
    assert payload["effective_date"] == "2024-01-15"
    assert payload["currency"] == "AED"
    assert payload["fixed_consideration"] == 2_000_000
    po = payload["performance_obligations"][0]
    assert po["standalone_selling_price"] == 1_300_000
    assert "cost-to-cost" in po["description"]
    assert payload["realestate_period_schedule"]
    assert payload["realestate_period_schedule"][0]["period"].startswith("Q1 2024")


def test_period_schedule_maps_to_ifrs15_rows():
    schedule = generate_quarterly_revenue_schedule(_marina_data())
    rows = period_schedule_to_ifrs15_revenue_schedule(schedule)
    assert len(rows) == 4
    assert rows[0]["Month"].startswith("Q1 2024")
    assert rows[-1]["Cumulative"] == 1_300_000


def test_merge_sets_recognised_poc_and_period_revenue():
    schedule = generate_quarterly_revenue_schedule(_marina_data())
    overlay = _marina_off_plan()
    base = {
        "total_contract_value": 2_000_000,
        "transaction_price": 2_000_000,
        "total_recognised": 0,
        "revenue_engine_result": {},
        "disclosure_data": {"contract_details": {"currency": "USD"}},
    }
    merged = merge_realestate_into_calculate_results(
        base,
        period_schedule=schedule,
        overlay=overlay,
        currency="AED",
    )
    assert merged["total_recognised"] == 1_300_000
    assert merged["revenue_engine_result"]["poc_percentage"] == 65.0
    assert merged["revenue_engine_result"]["revenue_this_period"] == 274_000
    assert merged["disclosure_data"]["contract_details"]["currency"] == "AED"
    assert merged["revenue_schedule"][-1]["Cumulative"] == 1_300_000
