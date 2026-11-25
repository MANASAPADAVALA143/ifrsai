"""IFRS 15 Staged Journal Approval Workflow (Task 6).

Status lifecycle: draft → pending_review → approved → posted / failed / reversed

Journals cannot be posted to ERP until status == 'approved'.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

from backend.app.dependencies.auth import get_verified_firm_id
from backend.app.services.ifrs15_staged_journals_db import (
    compute_totals,
    staged_journals_db,
)
from backend.app.services.supabase_client import is_supabase_configured

router = APIRouter(
    prefix="/api/ifrs15/journals",
    tags=["ifrs15-staged-journals"],
    dependencies=[Depends(get_verified_firm_id)],
)


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


def _validate_lines(lines: list[dict]) -> list[str]:
    """Return list of validation errors; empty list = valid."""
    errors: list[str] = []
    if not lines:
        errors.append("Journal must have at least one line")
        return errors
    for i, line in enumerate(lines):
        dr = Decimal(str(line.get("debit") or 0))
        cr = Decimal(str(line.get("credit") or 0))
        if dr < 0 or cr < 0:
            errors.append(f"Line {i}: debit and credit must be non-negative")
        if dr > 0 and cr > 0:
            errors.append(f"Line {i}: a line cannot have both debit and credit")
        if not line.get("account"):
            errors.append(f"Line {i}: account name is required")
    total_dr, total_cr = compute_totals(lines)
    if abs(float(total_dr) - float(total_cr)) >= 0.01:
        errors.append(
            f"Journal does not balance: debit {total_dr} ≠ credit {total_cr}"
        )
    return errors


# ── Request models ─────────────────────────────────────────────────────────────

class JournalLineModel(BaseModel):
    account: str
    account_code: Optional[str] = None
    debit: float = 0.0
    credit: float = 0.0
    memo: Optional[str] = None


class CreateJournalRequest(BaseModel):
    contract_id: Optional[str] = None
    source_type: str = "ifrs15_calculation"
    source_id: Optional[str] = None
    je_date: str
    description: Optional[str] = None
    currency: str = "AED"
    reference: Optional[str] = None
    lines: list[JournalLineModel]
    erp_type: Optional[str] = None
    prepared_by: Optional[str] = None


class SubmitRequest(BaseModel):
    prepared_by: str


class ApproveRequest(BaseModel):
    reviewer_id: str
    reviewer_notes: Optional[str] = None


class PostRequest(BaseModel):
    actor: str
    erp_type: Optional[str] = None


class ReverseRequest(BaseModel):
    reversed_by: str
    reason: str = Field(..., min_length=5)


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/")
async def create_journal(
    body: CreateJournalRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    firm_id = _firm_id(request, x_firm_id)

    lines = [ln.model_dump() for ln in body.lines]
    errors = _validate_lines(lines)
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors})

    total_dr, total_cr = compute_totals(lines)

    row = staged_journals_db.insert(
        {
            "firm_id": firm_id,
            "contract_id": body.contract_id,
            "source_type": body.source_type,
            "source_id": body.source_id,
            "je_date": body.je_date[:10],
            "description": body.description,
            "currency": body.currency,
            "reference": body.reference,
            "lines": lines,
            "total_debit": float(total_dr),
            "total_credit": float(total_cr),
            "erp_type": body.erp_type,
            "prepared_by": body.prepared_by,
            "status": "draft",
        }
    )
    staged_journals_db.add_audit(
        row["id"], "created", actor=body.prepared_by,
        new_status="draft",
    )
    return {"success": True, "journal": row}


@router.post("/{journal_id}/submit")
async def submit_journal(
    journal_id: str,
    body: SubmitRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    firm_id = _firm_id(request, x_firm_id)
    row = staged_journals_db.get(journal_id, firm_id)
    if not row:
        raise HTTPException(status_code=404, detail="Journal not found")
    if row.get("status") != "draft":
        raise HTTPException(status_code=400, detail="Only draft journals can be submitted")

    updated = staged_journals_db.update(
        journal_id,
        {"status": "pending_review", "prepared_by": body.prepared_by, "submitted_at": _now()},
        firm_id,
    )
    staged_journals_db.add_audit(
        journal_id, "submitted", actor=body.prepared_by,
        old_status="draft", new_status="pending_review",
    )
    return {"success": True, "journal": updated}


@router.post("/{journal_id}/approve")
async def approve_journal(
    journal_id: str,
    body: ApproveRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    firm_id = _firm_id(request, x_firm_id)
    row = staged_journals_db.get(journal_id, firm_id)
    if not row:
        raise HTTPException(status_code=404, detail="Journal not found")
    if row.get("status") != "pending_review":
        raise HTTPException(
            status_code=400,
            detail="Journal must be in 'pending_review' status to approve",
        )

    if body.reviewer_id and row.get("prepared_by") and body.reviewer_id == row["prepared_by"]:
        raise HTTPException(
            status_code=400,
            detail={"error": "SELF_APPROVAL_FORBIDDEN", "message": "Reviewer cannot be the preparer"},
        )

    # Re-validate balance at approval time
    lines = row.get("lines") or []
    errors = _validate_lines(lines)
    if errors:
        raise HTTPException(
            status_code=422,
            detail={"error": "JOURNAL_INVALID_AT_APPROVAL", "errors": errors},
        )

    now = _now()
    updated = staged_journals_db.update(
        journal_id,
        {
            "status": "approved",
            "reviewer_id": body.reviewer_id,
            "reviewed_at": now,
            "approved_by": body.reviewer_id,
            "approved_at": now,
        },
        firm_id,
    )
    staged_journals_db.add_audit(
        journal_id, "approved", actor=body.reviewer_id,
        old_status="pending_review", new_status="approved",
    )
    return {"success": True, "journal": updated}


@router.post("/{journal_id}/post")
async def post_journal(
    journal_id: str,
    body: PostRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    """Push an approved journal to ERP. Blocked if status != 'approved'."""
    _require_db()
    firm_id = _firm_id(request, x_firm_id)

    # Verify the journal exists and belongs to this firm before attempting CAS.
    existing = staged_journals_db.get(journal_id, firm_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Journal not found")

    # Atomically claim the journal for posting (approved → posting).
    # Returns None if another concurrent request already claimed it.
    row = staged_journals_db.claim_for_posting(journal_id, firm_id)
    if not row:
        current_status = existing.get("status")
        if current_status == "approved":
            raise HTTPException(status_code=409, detail="Journal is already being posted by another request")
        raise HTTPException(
            status_code=400,
            detail={
                "error": "JOURNAL_NOT_APPROVED",
                "message": "Journals must be approved before posting to ERP",
                "current_status": current_status,
            },
        )

    erp_type = body.erp_type or row.get("erp_type") or "manual"
    erp_ref: Optional[str] = None
    erp_response: dict = {}
    failure_reason: Optional[str] = None
    new_status = "posted"

    try:
        erp_ref, erp_response = _push_to_erp(row, erp_type)
    except NotImplementedError as e:
        failure_reason = str(e)
        new_status = "failed"
    except Exception as e:
        failure_reason = f"ERP push failed: {e}"
        new_status = "failed"

    now = _now()
    patch: dict[str, Any] = {
        "status": new_status,
        "erp_type": erp_type,
        "erp_ref": erp_ref,
        "erp_response": erp_response,
        "failure_reason": failure_reason,
    }
    if new_status == "posted":
        patch["posted_at"] = now
    updated = staged_journals_db.update(journal_id, patch, firm_id)
    staged_journals_db.add_audit(
        journal_id,
        "posted" if new_status == "posted" else "post_failed",
        actor=body.actor,
        old_status="approved",
        new_status=new_status,
        note=failure_reason,
    )
    return {"success": new_status == "posted", "journal": updated, "erp_ref": erp_ref}


@router.post("/{journal_id}/reverse")
async def reverse_journal(
    journal_id: str,
    body: ReverseRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    firm_id = _firm_id(request, x_firm_id)
    row = staged_journals_db.get(journal_id, firm_id)
    if not row:
        raise HTTPException(status_code=404, detail="Journal not found")
    if row.get("status") != "posted":
        raise HTTPException(status_code=400, detail="Only posted journals can be reversed")

    # Create reversal journal with flipped lines
    orig_lines = row.get("lines") or []
    rev_lines = [
        {**ln, "debit": ln.get("credit", 0), "credit": ln.get("debit", 0)}
        for ln in orig_lines
    ]
    total_dr, total_cr = compute_totals(rev_lines)
    firm_id = row["firm_id"]
    reversal = staged_journals_db.insert(
        {
            "firm_id": firm_id,
            "contract_id": row.get("contract_id"),
            "source_type": row.get("source_type"),
            "source_id": row.get("source_id"),
            "je_date": _now()[:10],
            "description": f"Reversal of {row.get('reference') or journal_id}",
            "currency": row.get("currency", "AED"),
            "reference": f"REV-{row.get('reference') or journal_id}",
            "lines": rev_lines,
            "total_debit": float(total_dr),
            "total_credit": float(total_cr),
            "erp_type": row.get("erp_type"),
            "prepared_by": body.reversed_by,
            "status": "draft",
            "reversal_of": journal_id,
        }
    )
    updated = staged_journals_db.update(
        journal_id,
        {"status": "reversed", "reversed_by": body.reversed_by, "reversed_at": _now()},
        firm_id,
    )
    staged_journals_db.add_audit(
        journal_id, "reversed", actor=body.reversed_by,
        old_status="posted", new_status="reversed", note=body.reason,
    )
    return {"success": True, "original": updated, "reversal_draft": reversal}


@router.get("/")
async def list_journals(
    request: Request,
    x_firm_id: Optional[str] = Header(None),
    status: Optional[str] = Query(None),
    source_type: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
):
    _require_db()
    firm_id = _firm_id(request, x_firm_id)
    rows = staged_journals_db.list_by_firm(
        firm_id, status=status, source_type=source_type, limit=limit
    )
    return {"success": True, "journals": rows, "count": len(rows)}


@router.get("/{journal_id}")
async def get_journal(
    journal_id: str,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    firm_id = _firm_id(request, x_firm_id)
    row = staged_journals_db.get(journal_id, firm_id)
    if not row:
        raise HTTPException(status_code=404, detail="Journal not found")
    audit = staged_journals_db.list_audit(journal_id)
    return {"success": True, "journal": row, "audit_trail": audit}


# ── ERP dispatch ───────────────────────────────────────────────────────────────

def _push_to_erp(row: dict, erp_type: str) -> tuple[Optional[str], dict]:
    """
    Push the approved journal to the ERP. Returns (erp_ref, response_dict).
    Raises NotImplementedError for unimplemented ERPs.
    Raises Exception on ERP errors.
    """
    if erp_type == "zoho_books":
        from erp_integrations.zoho_books import ZohoBooksClient
        client = ZohoBooksClient()
        result = client.push_journal(
            {
                "reference_number": row.get("reference"),
                "date": str(row.get("je_date")),
                "currency_code": row.get("currency", "AED"),
                "notes": row.get("description"),
                "line_items": [
                    {
                        "account_id": ln.get("account_code") or ln.get("account"),
                        "debit_or_credit": "debit" if float(ln.get("debit", 0)) > 0 else "credit",
                        "amount": float(ln.get("debit", 0)) or float(ln.get("credit", 0)),
                        "description": ln.get("memo"),
                    }
                    for ln in (row.get("lines") or [])
                ],
            }
        )
        return result.get("journalentry_id"), result

    if erp_type == "tally_prime":
        from erp_integrations.tally_prime import TallyPrimeClient
        client = TallyPrimeClient()
        result = client.push_voucher(row)
        return result.get("ref"), result

    if erp_type in {"sap_b1", "oracle_netsuite", "dynamics_365"}:
        raise NotImplementedError(
            f"{erp_type} integration is not yet implemented. Stage the journal and post manually."
        )

    # manual / unknown — mark as posted without ERP push
    return f"MANUAL-{row['id'][:8].upper()}", {"erp_type": "manual", "note": "Posted manually"}
