"""IFRS 15 client PDF — UAE real estate currency, disclosure, and auditor Q&A."""

import io

from PyPDF2 import PdfReader

from ifrs15_client_report import generate_client_report


def _pdf_text(pdf_path: str) -> str:
    reader = PdfReader(pdf_path)
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def test_uae_client_report_aed_disclosure_and_qa():
    results = {
        "total_contract_value": 2_000_000,
        "transaction_price": 2_000_000,
        "total_recognised": 1_300_000,
        "total_deferred": 700_000,
        "realestate_overlay": {
            "rera_registration_number": "RERA-2024-DXB-00123",
            "spa_execution_date": "2024-01-15",
            "revenue_recognised_to_date": 1_300_000,
            "contract_liability": 700_000,
            "completion_pct": 65.0,
            "currency": "AED",
            "project_name": "Marina Heights",
        },
        "revenue_schedule": [
            {
                "Month": "Q1 2024",
                "Scheduled_Revenue": 342_000,
                "Revenue": 342_000,
                "Cumulative": 342_000,
                "Obligation_ID": "PO-RE-1",
            },
            {
                "Month": "Q4 2024",
                "Scheduled_Revenue": 274_000,
                "Revenue": 274_000,
                "Cumulative": 1_300_000,
                "Obligation_ID": "PO-RE-1",
            },
        ],
        "disclosure_notes": {
            "accounting_policy": "Over time input method per IFRS 15.35(c).",
            "disaggregation_of_revenue": "Revenue recognised to date: AED 1,300,000.00",
            "contract_balances": "Contract assets: AED 0.00; Contract liabilities: AED 700,000.00.",
            "performance_obligations_note": "Off-plan unit.",
            "transaction_price_rpo": "Unrecognised transaction price: AED 700,000.00.",
            "significant_judgements": "Completion % and RERA escrow timing.",
        },
        "disclosure_data": {
            "contract_details": {
                "currency": "AED",
                "customer": "Ahmed Al Rashidi",
                "vendor": "Marina Heights Development LLC",
                "effective_date": "2024-01-15",
            }
        },
        "contract_balances": {
            "contract_liability_amount": 700_000,
            "contract_asset_amount": 0,
            "cash_received_to_date": 2_000_000,
            "revenue_recognized_to_date": 1_300_000,
        },
        "performance_obligations": [
            {
                "obligation_id": "PO-RE-1",
                "allocated_amount": 2_000_000,
                "revenue_recognized": 1_300_000,
                "recognition_method": "over_time",
            }
        ],
        "journal_entries": [],
    }
    out = generate_client_report(
        {
            "contract_id": "RE-UNIT",
            "customer_name": "Ahmed Al Rashidi",
            "calculation_results": results,
            "include_auditor_qa": True,
            "prepared_by": "FinReportAI — ifrsai.vercel.app",
        },
        api_key="",
    )
    text = _pdf_text(out["path"])
    assert "AED 1,300,000" in text
    assert "AED 700,000" in text
    assert "RERA-2024-DXB-00123" in text
    assert "IFRS 15.9" in text or "IFRS 15.35" in text
    assert "Judgement and supporting evidence should be documented" not in text
    assert "Federal Decree-Law No. 8 of 2017" in text
    assert "Q1 2024" in text
