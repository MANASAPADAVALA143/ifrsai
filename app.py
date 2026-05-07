"""
IFRS 16 Lease Accounting Automation - FastAPI Application
Enterprise REST API for IFRS 16 calculations and reporting
"""

from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from decimal import Decimal
import io
import os
import json
import uuid
from pathlib import Path
import shutil
from contextlib import asynccontextmanager
import sys
from dotenv import load_dotenv

# Avoid UnicodeEncodeError on Windows (cp1252) when logging emoji or other non-ASCII text.
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (OSError, ValueError):
        pass
from currency_format import format_currency_value  # noqa: F401 — INR vs international amount formatting
import gc
from macro_sensitivity_config import MACRO_SENSITIVITY_DEFAULTS, update_sensitivity, get_sensitivity, is_db_loaded, set_db_loaded
from macro_sensitivity_db import init_db, get_active_config, save_config, get_config_history

# Load environment variables from .env file
# Always load from project root so .env is found regardless of cwd
_project_root = Path(__file__).resolve().parent
load_dotenv(_project_root / ".env")
if not os.getenv("ANTHROPIC_API_KEY"):
    load_dotenv(_project_root / "frontend" / ".env")  # fallback if key is in frontend/.env

# Heavy imports (pandas, numpy, anthropic, openpyxl) moved into route handlers
# RAG engine loads on first use, not at startup

# Configuration
UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("outputs")
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# Initialize services
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")


def get_public_api_base() -> str:
    """Base URL for printed links (docs, health). Cloud: RENDER_EXTERNAL_URL / PUBLIC_API_URL. Local: _IFRS_BIND_PORT."""
    r = (os.getenv("RENDER_EXTERNAL_URL") or "").strip().rstrip("/")
    if r:
        return r
    p = (os.getenv("PUBLIC_API_URL") or "").strip().rstrip("/")
    if p:
        return p
    port = (os.getenv("_IFRS_BIND_PORT") or "9000").strip()
    return f"http://127.0.0.1:{port}"

# Global RAG engine instance (lazy-loaded on first use)
rag_engine = None

