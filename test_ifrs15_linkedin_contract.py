"""IFRS 15 — multi-PO facilities contract (FF&E handover, training sessions, maintenance window)."""

from datetime import date, datetime
from decimal import Decimal

import pytest

from ifrs15_calculator import IFRS15Calculator, IFRS15Input, IFRS15MasterSummaryEngine, PerformanceObligation


def _linkedin_contract() -> IFRS15Input:
    return IFRS15Input(
        contract_id="LINKEDIN-DEMO-2024",
        customer_name="Demo Customer",
        effective_date=datetime(2024, 1, 1),
        contract_term_months=12,
        fixed_consideration=Decimal("1224000"),
        currency="AED",
        performance_obligations=[
            PerformanceObligation(
                obligation_id="PO-1",
                description="Office fit-out services — delivered over 8 months from January 2024",
                standalone_selling_price=Decimal("720000"),
                recognition_method="over_time",
                duration_months=8,
            ),
            PerformanceObligation(
                obligation_id="PO-2",
                description="FF&E supply and installation — delivered at handover on completion. Handover date: 31 August 2024",
                standalone_selling_price=Decimal("180000"),
                recognition_method="over_time",
                duration_months=12,
            ),
            PerformanceObligation(
                obligation_id="PO-3",
                description="Project management — delivered over 12 months from January 2024",
                standalone_selling_price=Decimal("144000"),
                recognition_method="over_time",
                duration_months=12,
            ),
            PerformanceObligation(
                obligation_id="PO-4",
                description="12-month maintenance contract — delivered over 12 months from January 2024",
                standalone_selling_price=Decimal("120000"),
                recognition_method="over_time",
                duration_months=12,
            ),
            PerformanceObligation(
                obligation_id="PO-5",
                description="Staff training — 2 sessions delivered June 2024 and August 2024",
                standalone_selling_price=Decimal("60000"),
                recognition_method="point_in_time",
            ),
        ],
    )


def _period_revenue(schedule, period: int) -> float:
    if schedule.empty:
        return 0.0
    mask = schedule["Period"] == period
    return float(schedule.loc[mask, "Scheduled_Revenue"].sum())


def _year_bucket_revenue(schedule) -> dict:
    buckets = {"Year 1": 0.0, "Year 2": 0.0}
    for _, row in schedule.iterrows():
        p = int(row.get("Period", 0) or 0)
        rev = float(row.get("Scheduled_Revenue", row.get("Revenue", 0)) or 0)
        if 1 <= p <= 12:
            buckets["Year 1"] += rev
        elif 13 <= p <= 24:
            buckets["Year 2"] += rev
    return buckets


def test_ffe_point_in_time_full_amount_in_august():
    calc = IFRS15Calculator()
    contract = _linkedin_contract()
    results = calc.calculate_full_ifrs15(contract)
    schedule = results["recognition_schedule"]
    ffe = schedule[
        (schedule["Obligation_ID"] == "PO-2")
        & (schedule["Scheduled_Revenue"] > 0)
    ]
    assert len(ffe) == 1
    assert ffe.iloc[0]["Month"] == "Aug 2024"
    assert ffe.iloc[0]["Scheduled_Revenue"] == pytest.approx(180000.0, abs=1.0)


def test_training_not_january_when_description_also_mentions_contract_from_january():
    """Extraction often adds 'from January 2024' — must not override session delivery months."""
    calc = IFRS15Calculator()
    contract = _linkedin_contract()
    training = next(
        o for o in contract.performance_obligations if o.obligation_id == "PO-5"
    )
    training = PerformanceObligation(
        obligation_id=training.obligation_id,
        description=(
            "Staff training — 2 sessions delivered June 2024 and August 2024; "
            "contract term from January 2024"
        ),
        standalone_selling_price=training.standalone_selling_price,
        recognition_method=training.recognition_method,
    )
    contract = IFRS15Input(
        contract_id=contract.contract_id,
        customer_name=contract.customer_name,
        effective_date=contract.effective_date,
        contract_term_months=contract.contract_term_months,
        fixed_consideration=contract.fixed_consideration,
        currency=contract.currency,
        performance_obligations=[
            o for o in contract.performance_obligations if o.obligation_id != "PO-5"
        ]
        + [training],
    )
    results = calc.calculate_full_ifrs15(contract)
    schedule = results["recognition_schedule"]
    training_rows = schedule[schedule["Obligation_ID"] == "PO-5"]
    months = sorted(training_rows[training_rows["Scheduled_Revenue"] > 0]["Month"].tolist())
    assert months == ["Aug 2024", "Jun 2024"]
    assert calc._resolve_obligation_start(training, contract, {}) == date(2024, 6, 1)


def test_training_sessions_june_and_august_not_january():
    calc = IFRS15Calculator()
    contract = _linkedin_contract()
    results = calc.calculate_full_ifrs15(contract)
    schedule = results["recognition_schedule"]
    training = schedule[schedule["Obligation_ID"] == "PO-5"]
    months = sorted(training[training["Scheduled_Revenue"] > 0]["Month"].tolist())
    assert months == ["Aug 2024", "Jun 2024"]
    assert "Jan 2024" not in months


