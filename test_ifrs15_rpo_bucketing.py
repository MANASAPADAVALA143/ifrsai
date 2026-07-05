"""IFRS 15.120 — RPO bucket distribution derived from per-POB remaining schedule lines."""

from datetime import date, timedelta

import pytest

pytestmark = pytest.mark.ifrs15_standing

from ifrs15_calculator import (
    IFRS15Calculator,
    RPO_BUCKET_DEFINITIONS,
    RPO_BUCKET_KEYS,
    RPO_PRACTICAL_EXPEDIENT_NOTE,
    RPOReconciliationError,
    RPOContract,
    contract_rpo_within_twelve_months,
    format_ifrs15_currency,
    rpo_bucket_key_for_date,
)


def test_rpo_has_exactly_four_fixed_bands():
    assert len(RPO_BUCKET_KEYS) == 4
    assert set(RPO_BUCKET_KEYS) == {
        "within_1_year",
        "1_to_2_years",
        "2_to_5_years",
        "beyond_5_years",
    }
    reporting = date(2025, 7, 1)
    assert rpo_bucket_key_for_date(date(2026, 6, 30), reporting) == "within_1_year"
    assert rpo_bucket_key_for_date(date(2026, 7, 1), reporting) == "1_to_2_years"
    assert rpo_bucket_key_for_date(date(2027, 6, 30), reporting) == "1_to_2_years"
    assert rpo_bucket_key_for_date(date(2027, 7, 1), reporting) == "2_to_5_years"
    assert rpo_bucket_key_for_date(date(2030, 6, 30), reporting) == "2_to_5_years"
    assert rpo_bucket_key_for_date(date(2030, 7, 1), reporting) == "beyond_5_years"


def _short_term_lines():
    """Six monthly lines — all within 12 months of 2025-07-01."""
    return [
        {"expected_recognition_date": f"2025-{m:02d}-15", "amount": 10_000.0}
        for m in range(7, 13)
    ]


def test_practical_expedient_auto_detected_when_all_rpo_within_twelve_months():
    calc = IFRS15Calculator()
    reporting = "2025-07-01"
    contract = RPOContract(
        contract_id="SHORT-TERM",
        customer_name="Short Term Co",
        contract_start="2025-01-01",
        contract_end="2025-12-31",
        total_transaction_price=60_000.0,
        revenue_recognised_to_date=0.0,
        currency="AED",
        reporting_date=reporting,
        performance_obligations=[
            {
                "name": "SaaS subscription",
                "allocated_amount": 60_000.0,
                "recognised_to_date": 0.0,
                "remaining_schedule": _short_term_lines(),
            },
        ],
    )

    result = calc.calculate_rpo([contract])
    assert result["total_rpo"] == 0.0
    assert sum(result["buckets"].values()) == 0.0
    assert result["expedient_contracts_excluded"] == 1
    assert len(result["contract_details"]) == 0
    exp = result["expedient_contracts"][0]
    assert exp["practical_expedient_applied"] is True
    assert exp["expedient_reason"] == "auto_schedule_within_12_months"
    assert exp["excluded_rpo_amount"] == pytest.approx(60_000.0, abs=1.0)
    assert RPO_PRACTICAL_EXPEDIENT_NOTE in result["disclosure_note"]["full_text"]
    assert result["disclosure_note"]["paragraph_expedient"] == RPO_PRACTICAL_EXPEDIENT_NOTE


def test_practical_expedient_mixed_portfolio_excludes_short_term_only():
    calc = IFRS15Calculator()
    reporting = "2025-07-01"
    short = RPOContract(
        contract_id="SHORT",
        customer_name="A",
        contract_start="2025-01-01",
        contract_end="2025-12-31",
        total_transaction_price=60_000.0,
        revenue_recognised_to_date=0.0,
        currency="AED",
        reporting_date=reporting,
        performance_obligations=[
            {
                "name": "Subscription",
                "allocated_amount": 60_000.0,
                "recognised_to_date": 0.0,
                "remaining_schedule": _short_term_lines(),
            },
        ],
    )
    long = RPOContract(
        contract_id="LONG",
        customer_name="B",
        contract_start="2024-01-01",
        contract_end="2027-09-30",
        total_transaction_price=675_000.0,
        revenue_recognised_to_date=0.0,
        currency="AED",
        reporting_date=reporting,
        performance_obligations=[
            {
                "name": "Support",
                "obligation_id": "PO-2",
                "allocated_amount": 675_000.0,
                "recognised_to_date": 0.0,
                "remaining_schedule": _support_remaining_lines(reporting),
            },
        ],
    )

    result = calc.calculate_rpo([short, long])
    assert result["expedient_contracts_excluded"] == 1
    assert result["total_rpo"] == pytest.approx(675_000.0, abs=1.0)
    assert len(result["contract_details"]) == 1
    assert result["contract_details"][0]["contract_id"] == "LONG"