def get_rag_engine():
    """Initialize RAG engine on first call. Loads ChromaDB + SentenceTransformer (~400MB)."""
    global rag_engine
    if rag_engine is not None:
        return rag_engine
    import traceback
    try:
        from rag_engine import IFRSRagEngine
        rag_engine = IFRSRagEngine(anthropic_api_key=ANTHROPIC_API_KEY)
        print("RAG engine initialized successfully")
        gc.collect()
        return rag_engine
    except Exception as e:
        print(f"RAG engine failed: {e}")
        traceback.print_exc()
        return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan: startup then yield (shutdown runs after yield)."""
    init_db()
    try:
        from entity_consolidation import init_consolidation_db
        init_consolidation_db()
    except Exception as e:
        print(f"Consolidation DB init warning: {e}")
    row = get_active_config()
    if row:
        update_sensitivity("gdp_sensitivity", row[0])
        update_sensitivity("unemployment_sensitivity", row[1])
        update_sensitivity("interest_rate_sensitivity", row[2])
        print(f"Macro sensitivity loaded from DB: GDP={row[0]}, Unemp={row[1]}, Rate={row[2]}")
    else:
        set_db_loaded(False)
        print("Macro sensitivity using hardcoded defaults")
    print("="*70)
    print("IFRS AI AUTOMATION API - SERVER STARTED")
    print("="*70)
    _base = get_public_api_base()
    print(f"API Documentation: {_base}/api/docs")
    print(f"ReDoc: {_base}/api/redoc")
    print(f"Health Check: {_base}/health")
    print(f"Claude API: {'Configured' if ANTHROPIC_API_KEY else 'Not configured'}")
    print("RAG engine: loads on first /api/chat or embed request")
    print("="*70)
    yield


# Initialize FastAPI with lifespan (replaces deprecated on_event)
app = FastAPI(
    title="IFRS 16 Lease Accounting Automation API",
    description="AI-powered IFRS 16 lease accounting automation using Claude API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan,
)

# CORS middleware - MUST be added before route definitions
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3002",
        "http://localhost:3003",
        "http://localhost:3004",
        "http://localhost:3005",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3002",
        "http://127.0.0.1:3003",
        "http://127.0.0.1:3004",
        "http://127.0.0.1:3005",
        "http://127.0.0.1:5173",
        "https://ifrsai.vercel.app",
        "https://ifrs-ai.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

@app.get("/health")
def health():
    """Simple health check for Render/load balancers"""
    return {"status": "ok"}

# Pydantic Models
class LeaseRequest(BaseModel):
    """Manual lease input request"""
    lease_id: str = Field(..., description="Unique lease identifier")
    company_id: str = Field(default="", description="Company identifier for RAG data isolation")
    asset_description: str = Field(..., description="Description of leased asset")
    lessee_name: str = Field(default="", description="Lessee company name")
    lessor_name: str = Field(default="", description="Lessor name")
    commencement_date: str = Field(..., description="Lease commencement date (YYYY-MM-DD)")
    lease_term_months: int = Field(..., gt=0, description="Lease term in months")
    monthly_payment: float = Field(..., gt=0, description="Monthly payment amount")
    non_lease_component: float = Field(default=0, ge=0, description="Monthly non-lease portion (e.g. service/maintenance) excluded from IFRS 16 liability")
    non_lease_description: str = Field(default="", description="What the non-lease component covers")
    practical_expedient_elected: bool = Field(default=False, description="IFRS 16 §15: elect not to separate components")
    annual_discount_rate: float = Field(..., gt=0.0001, le=1, description="Annual discount rate (e.g., 0.085 for 8.5%). IBR must be > 0%.")
    initial_direct_costs: float = Field(default=0, ge=0, description="Initial direct costs (legacy; use legal+brokerage+other if provided)")
    legal_fees: float = Field(default=0, ge=0, description="Legal fees")
    brokerage_fees: float = Field(default=0, ge=0, description="Brokerage / agent fees")
    other_initial_direct_costs: float = Field(default=0, ge=0, description="Other initial direct costs")
    initial_direct_costs_description: str = Field(default="", description="e.g. Legal fees for lease negotiation, agent commission")
    escalation_rate: float = Field(default=0, ge=0, description="Annual escalation rate (e.g., 0.05 for 5%)")
    cpi_index_base: float = Field(default=0, ge=0, description="CPI index at lease commencement (e.g. 100)")
    cpi_index_current: float = Field(default=0, ge=0, description="Latest CPI index value (e.g. 107.5)")
    cpi_adjustment_frequency_months: int = Field(default=12, ge=1, description="Months between CPI payment reviews (typically 12)")
    currency: str = Field(default="INR", description="Currency code")
    payment_type: str = Field(default="Arrears", description="Payment timing: 'Arrears' (end of period) or 'Advance' (beginning of period)")
    rent_free_months: int = Field(default=0, ge=0, description="Rent-free period in months")
    cash_incentive: float = Field(default=0, ge=0, description="Cash incentive received (reduces ROU asset)")
    lease_incentive_description: str = Field(default="", description="e.g. '2 months rent free'")
    rvg_amount: float = Field(default=0, ge=0, description="Residual value guarantee (guaranteed amount)")
    rvg_guaranteed_by: str = Field(default="None", description="Lessee | Third party | None")
    rvg_expected_payment: float = Field(default=0, ge=0, description="Expected payment at end of lease")
    
    class Config:
        json_schema_extra = {
            "example": {
                "lease_id": "LEASE-2024-001",
                "company_id": "COMP-ABC-001",
                "asset_description": "Commercial Office - 5,000 sq ft",
                "lessee_name": "TechCorp India Pvt. Ltd.",
                "lessor_name": "Prime Properties Ltd.",
                "commencement_date": "2024-01-01",
                "lease_term_months": 36,
                "monthly_payment": 50000,
                "annual_discount_rate": 0.085,
                "initial_direct_costs": 40000,
                "escalation_rate": 0.05,
                "currency": "INR"
            }
        }


class CalculationResponse(BaseModel):
    """Calculation response model"""
    status: str
    lease_id: str
    results: dict
    excel_file_id: Optional[str] = None


class ExtractionResponse(BaseModel):
    """Contract extraction response"""
    status: str
    extraction_id: str
    extracted_data: dict
    validation: dict


class ExtractionRequest(BaseModel):
    """Contract extraction request"""
    contract_text: str = Field(..., description="Lease contract text to extract")


class ChatRequest(BaseModel):
    """RAG chat request"""
    company_id: str = Field(..., description="Company identifier for data isolation")
    question: str = Field(..., description="Question to ask about company's IFRS documents")
    document_type: Optional[str] = Field(None, description="Filter by document type (lease, variance, contract, revenue, ecl)")
    top_k: int = Field(default=5, ge=1, le=20, description="Number of context chunks to retrieve")
    
    class Config:
        json_schema_extra = {
            "example": {
                "company_id": "COMP-ABC-001",
                "question": "What is the total lease liability for all office leases?",
                "document_type": "lease",
                "top_k": 5
            }
        }


class ChatResponse(BaseModel):
    """RAG chat response"""
    status: str
    answer: str
    sources: List[dict]
    context_count: int


class CFOInsightsRequest(BaseModel):
    """CFO strategic insights request - prompt built client-side from lease portfolio"""
    prompt: str = Field(..., description="Full prompt for Claude with lease portfolio JSON")


class IFRS16BulkCalculateRequest(BaseModel):
    """Bulk IFRS 16 calculation — same lease objects as /api/calculate"""
    leases: List[LeaseRequest] = Field(..., description="Leases to calculate")


class ModificationAdviceRequest(BaseModel):
    """IFRS 16 §44 vs §45 modification advisor — extractor hints + live modification inputs."""
    extractor_hints: Dict[str, Any] = Field(default_factory=dict)
    modification_inputs: Dict[str, Any] = Field(default_factory=dict)


class IbrSuggestRequest(BaseModel):
    country: str = Field(default="India")
    currency: str = Field(default="INR")
    lease_term_months: int = Field(..., gt=0)
    asset_type: Optional[str] = Field(default="")
    lessee_type: str = Field(default="Corporate")


# IFRS 15 Models
class PerformanceObligationRequest(BaseModel):
    obligation_id: str
    description: str
    standalone_selling_price: float
    recognition_method: str  # "over_time" or "point_in_time"
    duration_months: int = 0
    transfer_date: Optional[str] = None  # YYYY-MM-DD


class IFRS15CalculateRequest(BaseModel):
    contract_id: str
    customer_name: str
    vendor_name: str = ""
    effective_date: str  # YYYY-MM-DD
    contract_term_months: int
    fixed_consideration: float
    variable_consideration: float = 0
    # IFRS 15 §56-58 variable consideration constraint
    variable_consideration_constrained: float = Field(default=0, ge=0, description="Explicitly constrained VC amount (used when constraint_method='amount')")
    constraint_percentage: float = Field(default=100, ge=0, le=100, description="% of variable consideration that is highly probable (0–100). Default 100 = no constraint.")
    constraint_method: str = Field(default="percentage", description="'percentage' or 'amount'")
    discounts: float = 0
    rebates: float = 0
    financing_adjustment: float = 0
    currency: str = "USD"
    cash_received: float = 0
    contract_type: str = "fixed_price"
    hourly_rate: float = 0
    hours_worked: float = 0
    tm_cap: float = 0
    cumulative_billed: float = 0
    total_estimated_cost: float = 0
    actual_cost_to_date: float = 0
    prior_revenue_recognised: float = 0
    maintenance_term_months: int = 0
    volume_slabs: list = Field(default_factory=list)
    estimated_annual_volume: float = 0
    can_estimate_volume: bool = True
    sla_items: list = Field(default_factory=list)
    performance_obligations: List[PerformanceObligationRequest]
    payment_terms: str = ""


class IFRS15ClassifyContractRequest(BaseModel):
    contract_text: str = Field(..., min_length=1)


class IFRS15ModificationRequest(BaseModel):
    original_contract_id: str
    modification_date: str
    new_goods_services: List[str]
    price_change: float
    revenue_recognised_to_date: float
    remaining_periods: int
    original_price: float
    new_goods_are_distinct: bool
    price_reflects_standalone: bool
    remaining_goods_are_distinct: bool


class IFRS15DownloadExcelRequest(BaseModel):
    contract_id: str
    customer_name: Optional[str] = ""
    effective_date: Optional[str] = None
    contract_term_months: Optional[int] = 0
    currency: Optional[str] = "USD"
    results: Dict[str, Any]
    master_report_data: Optional[Dict[str, Any]] = None


class VariableScenario(BaseModel):
    outcome: str
    amount: float
    probability: float = 0.0  # 0.0 to 1.0


class IFRS15VariableConsiderationRequest(BaseModel):
    method: str  # "expected_value" | "scenario_weighted" | "most_likely"
    scenarios: List[VariableScenario]
    constraint_factors: List[bool]  # exactly 5 items
    contract_id: Optional[str] = None
    total_contract_value: Optional[float] = None


class IFRS15ReversalRiskRequest(BaseModel):
    contract_id: Optional[str] = None
    constraint_level: str
    contract_term_months: int
    customer_type: str
    variable_consideration: float
    total_contract_value: float
    refund_type: str = "none"  # none | partial | full
    recognition_type: str  # over_time | point_in_time
    historical_attainment_pct: Optional[float] = None
    has_external_dependency: bool = False
    dependency_level: str = "low"  # low | medium | high


class RPOObligation(BaseModel):
    obligation_name: str
    allocated_amount: float
    recognised_to_date: float
    expected_end_date: str  # ISO date string
    original_expected_duration_months: Optional[float] = None
    is_right_to_invoice: bool = False


class IFRS15RPORequest(BaseModel):
    obligations: List[RPOObligation]
    contract_id: Optional[str] = None


class IFRS15ContractCostsRequest(BaseModel):
    commission_amount: float
    contract_term_months: int
    contract_total_value: float
    contract_id: Optional[str] = None


class IFRS15PrincipalAgentRequest(BaseModel):
    transaction_price: float
    cost_paid_to_supplier: float
    obtains_before_transfer: bool
    sets_price_independently: bool
    primarily_responsible: bool
    contract_id: Optional[str] = None


class IFRS15LicenseRequest(BaseModel):
    transaction_price: float
    licence_term_months: int
    licence_start_date: str
    significantly_affects_ip: bool
    customer_exposed_as_occurs: bool
    activities_not_separate_good: bool
    includes_usage_royalties: bool
    contract_id: Optional[str] = None


class IFRS15MasterReportRequest(BaseModel):
    contract_id: str
    customer_name: str = ""
    core_results: Dict[str, Any]
    modification_result: Optional[Dict[str, Any]] = None
    variable_consideration_result: Optional[Dict[str, Any]] = None
    rpo_result: Optional[Dict[str, Any]] = None
    contract_costs_result: Optional[Dict[str, Any]] = None
    principal_agent_result: Optional[Dict[str, Any]] = None
    license_result: Optional[Dict[str, Any]] = None


class IFRS15MasterReportExcelRequest(BaseModel):
    master_report: Dict[str, Any]


class IFRS15ClientReportRequest(BaseModel):
    contract_id: str
    customer_name: str
    calculation_results: Dict[str, Any]
    master_report_data: Optional[Dict[str, Any]] = None
    include_auditor_qa: bool = True
    prepared_by: str = "IFRS AI"


class IFRS15DisclosureScorerRequest(BaseModel):
    disclosure_text: str
    calculation_results: Optional[Dict[str, Any]] = None


# Helper Functions
def convert_lease_request_to_input(request: LeaseRequest):
    """Convert API request to LeaseInput dataclass"""
    from ifrs16_calculator import LeaseInput
    raw_date = (request.commencement_date or "").strip()[:10]
    try:
        commencement_dt = datetime.strptime(raw_date, "%Y-%m-%d")
    except ValueError as e:
        raise ValueError(
            f"commencement_date must be YYYY-MM-DD (got {request.commencement_date!r})"
        ) from e
    return LeaseInput(
        lease_id=request.lease_id,
        asset_description=request.asset_description,
        lessee_name=request.lessee_name,
        lessor_name=request.lessor_name,
        commencement_date=commencement_dt,
        lease_term_months=request.lease_term_months,
        monthly_payment=Decimal(str(request.monthly_payment)),
        non_lease_component=Decimal(str(getattr(request, 'non_lease_component', 0) or 0)),
        non_lease_description=getattr(request, 'non_lease_description', '') or '',
        practical_expedient_elected=bool(getattr(request, 'practical_expedient_elected', False)),
        annual_discount_rate=Decimal(str(request.annual_discount_rate)),
        initial_direct_costs=Decimal(str(request.initial_direct_costs)),
        legal_fees=Decimal(str(getattr(request, "legal_fees", 0) or 0)),
        brokerage_fees=Decimal(str(getattr(request, "brokerage_fees", 0) or 0)),
        other_initial_direct_costs=Decimal(str(getattr(request, "other_initial_direct_costs", 0) or 0)),
        initial_direct_costs_description=getattr(request, "initial_direct_costs_description", "") or "",
        escalation_rate=Decimal(str(request.escalation_rate)),
        cpi_index_base=Decimal(str(getattr(request, "cpi_index_base", 0) or 0)),
        cpi_index_current=Decimal(str(getattr(request, "cpi_index_current", 0) or 0)),
        cpi_adjustment_frequency_months=int(getattr(request, "cpi_adjustment_frequency_months", 12) or 12),
        currency=request.currency,
        payment_type=getattr(request, "payment_type", "Arrears") or "Arrears",
        rent_free_months=getattr(request, "rent_free_months", 0) or 0,
        cash_incentive=Decimal(str(getattr(request, "cash_incentive", 0) or 0)),
        lease_incentive_description=getattr(request, "lease_incentive_description", "") or "",
        rvg_amount=Decimal(str(getattr(request, "rvg_amount", 0) or 0)),
        rvg_guaranteed_by=getattr(request, "rvg_guaranteed_by", "None") or "None",
        rvg_expected_payment=Decimal(str(getattr(request, "rvg_expected_payment", 0) or 0)),
    )


# API Endpoints

@app.get("/", response_class=HTMLResponse)
async def root():
    """Root endpoint - Frontend page"""
    html_file = Path("templates/index.html")
    if html_file.exists():
        return html_file.read_text(encoding='utf-8')
    else:
        return """
        <html>
            <head><title>IFRS AI Platform</title></head>
            <body style="font-family: Arial; text-align: center; padding: 50px;">
                <h1>🚀 IFRS AI Automation Platform</h1>
                <p>Server is running!</p>
                <a href="/api/docs" style="display: inline-block; background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; margin: 20px;">
                    Open API Documentation
                </a>
            </body>
        </html>
        """

@app.get("/ifrs16", response_class=HTMLResponse)
async def ifrs16_page():
    """IFRS 16 Lease Accounting Form"""
    html_file = Path("templates/ifrs16.html")
    if html_file.exists():
        return html_file.read_text(encoding='utf-8')
    else:
        raise HTTPException(status_code=404, detail="IFRS 16 page not found")

@app.get("/ifrs15", response_class=HTMLResponse)
async def ifrs15_page():
    """IFRS 15 Revenue Recognition Form"""
    html_file = Path("templates/ifrs15.html")
    if html_file.exists():
        return html_file.read_text(encoding='utf-8')
    else:
        raise HTTPException(status_code=404, detail="IFRS 15 page not found")


@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "anthropic_configured": bool(ANTHROPIC_API_KEY)
    }


@app.post("/api/health/alert")
async def send_health_alert(alert_data: dict):
    """Send email alert when health checks fail"""
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    try:
        subject = alert_data.get("subject", "IFRS AI Health Alert")
        message = alert_data.get("message", "")
        failures = alert_data.get("failures", [])

        body = f"""
IFRS AI Health Monitor Alert
============================
Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

{message}

DETAILS:
"""
        for f in failures:
            body += f"\n❌ {f.get('name', '')}"
            body += f"\n   Error: {f.get('error', '')}"
            body += f"\n   Fix: {f.get('fix', 'Check logs')}\n"

        body += """
---
This is an automated alert from IFRS AI Health Monitor.
Fix issues before client demos.
        """

        sender_email = os.getenv("ALERT_EMAIL_FROM", "")
        sender_password = os.getenv("ALERT_EMAIL_PASSWORD", "")
        receiver_email = os.getenv("ALERT_EMAIL_TO", "manasa@gnanova.pro")

        if sender_email and sender_password:
            msg = MIMEMultipart()
            msg["From"] = sender_email
            msg["To"] = receiver_email
            msg["Subject"] = subject
            msg.attach(MIMEText(body, "plain"))

            with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
                server.login(sender_email, sender_password)
                server.sendmail(sender_email, receiver_email, msg.as_string())

            return {"status": "alert_sent", "email": receiver_email}
        else:
            print(f"\n{'='*50}")
            print("HEALTH ALERT (email not configured):")
            print(body)
            print("="*50)
            return {"status": "logged", "message": "Configure ALERT_EMAIL_FROM and ALERT_EMAIL_PASSWORD in .env"}
    except Exception as e:
        print(f"Alert error: {e}")
        return {"status": "error", "message": str(e)}


class QAValidateRequest(BaseModel):
    """QA validation request with IFRS calculation results"""
    ifrs16_results: Optional[Dict] = None
    ifrs15_results: Optional[Dict] = None
    ifrs9_results: Optional[Dict] = None


@app.post("/api/health/qa-validate")
async def qa_validate(request: QAValidateRequest):
    """Validate IFRS calculation results using Claude (Big4 auditor style)"""
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")
    import anthropic
    try:
        payload = json.dumps({
            "ifrs16": request.ifrs16_results,
            "ifrs15": request.ifrs15_results,
            "ifrs9": request.ifrs9_results,
        }, indent=2, default=str)[:12000]
        prompt = f"""You are a Big4 auditor validating IFRS calculations.

