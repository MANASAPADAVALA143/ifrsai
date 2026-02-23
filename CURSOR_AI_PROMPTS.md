# CURSOR AI PROMPTS FOR BUILDING IFRS AUTOMATION PRODUCTS

## Overview
These are step-by-step prompts to use in Cursor AI to build each IFRS product. Copy each prompt into Cursor's chat to generate the code.

---

# PART 1: PROJECT SETUP & INFRASTRUCTURE

## Prompt 1: Initialize IFRS 16 Automation Project

```
Create a new Python project for IFRS 16 Lease Accounting Automation with the following structure:

PROJECT NAME: ifrs16-automation

FOLDER STRUCTURE:
```
ifrs16-automation/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                    # FastAPI app
│   │   ├── config.py                  # Configuration
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   ├── lease.py              # Pydantic models
│   │   │   └── database.py           # SQLAlchemy models
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── claude_extractor.py   # Claude API integration
│   │   │   ├── calculator.py         # IFRS 16 calculations
│   │   │   └── excel_exporter.py     # Excel generation
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   └── routes.py             # API endpoints
│   │   └── utils/
│   │       ├── __init__.py
│   │       └── helpers.py
│   ├── requirements.txt
│   ├── .env.example
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── IFRS16/
│   │   │   │   ├── InputForm.tsx
│   │   │   │   ├── CalculationResults.tsx
│   │   │   │   ├── AmortizationTable.tsx
│   │   │   │   └── JournalEntries.tsx
│   │   ├── pages/
│   │   │   └── IFRS16Dashboard.tsx
│   │   ├── services/
│   │   │   └── api.ts
│   │   └── utils/
│   │       └── formatters.ts
│   ├── package.json
│   └── tsconfig.json
├── database/
│   └── init.sql
└── README.md
```

REQUIREMENTS.TXT should include:
- fastapi==0.109.0
- uvicorn[standard]==0.27.0
- anthropic==0.18.1
- pandas==2.1.4
- numpy==1.26.3
- openpyxl==3.1.2
- python-multipart==0.0.6
- python-dotenv==1.0.0
- sqlalchemy==2.0.25
- psycopg2-binary==2.9.9
- pydantic==2.5.3
- pydantic-settings==2.1.0
- PyPDF2==3.0.1
- python-docx==1.1.0
- pytesseract==0.3.10
- python-dateutil==2.8.2

PACKAGE.JSON dependencies:
- react: ^18.2.0
- typescript: ^5.3.3
- @anthropic-ai/sdk: ^0.18.0
- framer-motion: ^11.0.3
- lucide-react: ^0.263.1
- axios: ^1.6.5

.ENV.EXAMPLE:
```env
ANTHROPIC_API_KEY=your_api_key_here
DATABASE_URL=postgresql://user:password@localhost:5432/ifrs16
ENVIRONMENT=development
SECRET_KEY=your_secret_key
```

Create the full project structure with placeholder files. Include comments in each file explaining what it will contain.
```

---

## Prompt 2: Create Database Schema

```
Create a PostgreSQL database schema for IFRS 16 lease tracking.

TABLES NEEDED:

1. leases
   - id (UUID, primary key)
   - contract_id (VARCHAR, unique)
   - customer_name (VARCHAR)
   - lease_asset_description (TEXT)
   - commencement_date (DATE)
   - end_date (DATE)
   - lease_term_months (INT)
   - monthly_payment (NUMERIC)
   - annual_discount_rate (NUMERIC)
   - initial_direct_costs (NUMERIC)
   - escalation_rate (NUMERIC)
   - lease_liability (NUMERIC)
   - rou_asset (NUMERIC)
   - monthly_depreciation (NUMERIC)
   - status (ENUM: 'active', 'terminated', 'expired')
   - created_at (TIMESTAMP)
   - updated_at (TIMESTAMP)

2. lease_amortization_schedule
   - id (UUID, primary key)
   - lease_id (UUID, foreign key → leases)
   - period (INT)
   - period_date (DATE)
   - opening_balance (NUMERIC)
   - payment (NUMERIC)
   - interest (NUMERIC)
   - principal (NUMERIC)
   - closing_balance (NUMERIC)

3. contract_extractions
   - id (UUID, primary key)
   - lease_id (UUID, foreign key → leases)
   - original_contract_text (TEXT)
   - extracted_data (JSONB)
   - confidence_scores (JSONB)
   - validation_status (ENUM: 'pending', 'approved', 'rejected')
   - extracted_at (TIMESTAMP)
   - reviewed_by (VARCHAR, nullable)
   - reviewed_at (TIMESTAMP, nullable)

4. audit_trail
   - id (UUID, primary key)
   - entity_type (VARCHAR)
   - entity_id (UUID)
   - action (VARCHAR)
   - old_values (JSONB)
   - new_values (JSONB)
   - user_id (VARCHAR)
   - timestamp (TIMESTAMP)

Create database/init.sql with these table definitions. Include indexes on:
- leases.contract_id
- leases.status
- lease_amortization_schedule.lease_id
- audit_trail.entity_id

Also create alembic migration script for versioning.
```

