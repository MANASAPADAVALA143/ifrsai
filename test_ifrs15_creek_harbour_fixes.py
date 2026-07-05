"""Creek Harbour / RERA-CH-2025-002 regression tests for IFRS 15 master summary fixes."""

from datetime import datetime
from decimal import Decimal

import pytest

pytestmark = pytest.mark.ifrs15_standing

from ifrs15_calculator import (
    IFRS15Calculator,
    IFRS15Input,
    IFRS15MasterSummaryEngine,
    PerformanceObligation,
    RPOContract,
    build_default_rpo_result,
    contract_rpo_within_twelve_months,
    normalize_implicit_performance_obligations,
    recognition_pattern_label_from_results,
)


def test_practical_expedient_rejected_when_contract_term_exceeds_twelve_months():
    """27-month contract with all RPO in year-1 bucket must not be expedient-excluded."""
    calc = IFRS15Calculator()
    reporting = "2025-07-01"
    contract = RPOContract(
        contract_id="RERA-CH-2025-002",
        customer_name="Creek Harbour Buyer",
        contract_start="2025-01-01",
        contract_end="2027-04-01",
        total_transaction_price=3_200_000.0,
        revenue_recognised_to_date=0.0,
        currency="AED",
        reporting_date=reporting,
        performance_obligations=[
            {
                "name": "Off-plan residential unit",
                "allocated_amount": 3_200_000.0,
                "recognised_to_date": 0.0,
                "remaining_schedule": [
                    {"expected_recognition_date": "2026-06-30", "amount": 3_200_000.0},
                ],
            },
        ],
    )

    result = calc.calculate_rpo([contract])
    assert result["total_rpo"] == pytest.approx(3_200_000.0, abs=1.0)
    assert result["expedient_contracts_excluded"] == 0
    assert len(result["contract_details"]) == 1


def test_contract_rpo_within_twelve_months_requires_short_contract_term():
    buckets = {"within_1_year": 100.0, "1_to_2_years": 0.0, "2_to_5_years": 0.0, "beyond_5_years": 0.0}
    assert contract_rpo_within_twelve_months(buckets, 100.0, contract_term_months=12) is True
    assert contract_rpo_within_twelve_months(buckets, 100.0, contract_term_months=27) is False


def test_build_default_rpo_result_from_deferred_schedule():
    contract = IFRS15Input(
        contract_id="RERA-CH-2025-002",
        customer_name="Buyer",
        effective_date=datetime(2025, 1, 1),
        contract_term_months=27,
        fixed_consideration=Decimal("3200000"),
        currency="AED",
        performance_obligations=[
            PerformanceObligation(
                obligation_id="PO-1",
                description="Off-plan residential unit",
                standalone_selling_price=Decimal("3200000"),
                recognition_method="over_time",
                duration_months=27,
            ),
        ],
    )
    results = {
        "transaction_price": 3_200_000.0,
        "total_recognised": 0.0,
        "total_deferred": 3_200_000.0,
        "contract_balances": {
            "revenue_recognized_to_date": 0.0,
            "contract_liability_amount": 3_200_000.0,
        },
        "allocations": {"PO-1": 3_200_000.0},
        "performance_obligations": [
            {
                "obligation_id": "PO-1",
                "obligation": "Off-plan residential unit",
                "allocated_amount": 3_200_000.0,
                "revenue_recognized": 0.0,
                "recognition_method": "over_time",
            },
        ],
        "revenue_schedule": [
            {
                "Date": "2027-04-01",
                "Obligation_ID": "PO-1",
                "Obligation": "Off-plan residential unit",
                "Scheduled_Revenue": 3_200_000.0,
                "Revenue": 0.0,
            },
        ],
    }

    rpo = build_default_rpo_result(contract, results, reporting_date="2025-07-01")
    assert rpo["auto_computed"] is True
    assert rpo["total_rpo"] == pytest.approx(3_200_000.0, abs=1.0)
    assert rpo["total_rpo"] > 0


