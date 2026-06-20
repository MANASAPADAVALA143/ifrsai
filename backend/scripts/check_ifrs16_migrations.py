"""
Verify IFRS 16 Supabase migrations (003 portfolio + 004 comparative).
Run from repo root: python backend/scripts/check_ifrs16_migrations.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")
load_dotenv(ROOT / "frontend" / ".env.local")

MIGRATION_003_TABLES = ("ifrs16_leases", "ifrs16_lease_modifications", "ifrs16_audit_log")
MIGRATION_004_TABLES = ("ifrs16_firm_settings", "ifrs16_period_snapshots", "ifrs16_lease_period_snapshots")
MIGRATION_004_VIEW = "ifrs16_comparative_view"


def _check_table(client, name: str) -> bool:
    try:
        client.table(name).select("id").limit(1).execute()
        print(f"  [OK] {name}")
        return True
    except Exception as exc:
        msg = str(exc)
        if "PGRST205" in msg or "Could not find" in msg:
            print(f"  [MISSING] {name}")
        else:
            print(f"  [ERROR] {name}: {exc}")
        return False


def main() -> int:
    try:
        from backend.app.services.supabase_client import is_supabase_configured, get_supabase_client
    except Exception as exc:
        print(f"[FAIL] import: {exc}")
        return 1

    if not is_supabase_configured():
        print("[SKIP] Supabase not configured — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY")
        return 0

    client = get_supabase_client()
    print("Migration 003 (portfolio):")
    ok3 = all(_check_table(client, t) for t in MIGRATION_003_TABLES)

    print("Migration 004 (comparative):")
    ok4_tables = all(_check_table(client, t) for t in MIGRATION_004_TABLES)
    ok4_view = _check_table(client, MIGRATION_004_VIEW)

    if ok3 and ok4_tables and ok4_view:
        print("\nAll IFRS 16 migrations are applied.")
        return 0

    print("\nAction required — run in Supabase SQL Editor (in order):")
    if not ok3:
        print(f"  1. backend/migrations/003_ifrs16_persistence.sql")
    if not ok4_tables or not ok4_view:
        print(f"  2. backend/migrations/004_ifrs16_period_snapshots.sql")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
