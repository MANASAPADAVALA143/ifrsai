"""IFRS 15.18–21 contract modification workflow."""

from __future__ import annotations

import io
import json
import os
import re
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.app.services.ifrs15_db import ifrs15_db
from backend.app.services.ifrs15_modifications_db import mods_db
from backend.app.services.supabase_client import is_supabase_configured

router = APIRouter(prefix="/api/ifrs15/modifications", tags=["ifrs15-modifications"])

MONEY_Q = Decimal("0.0001")
PCT_Q = Decimal("0.0001")
TREATMENTS = {"A_separate_contract", "B_prospective", "C_catchup"}


def D(v: Any) -> Decimal:
    try:
        return Decimal(str(v if v is not None else 0))
    except Exception:
        return Decimal("0")


def money(v: Decimal) -> float:
    return float(v.quantize(MONEY_Q, rounding=ROUND_HALF_UP))


def pct(v: Decimal) -> float:
    return float(v.quantize(PCT_Q, rounding=ROUND_HALF_UP))


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


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _final_treatment(row: dict[str, Any]) -> str:
    override = str(row.get("human_treatment_override") or "").strip()
    if override in TREATMENTS:
        return override
    ai = str(row.get("ai_treatment") or "").strip()
    return ai if ai in TREATMENTS else ""


def _compute_catchup(
    original_price: Decimal,
    price_change: Decimal,
    months_elapsed: int,
    original_term: int,
    new_term: Optional[int],
    revenue_recognised: Decimal,
    override_progress: Optional[Decimal] = None,
) -> dict[str, Any]:
    new_price = original_price + price_change
    term = int(new_term or original_term or 1) or 1
    elapsed = max(0, int(months_elapsed or 0))
    if override_progress is not None:
        progress = override_progress
    else:
        progress = (Decimal(elapsed) / Decimal(term)) if term else Decimal("0")
    if progress < 0:
        progress = Decimal("0")
    if progress > 1:
        progress = Decimal("1")
    should = new_price * progress
    catch = should - revenue_recognised
    return {
        "new_transaction_price": money(new_price),
        "updated_progress_pct": pct(progress * Decimal("100")),
        "revenue_should_have_been": money(should),
        "catch_up_adjustment": money(catch),
    }


def _parse_ai_json(text: str) -> dict[str, Any]:
    s = (text or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.I)
        s = re.sub(r"\s*```$", "", s)
    start, end = s.find("{"), s.rfind("}")
    if start >= 0 and end > start:
        s = s[start : end + 1]
    return json.loads(s)


def _fallback_classify(body: "ClassifyRequest") -> dict[str, Any]:
    new_distinct = body.are_new_services_distinct
    rem_distinct = body.are_remaining_services_distinct
    ssp = D(body.new_ssp_of_added_services)
    price = abs(D(body.price_change_amount))
    if body.modification_type == "cancellation":
        return {
            "treatment": "B_prospective",
            "reason": "Cancellation / termination is accounted as ending the original arrangement; remaining rights are not treated as a cumulative catch-up under IFRS 15.18–21.",
            "confidence": "medium",
            "key_judgment": "Whether the event is a modification or a termination.",
            "risk_flag": "Confirm cancellation vs modification documentation.",
        }
    if new_distinct is True and ssp > 0 and abs(price - ssp) <= (ssp * Decimal("0.05") + Decimal("1")):
        return {
            "treatment": "A_separate_contract",
            "reason": "Added distinct goods/services priced at (or near) standalone selling price — IFRS 15.20 separate contract.",
            "confidence": "high" if new_distinct is True else "medium",
            "key_judgment": "Distinctness and SSP of added services.",
            "risk_flag": None,
        }
    if rem_distinct is True or (new_distinct is not True and rem_distinct is not False and body.contract_type == "saas_subscription"):
        return {
            "treatment": "B_prospective",
            "reason": "Remaining undelivered services are distinct from those already transferred — IFRS 15.21(a) prospective / terminate-and-create.",
            "confidence": "medium",
            "key_judgment": "Distinctness of remaining performance vs delivered.",
            "risk_flag": "Document distinct test for remaining term.",
        }
    return {
        "treatment": "C_catchup",
        "reason": "Remaining services are not distinct from those already transferred — IFRS 15.21(b) cumulative catch-up from inception.",
        "confidence": "medium" if rem_distinct is False else "low",
        "key_judgment": "Whether remaining performance is part of a single partially satisfied obligation.",
        "risk_flag": "Negative catch-up reduces current-period revenue.",
    }


