"""Supabase persistence for IFRS 15 contract modification workflow."""

from __future__ import annotations

from typing import Any, Optional

from backend.app.services.supabase_client import get_supabase_client


class IFRS15ModificationsDB:
    def __init__(self) -> None:
        self._client = None

    @property
    def client(self):
        if self._client is None:
            self._client = get_supabase_client()
        return self._client

    def insert_mod(self, row: dict[str, Any]) -> dict[str, Any]:
        resp = self.client.table("ifrs15_contract_modifications").insert(row).execute()
        data = resp.data or []
        if not data:
            raise RuntimeError("Insert returned no modification row")
        return data[0]

    def update_mod(self, mod_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        resp = (
            self.client.table("ifrs15_contract_modifications")
            .update(patch)
            .eq("id", mod_id)
            .execute()
        )
        data = resp.data or []
        if not data:
            raise LookupError("Modification not found")
        return data[0]

    def get_mod(self, mod_id: str) -> dict[str, Any] | None:
        resp = (
            self.client.table("ifrs15_contract_modifications")
            .select("*")
            .eq("id", mod_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    def list_mods(
        self,
        company_id: str,
        contract_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        q = (
            self.client.table("ifrs15_contract_modifications")
            .select("*")
            .eq("company_id", company_id)
            .order("modification_date", desc=True)
        )
        if contract_id:
            q = q.eq("contract_id", contract_id)
        if status:
            q = q.eq("status", status)
        resp = q.execute()
        return list(resp.data or [])

    def count_refs(self, company_id: str, year: int) -> int:
        prefix = f"MOD-{year}-"
        resp = (
            self.client.table("ifrs15_contract_modifications")
            .select("id")
            .eq("company_id", company_id)
            .like("modification_ref", f"{prefix}%")
            .execute()
        )
        return len(resp.data or [])

    def count_posted_je(self, company_id: str) -> int:
        resp = (
            self.client.table("ifrs15_contract_modifications")
            .select("id")
            .eq("company_id", company_id)
            .eq("je_posted", True)
            .execute()
        )
        return len(resp.data or [])

    def add_audit(
        self,
        modification_id: str,
        action: str,
        actor: Optional[str] = None,
        old_value: Any = None,
        new_value: Any = None,
        note: Optional[str] = None,
    ) -> dict[str, Any]:
        payload = {
            "modification_id": modification_id,
            "action": action,
            "actor": actor,
            "old_value": old_value,
            "new_value": new_value,
            "note": note,
        }
        resp = self.client.table("ifrs15_modification_audit").insert(payload).execute()
        data = resp.data or []
        return data[0] if data else payload

    def list_audit(self, modification_id: str) -> list[dict[str, Any]]:
        resp = (
            self.client.table("ifrs15_modification_audit")
            .select("*")
            .eq("modification_id", modification_id)
            .order("created_at", desc=False)
            .execute()
        )
        return list(resp.data or [])


mods_db = IFRS15ModificationsDB()
