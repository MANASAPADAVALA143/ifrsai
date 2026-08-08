"""Supabase persistence for IFRS 15 audit evidence packs."""

from __future__ import annotations

from typing import Any, Optional

from backend.app.services.supabase_client import get_supabase_client

_CACHE_HINT = (
    "ifrs15_evidence_packs is not in the PostgREST schema cache (PGRST205). "
    "In the same Supabase project as SUPABASE_URL (udjqtsaggtwwwdfhcnao) run "
    "supabase/migrations/068_ifrs15_api_grants.sql, wait a few seconds, retry."
)


def _reraise_schema_cache(exc: BaseException, table: str = "ifrs15_evidence_packs") -> None:
    text = str(exc)
    if "PGRST205" in text or "schema cache" in text:
        raise RuntimeError(_CACHE_HINT.replace("ifrs15_evidence_packs", table)) from exc
    raise exc


class IFRS15EvidencePackDB:
    def __init__(self) -> None:
        self._client = None

    @property
    def client(self):
        if self._client is None:
            self._client = get_supabase_client()
        return self._client

    def get_by_scope(self, company_id: str, period: str, period_type: str) -> dict[str, Any] | None:
        try:
            resp = (
                self.client.table("ifrs15_evidence_packs")
                .select("*")
                .eq("company_id", company_id)
                .eq("period", period)
                .eq("period_type", period_type)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            _reraise_schema_cache(exc)
        rows = resp.data or []
        return rows[0] if rows else None

    def get(self, pack_id: str) -> dict[str, Any] | None:
        resp = (
            self.client.table("ifrs15_evidence_packs")
            .select("*")
            .eq("id", pack_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    def list_packs(self, company_id: str) -> list[dict[str, Any]]:
        resp = (
            self.client.table("ifrs15_evidence_packs")
            .select("*")
            .eq("company_id", company_id)
            .order("created_at", desc=True)
            .execute()
        )
        return list(resp.data or [])

    def insert_pack(self, row: dict[str, Any]) -> dict[str, Any]:
        resp = self.client.table("ifrs15_evidence_packs").insert(row).execute()
        data = resp.data or []
        if not data:
            raise RuntimeError("Insert returned no evidence pack")
        return data[0]

    def update_pack(self, pack_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        resp = (
            self.client.table("ifrs15_evidence_packs")
            .update(patch)
            .eq("id", pack_id)
            .execute()
        )
        data = resp.data or []
        if not data:
            raise LookupError("Evidence pack not found")
        return data[0]

    def delete_checklist(self, pack_id: str) -> None:
        self.client.table("ifrs15_checklist_items").delete().eq("pack_id", pack_id).execute()

    def insert_checklist(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not rows:
            return []
        resp = self.client.table("ifrs15_checklist_items").insert(rows).execute()
        return list(resp.data or [])

    def list_checklist(self, pack_id: str) -> list[dict[str, Any]]:
        resp = (
            self.client.table("ifrs15_checklist_items")
            .select("*")
            .eq("pack_id", pack_id)
            .order("item_code")
            .execute()
        )
        return list(resp.data or [])


evidence_pack_db = IFRS15EvidencePackDB()
