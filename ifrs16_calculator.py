"""
IFRS 16 Lease Accounting Calculator
Calculates lease liability, ROU asset, amortization schedules, and journal entries
"""

import pandas as pd
import numpy as np
from datetime import datetime
from dateutil.relativedelta import relativedelta
from decimal import Decimal, ROUND_HALF_UP
from dataclasses import dataclass
from typing import Dict, Optional, List
import json


@dataclass
class LeaseInput:
    """Lease parameters for IFRS 16 calculation"""
    lease_id: str
    asset_description: str
    commencement_date: datetime
    lease_term_months: int
    monthly_payment: Decimal
    annual_discount_rate: Decimal  # e.g. 0.085 for 8.5%
    initial_direct_costs: Decimal = Decimal('0')
    escalation_rate: Decimal = Decimal('0')  # Annual, e.g. 0.05 for 5%
    currency: str = "INR"
    lessee_name: str = ""
    lessor_name: str = ""


class IFRS16Calculator:
    """IFRS 16 lease liability and ROU asset calculator"""
    
    def __init__(self):
        self.precision = Decimal('0.01')
    
    def calculate_lease_liability(self, lease: LeaseInput) -> Decimal:
        """
        Calculate present value of lease payments (Initial Lease Liability)
        
        Formula: PV = PMT × [(1 - (1 + r)^-n) / r]
        Where:
        - PMT = monthly payment
        - r = monthly discount rate
        - n = number of periods
        
        Args:
            lease: LeaseInput object with lease parameters
            
        Returns:
            Present value of lease payments
        """
        
        monthly_rate = lease.annual_discount_rate / Decimal('12')
        
        # Handle zero interest rate edge case
        if monthly_rate == 0:
            return lease.monthly_payment * Decimal(str(lease.lease_term_months))
        
        # Annuity present value formula
        discount_factor = (
            Decimal('1') - (Decimal('1') + monthly_rate) ** -lease.lease_term_months
        ) / monthly_rate
        
        pv = lease.monthly_payment * discount_factor
        
        return pv.quantize(self.precision, ROUND_HALF_UP)
    
    def calculate_rou_asset(self, lease_liability: Decimal, initial_costs: Decimal) -> Decimal:
        """
        Calculate Right-of-Use Asset
        
        ROU Asset = Lease Liability + Initial Direct Costs
        
        Args:
            lease_liability: Initial lease liability
            initial_costs: Initial direct costs (stamp duty, legal fees, etc.)
            
        Returns:
            ROU asset value
        """
        return (lease_liability + initial_costs).quantize(self.precision, ROUND_HALF_UP)
    
    def calculate_monthly_depreciation(self, rou_asset: Decimal, months: int) -> Decimal:
        """
        Calculate monthly straight-line depreciation
        
        Args:
            rou_asset: Right-of-use asset value
            months: Lease term in months
            
        Returns:
            Monthly depreciation amount
        """
        return (rou_asset / Decimal(str(months))).quantize(self.precision, ROUND_HALF_UP)
    
    def generate_amortization_schedule(
        self, 
        lease: LeaseInput, 
        lease_liability: Decimal
    ) -> pd.DataFrame:
        """
        Generate monthly amortization table using effective interest method
        
        Columns: Period, Date, Month, Opening_Balance, Payment, Interest, Principal, Closing_Balance
        
        Args:
            lease: LeaseInput object
            lease_liability: Initial lease liability
            
        Returns:
            DataFrame with monthly amortization schedule
        """
        
        monthly_rate = lease.annual_discount_rate / Decimal('12')
        
        schedule = []
        balance = lease_liability
        current_date = lease.commencement_date
        payment = lease.monthly_payment
        
        for period in range(1, lease.lease_term_months + 1):
            # Interest = Balance × Monthly Rate (effective interest method)
            interest = (balance * monthly_rate).quantize(self.precision, ROUND_HALF_UP)
            
            # Apply escalation every 12 months
            if lease.escalation_rate > 0 and period > 1 and (period - 1) % 12 == 0:
                payment = (payment * (Decimal('1') + lease.escalation_rate)).quantize(
                    self.precision, ROUND_HALF_UP
                )
            
            # Principal = Payment - Interest
            principal = payment - interest
            
            # Last period adjustment to ensure balance goes to zero
            if period == lease.lease_term_months:
                principal = balance
                interest = payment - principal
                if interest < 0:
                    interest = Decimal('0')
                    payment = principal
            
            # New balance
            new_balance = (balance - principal).quantize(self.precision, ROUND_HALF_UP)
            if new_balance < 0:
                new_balance = Decimal('0')
            
            schedule.append({
                'Period': period,
                'Date': current_date.strftime('%Y-%m-%d'),
                'Month': current_date.strftime('%b %Y'),
                'Opening_Balance': float(balance),
                'Payment': float(payment),
                'Interest': float(interest),
                'Principal': float(principal),
                'Closing_Balance': float(new_balance)
            })
            
            balance = new_balance
            current_date += relativedelta(months=1)
        
        return pd.DataFrame(schedule)
    
    def generate_journal_entries(
        self, 
        rou_asset: Decimal, 
        lease_liability: Decimal,
        monthly_depreciation: Decimal,
        first_month_interest: Decimal,
        first_month_payment: Decimal,
        currency: str = "INR"
    ) -> Dict:
        """
        Generate accounting journal entries for IFRS 16
        
        Args:
            rou_asset: Right-of-use asset value
            lease_liability: Lease liability value
            monthly_depreciation: Monthly depreciation amount
            first_month_interest: First month interest expense
            first_month_payment: First month payment amount
            currency: Currency code
            
        Returns:
            Dictionary of journal entries
        """
        
        currency_symbol = "₹" if currency == "INR" else currency
        
        return {
            'initial_recognition': {
                'date': 'Commencement Date',
                'description': 'Initial recognition of lease under IFRS 16',
                'entries': [
                    {
                        'account': 'Right-of-Use Asset',
                        'account_type': 'Non-Current Asset',
                        'dr': float(rou_asset),
                        'cr': 0,
                        'narration': 'Recognition of ROU asset'
                    },
                    {
                        'account': 'Lease Liability',
                        'account_type': 'Current & Non-Current Liability',
                        'dr': 0,
                        'cr': float(lease_liability),
                        'narration': 'Recognition of lease liability at PV'
                    }
                ],
                'total_dr': float(rou_asset),
                'total_cr': float(lease_liability)
            },
            'monthly_depreciation': {
                'description': 'Monthly depreciation expense (recurring entry)',
                'frequency': 'Monthly',
                'entries': [
                    {
                        'account': 'Depreciation Expense - ROU Asset',
                        'account_type': 'Expense (P&L)',
                        'dr': float(monthly_depreciation),
                        'cr': 0,
                        'narration': 'Straight-line depreciation of ROU asset'
                    },
                    {
                        'account': 'Accumulated Depreciation - ROU Asset',
                        'account_type': 'Contra Asset',
                        'dr': 0,
                        'cr': float(monthly_depreciation),
                        'narration': 'Accumulated depreciation'
                    }
                ],
                'total_dr': float(monthly_depreciation),
                'total_cr': float(monthly_depreciation)
            },
            'monthly_payment_example': {
                'description': 'Monthly lease payment (example - Month 1)',
                'frequency': 'Monthly',
                'entries': [
                    {
                        'account': 'Interest Expense',
                        'account_type': 'Expense (P&L)',
                        'dr': float(first_month_interest),
                        'cr': 0,
                        'narration': 'Interest on lease liability (effective interest method)'
                    },
                    {
                        'account': 'Lease Liability',
                        'account_type': 'Liability',
                        'dr': float(first_month_payment - first_month_interest),
                        'cr': 0,
                        'narration': 'Principal reduction of lease liability'
                    },
                    {
                        'account': 'Cash/Bank',
                        'account_type': 'Current Asset',
                        'dr': 0,
                        'cr': float(first_month_payment),
                        'narration': 'Lease payment to lessor'
                    }
                ],
                'total_dr': float(first_month_payment),
                'total_cr': float(first_month_payment)
            }
        }
    
    def generate_maturity_analysis(self, schedule: pd.DataFrame) -> Dict:
        """
        Generate future lease payment maturity analysis by year
        Required for IFRS 16 disclosure notes
        
        Args:
            schedule: Amortization schedule DataFrame
            
        Returns:
            Dictionary with payments by year
        """
        
        total = len(schedule)
        return {
            'Year_1': float(schedule.iloc[:min(12, total)]['Payment'].sum()),
            'Year_2': float(schedule.iloc[12:min(24, total)]['Payment'].sum()) if total > 12 else 0.0,
            'Year_3': float(schedule.iloc[24:min(36, total)]['Payment'].sum()) if total > 24 else 0.0,
            'Year_4': float(schedule.iloc[36:min(48, total)]['Payment'].sum()) if total > 36 else 0.0,
            'Year_5': float(schedule.iloc[48:min(60, total)]['Payment'].sum()) if total > 48 else 0.0,
            'Thereafter': float(schedule.iloc[60:]['Payment'].sum()) if total > 60 else 0.0,
            'Total': float(schedule['Payment'].sum())
        }
    
    def calculate_current_vs_noncurrent(
        self, 
        schedule: pd.DataFrame,
        reporting_date: datetime
    ) -> Dict:
        """
        Split lease liability into current and non-current portions
        
        Args:
            schedule: Amortization schedule
            reporting_date: Date for balance sheet split
            
        Returns:
            Dictionary with current and non-current portions
        """
        
        cutoff_date = reporting_date + relativedelta(months=12)
        
        schedule['Date_dt'] = pd.to_datetime(schedule['Date'])
        
        current = schedule[schedule['Date_dt'] <= cutoff_date]['Closing_Balance'].iloc[-1] \
                  if len(schedule[schedule['Date_dt'] <= cutoff_date]) > 0 else 0
        
        total_liability = schedule.iloc[0]['Opening_Balance']
        noncurrent = total_liability - current
        
        return {
            'current_portion': float(current),
            'non_current_portion': float(max(0, noncurrent)),
            'total_liability': float(total_liability),
            'reporting_date': reporting_date.strftime('%Y-%m-%d'),
            'cutoff_date': cutoff_date.strftime('%Y-%m-%d')
        }
    
    def calculate_full_ifrs16(self, lease: LeaseInput) -> Dict:
        """
        Complete IFRS 16 calculation - main entry point
        
        Performs all calculations and generates all required outputs:
        - Lease liability
        - ROU asset
        - Amortization schedule
        - Journal entries
        - Maturity analysis
        - P&L impact analysis
        
        Args:
            lease: LeaseInput object with all lease parameters
            
        Returns:
            Dictionary with all IFRS 16 calculations and reports
        """
        
        # Step 1: Calculate Lease Liability (PV of lease payments)
        lease_liability = self.calculate_lease_liability(lease)
        
        # Step 2: Calculate ROU Asset
        rou_asset = self.calculate_rou_asset(lease_liability, lease.initial_direct_costs)
        
        # Step 3: Calculate Monthly Depreciation
        monthly_depreciation = self.calculate_monthly_depreciation(rou_asset, lease.lease_term_months)
        
        # Step 4: Generate Amortization Schedule
        schedule = self.generate_amortization_schedule(lease, lease_liability)
        
        # Step 5: Calculate Total Interest over lease term
        total_interest = schedule['Interest'].sum()
        
        # Step 6: Generate Journal Entries
        first_month = schedule.iloc[0]
        journal_entries = self.generate_journal_entries(
            rou_asset, 
            lease_liability, 
            monthly_depreciation,
            Decimal(str(first_month['Interest'])),
            Decimal(str(first_month['Payment'])),
            lease.currency
        )
        
        # Step 7: Generate Maturity Analysis
        maturity = self.generate_maturity_analysis(schedule)
        
        # Step 8: Calculate Year 1 P&L Impact
        year_1_data = schedule.head(min(12, len(schedule)))
        year_1_interest = year_1_data['Interest'].sum()
        year_1_depreciation = float(monthly_depreciation) * min(12, len(schedule))
        year_1_payments = year_1_data['Payment'].sum()
        
        # Step 9: Calculate current vs non-current split
        liability_split = self.calculate_current_vs_noncurrent(schedule, lease.commencement_date)
        
        # Step 10: Calculate total cost of lease
        total_payments = schedule['Payment'].sum()
        total_cost = float(lease_liability) + float(lease.initial_direct_costs)
        
        return {
            'lease_liability': float(lease_liability),
            'rou_asset': float(rou_asset),
            'monthly_depreciation': float(monthly_depreciation),
            'total_interest': float(total_interest),
            'amortization_schedule': schedule,
            'journal_entries': journal_entries,
            'maturity_analysis': maturity,
            'liability_split': liability_split,
            'year_1_impact': {
                'interest_expense': float(year_1_interest),
                'depreciation_expense': float(year_1_depreciation),
                'total_p_l_expense': float(year_1_interest + year_1_depreciation),
                'cash_outflow': float(year_1_payments),
                'ebitda_improvement': float(year_1_payments),  # Lease expense removed from EBITDA
                'ebit_impact': float(year_1_depreciation - year_1_payments)
            },
            'total_lease_cost': {
                'total_payments': float(total_payments),
                'initial_costs': float(lease.initial_direct_costs),
                'total_interest': float(total_interest),
                'grand_total': float(total_payments) + float(lease.initial_direct_costs)
            },
            'disclosure_data': {
                'lease_id': lease.lease_id,
                'asset': lease.asset_description,
                'lessee': lease.lessee_name,
                'lessor': lease.lessor_name,
                'commencement': lease.commencement_date.strftime('%Y-%m-%d'),
                'end_date': (lease.commencement_date + relativedelta(months=lease.lease_term_months)).strftime('%Y-%m-%d'),
                'term_months': lease.lease_term_months,
                'discount_rate_pct': float(lease.annual_discount_rate * 100),
                'currency': lease.currency
            },
            'calculation_metadata': {
                'calculation_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'calculator_version': '1.0',
                'standard': 'IFRS 16'
            }
        }
    
    def export_to_json(self, results: Dict, filename: str):
        """
        Export calculation results to JSON file
        
        Args:
            results: Results dictionary from calculate_full_ifrs16()
            filename: Output filename
        """
        
        # Convert DataFrame to dict for JSON serialization
        results_copy = results.copy()
        if 'amortization_schedule' in results_copy:
            results_copy['amortization_schedule'] = results_copy['amortization_schedule'].to_dict(orient='records')
        
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(results_copy, f, indent=2, ensure_ascii=False)
        
        print(f"✅ Results exported to: {filename}")


