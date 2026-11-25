"""Supabase persistence for IFRS 15 staged journal approval workflow."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from backend.app.services.supabase_client import get_supabase_client

_TABLE = "ifrs15_staged_journals"
_AUDIT_TABLE = "ifrs15_journal_audit"

VALID_STATUSES = {"draft", "pending_review", "approved", "posted", "failed", "reversed"}


class StagedJournalsDB:
    def __init__(self) -> None:
        self._client = None

    @property
    def client(self):
        if self._client is None:
            self._client = get_supabase_client()
        return self._client

    def get(self, journal_id: str, firm_id: str | None = None) -> dict[str, Any] | None:
        q = self.client.table(_TABLE).select("*").eq("id", journal_id)
        if firm_id is not None:
            q = q.eq("firm_id", firm_id)
        resp = q.limit(1).execute()
        rows = resp.data or []
        return rows[0] if rows else None

    def insert(self, row: dict[str, Any]) -> dict[str, Any]:
        resp = self.client.table(_TABLE).insert(row).execute()
        data = resp.data or []
        if not data:
            raise RuntimeError("Insert returned no journal record")
        return data[0]

    def update(self, journal_id: str, patch: dict[str, Any], firm_id: str | None = None) -> dict[str, Any]:
        patch["updated_at"] = datetime.now(timezone.utc).isoformat()
        q = self.client.table(_TABLE).update(patch).eq("id", journal_id)
        if firm_id is not None:
            q = q.eq("firm_id", firm_id)
        resp = q.execute()
        data = resp.data or []
        if not data:
            raise RuntimeError("Update returned no journal record")
        return data[0]

    def list_by_firm(
        self,
        firm_id: str,
        status: str | None = None,
        source_type: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        q = self.client.table(_TABLE).select("*").eq("firm_id", firm_id)
        if status:
            q = q.eq("status", status)
        if source_type:
            q = q.eq("source_type", source_type)
        resp = q.order("je_date", desc=True).limit(limit).execute()
        return list(resp.data or [])

    def claim_for_posting(self, journal_id: str, firm_id: str) -> dict[str, Any] | None:
        """Atomically transition approved → posting via CAS. Returns row or None if already claimed."""
        patch = {"status": "posting", "updated_at": datetime.now(timezone.utc).isoformat()}
        resp = (
            self.client.table(_TABLE)
            .update(patch)
            .eq("id", journal_id)
            .eq("firm_id", firm_id)
            .eq("status", "approved")
            .execute()
        )
        data = resp.data or []
        return data[0] if data else None

    def add_audit(
        self,
        journal_id: str,
        action: str,
        *,
        actor: str | None = None,
        old_status: str | None = None,
        new_status: str | None = None,
        note: str | None = None,
    ) -> None:
        self.client.table(_AUDIT_TABLE).insert(
            {
                "journal_id": journal_id,
                "action": action,
                "actor": actor,
                "old_status": old_status,
                "new_status": new_status,
                "note": note,
            }
        ).execute()

    def list_audit(self, journal_id: str) -> list[dict[str, Any]]:
        resp = (
            self.client.table(_AUDIT_TABLE)
            .select("*")
            .eq("journal_id", journal_id)
            .order("created_at", desc=True)
            .execute()
        )
        return list(resp.data or [])


def compute_totals(lines: list[dict]) -> tuple[Decimal, Decimal]:
    """Return (total_debit, total_credit) from a lines list."""
    total_dr = Decimal("0")
    total_cr = Decimal("0")
    for line in lines:
        total_dr += Decimal(str(line.get("debit") or 0))
        total_cr += Decimal(str(line.get("credit") or 0))
    q = Decimal("0.0001")
    return total_dr.quantize(q, rounding=ROUND_HALF_UP), total_cr.quantize(q, rounding=ROUND_HALF_UP)


staged_journals_db = StagedJournalsDB()
