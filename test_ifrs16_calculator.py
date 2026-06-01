from datetime import datetime
from decimal import Decimal
import unittest

from ifrs16_calculator import IFRS16Calculator, LeaseInput


class IFRS16CalculatorTests(unittest.TestCase):
    def test_manchester_rent_free_non_lease_outputs(self):
        lease = LeaseInput(
            lease_id="Manchester",
            asset_description="Manchester office",
            commencement_date=datetime(2024, 1, 1),
            lease_term_months=84,
            monthly_payment=Decimal("420000"),
            non_lease_component=Decimal("55000"),
            annual_discount_rate=Decimal("0.06"),
            initial_direct_costs=Decimal("125000"),
            rent_free_months=2,
            cash_incentive=Decimal("100000"),
            currency="GBP",
        )

        results = IFRS16Calculator().calculate_full_ifrs16(lease)
        schedule = results["amortization_schedule"]
        initial_je = results["journal_entries"]["initial_recognition"]

        self.assertEqual(results["lease_liability"], 24260799.22)
        self.assertEqual(results["rou_asset"], 24285799.22)
        self.assertEqual(results["monthly_depreciation"], 289116.66)
        self.assertEqual(round(results["total_interest"], 2), 5669200.78)
        self.assertEqual(schedule.iloc[0]["Payment"], 0)
        self.assertEqual(schedule.iloc[1]["Payment"], 0)
        self.assertEqual(schedule.iloc[2]["Payment"], 365000)
        self.assertEqual(schedule.iloc[-1]["Payment"], 365000)
        self.assertEqual(schedule.iloc[-1]["Closing_Balance"], 0)
        self.assertEqual(initial_je["total_dr"], initial_je["total_cr"])
        self.assertEqual(initial_je["entries"][2]["account"], "Cash/Bank")
        self.assertEqual(initial_je["entries"][2]["cr"], 25000)

    def test_re_uk_001_rent_free_and_non_lease(self):
        """RE-UK-001: 3 months rent-free, 95k non-lease on 850k gross, 120 months @ 5.5%."""
        lease = LeaseInput(
            lease_id="RE-UK-001",
            asset_description="Manchester Office",
            commencement_date=datetime(2024, 1, 1),
            lease_term_months=120,
            monthly_payment=Decimal("850000"),
            non_lease_component=Decimal("95000"),
            annual_discount_rate=Decimal("0.055"),
            initial_direct_costs=Decimal("250000"),
            legal_fees=Decimal("120000"),
            brokerage_fees=Decimal("80000"),
            other_initial_direct_costs=Decimal("50000"),
            rent_free_months=3,
            currency="GBP",
        )
        results = IFRS16Calculator().calculate_full_ifrs16(lease)
        schedule = results["amortization_schedule"]

        self.assertEqual(schedule.iloc[0]["Payment"], 0)
        self.assertEqual(schedule.iloc[1]["Payment"], 0)
        self.assertEqual(schedule.iloc[2]["Payment"], 0)
        self.assertEqual(schedule.iloc[3]["Payment"], 755000)
        self.assertAlmostEqual(results["lease_liability"], 67324009.44, places=2)
        self.assertAlmostEqual(schedule.iloc[0]["Interest"], 308568.38, places=2)
        self.assertTrue(schedule.iloc[0]["Rent_Free"])
        self.assertEqual(results["component_analysis"]["lease_component"], 755000.0)


if __name__ == "__main__":
    unittest.main()
