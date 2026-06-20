"""IFRS 9 ECL portfolio and calculation runs — Supabase persistence with firm_id tenancy."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from backend.app.services.supabase_client import get_supabase_client


class MigrationRequiredError(RuntimeError):
    """Raised when IFRS 9 Supabase tables are missing (run 005_ifrs9_persistence.sql)."""

    def __init__(self, *migrations: str):
        self.migrations = migrations
        super().__init__(
            "IFRS 9 database tables missing. Apply migrations: "
            + ", ".join(migrations)
        )


def _summary_from_instrument_data(data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "applicable_ecl": float(data.get("applicableEcl") or data.get("applicable_ecl") or 0),
        "stage": int(data.get("stage") or 1),
        "coverage_ratio": float(data.get("coverageRatio") or data.get("coverage_ratio") or 0),
        "asset_class": str(data.get("assetClass") or data.get("asset_class") or ""),
        "currency": str(data.get("currency") or "INR"),
        "counterparty_name": str(data.get("counterpartyName") or data.get("counterparty_name") or ""),
        "ead": float(data.get("ead") or data.get("outstandingBalance") or data.get("grossCarryingAmount") or 0),
        "status": str(data.get("status") or "Draft"),
        "last_calculated_at": data.get("last_calculated_at") or data.get("lastUpdated"),
        "approach": str(data.get("approach") or "general"),
    }


def _portfolio_name_from_data(data: Dict[str, Any], portfolio_id: str) -> str:
    return str(data.get("name") or data.get("portfolio_name") or portfolio_id)


class IFRS9DB:
    def __init__(self) -> None:
        self._client = None

    @property
    def client(self):
        if self._client is None:
            self._client = get_supabase_client()
        return self._client

    def _migration_hint(self, exc: Exception) -> None:
        msg = str(exc)
        if "PGRST205" in msg or "Could not find" in msg or "ifrs9_" in msg:
            raise MigrationRequiredError("005_ifrs9_persistence.sql") from exc
        raise exc

    def find_by_business_portfolio_id(self, firm_id: str, portfolio_id: str) -> Optional[dict]:
        try:
            resp = (
                self.client.table("ifrs9_portfolios")
                .select("*")
                .eq("firm_id", firm_id)
                .eq("portfolio_id", portfolio_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            self._migration_hint(exc)
        rows = resp.data or []
        return rows[0] if rows else None

    def upsert_portfolio(
        self,
        firm_id: str,
        instrument_data: dict,
        user_id: Optional[str] = None,
    ) -> dict:
        business_id = str(
            instrument_data.get("portfolioId")
            or instrument_data.get("portfolio_id")
            or instrument_data.get("id")
            or ""
        ).strip()
        if not business_id:
            raise ValueError("instrument_data must include portfolioId, portfolio_id, or id")

        payload = {
            "firm_id": firm_id,
            "portfolio_id": business_id,
            "portfolio_name": _portfolio_name_from_data(instrument_data, business_id),
            "instrument_data": instrument_data,
            "summary_data": _summary_from_instrument_data(instrument_data),
            "status": str(instrument_data.get("status") or "draft").lower(),
            "user_id": user_id,
        }

        try:
            existing = self.find_by_business_portfolio_id(firm_id, business_id)
            if existing:
                resp = (
                    self.client.table("ifrs9_portfolios")
                    .update(payload)
                    .eq("firm_id", firm_id)
                    .eq("portfolio_id", business_id)
                    .execute()
                )
                rows = resp.data or []
                row = rows[0] if rows else {**existing, **payload}
                self.log_action(firm_id, "updated", business_id, user_id, {"portfolio_id": business_id})
                return row

            resp = self.client.table("ifrs9_portfolios").insert(payload).execute()
        except Exception as exc:
            self._migration_hint(exc)

        rows = resp.data or []
        if not rows:
            raise RuntimeError("Insert returned no row")
        self.log_action(firm_id, "created", business_id, user_id, {"portfolio_id": business_id})
        return rows[0]

    def get_portfolio(
        self,
        firm_id: str,
        status: Optional[str] = None,
        limit: int = 500,
        offset: int = 0,
    ) -> List[dict]:
        try:
            q = (
                self.client.table("ifrs9_portfolios")
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
        except Exception as exc:
            self._migration_hint(exc)
        return list(resp.data or [])

    def get_portfolio_entry(self, firm_id: str, portfolio_id: str) -> Optional[dict]:
        return self.find_by_business_portfolio_id(firm_id, portfolio_id)

    def delete_portfolio(self, firm_id: str, portfolio_id: str, user_id: Optional[str] = None) -> bool:
        row = self.find_by_business_portfolio_id(firm_id, portfolio_id)
        if not row:
            return False
        try:
            resp = (
                self.client.table("ifrs9_portfolios")
                .update({"status": "deleted"})
                .eq("firm_id", firm_id)
                .eq("portfolio_id", portfolio_id)
                .execute()
            )
        except Exception as exc:
            self._migration_hint(exc)
        self.log_action(firm_id, "deleted", portfolio_id, user_id, {"portfolio_id": portfolio_id})
        return bool(resp.data)

    def save_calculation_run(
        self,
        firm_id: str,
        portfolio_id: str,
        calc_result: dict,
        input_snapshot: Optional[dict] = None,
        user_id: Optional[str] = None,
    ) -> dict:
        portfolio_row = self.find_by_business_portfolio_id(firm_id, portfolio_id)
        portfolio_row_id = portfolio_row.get("id") if portfolio_row else None

        applicable_ecl = float(calc_result.get("applicable_ecl") or 0)
        total_ead = float(calc_result.get("ead_used") or calc_result.get("total_ead") or 0)
        coverage = float(calc_result.get("coverage_ratio") or 0)

        payload = {
            "firm_id": firm_id,
            "portfolio_row_id": portfolio_row_id,
            "portfolio_id": portfolio_id,
            "run_label": str(calc_result.get("run_label") or datetime.utcnow().strftime("%Y-%m-%d %H:%M")),
            "approach": str(calc_result.get("approach") or "general"),
            "reporting_date": calc_result.get("reporting_date"),
            "ecl_results": calc_result,
            "journal_outputs": calc_result.get("journal_entries"),
            "ecl_movement": calc_result.get("ecl_movement"),
            "staging_result": calc_result.get("staging"),
            "classification_result": calc_result.get("classification_result"),
            "input_snapshot": input_snapshot or {},
            "applicable_ecl": applicable_ecl,
            "total_ead": total_ead,
            "coverage_ratio": coverage,
            "user_id": user_id,
        }

        try:
            resp = self.client.table("ifrs9_calculation_runs").insert(payload).execute()
        except Exception as exc:
            self._migration_hint(exc)

        run_rows = resp.data or []
        run_row = run_rows[0] if run_rows else payload

        if portfolio_row:
            instrument_data = dict(portfolio_row.get("instrument_data") or {})
            instrument_data["applicableEcl"] = applicable_ecl
            instrument_data["coverageRatio"] = coverage
            instrument_data["ecl12m"] = calc_result.get("ecl_12m")
            instrument_data["eclLifetime"] = calc_result.get("ecl_lifetime")
            instrument_data["journalEntries"] = calc_result.get("journal_entries")
            instrument_data["disclosureNotes"] = calc_result.get("disclosure_notes")
            instrument_data["scenarioResults"] = calc_result.get("scenario_results")
            instrument_data["last_calculated_at"] = datetime.utcnow().isoformat() + "Z"
            instrument_data["lastUpdated"] = instrument_data["last_calculated_at"]
            if calc_result.get("stage"):
                instrument_data["stage"] = calc_result.get("stage")
            self.upsert_portfolio(firm_id, instrument_data, user_id=user_id)

        self.log_action(
            firm_id,
            "calculated",
            portfolio_id,
            user_id,
            {"applicable_ecl": applicable_ecl, "run_id": run_row.get("id")},
        )
        return run_row

    def get_calculation_runs(
        self,
        firm_id: str,
        portfolio_id: Optional[str] = None,
        limit: int = 50,
    ) -> List[dict]:
        try:
            q = (
                self.client.table("ifrs9_calculation_runs")
                .select("*")
                .eq("firm_id", firm_id)
                .order("created_at", desc=True)
                .limit(limit)
            )
            if portfolio_id:
                q = q.eq("portfolio_id", portfolio_id)
            resp = q.execute()
        except Exception as exc:
            self._migration_hint(exc)
        return list(resp.data or [])

    def get_portfolio_summary(self, firm_id: str) -> Dict[str, Any]:
        rows = self.get_portfolio(firm_id)
        total_ecl = 0.0
        total_ead = 0.0
        by_stage = {1: 0, 2: 0, 3: 0}
        active = 0

        for row in rows:
            summary = row.get("summary_data") or _summary_from_instrument_data(row.get("instrument_data") or {})
            status = str(summary.get("status") or "").lower()
            if status in ("deleted", "archived"):
                continue
            active += 1
            ecl = float(summary.get("applicable_ecl") or 0)
            ead = float(summary.get("ead") or 0)
            total_ecl += ecl
            total_ead += ead
            stage = int(summary.get("stage") or 1)
            if stage in by_stage:
                by_stage[stage] += ecl

        return {
            "portfolio_count": active,
            "total_ecl": round(total_ecl, 2),
            "total_ead": round(total_ead, 2),
            "coverage_ratio": round(total_ecl / total_ead * 100, 2) if total_ead else 0.0,
            "ecl_by_stage": by_stage,
        }

    def log_action(
        self,
        firm_id: str,
        action: str,
        portfolio_id: Optional[str] = None,
        user_id: Optional[str] = None,
        details: Optional[dict] = None,
    ) -> dict:
        try:
            payload = {
                "firm_id": firm_id,
                "action": action,
                "portfolio_id": portfolio_id,
                "user_id": user_id,
                "details": details or {},
            }
            resp = self.client.table("ifrs9_audit_log").insert(payload).execute()
            rows = resp.data or []
            return rows[0] if rows else {}
        except Exception as exc:
            if "PGRST205" in str(exc) or "Could not find" in str(exc):
                print(f"WARNING: IFRS9 audit log write skipped (migration?): {exc}")
                return {}
            print(f"WARNING: IFRS9 audit log write failed: {exc}")
            return {}

    def get_audit_log(
        self,
        firm_id: str,
        portfolio_id: Optional[str] = None,
        limit: int = 100,
    ) -> List[dict]:
        try:
            q = (
                self.client.table("ifrs9_audit_log")
                .select("*")
                .eq("firm_id", firm_id)
                .order("created_at", desc=True)
                .limit(limit)
            )
            if portfolio_id:
                q = q.eq("portfolio_id", portfolio_id)
            resp = q.execute()
        except Exception as exc:
            self._migration_hint(exc)
        return list(resp.data or [])


ifrs9_db = IFRS9DB()
