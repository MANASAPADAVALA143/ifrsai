"""Tests for erp_integrations/journal_mapper.py — balance checks."""
import unittest
from erp_integrations.journal_mapper import map_monthly_entry, map_initial_recognition


def _check_balance(lines: list) -> tuple[float, float]:
    dr = sum(l["amount"] for l in lines if l["side"] == "debit")
    cr = sum(l["amount"] for l in lines if l["side"] == "credit")
    return dr, cr


ACCOUNT_MAP = {
    "interest_expense": "ACC-INT",
    "lease_liability": "ACC-LL",
    "cash": "ACC-CASH",
    "depreciation": "ACC-DEP",
    "acc_dep_rou": "ACC-ADEP",
    "rou_asset": "ACC-ROU",
}


class JournalMapperBalanceTests(unittest.TestCase):

    def test_monthly_entry_balances(self):
        """Dr total must equal Cr total for a standard monthly entry."""
        row = {
            "period": "2024-01",
            "date": "2024-01-31",
            "interest": 5000,
            "payment": 15000,
            "principal": 10000,
            "depreciation": 8333,
        }
        result = map_monthly_entry("TEST-001", row, ACCOUNT_MAP)
        dr, cr = _check_balance(result["lines"])
        self.assertEqual(dr, cr, f"Journal unbalanced: Dr={dr} Cr={cr}")

    def test_monthly_entry_liability_net_effect_equals_principal(self):
        """Net movement on Lease Liability must equal the principal repaid."""
        row = {
            "period": "2024-02",
            "date": "2024-02-28",
            "interest": 4800,
            "payment": 15000,
            "principal": 10200,
            "depreciation": 8333,
        }
        result = map_monthly_entry("TEST-001", row, ACCOUNT_MAP)
        ll_dr = sum(l["amount"] for l in result["lines"] if l["side"] == "debit" and l["account"] == "ACC-LL")
        ll_cr = sum(l["amount"] for l in result["lines"] if l["side"] == "credit" and l["account"] == "ACC-LL")
        net = ll_cr - ll_dr  # positive = liability increased, negative = decreased
        expected = -(row["payment"] - row["interest"])  # -(principal)
        self.assertAlmostEqual(net, expected, places=2,
                               msg=f"Liability net movement {net} != expected {expected}")

    def test_monthly_entry_zero_interest_balances(self):
        """Zero interest period (e.g. rent-free) must still balance."""
        row = {"period": "2024-03", "date": "2024-03-31",
               "interest": 0, "payment": 15000, "principal": 15000, "depreciation": 8333}
        result = map_monthly_entry("TEST-001", row, ACCOUNT_MAP)
        dr, cr = _check_balance(result["lines"])
        self.assertEqual(dr, cr, f"Journal unbalanced: Dr={dr} Cr={cr}")

    def test_monthly_entry_zero_payment_balances(self):
        """Rent-free period with no payment must still balance."""
        row = {"period": "2024-04", "date": "2024-04-30",
               "interest": 5000, "payment": 0, "principal": 0, "depreciation": 8333}
        result = map_monthly_entry("TEST-001", row, ACCOUNT_MAP)
        dr, cr = _check_balance(result["lines"])
        self.assertEqual(dr, cr, f"Journal unbalanced: Dr={dr} Cr={cr}")

    def test_initial_recognition_balances(self):
        """Initial recognition Dr must equal Cr."""
        results = {
            "rou_asset": 100000,
            "lease_liability": 100000,
            "commencement_date": "2024-01-01",
            "asset_description": "Test Office",
        }
        result = map_initial_recognition("TEST-001", results, ACCOUNT_MAP)
        dr, cr = _check_balance(result["lines"])
        self.assertEqual(dr, cr, f"Journal unbalanced: Dr={dr} Cr={cr}")

    def test_initial_recognition_rou_equals_liability(self):
        """ROU debit amount must match liability credit amount."""
        results = {
            "rou_asset": 755000,
            "lease_liability": 755000,
            "commencement_date": "2024-01-01",
            "asset_description": "Warehouse",
        }
        result = map_initial_recognition("LEASE-A", results, ACCOUNT_MAP)
        rou_dr = next(l["amount"] for l in result["lines"] if l["side"] == "debit")
        ll_cr = next(l["amount"] for l in result["lines"] if l["side"] == "credit")
        self.assertEqual(rou_dr, 755000)
        self.assertEqual(ll_cr, 755000)


if __name__ == "__main__":
    unittest.main()
