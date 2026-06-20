"""
IFRS 15 Revenue Recognition Contract Extractor
AI-powered extraction of revenue recognition terms using Claude API
"""

import anthropic
import json
import re
from typing import Any, Dict, List, Optional
from datetime import datetime
from decimal import Decimal
import os
from pathlib import Path

from claude_model_config import CLAUDE_MODEL


def _field_confidence_schema(description: str) -> str:
    return f"""{{
      "value": {description},
      "confidence": 0-100,
      "source_text": "exact quote from contract",
      "assumptions": "explanation or empty string"
    }}"""


UAE_SPA_JSON_SCHEMA = """
{
  "contract_identification": {
    "spa_reference": FIELD,
    "oqood_number": FIELD,
    "rera_registration": FIELD,
    "contract_date": FIELD
  },
  "property": {
    "project_name": FIELD,
    "unit_number": FIELD,
    "unit_type": FIELD,
    "floor_area_sqft": FIELD,
    "floor_number": FIELD
  },
  "parties": {
    "developer_name": FIELD,
    "buyer_name": FIELD,
    "buyer_eid": FIELD
  },
  "financial": {
    "contract_value_aed": FIELD,
    "booking_amount_aed": FIELD,
    "handover_payment_aed": FIELD,
    "vat_amount_aed": FIELD,
    "payment_plan": {
      "value": [
        {
          "label": "milestone description",
          "amount_aed": number,
          "pct": number or null,
          "due_date": "YYYY-MM-DD or null",
          "trigger": "booking|months|completion_pct|handover|other"
        }
      ],
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }
  },
  "construction_timeline": {
    "construction_start_date": FIELD,
    "expected_completion_date": FIELD,
    "expected_handover_date": FIELD,
    "current_completion_pct": FIELD
  },
  "ifrs15_specific": {
    "performance_obligation": FIELD,
    "revenue_recognition_method": FIELD,
    "variable_consideration": FIELD,
    "cancellation_terms": FIELD,
    "penalty_clauses": FIELD,
    "modification_clauses": FIELD
  },
  "validation": {
    "missing_fields": { "value": [], "confidence": 100, "source_text": "N/A", "assumptions": "N/A" },
    "low_confidence_fields": { "value": [], "confidence": 100, "source_text": "N/A", "assumptions": "N/A" },
    "overall_confidence": { "value": 0-100, "confidence": 100, "source_text": "N/A", "assumptions": "N/A" }
  }
}
""".replace(
    "FIELD",
    '{ "value": <type>, "confidence": 0-100, "source_text": "quote", "assumptions": "explanation" }',
)


