"""Supabase persistence for IFRS 15 billing-to-GL reconciliation."""

from __future__ import annotations

from typing import Any, Optional

from backend.app.services.supabase_client import get_supabase_client


class IFRS15BillingReconDB:
    def __init__(self) -> None:
        self._client = None

    @property
    def client(self):
        if self._client is None:
            self._client = get_supabase_client()
        return self._client

    def upsert_billing(self, row: dict[str, Any]) -> dict[str, Any]:
        resp = (
            self.client.table("ifrs15_billing_transactions")
            .upsert(row, on_conflict="company_id,transaction_ref")
            .execute()
        )
        data = resp.data or []
        return data[0] if data else row

    def upsert_gl(self, row: dict[str, Any]) -> dict[str, Any]:
        existing = (
            self.client.table("ifrs15_gl_postings")
            .select("id")
            .eq("company_id", row["company_id"])
            .eq("account_code", row["account_code"])
            .eq("journal_ref", row.get("journal_ref") or "")
            .limit(1)
            .execute()
        )
        found = existing.data or []
        if found:
            resp = (
                self.client.table("ifrs15_gl_postings")
                .update(row)
                .eq("id", found[0]["id"])
                .execute()
            )
        else:
            payload = dict(row)
            payload["journal_ref"] = payload.get("journal_ref") or ""
            resp = self.client.table("ifrs15_gl_postings").insert(payload).execute()
        data = resp.data or []
        return data[0] if data else row

    def list_billing(
        self,
        company_id: str,
        period: str,
        contract_id: Optional[str] = None,
        contract_type: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        q = (
            self.client.table("ifrs15_billing_transactions")
            .select("*")
            .eq("company_id", company_id)
            .eq("period", period)
        )
        if contract_id:
            q = q.eq("contract_id", contract_id)
        if contract_type:
            q = q.eq("contract_type", contract_type)
        resp = q.execute()
        return list(resp.data or [])

    def list_gl(
        self,
        company_id: str,
        period: str,
        contract_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        q = (
            self.client.table("ifrs15_gl_postings")
            .select("*")
            .eq("company_id", company_id)
            .eq("period", period)
        )
        if contract_id:
            q = q.eq("contract_id", contract_id)
        resp = q.execute()
        return list(resp.data or [])

    def upsert_result(self, row: dict[str, Any]) -> dict[str, Any]:
        company_id = row["company_id"]
        period = row["period"]
        contract_id = row.get("contract_id") or ""
        contract_type = row["contract_type"]
        q = (
            self.client.table("ifrs15_recon_results")
            .select("id")
            .eq("company_id", company_id)
            .eq("period", period)
            .eq("contract_type", contract_type)
        )
        if contract_id:
            q = q.eq("contract_id", contract_id)
        else:
            q = q.is_("contract_id", "null")
        existing = q.limit(1).execute()
        found = existing.data or []
        payload = dict(row)
        if not payload.get("contract_id"):
            payload["contract_id"] = None
        if found:
            resp = (
                self.client.table("ifrs15_recon_results")
                .update(payload)
                .eq("id", found[0]["id"])
                .execute()
            )
        else:
            resp = self.client.table("ifrs15_recon_results").insert(payload).execute()
        data = resp.data or []
        return data[0] if data else payload

    def list_results(
        self,
        company_id: str,
        period: Optional[str] = None,
        contract_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        q = (
            self.client.table("ifrs15_recon_results")
            .select("*")
            .eq("company_id", company_id)
            .order("recon_run_at", desc=True)
        )
        if period:
            q = q.eq("period", period)
        if contract_id:
            q = q.eq("contract_id", contract_id)
        resp = q.execute()
        return list(resp.data or [])

    def get_result(self, result_id: str) -> dict[str, Any] | None:
        resp = (
            self.client.table("ifrs15_recon_results")
            .select("*")
            .eq("id", result_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    def mark_reviewed(self, result_id: str, reviewed_by: str, reviewed_at: str) -> dict[str, Any]:
        resp = (
            self.client.table("ifrs15_recon_results")
            .update({"reviewed_by": reviewed_by, "reviewed_at": reviewed_at})
            .eq("id", result_id)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            raise LookupError("Recon result not found")
        return rows[0]


billing_recon_db = IFRS15BillingReconDB()