Check these results against IFRS standards:

IFRS 16: Is lease_liability = PV of lease payments? Is ROU asset = lease_liability + initial direct costs?
IFRS 15: Does total recognised + deferred = contract value? 5-step model applied?
IFRS 9: Is ECL = PD × LGD × EAD for each loan? (If no IFRS 9 data, set pass: false, issues: ["IFRS 9 API not implemented"])

RESULTS TO VALIDATE:
{payload}

Return ONLY valid JSON in this exact format:
{{"pass": true/false, "issues": ["issue1", "issue2"], "confidence": 0-100, "ifrs16_notes": "string", "ifrs15_notes": "string", "ifrs9_notes": "string"}}"""

        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        msg = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1500,
            temperature=0,
            messages=[{"role": "user", "content": prompt}]
        )
        text = msg.content[0].text.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
        data = json.loads(text)
        gc.collect()
        return {"status": "success", "validation": data}
    except json.JSONDecodeError as e:
        return {"status": "error", "validation": {"pass": False, "issues": [f"Parse error: {e}"], "confidence": 0}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class QAReportEmailRequest(BaseModel):
    report_text: str
    subject: str = "IFRS AI — QA Validation Report"


@app.post("/api/health/qa-report-email")
async def qa_report_email(request: QAReportEmailRequest):
    """Email the QA report to configured recipient"""
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    sender_email = os.getenv("ALERT_EMAIL_FROM", "")
    sender_password = os.getenv("ALERT_EMAIL_PASSWORD", "")
    receiver_email = os.getenv("ALERT_EMAIL_TO", "manasa@gnanova.pro")
    if not sender_email or not sender_password:
        return {"status": "logged", "message": "Email not configured. Set ALERT_EMAIL_FROM and ALERT_EMAIL_PASSWORD."}
    try:
        msg = MIMEMultipart()
        msg["From"] = sender_email
        msg["To"] = receiver_email
        msg["Subject"] = request.subject
        msg.attach(MIMEText(request.report_text, "plain"))
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(sender_email, sender_password)
            server.sendmail(sender_email, receiver_email, msg.as_string())
        return {"status": "sent", "email": receiver_email}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/api/calculate", response_model=CalculationResponse)
async def calculate_lease(request: LeaseRequest):
    """
    Calculate IFRS 16 lease accounting metrics
    
    Performs complete IFRS 16 calculation including:
    - Lease liability (PV calculation)
    - ROU asset
    - Amortization schedule
    - Journal entries
    - Maturity analysis
    - P&L impact
    """
    try:
        from ifrs16_calculator import IFRS16Calculator
        from ifrs16_excel_export import IFRS16ExcelExporter
        # Convert request to LeaseInput
        lease_input = convert_lease_request_to_input(request)
        
        # Perform calculation
        calculator = IFRS16Calculator()
        results = calculator.calculate_full_ifrs16(lease_input)
        
        # Convert DataFrame to dict for JSON serialization
        results_json = results.copy()
        if 'amortization_schedule' in results_json:
            results_json['amortization_schedule'] = results_json['amortization_schedule'].to_dict(orient='records')
        
        # Generate Excel file
        file_id = str(uuid.uuid4())
        excel_filename = OUTPUT_DIR / f"IFRS16_{request.lease_id}_{file_id}.xlsx"
        
        exporter = IFRS16ExcelExporter()
        exporter.export_ifrs16_workbook(results, str(excel_filename))
        
        # Auto-trigger RAG embedding only when company_id is provided.
        engine = get_rag_engine() if request.company_id else None
        if engine:
            try:
                # Prepare content for embedding (use original results with DataFrames converted)
                embed_content = {
                    "lease_id": request.lease_id,
                    "company_id": request.company_id,
                    "asset_description": request.asset_description,
                    "lessee_name": request.lessee_name,
                    "lessor_name": request.lessor_name,
                    "commencement_date": request.commencement_date,
                    "lease_term_months": request.lease_term_months,
                    "monthly_payment": request.monthly_payment,
                    "annual_discount_rate": request.annual_discount_rate,
                    "currency": request.currency,
                    "lease_liability": float(results['lease_liability']),
                    "rou_asset": float(results['rou_asset']),
                    "monthly_depreciation": float(results['monthly_depreciation']),
                    "total_interest": float(results['total_interest']),
                    "year_1_impact": results_json['year_1_impact']
                }
                
                # Store in RAG engine
                rag_result = engine.embed_and_store(
                    company_id=request.company_id,
                    document_type="lease",
                    content=embed_content,
                    document_id=request.lease_id
                )
                print(f"RAG embedding completed: {rag_result.get('status')}")
                
            except Exception as rag_error:
                print(f"RAG embedding failed (non-critical): {rag_error}")
                # Don't fail the request if RAG embedding fails
        
        gc.collect()
        return CalculationResponse(
            status="success",
            lease_id=request.lease_id,
            results=results_json,
            excel_file_id=file_id
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Calculation error: {str(e)}")


@app.post("/api/extract", response_model=ExtractionResponse)
async def extract_contract(request: ExtractionRequest):
    """
    Extract lease terms from contract text using Claude API
    
    Uses Claude Sonnet 4.5 to extract:
    - Lease dates and terms
    - Payment amounts and schedules
    - Initial costs
    - Options and clauses
    - IFRS 16 classification
    """
    if not ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Claude API not configured. Set ANTHROPIC_API_KEY environment variable."
        )
    
    try:
        from ifrs16_extractor import IFRS16LeaseExtractor
        extractor = IFRS16LeaseExtractor(api_key=ANTHROPIC_API_KEY)
        
        # Extract lease terms
        extracted_data = extractor.extract_lease_terms(request.contract_text)
        
        # Validate extraction
        validation = extractor.validate_extraction(extracted_data)
        
        # Save extraction
        extraction_id = str(uuid.uuid4())
        extraction_file = OUTPUT_DIR / f"extraction_{extraction_id}.json"
        extractor.save_extraction(extracted_data, str(extraction_file))
        
        gc.collect()
        return ExtractionResponse(
            status="success",
            extraction_id=extraction_id,
            extracted_data=extracted_data,
            validation=validation
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Extraction error: {str(e)}")


@app.get("/api/upload-contract")
async def upload_contract_get():
    """GET not allowed; use POST with a file. See /api/docs for usage."""
    return JSONResponse(
        status_code=200,
        content={
            "message": "This endpoint accepts POST only. Upload a file from the app or use the API docs.",
            "docs": f"{get_public_api_base()}/api/docs",
            "method": "POST",
        },
    )


@app.post("/api/upload-contract")
async def upload_contract(file: UploadFile = File(...)):
    """
    Upload lease contract file (PDF, DOCX, TXT, Excel) and extract terms
    
    Supports:
    - PDF files (with OCR if needed)
    - Word documents (.docx)
    - Text files (.txt)
    - Excel files (.xlsx, .xls)
    """
    import traceback
    safe_name = (file.filename or "upload").replace("\\", "_").replace("/", "_")
    print(f"📥 Upload received: {safe_name} ({file.content_type})")

    if not ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Claude API not configured. Set ANTHROPIC_API_KEY environment variable."
        )

    allowed_extensions = ['.pdf', '.docx', '.txt', '.xlsx', '.xls']
    file_ext = Path(safe_name).suffix.lower()

    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {', '.join(allowed_extensions)}"
        )

    file_id = str(uuid.uuid4())
    upload_path = UPLOAD_DIR / f"{file_id}_{safe_name}"
    
    try:
        # Save uploaded file
        with open(upload_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        print(f"❌ Save error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")
    
    try:
        # Extract from file
        from ifrs16_extractor import IFRS16LeaseExtractor
        extractor = IFRS16LeaseExtractor(api_key=ANTHROPIC_API_KEY)
        extracted_data = extractor.extract_from_file(str(upload_path))
        
        # Validate extraction (don't let validation failure break the response)
        try:
            validation = extractor.validate_extraction(extracted_data)
        except Exception as val_err:
            print(f"⚠️ Validation warning: {val_err}")
            validation = {
                'is_valid': False,
                'errors': [str(val_err)],
                'warnings': [],
                'requires_review': True,
                'low_confidence_count': 0,
                'error_count': 1,
                'warning_count': 0
            }
        
        # Save extraction
        try:
            extraction_file = OUTPUT_DIR / f"extraction_{file_id}.json"
            extractor.save_extraction(extracted_data, str(extraction_file))
        except Exception as save_err:
            print(f"⚠️ Could not save extraction JSON: {save_err}")
        
        del extractor  # free ref so gc can reclaim
        print(f"✅ Extraction complete: {safe_name}")
        gc.collect()
        
        # Ensure JSON-serializable (datetime, Decimal, etc.)
        def make_serializable(obj):
            if obj is None:
                return None
            if isinstance(obj, dict):
                return {str(k): make_serializable(v) for k, v in obj.items()}
            if isinstance(obj, list):
                return [make_serializable(v) for v in obj]
            if isinstance(obj, (str, int, float, bool)):
                return obj
            if hasattr(obj, 'isoformat'):
                return obj.isoformat()
            if hasattr(obj, '__float__') and not isinstance(obj, (int, float)):
                try:
                    return float(obj)
                except (TypeError, ValueError):
                    return str(obj)
            return str(obj)
        
        extracted_data = make_serializable(extracted_data)
        validation = make_serializable(validation)
        
        return {
            "status": "success",
            "file_id": file_id,
            "filename": safe_name,
            "extracted_data": extracted_data,
            "validation": validation
        }
        
    except Exception as e:
        err_msg = str(e)
        print(f"❌ Upload error: {err_msg}")
        traceback.print_exc()
        # Common causes: Claude rate limit, memory after multiple uploads, temp file / file handle
        if "api_key" in err_msg.lower() or "authentication" in err_msg.lower():
            raise HTTPException(status_code=503, detail="Invalid Claude API key. Check ANTHROPIC_API_KEY in .env")
        if "rate" in err_msg.lower() or "overloaded" in err_msg.lower():
            raise HTTPException(status_code=503, detail="Claude API rate limit. Please try again in a moment.")
        if "File not found" in err_msg or "No such file" in err_msg:
            raise HTTPException(status_code=500, detail="File could not be read. Try a different file.")
        if "JSON" in err_msg or "json" in err_msg:
            raise HTTPException(status_code=500, detail="AI extraction returned invalid format. Try again or use a clearer contract.")
        raise HTTPException(status_code=500, detail=f"Extraction failed: {err_msg[:200]}")
    finally:
        # Always delete temp upload file to avoid disk buildup and possible lock/memory issues
        try:
            if upload_path.exists():
                upload_path.unlink()
                print(f"🗑️ Cleaned up temp file: {upload_path.name}")
        except Exception as cleanup_err:
            print(f"⚠️ Could not delete temp file {upload_path}: {cleanup_err}")
        gc.collect()


@app.post("/api/ifrs16/modification-advice")
async def ifrs16_modification_advice(body: ModificationAdviceRequest):
    """
    Suggest IFRS 16 modification treatment (§44 separate lease vs §45 remeasurement)
    from extractor-style JSON plus current modification form values.
    """
    from modification_advisor import advise_modification

    result = advise_modification(body.extractor_hints or {}, body.modification_inputs or {})
    return result


@app.get("/api/download/{file_id}")
async def download_file(file_id: str):
    """
    Download generated Excel report
    
    Args:
        file_id: File ID returned from /api/calculate endpoint
    """
    # Find file with this ID
    matching_files = list(OUTPUT_DIR.glob(f"*{file_id}*.xlsx"))
    
    if not matching_files:
        raise HTTPException(status_code=404, detail="File not found")
    
    file_path = matching_files[0]
    
    return FileResponse(
        path=str(file_path),
        filename=file_path.name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


@app.delete("/api/cleanup")
async def cleanup_files(older_than_days: int = 7):
    """
    Cleanup old files from uploads and outputs directories
    
    Args:
        older_than_days: Delete files older than this many days
    """
    import time
    
    deleted_count = 0
    cutoff_time = time.time() - (older_than_days * 86400)
    
    for directory in [UPLOAD_DIR, OUTPUT_DIR]:
        for file_path in directory.iterdir():
            if file_path.is_file() and file_path.stat().st_mtime < cutoff_time:
                file_path.unlink()
                deleted_count += 1
    
    return {
        "status": "success",
        "deleted_files": deleted_count,
        "older_than_days": older_than_days
    }


@app.post("/api/batch-calculate")
async def batch_calculate(leases: List[LeaseRequest]):
    """
    Batch calculate multiple leases
    
    Calculates IFRS 16 metrics for multiple leases in one request
    """
    from ifrs16_calculator import IFRS16Calculator
    results = []
    
    for lease in leases:
        try:
            lease_input = convert_lease_request_to_input(lease)
            calculator = IFRS16Calculator()
            result = calculator.calculate_full_ifrs16(lease_input)
            
            # Convert DataFrame
            result_json = result.copy()
            if 'amortization_schedule' in result_json:
                result_json['amortization_schedule'] = result_json['amortization_schedule'].to_dict(orient='records')
            
            results.append({
                "lease_id": lease.lease_id,
                "status": "success",
                "results": result_json
            })
            
        except Exception as e:
            results.append({
                "lease_id": lease.lease_id,
                "status": "error",
                "error": str(e)
            })
    
    gc.collect()
    return {
        "status": "completed",
        "total_leases": len(leases),
        "successful": sum(1 for r in results if r["status"] == "success"),
        "failed": sum(1 for r in results if r["status"] == "error"),
        "results": results
    }


@app.post("/api/ifrs16/bulk-calculate")
async def ifrs16_bulk_calculate(body: IFRS16BulkCalculateRequest):
    """
    Calculate IFRS 16 for many leases in one request.
    One failure does not stop the rest. Returns summary metrics per lease + portfolio roll-up.
    """
    from ifrs16_calculator import IFRS16Calculator

    out_results: List[Dict[str, Any]] = []
    total = len(body.leases)
    successful = 0
    failed = 0
    total_lease_liability = 0.0
    total_rou_asset = 0.0
    ibr_sum = 0.0
    currency_counts: Dict[str, int] = {}

    for lease in body.leases:
        try:
            lease_input = convert_lease_request_to_input(lease)
            calculator = IFRS16Calculator()
            result = calculator.calculate_full_ifrs16(lease_input)
            result_json = result.copy()
            if "amortization_schedule" in result_json and hasattr(result_json["amortization_schedule"], "to_dict"):
                result_json["amortization_schedule"] = result_json["amortization_schedule"].to_dict(orient="records")

            ll = float(result.get("lease_liability", 0) or 0)
            rou = float(result.get("rou_asset", 0) or 0)
            md = float(result.get("monthly_depreciation", 0) or 0)
            ti = float(result.get("total_interest", 0) or 0)

            total_lease_liability += ll
            total_rou_asset += rou
            ibr_sum += float(lease.annual_discount_rate or 0)
            ccy = (lease.currency or "INR").upper()
            currency_counts[ccy] = currency_counts.get(ccy, 0) + 1
            successful += 1

            out_results.append(
                {
                    "lease_id": lease.lease_id,
                    "status": "success",
                    "error": None,
                    "lease_liability": ll,
                    "rou_asset": rou,
                    "monthly_depreciation": md,
                    "total_interest": ti,
                    "calculation_results": result_json,
                }
            )
        except Exception as e:
            failed += 1
            out_results.append(
                {
                    "lease_id": getattr(lease, "lease_id", "") or "",
                    "status": "error",
                    "error": str(e),
                    "lease_liability": 0.0,
                    "rou_asset": 0.0,
                    "monthly_depreciation": 0.0,
                    "total_interest": 0.0,
                    "calculation_results": None,
                }
            )

    gc.collect()
    avg_ibr = (ibr_sum / successful) if successful else 0.0
    return {
        "total": total,
        "successful": successful,
        "failed": failed,
        "results": out_results,
        "portfolio_summary": {
            "total_lease_liability": total_lease_liability,
            "total_rou_asset": total_rou_asset,
            "avg_ibr": avg_ibr,
            "currency_breakdown": currency_counts,
        },
    }


@app.get("/api/ifrs16/bulk-template")
async def ifrs16_bulk_template():
    """Download Excel template for portfolio bulk upload (3 sample rows)."""
    from openpyxl import Workbook
    from openpyxl.styles import PatternFill, Font, Alignment
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = "Leases"

    headers = [
        "lease_id",
        "asset_description",
        "lessee_name",
        "lessor_name",
        "commencement_date",
        "lease_term_months",
        "monthly_payment",
        "annual_discount_rate",
        "currency",
        "payment_type",
        "rent_free_months",
        "escalation_rate",
        "legal_fees",
        "brokerage_fees",
        "other_initial_direct_costs",
        "cash_incentive",
        "rvg_amount",
        "rvg_guaranteed_by",
        "rvg_expected_payment",
        "cpi_index_base",
        "cpi_index_current",
        "cpi_adjustment_frequency_months",
        "non_lease_component",
        "non_lease_description",
        "practical_expedient_elected",
    ]

    yellow = PatternFill(start_color="FFFFCC", end_color="FFFFCC", fill_type="solid")
    instr = (
        "Fill in your lease data below. Do not change column headers. "
        "Date format: YYYY-MM-DD. Rates as decimals: 8.5% = 0.085"
    )
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(headers))
    c1 = ws.cell(row=1, column=1, value=instr)
    c1.fill = yellow
    c1.font = Font(bold=True)
    c1.alignment = Alignment(wrap_text=True, vertical="center")
    ws.row_dimensions[1].height = 36

    for col, h in enumerate(headers, start=1):
        cell = ws.cell(row=2, column=col, value=h)
        cell.font = Font(bold=True)

    samples = [
        [
            "OFFICE-SAMPLE-001",
            "Corporate Office — Banjara Hills, Hyderabad",
            "Gnanova Technologies Pvt Ltd",
            "Prestige Estates Pvt Ltd",
            "2024-04-01",
            36,
            85000,
            0.085,
            "INR",
            "Arrears",
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            "None",
            0,
            0,
            0,
            12,
            0,
            "",
            "FALSE",
        ],
        [
            "DC-SAMPLE-001",
            "Data Centre Space — HITEC City, Hyderabad",
            "Gnanova Technologies Pvt Ltd",
            "CtrlS Datacenters Ltd",
            "2024-04-01",
            60,
            500000,
            0.105,
            "INR",
            "Arrears",
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            "None",
            0,
            100,
            107.5,
            12,
            75000,
            "Data centre cooling, physical security, UPS power",
            "FALSE",
        ],
        [
            "IBM-SAMPLE-001",
            "IBM Power Server Rack — HITEC City Data Centre",
            "Gnanova Technologies Pvt Ltd",
            "IBM India Pvt Ltd",
            "2024-07-01",
            60,
            250000,
            0.105,
            "INR",
            "Arrears",
            2,
            0.05,
            40000,
            35000,
            25000,
            50000,
            300000,
            "Lessee",
            150000,
            100,
            103,
            12,
            30000,
            "IBM hardware maintenance included in rent",
            "FALSE",
        ],
    ]

    for r_idx, row in enumerate(samples, start=3):
        for c_idx, val in enumerate(row, start=1):
            ws.cell(row=r_idx, column=c_idx, value=val)

    for col in range(1, len(headers) + 1):
        ws.column_dimensions[get_column_letter(col)].width = 22

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    gc.collect()
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="ifrs16_bulk_lease_template.xlsx"'},
    )


# ==================== IFRS 15 Endpoints ====================

class IFRS15ExtractRequest(BaseModel):
    contract_text: str = Field(..., description="Contract text to extract")


class IFRS15ClauseDetectionRequest(BaseModel):
    contract_text: str


@app.post("/api/ifrs15/detect-clauses")
async def ifrs15_detect_clauses(request: IFRS15ClauseDetectionRequest):
    """Standalone IFRS 15 non-standard clause scan (same engine as upload)."""
    try:
        from ifrs15_extractor import detect_nonstandard_clauses

        return detect_nonstandard_clauses(request.contract_text, api_key=ANTHROPIC_API_KEY)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ifrs15/extract")
async def ifrs15_extract(request: IFRS15ExtractRequest):
    """Extract IFRS 15 terms from pasted contract text"""
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="Claude API not configured.")
    try:
        from ifrs15_extractor import IFRS15ContractExtractor, detect_nonstandard_clauses

        extractor = IFRS15ContractExtractor(api_key=ANTHROPIC_API_KEY)
        extracted_data = extractor.extract_contract_terms(request.contract_text)
        validation = extractor.validate_ifrs15_extraction(extracted_data)
        clause_detection = detect_nonstandard_clauses(request.contract_text, api_key=ANTHROPIC_API_KEY)
        gc.collect()
        return {
            "status": "success",
            "extracted_data": extracted_data,
            "validation": validation,
            "clause_detection": clause_detection,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ifrs15/upload-contract")
async def ifrs15_upload_contract(file: UploadFile = File(...)):
    """
    Upload revenue contract (PDF, DOCX, TXT, XLSX) and extract IFRS 15 terms
    """
    if not ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Claude API not configured. Set ANTHROPIC_API_KEY environment variable."
        )
    allowed_extensions = ['.pdf', '.docx', '.txt', '.xlsx', '.xls']
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in allowed_extensions:
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Allowed: {', '.join(allowed_extensions)}")
    try:
        file_id = str(uuid.uuid4())
        upload_path = UPLOAD_DIR / f"ifrs15_{file_id}_{file.filename}"
        with open(upload_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        from ifrs15_extractor import IFRS15ContractExtractor, detect_nonstandard_clauses, read_contract_file_to_text

        extractor = IFRS15ContractExtractor(api_key=ANTHROPIC_API_KEY)
        extracted_data = extractor.extract_from_file(str(upload_path))
        validation = extractor.validate_ifrs15_extraction(extracted_data)
        extraction_file = OUTPUT_DIR / f"ifrs15_extraction_{file_id}.json"
        extractor.save_extraction(extracted_data, str(extraction_file))
        try:
            contract_text = read_contract_file_to_text(str(upload_path))
        except Exception:
            contract_text = ""
        clause_detection = detect_nonstandard_clauses(contract_text, api_key=ANTHROPIC_API_KEY)
        gc.collect()
        return {
            "status": "success",
            "file_id": file_id,
            "filename": file.filename,
            "extracted_data": extracted_data,
            "validation": validation,
            "clause_detection": clause_detection,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ifrs15/calculate")
async def ifrs15_calculate(request: IFRS15CalculateRequest):
    """
    Calculate IFRS 15 revenue recognition
    """
    try:
        from ifrs15_calculator import IFRS15Calculator, IFRS15Input, PerformanceObligation
        obligations = []
        for ob in request.performance_obligations:
            transfer_dt = None
            if ob.transfer_date:
                try:
                    transfer_dt = datetime.strptime(ob.transfer_date, "%Y-%m-%d")
                except ValueError:
                    pass
            obligations.append(PerformanceObligation(
                obligation_id=ob.obligation_id,
                description=ob.description,
                standalone_selling_price=Decimal(str(ob.standalone_selling_price)),
                recognition_method=ob.recognition_method,
                duration_months=ob.duration_months,
                transfer_date=transfer_dt
            ))
        contract = IFRS15Input(
            contract_id=request.contract_id,
            customer_name=request.customer_name,
            vendor_name=request.vendor_name,
            effective_date=datetime.strptime(request.effective_date, "%Y-%m-%d"),
            contract_term_months=request.contract_term_months,
            fixed_consideration=Decimal(str(request.fixed_consideration)),
            variable_consideration=Decimal(str(request.variable_consideration)),
            variable_consideration_constrained=Decimal(str(request.variable_consideration_constrained)),
            constraint_percentage=Decimal(str(request.constraint_percentage)),
            constraint_method=request.constraint_method,
            discounts=Decimal(str(request.discounts)),
            rebates=Decimal(str(request.rebates)),
            financing_adjustment=Decimal(str(request.financing_adjustment)),
            currency=request.currency,
            contract_type=request.contract_type,
            hourly_rate=Decimal(str(request.hourly_rate)),
            hours_worked=Decimal(str(request.hours_worked)),
            tm_cap=Decimal(str(request.tm_cap)),
            cumulative_billed=Decimal(str(request.cumulative_billed)),
            total_estimated_cost=Decimal(str(request.total_estimated_cost)),
            actual_cost_to_date=Decimal(str(request.actual_cost_to_date)),
            prior_revenue_recognised=Decimal(str(request.prior_revenue_recognised)),
            maintenance_term_months=request.maintenance_term_months,
            volume_slabs=request.volume_slabs,
            estimated_annual_volume=Decimal(str(request.estimated_annual_volume)),
            can_estimate_volume=request.can_estimate_volume,
            sla_items=request.sla_items,
            performance_obligations=obligations,
            payment_terms=(request.payment_terms or "").strip(),
        )
        calc = IFRS15Calculator()
        results = calc.calculate_full_ifrs15(contract, cash_received=Decimal(str(request.cash_received)))
        results_json = results.copy()
        if 'recognition_schedule' in results_json and hasattr(results_json['recognition_schedule'], 'to_dict'):
            results_json['recognition_schedule'] = results_json['recognition_schedule'].to_dict(orient='records')
        file_id = str(uuid.uuid4())
        safe_id = "".join(c for c in request.contract_id if c.isalnum() or c in "-_")[:30]
        excel_path = OUTPUT_DIR / f"IFRS15_{safe_id}_{file_id}.xlsx"
        try:
            from ifrs15_excel_export import IFRS15ExcelExporter
            exporter = IFRS15ExcelExporter()
            exporter.export_ifrs15_workbook(
                results=results_json,
                contract_meta={
                    "contract_id": request.contract_id,
                    "customer_name": request.customer_name,
                    "effective_date": request.effective_date,
                    "contract_term_months": request.contract_term_months,
                    "currency": request.currency,
                },
                filename=str(excel_path),
            )
        except Exception:
            pass
        gc.collect()
        return {
            "status": "success",
            "contract_id": request.contract_id,
            "results": results_json,
            "excel_file_id": file_id
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ifrs15/download-excel")
async def ifrs15_download_excel(request: IFRS15DownloadExcelRequest):
    """Generate IFRS 15 six-sheet audit workbook (master summary + five core sheets) from calculation results."""
    try:
        from ifrs15_excel_export import IFRS15ExcelExporter

        file_id = str(uuid.uuid4())
        safe_id = "".join(c for c in request.contract_id if c.isalnum() or c in "-_")[:30]
        excel_path = OUTPUT_DIR / f"IFRS15_{safe_id}_{file_id}.xlsx"

        exporter = IFRS15ExcelExporter()
        res = request.results or {}
        exporter.export_ifrs15_workbook(
            results=res,
            contract_meta={
                "contract_id": request.contract_id,
                "customer_name": request.customer_name or "",
                "effective_date": request.effective_date or "",
                "contract_term_months": request.contract_term_months or 0,
                "currency": request.currency or "USD",
                "variable_consideration_assessment": res.get("variable_consideration_assessment"),
                "rpo_disclosure": res.get("rpo_disclosure"),
                "contract_costs_assessment": res.get("contract_costs_assessment"),
                "principal_agent_assessment": res.get("principal_agent_assessment"),
                "license_classification": res.get("license_classification"),
            },
            filename=str(excel_path),
            master_report=request.master_report_data,
        )

        gc.collect()
        return {"status": "success", "file_id": file_id, "filename": excel_path.name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ifrs15/modification")
async def ifrs15_modification(request: IFRS15ModificationRequest):
    """Assess IFRS 15 contract modification type and accounting impact."""
    try:
        from ifrs15_calculator import IFRS15ModificationEngine

        engine = IFRS15ModificationEngine()
        result = engine.assess_modification(request.model_dump())
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ifrs15/variable-consideration")
async def ifrs15_variable_consideration(request: IFRS15VariableConsiderationRequest):
    """Estimate and constrain variable consideration (IFRS 15.50–58)."""
    if len(request.constraint_factors) != 5:
        raise HTTPException(status_code=400, detail="constraint_factors must have exactly 5 values")
    try:
        from ifrs15_calculator import IFRS15VariableConsiderationEngine

        body: Dict[str, Any] = {
            "method": request.method,
            "scenarios": [s.model_dump() for s in request.scenarios],
            "constraint_factors": list(request.constraint_factors),
        }
        if request.total_contract_value is not None:
            body["total_contract_value"] = request.total_contract_value
        engine = IFRS15VariableConsiderationEngine()
        return engine.estimate(body)
    except ValueError as e:
        msg = str(e)
        if "Probabilities must sum" in msg or "100%" in msg:
            raise HTTPException(status_code=400, detail="Probabilities must sum to 100%")
        raise HTTPException(status_code=400, detail=msg)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ifrs15/reversal-risk")
async def ifrs15_reversal_risk(request: IFRS15ReversalRiskRequest):
    """Revenue reversal risk score from VC constraint and contract profile."""
    try:
        from ifrs15_calculator import IFRS15ReversalRiskEngine

        engine = IFRS15ReversalRiskEngine()
        return engine.score(request.model_dump())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ifrs15/rpo")
async def ifrs15_rpo(request: IFRS15RPORequest):
    """Remaining performance obligations disclosure (IFRS 15.120–122)."""
    try:
        from ifrs15_calculator import IFRS15RPOEngine

        body = {"obligations": [o.model_dump() for o in request.obligations]}
        return IFRS15RPOEngine().calculate_rpo(body)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ifrs15/contract-costs")
async def ifrs15_contract_costs(request: IFRS15ContractCostsRequest):
    """Costs to obtain a contract / commission asset (IFRS 15.91–94)."""
    try:
        from ifrs15_calculator import IFRS15ContractCostsEngine

        body = {
            "commission_amount": request.commission_amount,
            "contract_term_months": request.contract_term_months,
            "contract_total_value": request.contract_total_value,
        }
        return IFRS15ContractCostsEngine().calculate(body)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ifrs15/principal-agent")
async def ifrs15_principal_agent(request: IFRS15PrincipalAgentRequest):
    """Principal vs agent (gross vs net) assessment (IFRS 15.B34–B38)."""
    try:
        from ifrs15_calculator import IFRS15PrincipalAgentEngine

        return IFRS15PrincipalAgentEngine().assess(request.model_dump())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ifrs15/license-classification")
async def ifrs15_license_classification(request: IFRS15LicenseRequest):
    """Licence of IP: right to access vs right to use (IFRS 15.B52–B63)."""
    try:
        from ifrs15_calculator import IFRS15LicenseEngine

        return IFRS15LicenseEngine().classify(request.model_dump())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ifrs15/master-report")
async def ifrs15_master_report(request: IFRS15MasterReportRequest):
    """Aggregate IFRS 15 core + optional modules into a master compliance report."""
    try:
        from ifrs15_calculator import IFRS15MasterSummaryEngine

        body = request.model_dump()
        rep = IFRS15MasterSummaryEngine().generate(body)

        narrative = ""
        if ANTHROPIC_API_KEY:
            try:
                import anthropic

                ctx = json.dumps(
                    {
                        "contract_overview": rep.get("contract_overview"),
                        "financial_summary": rep.get("financial_summary"),
                        "five_step_status": rep.get("five_step_status"),
                        "assessments": rep.get("assessments"),
                        "risk_flags": rep.get("risk_flags"),
                        "audit_readiness": rep.get("audit_readiness"),
                    },
                    indent=2,
                    default=str,
                )[:12000]
                prompt = (
                    "You are an IFRS 15 technical accounting expert. Write a 3-paragraph executive summary of this "
                    "contract's revenue recognition treatment (max 400 words). Use the actual numbers from the JSON.\n"
                    "Paragraph 1: Contract overview and revenue recognised.\n"
                    "Paragraph 2: Key judgements made and their impact.\n"
                    "Paragraph 3: Outstanding risks and recommended actions.\n"
                    "Write in the style of a Big 4 technical memo. Plain text only, no markdown.\n\n"
                    f"Data:\n{ctx}"
                )
                client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
                response = client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=1500,
                    messages=[{"role": "user", "content": prompt}],
                )
                narrative = (response.content[0].text if response.content else "").strip()
            except Exception:
                narrative = (
                    "AI narrative could not be generated (Claude API error). "
                    "Review the structured sections in this report and draft the executive summary manually."
                )
        else:
            narrative = (
                "AI narrative is not available (ANTHROPIC_API_KEY not configured). "
                "Configure the API key to generate a three-paragraph executive summary automatically."
            )
        rep["ai_narrative"] = narrative
        gc.collect()
        return rep
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ifrs15/master-report/download-excel")
async def ifrs15_master_report_download_excel(request: IFRS15MasterReportExcelRequest):
    """Generate standalone IFRS 15 Master Summary Excel workbook."""
    try:
        from ifrs15_excel_export import IFRS15ExcelExporter

        file_id = str(uuid.uuid4())
        excel_path = OUTPUT_DIR / f"IFRS15_Master_{file_id}.xlsx"
        exporter = IFRS15ExcelExporter()
        exporter.export_ifrs15_master_report(request.master_report, str(excel_path))
        gc.collect()
        return {"status": "success", "file_id": file_id, "filename": excel_path.name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ifrs15/score-disclosure")
async def ifrs15_score_disclosure(request: IFRS15DisclosureScorerRequest):
    """Score IFRS 15 narrative disclosure quality (keywords + optional Claude suggestions)."""
    try:
        from ifrs15_calculator import IFRS15DisclosureScorer

        scorer = IFRS15DisclosureScorer()
        return scorer.score(
            request.disclosure_text,
            request.calculation_results or {},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ifrs15/client-report")
async def ifrs15_client_report(request: IFRS15ClientReportRequest):
    """Generate client-facing IFRS 15 PDF report (10 pages)."""
    try:
        from ifrs15_client_report import generate_client_report

        payload = request.model_dump()
        out = generate_client_report(payload, api_key=ANTHROPIC_API_KEY)
        gc.collect()
        return {
            "status": "success",
            "file_id": out.get("file_id"),
            "filename": out.get("filename"),
            "pages": out.get("pages", 10),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/ifrs15/client-report/{file_id}")
async def ifrs15_client_report_download(file_id: str):
    """Download generated client-facing IFRS 15 PDF report."""
    matching = list(OUTPUT_DIR.glob(f"{file_id}_*.pdf"))
    if not matching:
        raise HTTPException(status_code=404, detail="File not found")
    path = matching[0]
    return FileResponse(
        path=str(path),
        filename=path.name,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{path.name}"'},
    )


@app.post("/api/ifrs15/classify-contract")
async def ifrs15_classify_contract(request: IFRS15ClassifyContractRequest):
    """Classify IT services contract type for IFRS 15 revenue method selection."""
    if not ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Claude API not configured. Set ANTHROPIC_API_KEY environment variable."
        )
    try:
        import anthropic
        import json
        import re

        prompt = (
            "Read this IT services contract and classify it. Return ONLY JSON:\n"
            "{\n"
            "  'contract_type':\n"
            "    'time_and_material' |\n"
            "    'fixed_price' |\n"
            "    'capped_tm' |\n"
            "    'maintenance',\n"
            "  'confidence': 0-100,\n"
            "  'reason': 'one sentence explanation',\n"
            "  'key_indicators': [\n"
            "    'indicator 1',\n"
            "    'indicator 2'\n"
            "  ],\n"
            "  'hourly_rate': number or null,\n"
            "  'tm_cap': number or null,\n"
            "  'estimated_cost': number or null\n"
            "}\n\n"
            f"Contract:\n{request.contract_text}"
        )

        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1200,
            messages=[{"role": "user", "content": prompt}]
        )
        text = response.content[0].text if response.content else ""
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.I)
            cleaned = re.sub(r"\s*```$", "", cleaned)
        parsed = json.loads(cleaned.replace("'", '"'))
        return {"status": "success", "classification": parsed}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Contract classification failed: {str(e)}")


@app.get("/api/ifrs15/download/{file_id}")
async def ifrs15_download(file_id: str):
    """Download IFRS 15 Excel report"""
    matching = list(OUTPUT_DIR.glob(f"*{file_id}*.xlsx"))
    if not matching:
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        path=str(matching[0]),
        filename=matching[0].name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


@app.post("/api/chat", response_model=ChatResponse)
async def chat_with_rag(request: ChatRequest):
    """
    Chat with company's IFRS documents using RAG
    
    Uses Retrieval-Augmented Generation to answer questions about:
    - Lease calculations (IFRS 16)
    - Revenue contracts (IFRS 15)
    - Expected credit loss (IFRS 9)
    - Variances and analyses
    
    CRITICAL: Data is filtered by company_id to ensure isolation
    """
    engine = get_rag_engine()
    if not engine:
        raise HTTPException(
            status_code=503,
            detail="RAG engine not initialized. Check server logs."
        )
    
    try:
        # Ask question with context
        result = engine.ask_with_context(
            company_id=request.company_id,
            question=request.question,
            document_type=request.document_type,
            top_k=request.top_k
        )
        
        if result['status'] == 'error':
            raise HTTPException(
                status_code=500,
                detail=f"RAG query failed: {result.get('error', 'Unknown error')}"
            )
        
        gc.collect()
        return ChatResponse(
            status="success",
            answer=result['answer'],
            sources=result.get('sources', []),
            context_count=result.get('context_count', 0)
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat error: {str(e)}")


@app.post("/api/cfo-insights")
async def cfo_insights(request: CFOInsightsRequest):
    """
    CFO Strategic Insights - AI analysis of lease portfolio
    
    Accepts a prompt (built client-side from lease_repository) and returns structured
    insights: risk flags, cost-saving opportunities, renewal alerts, efficiency recommendations.
    Uses Claude API; requires ANTHROPIC_API_KEY.
    """
    if not ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Claude API not configured. Set ANTHROPIC_API_KEY in .env"
        )
    try:
        import anthropic
        import re
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4000,
            messages=[{"role": "user", "content": request.prompt}],
        )
        raw = "".join(
            b.text for b in response.content if getattr(b, "type", None) == "text"
        )
        clean = re.sub(r"```json|```", "", raw).strip()
        parsed = json.loads(clean)
        gc.collect()
        return {"status": "success", "result": parsed}
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/rag/stats/{company_id}")
async def get_rag_stats(company_id: str):
    """
    Get RAG statistics for a company
    
    Shows:
    - Total documents indexed
    - Document counts by type
    - Total chunks stored
    """
    engine = get_rag_engine()
    if not engine:
        raise HTTPException(
            status_code=503,
            detail="RAG engine not initialized"
        )
    
    try:
        stats = engine.get_company_stats(company_id)
        return {
            "status": "success",
            "stats": stats
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stats error: {str(e)}")


# IFRS 16 Smart Alerts
@app.get("/api/ifrs16/alerts/defaults")
async def get_alert_defaults():
    """Return default email from env for pre-fill"""
    return {"email": os.getenv("ALERT_EMAIL_TO", "")}


@app.post("/api/ifrs16/alerts/configure")
async def configure_alerts(config: dict):
    """Save alert configuration to JSON file"""
    try:
        with open("alert_config.json", "w") as f:
            json.dump(config, f, indent=2)
        return {"status": "saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ifrs16/alerts/send-test")
async def send_test_alert(config: dict):
    """Send a test alert email"""
    import smtplib
    from email.mime.text import MIMEText
    email = config.get("email", "")
    if not email:
        return {"status": "error", "message": "Email required"}
    message = "IFRS AI Test Alert - your alert system is working!"
    try:
        sender = os.getenv("ALERT_EMAIL_FROM", "")
        password = os.getenv("ALERT_EMAIL_PASSWORD", "")
        if sender and password:
            msg = MIMEText(message)
            msg["Subject"] = "IFRS AI Test Alert"
            msg["From"] = sender
            msg["To"] = email
            with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
                s.login(sender, password)
                s.sendmail(sender, email, msg.as_string())
            return {"status": "sent", "email": email}
        return {"status": "logged", "message": "Configure ALERT_EMAIL_FROM and ALERT_EMAIL_PASSWORD in .env"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


class AlertsCheckRequest(BaseModel):
    leases: List[dict] = Field(default_factory=list, description="Lease repository data from frontend")


@app.post("/api/ifrs16/alerts/check")
async def check_alerts(request: AlertsCheckRequest):
    """Check lease expiry and return alerts list"""
    from datetime import datetime, timedelta
    alerts = []
    today = datetime.now().date()
    for lease in request.leases:
        end_str = None
        if isinstance(lease, dict):
            dates = lease.get("dates") or {}
            end_str = dates.get("end")
            asset = lease.get("asset") or lease.get("lease_id") or lease.get("id", "Unknown")
        else:
            continue
        if not end_str:
            continue
        try:
            end_date = datetime.strptime(end_str, "%Y-%m-%d").date()
        except (ValueError, TypeError):
            continue
        diff = (end_date - today).days
        if diff < 0:
            alerts.append({
                "id": str(lease.get("id", "")),
                "type": "expired",
                "severity": "red",
                "title": f"{asset} has expired",
                "message": f"Lease expired {abs(diff)} days ago",
            })
        elif diff <= 7:
            alerts.append({
                "id": str(lease.get("id", "")),
                "type": "expiring_7",
                "severity": "red",
                "title": f"{asset} expires in {diff} days",
                "message": f"Renew or terminate by {end_str}",
            })
        elif diff <= 30:
            alerts.append({
                "id": str(lease.get("id", "")),
                "type": "expiring_30",
                "severity": "amber",
                "title": f"{asset} expires in {diff} days",
                "message": f"Renew or terminate by {end_str}",
            })
        elif diff <= 90:
            alerts.append({
                "id": str(lease.get("id", "")),
                "type": "expiring_90",
                "severity": "amber",
                "title": f"{asset} expires in {diff} days",
                "message": f"Renew or terminate by {end_str}",
            })
    return {"alerts": alerts}


@app.post("/api/ifrs16/suggest-ibr")
async def suggest_ibr(payload: IbrSuggestRequest):
    fallback_by_currency = {
        "INR": {"ibr_low": 7.5, "ibr_mid": 9.0, "ibr_high": 12.0},
        "USD": {"ibr_low": 5.5, "ibr_mid": 7.0, "ibr_high": 9.0},
        "EUR": {"ibr_low": 3.5, "ibr_mid": 5.0, "ibr_high": 7.0},
    }
    fallback = fallback_by_currency.get((payload.currency or "").upper(), {"ibr_low": 6.0, "ibr_mid": 8.5, "ibr_high": 11.0})
    fallback_response = {
        **fallback,
        "rationale": "Fallback estimate based on currency-level market conditions and typical borrowing spreads.",
        "market_references": ["Policy rate", "Commercial lending benchmarks", "Typical credit spread"],
    }
    if not ANTHROPIC_API_KEY:
        return fallback_response

    try:
        import anthropic

        system_prompt = """You are an IFRS 16 expert. Given a lease's country, currency, tenor, asset type,