class IFRS15ContractExtractor:
    """Extract IFRS 15 revenue terms using Claude API"""
    
    def __init__(self, api_key: str):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = CLAUDE_MODEL

    @staticmethod
    def _parse_json_response(json_text: str) -> Dict:
        """Parse Claude JSON output with light repair for truncated or fenced responses."""
        attempts = [json_text.strip()]
        stripped = attempts[0]
        if stripped.startswith("```json"):
            stripped = stripped[7:].lstrip()
        elif stripped.startswith("```"):
            stripped = stripped.split("\n", 1)[-1]
        if stripped.endswith("```"):
            stripped = stripped[:-3].rstrip()
        attempts[0] = stripped.strip()
        if "{" in stripped and "}" in stripped:
            attempts.append(stripped[stripped.find("{") : stripped.rfind("}") + 1])

        last_error: json.JSONDecodeError | None = None
        for candidate in attempts:
            if not candidate:
                continue
            try:
                data = json.loads(candidate)
                if isinstance(data, dict):
                    return data
            except json.JSONDecodeError as je:
                last_error = je

        msg = last_error.msg if last_error else "invalid JSON"
        raise ValueError(f"AI returned invalid JSON (try again or use a clearer contract): {msg}") from last_error

    @staticmethod
    def _normalize_contract_text(text: str) -> str:
        """Normalize Arabic-Indic numerals and collapse whitespace."""
        normalized = text.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
        return re.sub(r"\s+", " ", normalized).strip()

    @staticmethod
    def _has_arabic_script(text: str) -> bool:
        return bool(re.search(r"[\u0600-\u06FF]", text))

    @staticmethod
    def _unwrap_field(obj: Any) -> Any:
        if isinstance(obj, dict) and "value" in obj:
            return obj.get("value")
        return obj

    @staticmethod
    def _field_confidence(obj: Any) -> Optional[int]:
        if isinstance(obj, dict) and "confidence" in obj:
            try:
                return int(obj["confidence"])
            except (TypeError, ValueError):
                return None
        return None

    def compute_uae_spa_confidence_summary(self, data: Dict) -> Dict[str, Any]:
        """Aggregate per-field confidence into overall score and low-confidence list."""
        scores: List[int] = []
        low: List[str] = []
        paths = [
            ("contract_identification.spa_reference", data.get("contract_identification", {}).get("spa_reference")),
            ("contract_identification.oqood_number", data.get("contract_identification", {}).get("oqood_number")),
            ("contract_identification.rera_registration", data.get("contract_identification", {}).get("rera_registration")),
            ("contract_identification.contract_date", data.get("contract_identification", {}).get("contract_date")),
            ("property.project_name", data.get("property", {}).get("project_name")),
            ("property.unit_number", data.get("property", {}).get("unit_number")),
            ("parties.buyer_name", data.get("parties", {}).get("buyer_name")),
            ("parties.developer_name", data.get("parties", {}).get("developer_name")),
            ("financial.contract_value_aed", data.get("financial", {}).get("contract_value_aed")),
            ("financial.payment_plan", data.get("financial", {}).get("payment_plan")),
            ("construction_timeline.expected_handover_date", data.get("construction_timeline", {}).get("expected_handover_date")),
            ("ifrs15_specific.performance_obligation", data.get("ifrs15_specific", {}).get("performance_obligation")),
        ]
        for path, field in paths:
            conf = self._field_confidence(field)
            val = self._unwrap_field(field)
            if val is None or val == "" or val == []:
                continue
            if conf is not None:
                scores.append(conf)
                if conf < 70:
                    low.append(path.split(".")[-1])
        overall = round(sum(scores) / len(scores)) if scores else 0
        validation = data.setdefault("validation", {})
        validation["low_confidence_fields"] = {
            "value": low,
            "confidence": 100,
            "source_text": "N/A",
            "assumptions": "Auto-computed from field confidence scores",
        }
        validation["overall_confidence"] = {
            "value": overall,
            "confidence": 100,
            "source_text": "N/A",
            "assumptions": f"Average of {len(scores)} extracted fields",
        }
        return {"overall_confidence": overall, "low_confidence_fields": low, "fields_scored": len(scores)}

    def extract_uae_spa_terms(self, contract_text: str) -> Dict:
        """
        Extract UAE Sale & Purchase Agreement fields with per-field confidence
        (IFRS 16-style structure for IFRS 15 real estate contracts).
        """
        text = self._normalize_contract_text(contract_text or "")
        if not text:
            raise ValueError("Contract text is empty")

        max_chars = 120_000
        if len(text) > max_chars:
            text = text[:max_chars] + "\n\n[... contract text truncated for extraction ...]"

        arabic_note = ""
        if self._has_arabic_script(text):
            arabic_note = """
NOTE: Bilingual or Arabic UAE SPA detected. Extract from English section when present;
otherwise use Arabic. Convert Arabic-Indic numerals (٠١٢٣) to Western digits in JSON values.
Map: عقد البيع والشراء=SPA, سعر العقد=contract value, اسم المشتري=buyer, اسم المطور=developer,
رقم الوحدة=unit, رقم تسجيل ريرا=RERA, خطة الدفع=payment plan, تاريخ التسليم=handover.
"""

        prompt = f"""You are an IFRS 15 revenue recognition expert specialising in UAE off-plan real estate SPAs.

Extract all fields from this Sale & Purchase Agreement for IFRS 15 revenue recognition.
{arabic_note}

SPA / CONTRACT TEXT:
{text}

Return ONLY valid JSON matching this structure (every leaf field uses value/confidence/source_text/assumptions):

{UAE_SPA_JSON_SCHEMA}

CRITICAL UAE SPA RULES:
1. spa_reference: SPA contract number / agreement reference on cover page.
2. oqood_number: DLD Oqood registration (e.g. DLD-2024-OQ-48291). Also check "Oqood", "DLD registration".
3. rera_registration: RERA project registration (e.g. RERA-DT2-2024-001). Required for Dubai off-plan.
4. contract_value_aed: total sale price EXCLUDING VAT unless contract states VAT-inclusive total — note in assumptions.
5. payment_plan: extract EVERY instalment with amount_aed; use trigger "completion_pct" for "on X% completion" milestones.
6. booking_amount_aed: initial deposit / booking fee (often 10%).
7. handover_payment_aed: final payment due on handover / completion.
8. vat_amount_aed: UAE VAT at 5% if stated separately.
9. cancellation_terms: cite UAE Law 8/2007 refund rules if mentioned.
10. revenue_recognition_method: "over_time" for off-plan construction, "point_in_time" for completed units.
11. performance_obligation: e.g. "Delivery of apartment unit at handover".
12. Do NOT guess — use null value with low confidence if not found.
13. Dates must be YYYY-MM-DD.
14. currency amounts as numbers without commas or AED symbol.

Begin extraction:"""

        message = self.client.messages.create(
            model=self.model,
            max_tokens=8192,
            temperature=0,
            messages=[{"role": "user", "content": prompt}],
        )
        response_text = message.content[0].text
        data = self._parse_json_response(response_text.strip())
        summary = self.compute_uae_spa_confidence_summary(data)
        data["extraction_metadata"] = {
            "timestamp": datetime.now().isoformat(),
            "model": self.model,
            "tokens_used": message.usage.input_tokens + message.usage.output_tokens,
            "extractor_version": "uae_spa_v1",
            "language": "bilingual" if self._has_arabic_script(contract_text) else "english",
            **summary,
        }
        return data

    def validate_uae_spa_extraction(self, data: Dict) -> Dict:
        """Validate UAE SPA extraction completeness for IFRS 15 real estate."""
        errors: List[str] = []
        warnings: List[str] = []

        ci = data.get("contract_identification") or {}
        fin = data.get("financial") or {}
        prop = data.get("property") or {}
        parties = data.get("parties") or {}
        tl = data.get("construction_timeline") or {}

        if not self._unwrap_field(parties.get("buyer_name")):
            errors.append("Missing buyer name")
        if not self._unwrap_field(fin.get("contract_value_aed")):
            errors.append("Missing contract value (AED)")
        if not self._unwrap_field(ci.get("rera_registration")):
            warnings.append("RERA registration not found — required for Dubai off-plan")
        if not self._unwrap_field(prop.get("unit_number")):
            warnings.append("Unit number not found")
        plan = self._unwrap_field(fin.get("payment_plan"))
        if not plan or not isinstance(plan, list) or len(plan) == 0:
            warnings.append("Payment plan not extracted — manual entry required")

        summary = data.get("extraction_metadata") or {}
        overall = summary.get("overall_confidence") or self._unwrap_field(
            (data.get("validation") or {}).get("overall_confidence")
        )
        if overall is not None and int(overall) < 50:
            warnings.append(f"Low overall extraction confidence ({overall}%)")

        return {
            "is_valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings,
            "requires_review": len(errors) > 0 or len(warnings) > 0,
            "error_count": len(errors),
            "warning_count": len(warnings),
            "overall_confidence": overall,
        }
    
    def extract_contract_terms(self, contract_text: str) -> Dict:
        """
        Extract IFRS 15 5-step model elements from contract
        
        Returns structured data for:
        - Step 1: Contract identification
        - Step 2: Performance obligations
        - Step 3: Transaction price
        - Step 4: Allocation (SSP hints)
        - Step 5: Recognition timing
        
        Args:
            contract_text: Full text of customer contract
            
        Returns:
            Dictionary with structured IFRS 15 data
        """
        max_chars = 50_000
        text = (contract_text or "").strip()
        if len(text) > max_chars:
            text = text[:max_chars] + "\n\n[... contract text truncated for extraction ...]"
        
        prompt = f"""You are an IFRS 15 revenue recognition expert. Analyze this contract and extract all relevant revenue accounting information.

CONTRACT:
{text}

Extract the following in JSON format. For each element, provide confidence scores and source text.

OUTPUT STRUCTURE:

{{
  "step1_identify_contract": {{
    "contract_approval": {{
      "parties_identified": true/false,
      "rights_identified": true/false,
      "payment_terms_clear": true/false,
      "commercial_substance": true/false,
      "collectability_probable": true/false,
      "confidence": 0-100
    }},
    "contract_details": {{
      "contract_id": "string",
      "customer_name": "string",
      "vendor_name": "string",
      "effective_date": "YYYY-MM-DD",
      "contract_term_months": number,
      "total_contract_value": number,
      "currency": "INR/USD/etc"
    }}
  }},
  
  "step2_performance_obligations": {{
    "identified_obligations": [
      {{
        "obligation_id": "PO-1",
        "description": "detailed description of good/service",
        "is_distinct": true/false,
        "distinct_reasoning": "explanation",
        "standalone_selling_price_estimate": number or null,
        "ssp_source": "observable price / adjusted market / residual / estimate",
        "bundled_with": ["PO-2", "PO-3"] or null,
        "confidence": 0-100
      }}
    ],
    "total_obligations_count": number
  }},
  
  "step3_transaction_price": {{
    "fixed_consideration": number,
    "variable_consideration": {{
      "discounts": number or 0,
      "rebates": number or 0,
      "performance_bonuses": number or 0,
      "penalties": number or 0,
      "volume_discounts": number or 0,
      "estimation_method": "expected_value" or "most_likely_amount",
      "constraint_applied": true/false,
      "constraint_reasoning": "string"
    }},
    "significant_financing_component": {{
      "present": true/false,
      "interest_rate": number or null,
      "payment_terms_exceed_one_year": true/false,
      "adjustment_amount": number or 0
    }},
    "non_cash_consideration": number or 0,
    "consideration_payable_to_customer": number or 0,
    "total_transaction_price": number
  }},
  
  "step4_allocation_hints": {{
    "allocation_method": "relative_standalone_selling_price" or "residual",
    "ssp_available": true/false,
    "observable_prices": [
      {{
        "obligation_id": "PO-1",
        "observable_price": number,
        "source": "price list / market data / historical"
      }}
    ],
    "discount_allocation": "proportionate" or "specific_obligation"
  }},
  
  "step5_recognition": {{
    "obligations_recognition_timing": [
      {{
        "obligation_id": "PO-1",
        "recognition_pattern": "over_time" or "point_in_time",
        "over_time_criteria": {{
          "customer_receives_benefit_as_performed": true/false,
          "customer_controls_as_created": true/false,
          "no_alternative_use_and_right_to_payment": true/false
        }},
        "progress_measurement": "percentage_of_completion" or "milestone" or "output_units" or "input_costs" or "time_elapsed",
        "transfer_date": "YYYY-MM-DD" or null,
        "duration_months": number or null,
        "confidence": 0-100
      }}
    ]
  }},
  
  "contract_modifications": {{
    "modifications_present": true/false,
    "modification_details": [
      {{
        "modification_date": "YYYY-MM-DD",
        "description": "string",
        "price_change": number,
        "scope_change": "string",
        "accounting_treatment": "separate_contract" or "termination_new" or "cumulative_catch_up" or "prospective"
      }}
    ] or []
  }},
  
  "validation": {{
    "missing_critical_fields": [],
    "ambiguous_obligations": [],
    "requires_professional_judgment": [],
    "low_confidence_items": [],
    "overall_confidence": 0-100
  }}
}}

CRITICAL RULES:
1. Return ONLY valid JSON
2. Identify ALL distinct performance obligations (don't bundle if separately distinct)
3. Consider IFRS 15 criteria for "distinct" goods/services
4. Flag variable consideration and constraint application
5. Note if significant financing component exists (payment > 1 year from delivery)
6. For over-time recognition, identify which IFRS 15.35 criterion applies
7. Be conservative with confidence scores
8. Flag anything requiring human judgment

Begin extraction:"""

        message = self.client.messages.create(
            model=self.model,
            max_tokens=8192,
            temperature=0,
            messages=[{"role": "user", "content": prompt}]
        )
        
        response_text = message.content[0].text
        
        # Parse JSON
        json_text = response_text.strip()
        if json_text.startswith("```json"):
            json_text = json_text[7:]
        if json_text.startswith("```"):
            json_text = json_text.split("\n", 1)[-1]
        if json_text.endswith("```"):
            json_text = json_text[:-3]
        
        data = self._parse_json_response(json_text.strip())
        
        # Add metadata
        data['extraction_metadata'] = {
            'timestamp': datetime.now().isoformat(),
            'model': self.model,
            'tokens_used': message.usage.input_tokens + message.usage.output_tokens
        }
        
        return data
    
    def validate_ifrs15_extraction(self, data: Dict) -> Dict:
        """
        Validate IFRS 15 extraction completeness
        
        Args:
            data: Extracted contract data
            
        Returns:
            Validation results
        """
        
        errors = []
        warnings = []
        
        # Check Step 1: Contract identification
        if not data.get('step1_identify_contract', {}).get('contract_details', {}).get('customer_name'):
            errors.append("Missing customer name")
        
        # Check Step 2: Performance obligations
        obligations = data.get('step2_performance_obligations', {}).get('identified_obligations', [])
        if not obligations:
            errors.append("No performance obligations identified")
        
        for ob in obligations:
            if not ob.get('standalone_selling_price_estimate'):
                warnings.append(f"No SSP for {ob.get('obligation_id', 'unknown')}")
        
        # Check Step 3: Transaction price
        total_price = data.get('step3_transaction_price', {}).get('total_transaction_price')
        if not total_price or total_price <= 0:
            errors.append("Invalid total transaction price")
        
        # Check Step 5: Recognition
        recognition = data.get('step5_recognition', {}).get('obligations_recognition_timing', [])
        if len(recognition) != len(obligations):
            warnings.append("Mismatch between obligations and recognition patterns")
        
        return {
            'is_valid': len(errors) == 0,
            'errors': errors,
            'warnings': warnings,
            'requires_review': len(errors) > 0 or len(warnings) > 0,
            'error_count': len(errors),
            'warning_count': len(warnings)
        }
    
    def extract_from_file(self, file_path: str, contract_type: str = "generic") -> Dict:
        """
        Extract IFRS 15 terms from a file
        
        Args:
            file_path: Path to contract file (PDF, DOCX, TXT)
            contract_type: "generic" for standard IFRS 15 5-step, "uae_spa" for UAE SPA
            
        Returns:
            Extracted contract data
        """
        contract_text = read_contract_file_to_text(file_path)
        if (contract_type or "").strip().lower() in ("uae_spa", "spa", "realestate"):
            return self.extract_uae_spa_terms(contract_text)
        return self.extract_contract_terms(contract_text)
    
    def save_extraction(self, data: Dict, output_path: str):
        """Save extracted data to JSON file"""
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        print(f"Extraction saved to: {output_path}")