---

# PART 2: BACKEND IMPLEMENTATION

## Prompt 3: Claude API Lease Extractor

```
Create backend/app/services/claude_extractor.py with a class that uses Claude API to extract lease terms from contracts.

REQUIREMENTS:

1. Use Anthropic Python SDK
2. Model: claude-sonnet-4-20250514
3. Extract these fields from lease contracts:
   - Basic info (lease type, asset description, lessee, lessor)
   - Dates (commencement, end date, term in months)
   - Payment terms (monthly amount, frequency, escalation, variable payments)
   - Discount rate (stated rate or hints for IBR)
   - Initial costs (broker fees, legal fees, stamp duty)
   - Options (renewal, purchase, termination)
   - IFRS 16 classification indicators
   - Remeasurement triggers

4. For each extracted field, return:
   - value
   - confidence score (0-100)
   - source_text (exact quote from contract)
   - assumptions (if any)

5. Return structured JSON with validation flags:
   - missing_fields
   - low_confidence_fields
   - requires_human_review
   - overall_confidence

6. Include error handling for:
   - Invalid API key
   - Rate limiting
   - Malformed responses
   - JSON parsing errors

7. Add a validate_extraction() method that checks:
   - Critical fields present (commencement_date, monthly_payment, term)
   - Confidence scores >= 70%
   - Discount rate availability

Use type hints throughout. Add comprehensive docstrings.

The prompt to Claude should instruct it to:
- Be conservative with confidence scores
- Flag ambiguous terms for human review
- Consider IFRS 16 lease classification criteria
- Extract dates in YYYY-MM-DD format
- Extract amounts without currency symbols

Example usage:
```python
extractor = LeaseContractExtractor(api_key="sk-...")
result = extractor.extract_lease_terms(contract_text)
validation = extractor.validate_extraction(result)
```
```

---

## Prompt 4: IFRS 16 Calculator Engine

```
Create backend/app/services/calculator.py with complete IFRS 16 calculation logic.

REQUIREMENTS:

1. Use dataclasses for input/output models:
   - LeaseInput (all lease parameters)
   - IFRS16Results (calculation outputs)

2. Main Calculator class with methods:
   
   a) calculate_lease_liability(lease: LeaseInput) -> Decimal
      - Use PV annuity formula: PV = PMT × [(1 - (1 + r)^-n) / r]
      - Handle zero discount rate edge case
      - Include residual value guarantee if present
      - Return present value rounded to 2 decimals
   
   b) calculate_rou_asset(lease_liability, initial_costs) -> Decimal
      - ROU Asset = Lease Liability + Initial Direct Costs
   
   c) calculate_monthly_depreciation(rou_asset, months) -> Decimal
      - Straight-line: ROU Asset / Lease Term
   
   d) generate_amortization_schedule(lease, lease_liability) -> pd.DataFrame
      - Columns: Period, Date, Month, Opening_Balance, Payment, Interest, Principal, Closing_Balance
      - Use effective interest method for interest
      - Handle payment escalations (annual % increase)
      - Ensure balance reaches zero in final period
   
   e) generate_journal_entries(rou_asset, lease_liability, depreciation, schedule) -> Dict
      - Initial recognition entry
      - Monthly depreciation template
      - Sample monthly payment entry
   
   f) generate_maturity_analysis(schedule) -> Dict
      - Group payments by year (Year 1-5, Thereafter)
      - Return totals for disclosure
   
   g) calculate_full_ifrs16(lease) -> Dict
      - Execute all steps
      - Return comprehensive results with:
        * lease_liability
        * rou_asset
        * monthly_depreciation
        * total_interest
        * amortization_schedule (DataFrame)
        * journal_entries
        * maturity_analysis
        * year_1_impact (P&L)
        * disclosure_data

3. Use Decimal for all monetary calculations (avoid float precision issues)
4. Use pandas for schedule generation
5. Use dateutil.relativedelta for date arithmetic
6. Include validation that allocated amounts match transaction price
7. Add comprehensive error handling

All monetary values should be rounded to 2 decimal places using ROUND_HALF_UP.

Example usage:
```python
lease = LeaseInput(
    lease_id="L001",
    asset_description="Office Space",
    commencement_date=datetime(2024, 1, 1),
    lease_term_months=36,
    monthly_payment=Decimal('50000'),
    annual_discount_rate=Decimal('0.085'),
    initial_direct_costs=Decimal('40000')
)

