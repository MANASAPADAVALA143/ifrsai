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
        idc_entry = next(
            e for e in initial_je["entries"] if e["account"] == "Cash / Accounts Payable"
        )
        self.assertEqual(idc_entry["cr"], 125000)
        incentive_entry = next(
            e for e in initial_je["entries"] if e["account"] == "Cash/Bank" and e["dr"] > 0
        )
        self.assertEqual(incentive_entry["dr"], 100000)

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

    def test_current_noncurrent_at_commencement(self):
        """Current portion = year-1 principal; not closing balance after month 12."""
        lease = LeaseInput(
            lease_id="SPLIT-TEST",
            asset_description="Office",
            commencement_date=datetime(2021, 1, 1),
            lease_term_months=120,
            monthly_payment=Decimal("520000"),
            annual_discount_rate=Decimal("0.085"),
            currency="AED",
        )
        calc = IFRS16Calculator()
        results = calc.calculate_full_ifrs16(lease)
        schedule = results["amortization_schedule"]
        split = calc.calculate_current_vs_noncurrent(schedule, lease.commencement_date)

        year1_principal = float(schedule.head(12)["Principal"].sum())
        self.assertAlmostEqual(split["current_portion"], year1_principal, places=0)
        self.assertAlmostEqual(
            split["non_current_portion"],
            split["total_liability"] - year1_principal,
            places=0,
        )
        self.assertLess(split["current_portion"], split["total_liability"] * 0.2)

    def _lease_584772(self, annual_rate: str) -> LeaseInput:
        return LeaseInput(
            lease_id="LEASE-584772",
            asset_description="UAE office",
            commencement_date=datetime(2021, 1, 1),
            lease_term_months=120,
            monthly_payment=Decimal("850000"),
            annual_discount_rate=Decimal(annual_rate),
            currency="AED",
        )

    def test_lease_584772_at_5_5_percent(self):
        """Audit scorecard — 5.5% IBR, AED 850k/month, Jan 2021 × 120 months."""
        calc = IFRS16Calculator()
        lease = self._lease_584772("0.055")
        results = calc.calculate_full_ifrs16(lease)
        split = results["liability_split_at_commencement"]

        self.assertAlmostEqual(results["lease_liability"], 78322044.76, places=0)
        self.assertAlmostEqual(split["current_portion"], 6043115.15, places=0)
        self.assertAlmostEqual(split["non_current_portion"], 72278929.61, places=0)
        self.assertAlmostEqual(results["year_1_impact"]["interest_expense"], 4156884.85, places=0)
        self.assertAlmostEqual(results["monthly_depreciation"], 652683.71, places=0)
        self.assertAlmostEqual(results["total_interest"], 23677955.24, places=0)

    def test_lease_584772_split_recalculates_after_ibr_change(self):
        """Split must come from the new schedule after IBR change, not the old one."""
        calc = IFRS16Calculator()
        lease_low = self._lease_584772("0.055")
        lease_high = self._lease_584772("0.085")

        r_low = calc.calculate_full_ifrs16(lease_low)
        r_high = calc.calculate_full_ifrs16(lease_high)

        split_low = r_low["liability_split_at_commencement"]
        split_high = r_high["liability_split_at_commencement"]

        self.assertAlmostEqual(r_low["lease_liability"], 78322044.76, places=0)
        self.assertAlmostEqual(r_high["lease_liability"], 68556299.34, places=0)
        self.assertAlmostEqual(split_low["current_portion"], 6043115.15, places=0)
        self.assertAlmostEqual(split_high["current_portion"], 4547155.32, places=0)
        # Old wrong 8.5% "current" was ~63.6M — must not reappear
        self.assertLess(split_high["current_portion"], 10_000_000)

    def test_lease_584772_split_at_dec_2026(self):
        calc = IFRS16Calculator()
        lease = self._lease_584772("0.055")
        reporting = datetime(2026, 12, 31)
        results = calc.calculate_full_ifrs16(lease, reporting_date=reporting)
        split = results["liability_split_at_reporting"]

        self.assertIsNotNone(split)
        self.assertAlmostEqual(split["total_liability"], 36548960.78, places=0)
        self.assertAlmostEqual(split["current_portion"], 8399445.42, places=0)
        self.assertAlmostEqual(split["non_current_portion"], 28149515.36, places=0)

    def test_flat_payments_without_escalation_or_cpi(self):
        """No escalation/CPI → flat lease payments throughout the term."""
        lease = LeaseInput(
            lease_id="FLAT-36",
            asset_description="DIFC office",
            commencement_date=datetime(2024, 1, 1),
            lease_term_months=36,
            monthly_payment=Decimal("78000"),
            annual_discount_rate=Decimal("0.07"),
            initial_direct_costs=Decimal("30000"),
            legal_fees=Decimal("15000"),
            brokerage_fees=Decimal("10000"),
            other_initial_direct_costs=Decimal("5000"),
            rent_free_months=1,
            currency="AED",
        )
        results = IFRS16Calculator().calculate_full_ifrs16(lease)
        schedule = results["amortization_schedule"]
        paid = schedule[schedule["Payment"] > 0]["Payment"].tolist()
        self.assertTrue(all(p == 78000.0 for p in paid))
        self.assertEqual(schedule.iloc[0]["Payment"], 0)
        self.assertIn("rent-free period of 1 month", results["incentive_disclosure_note"])

    def test_maturity_buckets_non_zero(self):
        lease = LeaseInput(
            lease_id="MAT-36",
            asset_description="Office",
            commencement_date=datetime(2024, 1, 1),
            lease_term_months=36,
            monthly_payment=Decimal("78000"),
            annual_discount_rate=Decimal("0.07"),
            currency="AED",
        )
        calc = IFRS16Calculator()
        results = calc.calculate_full_ifrs16(lease, reporting_date=datetime(2024, 1, 1))
        maturity = results["maturity_analysis"]
        self.assertGreater(maturity["Total"], 0)
        bucket_sum = sum(v for k, v in maturity.items() if k != "Total")
        self.assertAlmostEqual(bucket_sum, maturity["Total"], places=0)

    def test_no_rent_free_disclosure(self):
        lease = LeaseInput(
            lease_id="NO-RF",
            asset_description="Office",
            commencement_date=datetime(2024, 1, 1),
            lease_term_months=12,
            monthly_payment=Decimal("50000"),
            annual_discount_rate=Decimal("0.07"),
            currency="AED",
        )
        note = IFRS16Calculator().calculate_full_ifrs16(lease)["incentive_disclosure_note"]
        self.assertIn("No rent-free period applies", note)

    def test_difc_lease_rent_free_and_escalation(self):
        """DIFC ICD Brookfield: 2mo rent-free, 5% step-up at month 13, AED 320k base."""
        lease = LeaseInput(
            lease_id="LEASE-2026-493353",
            asset_description="ICD Brookfield, DIFC",
            commencement_date=datetime(2026, 7, 1),
            lease_term_months=60,
            monthly_payment=Decimal("320000"),
            non_lease_component=Decimal("28000"),
            annual_discount_rate=Decimal("0.0525"),
            initial_direct_costs=Decimal("43000"),
            legal_fees=Decimal("25000"),
            brokerage_fees=Decimal("18000"),
            rent_free_months=2,
            escalation_rate=Decimal("0.05"),
            non_lease_additive=True,
            currency="AED",
        )
        results = IFRS16Calculator().calculate_full_ifrs16(lease)
        schedule = results["amortization_schedule"]

        self.assertEqual(schedule.iloc[0]["Payment"], 0)
        self.assertEqual(schedule.iloc[1]["Payment"], 0)
        self.assertGreater(schedule.iloc[0]["Interest"], 0)
        self.assertGreater(schedule.iloc[0]["Closing_Balance"], schedule.iloc[0]["Opening_Balance"])
        self.assertEqual(schedule.iloc[2]["Payment"], 320000)
        self.assertEqual(schedule.iloc[11]["Payment"], 320000)
        self.assertEqual(schedule.iloc[12]["Payment"], 336000)
        self.assertGreater(results["lease_liability"], 16854538)
        self.assertEqual(results["component_analysis"]["non_lease_component"], 28000.0)
        self.assertEqual(
            results["disclosure_data"]["end_date"],
            "2031-06-30",
        )

    def test_schedule_stops_when_liability_zero(self):
        """No rows after closing balance first reaches zero."""
        lease = LeaseInput(
            lease_id="EARLY-PAYOFF",
            asset_description="Short payoff",
            commencement_date=datetime(2024, 1, 1),
            lease_term_months=120,
            monthly_payment=Decimal("850000"),
            annual_discount_rate=Decimal("0.055"),
            currency="AED",
        )
        schedule = IFRS16Calculator().calculate_full_ifrs16(lease)["amortization_schedule"]
        zero_idx = schedule[schedule["Closing_Balance"] <= 0].index
        self.assertGreater(len(zero_idx), 0)
        first_zero = int(zero_idx[0])
        self.assertEqual(len(schedule), first_zero + 1)
        if first_zero + 1 < 120:
            self.assertLess(len(schedule), 120)


if __name__ == "__main__":
    unittest.main()
