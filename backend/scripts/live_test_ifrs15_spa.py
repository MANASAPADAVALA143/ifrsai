"""
Generate Downtown Views II test SPA PDF and run live Claude extraction.
Run from repo root: python backend/scripts/live_test_ifrs15_spa.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")
load_dotenv(ROOT / "frontend" / ".env")

PDF_PATH = ROOT / "test_fixtures" / "SPA_Downtown_Views_II_Tower_B_1205.pdf"

SPA_TEXT = """
SALE AND PURCHASE AGREEMENT
Off-Plan Property — Dubai, United Arab Emirates

SPA Reference Number: SPA-DV2-2024-1205
Oqood Registration Number: DLD-2024-OQ-48291
RERA Project Registration: RERA-DT2-2024-001

Contract Date: 15 March 2024

PARTIES
Developer / Seller: Emaar Development LLC
Buyer / Purchaser: Mohammed Al Rashidi
Emirates ID: 784-1985-1234567-1
Nationality: United Arab Emirates

PROPERTY DETAILS
Project Name: Downtown Views II — Tower B
Unit Number: 1205
Unit Type: Apartment
Floor: 12
Built-up Area: 1,450 sq ft

FINANCIAL TERMS
Total Purchase Price: AED 2,450,000 (exclusive of VAT)
VAT Amount: AED 122,500 (5%)
Booking Amount Paid: AED 245,000 (10% of purchase price)
Handover Payment: AED 1,225,000 (50% due on handover)

PAYMENT PLAN
1. Booking on signing: AED 245,000 (10%)
2. 6 months from SPA date: AED 122,500 (5%)
3. 12 months from SPA date: AED 122,500 (5%)
4. On 30% construction completion: AED 245,000 (10%)
5. On 50% construction completion: AED 245,000 (10%)
6. On 70% construction completion: AED 245,000 (10%)
7. On handover / completion: AED 1,225,000 (50%)

CONSTRUCTION TIMELINE
Construction Start Date: 1 January 2024
Expected Completion Date: 31 December 2026
Expected Handover Date: 31 December 2026
Current Completion: 35%

