"""CONST-2025-DXB-014 regression tests — module sync / unified scoring fixes."""

from datetime import datetime
from decimal import Decimal

import pytest

pytestmark = pytest.mark.ifrs15_standing

from ifrs15_extractor import (
    resolve_transaction_price_from_extraction,
    resolve_variable_consideration_from_extraction,
    variable_consideration_component_sum,
)
from ifrs15_calculator import (
    ContractCostInput,
    FinancingComponentInput,
    IFRS15Calculator,
    IFRS15ContractCostsEngine,
    IFRS15Input,
    IFRS15PrincipalAgentEngine,
    IFRS15ReversalRiskEngine,
    IFRS15UnifiedVCConstraintEngine,
    IFRS15VariableConsiderationEngine,
    LicenseIPInput,
    PerformanceObligation,
    PrincipalAgentInput,
)


def _dxb_vc_body(estimated_vc: float = 256_000.0) -> dict:
    return {
        "estimated_vc": estimated_vc,
        "constraint_factors": {
            "susceptible_to_external": False,
            "long_resolution_period": False,
            "wide_range_of_outcomes": True,
            "limited_experience": False,
            "broad_price_concession_practice": False,
        },
        "contract_term_months": 18,
        "total_contract_value": 2_656_000.0,
        "historical_attainment_pct": None,
        "refund_type": "none",
        "recognition_type": "over_time",
        "customer_type": "large_corp",
        "currency": "AED",
    }


def test_unified_vc_scoring_consistent_across_surfaces():
    """Main calc, VC engine, and reversal-risk widget must share one score."""
    body = _dxb_vc_body()
    unified = IFRS15UnifiedVCConstraintEngine().assess(body)
    reversal = IFRS15ReversalRiskEngine().score(body)
    vc_api = IFRS15VariableConsiderationEngine().estimate(
        {
            "method": "expected_value",
            "scenarios": [{"outcome": "net vc", "amount": 256_000, "probability": 1.0}],
            "constraint_factors": [False, False, True, False, False],
            "contract_term_months": 18,
            "total_contract_value": 2_656_000.0,
            "historical_attainment_pct": None,
            "customer_type": "large_corp",
            "currency": "AED",
        }
    )
    calc = IFRS15Calculator()
    constraint = calc.apply_vc_constraint(
        256_000.0,
        body["constraint_factors"],
        currency="AED",
        contract_term_months=18,
        total_contract_value=2_656_000.0,
        historical_attainment_pct=None,
        customer_type="large_corp",
        recognition_type="over_time",
        refund_type="none",
    )

    assert unified["risk_score"] == reversal["risk_score"]
    assert unified["risk_level"] == reversal["risk_level"]
    assert vc_api["unified_vc_assessment"]["risk_score"] == unified["risk_score"]
    assert constraint["risk_score"] == unified["risk_score"]
    assert constraint["unified_vc_assessment"]["risk_score"] == unified["risk_score"]
    assert unified["risk_score"] > 0


def test_principal_agent_not_applicable_without_third_party():
    calc = IFRS15Calculator()
    result = calc.assess_principal_agent(
        PrincipalAgentInput(
            arrangement_id="ARR-1",
            description="Construction management services",
            third_party_involved=False,
            gross_contract_value=2_564_000.0,
            third_party_cost=0.0,
            controls_before_transfer=False,
            primary_obligor=False,
            inventory_risk=False,
            pricing_discretion=False,
            credit_risk=False,
        )
    )
    assert result["conclusion"] == "NOT_APPLICABLE"
    assert result["assessment_status"] == "not_applicable"

    legacy = IFRS15PrincipalAgentEngine().assess(
        {
            "transaction_price": 2_564_000.0,
            "cost_paid_to_supplier": 0.0,
            "obtains_before_transfer": False,
            "sets_price_independently": False,
            "primarily_responsible": False,
            "third_party_involved": False,
        }
    )
    assert legacy["conclusion"] == "NOT_APPLICABLE"


