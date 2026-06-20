"""Structure tests for IFRS 15 UAE SPA extraction (no Claude API required)."""

import unittest

from ifrs15_extractor import IFRS15ContractExtractor

DOWNTOWN_VIEWS_SPA_TEXT = """
SALE AND PURCHASE AGREEMENT
SPA Reference: SPA-DV2-1205-2024
Oqood Registration: DLD-2024-OQ-48291
RERA Project Registration: RERA-DT2-2024-001

Developer: Emaar Development LLC
Buyer: Mohammed Al Rashidi
Emirates ID: 784-1985-1234567-1

Project: Downtown Views II — Tower B
Unit: Apartment 1205, Floor 12
Built-up Area: 1,450 sq ft

Contract Date: 15 March 2024
Construction Start: January 2024
Expected Completion: Q4 2026
Expected Handover: December 2026

Total Purchase Price: AED 2,450,000 (exclusive of VAT)
VAT: AED 122,500 (5%)
Booking Amount: AED 245,000 (10%)

Payment Plan:
- Booking: AED 245,000 (10%) on signing
- 6 months from SPA: AED 122,500 (5%)
- 12 months from SPA: AED 122,500 (5%)
- On 30% completion: AED 245,000 (10%)
- On 50% completion: AED 245,000 (10%)
- On 70% completion: AED 245,000 (10%)
- On handover: AED 1,225,000 (50%)

Performance Obligation: Delivery of completed apartment unit
Revenue: Recognised over time during construction (IFRS 15.35(c))
Cancellation: UAE Law 8/2007 refund terms apply
"""


class IFRS15SPASchemaTests(unittest.TestCase):
    def test_confidence_summary_from_mock_payload(self):
        mock = {
            "contract_identification": {
                "rera_registration": {"value": "RERA-DT2-2024-001", "confidence": 92},
                "contract_date": {"value": "2024-03-15", "confidence": 95},
            },
            "financial": {
                "contract_value_aed": {"value": 2450000, "confidence": 98},
                "payment_plan": {
                    "value": [{"label": "Booking", "amount_aed": 245000}],
                    "confidence": 88,
                },
            },
            "parties": {
                "buyer_name": {"value": "Mohammed Al Rashidi", "confidence": 90},
            },
        }
        ext = IFRS15ContractExtractor(api_key="dummy")
        summary = ext.compute_uae_spa_confidence_summary(mock)
        self.assertGreaterEqual(summary["overall_confidence"], 80)
        self.assertGreater(summary["fields_scored"], 0)

    def test_validate_uae_spa_missing_buyer(self):
        ext = IFRS15ContractExtractor(api_key="dummy")
        result = ext.validate_uae_spa_extraction(
            {
                "financial": {"contract_value_aed": {"value": 1000000, "confidence": 90}},
                "parties": {},
            }
        )
        self.assertFalse(result["is_valid"])
        self.assertIn("Missing buyer name", result["errors"])

    def test_validate_uae_spa_complete_mock(self):
        ext = IFRS15ContractExtractor(api_key="dummy")
        result = ext.validate_uae_spa_extraction(
            {
                "contract_identification": {
                    "rera_registration": {"value": "RERA-001", "confidence": 90},
                },
                "property": {"unit_number": {"value": "1205", "confidence": 85}},
                "parties": {"buyer_name": {"value": "Test Buyer", "confidence": 90}},
                "financial": {
                    "contract_value_aed": {"value": 2450000, "confidence": 95},
                    "payment_plan": {
                        "value": [{"label": "Booking", "amount_aed": 245000}],
                        "confidence": 85,
                    },
                },
                "extraction_metadata": {"overall_confidence": 88},
            }
        )
        self.assertTrue(result["is_valid"])


if __name__ == "__main__":
    unittest.main()
