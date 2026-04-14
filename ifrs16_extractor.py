"""
IFRS 16 Lease Contract Extractor using Claude API
Extracts lease terms from contracts with confidence scoring
"""

import anthropic
import json
from datetime import datetime
from typing import Optional, List, Dict, Any
from decimal import Decimal
import os
from pathlib import Path


class IFRS16LeaseExtractor:
    """Extract lease terms from contracts using Claude"""
    
    def __init__(self, api_key: str):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = "claude-sonnet-4-20250514"
    
    def extract_lease_terms(self, contract_text: str) -> Dict:
        """
        Extract IFRS 16-relevant terms from lease contract
        
        Args:
            contract_text: Full text of the lease contract
            
        Returns:
            Dictionary with structured lease data and confidence scores
        """
        
        prompt = f"""You are an IFRS 16 lease accounting expert. Extract all relevant lease terms from this contract.

LEASE CONTRACT:
{contract_text}

Extract the following in JSON format. For each field provide:
1. "value": the extracted data
2. "confidence": score 0-100%
3. "source_text": exact quote from contract
4. "assumptions": any assumptions made

REQUIRED FIELDS:

{{
  "basic_info": {{
    "lease_type": {{
      "value": "Operating Lease" or "Finance Lease",
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "asset_description": {{
      "value": "detailed description",
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "lessee_name": {{
      "value": "company name",
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "lessor_name": {{
      "value": "landlord/lessor name",
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }}
  }},
  "dates": {{
    "commencement_date": {{
      "value": "YYYY-MM-DD",
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "end_date": {{
      "value": "YYYY-MM-DD",
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "lease_term_months": {{
      "value": integer,
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }}
  }},
  "payments": {{
    "monthly_amount": {{
      "value": number (without currency symbol),
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "currency": {{
      "value": "INR/USD/etc",
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "payment_frequency": {{
      "value": "Monthly/Quarterly/Annual",
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "escalation_clause": {{
      "value": "description of rent increases",
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "variable_payments": {{
      "value": "any usage-based or contingent payments",
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }}
  }},
  "discount_rate": {{
    "stated_rate": {{
      "value": number or null (annual % as decimal, e.g. 0.085 for 8.5%),
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "ibr_hints": {{
      "value": "clues for determining incremental borrowing rate",
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }}
  }},
  "initial_costs": {{
    "broker_fees": {{
      "value": number or 0,
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "legal_fees": {{
      "value": number or 0,
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "stamp_duty": {{
      "value": number or 0,
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "total": {{
      "value": number,
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }}
  }},
  "options": {{
    "renewal_options": {{
      "value": "description",
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "purchase_option": {{
      "value": "description or null",
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "termination_clause": {{
      "value": "description",
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }}
  }},
  "ifrs16_classification": {{
    "ownership_transfer": {{
      "value": boolean,
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "bargain_purchase": {{
      "value": boolean,
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "lease_term_pct_of_life": {{
      "value": number (e.g. 75 for 75%),
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "pv_substantially_all_fair_value": {{
      "value": boolean,
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "recommended_classification": {{
      "value": "Operating Lease" or "Finance Lease",
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "reasoning": {{
      "value": "explanation",
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }}
  }},
  "remeasurement_triggers": {{
    "index_linked": {{
      "value": boolean,
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "market_rent_review": {{
      "value": "description or null",
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }},
    "scope_changes": {{
      "value": boolean,
      "confidence": 0-100,
      "source_text": "quote",
      "assumptions": "explanation"
    }}
  }},
  "validation": {{
    "missing_fields": {{
      "value": ["list of missing critical fields"],
      "confidence": 100,
      "source_text": "N/A",
      "assumptions": "N/A"
    }},
    "low_confidence_fields": {{
      "value": ["fields with confidence < 70%"],
      "confidence": 100,
      "source_text": "N/A",
      "assumptions": "N/A"
    }},
    "requires_human_review": {{
      "value": boolean,
      "confidence": 100,
      "source_text": "N/A",
      "assumptions": "N/A"
    }},
    "overall_confidence": {{
      "value": number (0-100),
      "confidence": 100,
      "source_text": "N/A",
      "assumptions": "N/A"
    }}
  }}
}}

CRITICAL INSTRUCTIONS:
- Return ONLY valid JSON, no other text
- If field not found, set value to null
- Dates must be YYYY-MM-DD format
- Numbers without currency symbols
- Confidence based on how explicit info is in contract
- Flag ambiguous items for human review

Begin extraction:"""

        try:
            message = self.client.messages.create(
                model=self.model,
                max_tokens=4000,
                temperature=0,  # Deterministic
                messages=[{"role": "user", "content": prompt}]
            )
        except Exception as e:
            raise RuntimeError(f"Claude API request failed: {getattr(e, 'message', str(e))}") from e
        
        # Get text from first content block (safe)
        if not message.content or len(message.content) == 0:
            raise ValueError("Claude returned empty response")
        first_block = message.content[0]
        response_text = getattr(first_block, "text", None)
        if response_text is None:
            response_text = str(first_block) if first_block else ""
        
        # Parse JSON
        json_text = response_text.strip()
        if json_text.startswith("```json"):
            json_text = json_text[7:]
        if json_text.startswith("```"):
            json_text = json_text.split("\n", 1)[-1]
        if json_text.endswith("```"):
            json_text = json_text[:-3]
        json_text = json_text.strip()
        
        try:
            data = json.loads(json_text)
        except json.JSONDecodeError as je:
            raise ValueError(f"AI returned invalid JSON (try again or use a clearer contract): {je.msg}") from je
        
        if not isinstance(data, dict):
            raise ValueError("AI extraction must return a JSON object")
        
        # Add metadata
        usage = getattr(message, "usage", None)
        tokens_used = (usage.input_tokens + usage.output_tokens) if usage else 0
        data['extraction_metadata'] = {
            'timestamp': datetime.now().isoformat(),
            'model': self.model,
            'api_version': 'v1',
            'tokens_used': tokens_used
        }
        
        return data
    
    def validate_extraction(self, data: Dict) -> Dict:
        """
        Validate extracted data quality
        
        Args:
            data: Extracted lease data
            
        Returns:
            Validation results with errors and warnings
        """
        
        errors = []
        warnings = []
        
        # Check critical fields
        try:
            if not data.get('dates', {}).get('commencement_date', {}).get('value'):
                errors.append("Missing commencement date")
        except (KeyError, AttributeError):
            errors.append("Invalid dates structure")
        
        try:
            if not data.get('payments', {}).get('monthly_amount', {}).get('value'):
                errors.append("Missing monthly payment amount")
        except (KeyError, AttributeError):
            errors.append("Invalid payments structure")
        
        # Check confidence scores
        low_conf_fields = []
        for section_name, section_data in (data or {}).items():
            if section_name == 'extraction_metadata':
                continue
            if not isinstance(section_data, dict):
                continue
            for field_name, field_data in section_data.items():
                if isinstance(field_data, dict) and isinstance(field_data.get('confidence'), (int, float)):
                    if field_data['confidence'] < 70:
                        low_conf_fields.append(f"{section_name}.{field_name}")
        
        if low_conf_fields:
            warnings.append(f"Low confidence fields: {', '.join(low_conf_fields)}")
        
        # Check discount rate
        try:
            if not data.get('discount_rate', {}).get('stated_rate', {}).get('value'):
                warnings.append("No discount rate found - IBR will be needed")
        except (KeyError, AttributeError):
            warnings.append("Invalid discount rate structure")
        
        return {
            'is_valid': len(errors) == 0,
            'errors': errors,
            'warnings': warnings,
            'requires_review': len(errors) > 0 or len(low_conf_fields) > 0,
            'low_confidence_count': len(low_conf_fields),
            'error_count': len(errors),
            'warning_count': len(warnings)
        }
    
    def extract_from_file(self, file_path: str) -> Dict:
        """
        Extract lease terms from a file (PDF, DOCX, TXT, or Excel)
        
        Args:
            file_path: Path to the lease contract file
            
        Returns:
            Extracted lease data
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
                    raw = page.extract_text()
                    contract_text += (raw if raw is not None else "") + "\n"
            except ImportError:
                raise ImportError("PyPDF2 not installed. Run: pip install PyPDF2")
            except Exception as e:
                raise RuntimeError(f"Could not read PDF (encrypted, corrupt, or unsupported): {e}") from e

        elif file_path.suffix.lower() in ['.docx', '.doc']:
            try:
                from docx import Document
                doc = Document(str(file_path))
                contract_text = "\n".join([para.text for para in doc.paragraphs])
            except ImportError:
                raise ImportError("python-docx not installed. Run: pip install python-docx")
            except Exception as e:
                raise RuntimeError(
                    f"Could not read Word file. Use .docx (not old .doc) or PDF/TXT: {e}"
                ) from e

        elif file_path.suffix.lower() in ['.xlsx', '.xls']:
            try:
                import pandas as pd
                excel_file = pd.ExcelFile(str(file_path))
                contract_text = ""

                for sheet_name in excel_file.sheet_names:
                    contract_text += f"\n=== Sheet: {sheet_name} ===\n"
                    df = pd.read_excel(excel_file, sheet_name=sheet_name)
                    contract_text += " | ".join(str(col) for col in df.columns) + "\n"
                    contract_text += "-" * 80 + "\n"
                    for _, row in df.iterrows():
                        row_text = " | ".join(str(val) if pd.notna(val) else "" for val in row.values)
                        contract_text += row_text + "\n"
                    contract_text += "\n"

            except ImportError:
                raise ImportError("pandas and openpyxl not installed. Run: pip install pandas openpyxl")
            except Exception as e:
                raise RuntimeError(f"Could not read Excel file (corrupt or wrong format): {e}") from e
        
        else:
            raise ValueError(f"Unsupported file type: {file_path.suffix}")

        contract_text = (contract_text or "").strip()
        if len(contract_text) < 30:
            raise ValueError(
                "No readable text was extracted from this file. "
                "Scanned PDFs need OCR, or try DOCX/TXT, or a text-based PDF."
            )

        return self.extract_lease_terms(contract_text)
    
    def save_extraction(self, data: Dict, output_path: str):
        """
        Save extracted data to JSON file
        
        Args:
            data: Extracted lease data
            output_path: Path to save JSON file
        """
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        print(f"✅ Extraction saved to: {output_path}")


# Example usage
if __name__ == "__main__":
    sample_contract = """
    COMMERCIAL LEASE AGREEMENT
    
    Date: January 1, 2024
    Lessor: Prime Properties Ltd.
    Lessee: TechCorp India Pvt. Ltd.
    
    1. LEASED PREMISES
    Office space: 5th Floor, Tech Park, Hitech City, Hyderabad
    Area: 5,000 sq ft
    Use: Commercial office operations
    
    2. TERM
    Commencement Date: January 1, 2024
    End Date: December 31, 2026
    Duration: 36 months (3 years)
    
    3. RENT
    Monthly Rent: ₹50,000 (Rupees Fifty Thousand Only)
    Payment Due: 1st of each month
    Payment Method: Bank transfer to Lessor's account
    Escalation: 5% annual increase starting Year 2
    
    4. INITIAL COSTS
    Security Deposit: ₹150,000 (refundable)
    Stamp Duty: ₹25,000 (paid by Lessee)
    Legal Fees: ₹15,000 (paid by Lessee)
    Broker Commission: ₹30,000 (paid by Lessee)
    
    5. OPTIONS
    Renewal: Lessee has option to renew for two additional 12-month periods at market rate
    Termination: Either party may terminate with 6 months notice after Year 2
    Purchase: No purchase option available
    
    6. MAINTENANCE
    Lessee responsible for interior maintenance
    Lessor responsible for structural repairs
    
    7. UTILITIES
    Electricity, water, and internet paid by Lessee
    Property tax paid by Lessor
    """
    
    # Get API key from environment
    api_key = os.getenv('ANTHROPIC_API_KEY')
    
    if not api_key:
        print("⚠️  ANTHROPIC_API_KEY not found in environment")
        print("To run this example:")
        print("1. Get API key from https://console.anthropic.com/")
        print("2. Set environment variable: export ANTHROPIC_API_KEY='your-key'")
        print("\nUsing sample contract for demonstration...")
        api_key = "demo-key"  # This will fail but shows the structure
    
    try:
        extractor = IFRS16LeaseExtractor(api_key=api_key)
        
        print("="*70)
        print("IFRS 16 LEASE CONTRACT EXTRACTION")
        print("="*70)
        print("\nExtracting lease terms...")
        
        data = extractor.extract_lease_terms(sample_contract)
        
        print("\n" + "="*70)
        print("EXTRACTION RESULTS")
        print("="*70)
        print(json.dumps(data, indent=2))
        
        print("\n" + "="*70)
        print("VALIDATION")
        print("="*70)
        validation = extractor.validate_extraction(data)
        print(json.dumps(validation, indent=2))
        
        if validation['is_valid']:
            print("\n✅ Extraction successful!")
        else:
            print(f"\n⚠️  Extraction has {validation['error_count']} errors")
        
        if validation['warnings']:
            print(f"⚠️  {validation['warning_count']} warnings found")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        print("\nNote: This example requires a valid ANTHROPIC_API_KEY")



