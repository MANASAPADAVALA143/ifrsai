#!/usr/bin/env python3
"""
IFRS 15 — Multi-shape gating audit (TEST-SHAPE-1..4).

Run: python scripts/audit_ifrs15_gating_shapes.py
"""

from __future__ import annotations

import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ifrs15_calculator import (  # noqa: E402
    ContractCostInput,
    FinancingComponentInput,
    IFRS15Calculator,
    IFRS15Input,
    PerformanceObligation,
    PrincipalAgentInput,
    build_default_rpo_result,
)

calc = IFRS15Calculator()


def _monthly_schedule(
    obligation_id: str,
    obligation_name: str,
    monthly_amount: float,
    months: int,
    start_year: int = 2026,
    start_month: int = 1,
) -> list[dict]:
    rows = []
    y, m = start_year, start_month
    for i in range(months):
        d = f"{y:04d}-{m:02d}-01"
        rows.append(
            {
                "Period": i + 1,
                "Date": d,
                "Obligation_ID": obligation_id,
                "Obligation": obligation_name,
                "Scheduled_Revenue": monthly_amount,
                "Revenue": 0.0,
                "Status": "Pending",
            }
        )
        m += 1
        if m > 12:
            m = 1
            y += 1
    return rows


def _pit_row(obligation_id: str, name: str, amount: float, date: str) -> dict:
    return {
        "Period": 1,
        "Date": date,
        "Obligation_ID": obligation_id,
        "Obligation": name,
        "Scheduled_Revenue": amount,
        "Revenue": 0.0,
        "Status": "Pending",
    }


def build_shape_1() -> tuple[dict, IFRS15Input, dict]:
    tp = 1_800_000.0
    sched = _monthly_schedule("PO-1", "Service", 150_000, 12)
    contract = IFRS15Input(
        contract_id="TEST-SHAPE-1",
        customer_name="Shape 1 Customer",
        effective_date=datetime(2026, 1, 1),
        contract_term_months=12,
        fixed_consideration=Decimal("1800000"),
        currency="AED",
        performance_obligations=[
            PerformanceObligation("PO-1", "Service", Decimal("1800000"), "over_time", 12)
        ],
    )
    results = {
        "transaction_price": tp,
        "total_recognised": 0.0,
        "total_deferred": tp,
        "performance_obligations": [
            {
                "obligation_id": "PO-1",
                "obligation": "Service",
                "allocated_amount": tp,
                "revenue_recognized": 0.0,
                "recognition_method": "over_time",
            }
        ],
        "revenue_schedule": sched,
        "contract_balances": {"revenue_recognized_to_date": 0.0, "contract_liability_amount": tp},
    }
    return {"id": "TEST-SHAPE-1", "tp": tp}, contract, results


def build_shape_2() -> tuple[dict, IFRS15Input, dict]:
    tp = 1_500_000.0
    sched = [
        _pit_row("PO-1", "Deliverable A", 500_000, "2026-03-15"),
        _pit_row("PO-2", "Deliverable B", 700_000, "2026-06-15"),
        _pit_row("PO-3", "Deliverable C", 300_000, "2026-09-15"),
    ]
    contract = IFRS15Input(
        contract_id="TEST-SHAPE-2",
        customer_name="Shape 2 Customer",
        effective_date=datetime(2026, 1, 1),
        contract_term_months=9,
        fixed_consideration=Decimal("1500000"),
        currency="AED",
        performance_obligations=[
            PerformanceObligation("PO-1", "Deliverable A", Decimal("500000"), "point_in_time", 1),
            PerformanceObligation("PO-2", "Deliverable B", Decimal("700000"), "point_in_time", 1),
            PerformanceObligation("PO-3", "Deliverable C", Decimal("300000"), "point_in_time", 1),
        ],
    )
    results = {
        "transaction_price": tp,
        "total_recognised": 0.0,
        "total_deferred": tp,
        "performance_obligations": [
            {"obligation_id": "PO-1", "obligation": "Deliverable A", "allocated_amount": 500_000, "revenue_recognized": 0.0, "recognition_method": "point_in_time"},
            {"obligation_id": "PO-2", "obligation": "Deliverable B", "allocated_amount": 700_000, "revenue_recognized": 0.0, "recognition_method": "point_in_time"},
            {"obligation_id": "PO-3", "obligation": "Deliverable C", "allocated_amount": 300_000, "revenue_recognized": 0.0, "recognition_method": "point_in_time"},
        ],
        "revenue_schedule": sched,
        "contract_balances": {"revenue_recognized_to_date": 0.0, "contract_liability_amount": tp},
    }
    return {"id": "TEST-SHAPE-2", "tp": tp}, contract, results


