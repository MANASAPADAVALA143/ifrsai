#!/usr/bin/env python3
"""
Live verification — CONST-2025-DXB-014 2-obligation post-modification contract.

Simulates: extraction cache → calculate_full_ifrs15 → six compliance module endpoints.
Run: python scripts/verify_const_dxb014_multi_pob_live.py
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ifrs15_calculator import (  # noqa: E402
    BillAndHoldInput,
    ContractCostInput,
    FinancingComponentInput,
    IFRS15Calculator,
    IFRS15Input,
    PerformanceObligation,
    PrincipalAgentInput,
)
from ifrs15_extractor import (  # noqa: E402
    build_modification_assessment_from_extraction,
    resolve_variable_consideration_from_extraction,
)

CACHE = (
    ROOT
    / "output/ifrs15_extraction_cache/9988368736a8d18313b9c6a1d0d28962c0cc40881fabb04a769d013bf19c236f.json"
)


def fmt_aed(v: float) -> str:
    return f"AED {v:,.2f}"


def load_contract() -> tuple[IFRS15Input, dict]:
    if not CACHE.exists():
        raise SystemExit(f"Missing extraction cache: {CACHE}")
    ext = json.loads(CACHE.read_text(encoding="utf-8"))
    step1 = ext["step1_identify_contract"]["contract_details"]
    step3 = ext["step3_transaction_price"]
    obs = ext["step2_performance_obligations"]["identified_obligations"]
    rec_map = {
        r["obligation_id"]: r for r in ext["step5_recognition"]["obligations_recognition_timing"]
    }
    pos = [
        PerformanceObligation(
            ob["obligation_id"],
            ob["description"],
            Decimal(str(ob["standalone_selling_price_estimate"])),
            "over_time",
            int(rec_map[ob["obligation_id"]]["duration_months"]),
        )
        for ob in obs
    ]
    vc = resolve_variable_consideration_from_extraction(ext)
    contract = IFRS15Input(
        contract_id=step1["contract_id"],
        customer_name="Meraas Development LLC",
        effective_date=datetime(2026, 1, 1),
        contract_term_months=27,
        fixed_consideration=Decimal(str(step3["fixed_consideration"])),
        variable_consideration=Decimal(str(vc or 0)),
        currency="AED",
        performance_obligations=pos,
    )
    return contract, ext


def main() -> int:
    contract, ext = load_contract()
    calc = IFRS15Calculator()
    results = calc.calculate_full_ifrs15(contract)

    tp = float(results["transaction_price"])
    rec = float(results.get("total_recognised") or 0)
    deferred = float(results.get("total_deferred") or 0)
    sched = results.get("revenue_schedule") or []
    pob_count = len(results.get("performance_obligations") or [])

    print("=" * 72)
    print("CONST-2025-DXB-014 — LIVE MODULE VERIFICATION (2-obligation contract)")
    print("=" * 72)
    print(f"Contract ID     : {contract.contract_id}")
    print(f"POBs in schedule: {pob_count}")
    print(f"Schedule rows   : {len(sched)}")
    print(f"Transaction price: {fmt_aed(tp)}")
    print(f"Recognised YTD  : {fmt_aed(rec)}")
    print(f"Deferred balance: {fmt_aed(deferred)}")
    print()

    rows: list[tuple[str, str, str, str]] = []

    # 1 — Modification
    mod = build_modification_assessment_from_extraction(ext, results)
    mod_type = str(mod.get("modification_type") if mod else "")
    mod_name = str(mod.get("modification_type_name") if mod else "")
    mod_auto = bool(mod.get("auto_computed")) if mod else False
    mod_banner = "synced from main calculation" if mod_auto else "(no auto banner)"
    mod_ok = mod_type == "TYPE_1" and "New Separate" in mod_name and mod_auto
    rows.append(
        (
            "1. Modification",
            "TYPE_1 + auto banner",
            f"{mod_type} / {mod_name} / auto={mod_auto} / {mod_banner}",
            "PASS" if mod_ok else "FAIL",
        )
    )

    # 2 — RPO (compliance + RPO 120)
    rpo = results.get("rpo_result") or {}
    rpo_total = float(rpo.get("total_rpo") or 0)
    rpo120 = rpo.get("rpo_120") or rpo
    rpo120_total = float(rpo120.get("total_rpo") or rpo_total)
    rpo_ok = abs(rpo_total - deferred) < 1000 and rpo_total > 2_000_000
    rows.append(
        (
            "2. RPO (compliance)",
            f"~{fmt_aed(deferred)}",
            f"{fmt_aed(rpo_total)} (source={rpo.get('source')})",
            "PASS" if rpo_ok else "FAIL",
        )
    )
    rows.append(
        (
            "2b. RPO (IFRS 120)",
            f"~{fmt_aed(deferred)}",
            f"{fmt_aed(rpo120_total)}",
            "PASS" if abs(rpo120_total - deferred) < 1000 else "FAIL",
        )
    )

    # 3 — Principal/Agent (extended: agent + zero cost)
    pa = calc.assess_principal_agent(
        PrincipalAgentInput(
            arrangement_id=contract.contract_id,
            description="Construction management",
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
    pa_ok = pa["conclusion"] == "BLOCKED" and len(pa.get("journal_entries") or []) == 0
    rows.append(
        (
            "3. Principal/Agent",
            "BLOCKED, 0 journals",
            f"{pa['conclusion']} / revenue_amount={fmt_aed(float(pa.get('revenue_amount') or 0))} / "
            f"journals={len(pa.get('journal_entries') or [])}",
            "PASS" if pa_ok else "FAIL",
        )
    )

    # 4 — Financing
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
    fc_ok = fc.get("blocked") is True and len(fc.get("journal_entries") or []) == 0
    rows.append(
        (
            "4. Financing",
            "blocked, 0 journals",
            f"blocked={fc.get('blocked')} / revenue_amount={fmt_aed(float(fc.get('revenue_amount') or 0))} / "
            f"journals={len(fc.get('journal_entries') or [])}",
            "PASS" if fc_ok else "FAIL",
        )
    )

    # 5 — Contract costs (zero commission batch)
    cc = calc.calculate_contract_costs(
        [
            ContractCostInput(
                cost_id="COST-001",
                contract_id=contract.contract_id,
                description="",
                cost_type="incremental_obtaining",
                cost_amount=0,
                incurred_date="2026-01-01",
                contract_start="2026-01-01",
                contract_end="2028-04-01",
                expected_renewal=False,
                expected_renewal_months=0,
                currency="AED",
            )
        ]
    )
    cc_ok = cc.get("assessed") is False and cc["costs"][0].get("treatment") == "NOT_ASSESSED"
    rows.append(
        (
            "5. Contract costs",
            "not assessed",
            f"assessed={cc.get('assessed')} / treatment={cc['costs'][0].get('treatment')}",
            "PASS" if cc_ok else "FAIL",
        )
    )

    # 6 — Bill-and-hold (services)
    bah = calc.assess_bill_and_hold(
        BillAndHoldInput(
            arrangement_id="BAH-001",
            contract_id=contract.contract_id,
            customer_name="Developer",
            product_description="Construction site supervision services",
            contract_value=tp,
            billing_date="2026-01-01",
            expected_delivery_date="2027-07-01",
            reason_is_substantive=False,
            product_separately_identified=False,
            product_ready_for_transfer=False,
            entity_cannot_redirect=False,
            currency="AED",
        )
    )
    bah_ok = bah["conclusion"] == "NOT_APPLICABLE" and len(bah.get("journal_entries") or []) == 0
    rows.append(
        (
            "6. Bill-and-hold",
            "NOT_APPLICABLE",
            f"{bah['conclusion']} / journals={len(bah.get('journal_entries') or [])}",
            "PASS" if bah_ok else "FAIL",
        )
    )

    print(f"{'Module':<22} {'Expected':<28} {'Actual':<50} {'Status'}")
    print("-" * 110)
    for mod_name_row, exp, act, status in rows:
        print(f"{mod_name_row:<22} {exp:<28} {act:<50} {status}")

    print("-" * 110)
    fails = sum(1 for *_, s in rows if s == "FAIL")
    if fails:
        print(f"RESULT: {fails} module(s) FAILED — do not close this round.")
        return 1
    print("RESULT: All 6 modules PASS on live calculate path.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