def test_principal_agent_blocked_when_agent_without_third_party_cost():
    calc = IFRS15Calculator()
    result = calc.assess_principal_agent(
        PrincipalAgentInput(
            arrangement_id="ARR-2",
            description="Subcontracted works",
            third_party_involved=True,
            gross_contract_value=2_564_000.0,
            third_party_cost=0.0,
            controls_before_transfer=False,
            primary_obligor=False,
            inventory_risk=False,
            pricing_discretion=False,
            credit_risk=True,
        )
    )
    assert result["conclusion"] == "BLOCKED"
    assert result["assessment_status"] == "blocked_missing_third_party_cost"

    legacy = IFRS15PrincipalAgentEngine().assess(
        {
            "transaction_price": 2_564_000.0,
            "cost_paid_to_supplier": 0.0,
            "obtains_before_transfer": False,
            "sets_price_independently": False,
            "primarily_responsible": False,
            "third_party_involved": True,
        }
    )
    assert legacy["conclusion"] == "BLOCKED"


def test_extraction_component_sum_differs_from_ev_narrative():
    """Document raw ingredients (215k) vs probability-weighted EV narrative (256k)."""
    import json
    from pathlib import Path

    cache = Path(__file__).parent / (
        "output/ifrs15_extraction_cache/"
        "8ed10bd754e6aa1d5966e1481964867acd3491f6eb33bf6ee170dc220add1fa6.json"
    )
    if not cache.exists():
        pytest.skip("extraction cache not present")
    ext = json.loads(cache.read_text(encoding="utf-8"))
    var_cons = ext["step3_transaction_price"]["variable_consideration"]
    component_sum = variable_consideration_component_sum(var_cons)
    net_narrative = float(
        ext["validation"]["variable_consideration_summary"]["net_variable_consideration_included"]
    )
    assert component_sum == pytest.approx(215_000.0, abs=1.0)
    assert net_narrative == pytest.approx(256_000.0, abs=1.0)
    assert component_sum != net_narrative


def test_ev_narrative_wired_as_canonical_variable_consideration():
    """When both component sum and EV narrative exist, engine input uses EV (256k)."""
    import json
    from pathlib import Path

    cache = Path(__file__).parent / (
        "output/ifrs15_extraction_cache/"
        "8ed10bd754e6aa1d5966e1481964867acd3491f6eb33bf6ee170dc220add1fa6.json"
    )
    if not cache.exists():
        pytest.skip("extraction cache not present")
    ext = json.loads(cache.read_text(encoding="utf-8"))
    canonical_vc = resolve_variable_consideration_from_extraction(ext)
    reconciled_tp = resolve_transaction_price_from_extraction(ext)
    assert canonical_vc == pytest.approx(256_000.0, abs=1.0)
    assert reconciled_tp == pytest.approx(2_656_000.0, abs=1.0)