def _claude_classify(body: "ClassifyRequest") -> dict[str, Any]:
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return _fallback_classify(body)
    user = f"""Contract modification details:
Contract type: {body.contract_type}
Modification description: {body.description}
Modification type: {body.modification_type}
Original transaction price: AED {body.original_transaction_price}
Price change: {body.price_change_amount} (+ = increase, - = decrease)
Original term: {body.original_term_months} months
New term (if changed): {body.new_term_months}
Months elapsed: {body.months_elapsed}
Revenue recognised to date: {body.revenue_recognised_to_date}
SSP of any added services: {body.new_ssp_of_added_services}
User distinctness answers: new_services={body.are_new_services_distinct}, remaining={body.are_remaining_services_distinct}

Apply the IFRS 15.18-21 decision tree:
Q1: Do the modifications add new distinct goods/services priced at their SSP?
Q2: If not, are remaining undelivered services distinct from those already transferred?

Classify as exactly one of:
A_separate_contract — new distinct services at SSP (IFRS 15.20)
B_prospective — scope/price change, remaining services distinct (IFRS 15.21a)
C_catchup — remaining services NOT distinct, recalculate from inception (IFRS 15.21b)

Return JSON only:
{{
  "treatment": "A_separate_contract"|"B_prospective"|"C_catchup",
  "reason": "detailed explanation referencing IFRS 15 paragraphs",
  "confidence": "high"|"medium"|"low",
  "key_judgment": "the main accounting judgment point",
  "risk_flag": "any risk or complexity to flag for human review or null"
}}"""
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
            max_tokens=700,
            system=(
                "You are a senior IFRS 15 revenue accounting expert. "
                "Classify contract modifications precisely per IFRS 15.18-21."
            ),
            messages=[{"role": "user", "content": user}],
        )
        text = "".join(getattr(b, "text", "") or "" for b in (msg.content or []))
        parsed = _parse_ai_json(text)
        treatment = str(parsed.get("treatment") or "")
        if treatment not in TREATMENTS:
            return _fallback_classify(body)
        parsed["confidence"] = str(parsed.get("confidence") or "medium").lower()
        if parsed["confidence"] not in {"high", "medium", "low"}:
            parsed["confidence"] = "medium"
        return parsed
    except Exception:
        return _fallback_classify(body)


def _claude_memo(row: dict[str, Any]) -> str:
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    final = _final_treatment(row)
    catch_block = ""
    if final == "C_catchup":
        adj = D(row.get("catch_up_adjustment"))
        direction = "INCREASE" if adj >= 0 else "DECREASE"
        catch_block = f"""
Catch-up Calculation:
- Updated transaction price: {row.get("new_transaction_price")}
- Updated progress %: {row.get("updated_progress_pct")}%
- Revenue should have been recognised: {row.get("revenue_should_have_been")}
- Revenue actually recognised: {row.get("revenue_recognised_to_date")}
- Catch-up adjustment: {row.get("catch_up_adjustment")} ({direction} to revenue)
"""
    fallback = (
        f"CONTRACT MODIFICATION MEMO\n"
        f"Ref: {row.get('modification_ref')} | Date: {row.get('modification_date')}\n\n"
        f"1. Executive summary\n"
        f"Modification '{row.get('description')}' is classified as {final or row.get('ai_treatment')} "
        f"under IFRS 15.18–21.\n\n"
        f"2. Background and facts\n"
        f"Original TP {row.get('original_transaction_price')}, term {row.get('original_term_months')} months. "
        f"Price change {row.get('price_change_amount')}. Revenue to date {row.get('revenue_recognised_to_date')}.\n\n"
        f"3. IFRS 15 analysis\n{row.get('ai_classification_reason') or ''}\n\n"
        f"4. Accounting treatment\n{catch_block or 'No cumulative catch-up; apply prospective or separate-contract accounting.'}\n\n"
        f"5. Conclusion and approvals\nPrepared for audit file. Status: {row.get('status')}.\n"
    )
    if not api_key:
        return fallback
    user = f"""Generate a contract modification memo for audit purposes.

CONTRACT MODIFICATION MEMO
Company: {row.get("company_id")}
Contract Ref: {row.get("contract_id")}
Modification Ref: {row.get("modification_ref")}
Date: {row.get("modification_date")}

Facts:
- Original contract: AED {row.get("original_transaction_price")}, {row.get("original_term_months")} months
- Modification: {row.get("description")}
- Price change: {row.get("price_change_amount")}
- Revenue recognised to date: {row.get("revenue_recognised_to_date")}
- Progress at modification date: {row.get("original_progress_pct")}%

IFRS 15 Analysis:
- Treatment selected: {final}
  (AI: {row.get("ai_treatment")}, Human override: {row.get("human_treatment_override")})
- Classification reason: {row.get("ai_classification_reason")}
{catch_block}
Write the memo in professional accounting language. Include:
1. Executive summary (2 sentences)
2. Background and facts
3. IFRS 15 analysis (reference specific paragraphs)
4. Accounting treatment and journal entries
5. Conclusion and approvals section
Format as plain text with clear section headers."""
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
            max_tokens=1400,
            system="You are a Big 4 IFRS 15 technical accounting expert writing an audit workpaper.",
            messages=[{"role": "user", "content": user}],
        )
        text = "".join(getattr(b, "text", "") or "" for b in (msg.content or [])).strip()
        return text or fallback
    except Exception:
        return fallback