def test_master_summary_defaults_rpo_from_core_when_not_manually_assessed():
    core = {
        "transaction_price": 3_200_000.0,
        "contract_balances": {
            "revenue_recognized_to_date": 0.0,
            "contract_liability_amount": 3_200_000.0,
        },
        "revenue_schedule": [
            {
                "Date": "2027-04-01",
                "Obligation_ID": "PO-1",
                "Scheduled_Revenue": 3_200_000.0,
                "Revenue": 0.0,
            },
        ],
        "performance_obligations": [
            {
                "obligation_id": "PO-1",
                "obligation": "Off-plan unit",
                "allocated_amount": 3_200_000.0,
                "revenue_recognized": 0.0,
                "recognition_method": "over_time",
            },
        ],
        "disclosure_data": {
            "contract_details": {
                "contract_id": "RERA-CH-2025-002",
                "term_months": 27,
                "currency": "AED",
                "effective_date": "2025-01-01",
            },
            "performance_obligations": [],
        },
    }
    report = IFRS15MasterSummaryEngine().generate(
        {
            "contract_id": "RERA-CH-2025-002",
            "customer_name": "Buyer",
            "contract_term_months": 27,
            "core_results": core,
            "rpo_result": None,
        }
    )
    assert report["financial_summary"]["total_rpo"] == pytest.approx(3_200_000.0, abs=1.0)
    assert report["financial_summary"]["deferred_revenue"] == pytest.approx(3_200_000.0, abs=1.0)


def test_implicit_obligations_merged_not_left_at_zero():
    obs = [
        {
            "obligation_id": "PO-1",
            "description": "Delivery of off-plan residential unit at handover",
            "standalone_selling_price": 3_200_000.0,
            "is_distinct": True,
        },
        {
            "obligation_id": "PO-2",
            "description": "Common area infrastructure",
            "standalone_selling_price": 0,
            "is_distinct": False,
        },
        {
            "obligation_id": "PO-3",
            "description": "DLP defect liability period",
            "standalone_selling_price": 0,
            "is_distinct": False,
        },
    ]
    normalized, audit = normalize_implicit_performance_obligations(obs, 3_200_000.0, contract_term_months=27)
    assert len(normalized) == 1
    assert normalized[0]["obligation_id"] == "PO-1"
    assert normalized[0]["standalone_selling_price"] == 3_200_000.0
    assert normalized[0]["distinct_assessment"] == "separately_allocated"
    assert len(audit) == 2
    assert all(a["distinct_assessment"] == "merged" for a in audit)


def test_recognition_pattern_label_single_handover():
    label = recognition_pattern_label_from_results(
        {
            "revenue_schedule": [
                {"Date": "2027-04-01", "Scheduled_Revenue": 3_200_000.0},
            ],
            "performance_obligations": [
                {"recognition_method": "point_in_time"},
            ],
        }
    )
    assert "Point-in-time" in label
    assert "handover" in label.lower()


def test_extraction_cache_roundtrip(tmp_path, monkeypatch):
    from ifrs15_extractor import (
        IFRS15ContractExtractor,
        _extraction_cache_key,
        _load_extraction_cache,
        _save_extraction_cache,
    )

    monkeypatch.setenv("OUTPUT_DIR", str(tmp_path))
    text = "Sample contract PO-1 unit delivery AED 1000000"
    key = _extraction_cache_key(text, "generic")
    payload = {
        "step2_performance_obligations": {
            "identified_obligations": [
                {"obligation_id": "PO-1", "description": "Unit delivery"},
            ],
            "total_obligations_count": 1,
        }
    }
    _save_extraction_cache(key, payload)
    loaded = _load_extraction_cache(key)
    assert loaded is not None
    assert len(loaded["step2_performance_obligations"]["identified_obligations"]) == 1