def test_contract_rpo_within_twelve_months_helper():
    buckets = {"within_1_year": 100.0, "1_to_2_years": 0.0, "2_to_5_years": 0.0, "beyond_5_years": 0.0}
    assert contract_rpo_within_twelve_months(buckets, 100.0) is True
    buckets["1_to_2_years"] = 1.0
    assert contract_rpo_within_twelve_months(buckets, 101.0) is False


def test_practical_expedient_single_pob_ending_in_300_days():
    """Single POB with all RPO within 12 months → expedient, excluded from 4-band table."""
    calc = IFRS15Calculator()
    reporting = "2025-01-01"
    reporting_dt = date(2025, 1, 1)
    recognition_dt = reporting_dt + timedelta(days=300)

    contract = RPOContract(
        contract_id="300-DAY",
        customer_name="Short POB Co",
        contract_start="2025-01-01",
        contract_end=recognition_dt.isoformat(),
        total_transaction_price=50_000.0,
        revenue_recognised_to_date=0.0,
        currency="AED",
        reporting_date=reporting,
        performance_obligations=[
            {
                "name": "Annual support",
                "obligation_id": "PO-1",
                "allocated_amount": 50_000.0,
                "recognised_to_date": 0.0,
                "remaining_schedule": [
                    {
                        "expected_recognition_date": recognition_dt.isoformat(),
                        "amount": 50_000.0,
                    }
                ],
            },
        ],
    )

    result = calc.calculate_rpo([contract])
    assert result["total_rpo"] == 0.0
    assert sum(result["buckets"].values()) == 0.0
    assert len(result["contract_details"]) == 0
    assert result["expedient_contracts_excluded"] == 1
    exp = result["expedient_contracts"][0]
    assert exp["practical_expedient_applied"] is True
    assert exp["expedient_reason"] == "auto_schedule_within_12_months"
    assert RPO_PRACTICAL_EXPEDIENT_NOTE in result["disclosure_note"]["full_text"]
    assert "Within 1 year: AED 0" in result["disclosure_note"]["full_text"] or "Within 1 year: AED 0" in result["disclosure_note"]["paragraph_2"]


def test_rpo_reconciliation_hard_block_on_partial_schedule():
    calc = IFRS15Calculator()
    reporting = "2025-07-01"
    contract = RPOContract(
        contract_id="PARTIAL-SCHED",
        customer_name="Partial Co",
        contract_start="2025-01-01",
        contract_end="2026-12-31",
        total_transaction_price=100_000.0,
        revenue_recognised_to_date=0.0,
        currency="AED",
        reporting_date=reporting,
        performance_obligations=[
            {
                "name": "Support",
                "obligation_id": "PO-1",
                "allocated_amount": 100_000.0,
                "recognised_to_date": 0.0,
                "remaining_schedule": [
                    {"expected_recognition_date": "2025-08-01", "amount": 40_000.0},
                    {"expected_recognition_date": "2026-08-01", "amount": 20_000.0},
                ],
            },
        ],
    )

    with pytest.raises(RPOReconciliationError) as exc:
        calc.calculate_rpo([contract])

    err = exc.value
    assert err.code == "RPO_RECONCILIATION_FAILED"
    assert err.to_dict()["missing_schedule_pobs"]
    assert any(p["obligation_id"] == "PO-1" for p in err.missing_schedule_pobs)
    assert "RPO disclosure cannot be generated" in err.message
    assert "PO-1" in err.message