# Example usage
if __name__ == "__main__":
    sample_contract = """
    SOFTWARE LICENSE AND SERVICES AGREEMENT
    
    Date: January 1, 2024
    Customer: ABC Corporation
    Vendor: TechSoft Solutions Ltd.
    
    1. SCOPE OF SERVICES
    This agreement includes:
    a) Enterprise Software License for 100 users
    b) Implementation and customization services
    c) 12 months of technical support and maintenance
    d) Training for customer staff (5 days)
    
    2. PRICING
    Software License (perpetual): $500,000
    Implementation Services: $150,000
    Annual Support (Year 1 included): $75,000
    Training Services: $25,000
    
    Total Contract Value: $750,000
    
    3. PAYMENT TERMS
    - Software License: $250,000 on signing, $250,000 after 90 days
    - Implementation: Invoiced monthly based on milestones
    - Support: Included in Year 1, $75,000/year thereafter
    - Training: Due upon completion
    
    4. DELIVERY SCHEDULE
    - Software license grant: Upon contract signing
    - Implementation: 6-month timeline, completion by June 30, 2024
    - Training: July 2024 (post-implementation)
    - Support: Commences on license grant date
    
    5. PERFORMANCE GUARANTEES
    - 99.5% uptime guarantee for SaaS components
    - If implementation exceeds 6 months, 10% penalty on implementation fees
    - Customer satisfaction bonus: Up to $20,000 if NPS > 80
    
    6. RENEWAL AND TERMINATION
    - Annual support auto-renews unless terminated 60 days prior
    - Customer may terminate for convenience with 30-day notice after implementation
    """
    
    api_key = os.getenv('ANTHROPIC_API_KEY')
    
    if not api_key:
        print("WARNING: ANTHROPIC_API_KEY not set")
        print("To run this example, set your API key in environment")
        exit(1)
    
    try:
        extractor = IFRS15ContractExtractor(api_key=api_key)
        
        print("="*70)
        print("IFRS 15 REVENUE CONTRACT EXTRACTION")
        print("="*70)
        print("\nExtracting contract terms...")
        
        data = extractor.extract_contract_terms(sample_contract)
        
        print("\nEXTRACTION RESULTS")
        print("="*70)
        print(json.dumps(data, indent=2))
        
        print("\nVALIDATION")
        print("="*70)
        validation = extractor.validate_ifrs15_extraction(data)
        print(json.dumps(validation, indent=2))
        
        if validation['is_valid']:
            print("\nExtraction successful!")
        else:
            print(f"\nExtraction has {validation['error_count']} errors")
        
    except Exception as e:
        print(f"\nError: {e}")


