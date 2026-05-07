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


if __name__ == "__main__":
    unittest.main()
