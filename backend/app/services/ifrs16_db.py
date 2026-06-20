"""IFRS 16 lease portfolio and audit log — Supabase persistence with firm_id tenancy."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from backend.app.services.supabase_client import get_supabase_client


def _summary_from_lease_data(lease_data: Dict[str, Any]) -> Dict[str, Any]:
    results = lease_data.get("results") if isinstance(lease_data.get("results"), dict) else {}
    dates = lease_data.get("dates") if isinstance(lease_data.get("dates"), dict) else {}
    payments = lease_data.get("payments") if isinstance(lease_data.get("payments"), dict) else {}
    end_date = lease_data.get("end_date") or dates.get("end") or ""
    status = str(lease_data.get("status") or "Active").lower()
    return {
        "liability": float(lease_data.get("liability") or results.get("lease_liability") or 0),
        "rou": float(lease_data.get("rou") or results.get("rou_asset") or 0),
        "monthly_payment": float(
            lease_data.get("monthly_payment") or payments.get("monthly") or 0
        ),
        "currency": str(lease_data.get("currency") or payments.get("currency") or "AED"),
        "end_date": str(end_date),
        "status": status,
        "entity_name": lease_data.get("legal_entity") or lease_data.get("entity_name") or "",
        "last_calculated_at": lease_data.get("calculated_at") or lease_data.get("last_calculated_at"),
    }


def _lease_name_from_data(lease_data: Dict[str, Any], lease_id: str) -> str:
    return str(
        lease_data.get("title")
        or lease_data.get("asset")
        or lease_data.get("lease_name")
        or lease_id
    )


class IFRS16DB:
    def __init__(self) -> None:
        self._client = None

    @property
    def client(self):
        if self._client is None:
            self._client = get_supabase_client()
        return self._client

    def find_by_business_lease_id(self, firm_id: str, lease_id: str) -> Optional[dict]:
        resp = (
            self.client.table("ifrs16_leases")
            .select("*")
            .eq("firm_id", firm_id)
            .eq("lease_id", lease_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    def upsert_lease(
        self,
        firm_id: str,
        lease_data: dict,
        user_id: Optional[str] = None,
    ) -> dict:
        business_id = str(lease_data.get("id") or lease_data.get("lease_id") or "").strip()
        if not business_id:
            raise ValueError("lease_data must include id or lease_id")

        payload = {
            "firm_id": firm_id,
            "lease_id": business_id,
            "lease_name": _lease_name_from_data(lease_data, business_id),
            "lease_data": lease_data,
            "summary_data": _summary_from_lease_data(lease_data),
            "status": str(lease_data.get("status") or "active").lower(),
            "user_id": user_id,
        }

        existing = self.find_by_business_lease_id(firm_id, business_id)
        if existing:
            resp = (
                self.client.table("ifrs16_leases")
                .update(payload)
                .eq("firm_id", firm_id)
                .eq("lease_id", business_id)
                .execute()
            )
            rows = resp.data or []
            row = rows[0] if rows else {**existing, **payload}
            self.log_action(firm_id, "updated", business_id, user_id, {"lease_id": business_id})
            return row

        resp = self.client.table("ifrs16_leases").insert(payload).execute()
        rows = resp.data or []
        if not rows:
            raise RuntimeError("Insert returned no row")
        self.log_action(firm_id, "created", business_id, user_id, {"lease_id": business_id})
        return rows[0]

    def get_portfolio(
        self,
        firm_id: str,
        status: Optional[str] = None,
        limit: int = 500,
        offset: int = 0,
    ) -> List[dict]:
        q = (
            self.client.table("ifrs16_leases")
            .select("*")
            .eq("firm_id", firm_id)
            .neq("status", "deleted")
            .order("created_at", desc=True)
            .limit(limit)
            .offset(offset)
        )
        if status:
            q = q.eq("status", status.lower())
        resp = q.execute()
        return list(resp.data or [])

    def get_lease(self, firm_id: str, lease_id: str) -> Optional[dict]:
        return self.find_by_business_lease_id(firm_id, lease_id)

    def save_calculation(
        self,
        firm_id: str,
        lease_id: str,
        calc_payload: dict,
        user_id: Optional[str] = None,
    ) -> dict:
        row = self.find_by_business_lease_id(firm_id, lease_id)
        if not row:
            raise LookupError("Lease not found")

        lease_data = dict(row.get("lease_data") or {})
        results = dict(calc_payload.get("results") or calc_payload.get("summary") or {})
        if results:
            lease_data["results"] = results
            lease_data["liability"] = float(results.get("lease_liability") or lease_data.get("liability") or 0)
            lease_data["rou"] = float(results.get("rou_asset") or lease_data.get("rou") or 0)
        if calc_payload.get("amortization_schedule") is not None:
            if isinstance(lease_data.get("results"), dict):
                lease_data["results"]["amortization_schedule"] = calc_payload["amortization_schedule"]
        if calc_payload.get("journal_entries") is not None:
            if isinstance(lease_data.get("results"), dict):
                lease_data["results"]["journal_entries"] = calc_payload["journal_entries"]
        if calc_payload.get("disclosure_notes") is not None:
            if isinstance(lease_data.get("results"), dict):
                lease_data["results"]["disclosure_notes"] = calc_payload["disclosure_notes"]
            lease_data["disclosure_generated"] = True

        lease_data["calculated_at"] = datetime.utcnow().isoformat() + "Z"
        lease_data["last_calculated_at"] = lease_data["calculated_at"]
        if calc_payload.get("excel_file_id"):
            lease_data["excel_file_id"] = calc_payload["excel_file_id"]

        return self.upsert_lease(firm_id, lease_data, user_id=user_id)

    def delete_lease(self, firm_id: str, lease_id: str, user_id: Optional[str] = None) -> bool:
        row = self.find_by_business_lease_id(firm_id, lease_id)
        if not row:
            return False
        lease_data = dict(row.get("lease_data") or {})
        lease_data["status"] = "Deleted"
        self.upsert_lease(firm_id, lease_data, user_id=user_id)
        resp = (
            self.client.table("ifrs16_leases")
            .update({"status": "deleted"})
            .eq("firm_id", firm_id)
            .eq("lease_id", lease_id)
            .execute()
        )
        self.log_action(firm_id, "deleted", lease_id, user_id, {"lease_id": lease_id})
        return bool(resp.data)

    def add_modification(
        self,
        firm_id: str,
        lease_id: str,
        modification: dict,
        user_id: Optional[str] = None,
    ) -> dict:
        row = self.find_by_business_lease_id(firm_id, lease_id)
        if not row:
            raise LookupError("Lease not found")

        payload = {
            "firm_id": firm_id,
            "lease_row_id": row.get("id"),
            "business_lease_id": lease_id,
            "modification_date": modification.get("modification_date"),
            "modification_type": modification.get("modification_type"),
            "modification_reason": modification.get("modification_reason"),
            "before_state": {
                "liability": modification.get("before_liability"),
                "rou_asset": modification.get("before_rou_asset"),
                "term_months": modification.get("before_term_months"),
                "payment": modification.get("before_payment"),
                "ibr": modification.get("before_ibr"),
            },
            "after_state": {
                "liability": modification.get("after_liability"),
                "rou_asset": modification.get("after_rou_asset"),
                "term_months": modification.get("after_term_months"),
                "payment": modification.get("after_payment"),
                "ibr": modification.get("after_ibr"),
            },
            "modification_journal": modification.get("modification_journal"),
            "gain_loss_amount": modification.get("gain_loss_amount", 0),
            "gain_loss_type": modification.get("gain_loss_type"),
            "created_by": modification.get("changed_by") or user_id,
        }
        resp = self.client.table("ifrs16_lease_modifications").insert(payload).execute()
        mod_rows = resp.data or []
        mod_row = mod_rows[0] if mod_rows else payload

        lease_data = dict(row.get("lease_data") or {})
        mods = list(lease_data.get("modifications") or [])
        mods.append(modification)
        lease_data["modifications"] = mods
        lease_data["status"] = modification.get("new_status") or "Modified"
        self.upsert_lease(firm_id, lease_data, user_id=user_id)
        self.log_action(firm_id, "modified", lease_id, user_id, modification)
        return mod_row

    def get_modifications(self, firm_id: str, lease_id: str) -> List[dict]:
        resp = (
            self.client.table("ifrs16_lease_modifications")
            .select("*")
            .eq("firm_id", firm_id)
            .eq("business_lease_id", lease_id)
            .order("created_at", desc=False)
            .execute()
        )
        return list(resp.data or [])

    def get_portfolio_summary(self, firm_id: str) -> Dict[str, Any]:
        rows = self.get_portfolio(firm_id)
        total_liability = 0.0
        total_rou = 0.0
        active = 0
        expiring_90 = 0
        entities: Dict[str, Dict[str, Any]] = {}
        today = datetime.utcnow().date()

        for row in rows:
            summary = row.get("summary_data") or _summary_from_lease_data(row.get("lease_data") or {})
            status = str(summary.get("status") or "").lower()
            if status in ("deleted", "terminated"):
                continue
            active += 1
            liability = float(summary.get("liability") or 0)
            rou = float(summary.get("rou") or 0)
            total_liability += liability
            total_rou += rou

            end_raw = str(summary.get("end_date") or "")[:10]
            if end_raw:
                try:
                    end_d = datetime.strptime(end_raw, "%Y-%m-%d").date()
                    days = (end_d - today).days
                    if 0 <= days <= 90:
                        expiring_90 += 1
                except ValueError:
                    pass

            entity = str(summary.get("entity_name") or "default")
            bucket = entities.setdefault(
                entity,
                {
                    "entity_name": entity,
                    "active_leases": 0,
                    "total_lease_liability": 0.0,
                    "total_rou_asset": 0.0,
                    "expiring_90_days": 0,
                },
            )
            bucket["active_leases"] += 1
            bucket["total_lease_liability"] += liability
            bucket["total_rou_asset"] += rou

        return {
            "entities": list(entities.values()),
            "total_lease_liability": round(total_liability, 2),
            "total_rou_asset": round(total_rou, 2),
            "active_leases": active,
            "expiring_90_days": expiring_90,
            "total_leases": len(rows),
        }

    def log_action(
        self,
        firm_id: str,
        action: str,
        lease_id: Optional[str] = None,
        user_id: Optional[str] = None,
        details: Optional[dict] = None,
    ) -> dict:
        try:
            payload = {
                "firm_id": firm_id,
                "action": action,
                "lease_id": lease_id,
                "user_id": user_id,
                "details": details or {},
            }
            resp = self.client.table("ifrs16_audit_log").insert(payload).execute()
            rows = resp.data or []
            return rows[0] if rows else {}
        except Exception as exc:
            print(f"WARNING: IFRS16 audit log write failed: {exc}")
            return {}

    def get_audit_log(
        self,
        firm_id: str,
        lease_id: Optional[str] = None,
        limit: int = 100,
    ) -> List[dict]:
        q = (
            self.client.table("ifrs16_audit_log")
            .select("*")
            .eq("firm_id", firm_id)
            .order("created_at", desc=True)
            .limit(limit)
        )
        if lease_id:
            q = q.eq("lease_id", lease_id)
        resp = q.execute()
        return list(resp.data or [])


ifrs16_db = IFRS16DB()


def list_leases(
    firm_id: str,
    status: Optional[str] = None,
    entity_name: Optional[str] = None,
) -> List[dict]:
    """Portfolio rows for snapshot / comparative engines."""
    rows = ifrs16_db.get_portfolio(firm_id, status=status)
    if not entity_name:
        return rows
    out: List[dict] = []
    for row in rows:
        lease_data = row.get("lease_data") or {}
        ent = str(lease_data.get("legal_entity") or lease_data.get("entity_name") or "")
        if ent == entity_name:
            out.append(row)
    return out