def read_contract_file_to_text(file_path: str) -> str:
    """
    Read raw contract text from supported file types (same extensions as extract_from_file).
    Used for clause detection without altering extraction behaviour.
    """
    file_path_obj = Path(file_path)
    if not file_path_obj.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    if file_path_obj.suffix.lower() == ".txt":
        with open(file_path_obj, "r", encoding="utf-8") as f:
            return f.read()

    if file_path_obj.suffix.lower() == ".pdf":
        try:
            from PyPDF2 import PdfReader

            reader = PdfReader(str(file_path_obj))
            parts: List[str] = []
            for page in reader.pages:
                parts.append(page.extract_text() or "")
            return "\n".join(parts)
        except ImportError:
            raise ImportError("PyPDF2 not installed. Run: pip install PyPDF2")

    if file_path_obj.suffix.lower() in [".docx", ".doc"]:
        try:
            from docx import Document

            doc = Document(str(file_path_obj))
            return "\n".join([para.text for para in doc.paragraphs])
        except ImportError:
            raise ImportError("python-docx not installed. Run: pip install python-docx")

    if file_path_obj.suffix.lower() in [".xlsx", ".xls"]:
        try:
            import pandas as pd

            excel_file = pd.ExcelFile(str(file_path_obj))
            contract_text = ""
            for sheet_name in excel_file.sheet_names:
                contract_text += f"\n=== Sheet: {sheet_name} ===\n"
                df = pd.read_excel(excel_file, sheet_name=sheet_name)
                contract_text += " | ".join(str(col) for col in df.columns) + "\n"
                contract_text += "-" * 80 + "\n"
                max_rows = 200
                for i, (_, row) in enumerate(df.iterrows()):
                    if i >= max_rows:
                        remaining = len(df) - max_rows
                        if remaining > 0:
                            contract_text += f"... ({remaining} more rows omitted)\n"
                        break
                    row_text = " | ".join(str(val) if pd.notna(val) else "" for val in row.values)
                    contract_text += row_text + "\n"
                contract_text += "\n"
            return contract_text
        except ImportError:
            raise ImportError("pandas and openpyxl not installed. Run: pip install pandas openpyxl")

    raise ValueError(f"Unsupported file type: {file_path_obj.suffix}")


