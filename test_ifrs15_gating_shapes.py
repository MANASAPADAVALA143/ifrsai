"""IFRS 15 gating rules — TEST-SHAPE-1..4 multi-shape fixtures."""

from datetime import datetime
from decimal import Decimal

import pytest

pytestmark = pytest.mark.ifrs15_standing

from ifrs15_calculator import (  # noqa: E402
    ContractCostInput,
    FinancingComponentInput,
    IFRS15Calculator,
    IFRS15Input,
    PerformanceObligation,
    PrincipalAgentInput,
    build_default_rpo_result,
)


def _monthly_schedule(oid: str, name: str, monthly: float, months: int, start_m: int = 1) -> list:
    rows = []
    y, m = 2026, start_m
    for i in range(months):
        rows.append(
            {
                "Date": f"{y:04d}-{m:02d}-01",
                "Obligation_ID": oid,
                "Obligation": name,
                "Scheduled_Revenue": monthly,
                "Revenue": 0.0,
            }
        )
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return rows


def _pit(oid: str, name: str, amount: float, date: str) -> dict:
    return {
        "Date": date,
        "Obligation_ID": oid,
        "Obligation": name,
        "Scheduled_Revenue": amount,
        "Revenue": 0.0,
    }


@pytest.fixture
def calc() -> IFRS15Calculator:
    return IFRS15Calculator()


@pytest.mark.parametrize(
    "shape_id,schedule,contract,results,exp_fc_blocked,exp_fc_min_rev,exp_periodic",
    [
        (
            "TEST-SHAPE-1",
            _monthly_schedule("PO-1", "Service", 150_000, 12),
            IFRS15Input(
                contract_id="TEST-SHAPE-1",
                customer_name="Cust",
                effective_date=datetime(2026, 1, 1),
                contract_term_months=12,
                fixed_consideration=Decimal("1800000"),
                currency="AED",
                performance_obligations=[PerformanceObligation("PO-1", "Service", Decimal("1800000"), "over_time", 12)],
            ),
            {
                "transaction_price": 1_800_000.0,
                "total_recognised": 0.0,
                "total_deferred": 1_800_000.0,
                "performance_obligations": [
                    {"obligation_id": "PO-1", "obligation": "Service", "allocated_amount": 1_800_000, "revenue_recognized": 0}
                ],
            },
            True,
            0.0,
            True,
        ),
        (
            "TEST-SHAPE-2",
            [_pit("PO-1", "A", 500_000, "2026-03-15"), _pit("PO-2", "B", 700_000, "2026-06-15"), _pit("PO-3", "C", 300_000, "2026-09-15")],
            IFRS15Input(
                contract_id="TEST-SHAPE-2",
                customer_name="Cust",
                effective_date=datetime(2026, 1, 1),
                contract_term_months=9,
                fixed_consideration=Decimal("1500000"),
                currency="AED",
                performance_obligations=[
                    PerformanceObligation("PO-1", "A", Decimal("500000"), "point_in_time", 1),
                    PerformanceObligation("PO-2", "B", Decimal("700000"), "point_in_time", 1),
                    PerformanceObligation("PO-3", "C", Decimal("300000"), "point_in_time", 1),
                ],
            ),
            {
                "transaction_price": 1_500_000.0,
                "total_recognised": 0.0,
                "total_deferred": 1_500_000.0,
                "performance_obligations": [
                    {"obligation_id": "PO-1", "obligation": "A", "allocated_amount": 500_000, "revenue_recognized": 0},
                    {"obligation_id": "PO-2", "obligation": "B", "allocated_amount": 700_000, "revenue_recognized": 0},
                    {"obligation_id": "PO-3", "obligation": "C", "allocated_amount": 300_000, "revenue_recognized": 0},
                ],
            },
            False,
            1.0,
            False,
        ),
        (
            "TEST-SHAPE-3",
            _monthly_schedule("PO-1", "PO1", 2_564_000 / 18, 18)
            + _monthly_schedule("PO-2", "PO2", 800_000 / 9, 9, start_m=7),
            IFRS15Input(
                contract_id="TEST-SHAPE-3",
                customer_name="Cust",
                effective_date=datetime(2026, 1, 1),
                contract_term_months=27,
                fixed_consideration=Decimal("3364000"),
                currency="AED",
                performance_obligations=[
                    PerformanceObligation("PO-1", "PO1", Decimal("2564000"), "over_time", 18),
                    PerformanceObligation("PO-2", "PO2", Decimal("800000"), "over_time", 9),
                ],
            ),
            {
                "transaction_price": 3_364_000.0,
                "total_recognised": 1_086_000.0,
                "total_deferred": 2_278_000.0,
                "performance_obligations": [
                    {"obligation_id": "PO-1", "obligation": "PO1", "allocated_amount": 2_564_000, "revenue_recognized": 997_111},
                    {"obligation_id": "PO-2", "obligation": "PO2", "allocated_amount": 800_000, "revenue_recognized": 88_889},
                ],
            },
            True,
            0.0,
            True,
        ),
        (
            "TEST-SHAPE-4",
            [_pit("PO-1", "Equipment", 1_000_000, "2026-01-15")],
            IFRS15Input(
                contract_id="TEST-SHAPE-4",
                customer_name="Cust",
                effective_date=datetime(2026, 1, 1),
                contract_term_months=18,
                fixed_consideration=Decimal("1000000"),
                currency="AED",
                performance_obligations=[PerformanceObligation("PO-1", "Equipment", Decimal("1000000"), "point_in_time", 1)],
            ),
            {
                "transaction_price": 1_000_000.0,
                "total_recognised": 0.0,
                "total_deferred": 1_000_000.0,
                "performance_obligations": [
                    {"obligation_id": "PO-1", "obligation": "Equipment", "allocated_amount": 1_000_000, "revenue_recognized": 0}
                ],
            },
            False,
            1.0,
            False,
        ),
    ],
)
def test_gating_shapes_financing_pa_rpo_cc(
    calc, shape_id, schedule, contract, results, exp_fc_blocked, exp_fc_min_rev, exp_periodic
):
    tp = float(results["transaction_price"])
    results = {**results, "revenue_schedule": schedule, "contract_balances": {
        "revenue_recognized_to_date": results["total_recognised"],
        "contract_liability_amount": results["total_deferred"],
    }}

    assert calc._schedule_has_periodic_recognition(schedule) is exp_periodic, shape_id

    fc = calc.calculate_financing_component(
        FinancingComponentInput(
            contract_id=shape_id, description="", contract_value=tp,
            payment_date="2027-07-01", transfer_date="2026-01-01",
            payment_timing="deferred", discount_rate=5, currency="AED",
            revenue_schedule=schedule,
        )
    )
    assert bool(fc.get("blocked")) is exp_fc_blocked, f"{shape_id} financing block"
    if exp_fc_min_rev > 0:
        assert float(fc.get("revenue_amount") or 0) >= exp_fc_min_rev
    else:
        assert len(fc.get("journal_entries") or []) == 0

    pa = calc.assess_principal_agent(
        PrincipalAgentInput(
            shape_id, "", True, tp, 0, False, False, False, False, False
        )
    )
    assert pa["conclusion"] == "BLOCKED"

    rpo = build_default_rpo_result(contract, results)
    assert abs(float(rpo["total_rpo"]) - float(results["total_deferred"])) < 1000

    cc = calc.calculate_contract_costs(
        [ContractCostInput("C1", shape_id, "", "incremental_obtaining", 0, "2026-01-01", "2026-01-01", "2027-01-01", False, 0, "AED")]
    )
    assert cc.get("assessed") is False
