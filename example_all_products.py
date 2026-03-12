"""
IFRS AI Suite - Complete Example
Demonstrates all 3 products: IFRS 16, IFRS 15, and IFRS 9
"""

import os
from datetime import datetime
from decimal import Decimal
import pandas as pd

# Import all calculators
from ifrs16_calculator import IFRS16Calculator, LeaseInput
from ifrs15_calculator import IFRS15Calculator, IFRS15Input, PerformanceObligation
from ifrs9_ecl_calculator import IFRS9ECLCalculator


def demo_ifrs16():
    """Demo IFRS 16 Lease Accounting"""
    print("\n" + "="*80)
    print("PRODUCT 1: IFRS 16 LEASE ACCOUNTING")
    print("="*80)
    
    lease = LeaseInput(
        lease_id="LEASE-2024-001",
        asset_description="Commercial Office - Mumbai",
        lessee_name="TechCorp India Pvt. Ltd.",
        lessor_name="Prime Properties Ltd.",
        commencement_date=datetime(2024, 1, 1),
        lease_term_months=36,
        monthly_payment=Decimal('50000'),
        annual_discount_rate=Decimal('0.085'),
        initial_direct_costs=Decimal('40000'),
        currency="INR"
    )
    
    calc = IFRS16Calculator()
    results = calc.calculate_full_ifrs16(lease)
    
    print(f"\n📊 LEASE CALCULATION RESULTS")
    print(f"   Lease Liability: ₹{results['lease_liability']:,.2f}")
    print(f"   ROU Asset: ₹{results['rou_asset']:,.2f}")
    print(f"   Monthly Depreciation: ₹{results['monthly_depreciation']:,.2f}")
    print(f"   Total Interest: ₹{results['total_interest']:,.2f}")
    
    print(f"\n📈 YEAR 1 P&L IMPACT")
    print(f"   Depreciation: ₹{results['year_1_impact']['depreciation_expense']:,.2f}")
    print(f"   Interest: ₹{results['year_1_impact']['interest_expense']:,.2f}")
    print(f"   Total Expense: ₹{results['year_1_impact']['total_p_l_expense']:,.2f}")
    print(f"   EBITDA Improvement: ₹{results['year_1_impact']['ebitda_improvement']:,.2f}")
    
    print(f"\n✅ IFRS 16 calculation complete!")
    return results


def demo_ifrs15():
    """Demo IFRS 15 Revenue Recognition"""
    print("\n" + "="*80)
    print("PRODUCT 2: IFRS 15 REVENUE RECOGNITION")
    print("="*80)
    
    contract = IFRS15Input(
        contract_id="CONTRACT-2024-001",
        customer_name="ABC Corporation",
        vendor_name="TechSoft Solutions Ltd.",
        effective_date=datetime(2024, 1, 1),
        contract_term_months=12,
        fixed_consideration=Decimal('750000'),
        variable_consideration=Decimal('20000'),  # Performance bonus
        currency="USD",
        performance_obligations=[
            PerformanceObligation(
                obligation_id="PO-1",
                description="Software License",
                standalone_selling_price=Decimal('500000'),
                recognition_method="point_in_time",
                transfer_date=datetime(2024, 1, 1)
            ),
            PerformanceObligation(
                obligation_id="PO-2",
                description="Implementation Services",
                standalone_selling_price=Decimal('150000'),
                recognition_method="over_time",
                duration_months=6
            ),
            PerformanceObligation(
                obligation_id="PO-3",
                description="Technical Support",
                standalone_selling_price=Decimal('75000'),
                recognition_method="over_time",
                duration_months=12
            ),
            PerformanceObligation(
                obligation_id="PO-4",
                description="Training",
                standalone_selling_price=Decimal('25000'),
                recognition_method="point_in_time",
                transfer_date=datetime(2024, 7, 1)
            )
        ]
    )
    
    calc = IFRS15Calculator()
    results = calc.calculate_full_ifrs15(contract, cash_received=Decimal('250000'))
    
    print(f"\n📊 REVENUE RECOGNITION RESULTS")
    print(f"   Transaction Price: ${results['transaction_price']:,.2f}")
    
    print(f"\n💰 ALLOCATION BY PERFORMANCE OBLIGATION")
    for ob_id, amount in results['allocations'].items():
        print(f"   {ob_id}: ${amount:,.2f}")
    
    print(f"\n📈 CONTRACT BALANCES")
    print(f"   Revenue Recognized: ${results['contract_balances']['revenue_recognized_to_date']:,.2f}")
    print(f"   Cash Received: ${results['contract_balances']['cash_received_to_date']:,.2f}")
    if results['contract_balances']['is_contract_liability']:
        print(f"   Contract Liability: ${results['contract_balances']['contract_liability_amount']:,.2f}")
    elif results['contract_balances']['is_contract_asset']:
        print(f"   Contract Asset: ${results['contract_balances']['contract_asset_amount']:,.2f}")
    
    print(f"\n📋 REMAINING PERFORMANCE OBLIGATIONS")
    for item in results['disclosure_data']['performance_obligations']:
        if item['remaining'] > 0:
            print(f"   {item['obligation']}: ${item['remaining']:,.2f} remaining")
    
    print(f"\n✅ IFRS 15 calculation complete!")
    return results


