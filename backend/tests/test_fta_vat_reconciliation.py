"""FTA VAT return reconciliation — smoke tests."""

from backend.app.services.fta_vat_reconciliation import (
    FTAVATReturn,
    build_reconciliation_report,
    reconcile_vat_line,
)


def _schedule_item(revenue: float, quarter: str = "Q1 2026") -> dict:
    return {
        "period": quarter,
        "quarter": quarter,
        "period_start": "2026-01-01",
        "period_end": "2026-03-31",
        "revenue_recognised": revenue,
        "revenue": revenue,
    }


def test_3_unexplained_ifrs_exceeds_fta():
    """IFRS 875k vs FTA 700k — compliance warning."""
    line = reconcile_vat_line(
        _schedule_item(875_000),
        FTAVATReturn(
            quarter="Q1 2026",
            period_start="2026-01-01",
            period_end="2026-03-31",
            box_1a_taxable_supplies=700_000,
            box_1b_vat_on_supplies=35_000,
        ),
    )
    assert line.status == "unexplained"
    assert line.risk_flag is True
    assert "POTENTIAL COMPLIANCE ISSUE" in line.auditor_note
    assert line.revenue_difference == -175_000


def test_1_perfect_match():
    line = reconcile_vat_line(
        _schedule_item(875_000),
        FTAVATReturn(
            quarter="Q1 2026",
            period_start="2026-01-01",
            period_end="2026-03-31",
            box_1a_taxable_supplies=875_000,
            box_1b_vat_on_supplies=43_750,
        ),
    )
    assert line.status == "matched"
    assert line.risk_flag is False
    assert line.vat_difference == 0.0


def test_2_positive_timing_diff():
    line = reconcile_vat_line(
        _schedule_item(700_000),
        FTAVATReturn(
            quarter="Q1 2026",
            period_start="2026-01-01",
            period_end="2026-03-31",
            box_1a_taxable_supplies=875_000,
            box_1b_vat_on_supplies=43_750,
        ),
    )
    assert line.status == "timing_diff"
    assert line.revenue_difference == 175_000
    assert line.difference_pct == 25.0
    assert line.risk_flag is True


def test_4_no_fta_data():
    report = build_reconciliation_report(
        [_schedule_item(500_000, "Q1 2026"), _schedule_item(300_000, "Q2 2026")],
        [],
        {"rera_registration_number": "RERA-TEST"},
    )
    assert all(ln.status == "no_fta_data" for ln in report.reconciliation_lines)
    assert report.overall_risk == "low"
    assert report.quarters_no_fta_data == 2


def test_5_box_1b_mismatch_warning():
    line = reconcile_vat_line(
        _schedule_item(875_000),
        FTAVATReturn(
            quarter="Q1 2026",
            period_start="2026-01-01",
            period_end="2026-03-31",
            box_1a_taxable_supplies=875_000,
            box_1b_vat_on_supplies=50_000,
        ),
    )
    assert any("Box 1b" in item for item in line.reconciling_items)
