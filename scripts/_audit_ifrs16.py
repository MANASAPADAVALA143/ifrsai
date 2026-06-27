"""One-off IFRS 16 calculation audit script."""
from datetime import datetime
from decimal import Decimal
import sys
sys.path.insert(0, ".")

from ifrs16_calculator import IFRS16Calculator, LeaseInput

issues = []

def check(name, cond, detail):
    if not cond:
        issues.append((name, detail))

calc = IFRS16Calculator()

# --- Standard lease ---
lease = LeaseInput(
    lease_id="AUDIT-36",
    asset_description="Office",
    commencement_date=datetime(2024, 1, 1),
    lease_term_months=36,
    monthly_payment=Decimal("78000"),
    annual_discount_rate=Decimal("0.07"),
    initial_direct_costs=Decimal("30000"),
    legal_fees=Decimal("15000"),
    brokerage_fees=Decimal("10000"),
    other_initial_direct_costs=Decimal("5000"),
    currency="AED",
)
results = calc.calculate_full_ifrs16(lease, reporting_date=datetime(2026, 12, 31))
schedule = results["amortization_schedule"]
ll = Decimal(str(results["lease_liability"]))
rou = Decimal(str(results["rou_asset"]))
idc = Decimal("30000")

# 4 Initial recognition journal
je = results["journal_entries"]["initial_recognition"]
split = results["liability_split_at_commencement"]
curr = Decimal(str(split["current_portion"]))
noncurr = Decimal(str(split["non_current_portion"]))
check("initial_je_balance", abs(je["total_dr"] - je["total_cr"]) < 0.02,
      f"Dr {je['total_dr']} != Cr {je['total_cr']}")
check("initial_je_rou", abs(rou - ll - idc) < 0.02, f"ROU {rou} != LL {ll} + IDC {idc}")
check("initial_split", abs(curr + noncurr - ll) < 0.02, f"current+noncurrent {curr+noncurr} != ll {ll}")

# 7 Amortization
last = schedule.iloc[-1]
check("amort_closing_zero", abs(last["Closing_Balance"]) < 0.02, f"last closing {last['Closing_Balance']}")
check("amort_p1_arrears_interest", abs(schedule.iloc[0]["Interest"] - float(ll) * 0.07/12) < 1,
      f"p1 interest {schedule.iloc[0]['Interest']}")
p1_int = schedule.iloc[0]["Interest"]
p1_pay = schedule.iloc[0]["Payment"]
check("amort_p1_principal", abs(schedule.iloc[0]["Principal"] - (p1_pay - p1_int)) < 0.02, "p1 principal")

# Advance lease
adv = LeaseInput(
    lease_id="ADV",
    asset_description="Office",
    commencement_date=datetime(2024, 1, 1),
    lease_term_months=24,
    monthly_payment=Decimal("100000"),
    annual_discount_rate=Decimal("0.05"),
    payment_type="Advance",
    currency="AED",
)
r_adv = calc.calculate_full_ifrs16(adv)
s_adv = r_adv["amortization_schedule"]
check("advance_p1_interest_zero", s_adv.iloc[0]["Interest"] == 0, f"p1 interest {s_adv.iloc[0]['Interest']}")
check("advance_p1_principal", abs(s_adv.iloc[0]["Principal"] - s_adv.iloc[0]["Payment"]) < 0.02, "advance p1")

# Rent-free
rf = LeaseInput(
    lease_id="RF",
    asset_description="Office",
    commencement_date=datetime(2024, 1, 1),
    lease_term_months=36,
    monthly_payment=Decimal("78000"),
    annual_discount_rate=Decimal("0.07"),
    rent_free_months=1,
    currency="AED",
)
r_rf = calc.calculate_full_ifrs16(rf)
s_rf = r_rf["amortization_schedule"]
check("rentfree_p1_pay", s_rf.iloc[0]["Payment"] == 0, f"p1 pay {s_rf.iloc[0]['Payment']}")
check("rentfree_p1_interest", s_rf.iloc[0]["Interest"] > 0, "no interest rent-free")
check("rentfree_balance_up", s_rf.iloc[0]["Closing_Balance"] > s_rf.iloc[0]["Opening_Balance"], "balance should increase")

# CPI
cpi = LeaseInput(
    lease_id="CPI",
    asset_description="Office",
    commencement_date=datetime(2024, 1, 1),
    lease_term_months=36,
    monthly_payment=Decimal("155000"),
    annual_discount_rate=Decimal("0.07"),
    cpi_index_base=Decimal("100"),
    cpi_index_current=Decimal("115"),
    currency="AED",
)
r_cpi = calc.calculate_full_ifrs16(cpi)
s_cpi = r_cpi["amortization_schedule"]
check("cpi_month12", s_cpi.iloc[11]["Payment"] == 155000.0, f"m12 {s_cpi.iloc[11]['Payment']}")
check("cpi_month13", s_cpi.iloc[12]["Payment"] == 178250.0, f"m13 {s_cpi.iloc[12]['Payment']}")

# Maturity
mat = results["maturity_analysis"]
split_rep = results["liability_split_at_reporting"]
total_pv = split_rep["current_portion"] + split_rep["non_current_portion"]
check("maturity_total", mat["Total"] > 0, "empty maturity")
check("maturity_bucket_sum", abs(sum(v for k,v in mat.items() if k != "Total") - mat["Total"]) < 1, "bucket sum")

# Monthly journal month 1 (arrears)
m1 = schedule.iloc[0]
m1_je_dr = m1["Interest"] + m1["Principal"]
check("monthly_je_balance", abs(m1_je_dr - m1["Payment"]) < 0.02, f"m1 dr {m1_je_dr} != pay {m1['Payment']}")

# ROU depreciation
monthly_dep = results["monthly_depreciation"]
check("rou_dep", abs(monthly_dep - float(rou)/36) < 0.02, f"dep {monthly_dep}")

# Schedule length vs term
check("schedule_len", len(schedule) == 36, f"len {len(schedule)} != 36")

# Split at reporting equals total liability
check("split_rep", abs(split_rep["current_portion"] + split_rep["non_current_portion"] - split_rep["total_liability"]) < 1,
      f"split {split_rep}")

print(f"Issues found: {len(issues)}")
for name, detail in issues:
    print(f"  [{name}] {detail}")
