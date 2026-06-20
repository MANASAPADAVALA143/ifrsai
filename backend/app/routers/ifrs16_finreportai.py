"""IFRS 16 → FinReportAI Journal Push — API routes."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from backend.app.services.finreportai_journal_push import (
    format_risk_summary,
    get_finreportai_base,
    ifrs16_journals_to_csv,
    push_and_post_to_gl,
    push_journals_to_finreportai,
)

router = APIRouter(prefix="/api/ifrs16/finreportai", tags=["ifrs16-finreportai"])


class JournalPushRequest(BaseModel):
    journal_entries: list[dict[str, Any]] | dict[str, Any] = Field(
        ..., description="Journal entries from IFRS 16 calculator"
    )
    module: str = Field(
        "lessee",
        description="lessee | lessor_finance | lessor_operating | sale_leaseback | modification | termination | cpi_remeasure",
    )
    lease_name: str = Field("", example="Dubai Office Tower")
    company: str = Field("", example="ABC Trading LLC")
    run_anomaly_detection: bool = Field(True)


class GLPostRequest(BaseModel):
    journal_entries: list[dict[str, Any]] | dict[str, Any]
    module: str = "lessee"
    lease_name: str = ""
    company: str = ""
    period: str = Field(..., example="2024-01", description="Accounting period YYYY-MM")
    firm_id: str = "default"
    force_post: bool = False


class PreviewRequest(BaseModel):
    journal_entries: list[dict[str, Any]] | dict[str, Any]
    module: str = "lessee"
    lease_name: str = ""
    company: str = ""


@router.post("/check")
async def anomaly_check(
    body: JournalPushRequest,
    x_firm_id: Optional[str] = Header(None),
):
    try:
        raw = await push_journals_to_finreportai(
            journal_entries=body.journal_entries,
            module=body.module,
            lease_name=body.lease_name,
            company=body.company,
            run_anomaly_detection=body.run_anomaly_detection,
        )
        risk_summary = format_risk_summary(raw)
        return {
            "success": True,
            "risk_summary": risk_summary,
            "raw_result": raw,
            "ready_to_post": risk_summary["ready_to_post"],
            "message": (
                "No anomalies detected — ready to post to GL."
                if risk_summary["ready_to_post"]
                else f"{risk_summary['risk_counts']['high']} high-risk entries detected. Review before posting."
            ),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"FinReportAI check failed: {str(e)}") from e


@router.post("/post")
async def post_to_gl(
    body: GLPostRequest,
    x_firm_id: Optional[str] = Header(None),
):
    try:
        result = await push_and_post_to_gl(
            journal_entries=body.journal_entries,
            module=body.module,
            lease_name=body.lease_name,
            company=body.company,
            period=body.period,
            firm_id=body.firm_id or x_firm_id or "default",
            force_post=body.force_post,
        )
        risk_summary = format_risk_summary(result.get("anomaly_check", {}))
        return {
            "success": True,
            "gl_posted": result["gl_posted"],
            "auto_approved": result["auto_approved"],
            "risk_summary": risk_summary,
            "high_risk_entries": result["high_risk_entries"],
            "gl_post_result": result.get("gl_post_result"),
            "message": (
                f"Posted to FinReportAI GL for period {body.period}."
                if result["gl_posted"]
                else f"Not posted — {result['high_risk_count']} high-risk entries require review."
            ),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"FinReportAI GL post failed: {str(e)}") from e


@router.post("/preview-csv")
def preview_csv(body: PreviewRequest):
    try:
        csv_content = ifrs16_journals_to_csv(
            body.journal_entries,
            body.module,
            body.lease_name,
            body.company,
        )
        rows = [r for r in csv_content.strip().split("\n")]
        headers = rows[0].split(",") if rows else []
        data_rows = [r.split(",") for r in rows[1:]] if len(rows) > 1 else []
        return {
            "success": True,
            "csv_preview": {
                "headers": headers,
                "rows": data_rows,
                "total_rows": len(data_rows),
            },
            "raw_csv": csv_content,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/status")
async def finreportai_status():
    import httpx

    base = get_finreportai_base()
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{base}/health")
            return {
                "success": True,
                "reachable": r.status_code == 200,
                "base_url": base,
                "status_code": r.status_code,
            }
    except Exception as e:
        return {
            "success": False,
            "reachable": False,
            "base_url": base,
            "error": str(e),
            "message": "FinReportAI server not reachable. Check FINREPORTAI_BASE_URL in .env",
        }
