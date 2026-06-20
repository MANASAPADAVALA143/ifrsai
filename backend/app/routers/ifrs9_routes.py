"""
IFRS 9 ECL API routes — modular router (mount in app.py).

Orchestration:
  POST /calculate → ifrs9_calculate_service.orchestrate_calculate
  POST /classify  → IFRS9ClassificationEngine
  POST /macro-overlay → IFRS9MacroOverlayEngine
  POST /provision-matrix → IFRS9ProvisionMatrixEngine
  POST /master-report → IFRS9MasterSummaryEngine
"""

from __future__ import annotations

import gc
import io
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from backend.app.services.ifrs9_calculate_service import orchestrate_calculate
from backend.app.services.ifrs9_helpers import ifrs9_firm_id, ifrs9_user_id, normalize_ifrs9_journals

try:
    from backend.app.services.ifrs9_db import MigrationRequiredError, ifrs9_db
except ImportError:
    ifrs9_db = None  # type: ignore
    MigrationRequiredError = RuntimeError  # type: ignore

router = APIRouter(prefix="/api/ifrs9", tags=["ifrs9"])

OUTPUT_DIR = Path("outputs")
OUTPUT_DIR.mkdir(exist_ok=True)

# Standard PD by credit rating (IFRS 9.5.5.17) — percentage points for API
PD_BY_RATING_PCT = {
    "AAA": 0.01,
    "AA+": 0.02,
    "AA": 0.02,
    "AA-": 0.03,
    "A+": 0.04,
    "A": 0.05,
    "A-": 0.10,
    "BBB+": 0.15,
    "BBB": 0.20,
    "BBB-": 0.30,
    "BB+": 0.50,
    "BB": 1.00,
    "BB-": 2.00,
    "B+": 3.00,
    "B": 5.00,
    "B-": 8.00,
    "CCC": 10.00,
    "CC": 20.00,
    "C": 30.00,
    "D": 100.00,
}


# ─── Pydantic request models ───────────────────────────────────────────────


class IFRS9ClassificationRequest(BaseModel):
    instrument_name: str
    instrument_type: str
    business_model_indicators: List[str]
    sppi_features: List[str]
    prepayment_penalty_reasonable: bool = True
    fair_value_option_elected: bool = False
    fvo_reason: Optional[str] = None
    business_model_changed: bool = False
    nominal_rate: Optional[float] = None
    issue_price: Optional[float] = None
    face_value: Optional[float] = None
    term_months: Optional[int] = None


class MacroScenario(BaseModel):
    gdp_growth: float
    unemployment_rate: float
    interest_rate: float
    property_price_change: float = 0.0
    credit_spread: float = 0.0
    probability: float


class IFRS9MacroOverlayRequest(BaseModel):
    portfolio_name: str
    base_pd: float  # percentage at API boundary
    lgd: float  # percentage
    ead: float
    base_scenario: MacroScenario
    optimistic_scenario: MacroScenario
    pessimistic_scenario: MacroScenario
    loans: Optional[List[Any]] = None


class ReceivableItem(BaseModel):
    invoice_id: str
    customer: str
    gross_amount: float
    days_past_due: int
    currency: str = "USD"


class BucketTotal(BaseModel):
    label: str
    gross_amount: float
    historical_loss_rate: Optional[float] = None


class HistoricalData(BaseModel):
    bucket_label: str
    historical_balance: float
    historical_writeoffs: float


class IFRS9ProvisionMatrixRequest(BaseModel):
    portfolio_name: str
    reporting_date: Optional[str] = None
    receivable_type: str = "trade_receivables"
    receivables: Optional[List[ReceivableItem]] = None
    bucket_totals: Optional[List[BucketTotal]] = None
    loss_rates: Optional[Dict[str, Any]] = None
    historical_data: Optional[List[HistoricalData]] = None
    macro_adjustment_factor: Optional[float] = 0.0
    writeoffs_this_period: Optional[float] = 0.0
    custom_buckets: Optional[List[Dict[str, Any]]] = None


class IFRS9CalculateRequest(BaseModel):
    """Orchestrated ECL calculate — PD/LGD in percentage at API boundary."""

    approach: str = "general"
    portfolio_name: Optional[str] = None
    portfolio_id: Optional[str] = None
    reporting_date: Optional[str] = None
    stage: int = 1
    stage_override: bool = False
    pd_12m: float = 1.0
    pd_lifetime: float = 5.0
    lgd: float = 45.0
    ead: float = 0.0
    discount_rate: float = 0.08
    previous_ecl: float = 0.0
    days_past_due: int = 0
    credit_rating: Optional[str] = None
    classification: Optional[Dict[str, Any]] = None
    ageing_buckets: Optional[List[Dict[str, Any]]] = None
    receivables: Optional[List[Dict[str, Any]]] = None
    loans: Optional[List[Dict[str, Any]]] = None
    scenarios: Optional[Dict[str, Any]] = None
    period_events: Optional[Dict[str, Any]] = None
    previous_bridge: Optional[Dict[str, Dict[str, float]]] = None

    class Config:
        extra = "allow"