calc = IFRS16Calculator()
results = calc.calculate_full_ifrs16(lease)
```
```

---

## Prompt 5: Excel Export Module

```
Create backend/app/services/excel_exporter.py that generates professional Excel workbooks.

REQUIREMENTS:

1. Use openpyxl library
2. Create multi-sheet workbook with:
   - Summary sheet (key metrics, lease details)
   - Amortization Schedule sheet (full table)
   - Journal Entries sheet (formatted entries)
   - Disclosure Notes sheet
   - Maturity Analysis sheet

3. Professional styling:
   - Header row: Blue fill (4472C4), white bold text
   - Title font: Bold, size 14
   - Currency formatting: ₹#,##0.00
   - Borders on all cells
   - Auto-sized columns
   - Merged cells for titles

4. Main class: IFRS16ExcelExporter with method:
   export_ifrs16_workbook(results: Dict, filename: str)

5. Helper methods:
   - _create_summary_sheet()
   - _create_amortization_sheet()
   - _create_journal_entries_sheet()
   - _create_disclosure_sheet()
   - _create_maturity_sheet()

6. Features:
   - Convert pandas DataFrames to Excel using dataframe_to_rows()
   - Apply number formatting to amount columns
   - Add formulas for totals where appropriate
   - Include metadata (generation date, system info)

7. Error handling for file write permissions

Example usage:
```python
exporter = IFRS16ExcelExporter()
exporter.export_ifrs16_workbook(
    results=calculation_results,
    filename="IFRS16_Lease_Report_2024.xlsx"
)
```
```

---

## Prompt 6: FastAPI Backend with All Routes

```
Create backend/app/main.py with FastAPI application and all API endpoints.

ENDPOINTS NEEDED:

1. POST /api/v1/lease/extract
   - Upload contract (PDF/Word/Text)
   - Call Claude API for extraction
   - Return extracted terms with confidence scores
   - Request: multipart/form-data (file upload)
   - Response: JSON with extracted_data, validation

2. POST /api/v1/lease/calculate
   - Input: lease parameters
   - Call IFRS16Calculator
   - Return calculation results
   - Request: JSON (lease details)
   - Response: JSON (liability, ROU asset, schedule)

3. POST /api/v1/lease/export-excel
   - Input: calculation results
   - Generate Excel workbook
   - Return file download
   - Response: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet

4. GET /api/v1/lease/{lease_id}
   - Fetch lease from database
   - Return full lease details

5. POST /api/v1/lease/save
   - Save lease to database
   - Return saved lease with ID

6. GET /api/v1/lease/list
   - List all leases with pagination
   - Query params: page, page_size, status
   - Response: paginated lease list

REQUIREMENTS:
- Use Pydantic models for request/response validation
- Add CORS middleware
- Add request logging
- Add error handling with proper HTTP status codes
- Add API documentation (OpenAPI/Swagger)
- Use dependency injection for database sessions
- Add rate limiting (10 requests/minute for extraction)

Include comprehensive error responses:
```json
{
  "error": "string",
  "detail": "string",
  "status_code": 400
}
```

Example startup:
```python
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
```
```

---

