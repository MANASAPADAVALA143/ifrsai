"""POST test SPA PDF to /api/ifrs15/extract-contract (same path as UI)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "test_fixtures" / "SPA_Downtown_Views_II_Tower_B_1205.pdf"
OUT = ROOT / "test_fixtures" / "api_response.json"


def main() -> int:
    try:
        import httpx
    except ImportError:
        import subprocess

        subprocess.check_call([sys.executable, "-m", "pip", "install", "httpx", "-q"])
        import httpx

    if not PDF.exists():
        print(f"[FAIL] Missing PDF: {PDF}")
        return 1

    url = "http://127.0.0.1:9000/api/ifrs15/extract-contract?contract_type=uae_spa"
    print(f"[...] POST {url}")
    with open(PDF, "rb") as f:
        resp = httpx.post(url, files={"file": (PDF.name, f, "application/pdf")}, timeout=300.0)

    if resp.status_code != 200:
        print(f"[FAIL] HTTP {resp.status_code}: {resp.text[:500]}")
        return 1

    out = resp.json()
    ed = out["extracted_data"]
    ci = ed["contract_identification"]

    rows = [
        ("SPA Reference", ci["spa_reference"]["value"], ci["spa_reference"]["confidence"], "SPA-DV2-2024-1205"),
        ("Oqood Number", ci["oqood_number"]["value"], ci["oqood_number"]["confidence"], "DLD-2024-OQ-48291"),
        ("RERA Registration", ci["rera_registration"]["value"], ci["rera_registration"]["confidence"], "RERA-DT2-2024-001"),
        ("Developer", ed["parties"]["developer_name"]["value"], ed["parties"]["developer_name"]["confidence"], "Emaar Development LLC"),
        ("Buyer", ed["parties"]["buyer_name"]["value"], ed["parties"]["buyer_name"]["confidence"], "Mohammed Al Rashidi"),
        ("Project Name", ed["property"]["project_name"]["value"], ed["property"]["project_name"]["confidence"], "Downtown Views II"),
        ("Unit Number", ed["property"]["unit_number"]["value"], ed["property"]["unit_number"]["confidence"], "1205"),
        ("Contract Value", ed["financial"]["contract_value_aed"]["value"], ed["financial"]["contract_value_aed"]["confidence"], 2450000),
        ("Booking Amount", ed["financial"]["booking_amount_aed"]["value"], ed["financial"]["booking_amount_aed"]["confidence"], 245000),
        ("Handover Date", ed["construction_timeline"]["expected_handover_date"]["value"], ed["construction_timeline"]["expected_handover_date"]["confidence"], "2026-12-31"),
        ("Payment Plan", len(ed["financial"]["payment_plan"]["value"]), ed["financial"]["payment_plan"]["confidence"], 7),
        ("Cancellation", str(ed["ifrs15_specific"]["cancellation_terms"]["value"])[:50], ed["ifrs15_specific"]["cancellation_terms"]["confidence"], "Law 8/2007"),
    ]

    print("\n" + "=" * 85)
    print("HTTP API LIVE TEST — POST /api/ifrs15/extract-contract")
    print("=" * 85)
    print(f"{'Field':<22} {'Extracted':<30} {'Conf%':>6} {'Target':>8}")
    print("-" * 85)
    for label, val, conf, target in rows:
        ok = "PASS" if (str(target).lower() in str(val).lower() or val == target) else "FAIL"
        print(f"{label:<22} {str(val)[:28]:<30} {conf:>5}% {ok:>8}")

    print("-" * 85)
    print(f"Overall confidence: {out.get('overall_confidence')}%")
    print(f"Validation valid: {out['validation']['is_valid']}")

    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n[OK] Saved {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