class IFRS9DownloadExcelRequest(BaseModel):
    portfolio_name: str = "Portfolio"
    entity_name: Optional[str] = ""
    reporting_date: Optional[str] = None
    applicable_ecl: Optional[float] = 0
    ecl_12m: Optional[float] = 0
    ecl_lifetime: Optional[float] = 0
    total_ead: Optional[float] = 0
    pd_used: Optional[float] = 0
    lgd_used: Optional[float] = 0
    coverage_ratio: Optional[float] = 0
    weighted_avg_pd: Optional[float] = 0
    stage_summary: Optional[Dict[str, Any]] = None
    loans: Optional[List[Any]] = None
    ecl_movement: Optional[Dict[str, Any]] = None
    journal_entries: Optional[List[Any]] = None
    disclosure_notes: Optional[Any] = None
    scenario_results: Optional[Dict[str, Any]] = None
    bucket_results: Optional[List[Any]] = None
    macro_sensitivity: Optional[str] = None
    discount_rate: Optional[float] = None
    master_report_data: Optional[Dict[str, Any]] = None


class IFRS9MasterReportRequest(BaseModel):
    portfolio_name: str
    entity_name: Optional[str] = ""
    reporting_date: Optional[str] = None
    core_results: Optional[Dict[str, Any]] = None
    classification_result: Optional[Dict[str, Any]] = None
    macro_overlay_result: Optional[Dict[str, Any]] = None
    provision_matrix_result: Optional[Dict[str, Any]] = None


class PortfolioUpsertRequest(BaseModel):
    instrument_data: Dict[str, Any] = Field(..., description="Full ECLPortfolioEntry JSON")


# ─── Portfolio persistence (Supabase — migration 005) ───────────────────────


@router.post("/portfolio/upsert")
async def upsert_portfolio(
    body: PortfolioUpsertRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
):
    if ifrs9_db is None:
        raise HTTPException(status_code=503, detail="IFRS 9 DB service unavailable")
    firm_id = ifrs9_firm_id(request, x_firm_id)
    uid = ifrs9_user_id(request, x_user_id)
    try:
        row = ifrs9_db.upsert_portfolio(firm_id, body.instrument_data, user_id=uid)
        return {"success": True, "portfolio": row}
    except MigrationRequiredError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": "Database error", "detail": str(e)}) from e


@router.get("/portfolio/list")
async def list_portfolios(
    request: Request,
    status: Optional[str] = None,
    limit: int = 500,
    offset: int = 0,
    x_firm_id: Optional[str] = Header(None),
):
    if ifrs9_db is None:
        raise HTTPException(status_code=503, detail="IFRS 9 DB service unavailable")
    firm_id = ifrs9_firm_id(request, x_firm_id)
    try:
        rows = ifrs9_db.get_portfolio(firm_id, status=status, limit=limit, offset=offset)
        portfolios = [r.get("instrument_data") or {} for r in rows]
        return {"success": True, "portfolios": portfolios, "count": len(portfolios)}
    except MigrationRequiredError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": "Database error", "detail": str(e)}) from e


