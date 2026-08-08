"""Generate IFRS 15 audit evidence pack for period 2026-06.

Pulls seeded billing recon (064), modifications (065) and RPO (066).

Usage (from repo root):
  python scripts/seed_evidence_pack_demo.py
  python scripts/seed_evidence_pack_demo.py --company-id emaar-dev
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")
load_dotenv(ROOT / "frontend" / ".env")

from backend.app.routers.ifrs15_evidence_pack import generate_pack
from backend.app.services.supabase_client import is_supabase_configured


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--company-id", default="ae7301ab")
    parser.add_argument("--period", default="2026-06")
    args = parser.parse_args()
    if not is_supabase_configured():
        print("ERROR: Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
        return 1
    result = generate_pack(args.company_id, args.period, "monthly", prepared_by="seed")
    pack = result["pack"]
    summary = result["summary"]
    counts = summary["counts"]
    print(f"Pack {pack.get('pack_ref')} id={pack.get('id')}")
    print(f"  completeness_score={summary['score']:.2f}%")
    print(f"  met={counts['met']} partial={counts['partial']} gap={counts['gap']} n/a={counts['not_applicable']}")
    print("  Key demo gaps / partials:")
    for it in result["checklist"]:
        if it.get("item_code") in {"CTRL-002", "CTRL-003", "DISC-006", "TP-001", "TP-002", "AL-002", "UAE-001"}:
            print(f"    {it.get('item_code')}: {it.get('status')} — {it.get('notes') or it.get('gap_description')}")
    print("Open /dashboard/ifrs15/evidence-pack")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
