#!/usr/bin/env python3
"""Live License of IP — perpetual SaaS vs hosted subscription (CONST-2025-DXB-014 context)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ifrs15_calculator import IFRS15Calculator, LicenseIPInput  # noqa: E402

CACHE = ROOT / (
    "output/ifrs15_extraction_cache/"
    "8ed10bd754e6aa1d5966e1481964867acd3491f6eb33bf6ee170dc220add1fa6.json"
)


def _print_case(title: str, result: dict) -> None:
    print(f"\n{'=' * 72}")
    print(title)
    print("=" * 72)
    print(f"license_type:     {result.get('license_type')}")
    print(f"recognition:      {result.get('recognition')}")
    print(f"license_fee:      AED {float(result.get('license_fee') or 0):,.2f}")
    print(f"revenue_amount:   {result.get('revenue_amount')}")
    sched = result.get("recognition_schedule") or []
    print(f"schedule_periods: {len(sched)}")
    if sched:
        print(f"  first period:   {sched[0]}")
        if len(sched) > 1:
            print(f"  last period:    {sched[-1]}")
    print(f"\nexplanation:\n  {result.get('explanation', '')[:500]}")
    print("\njournal_entries:")
    for je in result.get("journal_entries") or []:
        amt = je.get("amount")
        print(
            f"  {je.get('date', '?'):<12} Dr {je.get('debit_account')} / "
            f"Cr {je.get('credit_account')}  AED {float(amt or 0):,.2f}  — {je.get('description')}"
        )


def main() -> int:
    calc = IFRS15Calculator()

    if CACHE.exists():
        ext = json.loads(CACHE.read_text(encoding="utf-8"))
        cid = ext["step1_identify_contract"]["contract_details"].get("contract_id", "CONST-2025-DXB-014")
        print(f"Extraction context: {cid} (single-PO cache — SaaS PO from mixed-contract test fixture)")
    else:
        cid = "CONST-2025-DXB-014"
        print("No extraction cache — using CONST-2025-DXB-014 test fixture language")

    # Case 1 — Perpetual SaaS (from test_mixed_contract / prior DXB-014 mixed-contract narrative)
    case1 = LicenseIPInput(
        license_id="PO-2",
        product_name="SaaS platform licence",
        license_description="Perpetual software licence for project management platform",
        license_fee=120_000,
        license_start="2026-01-01",
        license_end="2027-07-01",
        is_perpetual=True,
        entity_activities_affect_ip=False,
        customer_exposed_to_effect=False,
        no_separate_functional_utility=False,
        currency="AED",
    )

    # Case 2 — Hosted subscription (same value; ongoing updates/hosting — all B58 criteria met)
    case2 = LicenseIPInput(
        license_id="PO-2-HOSTED",
        product_name="Hosted SaaS platform subscription",
        license_description=(
            "Cloud-hosted project management SaaS with continuous software updates, "
            "security patches, uptime monitoring, and vendor-managed hosting included in the subscription fee"
        ),
        license_fee=120_000,
        license_start="2026-01-01",
        license_end="2027-07-01",
        is_perpetual=False,
        entity_activities_affect_ip=True,
        customer_exposed_to_effect=True,
        no_separate_functional_utility=True,
        currency="AED",
    )

    r1 = calc.assess_license_ip(case1)
    r2 = calc.assess_license_ip(case2)

    _print_case(
        "CASE 1 — Perpetual SaaS (AED 120,000, no ongoing vendor obligation to update/maintain)",
        r1,
    )
    _print_case(
        "CASE 2 — Hosted SaaS subscription (AED 120,000, updates/hosting included)",
        r2,
    )

    ok = (
        r1.get("license_type") == "RIGHT_TO_USE"
        and r1.get("recognition") == "POINT_IN_TIME"
        and r2.get("license_type") == "RIGHT_TO_ACCESS"
        and r2.get("recognition") == "OVER_TIME"
    )
    print(f"\n{'=' * 72}")
    print(f"DISTINGUISHES BOTH CASES: {'YES' if ok else 'NO — review classification logic'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
