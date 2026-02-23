"""
IFRS 15 Revenue Recognition Contract Extractor
AI-powered extraction of revenue recognition terms using Claude API
"""

import anthropic
import json
from typing import Dict, List
from datetime import datetime
from decimal import Decimal
import os
from pathlib import Path


class IFRS15ContractExtractor:
    """Extract IFRS 15 revenue terms using Claude API"""
    
    def __init__(self, api_key: str):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = "claude-sonnet-4-20250514"
    
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
        
        prompt = f"""You are an IFRS 15 revenue recognition expert. Analyze this contract and extract all relevant revenue accounting information.

CONTRACT:
{contract_text}

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
            max_tokens=6000,
            temperature=0,
            messages=[{"role": "user", "content": prompt}]
        )
        
        response_text = message.content[0].text
        
        # Parse JSON
        json_text = response_text.strip()
        if json_text.startswith("```json"):
            json_text = json_text[7:]
        if json_text.endswith("```"):
            json_text = json_text[:-3]
        
        data = json.loads(json_text.strip())
        
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
    
    def extract_from_file(self, file_path: str) -> Dict:
        """
        Extract IFRS 15 terms from a file
        
        Args:
            file_path: Path to contract file (PDF, DOCX, TXT)
            
        Returns:
            Extracted contract data
        """
        file_path = Path(file_path)
        
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        
        # Read file based on extension
        if file_path.suffix.lower() == '.txt':
            with open(file_path, 'r', encoding='utf-8') as f:
                contract_text = f.read()
        
        elif file_path.suffix.lower() == '.pdf':
            try:
                from PyPDF2 import PdfReader
                reader = PdfReader(str(file_path))
                contract_text = ""
                for page in reader.pages:
                    contract_text += page.extract_text() + "\n"
            except ImportError:
                raise ImportError("PyPDF2 not installed. Run: pip install PyPDF2")
        
        elif file_path.suffix.lower() in ['.docx', '.doc']:
            try:
                from docx import Document
                doc = Document(str(file_path))
                contract_text = "\n".join([para.text for para in doc.paragraphs])
            except ImportError:
                raise ImportError("python-docx not installed. Run: pip install python-docx")
        
        else:
            raise ValueError(f"Unsupported file type: {file_path.suffix}")
        
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