def demo_ifrs9():
    """Demo IFRS 9 Expected Credit Loss"""
    print("\n" + "="*80)
    print("PRODUCT 3: IFRS 9 EXPECTED CREDIT LOSS")
    print("="*80)
    
    # Sample loan portfolio
    portfolio = pd.DataFrame([
        {
            'loan_id': 'L001',
            'borrower_name': 'Company A Ltd.',
            'outstanding_balance': 1000000,
            'days_past_due': 0,
            'current_pd': 0.02,
            'pd_12m': 0.02,
            'pd_lifetime': 0.10,
            'origination_pd': 0.01,
            'lgd': 0.45,
            'remaining_term_years': 5,
            'current_rating': 'A',
            'origination_rating': 'A',
            'is_forbearance': False,
            'is_default': False,
            'is_watchlist': False
        },
        {
            'loan_id': 'L002',
            'borrower_name': 'Company B Ltd.',
            'outstanding_balance': 500000,
            'days_past_due': 45,
            'current_pd': 0.05,
            'pd_12m': 0.05,
            'pd_lifetime': 0.25,
            'origination_pd': 0.02,
            'lgd': 0.50,
            'remaining_term_years': 4,
            'current_rating': 'BBB',
            'origination_rating': 'A',
            'is_forbearance': False,
            'is_default': False,
            'is_watchlist': False
        },
        {
            'loan_id': 'L003',
            'borrower_name': 'Company C Ltd.',
            'outstanding_balance': 750000,
            'days_past_due': 120,
            'current_pd': 0.80,
            'pd_12m': 0.80,
            'pd_lifetime': 0.90,
            'origination_pd': 0.03,
            'lgd': 0.55,
            'remaining_term_years': 3,
            'current_rating': 'D',
            'origination_rating': 'BBB',
            'is_forbearance': False,
            'is_default': True,
            'is_watchlist': False
        },
        {
            'loan_id': 'L004',
            'borrower_name': 'Company D Ltd.',
            'outstanding_balance': 2000000,
            'days_past_due': 15,
            'current_pd': 0.01,
            'pd_12m': 0.01,
            'pd_lifetime': 0.05,
            'origination_pd': 0.01,
            'lgd': 0.40,
            'remaining_term_years': 7,
            'current_rating': 'AA',
            'origination_rating': 'AA',
            'is_forbearance': False,
            'is_default': False,
            'is_watchlist': False
        },
        {
            'loan_id': 'L005',
            'borrower_name': 'Company E Ltd.',
            'outstanding_balance': 300000,
            'days_past_due': 35,
            'current_pd': 0.06,
            'pd_12m': 0.06,
            'pd_lifetime': 0.20,
            'origination_pd': 0.02,
            'lgd': 0.48,
            'remaining_term_years': 3,
            'current_rating': 'BB',
            'origination_rating': 'A',
            'is_forbearance': True,
            'is_default': False,
            'is_watchlist': True
        }
    ])
    
    calc = IFRS9ECLCalculator()
    results = calc.calculate_full_ifrs9_ecl(
        portfolio, 
        discount_rate=0.08,
        previous_ecl=50000.0
    )
    
    print(f"\n📊 ECL CALCULATION RESULTS")
    print(f"   Total Loans: {results['summary']['total_loans']}")
    print(f"   Total Exposure: ${results['summary']['total_exposure']:,.2f}")
    print(f"   Total ECL Provision: ${results['summary']['total_ecl_provision']:,.2f}")
    print(f"   Coverage Ratio: {results['summary']['overall_coverage_ratio_pct']:.2f}%")
    
    print(f"\n📈 ECL BY STAGE")
    for stage, data in results['summary']['by_stage'].items():
        if data['loan_count'] > 0:
            print(f"   {stage}:")
            print(f"     Loans: {data['loan_count']}")
            print(f"     Exposure: ${data['total_exposure']:,.2f}")
            print(f"     ECL: ${data['total_ecl']:,.2f}")
            print(f"     Coverage: {data['coverage_ratio_pct']:.2f}%")
    
    print(f"\n💰 ECL MOVEMENT")
    print(f"   Opening: ${results['movement_analysis']['opening_ecl']:,.2f}")
    print(f"   Closing: ${results['movement_analysis']['closing_ecl']:,.2f}")
    print(f"   Movement: ${results['movement_analysis']['movement']:,.2f}")
    
    print(f"\n📋 PORTFOLIO DETAIL (Top 3 by Exposure)")
    top_loans = results['portfolio_detail'].nlargest(3, 'outstanding_balance')
    for _, loan in top_loans.iterrows():
        print(f"   {loan['loan_id']}: ${loan['outstanding_balance']:,.0f} | {loan['stage']} | ECL: ${loan['ecl_provision']:,.2f}")
    
    print(f"\n✅ IFRS 9 calculation complete!")
    return results