# Example usage
if __name__ == "__main__":
    # Sample lease data
    lease = LeaseInput(
        lease_id="LEASE-2024-001",
        asset_description="Commercial Office - 5,000 sq ft, Tech Park Hyderabad",
        lessee_name="TechCorp India Pvt. Ltd.",
        lessor_name="Prime Properties Ltd.",
        commencement_date=datetime(2024, 1, 1),
        lease_term_months=36,
        monthly_payment=Decimal('50000'),
        annual_discount_rate=Decimal('0.085'),  # 8.5%
        initial_direct_costs=Decimal('40000'),  # Stamp duty + legal fees
        escalation_rate=Decimal('0.05'),  # 5% annual escalation
        currency="INR"
    )
    
    # Perform calculations
    calc = IFRS16Calculator()
    results = calc.calculate_full_ifrs16(lease)
    
    # Display results
    print("="*70)
    print("IFRS 16 LEASE ACCOUNTING CALCULATION")
    print("="*70)
    
    print(f"\n{'LEASE DETAILS':^70}")
    print("="*70)
    print(f"Lease ID: {results['disclosure_data']['lease_id']}")
    print(f"Asset: {results['disclosure_data']['asset']}")
    print(f"Lessee: {results['disclosure_data']['lessee']}")
    print(f"Lessor: {results['disclosure_data']['lessor']}")
    print(f"Term: {results['disclosure_data']['term_months']} months")
    print(f"Discount Rate: {results['disclosure_data']['discount_rate_pct']:.2f}%")
    
    print(f"\n{'INITIAL MEASUREMENT':^70}")
    print("="*70)
    print(f"Lease Liability: ₹{results['lease_liability']:,.2f}")
    print(f"Right-of-Use Asset: ₹{results['rou_asset']:,.2f}")
    print(f"Monthly Depreciation: ₹{results['monthly_depreciation']:,.2f}")
    print(f"Total Interest (over term): ₹{results['total_interest']:,.2f}")
    
    print(f"\n{'BALANCE SHEET CLASSIFICATION':^70}")
    print("="*70)
    print(f"Current Portion of Lease Liability: ₹{results['liability_split']['current_portion']:,.2f}")
    print(f"Non-Current Portion of Lease Liability: ₹{results['liability_split']['non_current_portion']:,.2f}")
    print(f"Total Lease Liability: ₹{results['liability_split']['total_liability']:,.2f}")
    
    print(f"\n{'AMORTIZATION SCHEDULE (First 6 Months)':^70}")
    print("="*70)
    print(results['amortization_schedule'].head(6).to_string(index=False))
    
    print(f"\n{'MATURITY ANALYSIS':^70}")
    print("="*70)
    for year, amount in results['maturity_analysis'].items():
        print(f"{year.replace('_', ' '):<15} ₹{amount:>15,.2f}")
    
    print(f"\n{'YEAR 1 P&L IMPACT':^70}")
    print("="*70)
    print(f"Interest Expense: ₹{results['year_1_impact']['interest_expense']:,.2f}")
    print(f"Depreciation Expense: ₹{results['year_1_impact']['depreciation_expense']:,.2f}")
    print(f"Total P&L Expense: ₹{results['year_1_impact']['total_p_l_expense']:,.2f}")
    print(f"Cash Outflow: ₹{results['year_1_impact']['cash_outflow']:,.2f}")
    print(f"EBITDA Improvement: ₹{results['year_1_impact']['ebitda_improvement']:,.2f}")
    
    print(f"\n{'TOTAL LEASE COST':^70}")
    print("="*70)
    print(f"Total Payments: ₹{results['total_lease_cost']['total_payments']:,.2f}")
    print(f"Initial Direct Costs: ₹{results['total_lease_cost']['initial_costs']:,.2f}")
    print(f"Total Interest: ₹{results['total_lease_cost']['total_interest']:,.2f}")
    print(f"Grand Total: ₹{results['total_lease_cost']['grand_total']:,.2f}")
    
    print("\n" + "="*70)
    print(f"{'CALCULATION COMPLETE':^70}")
    print("="*70)
    
    # Export to JSON
    try:
        calc.export_to_json(results, "ifrs16_results.json")
    except Exception as e:
        print(f"\nNote: Could not export JSON: {e}")


