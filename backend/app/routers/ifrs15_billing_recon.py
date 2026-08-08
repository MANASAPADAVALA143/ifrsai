"""IFRS 15 billing-to-GL reconciliation."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

from backend.app.services.ifrs15_billing_recon_db import billing_recon_db
from backend.app.services.supabase_client import is_supabase_configured

router = APIRouter(prefix="/api/ifrs15/billing-recon", tags=["ifrs15-billing-recon"])

MONEY_Q = Decimal("0.0001")
VALID_TX_TYPES = {"invoice", "credit_note", "payment", "refund"}
VALID_CONTRACT_TYPES = {"uae_real_estate", "saas_subscription"}


def D(value: Any) -> Decimal:
    try:
        return Decimal(str(value or 0)).quantize(MONEY_Q, rounding=ROUND_HALF_UP)
    except Exception:
        return Decimal("0.0000")


def money(value: Decimal) -> float:
    return float(value.quantize(MONEY_Q, rounding=ROUND_HALF_UP))


def _firm_id(request: Request, company_id: Optional[str] = None, x_firm_id: Optional[str] = None) -> str:
    if company_id and str(company_id).strip():
        return str(company_id).strip()
    if x_firm_id and str(x_firm_id).strip():
        return str(x_firm_id).strip()
    hdr = request.headers.get("x-firm-id") or request.headers.get("X-Firm-Id")
    if hdr and str(hdr).strip():
        return str(hdr).strip()
    return os.getenv("IFRS15_FIRM_ID", "default")


def _require_db() -> None:
    if not is_supabase_configured():
        raise HTTPException(status_code=503, detail="Supabase is not configured")


def _period_from_date(raw: str) -> str:
    text = str(raw or "").strip()[:10]
    dt = datetime.strptime(text, "%Y-%m-%d").date()
    return f"{dt.year:04d}-{dt.month:02d}"


def _detect_contract_type(row: dict[str, Any]) -> str:
    explicit = str(row.get("contract_type") or "").strip()
    if explicit in VALID_CONTRACT_TYPES:
        return explicit
    if str(row.get("milestone_ref") or "").strip():
        return "uae_real_estate"
    ext = str(row.get("external_ref") or "").strip()
    if ext.startswith("ch_"):
        return "saas_subscription"
    return "saas_subscription"


def _account_digits(code: str) -> int:
    digits = "".join(c for c in str(code or "") if c.isdigit())[:4]
    try:
        return int(digits) if digits else 0
    except ValueError:
        return 0


def _posting_type(account_code: str) -> str:
    n = _account_digits(account_code)
    if 4000 <= n <= 4999:
        return "revenue"
    if 2300 <= n <= 2399:
        return "deferred_revenue"
    if 1500 <= n <= 1599:
        return "contract_asset"
    if 1200 <= n <= 1299:
        return "receivable"
    if 1000 <= n <= 1099:
        return "cash"
    return "other"


def _claude_commentary(
    period: str,
    contract_type: str,
    billing_total: Decimal,
    gl_revenue: Decimal,
    gl_deferred: Decimal,
    variance: Decimal,
    variance_pct: Decimal,
    exceptions: list[dict[str, Any]],
) -> str:
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    label = "UAE real estate off-plan" if contract_type == "uae_real_estate" else "B2B SaaS subscription"
    fallback = (
        f"For {period}, billed AED {money(billing_total):,.2f} versus recognised + deferred "
        f"AED {money(gl_revenue + gl_deferred):,.2f} ({label}). Variance of AED {money(variance):,.2f} "
        f"({money(variance_pct):.2f}%) should be investigated under IFRS 15 before close. "
        f"Most likely cause is incomplete journals or timing between billing and recognition. "
        f"Post missing entries or reverse deferred revenue so books match billing reality."
    )
    if not api_key:
        return fallback
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)
        user = (
            f"Period: {period}. Contract type: {contract_type}.\n"
            f"Billing total: AED {money(billing_total)}.\n"
            f"GL Revenue recognized: AED {money(gl_revenue)}.\n"
            f"GL Deferred revenue: AED {money(gl_deferred)}.\n"
            f"Variance: AED {money(variance)} ({money(variance_pct)}%).\n"
            f"Exceptions flagged: {exceptions}.\n"
            f"In 3-4 sentences: explain what this variance means under IFRS 15, "
            f"the most likely root cause, and the recommended corrective action. "
            f"Be specific to {contract_type}."
        )
        msg = client.messages.create(
            model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
            max_tokens=300,
            system=(
                "You are a senior IFRS 15 revenue accountant reviewing a "
                "billing-to-GL reconciliation."
            ),
            messages=[{"role": "user", "content": user}],
        )
        parts = []
        for block in msg.content or []:
            text = getattr(block, "text", None)
            if text:
                parts.append(text)
        return " ".join(parts).strip() or fallback
    except Exception:
        return fallback


class BillingRow(BaseModel):
    transaction_ref: str
    transaction_type: str
    billing_date: str
    amount: Decimal
    currency: str = "AED"
    contract_type: Optional[str] = None
    milestone_ref: Optional[str] = None
    customer_id: Optional[str] = None
    billing_system: Optional[str] = None
    external_ref: Optional[str] = None
    contract_id: Optional[str] = None


class BillingUploadRequest(BaseModel):
    company_id: Optional[str] = None
    rows: list[BillingRow] = Field(default_factory=list)


class GlRow(BaseModel):
    posting_date: str
    account_code: str
    account_name: str
    debit: Decimal = Decimal("0")
    credit: Decimal = Decimal("0")
    journal_ref: Optional[str] = None
    contract_id: Optional[str] = None
    period: Optional[str] = None


class GlUploadRequest(BaseModel):
    company_id: Optional[str] = None
    rows: list[GlRow] = Field(default_factory=list)


class RunRequest(BaseModel):
    company_id: Optional[str] = None
    period: str
    contract_id: Optional[str] = None


class ReviewRequest(BaseModel):
    reviewed_by: str


def _build_exceptions(
    contract_type: str,
    billing_rows: list[dict[str, Any]],
    gl_rows: list[dict[str, Any]],
    billing_total: Decimal,
    gl_revenue: Decimal,
    gl_deferred: Decimal,
    variance: Decimal,
    variance_pct: Decimal,
) -> list[dict[str, Any]]:
    exceptions: list[dict[str, Any]] = []
    gl_books = gl_revenue + gl_deferred

    if abs(variance) > Decimal("100") and variance_pct > Decimal("1"):
        exceptions.append(
            {
                "type": "variance",
                "description": f"Billing vs GL variance of AED {money(variance):,.2f}",
                "amount": money(abs(variance)),
                "action": "Investigate GL postings for missing entries",
            }
        )
    if billing_total > 0 and gl_books == 0:
        exceptions.append(
            {
                "type": "missing_gl",
                "description": "Billing exists but no GL posting found",
                "amount": money(billing_total),
                "action": "Post missing journal entries",
            }
        )
    if billing_total == 0 and gl_books > 0:
        exceptions.append(
            {
                "type": "missing_billing",
                "description": "GL posting exists but no billing record",
                "amount": money(gl_books),
                "action": "Check for manual journals without source invoice",
            }
        )

    if contract_type == "uae_real_estate":
        milestone_billing = [r for r in billing_rows if str(r.get("milestone_ref") or "").strip()]
        has_contract_asset = any(str(g.get("posting_type") or "") == "contract_asset" for g in gl_rows)
        if milestone_billing and not has_contract_asset:
            exceptions.append(
                {
                    "type": "escrow_mismatch",
                    "description": "Milestone billed but escrow release not confirmed",
                    "amount": money(sum((D(r.get("amount")) for r in milestone_billing), Decimal("0"))),
                    "action": "Upload RERA escrow release certificate",
                }
            )

    if contract_type == "saas_subscription":
        has_invoice = any(str(r.get("transaction_type") or "") == "invoice" for r in billing_rows)
        if has_invoice and abs(gl_deferred) < Decimal("0.01"):
            exceptions.append(
                {
                    "type": "deferred_not_reversed",
                    "description": "Subscription renewed but deferred revenue not reduced",
                    "amount": money(billing_total),
                    "action": "Post deferred revenue reversal JE",
                }
            )

    return exceptions


def _status_from_exceptions(exceptions: list[dict[str, Any]]) -> str:
    types = {str(e.get("type") or "") for e in exceptions}
    if not types:
        return "clean"
    if types & {"escrow_mismatch", "deferred_not_reversed"}:
        return "exception"
    if "missing_gl" in types:
        return "missing_gl"
    if "missing_billing" in types:
        return "missing_billing"
    if "variance" in types:
        return "variance"
    return "exception"


def _run_scope(
    company_id: str,
    period: str,
    contract_type: str,
    billing_rows: list[dict[str, Any]],
    gl_rows: list[dict[str, Any]],
    contract_id: Optional[str],
) -> dict[str, Any]:
    billing_total = Decimal("0")
    for row in billing_rows:
        tx = str(row.get("transaction_type") or "")
        amt = D(row.get("amount"))
        if tx in {"invoice", "payment"}:
            billing_total += amt
        elif tx in {"credit_note", "refund"}:
            billing_total -= amt

    gl_revenue = Decimal("0")
    gl_deferred = Decimal("0")
    gl_receivable = Decimal("0")
    for row in gl_rows:
        ptype = str(row.get("posting_type") or _posting_type(str(row.get("account_code") or "")))
        debit = D(row.get("debit"))
        credit = D(row.get("credit"))
        if ptype == "revenue":
            gl_revenue += credit - debit
        elif ptype == "deferred_revenue":
            gl_deferred += credit - debit
        elif ptype == "receivable":
            gl_receivable += debit - credit

    variance = billing_total - (gl_revenue + gl_deferred)
    variance_pct = (
        (abs(variance) / billing_total * Decimal("100")) if billing_total != 0 else Decimal("0")
    )
    exceptions = _build_exceptions(
        contract_type,
        billing_rows,
        gl_rows,
        billing_total,
        gl_revenue,
        gl_deferred,
        variance,
        variance_pct,
    )
    status = _status_from_exceptions(exceptions)
    commentary = _claude_commentary(
        period,
        contract_type,
        billing_total,
        gl_revenue,
        gl_deferred,
        variance,
        variance_pct,
        exceptions,
    )
    payload = {
        "company_id": company_id,
        "contract_id": contract_id or None,
        "period": period,
        "contract_type": contract_type,
        "billing_total": money(billing_total),
        "gl_revenue_total": money(gl_revenue),
        "gl_deferred_total": money(gl_deferred),
        "gl_receivable_total": money(gl_receivable),
        "variance": money(variance),
        "variance_pct": money(variance_pct),
        "status": status,
        "exceptions": exceptions,
        "ai_commentary": commentary,
        "recon_run_at": datetime.now(timezone.utc).isoformat(),
    }
    saved = billing_recon_db.upsert_result(payload)
    return saved


@router.post("/upload-billing")
async def upload_billing(
    body: BillingUploadRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    company_id = _firm_id(request, body.company_id, x_firm_id)
    imported = 0
    errors: list[str] = []
    for i, row in enumerate(body.rows, start=1):
        try:
            tx = str(row.transaction_type or "").strip().lower()
            if tx not in VALID_TX_TYPES:
                raise ValueError(f"Invalid transaction_type '{row.transaction_type}'")
            if not row.transaction_ref.strip():
                raise ValueError("Missing transaction_ref")
            period = _period_from_date(row.billing_date)
            ctype = _detect_contract_type(row.model_dump())
            billing_recon_db.upsert_billing(
                {
                    "company_id": company_id,
                    "contract_id": row.contract_id or None,
                    "transaction_ref": row.transaction_ref.strip(),
                    "transaction_type": tx,
                    "contract_type": ctype,
                    "billing_date": row.billing_date[:10],
                    "amount": str(D(row.amount)),
                    "currency": (row.currency or "AED").upper(),
                    "billing_system": row.billing_system,
                    "external_ref": row.external_ref,
                    "milestone_ref": row.milestone_ref,
                    "customer_id": row.customer_id,
                    "status": "unmatched",
                    "period": period,
                }
            )
            imported += 1
        except Exception as exc:
            errors.append(f"Row {i}: {exc}")
    return {"imported": imported, "errors": errors}


@router.post("/upload-gl")
async def upload_gl(
    body: GlUploadRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    company_id = _firm_id(request, body.company_id, x_firm_id)
    imported = 0
    errors: list[str] = []
    for i, row in enumerate(body.rows, start=1):
        try:
            if not str(row.account_code or "").strip():
                raise ValueError("Missing account_code")
            period = row.period or _period_from_date(row.posting_date)
            billing_recon_db.upsert_gl(
                {
                    "company_id": company_id,
                    "contract_id": row.contract_id or None,
                    "posting_date": row.posting_date[:10],
                    "account_code": row.account_code.strip(),
                    "account_name": row.account_name,
                    "debit": str(D(row.debit)),
                    "credit": str(D(row.credit)),
                    "journal_ref": row.journal_ref or "",
                    "period": period,
                    "posting_type": _posting_type(row.account_code),
                    "source": "manual",
                }
            )
            imported += 1
        except Exception as exc:
            errors.append(f"Row {i}: {exc}")
    return {"imported": imported, "errors": errors}


@router.post("/run")
async def run_recon(
    body: RunRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    company_id = _firm_id(request, body.company_id, x_firm_id)
    period = body.period.strip()
    if len(period) != 7 or period[4] != "-":
        raise HTTPException(status_code=400, detail="period must be YYYY-MM")

    billing_rows = billing_recon_db.list_billing(company_id, period, contract_id=body.contract_id)
    gl_all = billing_recon_db.list_gl(company_id, period, contract_id=body.contract_id)

    groups: dict[str, list[dict[str, Any]]] = {}
    for row in billing_rows:
        key = str(row.get("contract_type") or "saas_subscription")
        groups.setdefault(key, []).append(row)
    if not groups and gl_all:
        groups["saas_subscription"] = []

    multi = len(groups) > 1
    results = []
    for ctype, brows in groups.items():
        if body.contract_id or not multi:
            grows = gl_all
        elif ctype == "uae_real_estate":
            grows = [
                g
                for g in gl_all
                if str(g.get("account_code") or "").startswith("4001")
                or str(g.get("posting_type") or "") in {"contract_asset", "receivable"}
            ]
        else:
            grows = [
                g
                for g in gl_all
                if str(g.get("account_code") or "").startswith("4002")
                or str(g.get("posting_type") or "") == "deferred_revenue"
            ]
        results.append(_run_scope(company_id, period, ctype, brows, grows, body.contract_id))

    if not results:
        empty = _run_scope(company_id, period, "saas_subscription", [], [], body.contract_id)
        results = [empty]

    return {"success": True, "results": results, "count": len(results), "result": results[0]}


@router.get("/results")
async def get_results(
    request: Request,
    company_id: Optional[str] = Query(None),
    period: Optional[str] = Query(None),
    contract_id: Optional[str] = Query(None),
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    cid = _firm_id(request, company_id, x_firm_id)
    rows = billing_recon_db.list_results(cid, period=period, contract_id=contract_id)
    return {"success": True, "results": rows, "count": len(rows)}


@router.get("/exceptions")
async def get_exceptions(
    request: Request,
    company_id: Optional[str] = Query(None),
    period: Optional[str] = Query(None),
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    cid = _firm_id(request, company_id, x_firm_id)
    rows = billing_recon_db.list_results(cid, period=period)
    flat: list[dict[str, Any]] = []
    for row in rows:
        for exc in row.get("exceptions") or []:
            if not isinstance(exc, dict):
                continue
            flat.append(
                {
                    "contract_id": row.get("contract_id"),
                    "contract_type": row.get("contract_type"),
                    "period": row.get("period"),
                    "exception": exc,
                    "amount": float(exc.get("amount") or 0),
                }
            )
    flat.sort(key=lambda x: float(x.get("amount") or 0), reverse=True)
    return {"success": True, "exceptions": flat, "count": len(flat)}


@router.patch("/results/{result_id}/review")
async def review_result(result_id: str, body: ReviewRequest):
    _require_db()
    name = (body.reviewed_by or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="reviewed_by is required")
    try:
        row = billing_recon_db.mark_reviewed(
            result_id, name, datetime.now(timezone.utc).isoformat()
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="Recon result not found")
    return {"success": True, "result": row}
