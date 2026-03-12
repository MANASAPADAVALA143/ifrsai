"""
IFRS 9 Expected Credit Loss (ECL) Calculator
Calculate ECL provisions for Stage 1, 2, and 3 loans
"""

import pandas as pd
import numpy as np
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, List
import json

from ifrs9_staging import IFRS9StagingEngine, LoanStage


class IFRS9ECLCalculator:
    """
    Calculate Expected Credit Loss under IFRS 9
    
    ECL = PD × LGD × EAD × Discount Factor
    
    Where:
    - PD: Probability of Default
    - LGD: Loss Given Default
    - EAD: Exposure at Default
    - Discount Factor: Present value adjustment
    """
    
    def __init__(self):
        self.precision = Decimal('0.01')
        self.staging_engine = IFRS9StagingEngine()
    
    def calculate_ecl_single_loan(
        self,
        exposure: Decimal,
        pd: Decimal,
        lgd: Decimal,
        discount_rate: Decimal = Decimal('0.08'),
        time_horizon_years: int = 1
    ) -> Decimal:
        """
        Calculate ECL for a single loan
        
        ECL = EAD × PD × LGD × DF
        
        Args:
            exposure: Exposure at Default (EAD)
            pd: Probability of Default (0-1)
            lgd: Loss Given Default (0-1)
            discount_rate: Discount rate for PV calculation
            time_horizon_years: Time horizon (1 for Stage 1, lifetime for Stage 2/3)
            
        Returns:
            Expected Credit Loss amount
        """
        
        # Discount factor for present value
        discount_factor = Decimal('1') / ((Decimal('1') + discount_rate) ** time_horizon_years)
        
        # ECL calculation
        ecl = exposure * pd * lgd * discount_factor
        
        return ecl.quantize(self.precision, ROUND_HALF_UP)
    
    def calculate_stage1_ecl(
        self,
        loan: Dict,
        discount_rate: Decimal = Decimal('0.08')
    ) -> Decimal:
        """
        Calculate 12-month ECL for Stage 1 loan
        
        Stage 1: 12-month ECL (probability of default in next 12 months)
        
        Args:
            loan: Loan dictionary with exposure, pd, lgd
            discount_rate: Discount rate
            
        Returns:
            12-month ECL
        """
        
        exposure = Decimal(str(loan.get('outstanding_balance', 0)))
        pd_12m = Decimal(str(loan.get('pd_12m', loan.get('current_pd', 0.01))))
        lgd = Decimal(str(loan.get('lgd', 0.45)))  # Default 45%
        
        return self.calculate_ecl_single_loan(
            exposure, pd_12m, lgd, discount_rate, time_horizon_years=1
        )
    
    def calculate_stage2_ecl(
        self,
        loan: Dict,
        discount_rate: Decimal = Decimal('0.08')
    ) -> Decimal:
        """
        Calculate lifetime ECL for Stage 2 loan
        
        Stage 2: Lifetime ECL (not yet credit-impaired)
        Requires lifetime PD curve or approximation
        
        Args:
            loan: Loan dictionary
            discount_rate: Discount rate
            
        Returns:
            Lifetime ECL
        """
        
        exposure = Decimal(str(loan.get('outstanding_balance', 0)))
        pd_lifetime = Decimal(str(loan.get('pd_lifetime', loan.get('current_pd', 0.05))))
        lgd = Decimal(str(loan.get('lgd', 0.45)))
        
        # Approximate lifetime as remaining term (or use weighted average life)
        remaining_term_years = loan.get('remaining_term_years', 5)
        
        return self.calculate_ecl_single_loan(
            exposure, pd_lifetime, lgd, discount_rate, time_horizon_years=remaining_term_years
        )
    
    def calculate_stage3_ecl(
        self,
        loan: Dict,
        discount_rate: Decimal = Decimal('0.08')
    ) -> Decimal:
        """
        Calculate lifetime ECL for Stage 3 loan (credit-impaired)
        
        Stage 3: Lifetime ECL with higher PD (often 100% or near-100%)
        
        Args:
            loan: Loan dictionary
            discount_rate: Discount rate
            
        Returns:
            Lifetime ECL (often close to full exposure × LGD)
        """
        
        exposure = Decimal(str(loan.get('outstanding_balance', 0)))
        # Stage 3 typically has very high PD
        pd_lifetime = Decimal(str(loan.get('pd_lifetime', 0.90)))
        lgd = Decimal(str(loan.get('lgd', 0.45)))
        
        remaining_term_years = loan.get('remaining_term_years', 3)
        
        return self.calculate_ecl_single_loan(
            exposure, pd_lifetime, lgd, discount_rate, time_horizon_years=remaining_term_years
        )
    
    def calculate_portfolio_ecl(
        self,
        portfolio_df: pd.DataFrame,
        discount_rate: float = 0.08
    ) -> pd.DataFrame:
        """
        Calculate ECL for entire loan portfolio
        
        Args:
            portfolio_df: DataFrame with loan portfolio (must include stage)
            discount_rate: Discount rate for PV
            
        Returns:
            DataFrame with ECL provisions added
        """
        
        # Ensure portfolio is staged
        if 'stage' not in portfolio_df.columns:
            portfolio_df = self.staging_engine.classify_portfolio(portfolio_df)
        
        discount_decimal = Decimal(str(discount_rate))
        
        # Calculate ECL based on stage
        def calc_ecl_row(row):
            loan_dict = row.to_dict()
            stage = row['stage']
            
            if stage == 'Stage 1':
                return float(self.calculate_stage1_ecl(loan_dict, discount_decimal))
            elif stage == 'Stage 2':
                return float(self.calculate_stage2_ecl(loan_dict, discount_decimal))
            elif stage == 'Stage 3':
                return float(self.calculate_stage3_ecl(loan_dict, discount_decimal))
            else:
                return 0.0
        
        portfolio_df['ecl_provision'] = portfolio_df.apply(calc_ecl_row, axis=1)
        
        # Calculate coverage ratio
        portfolio_df['coverage_ratio_pct'] = (
            portfolio_df['ecl_provision'] / portfolio_df['outstanding_balance'] * 100
        ).round(2)
        
        return portfolio_df
    
    def generate_ecl_summary(self, portfolio_df: pd.DataFrame) -> Dict:
        """
        Generate ECL summary report
        
        Args:
            portfolio_df: Portfolio with ECL provisions
            
        Returns:
            Summary dictionary
        """
        
        if 'ecl_provision' not in portfolio_df.columns:
            raise ValueError("Portfolio must have ECL provisions calculated")
        
        total_exposure = portfolio_df['outstanding_balance'].sum()
        total_ecl = portfolio_df['ecl_provision'].sum()
        
        # Summary by stage
        stage_summary = portfolio_df.groupby('stage').agg({
            'loan_id': 'count',
            'outstanding_balance': 'sum',
            'ecl_provision': 'sum'
        }).rename(columns={
            'loan_id': 'loan_count',
            'outstanding_balance': 'total_exposure',
            'ecl_provision': 'total_ecl'
        })
        
        stage_summary['coverage_ratio_pct'] = (
            stage_summary['total_ecl'] / stage_summary['total_exposure'] * 100
        ).round(2)
        
        summary = {
            'total_loans': int(len(portfolio_df)),
            'total_exposure': float(total_exposure),
            'total_ecl_provision': float(total_ecl),
            'overall_coverage_ratio_pct': round(float(total_ecl / total_exposure * 100), 2),
            'by_stage': {}
        }
        
        for stage in ['Stage 1', 'Stage 2', 'Stage 3']:
            if stage in stage_summary.index:
                row = stage_summary.loc[stage]
                summary['by_stage'][stage] = {
                    'loan_count': int(row['loan_count']),
                    'total_exposure': float(row['total_exposure']),
                    'total_ecl': float(row['total_ecl']),
                    'coverage_ratio_pct': float(row['coverage_ratio_pct']),
                    'pct_of_total_ecl': round(float(row['total_ecl'] / total_ecl * 100), 2)
                }
            else:
                summary['by_stage'][stage] = {
                    'loan_count': 0,
                    'total_exposure': 0.0,
                    'total_ecl': 0.0,
                    'coverage_ratio_pct': 0.0,
                    'pct_of_total_ecl': 0.0
                }
        
        return summary
    
    def generate_journal_entries(self, total_ecl: Decimal, previous_ecl: Decimal = Decimal('0')) -> Dict:
        """
        Generate journal entries for ECL provision
        
        Args:
            total_ecl: Total ECL provision required
            previous_ecl: Previous period ECL provision
            
        Returns:
            Journal entry dictionary
        """
        
        movement = total_ecl - previous_ecl
        
        if movement > 0:
            # Increase in provision
            entry = {
                'description': 'Increase in ECL provision',
                'entries': [
                    {
                        'account': 'Credit Loss Expense (P&L)',
                        'account_type': 'Expense',
                        'dr': float(movement),
                        'cr': 0,
                        'narration': 'IFRS 9 ECL provision increase'
                    },
                    {
                        'account': 'Allowance for Credit Losses',
                        'account_type': 'Contra Asset',
                        'dr': 0,
                        'cr': float(movement),
                        'narration': 'ECL provision adjustment'
                    }
                ]
            }
        elif movement < 0:
            # Decrease in provision (write-back)
            entry = {
                'description': 'Decrease in ECL provision (write-back)',
                'entries': [
                    {
                        'account': 'Allowance for Credit Losses',
                        'account_type': 'Contra Asset',
                        'dr': float(abs(movement)),
                        'cr': 0,
                        'narration': 'ECL provision write-back'
                    },
                    {
                        'account': 'Credit Loss Expense (P&L)',
                        'account_type': 'Expense',
                        'dr': 0,
                        'cr': float(abs(movement)),
                        'narration': 'IFRS 9 ECL provision decrease'
                    }
                ]
            }
        else:
            entry = {
                'description': 'No change in ECL provision',
                'entries': []
            }
        
        return entry
    
    def generate_disclosure_data(
        self,
        portfolio_df: pd.DataFrame,
        summary: Dict,
        reporting_date: str
    ) -> Dict:
        """
        Generate IFRS 9 disclosure data
        
        Args:
            portfolio_df: Portfolio with ECL
            summary: ECL summary
            reporting_date: Reporting date string
            
        Returns:
            Disclosure dictionary
        """
        
        disclosure = {
            'reporting_date': reporting_date,
            'accounting_standard': 'IFRS 9',
            'summary': summary,
            'credit_risk_management': {
                'staging_criteria': {
                    'stage_1': '12-month ECL - No significant increase in credit risk',
                    'stage_2': 'Lifetime ECL - Significant increase in credit risk (SICR)',
                    'stage_3': 'Lifetime ECL - Credit-impaired'
                },
                'sicr_indicators': [
                    'Days past due >= 30 days',
                    'Probability of default doubled since origination',
                    'Credit rating downgrade >= 3 notches',
                    'Forbearance or restructuring',
                    'Watchlist status'
                ],
                'default_definition': 'DPD >= 90 days or bankruptcy or declared default'
            },
            'key_assumptions': {
                'discount_rate': '8% per annum',
                'lgd_assumption': '45% (Loss Given Default)',
                'time_horizon_stage1': '12 months',
                'time_horizon_stage2_3': 'Remaining life of loan'
            }
        }
        
        return disclosure
    
    def calculate_full_ifrs9_ecl(
        self,
        portfolio_df: pd.DataFrame,
        discount_rate: float = 0.08,
        previous_ecl: float = 0.0,
        reporting_date: str = None
    ) -> Dict:
        """
        Complete IFRS 9 ECL calculation
        
        Args:
            portfolio_df: Loan portfolio DataFrame
            discount_rate: Discount rate for PV
            previous_ecl: Previous period ECL (for movement analysis)
            reporting_date: Reporting date
            
        Returns:
            Complete ECL calculation results
        """
        
        if reporting_date is None:
            reporting_date = datetime.now().strftime('%Y-%m-%d')
        
        # Stage classification
        portfolio_classified = self.staging_engine.classify_portfolio(portfolio_df.copy())
        
        # ECL calculation
        portfolio_with_ecl = self.calculate_portfolio_ecl(portfolio_classified, discount_rate)
        
        # Summary
        summary = self.generate_ecl_summary(portfolio_with_ecl)
        
        # Journal entries
        total_ecl_decimal = Decimal(str(summary['total_ecl_provision']))
        previous_ecl_decimal = Decimal(str(previous_ecl))
        journal_entries = self.generate_journal_entries(total_ecl_decimal, previous_ecl_decimal)
        
        # Disclosure data
        disclosure = self.generate_disclosure_data(portfolio_with_ecl, summary, reporting_date)
        
        return {
            'portfolio_detail': portfolio_with_ecl,
            'summary': summary,
            'journal_entries': journal_entries,
            'disclosure_data': disclosure,
            'movement_analysis': {
                'opening_ecl': previous_ecl,
                'closing_ecl': summary['total_ecl_provision'],
                'movement': summary['total_ecl_provision'] - previous_ecl,
                'movement_pct': round((summary['total_ecl_provision'] - previous_ecl) / previous_ecl * 100, 2) if previous_ecl > 0 else 0
            },
            'calculation_metadata': {
                'calculation_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'reporting_date': reporting_date,
                'standard': 'IFRS 9',
                'discount_rate': discount_rate
            }
        }
    
    def export_to_json(self, results: Dict, filename: str):
        """Export results to JSON"""
        results_copy = results.copy()
        if 'portfolio_detail' in results_copy:
            results_copy['portfolio_detail'] = results_copy['portfolio_detail'].to_dict(orient='records')
        
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(results_copy, f, indent=2, ensure_ascii=False)
        
        print(f"Results exported to: {filename}")