def generate_combined_report():
    """Generate combined financial impact report"""
    print("\n" + "="*80)
    print("COMBINED FINANCIAL IMPACT - ALL 3 IFRS STANDARDS")
    print("="*80)
    
    # Run all calculations
    ifrs16_results = demo_ifrs16()
    ifrs15_results = demo_ifrs15()
    ifrs9_results = demo_ifrs9()
    
    # Combined Summary
    print("\n" + "="*80)
    print("COMBINED BALANCE SHEET IMPACT")
    print("="*80)
    
    print(f"\nASSETS:")
    print(f"   ROU Asset (IFRS 16): ₹{ifrs16_results['rou_asset']:,.2f}")
    if ifrs15_results['contract_balances']['is_contract_asset']:
        print(f"   Contract Asset (IFRS 15): ${ifrs15_results['contract_balances']['contract_asset_amount']:,.2f}")
    print(f"   Gross Loans: ${ifrs9_results['summary']['total_exposure']:,.2f}")
    print(f"   Less: ECL Allowance: $(${ifrs9_results['summary']['total_ecl_provision']:,.2f})")
    print(f"   Net Loans: ${ifrs9_results['summary']['total_exposure'] - ifrs9_results['summary']['total_ecl_provision']:,.2f}")
    
    print(f"\nLIABILITIES:")
    print(f"   Lease Liability (IFRS 16): ₹{ifrs16_results['lease_liability']:,.2f}")
    if ifrs15_results['contract_balances']['is_contract_liability']:
        print(f"   Contract Liability (IFRS 15): ${ifrs15_results['contract_balances']['contract_liability_amount']:,.2f}")
    
    print("\n" + "="*80)
    print("COMBINED P&L IMPACT")
    print("="*80)
    
    print(f"\nEXPENSES:")
    print(f"   Depreciation - ROU (IFRS 16): ₹{ifrs16_results['year_1_impact']['depreciation_expense']:,.2f}")
    print(f"   Interest - Lease (IFRS 16): ₹{ifrs16_results['year_1_impact']['interest_expense']:,.2f}")
    print(f"   Credit Loss Expense (IFRS 9): ${ifrs9_results['movement_analysis']['movement']:,.2f}")
    
    print(f"\nREVENUE:")
    print(f"   Revenue Recognized (IFRS 15): ${ifrs15_results['contract_balances']['revenue_recognized_to_date']:,.2f}")
    
    print("\n" + "="*80)
    print("TIME & COST SAVINGS")
    print("="*80)
    
    print(f"\nMANUAL PROCESS (Before Automation):")
    print(f"   IFRS 16 (50 leases): 200 hours/quarter")
    print(f"   IFRS 15 (100 contracts): 150 hours/quarter")
    print(f"   IFRS 9 (5000 loans): 500 hours/quarter")
    print(f"   Total: 850 hours/quarter (5+ FTE)")
    
    print(f"\nWITH AUTOMATION (After):")
    print(f"   IFRS 16 (50 leases): 10 hours/quarter")
    print(f"   IFRS 15 (100 contracts): 15 hours/quarter")
    print(f"   IFRS 9 (5000 loans): 50 hours/quarter")
    print(f"   Total: 75 hours/quarter (<1 FTE)")
    
    print(f"\n💰 SAVINGS:")
    print(f"   Time Saved: 775 hours/quarter (91%)")
    print(f"   FTE Saved: 4.5 people")
    print(f"   Cost Saved: ₹1,55,000/quarter @ ₹200/hour")
    print(f"   Annual Savings: ₹6,20,000")
    
    print("\n" + "="*80)
    print("✅ ALL 3 IFRS PRODUCTS DEMONSTRATED SUCCESSFULLY!")
    print("="*80)


def main():
    """Main function"""
    print("="*80)
    print("IFRS AI AUTOMATION SUITE - COMPLETE DEMO")
    print("All 3 Products: IFRS 16, IFRS 15, IFRS 9")
    print("="*80)
    
    print("\n📋 This demo will show:")
    print("   1. IFRS 16 - Lease Accounting")
    print("   2. IFRS 15 - Revenue Recognition")
    print("   3. IFRS 9 - Expected Credit Loss")
    print("   4. Combined Financial Impact")
    
    try:
        generate_combined_report()
        
        print("\n" + "="*80)
        print("💡 NEXT STEPS")
        print("="*80)
        print("\n1. Try individual examples:")
        print("   - python example_usage.py          # IFRS 16 only")
        print("   - python ifrs15_calculator.py      # IFRS 15 only")
        print("   - python ifrs9_ecl_calculator.py   # IFRS 9 only")
        
        print("\n2. Start API server:")
        print("   - python app.py")
        print("   - Visit: http://localhost:8000/api/docs")
        
        print("\n3. Deploy to production:")
        print("   - See DEPLOYMENT.md for cloud deployment")
        
        print("\n4. Read documentation:")
        print("   - ALL_PRODUCTS_README.md  # All 3 products")
        print("   - README.md               # IFRS 16 detailed docs")
        print("   - QUICKSTART.md           # 5-minute guide")
        
        print("\n" + "="*80)
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()

