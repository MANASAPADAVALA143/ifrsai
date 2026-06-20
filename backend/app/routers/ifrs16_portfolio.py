"""IFRS 16 portfolio CRUD — server persistence for lease repository."""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

from backend.app.services.ifrs16_db import ifrs16_db

router = APIRouter(prefix="/api/ifrs16/portfolio", tags=["ifrs16-portfolio"])


def _ifrs16_firm_id(
    request: Optional[Request] = None,
    x_firm_id: Optional[str] = None,
) -> str:
    if x_firm_id and str(x_firm_id).strip():
        return str(x_firm_id).strip()
    if request is not None:
        hdr = request.headers.get("x-firm-id") or request.headers.get("X-Firm-Id")
        if hdr and str(hdr).strip():
            return str(hdr).strip()
    return os.getenv("IFRS16_FIRM_ID", os.getenv("IFRS15_FIRM_ID", "default"))


def _user_id(request: Optional[Request], x_user_id: Optional[str] = None) -> Optional[str]:
    if x_user_id and str(x_user_id).strip():
        return str(x_user_id).strip()
    if request is not None:
        hdr = request.headers.get("x-user-id") or request.headers.get("X-User-Id")
        if hdr and str(hdr).strip():
            return str(hdr).strip()
    return None


def _require_lease(firm_id: str, lease_id: str) -> dict:
    row = ifrs16_db.get_lease(firm_id, lease_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Lease {lease_id} not found")
    return row


class LeaseUpsertRequest(BaseModel):
    lease_data: Dict[str, Any] = Field(..., description="Full LeaseRepositoryEntry JSON")


class LeaseUpdateRequest(BaseModel):
    lease_data: Dict[str, Any]


class SaveCalculationRequest(BaseModel):
    results: Optional[Dict[str, Any]] = None
    summary: Optional[Dict[str, Any]] = None
    amortization_schedule: Optional[List[Any]] = None
    journal_entries: Optional[List[Any]] = None
    disclosure_notes: Optional[Any] = None
    excel_file_id: Optional[str] = None


class ModificationRequest(BaseModel):
    modification_date: Optional[str] = None
    modification_type: str
    modification_reason: Optional[str] = None
    before_liability: Optional[float] = None
    before_rou_asset: Optional[float] = None
    before_term_months: Optional[int] = None
    before_payment: Optional[float] = None
    before_ibr: Optional[float] = None
    after_liability: Optional[float] = None
    after_rou_asset: Optional[float] = None
    after_term_months: Optional[int] = None
    after_payment: Optional[float] = None
    after_ibr: Optional[float] = None
    modification_journal: Optional[Dict[str, Any]] = None
    gain_loss_amount: float = 0.0
    gain_loss_type: Optional[str] = None
    new_status: Optional[str] = None
    changed_by: Optional[str] = None


@router.post("/add")
async def add_lease(
    body: LeaseUpsertRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
):
    firm_id = _ifrs16_firm_id(request, x_firm_id)
    uid = _user_id(request, x_user_id)
    try:
        row = ifrs16_db.upsert_lease(firm_id, body.lease_data, user_id=uid)
        return {"success": True, "lease": row}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": "Database error", "detail": str(e)})


@router.get("/list")
async def list_leases(
    request: Request,
    status: Optional[str] = Query(None),
    limit: int = Query(500, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    x_firm_id: Optional[str] = Header(None),
):
    firm_id = _ifrs16_firm_id(request, x_firm_id)
    try:
        rows = ifrs16_db.get_portfolio(firm_id, status=status, limit=limit, offset=offset)
        leases = [r.get("lease_data") or {} for r in rows]
        return {"success": True, "leases": leases, "count": len(leases)}
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": "Database error", "detail": str(e)})


@router.get("/summary/portfolio")
async def portfolio_summary(
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    firm_id = _ifrs16_firm_id(request, x_firm_id)
    try:
        return {"success": True, "summary": ifrs16_db.get_portfolio_summary(firm_id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": "Database error", "detail": str(e)})


@router.get("/audit/log")
async def audit_log(
    request: Request,
    lease_id: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    x_firm_id: Optional[str] = Header(None),
):
    firm_id = _ifrs16_firm_id(request, x_firm_id)
    try:
        logs = ifrs16_db.get_audit_log(firm_id, lease_id=lease_id, limit=limit)
        return {"success": True, "audit_log": logs, "count": len(logs)}
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": "Database error", "detail": str(e)})


@router.get("/{lease_id}")
async def get_single_lease(
    lease_id: str,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    firm_id = _ifrs16_firm_id(request, x_firm_id)
    row = _require_lease(firm_id, lease_id)
    return {"success": True, "lease": row.get("lease_data") or {}, "row": row}


@router.put("/{lease_id}")
async def update_lease(
    lease_id: str,
    body: LeaseUpdateRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
):
    firm_id = _ifrs16_firm_id(request, x_firm_id)
    _require_lease(firm_id, lease_id)
    uid = _user_id(request, x_user_id)
    data = dict(body.lease_data)
    data.setdefault("id", lease_id)
    data.setdefault("lease_id", lease_id)
    try:
        row = ifrs16_db.upsert_lease(firm_id, data, user_id=uid)
        return {"success": True, "lease": row.get("lease_data") or data}
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": "Database error", "detail": str(e)})


@router.post("/{lease_id}/save-calculation")
async def save_calculation(
    lease_id: str,
    body: SaveCalculationRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
):
    firm_id = _ifrs16_firm_id(request, x_firm_id)
    _require_lease(firm_id, lease_id)
    uid = _user_id(request, x_user_id)
    try:
        row = ifrs16_db.save_calculation(firm_id, lease_id, body.model_dump(), user_id=uid)
        return {"success": True, "lease": row.get("lease_data") or {}}
    except LookupError:
        raise HTTPException(status_code=404, detail=f"Lease {lease_id} not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": "Database error", "detail": str(e)})


@router.delete("/{lease_id}")
async def delete_lease(
    lease_id: str,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
):
    firm_id = _ifrs16_firm_id(request, x_firm_id)
    _require_lease(firm_id, lease_id)
    uid = _user_id(request, x_user_id)
    ifrs16_db.delete_lease(firm_id, lease_id, user_id=uid)
    return {"success": True, "message": f"Lease {lease_id} deleted"}


@router.post("/{lease_id}/modifications")
async def record_modification(
    lease_id: str,
    body: ModificationRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
):
    firm_id = _ifrs16_firm_id(request, x_firm_id)
    _require_lease(firm_id, lease_id)
    uid = _user_id(request, x_user_id)
    try:
        mod = ifrs16_db.add_modification(firm_id, lease_id, body.model_dump(), user_id=uid)
        return {"success": True, "modification": mod}
    except LookupError:
        raise HTTPException(status_code=404, detail=f"Lease {lease_id} not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": "Database error", "detail": str(e)})


@router.get("/{lease_id}/modifications")
async def list_modifications(
    lease_id: str,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    firm_id = _ifrs16_firm_id(request, x_firm_id)
    _require_lease(firm_id, lease_id)
    mods = ifrs16_db.get_modifications(firm_id, lease_id)
    return {"success": True, "modifications": mods, "count": len(mods)}