# PART 3: FRONTEND IMPLEMENTATION

## Prompt 7: React Frontend - IFRS 16 Input Form Component

```
Create frontend/src/components/IFRS16/InputForm.tsx with a form matching the design from the documentation.

DESIGN SPECS:
- Glassmorphism style with gradient backgrounds (amber-500 to orange-500)
- Card-based layout with rounded-xl corners
- 5 tabs: Input, Calculation, Journal Entries, Payment Schedule, Financial Impact
- Tab styling:
  * Active: Amber-to-orange gradient, white text
  * Inactive: White background, amber border
  * Hover: Scale 1.05x

INPUT FORM SECTIONS:

1. Lease Details Card
   - Background: gradient (white/90 to amber-50/50)
   - Border: 2px amber-200
   - Icon: Calculator (amber-600)
   - Fields:
     * Lease Asset (text input)
     * Commencement Date (date picker)
     * Lease Term (number input, months)
     * Monthly Payment (number input, ₹)
     * Incremental Borrowing Rate (number, % as decimal)
     * Initial Direct Costs (number, ₹)

2. Calculate Button
   - Position: Right-aligned
   - Style: Amber-to-orange gradient
   - Size: px-8 py-3
   - Icon: Calculator
   - Text: "Calculate IFRS 16"
   - Hover: Scale 1.05, click: 0.95

FEATURES:
- Real-time validation (highlight errors in red)
- Loading state during API call
- Error messages in red alert box
- Success toast on calculation
- All inputs use Framer Motion for animations

API INTEGRATION:
- Call POST /api/v1/lease/calculate on submit
- Display loading spinner
- Handle errors gracefully
- Update state with results

Use TypeScript with proper types. Use Tailwind CSS for styling.

Example state:
```typescript
interface LeaseInput {
  lease_asset: string;
  commencement_date: string;
  lease_term_months: number;
  monthly_payment: number;
  annual_discount_rate: number;
  initial_direct_costs: number;
}
```
```

---

## Prompt 8: React Frontend - Calculation Results Display

```
Create frontend/src/components/IFRS16/CalculationResults.tsx to display IFRS 16 results.

LAYOUT (Calculation Tab):

1. Four Metric Cards (2x2 grid):
   
   a) Lease Liability (blue)
      - Background: blue-50 to blue-100 gradient
      - Border: 2px blue-200
      - Icon: DollarSign (blue-600)
      - Label: "Lease Liability"
      - Amount: Large, bold, blue-700
      - Subtitle: "Present Value of lease payments"
   
   b) Right-of-Use Asset (green)
      - Background: green-50 to green-100
      - Icon: TrendingUp (green-600)
      - Amount: green-700
   
   c) Monthly Depreciation (purple)
      - Background: purple-50 to purple-100
      - Icon: Calendar (purple-600)
   
   d) Total Interest Expense (orange)
      - Background: orange-50 to orange-100
      - Icon: DollarSign (orange-600)

2. Responsive: 1 column on mobile, 2 columns on desktop (md breakpoint)

FEATURES:
- Smooth fade-in animation when data loads
- Number formatting: ₹#,##0.00
- Tooltip on hover explaining each metric
- Copy to clipboard button on each card

TypeScript props:
```typescript
interface CalculationResultsProps {
  lease_liability: number;
  rou_asset: number;
  monthly_depreciation: number;
  total_interest: number;
}
```

Use Framer Motion for entry animations. Use lucide-react for icons.
```

---

## Prompt 9: React Frontend - Amortization Table Component

```
Create frontend/src/components/IFRS16/AmortizationTable.tsx for Payment Schedule tab.

DESIGN:
- Table with gradient header (amber-500 to orange-500, white text)
- Columns:
  * Period (left-aligned)
  * Payment (right, ₹)
  * Interest (right, orange-600, medium font)
  * Principal (right, blue-600, medium font)
  * Balance (right, gray-800, semibold)

- Rows:
  * Border-bottom: amber-100
  * Hover: amber-50/50 background
  * Smooth transitions

- Pagination: Show first 12 months, with note if more
- Export to Excel button (right-aligned above table)

FEATURES:
- Sortable columns
- Search/filter by period
- Responsive: horizontal scroll on mobile
- Loading skeleton while data fetches
- Empty state message if no data
- Download Excel button calls API endpoint

TypeScript:
```typescript
interface AmortizationRow {
  period: number;
  date: string;
  month: string;
  opening_balance: number;
  payment: number;
  interest: number;
  principal: number;
  closing_balance: number;
}

