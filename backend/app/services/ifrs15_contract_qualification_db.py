"""Supabase persistence for IFRS 15 Step 1 contract qualification assessments."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.app.services.supabase_client import get_supabase_client

_TABLE = "ifrs15_contract_qualifications"
_AUDIT_TABLE = "ifrs15_qualification_audit"


class ContractQualificationDB:
    def __init__(self) -> None:
        self._client = None

    @property
    def client(self):
        if self._client is None:
            self._client = get_supabase_client()
        return self._client

    def get_by_contract(self, firm_id: str, contract_id: str) -> dict[str, Any] | None:
        resp = (
            self.client.table(_TABLE)
            .select("*")
            .eq("firm_id", firm_id)
            .eq("contract_id", contract_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    def get(self, qual_id: str, firm_id: str | None = None) -> dict[str, Any] | None:
        q = self.client.table(_TABLE).select("*").eq("id", qual_id)
        if firm_id is not None:
            q = q.eq("firm_id", firm_id)
        resp = q.limit(1).execute()
        rows = resp.data or []
        return rows[0] if rows else None

    def insert(self, row: dict[str, Any]) -> dict[str, Any]:
        resp = self.client.table(_TABLE).insert(row).execute()
        data = resp.data or []
        if not data:
            raise RuntimeError("Insert returned no qualification record")
        return data[0]

    def update(self, qual_id: str, patch: dict[str, Any], firm_id: str | None = None) -> dict[str, Any]:
        patch["updated_at"] = datetime.now(timezone.utc).isoformat()
        q = self.client.table(_TABLE).update(patch).eq("id", qual_id)
        if firm_id is not None:
            q = q.eq("firm_id", firm_id)
        resp = q.execute()
        data = resp.data or []
        if not data:
            raise RuntimeError("Update returned no qualification record")
        return data[0]

    def list_by_firm(self, firm_id: str, status: str | None = None) -> list[dict[str, Any]]:
        q = self.client.table(_TABLE).select("*").eq("firm_id", firm_id)
        if status:
            q = q.eq("status", status)
        resp = q.order("created_at", desc=True).execute()
        return list(resp.data or [])

    def add_audit(
        self,
        qual_id: str,
        action: str,
        *,
        actor: str | None = None,
        old_value: dict | None = None,
        new_value: dict | None = None,
        note: str | None = None,
    ) -> None:
        self.client.table(_AUDIT_TABLE).insert(
            {
                "qualification_id": qual_id,
                "action": action,
                "actor": actor,
                "old_value": old_value,
                "new_value": new_value,
                "note": note,
            }
        ).execute()

    def list_audit(self, qual_id: str) -> list[dict[str, Any]]:
        resp = (
            self.client.table(_AUDIT_TABLE)
            .select("*")
            .eq("qualification_id", qual_id)
            .order("created_at", desc=True)
            .execute()
        )
        return list(resp.data or [])


qualification_db = ContractQualificationDB()
