"""Supabase persistence for IFRS 15 variable consideration assessments."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.app.services.supabase_client import get_supabase_client

_TABLE = "ifrs15_vc_assessments"
_AUDIT_TABLE = "ifrs15_vc_audit"


class VCAssessmentDB:
    def __init__(self) -> None:
        self._client = None

    @property
    def client(self):
        if self._client is None:
            self._client = get_supabase_client()
        return self._client

    def get_approved(self, firm_id: str, contract_id: str) -> dict[str, Any] | None:
        """Return the latest approved VC assessment for a contract."""
        resp = (
            self.client.table(_TABLE)
            .select("*")
            .eq("firm_id", firm_id)
            .eq("contract_id", contract_id)
            .eq("status", "approved")
            .order("approved_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    def get_latest(self, firm_id: str, contract_id: str) -> dict[str, Any] | None:
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

    def get(self, assessment_id: str, firm_id: str | None = None) -> dict[str, Any] | None:
        q = self.client.table(_TABLE).select("*").eq("id", assessment_id)
        if firm_id is not None:
            q = q.eq("firm_id", firm_id)
        resp = q.limit(1).execute()
        rows = resp.data or []
        return rows[0] if rows else None

    def insert(self, row: dict[str, Any]) -> dict[str, Any]:
        resp = self.client.table(_TABLE).insert(row).execute()
        data = resp.data or []
        if not data:
            raise RuntimeError("Insert returned no VC assessment record")
        return data[0]

    def update(self, assessment_id: str, patch: dict[str, Any], firm_id: str | None = None) -> dict[str, Any]:
        patch["updated_at"] = datetime.now(timezone.utc).isoformat()
        q = self.client.table(_TABLE).update(patch).eq("id", assessment_id)
        if firm_id is not None:
            q = q.eq("firm_id", firm_id)
        resp = q.execute()
        data = resp.data or []
        if not data:
            raise RuntimeError("Update returned no VC assessment record")
        return data[0]

    def list_by_firm(self, firm_id: str, status: str | None = None) -> list[dict[str, Any]]:
        q = self.client.table(_TABLE).select("*").eq("firm_id", firm_id)
        if status:
            q = q.eq("status", status)
        resp = q.order("created_at", desc=True).execute()
        return list(resp.data or [])

    def add_audit(
        self,
        assessment_id: str,
        action: str,
        *,
        actor: str | None = None,
        old_value: dict | None = None,
        new_value: dict | None = None,
        note: str | None = None,
    ) -> None:
        self.client.table(_AUDIT_TABLE).insert(
            {
                "assessment_id": assessment_id,
                "action": action,
                "actor": actor,
                "old_value": old_value,
                "new_value": new_value,
                "note": note,
            }
        ).execute()

    def list_audit(self, assessment_id: str) -> list[dict[str, Any]]:
        resp = (
            self.client.table(_AUDIT_TABLE)
            .select("*")
            .eq("assessment_id", assessment_id)
            .order("created_at", desc=True)
            .execute()
        )
        return list(resp.data or [])


vc_assessment_db = VCAssessmentDB()
