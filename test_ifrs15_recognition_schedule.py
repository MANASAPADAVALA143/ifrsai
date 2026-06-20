"""IFRS 15 recognition schedule tests — SaaS / multi-PO reference contract."""

from datetime import datetime
from decimal import Decimal

import pytest

from ifrs15_calculator import IFRS15Calculator, IFRS15Input, PerformanceObligation


def _reference_saas_contract() -> IFRS15Input:
    return IFRS15Input(
        contract_id="REF-SAAS-2024",
        customer_name="Reference Customer",
        effective_date=datetime(2024, 1, 1),
        contract_term_months=12,
        fixed_consideration=Decimal("780000"),
        currency="AED",
        performance_obligations=[
            PerformanceObligation(
                obligation_id="PO-1",
                description="Onboarding and implementation — delivered over 3 months",
                standalone_selling_price=Decimal("157500"),
                recognition_method="over_time",
                duration_months=3,
            ),
            PerformanceObligation(
                obligation_id="PO-2",
                description="Data migration services",
                standalone_selling_price=Decimal("18750"),
                recognition_method="point_in_time",
            ),
            PerformanceObligation(
                obligation_id="PO-3",
                description="SaaS licence — 12 months from go-live date 2024-03-01",
                standalone_selling_price=Decimal("420000"),
                recognition_method="over_time",
                duration_months=12,
            ),
            PerformanceObligation(
                obligation_id="PO-4",
                description="Technical support — 12 months from go-live date 2024-03-01",
                standalone_selling_price=Decimal("105000"),
                recognition_method="over_time",
                duration_months=12,
            ),
            PerformanceObligation(
                obligation_id="PO-5",
                description="Training services — 3 sessions every 3 months",
                standalone_selling_price=Decimal("78750"),
                recognition_method="point_in_time",
            ),
        ],
    )


def _fy2024_revenue(schedule) -> float:
    if schedule.empty:
        return 0.0
    mask = schedule["Date"].astype(str).str.startswith("2024")
    return float(schedule.loc[mask, "Scheduled_Revenue"].sum())


def test_onboarding_spread_three_months_not_twelve():
    calc = IFRS15Calculator()
    contract = _reference_saas_contract()
    tp = calc.calculate_transaction_price(contract)
    allocations = calc.allocate_transaction_price(tp, contract.performance_obligations)
    schedule, _ = calc.generate_recognition_schedule(contract, allocations)
    ob = schedule[schedule["Obligation_ID"] == "PO-1"]
    assert len(ob) == 3
    assert ob["Scheduled_Revenue"].iloc[0] == pytest.approx(52500.0, abs=1.0)


def test_saas_recognised_from_go_live_march():
    calc = IFRS15Calculator()
    contract = _reference_saas_contract()
    tp = calc.calculate_transaction_price(contract)
    allocations = calc.allocate_transaction_price(tp, contract.performance_obligations)
    schedule, license_meta = calc.generate_recognition_schedule(contract, allocations)
    saas = schedule[schedule["Obligation_ID"] == "PO-3"]
    assert not saas.empty
    assert saas["Date"].min().startswith("2024-03")
    assert len(saas) == 12
    assert license_meta[0]["license_classification"] == "right-to-access"
    # All licence months should be recognised (report date after Feb 2025)
    assert float(saas["Revenue"].sum()) == pytest.approx(float(allocations["PO-3"]), abs=1.0)


def test_fy2024_total_692500():
    calc = IFRS15Calculator()
    contract = _reference_saas_contract()
    results = calc.calculate_full_ifrs15(contract)
    schedule = results["recognition_schedule"]
    fy2024 = _fy2024_revenue(schedule)
    assert fy2024 == pytest.approx(692500.0, abs=500.0)


def test_saas_pct_complete_100_by_2026():
    calc = IFRS15Calculator()
    contract = _reference_saas_contract()
    results = calc.calculate_full_ifrs15(contract)
    saas = next(
        p for p in results["performance_obligations"] if "SaaS" in p["obligation"]
    )
    assert saas["pct_complete"] == pytest.approx(100.0, abs=0.1)
    assert saas["revenue_recognized"] == pytest.approx(420000.0, abs=1.0)


def test_ssp_table_and_audit_trail_present():
    calc = IFRS15Calculator()
    contract = _reference_saas_contract()
    results = calc.calculate_full_ifrs15(contract)
    assert len(results["ssp_allocation_table"]) == 5
    assert "AED" in results["revenue_recognition_audit_trail"]
    assert results["revenue_engine_result"].get("schedule_based") is True