# Example usage
if __name__ == "__main__":
    # Sample loan portfolio with PD, LGD, and term data
    portfolio = pd.DataFrame([
        {
            'loan_id': 'L001',
            'borrower_name': 'Company A',
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
            'is_default': False
        },
        {
            'loan_id': 'L002',
            'borrower_name': 'Company B',
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
            'is_default': False
        },
        {
            'loan_id': 'L003',
            'borrower_name': 'Company C',
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
            'is_default': True
        },
        {
            'loan_id': 'L004',
            'borrower_name': 'Company D',
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
            'is_default': False
        }
    ])
    
    calc = IFRS9ECLCalculator()
    results = calc.calculate_full_ifrs9_ecl(
        portfolio, 
        discount_rate=0.08, 
        previous_ecl=50000.0
    )
    
    print("="*80)
    print("IFRS 9 EXPECTED CREDIT LOSS (ECL) CALCULATION")
    print("="*80)
    
    print("\n1. PORTFOLIO DETAIL (with ECL)")
    print(results['portfolio_detail'][['loan_id', 'borrower_name', 'outstanding_balance', 'stage', 'ecl_provision', 'coverage_ratio_pct']].to_string(index=False))
    
    print("\n2. ECL SUMMARY")
    print(f"   Total Exposure: ${results['summary']['total_exposure']:,.2f}")
    print(f"   Total ECL Provision: ${results['summary']['total_ecl_provision']:,.2f}")
    print(f"   Overall Coverage Ratio: {results['summary']['overall_coverage_ratio_pct']:.2f}%")
    
    print("\n3. ECL BY STAGE")
    for stage, data in results['summary']['by_stage'].items():
        if data['loan_count'] > 0:
            print(f"   {stage}:")
            print(f"     Loans: {data['loan_count']}")
            print(f"     Exposure: ${data['total_exposure']:,.2f}")
            print(f"     ECL: ${data['total_ecl']:,.2f}")
            print(f"     Coverage: {data['coverage_ratio_pct']:.2f}%")
    
    print("\n4. ECL MOVEMENT ANALYSIS")
    print(f"   Opening ECL: ${results['movement_analysis']['opening_ecl']:,.2f}")
    print(f"   Closing ECL: ${results['movement_analysis']['closing_ecl']:,.2f}")
    print(f"   Movement: ${results['movement_analysis']['movement']:,.2f}")
    
    print("\n5. JOURNAL ENTRY")
    if results['journal_entries']['entries']:
        print(f"   {results['journal_entries']['description']}")
        for entry in results['journal_entries']['entries']:
            dr_str = f"${entry['dr']:,.2f}" if entry['dr'] > 0 else ""
            cr_str = f"${entry['cr']:,.2f}" if entry['cr'] > 0 else ""
            print(f"   {entry['account']:<40} Dr: {dr_str:>15} Cr: {cr_str:>15}")