interface AmortizationTableProps {
  schedule: AmortizationRow[];
  lease_id: string;
}
```

Use react-table or custom table implementation with Tailwind.
```

---

# PART 4: IFRS 15 PROMPTS

## Prompt 10: IFRS 15 Contract Extractor with Claude

```
Create backend/app/services/ifrs15_extractor.py using Claude API to extract IFRS 15 revenue recognition terms.

EXTRACT the IFRS 15 5-step model elements:

STEP 1: Identify the Contract
- Contract approval validation
- Parties identified
- Rights and obligations clear
- Payment terms commercial substance
- Collectability probable

STEP 2: Identify Performance Obligations
- List all distinct goods/services
- Determine if each is distinct (IFRS 15.27-30 criteria)
- Identify bundled vs separate obligations
- For each obligation:
  * obligation_id
  * description
  * is_distinct (boolean)
  * reasoning
  * standalone_selling_price_estimate
  * ssp_source (observable / market / residual / estimate)

STEP 3: Determine Transaction Price
- Fixed consideration
- Variable consideration:
  * Discounts
  * Rebates
  * Performance bonuses
  * Penalties
  * Estimation method (expected_value / most_likely_amount)
  * Constraint applied (boolean)
- Significant financing component:
  * present (boolean)
  * interest_rate
  * adjustment_amount
- Total transaction price

STEP 4: Allocation Hints
- Allocation method (relative_standalone_selling_price / residual)
- Observable prices available
- Discount allocation approach

STEP 5: Recognize Revenue
- For each performance obligation:
  * recognition_pattern (over_time / point_in_time)
  * If over_time: which IFRS 15.35 criterion?
  * Progress measurement method
  * Transfer date (if point_in_time)
  * Duration (if over_time)

ALSO DETECT:
- Contract modifications
- Non-cash consideration
- Consideration payable to customer

Return structured JSON with confidence scores. Flag items requiring professional judgment.

Use the same structure as lease_extractor.py but adapt for IFRS 15 logic.
```

---

## Prompt 11: IFRS 15 Calculator - 5-Step Model

```
Create backend/app/services/ifrs15_calculator.py implementing the full IFRS 15 5-step model.

DATACLASSES:

1. PerformanceObligation
   - obligation_id: str
   - description: str
   - standalone_selling_price: Decimal
   - recognition_method: str  # "over_time" or "point_in_time"
   - duration_months: int (for over_time)
   - transfer_date: datetime (for point_in_time)

2. IFRS15Input
   - contract_id: str
   - customer_name: str
   - effective_date: datetime
   - contract_term_months: int
   - fixed_consideration: Decimal
   - variable_consideration: Decimal
   - discounts: Decimal
   - rebates: Decimal
   - financing_adjustment: Decimal
   - performance_obligations: List[PerformanceObligation]

CALCULATOR METHODS:

1. calculate_transaction_price(contract) -> Decimal
   Transaction Price = Fixed + Variable - Discounts - Rebates + Financing

2. allocate_transaction_price(transaction_price, obligations) -> Dict
   Use relative standalone selling price method:
   - For each obligation: allocated = (SSP / Total SSP) × Transaction Price
   - Handle rounding by adjusting last obligation
   - Return dict: {obligation_id: allocated_amount}

3. generate_recognition_schedule(contract, allocations) -> DataFrame
   For each month in contract term:
   - For over_time obligations: monthly_revenue = allocated / duration_months
   - For point_in_time: full revenue on transfer_date
   - Columns: Period, Date, Month, Obligation, Method, Revenue, Cumulative

4. calculate_contract_balances(allocations, schedule) -> Dict
   - Total allocated (transaction price)
   - Revenue recognized to date
   - Contract balance (difference)
   - Is contract asset or liability

5. generate_disclosure_data(contract, allocations, schedule) -> Dict
   - Contract details
   - Transaction price components
   - Revenue by obligation (allocated, recognized, remaining)
   - Remaining performance obligations total

6. calculate_full_ifrs15(contract) -> Dict
   Execute all 5 steps and return comprehensive results.

Use Decimal throughout. Include validation that sum(allocations) == transaction_price.
```

