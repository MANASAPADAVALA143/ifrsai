"""
IFRS 16 Lease Accounting Automation - FastAPI Application
Enterprise REST API for IFRS 16 calculations and reporting
"""

from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from decimal import Decimal
import os
import json
import uuid
from pathlib import Path
import shutil

from ifrs16_extractor import IFRS16LeaseExtractor
from ifrs16_calculator import IFRS16Calculator, LeaseInput
from ifrs16_excel_export import IFRS16ExcelExporter
from rag_engine import IFRSRagEngine

# Configuration
UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("outputs")
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# Initialize FastAPI
app = FastAPI(
    title="IFRS 16 Lease Accounting Automation API",
    description="AI-powered IFRS 16 lease accounting automation using Claude API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize services
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

# Global RAG engine instance
rag_engine = None

@app.on_event("startup")
async def startup_event():
    """Startup event handler"""
    global rag_engine
    
    print("="*70)
    print("IFRS AI AUTOMATION API - SERVER STARTED")
    print("="*70)
    print(f"API Documentation: http://127.0.0.1:8000/api/docs")
    print(f"ReDoc: http://127.0.0.1:8000/api/redoc")
    print(f"Health Check: http://127.0.0.1:8000/api/health")
    print(f"Claude API: {'Configured' if ANTHROPIC_API_KEY else 'Not configured'}")
    
    # Initialize RAG engine
    try:
        print("Initializing RAG engine...")
        rag_engine = IFRSRagEngine(anthropic_api_key=ANTHROPIC_API_KEY)
        print("✅ RAG engine initialized successfully")
    except Exception as e:
        print(f"⚠️  Warning: RAG engine initialization failed: {e}")
        print("RAG features will be disabled")
    
    print("="*70)

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
    sources: List[Dict[str, Any]]
    context_count: int


# Helper Functions
def convert_lease_request_to_input(request: LeaseRequest) -> LeaseInput:
    """Convert API request to LeaseInput dataclass"""
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
        extractor = IFRS16LeaseExtractor(api_key=ANTHROPIC_API_KEY)
        
        # Extract lease terms
        extracted_data = extractor.extract_lease_terms(request.contract_text)
        
        # Validate extraction
        validation = extractor.validate_extraction(extracted_data)
        
        # Save extraction
        extraction_id = str(uuid.uuid4())
        extraction_file = OUTPUT_DIR / f"extraction_{extraction_id}.json"
        extractor.save_extraction(extracted_data, str(extraction_file))
        
        return ExtractionResponse(
            status="success",
            extraction_id=extraction_id,
            extracted_data=extracted_data,
            validation=validation
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Extraction error: {str(e)}")


@app.post("/api/upload-contract")
async def upload_contract(file: UploadFile = File(...)):
    """
    Upload lease contract file (PDF, DOCX, TXT) and extract terms
    
    Supports:
    - PDF files (with OCR if needed)
    - Word documents (.docx)
    - Text files (.txt)
    """
    if not ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Claude API not configured. Set ANTHROPIC_API_KEY environment variable."
        )
    
    # Validate file type
    allowed_extensions = ['.pdf', '.docx', '.txt']
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
        extractor = IFRS16LeaseExtractor(api_key=ANTHROPIC_API_KEY)
        extracted_data = extractor.extract_from_file(str(upload_path))
        
        # Validate extraction
        validation = extractor.validate_extraction(extracted_data)
        
        # Save extraction
        extraction_file = OUTPUT_DIR / f"extraction_{file_id}.json"
        extractor.save_extraction(extracted_data, str(extraction_file))
        
        return {
            "status": "success",
            "file_id": file_id,
            "filename": file.filename,
            "extracted_data": extracted_data,
            "validation": validation
        }
        
    except Exception as e:
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
    
    return {
        "status": "completed",
        "total_leases": len(leases),
        "successful": sum(1 for r in results if r["status"] == "success"),
        "failed": sum(1 for r in results if r["status"] == "error"),
        "results": results
    }


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
        port=8000,
        reload=False
    )
