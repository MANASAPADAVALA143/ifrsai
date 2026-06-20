"""IFRS 16 period snapshot service — comparative reporting at FY end."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from typing import Any, Optional

from dateutil.relativedelta import relativedelta

from backend.app.services.supabase_client import get_supabase_client

MIGRATION_004 = "004_ifrs16_period_snapshots.sql"
MIGRATION_003 = "003_ifrs16_persistence.sql"


class MigrationRequiredError(RuntimeError):
    def __init__(self, *migrations: str):
        self.migrations = migrations or (MIGRATION_004,)
        names = ", ".join(f"backend/migrations/{m}" for m in self.migrations)
        super().__init__(f"Database migration required. Run in Supabase SQL Editor: {names}")


def _is_missing_table_error(exc: Exception) -> bool:
    msg = str(exc)
    return "PGRST205" in msg or "Could not find the table" in msg


def _raise_if_missing_table(exc: Exception, *migrations: str) -> None:
    if _is_missing_table_error(exc):
        raise MigrationRequiredError(*migrations) from exc


def _default_firm_settings(firm_id: str, migration_required: bool = False) -> dict:
    row = {
        "firm_id": firm_id,
        "fiscal_year_end": "12-31",
        "currency": "AED",
        "country": "UAE",
        "ibr_default": 0.055,
    }
    if migration_required:
        row["_migration_required"] = True
        row["_migration_hint"] = (
            f"Run backend/migrations/{MIGRATION_003} then backend/migrations/{MIGRATION_004} "
            "in Supabase SQL Editor."
        )
    return row


def _first_row(resp: Any) -> dict | None:
    rows = getattr(resp, "data", None) or []
    return rows[0] if rows else None


def get_firm_settings(firm_id: str) -> dict:
    client = get_supabase_client()
    try:
        result = client.table("ifrs16_firm_settings").select("*").eq("firm_id", firm_id).limit(1).execute()
    except Exception as exc:
        if _is_missing_table_error(exc):
            return _default_firm_settings(firm_id, migration_required=True)
        raise
    row = _first_row(result)
    if row:
        return row
    defaults = {"id": str(uuid.uuid4()), **_default_firm_settings(firm_id)}
    try:
        client.table("ifrs16_firm_settings").insert(defaults).execute()
    except Exception as exc:
        if _is_missing_table_error(exc):
            return _default_firm_settings(firm_id, migration_required=True)
        raise
    return defaults


def update_firm_settings(firm_id: str, updates: dict) -> dict:
    client = get_supabase_client()
    payload = {"firm_id": firm_id, **updates}
    try:
        result = client.table("ifrs16_firm_settings").upsert(payload, on_conflict="firm_id").execute()
    except Exception as exc:
        _raise_if_missing_table(exc, MIGRATION_004)
        raise
    return _first_row(result) or payload


def get_fy_period_end(year: int, fiscal_year_end: str) -> date:
    month, day = map(int, fiscal_year_end.split("-"))
    return date(year, month, day)


def get_fy_label(period_end: date, fiscal_year_end: str) -> str:
    month, _ = map(int, fiscal_year_end.split("-"))
    if month == 12:
        return f"FY{period_end.year}"
    start_year = period_end.year - 1
    return f"FY{start_year}-{str(period_end.year)[2:]}"


def get_period_start(period_end: date, fiscal_year_end: str) -> date:
    prior_end = period_end - relativedelta(years=1)
    return prior_end + timedelta(days=1)


def _row_val(row: dict, *keys: str, default: float = 0.0) -> float:
    for key in keys:
        if key in row and row[key] is not None:
            try:
                return float(row[key])
            except (TypeError, ValueError):
                continue
    return default


def _row_date(row: dict) -> date:
    d = row.get("Date") or row.get("date") or row.get("period_date") or row.get("payment_date") or ""
    try:
        return date.fromisoformat(str(d)[:10])
    except (TypeError, ValueError):
        return date.min


def _normalize_lease_row(lease: dict) -> dict:
    lease_data = dict(lease.get("lease_data") or lease)
    results = lease_data.get("results") if isinstance(lease_data.get("results"), dict) else {}
    dates = lease_data.get("dates") if isinstance(lease_data.get("dates"), dict) else {}
    payments = lease_data.get("payments") if isinstance(lease_data.get("payments"), dict) else {}
    schedule = (
        lease_data.get("amortization_schedule")
        or results.get("amortization_schedule")
        or []
    )
    comm = (
        lease_data.get("commencement_date")
        or lease_data.get("start_date")
        or dates.get("commencement")
        or dates.get("start")
        or ""
    )
    end = lease_data.get("lease_end_date") or lease_data.get("end_date") or dates.get("end") or ""
    term_months = int(
        lease_data.get("lease_term_months")
        or dates.get("term_months")
        or results.get("lease_term_months")
        or 0
    )
    rou_asset = float(results.get("rou_asset") or lease_data.get("rou") or 0)
    monthly_dep = float(
        results.get("monthly_depreciation")
        or (rou_asset / term_months if term_months > 0 else 0)
    )
    return {
        "id": lease.get("id") or lease_data.get("id") or lease_data.get("lease_id"),
        "lease_data": lease_data,
        "results": results,
        "schedule": schedule if isinstance(schedule, list) else [],
        "commencement_date": comm,
        "lease_end_date": end,
        "term_months": term_months,
        "monthly_depreciation": monthly_dep,
        "payment_amount": float(
            lease_data.get("payment_amount")
            or lease_data.get("monthly_payment")
            or payments.get("monthly")
            or 0
        ),
        "status": str(lease_data.get("status") or lease.get("status") or "active").lower(),
        "entity_name": lease_data.get("legal_entity") or lease_data.get("entity_name") or "",
        "lease_name": str(
            lease_data.get("title")
            or lease_data.get("asset")
            or lease_data.get("lease_name")
            or lease.get("lease_name")
            or lease.get("lease_id")
            or ""
        ),
        "currency": str(lease_data.get("currency") or payments.get("currency") or "AED"),
        "asset_type": lease_data.get("asset_type") or lease_data.get("lease_type") or "",
        "short_term_exemption": bool(
            lease_data.get("short_term_exemption") or lease_data.get("shortTermExemption")
        ),
        "low_value_exemption": bool(
            lease_data.get("low_value_exemption") or lease_data.get("lowValueExemption")
        ),
        "modifications": lease_data.get("modifications") or [],
    }


def calculate_snapshot_from_leases(
    leases: list[dict],
    period_start: date,
    period_end: date,
) -> dict:
    snap: dict[str, Any] = {
        "rou_opening": 0.0, "rou_additions": 0.0, "rou_depreciation": 0.0,
        "rou_disposals": 0.0, "rou_remeasurements": 0.0, "rou_closing": 0.0,
        "ll_opening": 0.0, "ll_new_leases": 0.0, "ll_interest": 0.0,
        "ll_payments": 0.0, "ll_modifications": 0.0, "ll_terminations": 0.0,
        "ll_remeasurements": 0.0, "ll_closing": 0.0,
        "ll_current": 0.0, "ll_non_current": 0.0,
        "pl_depreciation": 0.0, "pl_interest": 0.0,
        "pl_short_term": 0.0, "pl_low_value": 0.0, "pl_variable": 0.0, "pl_total": 0.0,
        "cf_principal": 0.0, "cf_interest": 0.0,
        "cf_short_term": 0.0, "cf_low_value": 0.0, "cf_total": 0.0,
        "mat_less_1yr": 0.0, "mat_1_to_2yr": 0.0, "mat_2_to_3yr": 0.0,
        "mat_3_to_4yr": 0.0, "mat_4_to_5yr": 0.0, "mat_over_5yr": 0.0, "mat_total": 0.0,
        "lease_count_active": 0, "lease_count_new": 0,
        "lease_count_modified": 0, "lease_count_terminated": 0, "lease_count_expired": 0,
    }
    lease_details: list[dict] = []

    for raw in leases:
        lease = _normalize_lease_row(raw)
        schedule = lease["schedule"]
        payment = lease["payment_amount"]
        monthly_dep = lease["monthly_depreciation"]
        results = lease["results"]

        if lease["short_term_exemption"] or lease["low_value_exemption"]:
            count = _count_payments_in_period(schedule, period_start, period_end)
            expense = count * payment if count else payment * max(1, _months_in_period(period_start, period_end))
            if lease["short_term_exemption"]:
                snap["pl_short_term"] += expense
                snap["cf_short_term"] += expense
            else:
                snap["pl_low_value"] += expense
                snap["cf_low_value"] += expense
            continue

        if not schedule:
            continue

        try:
            comm_date = date.fromisoformat(str(lease["commencement_date"])[:10]) if lease["commencement_date"] else None
        except (TypeError, ValueError):
            comm_date = None

        rows_before = [r for r in schedule if _row_date(r) < period_start]
        rows_in_period = [r for r in schedule if period_start <= _row_date(r) <= period_end]
        rows_after = [r for r in schedule if _row_date(r) > period_end]

        if rows_before:
            last_before = rows_before[-1]
            ll_open = _row_val(last_before, "Closing_Balance", "closing_balance", "lease_liability_close")
            rou_open = max(
                float(results.get("rou_asset") or 0) - monthly_dep * len(rows_before),
                0.0,
            )
        elif comm_date and comm_date >= period_start:
            ll_open = 0.0
            rou_open = 0.0
            snap["ll_new_leases"] += float(results.get("lease_liability") or results.get("lease_liability_opening") or 0)
            snap["rou_additions"] += float(results.get("rou_asset") or 0)
            snap["lease_count_new"] += 1
        else:
            ll_open = _row_val(schedule[0], "Opening_Balance", "opening_balance") if schedule else 0.0
            rou_open = float(results.get("rou_asset") or 0)

        period_interest = sum(_row_val(r, "Interest", "interest", "interestExpense") for r in rows_in_period)
        period_principal = sum(_row_val(r, "Principal", "principal", "principalRepayment") for r in rows_in_period)
        period_depreciation = monthly_dep * len(rows_in_period) if rows_in_period else 0.0
        period_payment = sum(_row_val(r, "Payment", "payment", "totalPayment") for r in rows_in_period)

        if rows_in_period:
            last_in = rows_in_period[-1]
            ll_close = _row_val(last_in, "Closing_Balance", "closing_balance", "lease_liability_close")
            rou_close = max(
                float(results.get("rou_asset") or rou_open)
                - monthly_dep * (len(rows_before) + len(rows_in_period)),
                0.0,
            )
        else:
            ll_close = ll_open
            rou_close = rou_open

        next_12_principal = sum(
            _row_val(r, "Principal", "principal", "principalRepayment")
            for r in rows_after
            if _row_date(r) <= period_end + relativedelta(years=1)
        )
        snap["ll_current"] += min(next_12_principal, ll_close)
        snap["ll_non_current"] += max(ll_close - next_12_principal, 0)

        _add_maturity(snap, rows_after, period_end, payment)

        snap["ll_opening"] += ll_open
        snap["ll_interest"] += period_interest
        snap["ll_payments"] += period_payment
        snap["ll_closing"] += ll_close
        snap["rou_opening"] += rou_open
        snap["rou_depreciation"] += period_depreciation
        snap["rou_closing"] += rou_close
        snap["pl_interest"] += period_interest
        snap["pl_depreciation"] += period_depreciation
        snap["cf_principal"] += period_principal
        snap["cf_interest"] += period_interest

        for mod in lease["modifications"]:
            if not isinstance(mod, dict):
                continue
            mod_date_str = mod.get("modification_date") or mod.get("date") or mod.get("effectiveDate") or ""
            try:
                mod_date = date.fromisoformat(str(mod_date_str)[:10])
            except (TypeError, ValueError):
                continue
            if period_start <= mod_date <= period_end:
                before_ll = float(mod.get("before_liability") or mod.get("priorLL") or 0)
                after_ll = float(mod.get("after_liability") or mod.get("newLL") or 0)
                snap["ll_modifications"] += after_ll - before_ll
                if str(mod.get("modification_type") or mod.get("type") or "").lower() == "termination":
                    snap["ll_terminations"] += before_ll
                    snap["rou_disposals"] += float(mod.get("before_rou_asset") or mod.get("priorROU") or 0)
                    snap["lease_count_terminated"] += 1
                else:
                    snap["lease_count_modified"] += 1

        status = lease["status"]
        if status in ("active", "calculated"):
            snap["lease_count_active"] += 1
        elif status == "expired":
            snap["lease_count_expired"] += 1

        lease_details.append({
            "lease_id": str(lease.get("id") or ""),
            "lease_name": lease["lease_name"],
            "entity_name": lease["entity_name"],
            "asset_type": lease["asset_type"],
            "currency": lease["currency"],
            "rou_closing": round(rou_close, 2),
            "ll_closing": round(ll_close, 2),
            "ll_current": round(min(next_12_principal, ll_close), 2),
            "ll_non_current": round(max(ll_close - next_12_principal, 0), 2),
            "rou_depreciation": round(period_depreciation, 2),
            "ll_interest": round(period_interest, 2),
            "ll_payments": round(period_payment, 2),
            "lease_status": status,
        })

    snap["pl_total"] = snap["pl_depreciation"] + snap["pl_interest"] + snap["pl_short_term"] + snap["pl_low_value"]
    snap["cf_total"] = snap["cf_principal"] + snap["cf_interest"] + snap["cf_short_term"] + snap["cf_low_value"]
    snap["mat_total"] = sum(
        snap[k]
        for k in (
            "mat_less_1yr", "mat_1_to_2yr", "mat_2_to_3yr",
            "mat_3_to_4yr", "mat_4_to_5yr", "mat_over_5yr",
        )
    )
    for k, v in list(snap.items()):
        if isinstance(v, float):
            snap[k] = round(v, 2)
    snap["lease_details"] = lease_details
    return snap


def create_draft_snapshot(
    firm_id: str,
    year: int,
    fiscal_year_end: str,
    leases: list[dict],
    entity_name: str | None = None,
    notes: str = "",
) -> dict:
    client = get_supabase_client()
    period_end = get_fy_period_end(year, fiscal_year_end)
    period_start = get_period_start(period_end, fiscal_year_end)
    period_label = get_fy_label(period_end, fiscal_year_end)

    q = (
        client.table("ifrs16_period_snapshots")
        .select("id, status")
        .eq("firm_id", firm_id)
        .eq("period_label", period_label)
    )
    if entity_name:
        q = q.eq("entity_name", entity_name)
    else:
        q = q.is_("entity_name", "null")
    existing = _first_row(q.limit(1).execute())

    if existing and existing.get("status") == "closed":
        raise ValueError(f"Period {period_label} is already closed. Reopen first.")

    figures = calculate_snapshot_from_leases(leases, period_start, period_end)
    lease_details = figures.pop("lease_details", [])

    payload = {
        "firm_id": firm_id,
        "entity_name": entity_name,
        "period_label": period_label,
        "period_type": "annual",
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "fiscal_year_end": fiscal_year_end,
        "status": "draft",
        "lease_details": lease_details,
        "notes": notes,
        **figures,
    }

    if existing:
        snap_id = existing["id"]
        client.table("ifrs16_period_snapshots").update(payload).eq("id", snap_id).execute()
        client.table("ifrs16_lease_period_snapshots").delete().eq("snapshot_id", snap_id).execute()
        result = client.table("ifrs16_period_snapshots").select("*").eq("id", snap_id).limit(1).execute()
        row = _first_row(result) or {**payload, "id": snap_id}
    else:
        payload["id"] = str(uuid.uuid4())
        client.table("ifrs16_period_snapshots").insert(payload).execute()
        row = payload

    _save_lease_snapshots(client, firm_id, row["id"], lease_details)
    return row


def close_snapshot(firm_id: str, snapshot_id: str, closed_by: str = "") -> dict:
    client = get_supabase_client()
    result = (
        client.table("ifrs16_period_snapshots")
        .update({
            "status": "closed",
            "closed_at": datetime.utcnow().isoformat(),
            "closed_by": closed_by,
        })
        .eq("id", snapshot_id)
        .eq("firm_id", firm_id)
        .execute()
    )
    return _first_row(result) or {}


def reopen_snapshot(firm_id: str, snapshot_id: str, reopened_by: str = "") -> dict:
    client = get_supabase_client()
    result = (
        client.table("ifrs16_period_snapshots")
        .update({
            "status": "reopened",
            "reopened_at": datetime.utcnow().isoformat(),
            "reopened_by": reopened_by,
        })
        .eq("id", snapshot_id)
        .eq("firm_id", firm_id)
        .execute()
    )
    return _first_row(result) or {}


def list_snapshots(firm_id: str, status: str | None = None) -> list[dict]:
    client = get_supabase_client()
    q = (
        client.table("ifrs16_period_snapshots")
        .select(
            "id, firm_id, period_label, period_start, period_end, status, closed_at, "
            "lease_count_active, rou_closing, ll_closing, pl_total"
        )
        .eq("firm_id", firm_id)
        .order("period_end", desc=True)
    )
    if status:
        q = q.eq("status", status)
    return q.execute().data or []


def get_comparative_data(firm_id: str, current_label: str) -> dict:
    client = get_supabase_client()
    result = (
        client.table("ifrs16_comparative_view")
        .select("*")
        .eq("firm_id", firm_id)
        .eq("current_period", current_label)
        .limit(1)
        .execute()
    )
    return _first_row(result) or {}


def get_snapshot(firm_id: str, snapshot_id: str) -> dict | None:
    client = get_supabase_client()
    result = (
        client.table("ifrs16_period_snapshots")
        .select("*")
        .eq("firm_id", firm_id)
        .eq("id", snapshot_id)
        .limit(1)
        .execute()
    )
    return _first_row(result)


def _count_payments_in_period(schedule: list, period_start: date, period_end: date) -> int:
    return sum(1 for r in schedule if period_start <= _row_date(r) <= period_end)


def _months_in_period(period_start: date, period_end: date) -> int:
    return max(1, (period_end.year - period_start.year) * 12 + period_end.month - period_start.month + 1)


def _add_maturity(snap: dict, future_rows: list, period_end: date, payment: float):
    for row in future_rows:
        row_date = _row_date(row)
        if row_date == date.min:
            continue
        pmt = _row_val(row, "Payment", "payment", "totalPayment", default=payment)
        diff_years = (row_date - period_end).days / 365.25
        if diff_years <= 1:
            snap["mat_less_1yr"] += pmt
        elif diff_years <= 2:
            snap["mat_1_to_2yr"] += pmt
        elif diff_years <= 3:
            snap["mat_2_to_3yr"] += pmt
        elif diff_years <= 4:
            snap["mat_3_to_4yr"] += pmt
        elif diff_years <= 5:
            snap["mat_4_to_5yr"] += pmt
        else:
            snap["mat_over_5yr"] += pmt


def _save_lease_snapshots(client, firm_id: str, snapshot_id: str, lease_details: list):
    if not lease_details:
        return
    rows = [{"id": str(uuid.uuid4()), "snapshot_id": snapshot_id, "firm_id": firm_id, **detail} for detail in lease_details]
    try:
        client.table("ifrs16_lease_period_snapshots").insert(rows).execute()
    except Exception as exc:
        print(f"WARNING: lease period snapshot insert failed: {exc}")