---

# PART 5: IFRS 9 ECL PROMPTS

## Prompt 12: IFRS 9 Staging Engine

```
Create backend/app/services/ifrs9_staging.py for loan staging classification.

IMPLEMENT:

1. Enum class LoanStage:
   - STAGE_1 = "Stage 1"  # 12-month ECL
   - STAGE_2 = "Stage 2"  # Lifetime ECL (SICR)
   - STAGE_3 = "Stage 3"  # Lifetime ECL (credit-impaired)

2. Class IFRS9StagingEngine:
   
   THRESHOLDS (configurable):
   - dpd_stage_2_threshold = 30 days
   - dpd_stage_3_threshold = 90 days
   - pd_increase_threshold = 2.0 (PD doubled)
   - rating_downgrade_threshold = 3 notches

   METHODS:
   
   a) classify_loan(loan: Dict) -> LoanStage
      Input loan dict contains:
      - days_past_due
      - current_pd
      - origination_pd
      - current_rating
      - origination_rating
      - is_forbearance
      - is_default
      - is_bankruptcy
      - is_watchlist
      
      Logic:
      - If Stage 3 criteria met → STAGE_3
      - Else if Stage 2 (SICR) criteria → STAGE_2
      - Else → STAGE_1
   
   b) _is_stage_3(loan) -> bool
      Criteria:
      - DPD >= 90 days OR
      - is_default = True OR
      - is_bankruptcy = True
   
   c) _is_stage_2(loan) -> bool
      SICR criteria (any one triggers):
      - DPD 30-89 days
      - PD doubled since origination
      - Rating downgrade >= 3 notches
      - Forbearance/restructuring
      - Watchlist status
   
   d) _calculate_rating_change(orig_rating, current_rating) -> int
      Rating scale: AAA=1, AA+=2, ..., D=18
      Return notches of downgrade
   
   e) classify_portfolio(portfolio_df: DataFrame) -> DataFrame
      Apply classify_loan() to entire portfolio
      Add 'stage' column

3. Include comprehensive docstrings explaining IFRS 9 staging logic.

Example:
```python
staging_engine = IFRS9StagingEngine()
portfolio['stage'] = portfolio.apply(
    lambda row: staging_engine.classify_loan(row.to_dict()).value,
    axis=1
)
```
```

---

## Prompt 13: IFRS 9 ECL Calculator with ML Models

```
Create backend/app/services/ifrs9_ecl_calculator.py with ML-based PD/LGD/EAD models.

REQUIREMENTS:

1. PD Model (Probability of Default):
   - Use XGBoost classifier
   - Features:
     * days_past_due
     * debt_to_income_ratio
     * credit_utilization
     * payment_history_12m
     * employment_status
     * loan_to_value_ratio
     * account_age_months
   - Output: PD for next 12 months (Stage 1) or lifetime (Stage 2/3)
   - Train on historical default data

2. LGD Model (Loss Given Default):
   - Use gradient boosting regressor
   - Features:
     * collateral_value
     * collateral_type
     * seniority
     * recovery_costs_pct
     * macroeconomic_conditions
   - Output: LGD as % of EAD (0-100%)
   - Consider downturn LGD scenarios

3. EAD Model (Exposure at Default):
   - For term loans: outstanding_balance + accrued_interest
   - For revolving: current_balance + (commitment_limit - current_balance) × CCF
   - CCF (Credit Conversion Factor) by product type

4. ECL Calculation:
   
   Stage 1: ECL = PD_12m × LGD × EAD
   Stage 2: ECL = PD_lifetime × LGD × EAD
   Stage 3: ECL = (100% - recovery_rate) × EAD
   
   Macroeconomic scenarios:
   - Base case (weight: 50%)
   - Optimistic (weight: 25%)
   - Pessimistic (weight: 25%)
   - ECL_final = Σ (ECL_scenario × weight)

5. Class IFRS9ECLCalculator:
   
   a) __init__(pd_model_path, lgd_model_path)
      Load pre-trained models
   
   b) predict_pd(loan_features, stage) -> float
      Return PD (12-month or lifetime)
   
   c) predict_lgd(loan_features) -> float
      Return LGD percentage
   
   d) calculate_ead(loan) -> Decimal
      Calculate exposure at default
   
   e) calculate_ecl(loan, stage) -> Decimal
      ECL = PD × LGD × EAD
   
   f) calculate_portfolio_ecl(portfolio_df) -> Dict
      For each loan:
      - Get stage (from staging engine)
      - Calculate PD, LGD, EAD
      - Calculate ECL
      Return summary by stage and total provisions

6. Add SHAP explainability:
   - For each loan, generate SHAP values
   - Store top 5 contributing features
   - Use for audit documentation

Example:
```python
ecl_calc = IFRS9ECLCalculator(
    pd_model_path="models/pd_model.pkl",
    lgd_model_path="models/lgd_model.pkl"
)