def build_shape_3() -> tuple[dict, IFRS15Input, dict]:
    tp = 3_364_000.0
    sched = _monthly_schedule("PO-1", "PO1 Management", 2564000 / 18, 18) + _monthly_schedule(
        "PO-2", "PO2 Supervision", 800_000 / 9, 9, start_year=2026, start_month=7
    )
    rec = 1_086_000.0
    contract = IFRS15Input(
        contract_id="TEST-SHAPE-3",
        customer_name="Shape 3 Customer",
        effective_date=datetime(2026, 1, 1),
        contract_term_months=27,
        fixed_consideration=Decimal("3364000"),
        currency="AED",
        performance_obligations=[
            PerformanceObligation("PO-1", "PO1 Management", Decimal("2564000"), "over_time", 18),
            PerformanceObligation("PO-2", "PO2 Supervision", Decimal("800000"), "over_time", 9),
        ],
    )
    results = {
        "transaction_price": tp,
        "total_recognised": rec,
        "total_deferred": tp - rec,
        "performance_obligations": [
            {"obligation_id": "PO-1", "obligation": "PO1 Management", "allocated_amount": 2_564_000, "revenue_recognized": 997_111.08, "recognition_method": "over_time"},
            {"obligation_id": "PO-2", "obligation": "PO2 Supervision", "allocated_amount": 800_000, "revenue_recognized": 88_888.89, "recognition_method": "over_time"},
        ],
        "revenue_schedule": sched,
        "contract_balances": {"revenue_recognized_to_date": rec, "contract_liability_amount": tp - rec},
    }
    return {"id": "TEST-SHAPE-3", "tp": tp}, contract, results


def build_shape_4() -> tuple[dict, IFRS15Input, dict]:
    tp = 1_000_000.0
    sched = [_pit_row("PO-1", "Equipment delivery", tp, "2026-01-15")]
    contract = IFRS15Input(
        contract_id="TEST-SHAPE-4",
        customer_name="Shape 4 Customer",
        effective_date=datetime(2026, 1, 1),
        contract_term_months=18,
        fixed_consideration=Decimal("1000000"),
        currency="AED",
        performance_obligations=[
            PerformanceObligation("PO-1", "Equipment delivery", Decimal("1000000"), "point_in_time", 1)
        ],
    )
    results = {
        "transaction_price": tp,
        "total_recognised": 0.0,
        "total_deferred": tp,
        "performance_obligations": [
            {"obligation_id": "PO-1", "obligation": "Equipment delivery", "allocated_amount": tp, "revenue_recognized": 0.0, "recognition_method": "point_in_time"},
        ],
        "revenue_schedule": sched,
        "contract_balances": {"revenue_recognized_to_date": 0.0, "contract_liability_amount": tp},
    }
    return {"id": "TEST-SHAPE-4", "tp": tp}, contract, results