def test_mixed_contract_license_assessed_per_obligation_not_blanket():
    calc = IFRS15Calculator()
    construction = calc.assess_license_ip(
        LicenseIPInput(
            license_id="PO-1",
            product_name="Construction management services",
            license_description="18-month construction management mandate",
            license_fee=2_400_000,
            license_start="2026-01-01",
            license_end="2027-07-01",
            is_perpetual=False,
            entity_activities_affect_ip=False,
            customer_exposed_to_effect=False,
            no_separate_functional_utility=False,
            currency="AED",
        )
    )
    saas = calc.assess_license_ip(
        LicenseIPInput(
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
    )
    assert construction["license_type"] == "NOT_APPLICABLE"
    assert saas["license_type"] == "RIGHT_TO_USE"
    assert saas["license_fee"] == pytest.approx(120_000.0, abs=1.0)


def test_financing_block_produces_no_journals_or_schedules():
    calc = IFRS15Calculator()
    schedule = [
        {"Date": "2026-01-01", "Scheduled_Revenue": 142_444.0},
        {"Date": "2026-02-01", "Scheduled_Revenue": 142_444.0},
        {"Date": "2026-03-01", "Scheduled_Revenue": 142_444.0},
    ]
    result = calc.calculate_financing_component(
        FinancingComponentInput(
            contract_id="CONST-2025-DXB-014",
            description="Construction management",
            contract_value=2_564_000.0,
            payment_date="2027-07-01",
            transfer_date="2026-01-01",
            payment_timing="deferred",
            discount_rate=5.0,
            currency="AED",
            revenue_schedule=schedule,
        )
    )
    assert result["blocked"] is True
    assert result["assessment_status"] == "blocked_schedule_conflict"
    assert result["revenue_amount"] == 0.0
    assert result["journal_entries"] == []
    assert result["amortisation_schedule"] == []


def test_const_dxb014_calculate_uses_ev_narrative_then_constraints():
    """Live engine path: 256k EV narrative → MEDIUM constraint → 217,600 in TP."""
    import json
    from pathlib import Path

    cache = Path(__file__).parent / (
        "output/ifrs15_extraction_cache/"
        "8ed10bd754e6aa1d5966e1481964867acd3491f6eb33bf6ee170dc220add1fa6.json"
    )
    if not cache.exists():
        pytest.skip("extraction cache not present")
    ext = json.loads(cache.read_text(encoding="utf-8"))
    step1 = ext["step1_identify_contract"]["contract_details"]
    step3 = ext["step3_transaction_price"]
    ob = ext["step2_performance_obligations"]["identified_obligations"][0]
    rec = ext["step5_recognition"]["obligations_recognition_timing"][0]
    canonical_vc = resolve_variable_consideration_from_extraction(ext)
    assert canonical_vc == pytest.approx(256_000.0, abs=1.0)
    assert resolve_transaction_price_from_extraction(ext) == pytest.approx(2_656_000.0, abs=1.0)

    contract = IFRS15Input(
        contract_id=step1["contract_id"],
        customer_name=step1["customer_name"],
        effective_date=datetime.strptime(step1["effective_date"], "%Y-%m-%d"),
        contract_term_months=int(step1["contract_term_months"]),
        fixed_consideration=Decimal(str(step3["fixed_consideration"])),
        variable_consideration=Decimal(str(canonical_vc)),
        currency=step1["currency"],
        performance_obligations=[
            PerformanceObligation(
                obligation_id=ob["obligation_id"],
                description=ob["description"],
                standalone_selling_price=Decimal(str(ob["standalone_selling_price_estimate"])),
                recognition_method="over_time",
                duration_months=int(rec["duration_months"]),
            )
        ],
    )
    results = IFRS15Calculator().calculate_full_ifrs15(contract)
    vca = results["variable_consideration_analysis"]
    cr = results["vc_constraint_result"]
    assert vca["raw_variable_consideration"] == pytest.approx(256_000.0, abs=1.0)
    assert cr["constrained_amount"] == pytest.approx(217_600.0, abs=1.0)
    assert float(results["transaction_price"]) == pytest.approx(2_617_600.0, abs=1.0)
    assert cr["estimated_vc_before_constraint"] == pytest.approx(256_000.0, abs=1.0)


def test_extraction_without_ev_narrative_falls_back_to_component_sum():
    extracted = {
        "step1_identify_contract": {"contract_details": {"total_contract_value": 1_000_000}},
        "step3_transaction_price": {
            "fixed_consideration": 1_000_000,
            "variable_consideration": {
                "performance_bonuses": 50_000,
                "rebates": 10_000,
                "penalties": 0,
                "discounts": 0,
                "volume_discounts": 0,
            },
        },
    }
    assert resolve_variable_consideration_from_extraction(extracted) == pytest.approx(40_000.0, abs=1.0)
    assert resolve_transaction_price_from_extraction(extracted) == pytest.approx(1_040_000.0, abs=1.0)



def test_contract_costs_not_assessed_when_zero_commission():
    single = IFRS15ContractCostsEngine().calculate(
        {
            "commission_amount": 0,
            "contract_term_months": 18,
            "contract_total_value": 2_564_000.0,
        }
    )
    assert single["assessed"] is False

    batch = IFRS15Calculator().calculate_contract_costs(
        [
            ContractCostInput(
                cost_id="CC-0",
                contract_id="CONST-2025-DXB-014",
                description="Sales commission",
                cost_type="commission",
                cost_amount=0.0,
                incurred_date="2026-01-01",
                contract_start="2026-01-01",
                contract_end="2027-07-01",
                expected_renewal=False,
                expected_renewal_months=0,
                currency="AED",
            )
        ]
    )
    assert batch["costs"][0]["treatment"] == "NOT_ASSESSED"
    assert batch["costs"][0]["assessed"] is False


def test_license_ip_not_applicable_for_construction_contract():
    calc = IFRS15Calculator()
    result = calc.assess_license_ip(
        LicenseIPInput(
            license_id="LIC-1",
            product_name="Construction management services",
            license_description="18-month construction management mandate",
            license_fee=2_564_000.0,
            license_start="2026-01-01",
            license_end="2027-07-01",
            is_perpetual=False,
            entity_activities_affect_ip=False,
            customer_exposed_to_effect=False,
            no_separate_functional_utility=False,
            currency="AED",
        )
    )
    assert result["license_type"] == "NOT_APPLICABLE"
    assert result["assessment_status"] == "not_applicable"
    assert result["revenue_amount"] == 0.0
    assert result["recognition_schedule"] == []
