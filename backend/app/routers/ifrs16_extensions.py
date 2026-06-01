"""IFRS 16 extension endpoints — RAG, CPI, components, health, audit PDF, IBR benchmark."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/ifrs16", tags=["ifrs16-extensions"])


class IndexLeaseRequest(BaseModel):
    lease_id: str
    contract_text: str = ""
    metadata: Dict[str, Any] = Field(default_factory=dict)
    company_id: str = "default"


class LeaseSearchRequest(BaseModel):
    query: str
    company_id: str = "default"
    top_k: int = 5


class CpiRemeasureRequest(BaseModel):
    lease_id: str = ""
    original_monthly_payment: float
    original_ibr: float
    original_cpi: float
    new_cpi: float
    remeasurement_date: str
    remaining_term_months: int
    current_liability_balance: float
    current_rou_balance: float
    currency: str = "USD"


class ComponentRow(BaseModel):
    name: str
    type: Literal["lease", "service"]
    amount: float


class ComponentSplitRequest(BaseModel):
    total_contract_payment: float
    components: List[ComponentRow]
    term_months: int
    ibr: float
    commencement_date: str
    currency: str = "USD"
    lease_id: str = "SPLIT"


class IbrBenchmarkRequest(BaseModel):
    country: str
    credit_rating: str
    lease_term_years: int
    currency: str = "USD"


class HealthScoreRequest(BaseModel):
    leases: List[Dict[str, Any]] = Field(default_factory=list)
    alerts_count: int = 0


class AuditBundleRequest(BaseModel):
    period: str
    leases: List[Dict[str, Any]] = Field(default_factory=list)
    alerts_count: int = 0
    prepared_by: str = "IFRS AI"
    reviewed_by: str = ""


def _rag_engine():
    from importlib import import_module

    main = import_module("app")
    return main.get_rag_engine()


@router.post("/index-lease")
async def index_lease_endpoint(body: IndexLeaseRequest):
    from ifrs16_rag_leases import index_lease

    engine = _rag_engine()
    if not engine:
        raise HTTPException(status_code=503, detail="RAG engine not available")
    meta = dict(body.metadata)
    meta.setdefault("lease_id", body.lease_id)
    result = index_lease(
        engine,
        body.lease_id,
        body.contract_text,
        meta,
        company_id=body.company_id or "default",
    )
    if not result.get("indexed"):
        raise HTTPException(status_code=400, detail=result.get("error", "Index failed"))
    return result


@router.post("/search")
async def search_leases_endpoint(body: LeaseSearchRequest):
    from ifrs16_rag_leases import search_leases

    engine = _rag_engine()
    if not engine:
        raise HTTPException(status_code=503, detail="RAG engine not available")
    return search_leases(engine, body.query, body.company_id or "default", body.top_k)


@router.post("/remeasure-cpi")
async def remeasure_cpi_endpoint(body: CpiRemeasureRequest):
    from ifrs16_cpi_remeasure import remeasure_cpi

    try:
        return remeasure_cpi(body.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/component-split")
async def component_split_endpoint(body: ComponentSplitRequest):
    from ifrs16_component_split import split_and_calculate

    try:
        payload = body.model_dump()
        payload["components"] = [c.model_dump() for c in body.components]
        return split_and_calculate(payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/health-score")
async def health_score_get():
    return {"message": "POST leases array to compute health score"}


@router.post("/health-score")
async def health_score_post(body: HealthScoreRequest):
    from ifrs16_health_audit import compute_health_score

    return compute_health_score(body.leases, body.alerts_count)


@router.post("/ibr-benchmark")
async def ibr_benchmark_endpoint(body: IbrBenchmarkRequest):
    from ifrs16_ibr_benchmark import benchmark_ibr

    return benchmark_ibr(body.country, body.credit_rating, body.lease_term_years, body.currency)


@router.post("/audit-bundle")
async def audit_bundle_endpoint(body: AuditBundleRequest):
    from ifrs16_health_audit import build_audit_pdf, compute_health_score

    health = compute_health_score(body.leases, body.alerts_count)
    pdf_bytes = build_audit_pdf(
        body.period,
        body.leases,
        health,
        body.prepared_by,
        body.reviewed_by,
    )
    fname = f"IFRS16_Audit_Pack_{body.period.replace('/', '-')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
