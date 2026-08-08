"""Supabase persistence for IFRS 15 §120 RPO dashboard."""

from __future__ import annotations

from typing import Any, Optional

from backend.app.services.supabase_client import get_supabase_client


class IFRS15RpoDashboardDB:
    def __init__(self) -> None:
        self._client = None

    @property
    def client(self):
        if self._client is None:
            self._client = get_supabase_client()
        return self._client

    def upsert_source_contract(self, row: dict[str, Any]) -> dict[str, Any]:
        resp = (
            self.client.table("ifrs15_rpo_contracts")
            .upsert(row, on_conflict="company_id,contract_ref")
            .execute()
        )
        data = resp.data or []
        return data[0] if data else row

    def list_source_contracts(self, company_id: str) -> list[dict[str, Any]]:
        resp = (
            self.client.table("ifrs15_rpo_contracts")
            .select("*")
            .eq("company_id", company_id)
            .execute()
        )
        return list(resp.data or [])

    def get_snapshot_by_period(self, company_id: str, period: str) -> dict[str, Any] | None:
        resp = (
            self.client.table("ifrs15_rpo_snapshots")
            .select("*")
            .eq("company_id", company_id)
            .eq("period", period)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    def insert_snapshot(self, row: dict[str, Any]) -> dict[str, Any]:
        resp = self.client.table("ifrs15_rpo_snapshots").insert(row).execute()
        data = resp.data or []
        if not data:
            raise RuntimeError("Insert returned no RPO snapshot")
        return data[0]

    def update_snapshot(self, snapshot_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        resp = (
            self.client.table("ifrs15_rpo_snapshots")
            .update(patch)
            .eq("id", snapshot_id)
            .execute()
        )
        data = resp.data or []
        if not data:
            raise LookupError("Snapshot not found")
        return data[0]

    def delete_details(self, snapshot_id: str) -> None:
        self.client.table("ifrs15_rpo_contract_detail").delete().eq("snapshot_id", snapshot_id).execute()

    def delete_snapshot(self, snapshot_id: str) -> None:
        self.delete_details(snapshot_id)
        self.client.table("ifrs15_rpo_snapshots").delete().eq("id", snapshot_id).execute()

    def insert_details(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not rows:
            return []
        resp = self.client.table("ifrs15_rpo_contract_detail").insert(rows).execute()
        return list(resp.data or [])

    def get_snapshot(self, snapshot_id: str) -> dict[str, Any] | None:
        resp = (
            self.client.table("ifrs15_rpo_snapshots")
            .select("*")
            .eq("id", snapshot_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    def list_snapshots(self, company_id: str, last_n: int = 6) -> list[dict[str, Any]]:
        resp = (
            self.client.table("ifrs15_rpo_snapshots")
            .select("*")
            .eq("company_id", company_id)
            .order("period", desc=True)
            .limit(max(1, int(last_n or 6)))
            .execute()
        )
        return list(resp.data or [])

    def latest_snapshot(self, company_id: str) -> dict[str, Any] | None:
        resp = (
            self.client.table("ifrs15_rpo_snapshots")
            .select("*")
            .eq("company_id", company_id)
            .order("period", desc=True)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    def list_details(self, snapshot_id: str) -> list[dict[str, Any]]:
        resp = (
            self.client.table("ifrs15_rpo_contract_detail")
            .select("*")
            .eq("snapshot_id", snapshot_id)
            .order("contract_ref")
            .execute()
        )
        return list(resp.data or [])

    def list_details_for_snapshots(self, snapshot_ids: list[str]) -> list[dict[str, Any]]:
        if not snapshot_ids:
            return []
        resp = (
            self.client.table("ifrs15_rpo_contract_detail")
            .select("*")
            .in_("snapshot_id", snapshot_ids)
            .execute()
        )
        return list(resp.data or [])


rpo_dash_db = IFRS15RpoDashboardDB()