IFRS 15 / REVENUE RECOGNITION
Performance Obligation: Delivery of completed apartment unit at handover
Revenue Recognition Method: Over time during construction (IFRS 15.35(c))
Variable Consideration: None stated beyond standard payment plan
Cancellation Terms: UAE Law No. 8 of 2007 refund terms apply to buyer cancellation
Penalty Clauses: Developer delay penalties as per RERA regulations
Modification Clauses: Price adjustments only by mutual written agreement
"""

EXPECTED = {
    "spa_reference": "SPA-DV2-2024-1205",
    "oqood_number": "DLD-2024-OQ-48291",
    "rera_registration": "RERA-DT2-2024-001",
    "developer_name": "Emaar Development LLC",
    "buyer_name": "Mohammed Al Rashidi",
    "project_name": "Downtown Views II",
    "unit_number": "1205",
    "contract_value_aed": 2450000,
    "booking_amount_aed": 245000,
    "expected_handover_date": "2026-12-31",
    "payment_plan_count": 7,
    "cancellation_terms": "Law 8/2007",
}


def generate_pdf(path: Path) -> None:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    path.parent.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()
    story = []
    for block in SPA_TEXT.strip().split("\n\n"):
        for line in block.split("\n"):
            story.append(Paragraph(line.replace("&", "&amp;"), styles["Normal"]))
        story.append(Spacer(1, 8))
    doc = SimpleDocTemplate(str(path), pagesize=A4)
    doc.build(story)
    print(f"[OK] Generated test PDF: {path}")


def unwrap(obj):
    if isinstance(obj, dict) and "value" in obj:
        return obj.get("value")
    return obj


def conf(obj):
    if isinstance(obj, dict) and "confidence" in obj:
        try:
            return int(obj["confidence"])
        except (TypeError, ValueError):
            return None
    return None


def fmt_val(v) -> str:
    if v is None:
        return "—"
    if isinstance(v, list):
        return f"{len(v)} items"
    return str(v)


def check_match(field: str, actual, expected) -> str:
    if actual is None:
        return "MISSING"
    if field == "payment_plan_count":
        n = len(actual) if isinstance(actual, list) else 0
        return "PASS" if n >= expected else f"FAIL ({n} vs {expected})"
    if field == "contract_value_aed" or field == "booking_amount_aed":
        try:
            return "PASS" if int(float(actual)) == int(expected) else f"FAIL ({actual})"
        except (TypeError, ValueError):
            return f"FAIL ({actual})"
    if field == "expected_handover_date":
        s = str(actual)[:10]
        return "PASS" if s == expected else f"FAIL ({s})"
    s = str(actual).lower()
    e = str(expected).lower()
    return "PASS" if e in s or s in e else f"FAIL ({actual})"


def print_field_table(data: dict) -> None:
    ci = data.get("contract_identification") or {}
    prop = data.get("property") or {}
    parties = data.get("parties") or {}
    fin = data.get("financial") or {}
    tl = data.get("construction_timeline") or {}
    ifrs = data.get("ifrs15_specific") or {}

    rows = [
        ("SPA Reference", ci.get("spa_reference"), "spa_reference", unwrap(ci.get("spa_reference"))),
        ("Oqood Number", ci.get("oqood_number"), "oqood_number", unwrap(ci.get("oqood_number"))),
        ("RERA Registration", ci.get("rera_registration"), "rera_registration", unwrap(ci.get("rera_registration"))),
        ("Contract Date", ci.get("contract_date"), None, unwrap(ci.get("contract_date"))),
        ("Developer", parties.get("developer_name"), "developer_name", unwrap(parties.get("developer_name"))),
        ("Buyer", parties.get("buyer_name"), "buyer_name", unwrap(parties.get("buyer_name"))),
        ("Buyer EID", parties.get("buyer_eid"), None, unwrap(parties.get("buyer_eid"))),
        ("Project Name", prop.get("project_name"), "project_name", unwrap(prop.get("project_name"))),
        ("Unit Number", prop.get("unit_number"), "unit_number", unwrap(prop.get("unit_number"))),
        ("Unit Type", prop.get("unit_type"), None, unwrap(prop.get("unit_type"))),
        ("Floor Area (sqft)", prop.get("floor_area_sqft"), None, unwrap(prop.get("floor_area_sqft"))),
        ("Contract Value (AED)", fin.get("contract_value_aed"), "contract_value_aed", unwrap(fin.get("contract_value_aed"))),
        ("Booking Amount (AED)", fin.get("booking_amount_aed"), "booking_amount_aed", unwrap(fin.get("booking_amount_aed"))),
        ("Handover Payment (AED)", fin.get("handover_payment_aed"), None, unwrap(fin.get("handover_payment_aed"))),
        ("VAT Amount (AED)", fin.get("vat_amount_aed"), None, unwrap(fin.get("vat_amount_aed"))),
        ("Payment Plan", fin.get("payment_plan"), "payment_plan_count", unwrap(fin.get("payment_plan"))),
        ("Construction Start", tl.get("construction_start_date"), None, unwrap(tl.get("construction_start_date"))),
        ("Expected Handover", tl.get("expected_handover_date"), "expected_handover_date", unwrap(tl.get("expected_handover_date"))),
        ("Completion %", tl.get("current_completion_pct"), None, unwrap(tl.get("current_completion_pct"))),
        ("Performance Obligation", ifrs.get("performance_obligation"), None, unwrap(ifrs.get("performance_obligation"))),
        ("Rev Recognition Method", ifrs.get("revenue_recognition_method"), None, unwrap(ifrs.get("revenue_recognition_method"))),
        ("Cancellation Terms", ifrs.get("cancellation_terms"), "cancellation_terms", unwrap(ifrs.get("cancellation_terms"))),
        ("Penalty Clauses", ifrs.get("penalty_clauses"), None, unwrap(ifrs.get("penalty_clauses"))),
    ]

    print("\n" + "=" * 90)
    print("LIVE EXTRACTION RESULTS — Downtown Views II SPA")
    print("=" * 90)
    print(f"{'Field':<26} {'Value':<32} {'Conf%':>6} {'Check':>8}")
    print("-" * 90)
    for label, field_obj, exp_key, raw in rows:
        c = conf(field_obj) if field_obj is not None else None
        c_str = str(c) if c is not None else "—"
        val = fmt_val(raw)
        if len(val) > 32:
            val = val[:29] + "..."
        check = "—"
        if exp_key and exp_key in EXPECTED:
            check = check_match(exp_key, raw, EXPECTED[exp_key])
        print(f"{label:<26} {val:<32} {c_str:>6} {check:>8}")

    plan = unwrap(fin.get("payment_plan"))
    if isinstance(plan, list) and plan:
        print("\nPayment Plan Detail:")
        for i, item in enumerate(plan, 1):
            r = item if isinstance(item, dict) else {}
            print(
                f"  {i}. {r.get('label', '?')} — AED {r.get('amount_aed', '?')} "
                f"({r.get('pct', '?')}%) trigger={r.get('trigger', '?')}"
            )

    meta = data.get("extraction_metadata") or {}
    val_block = data.get("validation") or {}
    overall = meta.get("overall_confidence") or unwrap(val_block.get("overall_confidence"))
    print("\n" + "-" * 90)
    print(f"Overall confidence: {overall}%")
    print(f"Fields scored: {meta.get('fields_scored', '?')}")
    print(f"Low confidence: {meta.get('low_confidence_fields', [])}")
    print(f"Model: {meta.get('model', '?')}")
    print(f"Tokens: {meta.get('tokens_used', '?')}")


def main() -> int:
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        print("[FAIL] ANTHROPIC_API_KEY not set in .env")
        return 1

    if not PDF_PATH.exists():
        generate_pdf(PDF_PATH)
    else:
        print(f"[OK] Using existing PDF: {PDF_PATH}")

    from ifrs15_extractor import IFRS15ContractExtractor

    print("[...] Running live Claude extraction (same as /api/ifrs15/extract-contract)...")
    extractor = IFRS15ContractExtractor(api_key=api_key)
    data = extractor.extract_from_file(str(PDF_PATH), contract_type="uae_spa")
    validation = extractor.validate_uae_spa_extraction(data)

    print_field_table(data)
    print("\nValidation:", json.dumps(validation, indent=2))

    out = ROOT / "test_fixtures" / "SPA_Downtown_Views_II_extraction_result.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"\n[OK] Full JSON saved: {out}")

    return 0 if validation.get("is_valid") else 1


if __name__ == "__main__":
    raise SystemExit(main())