def _enforce_overall_risk(clauses: List[Dict[str, Any]]) -> str:
    if not clauses:
        return "CLEAN"
    sev = [str((c or {}).get("severity", "")).upper() for c in clauses]
    if any(s == "HIGH" for s in sev):
        return "HIGH"
    if any(s == "MEDIUM" for s in sev):
        return "MEDIUM"
    if any(s == "LOW" for s in sev):
        return "LOW"
    return "CLEAN"


def detect_nonstandard_clauses(contract_text: str, api_key: Optional[str] = None) -> Dict[str, Any]:
    """
    AI scan for IFRS 15–relevant non-standard clauses. Returns counts and overall_risk.
    """
    key = (api_key or os.getenv("ANTHROPIC_API_KEY") or "").strip()
    if not key:
        return {
            "clauses": [],
            "clauses_found": 0,
            "high_severity": 0,
            "medium_severity": 0,
            "low_severity": 0,
            "overall_risk": "CLEAN",
            "summary": "Clause detection unavailable: ANTHROPIC_API_KEY not configured.",
        }

    client = anthropic.Anthropic(api_key=key)

    system_prompt = """
You are an IFRS 15 technical accounting expert.
Read the contract text and identify every clause
that could affect revenue recognition under IFRS 15.

Return ONLY valid JSON in exactly this structure.
No preamble. No markdown. No explanation.
Just the JSON object.

{
  "clauses": [
    {
      "clause_type": "FREE_PERIOD",
      "severity": "HIGH",
      "exact_quote": "max 50 words from contract",
      "ifrs15_impact": "what this means for revenue",
      "recommended_treatment": "how to account for it",
      "paragraph_reference": "IFRS 15.XX"
    }
  ],
  "overall_risk": "HIGH",
  "summary": "one sentence summary"
}

Clause types to detect:
FREE_PERIOD — free months, trial periods,
  promotional pricing
REFUND_RIGHT — money-back, satisfaction clauses,
  refund on cancellation
PRICE_CAP — maximum price escalation limits,
  rate locks
PRICE_ESCALATION — CPI-linked, annual increases
IMPLICIT_PROMISE — support, upgrades, updates
  mentioned but not separately priced
CUSTOMER_OPTION — rights to purchase additional
  goods at discounted or free price
VARIABLE_USAGE — usage-based billing,
  pay-per-use components
PENALTY_CLAUSE — liquidated damages, SLA penalties
  that reduce consideration
EXTENDED_PAYMENT — payment terms beyond 12 months
  (significant financing component test)
LICENCE_RESTRICTION — territory limits, user caps
  affecting distinct PO assessment
PRINCIPAL_AGENT_INDICATOR — third-party involvement,
  reseller or distribution arrangements
CANCELLATION_RIGHT — customer cancellation rights,
  notice periods, exit clauses

Severity rules:
HIGH — directly changes the amount or timing
  of revenue that would otherwise be recognised
MEDIUM — requires judgment but likely manageable
LOW — minor consideration, document and monitor

overall_risk:
  Any HIGH clause → "HIGH"
  Any MEDIUM, no HIGH → "MEDIUM"
  Only LOW or none → "LOW"
  No clauses found → "CLEAN"

If no non-standard clauses found:
  return {"clauses": [], "overall_risk": "CLEAN",
          "summary": "No non-standard clauses detected.
          Standard IFRS 15 treatment applies."}
"""

    try:
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=2000,
            system=system_prompt,
            messages=[
                {
                    "role": "user",
                    "content": f"Contract text:\n\n{(contract_text or '')[:8000]}",
                }
            ],
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1] if len(parts) > 1 else raw
            raw = raw.strip()
            if raw.lower().startswith("json"):
                raw = raw[4:].lstrip()
        result = json.loads(raw.strip())
        clauses = list(result.get("clauses") or [])
        if not clauses:
            out = {
                "clauses": [],
                "clauses_found": 0,
                "high_severity": 0,
                "medium_severity": 0,
                "low_severity": 0,
                "overall_risk": "CLEAN",
                "summary": (
                    result.get("summary")
                    or "No non-standard clauses detected. Standard IFRS 15 treatment applies."
                ),
            }
            return out

        high = len([c for c in clauses if str((c or {}).get("severity", "")).upper() == "HIGH"])
        medium = len([c for c in clauses if str((c or {}).get("severity", "")).upper() == "MEDIUM"])
        low = len([c for c in clauses if str((c or {}).get("severity", "")).upper() == "LOW"])
        overall = _enforce_overall_risk(clauses)
        result["clauses"] = clauses
        result["overall_risk"] = overall
        result["clauses_found"] = len(clauses)
        result["high_severity"] = high
        result["medium_severity"] = medium
        result["low_severity"] = low
        if not (result.get("summary") or "").strip():
            result["summary"] = f"{len(clauses)} clause(s) flagged for IFRS 15 review."
        return result

    except Exception as e:
        return {
            "clauses": [],
            "clauses_found": 0,
            "high_severity": 0,
            "medium_severity": 0,
            "low_severity": 0,
            "overall_risk": "CLEAN",
            "summary": f"Clause detection unavailable: {str(e)}",
        }

