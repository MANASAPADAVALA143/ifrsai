"""
IFRS 16 Lease Accounting Automation - FastAPI Application
Enterprise REST API for IFRS 16 calculations and reporting
"""

from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
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
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Heavy imports (pandas, numpy, anthropic, openpyxl) moved into route handlers
# to reduce startup memory; RAG import deferred in lifespan

# Configuration
UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("outputs")
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# Initialize services
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
# Public API URL for links (Render sets RENDER_EXTERNAL_URL automatically)
PUBLIC_API_URL = os.getenv("RENDER_EXTERNAL_URL") or os.getenv("PUBLIC_API_URL", "http://127.0.0.1:9000")

# Global RAG engine instance
rag_engine = None

def _init_rag_in_background():
    """Initialize RAG in background thread (ChromaDB + SentenceTransformer can hang ~30s+)."""
    global rag_engine
    import traceback
    try:
        from rag_engine import IFRSRagEngine
        rag_engine = IFRSRagEngine(anthropic_api_key=ANTHROPIC_API_KEY)
        print("✅ RAG engine initialized successfully")
        gc.collect()
    except Exception as e:
        print(f"⚠️  RAG engine failed: {e}")
        traceback.print_exc()
        rag_engine = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan: startup then yield (shutdown runs after yield)."""
    global rag_engine
    import threading
    print("="*70)
    print("IFRS AI AUTOMATION API - SERVER STARTED")
    print("="*70)
    print(f"API Documentation: {PUBLIC_API_URL.rstrip('/')}/api/docs")
    print(f"ReDoc: {PUBLIC_API_URL.rstrip('/')}/api/redoc")
    print(f"Health Check: {PUBLIC_API_URL.rstrip('/')}/health")
    print(f"Claude API: {'Configured' if ANTHROPIC_API_KEY else 'Not configured'}")
    print("Initializing RAG in background (ChromaDB + SentenceTransformer)...")
    print("="*70)
    t = threading.Thread(target=_init_rag_in_background, daemon=True)
    t.start()
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

@app.get("/health")
def health():
    """Simple health check for Render/load balancers"""
    return {"status": "ok"}


# CORS middleware (explicit origins required when allow_credentials=True; wildcard "*" fails)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3003",
        "http://localhost:3004",
        "http://localhost:3000",
        "http://127.0.0.1:3003",
        "http://127.0.0.1:3004",
        "http://localhost:9000",
        "http://127.0.0.1:9000",
        "http://127.0.0.1:3000",
        "https://ifrs-ai.vercel.app",
        "https://ifrsai.vercel.app",
        "https://ifrs-ai-frontend.onrender.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

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
    annual_discount_rate: float = Field(..., ge=0, le=1, description="Annual discount rate (e.g., 0.085 for 8.5%)")
    initial_direct_costs: float = Field(default=0, ge=0, description="Initial direct costs")
    escalation_rate: float = Field(default=0, ge=0, description="Annual escalation rate (e.g., 0.05 for 5%)")
    currency: str = Field(default="INR", description="Currency code")
    
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
    discounts: float = 0
    rebates: float = 0
    financing_adjustment: float = 0
    currency: str = "USD"
    cash_received: float = 0
    performance_obligations: List[PerformanceObligationRequest]


# Helper Functions
def convert_lease_request_to_input(request: LeaseRequest):
    """Convert API request to LeaseInput dataclass"""
    from ifrs16_calculator import LeaseInput
    return LeaseInput(
        lease_id=request.lease_id,
        asset_description=request.asset_description,
        lessee_name=request.lessee_name,
        lessor_name=request.lessor_name,
        commencement_date=datetime.strptime(request.commencement_date, "%Y-%m-%d"),
        lease_term_months=request.lease_term_months,
        monthly_payment=Decimal(str(request.monthly_payment)),
        annual_discount_rate=Decimal(str(request.annual_discount_rate)),
        initial_direct_costs=Decimal(str(request.initial_direct_costs)),
        escalation_rate=Decimal(str(request.escalation_rate)),
        currency=request.currency
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
        
        # Auto-trigger RAG embedding if company_id provided and RAG engine available
        if request.company_id and rag_engine:
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
                rag_result = rag_engine.embed_and_store(
                    company_id=request.company_id,
                    document_type="lease",
                    content=embed_content,
                    document_id=request.lease_id
                )
                print(f"✅ RAG embedding completed: {rag_result.get('status')}")
                
            except Exception as rag_error:
                print(f"⚠️  RAG embedding failed (non-critical): {rag_error}")
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
            "docs": f"{PUBLIC_API_URL.rstrip('/')}/api/docs",
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
    print(f"📥 Upload received: {file.filename} ({file.content_type})")
    
    if not ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Claude API not configured. Set ANTHROPIC_API_KEY environment variable."
        )
    
    # Validate file type
    allowed_extensions = ['.pdf', '.docx', '.txt', '.xlsx', '.xls']
    file_ext = Path(file.filename).suffix.lower()
    
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {', '.join(allowed_extensions)}"
        )
    
    try:
        # Save uploaded file
        file_id = str(uuid.uuid4())
        upload_path = UPLOAD_DIR / f"{file_id}_{file.filename}"
        
        with open(upload_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Extract from file
        from ifrs16_extractor import IFRS16LeaseExtractor
        extractor = IFRS16LeaseExtractor(api_key=ANTHROPIC_API_KEY)
        extracted_data = extractor.extract_from_file(str(upload_path))
        
        # Validate extraction
        validation = extractor.validate_extraction(extracted_data)
        
        # Save extraction
        extraction_file = OUTPUT_DIR / f"extraction_{file_id}.json"
        extractor.save_extraction(extracted_data, str(extraction_file))
        
        print(f"✅ Extraction complete: {file.filename}")
        gc.collect()
        return {
            "status": "success",
            "file_id": file_id,
            "filename": file.filename,
            "extracted_data": extracted_data,
            "validation": validation
        }
        
    except Exception as e:
        print(f"❌ Upload error: {e}")
        raise HTTPException(status_code=500, detail=f"Upload error: {str(e)}")


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


# ==================== IFRS 15 Endpoints ====================

class IFRS15ExtractRequest(BaseModel):
    contract_text: str = Field(..., description="Contract text to extract")


@app.post("/api/ifrs15/extract")
async def ifrs15_extract(request: IFRS15ExtractRequest):
    """Extract IFRS 15 terms from pasted contract text"""
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="Claude API not configured.")
    try:
        from ifrs15_extractor import IFRS15ContractExtractor
        extractor = IFRS15ContractExtractor(api_key=ANTHROPIC_API_KEY)
        extracted_data = extractor.extract_contract_terms(request.contract_text)
        validation = extractor.validate_ifrs15_extraction(extracted_data)
        gc.collect()
        return {"status": "success", "extracted_data": extracted_data, "validation": validation}
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
        from ifrs15_extractor import IFRS15ContractExtractor
        extractor = IFRS15ContractExtractor(api_key=ANTHROPIC_API_KEY)
        extracted_data = extractor.extract_from_file(str(upload_path))
        validation = extractor.validate_ifrs15_extraction(extracted_data)
        extraction_file = OUTPUT_DIR / f"ifrs15_extraction_{file_id}.json"
        extractor.save_extraction(extracted_data, str(extraction_file))
        gc.collect()
        return {
            "status": "success",
            "file_id": file_id,
            "filename": file.filename,
            "extracted_data": extracted_data,
            "validation": validation
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
            discounts=Decimal(str(request.discounts)),
            rebates=Decimal(str(request.rebates)),
            financing_adjustment=Decimal(str(request.financing_adjustment)),
            currency=request.currency,
            performance_obligations=obligations
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
            import pandas as pd
            df = pd.DataFrame(results_json.get('recognition_schedule', []))
            df.to_excel(str(excel_path), index=False, sheet_name='Revenue Schedule')
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
    if not rag_engine:
        raise HTTPException(
            status_code=503,
            detail="RAG engine not initialized. Check server logs."
        )
    
    try:
        # Ask question with context
        result = rag_engine.ask_with_context(
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


@app.get("/api/rag/stats/{company_id}")
async def get_rag_stats(company_id: str):
    """
    Get RAG statistics for a company
    
    Shows:
    - Total documents indexed
    - Document counts by type
    - Total chunks stored
    """
    if not rag_engine:
        raise HTTPException(
            status_code=503,
            detail="RAG engine not initialized"
        )
    
    try:
        stats = rag_engine.get_company_stats(company_id)
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
        approach = data.get("approach", "general")
        stage = int(data.get("stage", 1))
        pd_12m = float(data.get("pd_12m", 0.01))
        pd_lifetime = float(data.get("pd_lifetime", 0.05))
        lgd = float(data.get("lgd", 0.45))
        ead = float(data.get("ead", 0))
        discount_rate = float(data.get("discount_rate", 0.08))

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
            ecl_12m = ead * (pd_12m / 100) * (lgd / 100) * dfactor
            ecl_lifetime = ead * (pd_lifetime / 100) * (lgd / 100) * dfactor
            applicable_ecl = float(ecl_12m if stage == 1 else ecl_lifetime)
            bucket_results = []

        coverage = (applicable_ecl / ead * 100) if ead else 0

        # Scenario-weighted ECL (optional)
        scenarios = data.get("scenarios") or {}
        base_w = float(scenarios.get("base_weight", 50)) / 100
        opt_w = float(scenarios.get("optimistic_weight", 30)) / 100
        pess_w = float(scenarios.get("pessimistic_weight", 20)) / 100
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
            f"PD (12M): {pd_12m}% | PD (Lifetime): {pd_lifetime}% | LGD: {lgd}% | EAD: {ead:,.0f}\n"
            f"Applicable ECL: {applicable_ecl:,.0f} | Coverage: {coverage:.2f}%\n"
            f"Probability-weighted ECL (scenarios): {ecl_weighted:,.0f}"
        )

        return {
            "ecl_12m": ead * (pd_12m / 100) * (lgd / 100) if approach == "general" else None,
            "ecl_lifetime": ead * (pd_lifetime / 100) * (lgd / 100) if approach == "general" else None,
            "ecl_simplified": applicable_ecl if approach == "simplified" else None,
            "applicable_ecl": applicable_ecl,
            "ecl_weighted": ecl_weighted,
            "coverage_ratio": round(coverage, 2),
            "pd_used": pd_12m if stage == 1 else pd_lifetime,
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


@app.post("/api/ifrs9/classify")
async def classify_instrument(data: dict):
    """Run SPPI test and business model. Return classification: AC / FVOCI / FVTPL."""
    sppi_pass = data.get("sppi_pass", True)
    business_model = data.get("business_model", "hold_to_collect")  # hold_to_collect | hold_collect_sell | trading
    if not sppi_pass:
        return {"classification": "FVTPL", "ecl_applicable": False, "reason": "SPPI test failed"}
    if business_model == "trading":
        return {"classification": "FVTPL", "ecl_applicable": False, "reason": "Trading model"}
    if business_model == "hold_collect_sell":
        return {"classification": "FVOCI", "ecl_applicable": True, "reason": "Hold to collect and sell"}
    return {"classification": "AC", "ecl_applicable": True, "reason": "Amortised Cost - ECL applicable"}


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


@app.get("/api/ifrs9/download/{file_id}")
async def download_ifrs9_file(file_id: str):
    """Download generated IFRS 9 Excel report."""
    matching = list(OUTPUT_DIR.glob(f"ecl_report_{file_id}*.xlsx"))
    if not matching:
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path=str(matching[0]), filename=matching[0].name, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.delete("/api/rag/document/{company_id}/{document_id}")
async def delete_rag_document(company_id: str, document_id: str):
    """
    Delete a document from RAG storage
    
    Args:
        company_id: Company identifier
        document_id: Document identifier to delete
    """
    if not rag_engine:
        raise HTTPException(
            status_code=503,
            detail="RAG engine not initialized"
        )
    
    try:
        result = rag_engine.delete_document(company_id, document_id)
        if result['status'] == 'error':
            raise HTTPException(status_code=500, detail=result.get('error'))
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delete error: {str(e)}")


# Run application
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=9000,
        reload=False
    )




