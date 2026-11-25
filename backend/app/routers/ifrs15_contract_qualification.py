"""IFRS 15 Step 1 Contract Qualification Gate (IFRS 15.9).

Workflow:
  preparer: POST /start  →  PATCH /{id}/criteria  →  POST /{id}/submit
  reviewer: POST /{id}/approve  |  POST /{id}/reject
  calculator: GET /{contract_id}/gate-status  (called by calculation endpoint)
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from backend.app.dependencies.auth import get_verified_firm_id
from backend.app.services.ifrs15_contract_qualification_db import qualification_db
from backend.app.services.supabase_client import get_supabase_client, is_supabase_configured

router = APIRouter(
    prefix="/api/ifrs15/contract-qualification",
    tags=["ifrs15-contract-qualification"],
    dependencies=[Depends(get_verified_firm_id)],
)

VALID_STATUSES = {"not_started", "in_progress", "submitted", "passed", "failed", "rejected"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_db() -> None:
    if not is_supabase_configured():
        raise HTTPException(status_code=503, detail="Supabase is not configured")


def _firm_id(request: Request, x_firm_id: Optional[str] = None) -> str:
    if x_firm_id and str(x_firm_id).strip():
        return str(x_firm_id).strip()
    hdr = request.headers.get("x-firm-id") or request.headers.get("X-Firm-Id")
    if hdr and str(hdr).strip():
        return str(hdr).strip()
    return os.getenv("IFRS15_FIRM_ID", "default")


def _require_step1_gate(firm_id: str) -> bool:
    """Return True if this firm has the Step 1 gate enabled."""
    try:
        client = get_supabase_client()
        resp = client.table("firms").select("require_step1_gate").eq("firm_id", firm_id).limit(1).execute()
        rows = resp.data or []
        if rows:
            return bool(rows[0].get("require_step1_gate"))
    except Exception:
        pass
    return False


def _all_criteria_set(row: dict) -> bool:
    return all(
        row.get(f"c{i}_{name}") is not None
        for i, name in [
            (1, "approval"),
            (2, "rights"),
            (3, "payment_terms"),
            (4, "commercial_substance"),
            (5, "collection_probable"),
        ]
    )


def _all_criteria_passed(row: dict) -> bool:
    return all(
        row.get(f"c{i}_{name}") is True
        for i, name in [
            (1, "approval"),
            (2, "rights"),
            (3, "payment_terms"),
            (4, "commercial_substance"),
            (5, "collection_probable"),
        ]
    )


# ── Request models ─────────────────────────────────────────────────────────────

class StartRequest(BaseModel):
    contract_id: str
    portfolio_id: Optional[str] = None
    preparer_id: Optional[str] = None


class CriteriaRequest(BaseModel):
    c1_approval: Optional[bool] = None
    c1_note: Optional[str] = None
    c1_evidence_ref: Optional[str] = None

    c2_rights: Optional[bool] = None
    c2_note: Optional[str] = None
    c2_evidence_ref: Optional[str] = None

    c3_payment_terms: Optional[bool] = None
    c3_note: Optional[str] = None
    c3_evidence_ref: Optional[str] = None

    c4_commercial_substance: Optional[bool] = None
    c4_note: Optional[str] = None
    c4_evidence_ref: Optional[str] = None

    c5_collection_probable: Optional[bool] = None
    c5_note: Optional[str] = None
    c5_evidence_ref: Optional[str] = None

    missing_evidence_notes: Optional[str] = None


class SubmitRequest(BaseModel):
    preparer_id: str


class ApproveRequest(BaseModel):
    reviewer_id: str
    reviewer_notes: Optional[str] = None


class RejectRequest(BaseModel):
    reviewer_id: str
    rejection_reason: str = Field(..., min_length=10)


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/start")
async def start_qualification(
    body: StartRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    firm_id = _firm_id(request, x_firm_id)

    existing = qualification_db.get_by_contract(firm_id, body.contract_id)
    if existing and existing.get("status") not in {"rejected", "failed"}:
        return {"success": True, "qualification": existing, "created": False}

    row = qualification_db.insert(
        {
            "firm_id": firm_id,
            "contract_id": body.contract_id,
            "portfolio_id": body.portfolio_id,
            "preparer_id": body.preparer_id,
            "status": "in_progress",
        }
    )
    qualification_db.add_audit(
        row["id"], "created", actor=body.preparer_id, new_value={"contract_id": body.contract_id}
    )
    return {"success": True, "qualification": row, "created": True}


@router.patch("/{qualification_id}/criteria")
async def update_criteria(
    qualification_id: str,
    body: CriteriaRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    firm_id = _firm_id(request, x_firm_id)
    row = qualification_db.get(qualification_id, firm_id)
    if not row:
        raise HTTPException(status_code=404, detail="Qualification not found")
    if row.get("status") not in {"in_progress", "not_started"}:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot update criteria in status '{row['status']}'"
        )

    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(status_code=400, detail="No criteria provided")

    updated = qualification_db.update(qualification_id, patch, firm_id)
    qualification_db.add_audit(
        qualification_id, "criteria_updated", new_value=patch
    )
    return {"success": True, "qualification": updated}


@router.post("/{qualification_id}/submit")
async def submit_for_review(
    qualification_id: str,
    body: SubmitRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    firm_id = _firm_id(request, x_firm_id)
    row = qualification_db.get(qualification_id, firm_id)
    if not row:
        raise HTTPException(status_code=404, detail="Qualification not found")
    if row.get("status") not in {"in_progress", "not_started"}:
        raise HTTPException(status_code=400, detail="Qualification is not in a submittable state")

    if not _all_criteria_set(row):
        missing = [
            f"c{i}_{name}"
            for i, name in [
                (1, "approval"), (2, "rights"), (3, "payment_terms"),
                (4, "commercial_substance"), (5, "collection_probable"),
            ]
            if row.get(f"c{i}_{name}") is None
        ]
        raise HTTPException(
            status_code=422,
            detail={"error": "INCOMPLETE_CRITERIA", "missing": missing},
        )

    updated = qualification_db.update(
        qualification_id,
        {"status": "submitted", "preparer_id": body.preparer_id, "submitted_at": _now()},
        firm_id,
    )
    qualification_db.add_audit(
        qualification_id, "submitted", actor=body.preparer_id
    )
    return {"success": True, "qualification": updated}


@router.post("/{qualification_id}/approve")
async def approve_qualification(
    qualification_id: str,
    body: ApproveRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    firm_id = _firm_id(request, x_firm_id)
    row = qualification_db.get(qualification_id, firm_id)
    if not row:
        raise HTTPException(status_code=404, detail="Qualification not found")
    if row.get("status") != "submitted":
        raise HTTPException(status_code=400, detail="Qualification must be in 'submitted' status to approve")

    # Segregation of duties: reviewer cannot be the preparer
    if body.reviewer_id and row.get("preparer_id") and body.reviewer_id == row["preparer_id"]:
        raise HTTPException(
            status_code=400,
            detail={"error": "SELF_APPROVAL_FORBIDDEN", "message": "Reviewer cannot be the preparer"},
        )

    new_status = "passed" if _all_criteria_passed(row) else "failed"
    now = _now()
    updated = qualification_db.update(
        qualification_id,
        {
            "status": new_status,
            "reviewer_id": body.reviewer_id,
            "reviewed_at": now,
            "approved_by": body.reviewer_id,
            "approved_at": now,
        },
        firm_id,
    )

    # Update portfolio qualification_status
    if row.get("portfolio_id"):
        try:
            from backend.app.services.supabase_client import get_supabase_client
            client = get_supabase_client()
            client.table("ifrs15_portfolios").update(
                {"qualification_status": new_status}
            ).eq("id", row["portfolio_id"]).execute()
        except Exception:
            pass

    qualification_db.add_audit(
        qualification_id,
        "approved",
        actor=body.reviewer_id,
        new_value={"status": new_status},
    )
    return {"success": True, "qualification": updated, "result": new_status}


@router.post("/{qualification_id}/reject")
async def reject_qualification(
    qualification_id: str,
    body: RejectRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    firm_id = _firm_id(request, x_firm_id)
    row = qualification_db.get(qualification_id, firm_id)
    if not row:
        raise HTTPException(status_code=404, detail="Qualification not found")
    if row.get("status") not in {"submitted", "in_progress"}:
        raise HTTPException(status_code=400, detail="Qualification cannot be rejected in its current status")

    if body.reviewer_id and row.get("preparer_id") and body.reviewer_id == row["preparer_id"]:
        raise HTTPException(
            status_code=400,
            detail={"error": "SELF_APPROVAL_FORBIDDEN", "message": "Reviewer cannot be the preparer"},
        )

    updated = qualification_db.update(
        qualification_id,
        {
            "status": "rejected",
            "reviewer_id": body.reviewer_id,
            "reviewed_at": _now(),
            "rejection_reason": body.rejection_reason,
        },
        firm_id,
    )
    qualification_db.add_audit(
        qualification_id,
        "rejected",
        actor=body.reviewer_id,
        note=body.rejection_reason,
    )
    return {"success": True, "qualification": updated}


@router.get("/gate-status/{contract_id}")
async def gate_status(
    contract_id: str,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    """
    Called by the calculation endpoint to check whether Step 1 is required and passed.
    Returns: {"gate_enabled": bool, "qualified": bool, "status": str, "qualification": dict|None}
    """
    _require_db()
    firm_id = _firm_id(request, x_firm_id)
    gate_enabled = _require_step1_gate(firm_id)
    qual = qualification_db.get_by_contract(firm_id, contract_id)

    status = qual["status"] if qual else "not_started"
    qualified = status == "passed"

    return {
        "gate_enabled": gate_enabled,
        "qualified": qualified,
        "status": status,
        "qualification": qual,
        "blocked": gate_enabled and not qualified,
    }


@router.get("/")
async def list_qualifications(
    request: Request,
    x_firm_id: Optional[str] = Header(None),
    status: Optional[str] = None,
):
    _require_db()
    firm_id = _firm_id(request, x_firm_id)
    rows = qualification_db.list_by_firm(firm_id, status=status)
    return {"success": True, "qualifications": rows, "count": len(rows)}


@router.get("/{qualification_id}/audit")
async def get_audit(
    qualification_id: str,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    firm_id = _firm_id(request, x_firm_id)
    # Verify ownership before returning audit trail
    row = qualification_db.get(qualification_id, firm_id)
    if not row:
        raise HTTPException(status_code=404, detail="Qualification not found")
    trail = qualification_db.list_audit(qualification_id)
    return {"success": True, "audit_trail": trail}
