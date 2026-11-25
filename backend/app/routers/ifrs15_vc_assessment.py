"""IFRS 15 Variable Consideration Structured Assessment (IFRS 15.56-58).

Workflow:
  preparer: POST /  →  PATCH /{id}  →  POST /{id}/submit
  reviewer: POST /{id}/approve  |  POST /{id}/reject
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field, model_validator

from backend.app.dependencies.auth import get_verified_firm_id
from backend.app.services.ifrs15_vc_assessment_db import vc_assessment_db
from backend.app.services.supabase_client import is_supabase_configured

router = APIRouter(
    prefix="/api/ifrs15/vc-assessment",
    tags=["ifrs15-vc-assessment"],
    dependencies=[Depends(get_verified_firm_id)],
)

VALID_METHODS = {"expected_value", "most_likely_amount"}
VALID_SEVERITIES = {"low", "medium", "high", None}


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


def _compute_ev(body_dict: dict) -> Optional[float]:
    """Compute expected value from three-scenario inputs. Returns None if inputs missing."""
    try:
        h_amt = Decimal(str(body_dict.get("ev_scenario_high_amount") or 0))
        h_prob = Decimal(str(body_dict.get("ev_scenario_high_prob") or 0))
        b_amt = Decimal(str(body_dict.get("ev_scenario_base_amount") or 0))
        b_prob = Decimal(str(body_dict.get("ev_scenario_base_prob") or 0))
        l_amt = Decimal(str(body_dict.get("ev_scenario_low_amount") or 0))
        l_prob = Decimal(str(body_dict.get("ev_scenario_low_prob") or 0))
        # Probabilities must sum to 1 within tolerance
        prob_sum = h_prob + b_prob + l_prob
        if abs(float(prob_sum) - 1.0) > 0.001:
            return None
        ev = (h_amt * h_prob) + (b_amt * b_prob) + (l_amt * l_prob)
        return float(ev.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))
    except Exception:
        return None


# ── Request models ─────────────────────────────────────────────────────────────

class CreateRequest(BaseModel):
    contract_id: str
    portfolio_id: Optional[str] = None
    preparer_id: Optional[str] = None
    method: str = "expected_value"

    @model_validator(mode="after")
    def check_method(self) -> "CreateRequest":
        if self.method not in VALID_METHODS:
            raise ValueError(f"method must be one of {VALID_METHODS}")
        return self


class UpdateRequest(BaseModel):
    method: Optional[str] = None

    # EV inputs
    ev_scenario_high_amount: Optional[float] = None
    ev_scenario_high_prob: Optional[float] = Field(None, ge=0, le=1)
    ev_scenario_base_amount: Optional[float] = None
    ev_scenario_base_prob: Optional[float] = Field(None, ge=0, le=1)
    ev_scenario_low_amount: Optional[float] = None
    ev_scenario_low_prob: Optional[float] = Field(None, ge=0, le=1)

    # MLA input
    mla_amount: Optional[float] = None

    # Seven constraint factors (IFRS 15.57)
    f1_present: Optional[bool] = None
    f1_severity: Optional[str] = None
    f1_note: Optional[str] = None

    f2_present: Optional[bool] = None
    f2_severity: Optional[str] = None
    f2_note: Optional[str] = None

    f3_present: Optional[bool] = None
    f3_severity: Optional[str] = None
    f3_note: Optional[str] = None

    f4_present: Optional[bool] = None
    f4_severity: Optional[str] = None
    f4_note: Optional[str] = None

    f5_present: Optional[bool] = None
    f5_severity: Optional[str] = None
    f5_note: Optional[str] = None

    # Constraint conclusion — preparer's judgment; AI must not set this
    constraint_applied: Optional[bool] = None
    constrained_vc_amount: Optional[float] = None

    preparer_commentary: Optional[str] = None
    evidence_ref: Optional[str] = None


class SubmitRequest(BaseModel):
    preparer_id: str


class ApproveRequest(BaseModel):
    reviewer_id: str
    reviewer_notes: Optional[str] = None


class RejectRequest(BaseModel):
    reviewer_id: str
    rejection_reason: str = Field(..., min_length=10)


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/")
async def create_assessment(
    body: CreateRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    firm_id = _firm_id(request, x_firm_id)
    row = vc_assessment_db.insert(
        {
            "firm_id": firm_id,
            "contract_id": body.contract_id,
            "portfolio_id": body.portfolio_id,
            "preparer_id": body.preparer_id,
            "method": body.method,
            "status": "draft",
        }
    )
    vc_assessment_db.add_audit(
        row["id"], "created", actor=body.preparer_id,
        new_value={"contract_id": body.contract_id, "method": body.method},
    )
    return {"success": True, "assessment": row}


@router.patch("/{assessment_id}")
async def update_assessment(
    assessment_id: str,
    body: UpdateRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    firm_id = _firm_id(request, x_firm_id)
    row = vc_assessment_db.get(assessment_id, firm_id)
    if not row:
        raise HTTPException(status_code=404, detail="VC assessment not found")
    if row.get("status") not in {"draft", "rejected"}:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot update assessment in status '{row['status']}'"
        )

    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(status_code=400, detail="No fields provided")

    # Auto-compute EV if EV inputs are present
    merged = {**row, **patch}
    if merged.get("method") == "expected_value":
        ev = _compute_ev(merged)
        if ev is not None:
            patch["ev_calculated_amount"] = ev

    updated = vc_assessment_db.update(assessment_id, patch, firm_id)
    vc_assessment_db.add_audit(assessment_id, "updated", new_value=patch)
    return {"success": True, "assessment": updated}


@router.post("/{assessment_id}/submit")
async def submit_assessment(
    assessment_id: str,
    body: SubmitRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    firm_id = _firm_id(request, x_firm_id)
    row = vc_assessment_db.get(assessment_id, firm_id)
    if not row:
        raise HTTPException(status_code=404, detail="VC assessment not found")
    if row.get("status") not in {"draft", "rejected"}:
        raise HTTPException(status_code=400, detail="Assessment is not in a submittable state")

    # Require preparer commentary before submission
    if not (row.get("preparer_commentary") or "").strip():
        raise HTTPException(
            status_code=422,
            detail={"error": "MISSING_COMMENTARY", "message": "Preparer commentary is required before submission"},
        )

    # Require that the preparer has explicitly set constraint_applied
    if row.get("constraint_applied") is None:
        raise HTTPException(
            status_code=422,
            detail={"error": "CONSTRAINT_NOT_SET", "message": "Preparer must state whether the VC constraint applies"},
        )

    updated = vc_assessment_db.update(
        assessment_id,
        {"status": "submitted", "preparer_id": body.preparer_id, "submitted_at": _now()},
        firm_id,
    )
    vc_assessment_db.add_audit(assessment_id, "submitted", actor=body.preparer_id)
    return {"success": True, "assessment": updated}


@router.post("/{assessment_id}/approve")
async def approve_assessment(
    assessment_id: str,
    body: ApproveRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    firm_id = _firm_id(request, x_firm_id)
    row = vc_assessment_db.get(assessment_id, firm_id)
    if not row:
        raise HTTPException(status_code=404, detail="VC assessment not found")
    if row.get("status") != "submitted":
        raise HTTPException(status_code=400, detail="Assessment must be in 'submitted' status to approve")

    if body.reviewer_id and row.get("preparer_id") and body.reviewer_id == row["preparer_id"]:
        raise HTTPException(
            status_code=400,
            detail={"error": "SELF_APPROVAL_FORBIDDEN", "message": "Reviewer cannot be the preparer"},
        )

    # Set approved_vc_amount: constrained amount if constraint applied, else calculated/MLA
    approved_amt = None
    if row.get("constraint_applied"):
        approved_amt = row.get("constrained_vc_amount")
    elif row.get("method") == "expected_value":
        approved_amt = row.get("ev_calculated_amount")
    else:
        approved_amt = row.get("mla_amount")

    now = _now()
    updated = vc_assessment_db.update(
        assessment_id,
        {
            "status": "approved",
            "reviewer_id": body.reviewer_id,
            "reviewed_at": now,
            "approved_by": body.reviewer_id,
            "approved_at": now,
            "approved_vc_amount": approved_amt,
            "reviewer_notes": body.reviewer_notes,
        },
        firm_id,
    )
    vc_assessment_db.add_audit(
        assessment_id,
        "approved",
        actor=body.reviewer_id,
        new_value={"approved_vc_amount": approved_amt},
    )
    return {"success": True, "assessment": updated}


@router.post("/{assessment_id}/reject")
async def reject_assessment(
    assessment_id: str,
    body: RejectRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    firm_id = _firm_id(request, x_firm_id)
    row = vc_assessment_db.get(assessment_id, firm_id)
    if not row:
        raise HTTPException(status_code=404, detail="VC assessment not found")
    if row.get("status") not in {"submitted", "draft"}:
        raise HTTPException(status_code=400, detail="Assessment cannot be rejected in its current status")

    if body.reviewer_id and row.get("preparer_id") and body.reviewer_id == row["preparer_id"]:
        raise HTTPException(
            status_code=400,
            detail={"error": "SELF_APPROVAL_FORBIDDEN", "message": "Reviewer cannot be the preparer"},
        )

    updated = vc_assessment_db.update(
        assessment_id,
        {
            "status": "rejected",
            "reviewer_id": body.reviewer_id,
            "reviewed_at": _now(),
            "rejection_reason": body.rejection_reason,
        },
        firm_id,
    )
    vc_assessment_db.add_audit(
        assessment_id, "rejected", actor=body.reviewer_id, note=body.rejection_reason
    )
    return {"success": True, "assessment": updated}


@router.get("/latest/{contract_id}")
async def get_latest(
    contract_id: str,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    firm_id = _firm_id(request, x_firm_id)
    row = vc_assessment_db.get_latest(firm_id, contract_id)
    if not row:
        raise HTTPException(status_code=404, detail="No VC assessment found for this contract")
    return {"success": True, "assessment": row}


@router.get("/")
async def list_assessments(
    request: Request,
    x_firm_id: Optional[str] = Header(None),
    status: Optional[str] = None,
):
    _require_db()
    firm_id = _firm_id(request, x_firm_id)
    rows = vc_assessment_db.list_by_firm(firm_id, status=status)
    return {"success": True, "assessments": rows, "count": len(rows)}


@router.get("/{assessment_id}/audit")
async def get_audit(
    assessment_id: str,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    firm_id = _firm_id(request, x_firm_id)
    row = vc_assessment_db.get(assessment_id, firm_id)
    if not row:
        raise HTTPException(status_code=404, detail="VC assessment not found")
    trail = vc_assessment_db.list_audit(assessment_id)
    return {"success": True, "audit_trail": trail}
