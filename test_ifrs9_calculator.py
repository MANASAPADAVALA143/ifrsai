"""IFRS 9 calculator, staging, classification, and reconciliation tests."""

from decimal import Decimal
import unittest

import pandas as pd

from ifrs9_ecl_calculator import IFRS9ClassificationEngine, IFRS9ECLCalculator
from ifrs9_staging import IFRS9StagingEngine, LoanStage
from backend.app.services.ifrs9_calculate_service import orchestrate_calculate
from backend.app.services.ifrs9_reconciliation_service import build_reconciliation_from_runs


class IFRS9CalculatorTests(unittest.TestCase):
    def setUp(self):
        self.calculator = IFRS9ECLCalculator()
        self.staging = IFRS9StagingEngine()
        self.classifier = IFRS9ClassificationEngine()

    def test_sppi_pass_amortised_cost(self):
        result = self.classifier.classify(
            {
                "instrument_name": "Corporate Loan",
                "instrument_type": "loan",
                "business_model_indicators": [
                    "hold_to_maturity",
                    "contractual_cash_flows_only",
                    "infrequent_sales",
                    "no_trading_intent",
                ],
                "sppi_features": ["principal_interest_only", "no_leverage"],
                "prepayment_penalty_reasonable": True,
                "fair_value_option_elected": False,
            }
        )
        self.assertTrue(result["sppi_pass"])
        self.assertEqual(result["measurement"], "AMORTISED_COST")
        self.assertTrue(result["ecl_applies"])

    def test_sppi_fail_fvtpl(self):
        result = self.classifier.classify(
            {
                "instrument_name": "Trading Bond",
                "instrument_type": "bond",
                "business_model_indicators": ["frequent_sales", "trading_intent"],
                "sppi_features": ["non_recourse", "leverage"],
                "prepayment_penalty_reasonable": False,
                "fair_value_option_elected": False,
            }
        )
        self.assertFalse(result["sppi_pass"])
        self.assertEqual(result["measurement"], "FVTPL")
        self.assertFalse(result["ecl_applies"])

    def test_stage1_performing(self):
        loan = {
            "days_past_due": 0,
            "current_pd": 0.01,
            "origination_pd": 0.01,
            "current_rating": "A",
            "origination_rating": "A",
            "is_forbearance": False,
            "is_default": False,
        }
        self.assertEqual(self.staging.classify_loan(loan), LoanStage.STAGE_1)

    def test_stage2_dpd_45(self):
        loan = {
            "days_past_due": 45,
            "current_pd": 0.02,
            "origination_pd": 0.01,
            "current_rating": "BBB",
            "origination_rating": "A",
            "is_forbearance": False,
            "is_default": False,
        }
        self.assertEqual(self.staging.classify_loan(loan), LoanStage.STAGE_2)

    def test_stage3_default_dpd_90(self):
        loan = {
            "days_past_due": 95,
            "current_pd": 0.5,
            "origination_pd": 0.01,
            "is_default": False,
        }
        self.assertEqual(self.staging.classify_loan(loan), LoanStage.STAGE_3)

    def test_stage1_twelve_month_ecl(self):
        loan = {
            "outstanding_balance": 100_000,
            "pd_12m": 0.01,
            "lgd": 0.45,
        }
        ecl = self.calculator.calculate_stage1_ecl(loan, Decimal("0.08"))
        self.assertGreater(ecl, 0)
        self.assertLess(ecl, 50_000)

    def test_stage2_lifetime_ecl_exceeds_stage1(self):
        loan = {
            "outstanding_balance": 100_000,
            "pd_12m": 0.01,
            "pd_lifetime": 0.05,
            "lgd": 0.45,
            "remaining_term_years": 5,
        }
        ecl_12m = float(self.calculator.calculate_stage1_ecl(loan, Decimal("0.08")))
        ecl_life = float(self.calculator.calculate_stage2_ecl(loan, Decimal("0.08")))
        self.assertGreater(ecl_life, ecl_12m)

    def test_macro_overlay_increases_pd(self):
        base_pd = Decimal("0.01")
        adjusted = self.calculator.apply_macro_overlay(
            base_pd,
            gdp_growth=-2.0,
            unemployment=1.0,
            interest_rate=0.5,
        )
        self.assertGreater(adjusted, base_pd)

    def test_scenario_weighting_orchestrate(self):
        result = orchestrate_calculate(
            {
                "approach": "general",
                "ead": 100_000,
                "pd_12m": 1.0,
                "pd_lifetime": 5.0,
                "lgd": 45,
                "stage_override": True,
                "stage": 1,
                "scenarios": {
                    "base_weight": 50,
                    "optimistic_weight": 30,
                    "pessimistic_weight": 20,
                    "base_macro": {"gdp_growth": 0, "unemployment": 0, "interest_rate": 0},
                    "optimistic_macro": {"gdp_growth": 2, "unemployment": -0.5, "interest_rate": -0.25},
                    "pessimistic_macro": {"gdp_growth": -3, "unemployment": 2, "interest_rate": 1},
                },
            }
        )
        scenarios = result["scenario_results"]
        self.assertIsNotNone(scenarios)
        self.assertGreater(scenarios["weighted"], 0)
        self.assertGreater(scenarios["pessimistic"], scenarios["optimistic"])

    def test_journal_generation_increase(self):
        journals = self.calculator.generate_journal_entries(
            Decimal("10000"), Decimal("8000")
        )
        self.assertEqual(journals["description"], "Increase in ECL provision")
        dr = journals["entries"][0]["dr"]
        self.assertEqual(dr, 2000.0)

    def test_journal_tie_out(self):
        bridge = {
            "stage1": {
                "opening_ecl": 8000,
                "new_additions": 0,
                "transfers_in": 0,
                "transfers_out": 0,
                "write_offs": 0,
                "remeasurement": 2000,
                "closing_ecl": 10000,
            },
            "stage2": {
                "opening_ecl": 0,
                "new_additions": 0,
                "transfers_in": 0,
                "transfers_out": 0,
                "write_offs": 0,
                "remeasurement": 0,
                "closing_ecl": 0,
            },
            "stage3": {
                "opening_ecl": 0,
                "new_additions": 0,
                "transfers_in": 0,
                "transfers_out": 0,
                "write_offs": 0,
                "remeasurement": 0,
                "closing_ecl": 0,
            },
            "totals": {
                "opening_ecl": 8000,
                "closing_ecl": 10000,
                "new_additions": 0,
                "transfers_in": 0,
                "transfers_out": 0,
                "write_offs": 0,
                "remeasurement": 2000,
            },
            "_reconciliation": {"valid": True, "net_movement": 2000, "issues": []},
        }
        journals = self.calculator.generate_journal_entries(
            Decimal("10000"), Decimal("8000")
        )
        tie = self.calculator.journal_tie_out_check(
            bridge, journals, 8000, 10000
        )
        self.assertTrue(tie["tied"])
        self.assertEqual(tie["ecl_delta"], 2000.0)

    def test_portfolio_recalculation_regression(self):
        loans = [
            {
                "loan_id": "L1",
                "outstanding_balance": 50_000,
                "pd_12m": 0.01,
                "pd_lifetime": 0.04,
                "lgd": 0.4,
                "days_past_due": 0,
                "origination_pd": 0.01,
            },
            {
                "loan_id": "L2",
                "outstanding_balance": 75_000,
                "pd_12m": 0.02,
                "pd_lifetime": 0.08,
                "lgd": 0.45,
                "days_past_due": 45,
                "origination_pd": 0.01,
            },
        ]
        df = pd.DataFrame(loans)
        first = self.calculator.calculate_full_ifrs9_ecl(df, previous_ecl=0.0)
        first_total = first["summary"]["total_ecl_provision"]

        df2 = self.calculator.staging_engine.classify_portfolio(df.copy())
        second = self.calculator.calculate_full_ifrs9_ecl(
            df2, previous_ecl=first_total
        )
        second_total = second["summary"]["total_ecl_provision"]

        self.assertGreater(first_total, 0)
        self.assertGreater(second_total, 0)
        self.assertIn("ecl_movement", second)
        self.assertIn("totals", second["ecl_movement"])
        movement = second["movement_analysis"]["movement"]
        self.assertAlmostEqual(movement, second_total - first_total, places=2)

    def test_reconciliation_from_two_runs(self):
        prior_run = {
            "id": "run-1",
            "portfolio_id": "PORT-001",
            "applicable_ecl": 5000.0,
            "created_at": "2026-01-01T00:00:00Z",
            "ecl_movement": {
                "stage1": {
                    "opening_ecl": 0,
                    "new_additions": 5000,
                    "transfers_in": 0,
                    "transfers_out": 0,
                    "write_offs": 0,
                    "remeasurement": 0,
                    "closing_ecl": 5000,
                },
                "stage2": {
                    "opening_ecl": 0,
                    "new_additions": 0,
                    "transfers_in": 0,
                    "transfers_out": 0,
                    "write_offs": 0,
                    "remeasurement": 0,
                    "closing_ecl": 0,
                },
                "stage3": {
                    "opening_ecl": 0,
                    "new_additions": 0,
                    "transfers_in": 0,
                    "transfers_out": 0,
                    "write_offs": 0,
                    "remeasurement": 0,
                    "closing_ecl": 0,
                },
            },
            "journal_outputs": self.calculator.generate_journal_entries(
                Decimal("5000"), Decimal("0")
            ),
        }
        current_run = {
            "id": "run-2",
            "portfolio_id": "PORT-001",
            "applicable_ecl": 7200.0,
            "created_at": "2026-02-01T00:00:00Z",
            "ecl_results": {
                "applicable_ecl": 7200.0,
                "portfolio_loans": [
                    {
                        "loan_id": "L1",
                        "stage": "Stage 1",
                        "ecl_provision": 7200.0,
                        "outstanding_balance": 100_000,
                    }
                ],
                "journal_entries": self.calculator.generate_journal_entries(
                    Decimal("7200"), Decimal("5000")
                ),
            },
        }
        report = build_reconciliation_from_runs(prior_run, current_run)
        self.assertEqual(report["ecl_delta"], 2200.0)
        self.assertIn("journal_tie_out", report)
        self.assertIn("stage1", report["ecl_movement"])


if __name__ == "__main__":
    unittest.main()