def audit_shape(meta: dict, contract: IFRS15Input, results: dict) -> dict:
    tp = float(meta["tp"])
    sched = results["revenue_schedule"]
    rec = float(results.get("total_recognised") or 0)
    deferred = float(results.get("total_deferred") or tp - rec)

    fc = calc.calculate_financing_component(
        FinancingComponentInput(
            contract_id=contract.contract_id,
            description="",
            contract_value=tp,
            payment_date="2027-07-01",
            transfer_date="2026-01-01",
            payment_timing="deferred",
            discount_rate=5,
            currency="AED",
            revenue_schedule=sched,
        )
    )
    pa = calc.assess_principal_agent(
        PrincipalAgentInput(
            arrangement_id=contract.contract_id,
            description="",
            third_party_involved=True,
            gross_contract_value=tp,
            third_party_cost=0,
            controls_before_transfer=False,
            primary_obligor=False,
            inventory_risk=False,
            pricing_discretion=False,
            credit_risk=False,
        )
    )
    rpo = build_default_rpo_result(contract, results)
    rpo_total = float(rpo.get("total_rpo") or 0)
    cc = calc.calculate_contract_costs(
        [
            ContractCostInput(
                cost_id="C1",
                contract_id=contract.contract_id,
                description="",
                cost_type="incremental_obtaining",
                cost_amount=0,
                incurred_date="2026-01-01",
                contract_start="2026-01-01",
                contract_end="2027-01-01",
                expected_renewal=False,
                expected_renewal_months=0,
                currency="AED",
            )
        ]
    )
    periodic = calc._schedule_has_periodic_recognition(sched)

    return {
        "shape": meta["id"],
        "periodic_flag": periodic,
        "fc_blocked": bool(fc.get("blocked")),
        "fc_revenue": float(fc.get("revenue_amount") or 0),
        "fc_journals": len(fc.get("journal_entries") or []),
        "pa": pa["conclusion"],
        "rpo": rpo_total,
        "deferred": deferred,
        "rpo_delta": abs(rpo_total - deferred),
        "cc_assessed": cc.get("assessed"),
    }


EXPECTED = {
    "TEST-SHAPE-1": {"fc_blocked": True, "pa": "BLOCKED", "cc_assessed": False, "rpo_tol": 1.0},
    "TEST-SHAPE-2": {"fc_blocked": False, "pa": "BLOCKED", "cc_assessed": False, "rpo_tol": 1.0},
    "TEST-SHAPE-3": {"fc_blocked": True, "pa": "BLOCKED", "cc_assessed": False, "rpo_tol": 1000.0},
    "TEST-SHAPE-4": {"fc_blocked": False, "pa": "BLOCKED", "cc_assessed": False, "rpo_tol": 1.0, "fc_revenue_min": 1.0},
}


def main() -> int:
    shapes = [build_shape_1(), build_shape_2(), build_shape_3(), build_shape_4()]
    rows = [audit_shape(*s) for s in shapes]

    print("=" * 100)
    print("IFRS 15 GATING SHAPE AUDIT")
    print("=" * 100)
    hdr = f"{'Shape':<16} {'Periodic?':<10} {'FC block':<9} {'FC rev':<14} {'PA':<10} {'RPO':<14} {'Deferred':<14} {'RPO diff':<10} {'CC assessed':<12} {'OK?'}"
    print(hdr)
    print("-" * 100)

    fails = 0
    for r in rows:
        exp = EXPECTED[r["shape"]]
        ok = (
            r["fc_blocked"] == exp["fc_blocked"]
            and r["pa"] == exp["pa"]
            and r["cc_assessed"] == exp["cc_assessed"]
            and r["rpo_delta"] <= exp["rpo_tol"]
        )
        if exp.get("fc_revenue_min") and r["fc_revenue"] < exp["fc_revenue_min"]:
            ok = False
        status = "PASS" if ok else "FAIL"
        if not ok:
            fails += 1
        print(
            f"{r['shape']:<16} {str(r['periodic_flag']):<10} {str(r['fc_blocked']):<9} "
            f"{r['fc_revenue']:>12,.2f} {r['pa']:<10} {r['rpo']:>12,.2f} {r['deferred']:>12,.2f} "
            f"{r['rpo_delta']:>8,.2f} {str(r['cc_assessed']):<12} {status}"
        )

    print("-" * 100)
    if fails:
        print(f"RESULT: {fails} shape(s) FAILED — rule fix required.")
        return 1
    print("RESULT: All 4 shapes PASS gating rules.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
