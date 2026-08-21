"""Supabase persistence for IFRS 15 principal vs agent assessments."""

from __future__ import annotations

from typing import Any, Optional

from backend.app.services.supabase_client import get_supabase_client


class IFRS15PrincipalAgentDB:
    def __init__(self) -> None:
        self._client = None

    @property
    def client(self):
        if self._client is None:
            self._client = get_supabase_client()
        return self._client

    def insert(self, row: dict[str, Any]) -> dict[str, Any]:
        resp = self.client.table("ifrs15_principal_agent").insert(row).execute()
        data = resp.data or []
        if not data:
            raise RuntimeError("Insert returned no principal-agent row")
        return data[0]

    def update(self, assessment_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        resp = (
            self.client.table("ifrs15_principal_agent")
            .update(patch)
            .eq("id", assessment_id)
            .execute()
        )
        data = resp.data or []
        if not data:
            raise LookupError("Assessment not found")
        return data[0]

    def get(self, assessment_id: str) -> dict[str, Any] | None:
        resp = (
            self.client.table("ifrs15_principal_agent")
            .select("*")
            .eq("id", assessment_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    def list(
        self,
        company_id: str,
        status: Optional[str] = None,
        determination: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        q = (
            self.client.table("ifrs15_principal_agent")
            .select("*")
            .eq("company_id", company_id)
            .order("assessment_date", desc=True)
        )
        if status:
            q = q.eq("status", status)
        if determination:
            q = q.eq("final_determination", determination)
        resp = q.execute()
        return list(resp.data or [])

    def count_refs(self, company_id: str, prefix: str) -> int:
        resp = (
            self.client.table("ifrs15_principal_agent")
            .select("id")
            .eq("company_id", company_id)
            .like("assessment_ref", f"{prefix}%")
            .execute()
        )
        return len(resp.data or [])

    def add_audit(
        self,
        assessment_id: str,
        action: str,
        actor: Optional[str] = None,
        old_value: Any = None,
        new_value: Any = None,
        note: Optional[str] = None,
    ) -> dict[str, Any]:
        payload = {
            "assessment_id": assessment_id,
            "action": action,
            "actor": actor,
            "old_value": old_value,
            "new_value": new_value,
            "note": note,
        }
        resp = self.client.table("ifrs15_pa_audit").insert(payload).execute()
        data = resp.data or []
        return data[0] if data else payload

    def list_audit(self, assessment_id: str) -> list[dict[str, Any]]:
        resp = (
            self.client.table("ifrs15_pa_audit")
            .select("*")
            .eq("assessment_id", assessment_id)
            .order("created_at", desc=False)
            .execute()
        )
        return list(resp.data or [])


pa_db = IFRS15PrincipalAgentDB()
