"""Multi-POB / post-modification regression tests (2-obligation modified contract)."""

import json
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import pytest

pytestmark = pytest.mark.ifrs15_standing

from ifrs15_calculator import (
    BillAndHoldInput,
    ContractCostInput,
    FinancingComponentInput,
    IFRS15Calculator,
    IFRS15Input,
    PerformanceObligation,
    PrincipalAgentInput,
    RPOContract,
    build_default_rpo_result,
)
from ifrs15_extractor import resolve_variable_consideration_from_extraction

CACHE = (
    Path(__file__).parent
    / "output/ifrs15_extraction_cache/9988368736a8d18313b9c6a1d0d28962c0cc40881fabb04a769d013bf19c236f.json"
)


def _load_multi_pob_contract() -> tuple[IFRS15Input, dict]:
    if not CACHE.exists():
        pytest.skip("multi-POB extraction cache not present")
    ext = json.loads(CACHE.read_text(encoding="utf-8"))
    step1 = ext["step1_identify_contract"]["contract_details"]
    step3 = ext["step3_transaction_price"]
    obs = ext["step2_performance_obligations"]["identified_obligations"]
    rec_map = {
        r["obligation_id"]: r
        for r in ext["step5_recognition"]["obligations_recognition_timing"]
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
        customer_name="Test Customer",
        effective_date=datetime(2026, 1, 1),
        contract_term_months=27,
        fixed_consideration=Decimal(str(step3["fixed_consideration"])),
        variable_consideration=Decimal(str(vc or 0)),
        currency="AED",
        performance_obligations=pos,
    )
    return contract, ext


def test_multi_pob_auto_rpo_matches_deferred_balance():
    contract, _ = _load_multi_pob_contract()
    calc = IFRS15Calculator()
    results = calc.calculate_full_ifrs15(contract)
    rpo = results["rpo_result"]
    deferred = float(results["total_deferred"])
    assert len(results["performance_obligations"]) == 2
    assert float(rpo["total_rpo"]) > 1_000_000
    assert abs(float(rpo["total_rpo"]) - deferred) < 1000
    assert rpo.get("auto_computed") is True
    assert rpo.get("source") == "schedule_derived"


def test_multi_pob_rpo120_requires_populated_obligations():
    contract, _ = _load_multi_pob_contract()
    calc = IFRS15Calculator()
    results = calc.calculate_full_ifrs15(contract)
    sched = results["revenue_schedule"]
    tp = float(results["transaction_price"])
    rec = float(results["total_recognised"])

    po_inputs = []
    for po in results["performance_obligations"]:
        oid = po["obligation_id"]
        rem = calc._remaining_lines_from_schedule_rows(
            sched, datetime(2026, 7, 5).date(), obligation_id=oid
        )
        po_inputs.append(
            {
                "name": po["obligation"],
                "obligation_id": oid,
                "allocated_amount": po["allocated_amount"],
                "recognised_to_date": po["revenue_recognized"],
                "remaining_schedule": rem,
            }
        )

    good = RPOContract(
        contract_id=contract.contract_id,
        customer_name=contract.customer_name,
        contract_start="2026-01-01",
        contract_end="2028-04-01",
        total_transaction_price=tp,
        revenue_recognised_to_date=rec,
        performance_obligations=po_inputs,
        currency="AED",
        reporting_date="2026-07-05",
        revenue_schedule=sched,
    )
    good_rpo = calc.calculate_rpo([good])
    assert float(good_rpo["total_rpo"]) > 1_000_000

    empty_po = RPOContract(
        contract_id=contract.contract_id,
        customer_name=contract.customer_name,
        contract_start="2026-01-01",
        contract_end="2028-04-01",
        total_transaction_price=tp,
        revenue_recognised_to_date=rec,
        performance_obligations=[
            {
                "name": "PO",
                "obligation_id": "",
                "allocated_amount": 0,
                "recognised_to_date": 0,
                "remaining_schedule": [],
            }
        ],
        currency="AED",
        reporting_date="2026-07-05",
        revenue_schedule=sched,
    )
    bad_rpo = calc.calculate_rpo([empty_po])
    assert float(bad_rpo["total_rpo"]) < 1.0


def test_pa_blocked_when_agent_and_zero_third_party_cost_multi_pob():
    contract, _ = _load_multi_pob_contract()
    calc = IFRS15Calculator()
    results = calc.calculate_full_ifrs15(contract)
    tp = float(results["transaction_price"])
    pa = calc.assess_principal_agent(
        PrincipalAgentInput(
            arrangement_id=contract.contract_id,
            description="test",
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
    assert pa["conclusion"] == "BLOCKED"
    assert pa["journal_entries"] == []


def test_financing_blocked_for_multi_pob_periodic_schedule():
    contract, _ = _load_multi_pob_contract()
    calc = IFRS15Calculator()
    results = calc.calculate_full_ifrs15(contract)
    sched = results["revenue_schedule"]
    assert len(sched) >= 2
    fc = calc.calculate_financing_component(
        FinancingComponentInput(
            contract_id=contract.contract_id,
            description="",
            contract_value=float(results["transaction_price"]),
            payment_date="2027-07-01",
            transfer_date="2026-01-01",
            payment_timing="deferred",
            discount_rate=5,
            currency="AED",
            revenue_schedule=sched,
        )
    )
    assert fc.get("blocked") is True
    assert fc.get("journal_entries") == []


def test_contract_costs_batch_not_assessed_when_zero():
    calc = IFRS15Calculator()
    result = calc.calculate_contract_costs(
        [
            ContractCostInput(
                cost_id="COST-001",
                contract_id="CONST-2025-DXB-014",
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
    assert result.get("assessed") is False
    assert result["costs"][0]["treatment"] == "NOT_ASSESSED"


def test_bill_and_hold_not_applicable_for_services_supervision():
    calc = IFRS15Calculator()
    bah = calc.assess_bill_and_hold(
        BillAndHoldInput(
            arrangement_id="BAH-001",
            contract_id="CONST-2025-DXB-014",
            customer_name="Developer",
            product_description="Construction site supervision services",
            contract_value=3_364_000,
            billing_date="2026-01-01",
            expected_delivery_date="2027-07-01",
            reason_is_substantive=False,
            product_separately_identified=False,
            product_ready_for_transfer=False,
            entity_cannot_redirect=False,
            currency="AED",
        )
    )
    assert bah["conclusion"] == "NOT_APPLICABLE"
    assert bah["journal_entries"] == []


def test_extraction_has_modifications_for_sync():
    _, ext = _load_multi_pob_contract()
    mods = ext.get("contract_modifications") or {}
    assert mods.get("modifications_present") is True
    assert len(mods.get("modification_details") or []) >= 1


def test_build_modification_assessment_from_extraction_python():
    from ifrs15_extractor import build_modification_assessment_from_extraction

    contract, ext = _load_multi_pob_contract()
    calc = IFRS15Calculator()
    results = calc.calculate_full_ifrs15(contract)
    mod = build_modification_assessment_from_extraction(ext, results)
    assert mod is not None
    assert mod["modification_type"] == "TYPE_1"
    assert mod.get("auto_computed") is True
    assert mod.get("applied_in_schedule") is True


def test_build_default_rpo_result_multi_pob():
    contract, _ = _load_multi_pob_contract()
    calc = IFRS15Calculator()
    results = calc.calculate_full_ifrs15(contract)
    rpo = build_default_rpo_result(contract, results)
    assert float(rpo["total_rpo"]) > 1_000_000