and lessee type, suggest a realistic Incremental Borrowing Rate (IBR) range.

Respond ONLY with a JSON object. No preamble, no markdown, no explanation outside
the JSON. Format:
{
  "ibr_low": 7.5,
  "ibr_mid": 8.5,
  "ibr_high": 10.0,
  "rationale": "2-3 sentence explanation referencing current market context,
                 RBI/central bank rates, and IFRS 16 para 26 guidance",
  "market_references": ["RBI repo rate", "SBI MCLR", "typical corporate bond spread"]
}"""

        user_prompt = (
            f"Country: {payload.country}, Currency: {payload.currency}, "
            f"Lease term: {payload.lease_term_months} months, "
            f"Asset type: {payload.asset_type or 'N/A'}, Lessee type: {payload.lessee_type}. "
            "Suggest IBR range."
        )

        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        msg = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=800,
            temperature=0,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = msg.content[0].text.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
        data = json.loads(text)
        return {
            "ibr_low": float(data.get("ibr_low")),
            "ibr_mid": float(data.get("ibr_mid")),
            "ibr_high": float(data.get("ibr_high")),
            "rationale": str(data.get("rationale", "")),
            "market_references": data.get("market_references", []) or [],
        }
    except Exception:
        return fallback_response


@app.post("/api/ifrs16/consolidate")
async def consolidate_ifrs16(request: dict):
    """
    Consolidate IFRS 16 across multiple entities.

    Body:
    {
      "group_currency": "USD",
      "entities": [
        {
          "entity_name": "Subsidiary A",
          "entity_currency": "INR",
          "fx_rate_to_group": 0.012,
          "leases": [ ...lease results... ]
        }
      ]
    }
    """
    try:
        from ifrs16_calculator import consolidate_leases

        entities = request.get("entities", [])
        if not entities:
            raise HTTPException(400, "At least one entity required")
        result = consolidate_leases(entities)
        result["group_currency"] = request.get("group_currency", "USD")
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/consolidation/entities")
async def consolidation_entities(parent_id: str = ""):
    from entity_consolidation import get_entities
    return get_entities(parent_id or None)


@app.post("/api/consolidation/entities")
async def consolidation_add_entity(payload: dict):
    from entity_consolidation import save_entity
    if not payload.get("entity_id") or not payload.get("entity_name"):
        raise HTTPException(400, "entity_id and entity_name are required")
    save_entity(
        entity_id=payload["entity_id"],
        entity_name=payload["entity_name"],
        parent_id=payload.get("parent_id"),
        currency=payload.get("currency", "INR"),
        fx_rate=float(payload.get("fx_rate_to_group", 1.0)),
    )
    return {"status": "saved"}


@app.post("/api/consolidation/intercompany")
async def consolidation_add_intercompany(payload: dict):
    from entity_consolidation import save_intercompany
    required = ["lessor_entity", "lessee_entity", "lease_id", "monthly_amount"]
    missing = [k for k in required if k not in payload]
    if missing:
        raise HTTPException(400, f"Missing fields: {', '.join(missing)}")
    save_intercompany(
        lessor=payload["lessor_entity"],
        lessee=payload["lessee_entity"],
        lease_id=payload["lease_id"],
        monthly_amount=float(payload["monthly_amount"]),
    )
    return {"status": "saved"}


@app.post("/api/consolidation/run")
async def consolidation_run(payload: dict):
    from entity_consolidation import consolidate
    entity_ids = payload.get("entity_ids", [])
    if not entity_ids:
        raise HTTPException(400, "At least one entity required")
    return consolidate(entity_ids=entity_ids, group_currency=payload.get("group_currency", "INR"))


# ==================== IFRS 9 ECL Endpoints ====================

# Standard PD by credit rating (IFRS 9 para 5.5.17)
PD_BY_RATING = {
    "AAA": 0.0001, "AA+": 0.0002, "AA": 0.0002, "AA-": 0.0003,
    "A+": 0.0004, "A": 0.0005, "A-": 0.001,
    "BBB+": 0.0015, "BBB": 0.002, "BBB-": 0.003,
    "BB+": 0.005, "BB": 0.01, "BB-": 0.02,
    "B+": 0.03, "B": 0.05, "B-": 0.08,
    "CCC": 0.10, "CC": 0.20, "C": 0.30, "D": 1.0,
}


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
    base_pd: float
    lgd: float
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


@app.get("/api/ifrs9/pd-rates")
async def get_ifrs9_pd_rates():
    """Return standard PD rates by credit rating (AAA to D)."""
    return {"pd_rates": PD_BY_RATING}


@app.post("/api/ifrs9/upload-portfolio")
async def upload_portfolio(file: UploadFile = File(...)):
    """
    Read uploaded Excel/CSV debtor ageing or loan schedule.
    Returns structured data for form auto-fill (counterparty, amounts, ageing buckets).
    """
    allowed = [".xlsx", ".xls", ".csv"]
    ext = Path(file.filename).suffix.lower()
    if ext not in allowed:
        raise HTTPException(status_code=400, detail=f"Allowed: {', '.join(allowed)}")
    try:
        import pandas as pd
        contents = await file.read()
        if ext == ".csv":
            df = pd.read_csv(io.BytesIO(contents), encoding="utf-8", on_bad_lines="skip")
        else:
            df = pd.read_excel(io.BytesIO(contents), sheet_name=0)
        # Normalize column names (strip, lower, replace spaces)
        df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
        # Build ageing-style buckets if we have amount columns
        rows = df.head(100).to_dict(orient="records")
        # Try to infer: outstanding_balance, days_past_due, counterparty, etc.
        extracted = {
            "rows": rows,
            "columns": list(df.columns),
            "row_count": len(df),
        }
        gc.collect()
        return {"status": "success", "filename": file.filename, "extracted_data": extracted}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload error: {str(e)}")


@app.post("/api/ifrs9/calculate")
async def calculate_ecl(data: dict):
    """
    Core ECL calculation engine.
    Input: approach (simplified/general), stage (1/2/3), pd_12m, pd_lifetime, lgd, ead,
           ageing_buckets (for simplified), scenarios (base/optimistic/pessimistic with weights).
    Returns: ecl_12m, ecl_lifetime, applicable_ecl, coverage_ratio, journal_entries, disclosure_notes, scenario_results.
    """
    try:
        def apply_macro_overlay_pd_pct(base_pd_pct: float, macro: dict | None) -> float:
            """Apply macro overlay to PD in percentage points."""
            if not macro:
                return base_pd_pct
            gdp_growth = float((macro or {}).get("gdp_growth", 0) or 0)
            unemployment = float((macro or {}).get("unemployment", 0) or 0)
            interest_rate = float((macro or {}).get("interest_rate", 0) or 0)
            gdp_s = get_sensitivity("gdp_sensitivity")
            unemp_s = get_sensitivity("unemployment_sensitivity")
            rate_s = get_sensitivity("interest_rate_sensitivity")
            gdp_adj = max(0.20, 1 + ((-gdp_growth) * gdp_s))
            unemp_adj = max(0.20, 1 + (unemployment * unemp_s))
            rate_adj = max(0.20, 1 + (interest_rate * rate_s))
            return max(0.0, min(100.0, base_pd_pct * gdp_adj * unemp_adj * rate_adj))

        approach = data.get("approach", "general")
        stage = int(data.get("stage", 1))
        pd_12m = float(data.get("pd_12m", 0.01))
        pd_lifetime = float(data.get("pd_lifetime", 0.05))
        lgd = float(data.get("lgd", 0.45))
        ead = float(data.get("ead", 0))
        discount_rate = float(data.get("discount_rate", 0.08))

        scenarios = data.get("scenarios") or {}
        base_macro = scenarios.get("base_macro") or {}
        optimistic_macro = scenarios.get("optimistic_macro") or {}
        pessimistic_macro = scenarios.get("pessimistic_macro") or {}
        pd_12m_base = apply_macro_overlay_pd_pct(pd_12m, base_macro)
        pd_lifetime_base = apply_macro_overlay_pd_pct(pd_lifetime, base_macro)

        if approach == "simplified" and data.get("ageing_buckets"):
            # Provision matrix: sum(amount * rate) per bucket
            total_ecl = 0
            bucket_results = []
            for b in data["ageing_buckets"]:
                amt = float(b.get("amount", 0) or 0)
                rate = float(b.get("rate", 0) or 0) / 100
                ecl = amt * rate
                total_ecl += ecl
                bucket_results.append({"bucket": b.get("bucket", ""), "amount": amt, "rate_pct": rate * 100, "ecl": ecl})
            applicable_ecl = total_ecl
        else:
            # General: ECL = PD × LGD × EAD (with optional discount)
            dfactor = 1 / (1 + discount_rate)
            ecl_12m = ead * (pd_12m_base / 100) * (lgd / 100) * dfactor
            ecl_lifetime = ead * (pd_lifetime_base / 100) * (lgd / 100) * dfactor
            applicable_ecl = float(ecl_12m if stage == 1 else ecl_lifetime)
            bucket_results = []

        coverage = (applicable_ecl / ead * 100) if ead else 0

        # Scenario-weighted ECL (optional)
        base_w = float(scenarios.get("base_weight", 50)) / 100
        opt_w = float(scenarios.get("optimistic_weight", 30)) / 100
        pess_w = float(scenarios.get("pessimistic_weight", 20)) / 100
        if approach == "general":
            dfactor = 1 / (1 + discount_rate)
            pd_12m_opt = apply_macro_overlay_pd_pct(pd_12m, optimistic_macro)
            pd_12m_pess = apply_macro_overlay_pd_pct(pd_12m, pessimistic_macro)
            pd_lifetime_opt = apply_macro_overlay_pd_pct(pd_lifetime, optimistic_macro)
            pd_lifetime_pess = apply_macro_overlay_pd_pct(pd_lifetime, pessimistic_macro)
            base_ecl_calc = ead * ((pd_12m_base if stage == 1 else pd_lifetime_base) / 100) * (lgd / 100) * dfactor
            opt_ecl_calc = ead * ((pd_12m_opt if stage == 1 else pd_lifetime_opt) / 100) * (lgd / 100) * dfactor
            pess_ecl_calc = ead * ((pd_12m_pess if stage == 1 else pd_lifetime_pess) / 100) * (lgd / 100) * dfactor
            base_ecl = float(scenarios.get("base_ecl", base_ecl_calc))
            opt_ecl = float(scenarios.get("optimistic_ecl", opt_ecl_calc))
            pess_ecl = float(scenarios.get("pessimistic_ecl", pess_ecl_calc))
        else:
            base_ecl = float(scenarios.get("base_ecl", applicable_ecl))
            opt_ecl = float(scenarios.get("optimistic_ecl", applicable_ecl * 0.8))
            pess_ecl = float(scenarios.get("pessimistic_ecl", applicable_ecl * 1.2))
        ecl_weighted = base_ecl * base_w + opt_ecl * opt_w + pess_ecl * pess_w

        journal_entries = [
            {"type": "ECL Recognition", "dr": "Impairment Loss (P&L)", "cr": "Loss Allowance (BS)", "amount": applicable_ecl},
        ]

        disclosure_notes = (
            f"Note: Expected Credit Losses (IFRS 9)\n\n"
            f"The Company applies the {approach} approach. ECL = PD × LGD × EAD.\n"
            f"PD (12M): {pd_12m}% (macro-adjusted: {pd_12m_base:.2f}%) | "
            f"PD (Lifetime): {pd_lifetime}% (macro-adjusted: {pd_lifetime_base:.2f}%) | LGD: {lgd}% | EAD: {ead:,.0f}\n"
            f"Applicable ECL: {applicable_ecl:,.0f} | Coverage: {coverage:.2f}%\n"
            f"Probability-weighted ECL (scenarios): {ecl_weighted:,.0f}"
        )

        return {
            "ecl_12m": ead * (pd_12m_base / 100) * (lgd / 100) if approach == "general" else None,
            "ecl_lifetime": ead * (pd_lifetime_base / 100) * (lgd / 100) if approach == "general" else None,
            "ecl_simplified": applicable_ecl if approach == "simplified" else None,
            "applicable_ecl": applicable_ecl,
            "ecl_weighted": ecl_weighted,
            "coverage_ratio": round(coverage, 2),
            "pd_used": pd_12m_base if stage == 1 else pd_lifetime_base,
            "macro_pd": {
                "base_pd_12m": pd_12m_base,
                "base_pd_lifetime": pd_lifetime_base,
                "optimistic_pd_12m": apply_macro_overlay_pd_pct(pd_12m, optimistic_macro),
                "optimistic_pd_lifetime": apply_macro_overlay_pd_pct(pd_lifetime, optimistic_macro),
                "pessimistic_pd_12m": apply_macro_overlay_pd_pct(pd_12m, pessimistic_macro),
                "pessimistic_pd_lifetime": apply_macro_overlay_pd_pct(pd_lifetime, pessimistic_macro),
            },
            "macro_sensitivity_used": {
                "gdp_sensitivity": get_sensitivity("gdp_sensitivity"),
                "unemployment_sensitivity": get_sensitivity("unemployment_sensitivity"),
                "interest_rate_sensitivity": get_sensitivity("interest_rate_sensitivity"),
                "config_source": "db" if is_db_loaded() else "default",
            },
            "lgd_used": lgd,
            "ead_used": ead,
            "journal_entries": journal_entries,
            "disclosure_notes": disclosure_notes,
            "bucket_results": bucket_results,
            "scenario_results": {
                "base": base_ecl,
                "optimistic": opt_ecl,
                "pessimistic": pess_ecl,
                "weighted": ecl_weighted,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/admin/macro-sensitivity")
async def get_macro_sensitivity(tenant_id: str = "default", portfolio_type: str = "all"):
    row = get_active_config(tenant_id, portfolio_type)
    if row:
        return {
            "source": "database",
            "tenant_id": tenant_id,
            "portfolio_type": portfolio_type,
            "gdp_sensitivity": row[0],
            "unemployment_sensitivity": row[1],
            "interest_rate_sensitivity": row[2],
            "effective_from": row[3],
            "approved_by": row[4],
            "approval_notes": row[5],
            "created_at": row[6],
        }
    return {"source": "defaults", **MACRO_SENSITIVITY_DEFAULTS}


@app.post("/api/admin/macro-sensitivity")
async def update_macro_sensitivity(payload: dict):
    required = ["gdp_sensitivity", "unemployment_sensitivity", "interest_rate_sensitivity"]
    for key in required:
        if key not in payload:
            raise HTTPException(400, f"Missing field: {key}")
    save_config(
        tenant_id=payload.get("tenant_id", "default"),
        portfolio_type=payload.get("portfolio_type", "all"),
        gdp=float(payload["gdp_sensitivity"]),
        unemp=float(payload["unemployment_sensitivity"]),
        rate=float(payload["interest_rate_sensitivity"]),
        approved_by=payload.get("approved_by", ""),
        notes=payload.get("approval_notes", ""),
    )
    update_sensitivity("gdp_sensitivity", float(payload["gdp_sensitivity"]))
    update_sensitivity("unemployment_sensitivity", float(payload["unemployment_sensitivity"]))
    update_sensitivity("interest_rate_sensitivity", float(payload["interest_rate_sensitivity"]))
    return {"status": "updated", "effective": "immediately"}


@app.get("/api/admin/macro-sensitivity/history")
async def macro_sensitivity_history(tenant_id: str = "default", portfolio_type: str = "all"):
    rows = get_config_history(tenant_id, portfolio_type)
    cols = [
        "id",
        "tenant_id",
        "portfolio_type",
        "gdp_sensitivity",
        "unemployment_sensitivity",
        "interest_rate_sensitivity",
        "effective_from",
        "approved_by",
        "approval_notes",
        "is_active",
        "created_at",
    ]
    return [dict(zip(cols, r)) for r in rows]


@app.post("/api/ifrs9/classify")
async def classify_instrument(request: IFRS9ClassificationRequest):
    """IFRS 9 classification & measurement (business model, SPPI, optional EIR)."""
    from ifrs9_ecl_calculator import IFRS9ClassificationEngine

    engine = IFRS9ClassificationEngine()
    return engine.classify(request.model_dump())


@app.post("/api/ifrs9/macro-overlay")
async def ifrs9_macro_overlay(request: IFRS9MacroOverlayRequest):
    """Forward-looking macro scenario overlay for ECL (IFRS 9.5.5.17)."""
    from ifrs9_ecl_calculator import IFRS9MacroOverlayEngine

    try:
        engine = IFRS9MacroOverlayEngine()
        payload = request.model_dump()
        if payload.get("loans") is None:
            payload["loans"] = []
        return engine.calculate(payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/ifrs9/provision-matrix")
async def ifrs9_provision_matrix(request: IFRS9ProvisionMatrixRequest):
    """IFRS 9.5.5.15 simplified provision matrix (ageing buckets × loss rates)."""
    from ifrs9_ecl_calculator import IFRS9ProvisionMatrixEngine

    try:
        engine = IFRS9ProvisionMatrixEngine()
        payload = request.model_dump()
        if payload.get("receivables") is None:
            payload["receivables"] = []
        if payload.get("bucket_totals") is None:
            payload["bucket_totals"] = []
        if payload.get("historical_data") is None:
            payload["historical_data"] = []
        return engine.calculate(payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/ifrs9/master-report")
async def ifrs9_master_report(request: IFRS9MasterReportRequest):
    """Aggregate IFRS 9 ECL, classification, macro overlay, and provision matrix into one master report."""
    from ifrs9_ecl_calculator import IFRS9MasterSummaryEngine

    engine = IFRS9MasterSummaryEngine()
    return engine.generate(request.model_dump())


@app.post("/api/ifrs9/download-report")
async def download_ecl_report(data: dict):
    """Generate Excel ECL report. Returns file_id for frontend download."""
    try:
        import pandas as pd
        file_id = str(uuid.uuid4())
        path = OUTPUT_DIR / f"ecl_report_{file_id}.xlsx"
        with pd.ExcelWriter(path, engine="openpyxl") as w:
            pd.DataFrame([{"ECL Summary": data.get("applicable_ecl", 0), "Coverage %": data.get("coverage_ratio", 0)}]).to_excel(w, sheet_name="ECL Summary", index=False)
            if data.get("bucket_results"):
                pd.DataFrame(data["bucket_results"]).to_excel(w, sheet_name="Provision Matrix", index=False)
            if data.get("journal_entries"):
                pd.DataFrame(data["journal_entries"]).to_excel(w, sheet_name="Journal Entries", index=False)
        gc.collect()
        return {"file_id": file_id, "filename": path.name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ifrs9/download-excel")
async def ifrs9_download_excel(request: IFRS9DownloadExcelRequest):
    """IFRS 9 ECL audit pack (openpyxl); optional first sheet when master_report_data is supplied."""
    try:
        from ifrs9_excel_export import export_ifrs9_excel

        payload = request.model_dump()
        master = payload.pop("master_report_data", None)
        file_id = export_ifrs9_excel(payload, master_report=master)
        safe_name = (request.portfolio_name or "Portfolio").replace(" ", "_").replace("/", "_")
        date_str = (request.reporting_date or datetime.now().strftime("%Y-%m-%d")).replace("-", "")
        filename = f"IFRS9_ECL_{safe_name}_{date_str}_{file_id}.xlsx"
        gc.collect()
        n_sheets = 6 if master else 5
        return {"file_id": file_id, "filename": filename, "sheets": n_sheets}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/ifrs9/download/{file_id}")
async def download_ifrs9_file(file_id: str):
    """Download IFRS 9 Excel (audit pack or legacy ecl_report)."""
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


@app.delete("/api/rag/document/{company_id}/{document_id}")
async def delete_rag_document(company_id: str, document_id: str):
    """
    Delete a document from RAG storage
    
    Args:
        company_id: Company identifier
        document_id: Document identifier to delete
    """
    engine = get_rag_engine()
    if not engine:
        raise HTTPException(
            status_code=503,
            detail="RAG engine not initialized"
        )
    
    try:
        result = engine.delete_document(company_id, document_id)
        if result['status'] == 'error':
            raise HTTPException(status_code=500, detail=result.get('error'))
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delete error: {str(e)}")


# Run application (local dev). Tries PORT/API_PORT then scans for a free port if busy (Windows 10048, etc.).
if __name__ == "__main__":
    import socket
    import uvicorn

    def _pick_bind_port(start: int, span: int = 40) -> int:
        for p in range(start, start + span):
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                try:
                    s.bind(("127.0.0.1", p))
                except OSError:
                    continue
                return p
        raise RuntimeError(f"No free TCP port between {start} and {start + span - 1}")

    base = int(os.environ.get("PORT", os.environ.get("API_PORT", "9000")))
    chosen = _pick_bind_port(base)
    os.environ["_IFRS_BIND_PORT"] = str(chosen)
    os.environ["PUBLIC_API_URL"] = f"http://127.0.0.1:{chosen}"

    port_file = _project_root / "api_dev_port.txt"
    try:
        port_file.write_text(str(chosen), encoding="utf-8")
    except OSError as werr:
        print(f"WARNING: Could not write {port_file.name}: {werr}")

    if chosen != base:
        print(f"WARNING: Port {base} is already in use; using {chosen} instead.")
    print(f"API base: http://127.0.0.1:{chosen}")
    print(f"Wrote {port_file.name} for Next.js proxy (restart npm run dev if the UI was already running).")

    uvicorn.run(app, host="127.0.0.1", port=chosen, reload=False)




