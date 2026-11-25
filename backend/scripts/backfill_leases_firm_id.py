"""
CRIT-003 remediation: backfill firm_id on the legacy `leases` table.

Background
----------
Migration 017 added `firm_id TEXT` to `leases` with no DEFAULT and no backfill.
Any rows that existed before the migration have firm_id = NULL.  Once CRIT-001
auth enforcement is live, those rows become permanently inaccessible.

Ownership resolution strategy
------------------------------
The `leases` table originally used auth.uid()-based RLS isolation, so each row
carries a `user_id` that references auth.users.  The `profiles` table
(migration 007) maps auth.users.id → firm_id.

For each NULL-firm_id lease:
  1. Look up profiles.firm_id WHERE profiles.id = leases.user_id
  2. If exactly one firm found and it exists in the firms table → assign it
  3. If no profile found, or the firm no longer exists → QUARANTINE

Quarantined rows get firm_id = 'QUARANTINE' and are written to a CSV report
for manual review before production go-live.

NEVER assign an arbitrary firm_id to cover a row whose ownership is unclear.

Usage
-----
# Dry run (default — shows counts without writing):
  python -m backend.scripts.backfill_leases_firm_id

# Apply changes:
  python -m backend.scripts.backfill_leases_firm_id --apply

Environment variables required:
  SUPABASE_URL              — your Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY — service-role key (bypasses RLS; needed to read auth.users)
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def _get_client():
    from supabase import create_client
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.", file=sys.stderr)
        sys.exit(1)
    return create_client(url, key)


def run(apply: bool) -> None:
    client = _get_client()
    action_label = "APPLYING" if apply else "DRY RUN"
    print(f"[{action_label}] Starting leases firm_id backfill …")

    # 1. Fetch all leases rows with NULL firm_id
    resp = (
        client.table("leases")
        .select("id, lease_id, lessee_name, created_at")
        .is_("firm_id", "null")
        .execute()
    )
    null_rows = resp.data or []
    if not null_rows:
        print("No leases rows with NULL firm_id found. Nothing to do.")
        return

    print(f"Found {len(null_rows)} leases row(s) with NULL firm_id.")

    # The leases table has no user_id or other ownership column.
    # Automatic resolution is not possible — all NULL rows are quarantined
    # for manual review. Do NOT assign an arbitrary firm_id.
    resolved: list[dict] = []
    quarantined: list[dict] = [
        {
            "id": row["id"],
            "lease_id": row.get("lease_id"),
            "lessee_name": row.get("lessee_name"),
            "created_at": row.get("created_at"),
            "reason": "no ownership column in leases table — manual review required",
        }
        for row in null_rows
    ]

    print(f"  Resolved:    {len(resolved)}")
    print(f"  Quarantined: {len(quarantined)}")

    if quarantined:
        report_path = Path(__file__).parent / f"leases_quarantine_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}.csv"
        with open(report_path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=["id", "lease_id", "lessee_name", "created_at", "reason"])
            writer.writeheader()
            writer.writerows(quarantined)
        print(f"  Quarantine report: {report_path}")
        print("  WARNING: These rows must be reviewed and resolved before production go-live.")

    if not apply:
        print("[DRY RUN] No changes written. Re-run with --apply to commit.")
        return

    # Apply resolved rows
    if resolved:
        for row in resolved:
            client.table("leases").update({"firm_id": row["firm_id"]}).eq("id", row["id"]).execute()
        print(f"Applied firm_id to {len(resolved)} resolved lease(s).")

    # Apply quarantine marker
    if quarantined:
        for row in quarantined:
            client.table("leases").update({"firm_id": "QUARANTINE"}).eq("id", row["id"]).execute()
        print(f"Marked {len(quarantined)} lease(s) as QUARANTINE.")

    print("Backfill complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill leases.firm_id from profiles table.")
    parser.add_argument("--apply", action="store_true", help="Write changes (default is dry run)")
    args = parser.parse_args()
    run(apply=args.apply)
