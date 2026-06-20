"""IFRS 16 comparative period reporting — API routes."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.services.ifrs16_db import list_leases
from backend.app.services.ifrs16_period_snapshot_service import (
    MigrationRequiredError,
    calculate_snapshot_from_leases,
    close_snapshot,
    create_draft_snapshot,
    get_comparative_data,
    get_firm_settings,
    get_fy_label,
    get_fy_period_end,
    get_period_start,
    get_snapshot,
    list_snapshots,
    reopen_snapshot,
    update_firm_settings,
)

router = APIRouter(prefix="/api/ifrs16/comparative", tags=["ifrs16-comparative"])


def _firm(x_firm_id: str | None) -> str:
    return (x_firm_id or "default").strip()


def _http_migration(exc: Exception) -> None:
    if isinstance(exc, MigrationRequiredError):
        raise HTTPException(status_code=503, detail=str(exc)) from exc


class FirmSettingsRequest(BaseModel):
    fiscal_year_end: str = Field("12-31", example="12-31")
    currency: str = "AED"
    country: str = "UAE"
    ibr_default: float = 0.055
    firm_name: Optional[str] = None


class CreateSnapshotRequest(BaseModel):
    year: int = Field(..., example=2024)
    entity_name: Optional[str] = None
    notes: str = ""


class CloseSnapshotRequest(BaseModel):
    closed_by: str = ""


class ReopenSnapshotRequest(BaseModel):
    reopened_by: str = ""


@router.get("/settings")
async def get_settings(x_firm_id: Optional[str] = Header(None)):
    firm_id = _firm(x_firm_id)
    return {"success": True, "settings": get_firm_settings(firm_id)}


@router.put("/settings")
async def update_settings(body: FirmSettingsRequest, x_firm_id: Optional[str] = Header(None)):
    firm_id = _firm(x_firm_id)
    try:
        month, day = map(int, body.fiscal_year_end.split("-"))
        assert 1 <= month <= 12 and 1 <= day <= 31
    except Exception as exc:
        raise HTTPException(status_code=422, detail="fiscal_year_end must be MM-DD e.g. '12-31'") from exc
    try:
        result = update_firm_settings(firm_id, body.model_dump(exclude_none=True))
    except Exception as exc:
        _http_migration(exc)
        raise
    return {"success": True, "settings": result}


@router.post("/snapshots/preview")
async def preview_snapshot(body: CreateSnapshotRequest, x_firm_id: Optional[str] = Header(None)):
    firm_id = _firm(x_firm_id)
    try:
        settings = get_firm_settings(firm_id)
        fy_end = settings.get("fiscal_year_end", "12-31")
        period_end = get_fy_period_end(body.year, fy_end)
        period_start = get_period_start(period_end, fy_end)
        period_label = get_fy_label(period_end, fy_end)
        leases = list_leases(firm_id, entity_name=body.entity_name)
        figures = calculate_snapshot_from_leases(leases, period_start, period_end)
        lease_details = figures.pop("lease_details", [])
        return {
            "success": True,
            "preview": {
                "period_label": period_label,
                "period_start": period_start.isoformat(),
                "period_end": period_end.isoformat(),
                "fiscal_year_end": fy_end,
                "figures": figures,
                "lease_count": len(lease_details),
                "lease_details": lease_details[:20],
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/snapshots")
async def create_snapshot(body: CreateSnapshotRequest, x_firm_id: Optional[str] = Header(None)):
    firm_id = _firm(x_firm_id)
    try:
        settings = get_firm_settings(firm_id)
        fy_end = settings.get("fiscal_year_end", "12-31")
        leases = list_leases(firm_id, entity_name=body.entity_name)
        snapshot = create_draft_snapshot(
            firm_id=firm_id,
            year=body.year,
            fiscal_year_end=fy_end,
            leases=leases,
            entity_name=body.entity_name,
            notes=body.notes,
        )
        return {"success": True, "snapshot": snapshot}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except MigrationRequiredError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/snapshots")
async def list_all_snapshots(status: Optional[str] = Query(None), x_firm_id: Optional[str] = Header(None)):
    firm_id = _firm(x_firm_id)
    snapshots = list_snapshots(firm_id, status=status)
    return {"success": True, "snapshots": snapshots, "count": len(snapshots)}


@router.get("/snapshots/{snapshot_id}")
async def get_single_snapshot(snapshot_id: str, x_firm_id: Optional[str] = Header(None)):
    firm_id = _firm(x_firm_id)
    snap = get_snapshot(firm_id, snapshot_id)
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return {"success": True, "snapshot": snap}


@router.post("/snapshots/{snapshot_id}/close")
async def close_period(snapshot_id: str, body: CloseSnapshotRequest, x_firm_id: Optional[str] = Header(None)):
    firm_id = _firm(x_firm_id)
    snap = get_snapshot(firm_id, snapshot_id)
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    if snap.get("status") == "closed":
        raise HTTPException(status_code=400, detail="Snapshot already closed")
    result = close_snapshot(firm_id, snapshot_id, closed_by=body.closed_by)
    return {
        "success": True,
        "snapshot": result,
        "message": f"Period {snap['period_label']} closed and locked.",
    }


@router.post("/snapshots/{snapshot_id}/reopen")
async def reopen_period(snapshot_id: str, body: ReopenSnapshotRequest, x_firm_id: Optional[str] = Header(None)):
    firm_id = _firm(x_firm_id)
    result = reopen_snapshot(firm_id, snapshot_id, reopened_by=body.reopened_by)
    return {"success": True, "snapshot": result}


@router.get("/report/{period_label}")
async def get_comparative_report(period_label: str, x_firm_id: Optional[str] = Header(None)):
    firm_id = _firm(x_firm_id)
    data = get_comparative_data(firm_id, period_label)
    if data:
        return {
            "success": True,
            "has_comparative": data.get("prior_period") is not None,
            "current_period": data.get("current_period"),
            "prior_period": data.get("prior_period"),
            "data": _format_comparative(data),
        }
    snaps = list_snapshots(firm_id, status="closed")
    current = next((s for s in snaps if s["period_label"] == period_label), None)
    if not current:
        raise HTTPException(status_code=404, detail=f"No closed snapshot for {period_label}")
    snap = get_snapshot(firm_id, current["id"])
    return {
        "success": True,
        "has_comparative": False,
        "current_period": period_label,
        "prior_period": None,
        "data": _format_single_period(snap or {}),
    }


@router.get("/available-periods")
async def get_available_periods(x_firm_id: Optional[str] = Header(None)):
    firm_id = _firm(x_firm_id)
    snaps = list_snapshots(firm_id, status="closed")
    return {
        "success": True,
        "periods": [{"label": s["period_label"], "period_end": s["period_end"]} for s in snaps],
    }


def _format_comparative(d: dict) -> dict:
    return {
        "rou_movement": {
            "opening": {"curr": d.get("rou_opening_curr", 0), "prior": d.get("rou_opening_prior", 0)},
            "additions": {"curr": d.get("rou_additions_curr", 0), "prior": d.get("rou_additions_prior", 0)},
            "depreciation": {"curr": d.get("rou_depreciation_curr", 0), "prior": d.get("rou_depreciation_prior", 0)},
            "disposals": {"curr": d.get("rou_disposals_curr", 0), "prior": d.get("rou_disposals_prior", 0)},
            "remeasurements": {"curr": d.get("rou_remeasurements_curr", 0), "prior": d.get("rou_remeasurements_prior", 0)},
            "closing": {"curr": d.get("rou_closing_curr", 0), "prior": d.get("rou_closing_prior", 0)},
        },
        "ll_movement": {
            "opening": {"curr": d.get("ll_opening_curr", 0), "prior": d.get("ll_closing_prior", 0)},
            "new_leases": {"curr": d.get("ll_new_leases_curr", 0), "prior": 0},
            "interest": {"curr": d.get("ll_interest_curr", 0), "prior": 0},
            "payments": {"curr": d.get("ll_payments_curr", 0), "prior": 0},
            "modifications": {"curr": d.get("ll_modifications_curr", 0), "prior": 0},
            "terminations": {"curr": d.get("ll_terminations_curr", 0), "prior": 0},
            "closing": {"curr": d.get("ll_closing_curr", 0), "prior": d.get("ll_closing_prior", 0)},
            "current_portion": {"curr": d.get("ll_current_curr", 0), "prior": d.get("ll_current_prior", 0)},
            "non_current_portion": {"curr": d.get("ll_non_current_curr", 0), "prior": d.get("ll_non_current_prior", 0)},
        },
        "pl_charges": {
            "depreciation": {"curr": d.get("pl_depreciation_curr", 0), "prior": d.get("pl_depreciation_prior", 0)},
            "interest": {"curr": d.get("pl_interest_curr", 0), "prior": d.get("pl_interest_prior", 0)},
            "short_term": {"curr": d.get("pl_short_term_curr", 0), "prior": d.get("pl_short_term_prior", 0)},
            "low_value": {"curr": d.get("pl_low_value_curr", 0), "prior": d.get("pl_low_value_prior", 0)},
            "total": {"curr": d.get("pl_total_curr", 0), "prior": d.get("pl_total_prior", 0)},
        },
        "cash_flow": {"total": {"curr": d.get("cf_total_curr", 0), "prior": d.get("cf_total_prior", 0)}},
        "maturity": {
            "less_1yr": {"curr": d.get("mat_less_1yr_curr", 0), "prior": d.get("mat_less_1yr_prior", 0)},
            "1_to_2yr": {"curr": d.get("mat_1_to_2yr_curr", 0), "prior": d.get("mat_1_to_2yr_prior", 0)},
            "2_to_3yr": {"curr": d.get("mat_2_to_3yr_curr", 0), "prior": d.get("mat_2_to_3yr_prior", 0)},
            "3_to_4yr": {"curr": d.get("mat_3_to_4yr_curr", 0), "prior": d.get("mat_3_to_4yr_prior", 0)},
            "4_to_5yr": {"curr": d.get("mat_4_to_5yr_curr", 0), "prior": d.get("mat_4_to_5yr_prior", 0)},
            "over_5yr": {"curr": d.get("mat_over_5yr_curr", 0), "prior": d.get("mat_over_5yr_prior", 0)},
            "total": {"curr": d.get("mat_total_curr", 0), "prior": d.get("mat_total_prior", 0)},
        },
    }


def _format_single_period(snap: dict) -> dict:
    z = 0
    none: Any = None
    return {
        "rou_movement": {
            "opening": {"curr": snap.get("rou_opening", z), "prior": none},
            "additions": {"curr": snap.get("rou_additions", z), "prior": none},
            "depreciation": {"curr": snap.get("rou_depreciation", z), "prior": none},
            "disposals": {"curr": snap.get("rou_disposals", z), "prior": none},
            "remeasurements": {"curr": snap.get("rou_remeasurements", z), "prior": none},
            "closing": {"curr": snap.get("rou_closing", z), "prior": none},
        },
        "ll_movement": {
            "opening": {"curr": snap.get("ll_opening", z), "prior": none},
            "new_leases": {"curr": snap.get("ll_new_leases", z), "prior": none},
            "interest": {"curr": snap.get("ll_interest", z), "prior": none},
            "payments": {"curr": snap.get("ll_payments", z), "prior": none},
            "modifications": {"curr": snap.get("ll_modifications", z), "prior": none},
            "terminations": {"curr": snap.get("ll_terminations", z), "prior": none},
            "closing": {"curr": snap.get("ll_closing", z), "prior": none},
            "current_portion": {"curr": snap.get("ll_current", z), "prior": none},
            "non_current_portion": {"curr": snap.get("ll_non_current", z), "prior": none},
        },
        "pl_charges": {
            "depreciation": {"curr": snap.get("pl_depreciation", z), "prior": none},
            "interest": {"curr": snap.get("pl_interest", z), "prior": none},
            "short_term": {"curr": snap.get("pl_short_term", z), "prior": none},
            "low_value": {"curr": snap.get("pl_low_value", z), "prior": none},
            "total": {"curr": snap.get("pl_total", z), "prior": none},
        },
        "cash_flow": {"total": {"curr": snap.get("cf_total", z), "prior": none}},
        "maturity": {
            "less_1yr": {"curr": snap.get("mat_less_1yr", z), "prior": none},
            "1_to_2yr": {"curr": snap.get("mat_1_to_2yr", z), "prior": none},
            "2_to_3yr": {"curr": snap.get("mat_2_to_3yr", z), "prior": none},
            "3_to_4yr": {"curr": snap.get("mat_3_to_4yr", z), "prior": none},
            "4_to_5yr": {"curr": snap.get("mat_4_to_5yr", z), "prior": none},
            "over_5yr": {"curr": snap.get("mat_over_5yr", z), "prior": none},
            "total": {"curr": snap.get("mat_total", z), "prior": none},
        },
    }
