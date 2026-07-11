#!/usr/bin/env python3
"""Verify CONST-2025-DXB-014 contract costs — AED 76,920 commission (3% of AED 2,564,000)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ifrs15_calculator import (  # noqa: E402
    ContractCostInput,
    IFRS15Calculator,
    IFRS15ContractCostsEngine,
)

COMMISSION = 76_920.0
CONTRACT_VALUE = 2_564_000.0
TERM_MONTHS = 18
CONTRACT_ID = "CONST-2025-DXB-014"


def run_batch_engine() -> dict:
    calc = IFRS15Calculator()
    return calc.calculate_contract_costs(
        [
            ContractCostInput(
                cost_id="COMM-DXB014",
                contract_id=CONTRACT_ID,
                description="Sales commission (3% of original contract value)",
                cost_type="incremental_obtaining",
                cost_amount=COMMISSION,
                incurred_date="2026-01-15",
                contract_start="2026-01-01",
                contract_end="2027-07-01",
                expected_renewal=False,
                expected_renewal_months=0,
                currency="AED",
            )
        ]
    )


def run_legacy_engine() -> dict:
    return IFRS15ContractCostsEngine().calculate(
        {
            "commission_amount": COMMISSION,
            "contract_term_months": TERM_MONTHS,
            "contract_total_value": CONTRACT_VALUE,
            "currency": "AED",
        }
    )


def print_section(title: str, data: dict) -> None:
    print(f"\n{'=' * 72}")
    print(title)
    print("=" * 72)
    print(json.dumps(data, indent=2, default=str))


def summarise_batch(result: dict) -> None:
    item = result["costs"][0]
    summ = result.get("summary") or {}
    sched = item.get("amortisation_schedule") or []
    print("\n--- BATCH ENGINE SUMMARY ---")
    print(f"assessed:           {item.get('assessed', 'N/A (batch uses treatment field)')}")
    print(f"treatment:          {item.get('treatment')}")
    print(f"cost_amount:        AED {item.get('cost_amount'):,.2f}")
    print(f"amortisation_months:{item.get('amortisation_period_months')}")
    print(f"monthly_amort:      AED {item.get('monthly_amortisation'):,.2f}")
    print(f"asset_balance:      AED {item.get('asset_balance'):,.2f}")
    print(f"total_amortised:    AED {item.get('total_amortised'):,.2f}")
    print(f"impairment:         {item.get('impairment_flag', 'N/A')}")
    print(f"schedule rows:      {len(sched)}")
    if sched:
        print(f"  opening (M1):     AED {COMMISSION:,.2f} asset, amort AED {sched[0]['amortisation']:,.2f}")
        print(f"  closing (M18):    AED {sched[-1]['asset_balance']:,.2f}")
    print(f"summary capitalised:AED {summ.get('total_capitalised'):,.2f}")
    print("\nJournal entries:")
    for je in item.get("journal_entries") or []:
        print(
            f"  {je.get('date','?'):<12} Dr {je.get('debit_account')} / "
            f"Cr {je.get('credit_account')}  AED {je.get('amount'):,.2f}  — {je.get('description')}"
        )


def summarise_legacy(result: dict) -> None:
    sched = result.get("amortisation_schedule") or []
    print("\n--- LEGACY COMMISSION ENGINE SUMMARY ---")
    print(f"assessed:           {result.get('assessed')}")
    print(f"capitalise:         {result.get('capitalise')}")
    print(f"commission_amount:  AED {result.get('commission_amount'):,.2f}")
    print(f"contract_term:      {result.get('contract_term_months')} months")
    print(f"monthly_amort:      AED {result.get('monthly_amortisation'):,.2f}")
    print(f"total_asset:        AED {result.get('total_asset_recognised'):,.2f}")
    print(f"impairment_flag:    {result.get('impairment_flag')}")
    print(f"impairment_note:    {result.get('impairment_note') or '(none)'}")
    print(f"schedule rows:      {len(sched)}")
    if sched:
        print(f"  M1 closing:       AED {sched[0]['closing_balance']:,.2f}")
        print(f"  M18 closing:      AED {sched[-1]['closing_balance']:,.2f}")
    print("\nJournal entries:")
    for je in result.get("journal_entries") or []:
        print(
            f"  [{je.get('phase')}] Dr {je.get('dr_account')} / Cr {je.get('cr_account')}  "
            f"AED {je.get('dr'):,.2f}  — {je.get('description')}"
        )


def main() -> int:
    print(f"Contract: {CONTRACT_ID}")
    print(f"Commission: AED {COMMISSION:,.2f} (3% of AED {CONTRACT_VALUE:,.0f})")
    print(f"Paid: 2026-01-15 | Amortisation: {TERM_MONTHS} months")
    print(f"Expected monthly: AED {COMMISSION / TERM_MONTHS:,.2f}")

    batch = run_batch_engine()
    legacy = run_legacy_engine()

    summarise_batch(batch)
    summarise_legacy(legacy)

    # Expected checks
    item = batch["costs"][0]
    exp_monthly = round(COMMISSION / TERM_MONTHS, 2)
    ok = (
        item.get("treatment") == "CAPITALISE"
        and item.get("amortisation_period_months") == TERM_MONTHS
        and abs(float(item.get("monthly_amortisation") or 0) - exp_monthly) < 0.02
        and float(item.get("cost_amount") or 0) == COMMISSION
        and len(item.get("amortisation_schedule") or []) == TERM_MONTHS
        and float((item.get("amortisation_schedule") or [{}])[-1].get("asset_balance") or -1) == 0.0
        and legacy.get("assessed") is True
        and legacy.get("capitalise") is True
    )
    print(f"\n{'=' * 72}")
    print(f"OVERALL: {'PASS' if ok else 'FAIL — review mismatches above'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
