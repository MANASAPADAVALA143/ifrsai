"""IFRS 15 portfolio and audit log — Supabase persistence with firm_id tenancy."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from backend.app.services.supabase_client import get_supabase_client


class IFRS15DB:
    def __init__(self) -> None:
        self._client = None

    @property
    def client(self):
        if self._client is None:
            self._client = get_supabase_client()
        return self._client

    # ── Portfolio ──────────────────────────────────────────────

    def add_contract(
        self,
        firm_id: str,
        contract_name: str,
        contract_data: dict,
        summary_data: dict | None = None,
    ) -> dict:
        payload = {
            "firm_id": firm_id,
            "contract_name": contract_name,
            "contract_data": contract_data,
            "summary_data": summary_data or {},
        }
        resp = self.client.table("ifrs15_portfolios").insert(payload).execute()
        rows = resp.data or []
        if not rows:
            raise RuntimeError("Insert returned no row")
        return rows[0]

    def get_portfolio(self, firm_id: str) -> list[dict]:
        resp = (
            self.client.table("ifrs15_portfolios")
            .select("*")
            .eq("firm_id", firm_id)
            .order("created_at", desc=True)
            .execute()
        )
        return list(resp.data or [])

    def get_contract(self, firm_id: str, contract_id: str) -> dict | None:
        resp = (
            self.client.table("ifrs15_portfolios")
            .select("*")
            .eq("firm_id", firm_id)
            .eq("id", contract_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    def find_portfolio_by_business_contract_id(
        self, firm_id: str, business_contract_id: str
    ) -> dict | None:
        for row in self.get_portfolio(firm_id):
            data = row.get("contract_data") or {}
            if str(data.get("contract_id", "")) == business_contract_id:
                return row
        return None

    def update_contract(
        self,
        firm_id: str,
        contract_id: str,
        contract_data: dict | None = None,
        summary_data: dict | None = None,
        contract_name: str | None = None,
    ) -> dict:
        patch: Dict[str, Any] = {}
        if contract_data is not None:
            patch["contract_data"] = contract_data
        if summary_data is not None:
            patch["summary_data"] = summary_data
        if contract_name is not None:
            patch["contract_name"] = contract_name
        if not patch:
            row = self.get_contract(firm_id, contract_id)
            if not row:
                raise LookupError("Contract not found")
            return row

        resp = (
            self.client.table("ifrs15_portfolios")
            .update(patch)
            .eq("firm_id", firm_id)
            .eq("id", contract_id)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            raise LookupError("Contract not found or not updated")
        return rows[0]

    def delete_contract(self, firm_id: str, contract_id: str) -> bool:
        resp = (
            self.client.table("ifrs15_portfolios")
            .delete()
            .eq("firm_id", firm_id)
            .eq("id", contract_id)
            .execute()
        )
        return bool(resp.data)

    def delete_contract_by_business_id(self, firm_id: str, business_contract_id: str) -> bool:
        row = self.find_portfolio_by_business_contract_id(firm_id, business_contract_id)
        if not row:
            return False
        return self.delete_contract(firm_id, str(row["id"]))

    def get_portfolio_summary(self, firm_id: str) -> dict:
        rows = self.get_portfolio(firm_id)
        total_value = 0.0
        scores: List[float] = []
        high_risk_count = 0

        for row in rows:
            summary = row.get("summary_data") or {}
            contract = row.get("contract_data") or {}
            total_value += float(
                summary.get("total_tp")
                or contract.get("total_tp")
                or contract.get("arr")
                or 0
            )
            score = summary.get("disclosure_score")
            if score is not None:
                try:
                    scores.append(float(score))
                except (TypeError, ValueError):
                    pass
            risk = str(summary.get("risk") or "").upper()
            if risk == "HIGH":
                high_risk_count += 1

        avg_score = sum(scores) / len(scores) if scores else 0.0
        return {
            "total_contracts": len(rows),
            "total_value": round(total_value, 2),
            "avg_disclosure_score": round(avg_score, 2),
            "high_risk_count": high_risk_count,
        }

    # ── Audit log ──────────────────────────────────────────────

    def log_action(
        self,
        firm_id: str,
        action: str,
        details: dict | None = None,
        contract_id: str | None = None,
        user_id: str | None = None,
    ) -> dict:
        try:
            payload = {
                "firm_id": firm_id,
                "action": action,
                "details": details or {},
                "user_id": user_id,
            }
            if contract_id:
                payload["contract_id"] = contract_id
            resp = self.client.table("ifrs15_audit_log").insert(payload).execute()
            rows = resp.data or []
            return rows[0] if rows else {}
        except Exception as exc:
            print(f"WARNING: IFRS15 audit log write failed: {exc}")
            return {}

    def get_audit_log(
        self,
        firm_id: str,
        limit: int = 100,
        contract_id: str | None = None,
        business_contract_id: str | None = None,
    ) -> list[dict]:
        q = (
            self.client.table("ifrs15_audit_log")
            .select("*")
            .eq("firm_id", firm_id)
            .order("created_at", desc=True)
            .limit(limit)
        )
        if contract_id:
            q = q.eq("contract_id", contract_id)
        resp = q.execute()
        rows = list(resp.data or [])
        if business_contract_id:
            rows = [
                r
                for r in rows
                if str((r.get("details") or {}).get("contract_id", "")) == business_contract_id
            ]
        return rows

    def update_audit_log_entry(self, firm_id: str, log_id: str, details: dict) -> dict:
        resp = (
            self.client.table("ifrs15_audit_log")
            .update({"details": details})
            .eq("firm_id", firm_id)
            .eq("id", log_id)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            raise LookupError("Audit log entry not found")
        return rows[0]

    def sign_off(
        self,
        firm_id: str,
        contract_id: str,
        user_id: str,
        sign_off_note: str,
    ) -> dict:
        return self.log_action(
            firm_id=firm_id,
            action="sign-off",
            details={"note": sign_off_note, "contract_id": contract_id},
            contract_id=None,
            user_id=user_id,
        )


ifrs15_db = IFRS15DB()