def test_maintenance_entirely_in_year_1_not_year_2():
    calc = IFRS15Calculator()
    contract = _linkedin_contract()
    results = calc.calculate_full_ifrs15(contract)
    schedule = results["recognition_schedule"]
    years = _year_bucket_revenue(schedule)
    maint = schedule[schedule["Obligation_ID"] == "PO-4"]
    assert maint[maint["Period"] > 12]["Scheduled_Revenue"].sum() == pytest.approx(0.0, abs=0.01)
    assert years["Year 2"] == pytest.approx(0.0, abs=1.0)
    assert years["Year 1"] == pytest.approx(1224000.0, abs=500.0)


def test_august_total_322000():
    calc = IFRS15Calculator()
    contract = _linkedin_contract()
    results = calc.calculate_full_ifrs15(contract)
    schedule = results["recognition_schedule"]
    aug = schedule[schedule["Month"] == "Aug 2024"]
    assert aug["Scheduled_Revenue"].sum() == pytest.approx(322000.0, abs=500.0)


def _month_total(schedule, month: str) -> float:
    rows = schedule[schedule["Month"] == month]
    return float(rows["Scheduled_Revenue"].sum())


def test_january_no_training_june_and_august_totals():
    """Extraction-style month text: June 2024 and August 2024 (not shared trailing year)."""
    calc = IFRS15Calculator()
    contract = _linkedin_contract()
    results = calc.calculate_full_ifrs15(contract)
    schedule = results["recognition_schedule"]
    assert _month_total(schedule, "Jan 2024") == pytest.approx(112000.0, abs=500.0)
    assert _month_total(schedule, "Jun 2024") == pytest.approx(142000.0, abs=500.0)
    assert _month_total(schedule, "Aug 2024") == pytest.approx(322000.0, abs=500.0)


def test_ffe_recognition_date_single_source_august():
    calc = IFRS15Calculator()
    contract = _linkedin_contract()
    results = calc.calculate_full_ifrs15(contract)
    resolved, _, _ = calc._resolve_obligations_for_schedule(contract)
    ffe_res = next(o for o in resolved if o.obligation_id == "PO-2")
    assert ffe_res.recognition_date is not None
    assert ffe_res.recognition_date.month == 8
    assert ffe_res.recognition_date.year == 2024

    schedule = results["recognition_schedule"]
    ffe_row = schedule[
        (schedule["Obligation_ID"] == "PO-2") & (schedule["Scheduled_Revenue"] > 0)
    ].iloc[0]
    assert ffe_row["Month"] == "Aug 2024"
    if "Recognition_Date" in ffe_row:
        assert str(ffe_row["Recognition_Date"]).startswith("2024-08")

    disc = next(
        p for p in results["disclosure_data"]["performance_obligations"] if p["obligation_id"] == "PO-2"
    )
    assert disc["recognition_date"].startswith("2024-08")
    assert "2024-08" in results["revenue_recognition_audit_trail"]


def test_maintenance_january_to_december_2024():
    calc = IFRS15Calculator()
    contract = _linkedin_contract()
    maint = PerformanceObligation(
        obligation_id="PO-4",
        description="12-month maintenance contract — January 2024 to December 2024",
        standalone_selling_price=Decimal("120000"),
        recognition_method="over_time",
        duration_months=12,
        obligation_start_date=datetime(2024, 12, 1),
    )
    contract = IFRS15Input(
        contract_id=contract.contract_id,
        customer_name=contract.customer_name,
        effective_date=contract.effective_date,
        contract_term_months=contract.contract_term_months,
        fixed_consideration=contract.fixed_consideration,
        currency=contract.currency,
        performance_obligations=[
            o for o in contract.performance_obligations if o.obligation_id != "PO-4"
        ]
        + [maint],
    )
    results = calc.calculate_full_ifrs15(contract)
    schedule = results["recognition_schedule"]
    rows = schedule[
        (schedule["Obligation_ID"] == "PO-4") & (schedule["Scheduled_Revenue"] > 0)
    ]
    months = rows["Month"].tolist()
    assert months[0] == "Jan 2024"
    assert months[-1] == "Dec 2024"
    assert len(months) == 12
    assert "Nov 2025" not in months


def test_disclosure_ffe_point_in_time_after_resolve():
    calc = IFRS15Calculator()
    contract = _linkedin_contract()
    results = calc.calculate_full_ifrs15(contract)
    pos = results["disclosure_data"]["performance_obligations"]
    ffe = next(p for p in pos if p["obligation_id"] == "PO-2")
    assert ffe["recognition_method"] == "point_in_time"


def test_master_report_step2_obligation_count():
    calc = IFRS15Calculator()
    contract = _linkedin_contract()
    core = calc.calculate_full_ifrs15(contract)
    report = IFRS15MasterSummaryEngine().generate(
        {"core_results": core, "contract_id": contract.contract_id, "customer_name": contract.customer_name}
    )
    assert report["five_step_status"]["step2_obligations_identified"] == 5
    assert report["contract_overview"]["number_of_obligations"] == 5
