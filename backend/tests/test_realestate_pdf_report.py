"""Tests for UAE real estate client PDF report."""

import io

from PyPDF2 import PdfReader

from backend.app.services.realestate_pdf_report import (
    RealEstatePDFInput,
    format_money,
    generate_realestate_pdf,
)


def _pdf_text(pdf_bytes: bytes) -> str:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def _full_input(**overrides) -> RealEstatePDFInput:
    base = dict(
        project_name="Marina Heights",
        developer_name="Al Mansoori Development LLC",
        rera_registration_number="RERA-2024-DXB-00123",
        report_date="2026-03-15",
        reporting_period="Q1 2026",
        currency="AED",
        contract_price=3_500_000,
        completion_pct=65.0,
        completion_source="RERA Certificate",
        rera_certificate_ref="DLD/CC/2026/00123",
        rera_certificate_date="2026-03-15",
        revenue_recognition_trigger="rera_completion_certificate",
        revenue_recognised=2_275_000,
        deferred_revenue=0,
        contract_asset=150_000,
        vat_amount=113_750,
        remaining_performance_obligation=1_225_000,
        total_escrow_received=2_000_000,
        total_escrow_released=1_500_000,
        net_escrow_balance=500_000,
        escrow_compliance_status="Compliant",
        quarterly_schedule=[
            {
                "quarter": "Q1 2025",
                "completion_pct": 30,
                "revenue": 500_000,
                "cumulative_revenue": 500_000,
                "vat": 25_000,
            }
        ],
        health_checks={"check_a_pass": True, "check_b1_pass": True, "check_b2_pass": True, "check_c_pass": True},
        disclosure_score=85,
        disclosure_gaps=[],
        journal_entries=[{"dr": "Contract Asset", "cr": "Revenue", "amount": 100_000, "narrative": "Test"}],
        rera_certificate_verified=True,
    )
    base.update(overrides)
    return RealEstatePDFInput(**base)


def test_full_report_pdf_bytes():
    pdf, pages = generate_realestate_pdf(_full_input())
    assert pdf[:4] == b"%PDF"
    assert pages >= 4


def test_minimal_report():
    data = RealEstatePDFInput(
        rera_registration_number="RERA-MIN",
        report_date="2026-05-26",
        reporting_period="Q1 2026",
    )
    pdf, _ = generate_realestate_pdf(data)
    assert len(pdf) > 1000


def test_violation_status_in_pdf():
    pdf, _ = generate_realestate_pdf(
        _full_input(
            escrow_compliance_status="VIOLATION",
            health_checks={
                "check_a_pass": True,
                "check_b1_pass": True,
                "check_b2_pass": False,
                "check_c_pass": True,
            },
        )
    )
    text = _pdf_text(pdf)
    assert "VIOLATION" in text


def test_usd_currency_format():
    assert format_money(1000, "USD") == "USD 1,000.00"
    pdf, _ = generate_realestate_pdf(_full_input(currency="USD"))
    text = _pdf_text(pdf)
    assert "USD" in text
    assert "AED 3,500,000" not in text


def test_long_quarterly_schedule():
    rows = [
        {
            "quarter": f"Q{(i % 4) + 1} {2024 + i // 4}",
            "completion_pct": 10 * (i + 1),
            "revenue": 100_000 * (i + 1),
            "cumulative_revenue": 100_000 * (i + 1),
            "vat": 5_000 * (i + 1),
        }
        for i in range(10)
    ]
    pdf, pages = generate_realestate_pdf(_full_input(quarterly_schedule=rows))
    assert pdf[:4] == b"%PDF"
    assert pages >= 4