results = ecl_calc.calculate_portfolio_ecl(loan_portfolio)
print(f"Total ECL Provision: ${results['total_ecl']:,.2f}")
print(f"Stage 1: ${results['stage_1_ecl']:,.2f}")
print(f"Stage 2: ${results['stage_2_ecl']:,.2f}")
print(f"Stage 3: ${results['stage_3_ecl']:,.2f}")
```
```

---

# PART 6: DEPLOYMENT & GTM

## Prompt 14: Docker Configuration

```
Create Dockerfile for the IFRS automation backend.

REQUIREMENTS:
- Base image: python:3.11-slim
- Install system dependencies:
  * postgresql-client
  * tesseract-ocr (for OCR)
  * poppler-utils (for PDF processing)
- Copy requirements.txt and install Python packages
- Copy application code to /app
- Expose port 8000
- Use non-root user for security
- Health check endpoint: /health
- Environment variables from .env

Also create docker-compose.yml with:
- Backend service (FastAPI)
- PostgreSQL database
- Redis (for caching)
- Nginx (reverse proxy)

Include volume mounts for:
- Database persistence
- Upload storage
- Logs
```

---

## Prompt 15: n8n Workflow Automation

```
Create n8n workflow JSON for IFRS 16 lease processing automation.

WORKFLOW:
1. Trigger: Email received with lease contract attachment
2. Extract attachment (PDF/Word)
3. Call IFRS 16 API /api/v1/lease/extract
4. If confidence < 80%:
   - Send email to finance team for review
   - Wait for approval
5. Once approved:
   - Call /api/v1/lease/calculate
   - Generate Excel report
   - Store in Google Drive
6. Send notification email with:
   - Summary of lease
   - Key metrics (liability, ROU asset)
   - Link to Excel report
7. Create task in Asana for monthly reconciliation
8. Log to audit trail

Also create workflow for:
- Monthly remeasurement checks
- Quarterly disclosure generation
- Lease expiry alerts (60 days before)

Export as n8n JSON workflow file.
```

---

## Prompt 16: Go-to-Market Strategy Document

```
Create a comprehensive go-to-market strategy document for IFRS automation products.

STRUCTURE:

1. EXECUTIVE SUMMARY
   - Product suite overview
   - Target market size
   - Revenue projections

2. MARKET ANALYSIS
   Target Segments:
   - IFRS 16: 15,000+ companies in India with leases
   - IFRS 15: 25,000+ SaaS/telecom/construction companies
   - IFRS 9: 500+ banks/NBFCs
   
   Pain Points:
   - 80 hours/quarter on manual IFRS 16 calculations
   - 50 hours/month on IFRS 15 revenue recognition
   - 60 hours/month on IFRS 9 ECL calculations
   - High error rates (15-20%)
   - Compliance risks
   - Audit costs

3. PRICING STRATEGY
   
   IFRS 16 Lease Automation:
   - Starter: ₹99,000/year (up to 50 leases)
   - Professional: ₹2,99,000/year (up to 200 leases)
   - Enterprise: ₹7,99,000/year (unlimited)
   
   IFRS 15 Revenue Recognition:
   - Starter: ₹1,49,000/year (up to 100 contracts)
   - Professional: ₹3,99,000/year (up to 500 contracts)
   - Enterprise: ₹9,99,000/year (unlimited)
   
   IFRS 9 ECL (Banks/NBFCs):
   - Professional: ₹12,99,000/year
   - Enterprise: Custom pricing (for large banks)

4. SALES CHANNELS
   - Direct sales (CFOs, Finance Directors)
   - Partner network (Big 4 accounting firms)
   - Online SaaS marketplace
   - Industry conferences

5. MARKETING STRATEGY
   - LinkedIn thought leadership
   - CFO roundtables
   - Webinars on IFRS compliance
   - Case studies
   - Free ROI calculator

6. COMPETITIVE POSITIONING
   - vs Manual Excel: 95% time savings
   - vs SAP/Oracle: 90% cost savings, faster deployment
   - vs Other IFRS tools: AI-powered, better accuracy

7. CUSTOMER ACQUISITION PLAN
   Month 1-3: Beta testing with 5 companies
   Month 4-6: Launch with 20 paying customers
   Month 7-12: Scale to 100 customers
   Year 2: 500 customers, $5M ARR

8. SUCCESS METRICS
   - Customer acquisition cost (CAC)
   - Lifetime value (LTV)
   - Churn rate
   - Net revenue retention
   - Customer satisfaction (NPS)

Include financial projections, team hiring plan, and risk mitigation strategies.
```