@router.get("/portfolio/summary")
async def portfolio_summary(
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    if ifrs9_db is None:
        raise HTTPException(status_code=503, detail="IFRS 9 DB service unavailable")
    firm_id = ifrs9_firm_id(request, x_firm_id)
    try:
        return {"success": True, "summary": ifrs9_db.get_portfolio_summary(firm_id)}
    except MigrationRequiredError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/portfolio/{portfolio_id}")
async def get_portfolio(
    portfolio_id: str,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    if ifrs9_db is None:
        raise HTTPException(status_code=503, detail="IFRS 9 DB service unavailable")
    firm_id = ifrs9_firm_id(request, x_firm_id)
    try:
        row = ifrs9_db.get_portfolio_entry(firm_id, portfolio_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"Portfolio {portfolio_id} not found")
        return {"success": True, "portfolio": row.get("instrument_data"), "row": row}
    except MigrationRequiredError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete("/portfolio/{portfolio_id}")
async def delete_portfolio(
    portfolio_id: str,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
):
    if ifrs9_db is None:
        raise HTTPException(status_code=503, detail="IFRS 9 DB service unavailable")
    firm_id = ifrs9_firm_id(request, x_firm_id)
    uid = ifrs9_user_id(request, x_user_id)
    try:
        ok = ifrs9_db.delete_portfolio(firm_id, portfolio_id, user_id=uid)
        if not ok:
            raise HTTPException(status_code=404, detail=f"Portfolio {portfolio_id} not found")
        return {"success": True}
    except MigrationRequiredError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/portfolio/{portfolio_id}/runs")
async def list_calculation_runs(
    portfolio_id: str,
    request: Request,
    limit: int = 50,
    x_firm_id: Optional[str] = Header(None),
):
    if ifrs9_db is None:
        raise HTTPException(status_code=503, detail="IFRS 9 DB service unavailable")
    firm_id = ifrs9_firm_id(request, x_firm_id)
    try:
        runs = ifrs9_db.get_calculation_runs(firm_id, portfolio_id=portfolio_id, limit=limit)
        return {"success": True, "runs": runs, "count": len(runs)}
    except MigrationRequiredError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/portfolio/{portfolio_id}/reconciliation")
async def portfolio_reconciliation(
    portfolio_id: str,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    """
    ECL movement reconciliation from the last two calculation runs.
    Includes stage bridge and schedule-to-journal tie-out.
    """
    if ifrs9_db is None:
        raise HTTPException(status_code=503, detail="IFRS 9 DB service unavailable")
    from backend.app.services.ifrs9_reconciliation_service import build_reconciliation_from_run_list

    firm_id = ifrs9_firm_id(request, x_firm_id)
    try:
        runs = ifrs9_db.get_calculation_runs(firm_id, portfolio_id=portfolio_id, limit=2)
        if not runs:
            raise HTTPException(
                status_code=404,
                detail=f"No calculation runs for portfolio {portfolio_id}. Run /calculate first.",
            )
        report = build_reconciliation_from_run_list(runs)
        report["firm_id"] = firm_id
        return {"success": True, "reconciliation": report}
    except MigrationRequiredError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/audit-log")
async def audit_log(
    request: Request,
    portfolio_id: Optional[str] = None,
    limit: int = 100,
    x_firm_id: Optional[str] = Header(None),
):
    if ifrs9_db is None:
        raise HTTPException(status_code=503, detail="IFRS 9 DB service unavailable")
    firm_id = ifrs9_firm_id(request, x_firm_id)
    try:
        rows = ifrs9_db.get_audit_log(firm_id, portfolio_id=portfolio_id, limit=limit)
        return {"success": True, "entries": rows}
    except MigrationRequiredError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


# ─── Endpoints ─────────────────────────────────────────────────────────────


@router.get("/pd-rates")
async def get_pd_rates(
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    """PD reference table — values in percentage (1.0 = 1%)."""
    _ = ifrs9_firm_id(request, x_firm_id)
    return {"pd_rates": PD_BY_RATING_PCT, "unit": "percentage"}


@router.post("/upload-portfolio")
async def upload_portfolio(
    request: Request,
    file: UploadFile = File(...),
    x_firm_id: Optional[str] = Header(None),
):
    """
    Parse Excel/CSV for form auto-fill. Bulk ECL runs via POST /calculate with loans[].
    """
    _ = ifrs9_firm_id(request, x_firm_id)
    allowed = [".xlsx", ".xls", ".csv"]
    ext = Path(file.filename or "").suffix.lower()
    if ext not in allowed:
        raise HTTPException(status_code=400, detail=f"Allowed: {', '.join(allowed)}")
    try:
        import pandas as pd

        contents = await file.read()
        if ext == ".csv":
            df = pd.read_csv(io.BytesIO(contents), encoding="utf-8", on_bad_lines="skip")
        else:
            df = pd.read_excel(io.BytesIO(contents), sheet_name=0)
        df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
        rows = df.head(500).to_dict(orient="records")
        gc.collect()
        return {
            "status": "success",
            "filename": file.filename,
            "extracted_data": {"rows": rows, "columns": list(df.columns), "row_count": len(df)},
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload error: {str(e)}") from e


@router.post("/calculate")
async def calculate_ecl(
    body: IFRS9CalculateRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
):
    """
    Orchestrated IFRS 9 ECL:
      1. Classification (optional)
      2. Staging (unless stage_override)
      3. IFRS9ECLCalculator / IFRS9ProvisionMatrixEngine
      4. Scenario macro weighting (optional)
      5. Journal entries (nested FinReportAI format)
      6. Disclosure + stage movement bridge
    """
    firm_id = ifrs9_firm_id(request, x_firm_id)
    _user = ifrs9_user_id(request, x_user_id)
    payload = body.model_dump()
    payload["firm_id"] = firm_id
    try:
        result = orchestrate_calculate(payload)
        result["firm_id"] = firm_id
        result["calculated_by"] = _user

        portfolio_id = str(
            payload.get("portfolio_id")
            or payload.get("portfolioId")
            or body.portfolio_id
            or ""
        ).strip()
        result["persisted"] = False
        if ifrs9_db is not None and portfolio_id:
            try:
                run_row = ifrs9_db.save_calculation_run(
                    firm_id,
                    portfolio_id,
                    result,
                    input_snapshot=payload,
                    user_id=_user,
                )
                result["persisted"] = True
                result["calculation_run_id"] = run_row.get("id")
            except MigrationRequiredError:
                result["persist_warning"] = "Apply migration 005_ifrs9_persistence.sql to persist runs"
            except Exception as persist_exc:
                result["persist_warning"] = str(persist_exc)

        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/classify")
async def classify_instrument(
    body: IFRS9ClassificationRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    from ifrs9_ecl_calculator import IFRS9ClassificationEngine

    _ = ifrs9_firm_id(request, x_firm_id)
    engine = IFRS9ClassificationEngine()
    return engine.classify(body.model_dump())


@router.post("/macro-overlay")
async def macro_overlay(
    body: IFRS9MacroOverlayRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    from ifrs9_ecl_calculator import IFRS9MacroOverlayEngine

    _ = ifrs9_firm_id(request, x_firm_id)
    try:
        engine = IFRS9MacroOverlayEngine()
        payload = body.model_dump()
        if payload.get("loans") is None:
            payload["loans"] = []
        return engine.calculate(payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/provision-matrix")
async def provision_matrix(
    body: IFRS9ProvisionMatrixRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    from ifrs9_ecl_calculator import IFRS9ProvisionMatrixEngine

    _ = ifrs9_firm_id(request, x_firm_id)
    try:
        engine = IFRS9ProvisionMatrixEngine()
        payload = body.model_dump()
        if payload.get("receivables") is None:
            payload["receivables"] = []
        if payload.get("bucket_totals") is None:
            payload["bucket_totals"] = []
        if payload.get("historical_data") is None:
            payload["historical_data"] = []
        return engine.calculate(payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/master-report")
async def master_report(
    body: IFRS9MasterReportRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    from ifrs9_ecl_calculator import IFRS9MasterSummaryEngine

    _ = ifrs9_firm_id(request, x_firm_id)
    engine = IFRS9MasterSummaryEngine()
    return engine.generate(body.model_dump())


@router.post("/download-report")
async def download_simple_report(
    data: dict,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _ = ifrs9_firm_id(request, x_firm_id)
    try:
        import pandas as pd

        journals = normalize_ifrs9_journals(data.get("journal_entries"))
        file_id = str(uuid.uuid4())
        path = OUTPUT_DIR / f"ecl_report_{file_id}.xlsx"
        with pd.ExcelWriter(path, engine="openpyxl") as w:
            pd.DataFrame(
                [{"ECL Summary": data.get("applicable_ecl", 0), "Coverage %": data.get("coverage_ratio", 0)}]
            ).to_excel(w, sheet_name="ECL Summary", index=False)
            if data.get("bucket_results"):
                pd.DataFrame(data["bucket_results"]).to_excel(w, sheet_name="Provision Matrix", index=False)
            if journals:
                flat = []
                for je in journals:
                    for ent in je.get("entries", []):
                        flat.append(
                            {
                                "description": je.get("description"),
                                "account": ent.get("account"),
                                "dr": ent.get("debit", ent.get("dr")),
                                "cr": ent.get("credit", ent.get("cr")),
                            }
                        )
                pd.DataFrame(flat).to_excel(w, sheet_name="Journal Entries", index=False)
        gc.collect()
        return {"file_id": file_id, "filename": path.name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/download-excel")
async def download_excel_audit_pack(
    body: IFRS9DownloadExcelRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _ = ifrs9_firm_id(request, x_firm_id)
    try:
        from ifrs9_excel_export import export_ifrs9_excel

        payload = body.model_dump()
        payload["journal_entries"] = normalize_ifrs9_journals(payload.get("journal_entries"))
        master = payload.pop("master_report_data", None)
        file_id = export_ifrs9_excel(payload, master_report=master)
        safe_name = (body.portfolio_name or "Portfolio").replace(" ", "_").replace("/", "_")
        date_str = (body.reporting_date or datetime.now().strftime("%Y-%m-%d")).replace("-", "")
        filename = f"IFRS9_ECL_{safe_name}_{date_str}_{file_id}.xlsx"
        gc.collect()
        n_sheets = 6 if master else 5
        return {"file_id": file_id, "filename": filename, "sheets": n_sheets}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/download/{file_id}")
async def download_file(file_id: str):
    matching = list(OUTPUT_DIR.glob(f"*{file_id}*.xlsx"))
    if not matching:
        raise HTTPException(status_code=404, detail="File not found")
    path = sorted(matching, key=lambda p: p.stat().st_mtime, reverse=True)[0]
    return FileResponse(
        path=str(path),
        filename=path.name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{path.name}"'},
    )