def _support_remaining_lines(reporting: str = "2025-07-01"):
    """POB 2 support: AED 675k split evenly over 24 months from reporting date."""
    lines = []
    monthly = 675_000 / 24
    y, m = 2025, 7
    for _ in range(24):
        lines.append(
            {
                "expected_recognition_date": f"{y:04d}-{m:02d}-01",
                "amount": round(monthly, 2),
            }
        )
        m += 1
        if m > 12:
            m = 1
            y += 1
    return lines


def test_rpo_buckets_derived_from_remaining_schedule_not_contract_total():
    calc = IFRS15Calculator()
    reporting = "2025-07-01"
    contract = RPOContract(
        contract_id="DEMO-AED",
        customer_name="Test Customer",
        contract_start="2024-01-01",
        contract_end="2027-09-30",
        total_transaction_price=1_200_000.0,
        revenue_recognised_to_date=525_000.0,
        currency="AED",
        reporting_date=reporting,
        performance_obligations=[
            {
                "name": "Implementation",
                "allocated_amount": 525_000.0,
                "recognised_to_date": 525_000.0,
                "remaining_schedule": [],
            },
            {
                "name": "Support",
                "obligation_id": "PO-2",
                "allocated_amount": 675_000.0,
                "recognised_to_date": 0.0,
                "remaining_schedule": _support_remaining_lines(reporting),
            },
        ],
    )

    result = calc.calculate_rpo([contract])
    buckets = result["buckets"]

    assert result["total_rpo"] == pytest.approx(675_000.0, abs=1.0)
    assert buckets["within_1_year"] == pytest.approx(337_500.0, abs=50.0)
    assert buckets["1_to_2_years"] == pytest.approx(337_500.0, abs=50.0)
    assert buckets["2_to_5_years"] == pytest.approx(0.0, abs=1.0)
    assert result["bucket_validation"]["total_rpo_equals_bucket_sum"] is True
    assert result["disclosure_blocked"] is False
    assert set(result["buckets"].keys()) == set(RPO_BUCKET_KEYS)
    assert result["bucket_definitions"] == RPO_BUCKET_DEFINITIONS

    note = result["disclosure_note"]["full_text"]
    assert "$" not in note
    assert "AED" in note
    assert format_ifrs15_currency(675_000, "AED") in note


def test_rpo_parses_revenue_schedule_dates_when_remaining_schedule_omitted():
    calc = IFRS15Calculator()
    reporting = "2025-07-01"
    schedule = [
        {
            "Obligation_ID": "PO-2",
            "Obligation": "Support services",
            "Date": "2025-08-01",
            "Scheduled_Revenue": 168_750.0,
            "Revenue": 0.0,
            "Status": "Deferred",
        },
        {
            "Obligation_ID": "PO-2",
            "Obligation": "Support services",
            "Date": "2026-08-01",
            "Scheduled_Revenue": 168_750.0,
            "Revenue": 0.0,
            "Status": "Deferred",
        },
        {
            "Obligation_ID": "PO-2",
            "Obligation": "Support services",
            "Date": "2027-08-01",
            "Scheduled_Revenue": 337_500.0,
            "Revenue": 0.0,
            "Status": "Deferred",
        },
    ]
    contract = RPOContract(
        contract_id="SCHEDULE-DERIVED",
        customer_name="Test",
        contract_start="2024-01-01",
        contract_end="2027-09-30",
        total_transaction_price=675_000.0,
        revenue_recognised_to_date=0.0,
        currency="AED",
        reporting_date=reporting,
        revenue_schedule=schedule,
        performance_obligations=[
            {
                "name": "Support",
                "obligation_id": "PO-2",
                "allocated_amount": 675_000.0,
                "recognised_to_date": 0.0,
            },
        ],
    )

    result = calc.calculate_rpo([contract])
    assert result["total_rpo"] == pytest.approx(675_000.0, abs=1.0)
    assert result["buckets"]["within_1_year"] == pytest.approx(168_750.0, abs=1.0)
    assert result["buckets"]["1_to_2_years"] == pytest.approx(168_750.0, abs=1.0)
    assert result["buckets"]["2_to_5_years"] == pytest.approx(337_500.0, abs=1.0)
    po = result["contract_details"][0]["performance_obligations"][0]
    assert po["schedule_source"] == "revenue_schedule"
    assert len(po["remaining_schedule"]) == 3