def _memo_pdf_bytes(row: dict[str, Any]) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title=str(row.get("modification_ref") or "Modification memo"))
    styles = getSampleStyleSheet()
    story = [Paragraph("IFRS 15 Contract Modification Memo", styles["Title"]), Spacer(1, 12)]
    memo = str(row.get("modification_memo") or "No memo generated yet.")
    for line in memo.split("\n"):
        safe = (
            line.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )
        story.append(Paragraph(safe or "&nbsp;", styles["BodyText"]))
        story.append(Spacer(1, 4))
    doc.build(story)
    return buf.getvalue()


def _enrich(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    created = str(row.get("created_at") or "")
    days = 0
    try:
        dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
        days = max(0, (datetime.now(timezone.utc) - dt).days)
    except Exception:
        days = 0
    out["days_since_created"] = days
    out["final_treatment"] = _final_treatment(row)
    return out


class ClassifyRequest(BaseModel):
    company_id: Optional[str] = None
    contract_id: str
    modification_date: str
    description: str
    modification_type: str
    contract_type: str
    original_transaction_price: Decimal
    original_term_months: int
    months_elapsed: int
    revenue_recognised_to_date: Decimal
    price_change_amount: Decimal
    new_term_months: Optional[int] = None
    new_ssp_of_added_services: Optional[Decimal] = None
    are_new_services_distinct: Optional[bool] = None
    are_remaining_services_distinct: Optional[bool] = None
    prepared_by: Optional[str] = None
    modification_ref: Optional[str] = None


class CatchupRequest(BaseModel):
    modification_id: str
    override_progress_pct: Optional[Decimal] = None


class OverrideRequest(BaseModel):
    human_treatment: str
    reason: str
    actor: str


class ApproveRequest(BaseModel):
    approved_by: str


class PostJeRequest(BaseModel):
    je_date: str
    actor: str


@router.post("/classify")
async def classify(
    body: ClassifyRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    if len((body.description or "").strip()) < 20:
        raise HTTPException(status_code=400, detail="description must be at least 20 characters")
    company_id = _firm_id(request, body.company_id, x_firm_id)
    orig_term = max(1, int(body.original_term_months or 1))
    elapsed = max(0, int(body.months_elapsed or 0))
    orig_progress = (Decimal(elapsed) / Decimal(orig_term)) * Decimal("100")
    year = datetime.now(timezone.utc).year
    seq = mods_db.count_refs(company_id, year) + 1
    ref = (body.modification_ref or "").strip() or f"MOD-{year}-{seq:03d}"

    ai = _claude_classify(body)
    treatment = str(ai.get("treatment"))
    catch: dict[str, Any] = {
        "new_transaction_price": money(D(body.original_transaction_price) + D(body.price_change_amount)),
        "updated_progress_pct": None,
        "revenue_should_have_been": None,
        "catch_up_adjustment": None,
    }
    if treatment == "C_catchup":
        catch = _compute_catchup(
            D(body.original_transaction_price),
            D(body.price_change_amount),
            elapsed,
            orig_term,
            body.new_term_months,
            D(body.revenue_recognised_to_date),
        )

    row = mods_db.insert_mod(
        {
            "company_id": company_id,
            "contract_id": body.contract_id,
            "modification_date": body.modification_date[:10],
            "modification_ref": ref,
            "description": body.description.strip(),
            "modification_type": body.modification_type,
            "contract_type": body.contract_type,
            "original_transaction_price": str(D(body.original_transaction_price)),
            "original_term_months": orig_term,
            "months_elapsed": elapsed,
            "original_progress_pct": str(orig_progress.quantize(PCT_Q)),
            "revenue_recognised_to_date": str(D(body.revenue_recognised_to_date)),
            "price_change_amount": str(D(body.price_change_amount)),
            "new_transaction_price": catch.get("new_transaction_price"),
            "new_term_months": body.new_term_months,
            "new_ssp_of_added_services": str(D(body.new_ssp_of_added_services))
            if body.new_ssp_of_added_services is not None
            else None,
            "are_new_services_distinct": body.are_new_services_distinct,
            "are_remaining_services_distinct": body.are_remaining_services_distinct,
            "ai_treatment": treatment,
            "ai_classification_reason": ai.get("reason"),
            "ai_confidence": ai.get("confidence"),
            "ai_key_judgment": ai.get("key_judgment"),
            "ai_risk_flag": ai.get("risk_flag"),
            "updated_progress_pct": catch.get("updated_progress_pct"),
            "revenue_should_have_been": catch.get("revenue_should_have_been"),
            "catch_up_adjustment": catch.get("catch_up_adjustment"),
            "status": "ai_classified",
            "prepared_by": body.prepared_by,
            "updated_at": _now(),
        }
    )
    mods_db.add_audit(
        row["id"],
        "created",
        actor=body.prepared_by,
        new_value={"modification_ref": ref},
    )
    mods_db.add_audit(
        row["id"],
        "ai_classified",
        actor=body.prepared_by,
        new_value={
            "treatment": treatment,
            "confidence": ai.get("confidence"),
            "key_judgment": ai.get("key_judgment"),
            "risk_flag": ai.get("risk_flag"),
        },
        note=str(ai.get("key_judgment") or ""),
    )
    return {
        "success": True,
        "modification": _enrich(row),
        "classification": ai,
        "catch_up": catch if treatment == "C_catchup" else None,
    }


@router.post("/calculate-catchup")
async def calculate_catchup(body: CatchupRequest):
    _require_db()
    row = mods_db.get_mod(body.modification_id)
    if not row:
        raise HTTPException(status_code=404, detail="Modification not found")
    override = None
    if body.override_progress_pct is not None:
        override = D(body.override_progress_pct) / Decimal("100")
    if row.get("months_elapsed") is not None:
        elapsed = int(row.get("months_elapsed") or 0)
    else:
        elapsed = int(
            round(
                float(
                    D(row.get("original_progress_pct") or 0)
                    / Decimal("100")
                    * D(row.get("original_term_months") or 1)
                )
            )
        )
    catch = _compute_catchup(
        D(row.get("original_transaction_price")),
        D(row.get("price_change_amount")),
        elapsed,
        int(row.get("original_term_months") or 1),
        int(row["new_term_months"]) if row.get("new_term_months") is not None else None,
        D(row.get("revenue_recognised_to_date")),
        override_progress=override,
    )
    updated = mods_db.update_mod(
        body.modification_id,
        {
            **{k: catch[k] for k in catch},
            "updated_at": _now(),
        },
    )
    return {"success": True, "modification": _enrich(updated), "catch_up": catch}


@router.post("/{modification_id}/override")
async def override_treatment(modification_id: str, body: OverrideRequest):
    _require_db()
    if body.human_treatment not in TREATMENTS:
        raise HTTPException(status_code=400, detail="Invalid treatment")
    row = mods_db.get_mod(modification_id)
    if not row:
        raise HTTPException(status_code=404, detail="Modification not found")
    patch: dict[str, Any] = {
        "human_treatment_override": body.human_treatment,
        "human_override_reason": body.reason,
        "status": "under_review",
        "updated_at": _now(),
    }
    if body.human_treatment == "C_catchup" and row.get("catch_up_adjustment") is None:
        elapsed = int(row.get("months_elapsed") or 0)
        catch = _compute_catchup(
            D(row.get("original_transaction_price")),
            D(row.get("price_change_amount")),
            elapsed,
            int(row.get("original_term_months") or 1),
            int(row["new_term_months"]) if row.get("new_term_months") is not None else None,
            D(row.get("revenue_recognised_to_date")),
        )
        patch.update(catch)
    updated = mods_db.update_mod(modification_id, patch)
    mods_db.add_audit(
        modification_id,
        "override",
        actor=body.actor,
        old_value={"ai_treatment": row.get("ai_treatment")},
        new_value={"human_treatment": body.human_treatment},
        note=body.reason,
    )
    return {"success": True, "modification": _enrich(updated)}


@router.post("/{modification_id}/approve")
async def approve(modification_id: str, body: ApproveRequest):
    _require_db()
    row = mods_db.get_mod(modification_id)
    if not row:
        raise HTTPException(status_code=404, detail="Modification not found")
    updated = mods_db.update_mod(
        modification_id,
        {
            "status": "approved",
            "approved_by": body.approved_by,
            "approved_at": _now(),
            "updated_at": _now(),
        },
    )
    mods_db.add_audit(modification_id, "approved", actor=body.approved_by)
    return {"success": True, "modification": _enrich(updated)}


@router.post("/{modification_id}/generate-memo")
async def generate_memo(modification_id: str):
    _require_db()
    row = mods_db.get_mod(modification_id)
    if not row:
        raise HTTPException(status_code=404, detail="Modification not found")
    memo = _claude_memo(row)
    updated = mods_db.update_mod(
        modification_id, {"modification_memo": memo, "updated_at": _now()}
    )
    mods_db.add_audit(modification_id, "memo_generated", note="Memo generated")
    return {"success": True, "memo": memo, "modification": _enrich(updated)}


@router.get("/{modification_id}/memo-pdf")
async def memo_pdf(modification_id: str):
    _require_db()
    row = mods_db.get_mod(modification_id)
    if not row:
        raise HTTPException(status_code=404, detail="Modification not found")
    if not row.get("modification_memo"):
        row["modification_memo"] = _claude_memo(row)
        mods_db.update_mod(modification_id, {"modification_memo": row["modification_memo"]})
    data = _memo_pdf_bytes(row)
    ref = str(row.get("modification_ref") or "modification").replace(" ", "_")
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{ref}_memo.pdf"'},
    )


@router.post("/{modification_id}/post-je")
async def post_je(modification_id: str, body: PostJeRequest):
    _require_db()
    row = mods_db.get_mod(modification_id)
    if not row:
        raise HTTPException(status_code=404, detail="Modification not found")
    if str(row.get("status")) != "approved":
        raise HTTPException(status_code=400, detail="Approve the modification before posting JE")
    seq = mods_db.count_posted_je(str(row.get("company_id"))) + 1
    je_ref = f"JE-MOD-{body.je_date[:10].replace('-', '')}-{seq:03d}"
    updated = mods_db.update_mod(
        modification_id,
        {
            "je_posted": True,
            "je_ref": je_ref,
            "je_date": body.je_date[:10],
            "status": "posted",
            "updated_at": _now(),
        },
    )
    mods_db.add_audit(modification_id, "je_posted", actor=body.actor, new_value={"je_ref": je_ref})
    return {"success": True, "modification": _enrich(updated)}


@router.get("/")
async def list_modifications(
    request: Request,
    company_id: Optional[str] = Query(None),
    contract_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    cid = _firm_id(request, company_id, x_firm_id)
    rows = [_enrich(r) for r in mods_db.list_mods(cid, contract_id=contract_id, status=status)]
    return {"success": True, "modifications": rows, "count": len(rows)}


@router.get("/contracts")
async def list_contracts(
    request: Request,
    company_id: Optional[str] = Query(None),
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    cid = _firm_id(request, company_id, x_firm_id)
    try:
        port = ifrs15_db.get_portfolio(cid)
    except Exception:
        port = []
    items = []
    for p in port:
        data = p.get("contract_data") or {}
        items.append(
            {
                "id": str(data.get("contract_id") or p.get("id")),
                "name": p.get("contract_name") or data.get("contract_id") or "Contract",
                "transaction_price": data.get("transaction_price") or data.get("total_transaction_price"),
                "term_months": data.get("contract_term_months") or data.get("lease_term_months"),
            }
        )
    return {"success": True, "contracts": items}


@router.get("/{modification_id}")
async def get_modification(modification_id: str):
    _require_db()
    row = mods_db.get_mod(modification_id)
    if not row:
        raise HTTPException(status_code=404, detail="Modification not found")
    audit = mods_db.list_audit(modification_id)
    return {"success": True, "modification": _enrich(row), "audit_trail": audit}