---

# FINAL ASSEMBLY PROMPT

## Prompt 17: Complete Integration & Testing

```
Create a comprehensive integration script that:

1. Tests the full flow for IFRS 16:
   - Upload sample lease contract
   - Extract terms with Claude
   - Calculate IFRS 16 metrics
   - Generate Excel report
   - Save to database
   - Verify calculations match expected values

2. Tests IFRS 15:
   - Upload sample SaaS contract
   - Extract performance obligations
   - Allocate transaction price
   - Generate revenue schedule
   - Export disclosure notes

3. Tests IFRS 9:
   - Load sample loan portfolio
   - Classify into stages
   - Calculate PD/LGD/EAD
   - Compute ECL provisions
   - Generate movement analysis

4. Integration tests:
   - API endpoints (all routes)
   - Database operations (CRUD)
   - File uploads/downloads
   - Error handling
   - Authentication

5. Performance tests:
   - Lease portfolio of 1,000 items
   - Response time < 5 seconds
   - Memory usage monitoring

6. Create pytest test suite with:
   - Unit tests for each calculator
   - Integration tests for API
   - Mock Claude API responses
   - Database fixtures
   - Coverage report (aim for 80%+)

Also create:
- README.md with setup instructions
- API documentation (OpenAPI spec)
- User guide with screenshots
- Deployment guide
- Troubleshooting guide
```

---

# USAGE INSTRUCTIONS

## How to Use These Prompts in Cursor:

1. **Start with Prompt 1** - Initialize project structure
2. **Follow the sequence** - Each prompt builds on previous ones
3. **Copy prompt exactly** - Paste into Cursor chat
4. **Review generated code** - Claude will create the files
5. **Test each component** - Before moving to next prompt
6. **Customize as needed** - Adjust for your specific requirements

## Tips for Best Results:

- Use Cursor's "Composer" mode for multi-file changes
- Reference the design docs when building frontend
- Test API endpoints as you build them
- Use environment variables for API keys
- Follow the folder structure exactly
- Add error handling at each step

## Sample Conversation Flow in Cursor:

```
You: [Paste Prompt 1]
Cursor: [Creates project structure]

You: Great! Now [Paste Prompt 3]
Cursor: [Creates Claude extractor]

You: Perfect! Can you also add rate limiting to prevent API abuse?
Cursor: [Adds rate limiting code]

You: Now [Paste Prompt 4]
Cursor: [Creates calculator]

... continue through all prompts
```

---

# COMPLETE!

These prompts will build all three IFRS automation products end-to-end. Each prompt is designed to be copy-pasted into Cursor for immediate code generation.

Estimated timeline:
- IFRS 16: 2-3 days (Prompts 1-9)
- IFRS 15: 2 days (Prompts 10-11 + frontend)
- IFRS 9: 3 days (Prompts 12-13 + ML models)
- Integration & Testing: 2 days (Prompt 17)
- **Total: 9-10 days for complete system**

Good luck building your IFRS automation products! 🚀
