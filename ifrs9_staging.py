"""
IFRS 9 Loan Staging Engine
Classify loans into Stage 1/2/3 based on credit risk
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List
from enum import Enum


class LoanStage(Enum):
    """IFRS 9 loan staging"""
    STAGE_1 = "Stage 1"  # 12-month ECL
    STAGE_2 = "Stage 2"  # Lifetime ECL (not credit-impaired)
    STAGE_3 = "Stage 3"  # Lifetime ECL (credit-impaired)


class IFRS9StagingEngine:
    """
    Classify loans into IFRS 9 stages
    
    Stage 1: No significant increase in credit risk (12-month ECL)
    Stage 2: Significant increase in credit risk (Lifetime ECL)
    Stage 3: Credit-impaired (Lifetime ECL)
    
    IFRS 9 requires assessment of whether credit risk has increased
    significantly since initial recognition.
    """
    
    def __init__(self):
        # SICR thresholds (Significant Increase in Credit Risk)
        self.dpd_stage_2_threshold = 30  # Days past due
        self.dpd_stage_3_threshold = 90
        self.pd_increase_threshold = 2.0  # PD doubled since origination
        self.rating_downgrade_threshold = 3  # Notches
    
    def classify_loan(self, loan: Dict) -> LoanStage:
        """
        Classify individual loan into Stage 1/2/3
        
        Input loan dict should contain:
        - days_past_due: int
        - current_pd: float (probability of default)
        - origination_pd: float
        - current_rating: str
        - origination_rating: str
        - is_forbearance: bool
        - is_default: bool
        - is_bankruptcy: bool (optional)
        - is_watchlist: bool (optional)
        
        Args:
            loan: Dictionary with loan details
            
        Returns:
            LoanStage enum value
        """
        
        # Stage 3: Credit-impaired
        if self._is_stage_3(loan):
            return LoanStage.STAGE_3
        
        # Stage 2: Significant increase in credit risk
        if self._is_stage_2(loan):
            return LoanStage.STAGE_2
        
        # Stage 1: Performing
        return LoanStage.STAGE_1
    
    def _is_stage_3(self, loan: Dict) -> bool:
        """
        Stage 3 criteria (credit-impaired):
        - DPD >= 90 days
        - Declared default
        - Bankruptcy
        - Legal action
        
        Args:
            loan: Loan details
            
        Returns:
            True if loan is Stage 3
        """
        
        if loan.get('is_default', False):
            return True
        
        if loan.get('days_past_due', 0) >= self.dpd_stage_3_threshold:
            return True
        
        if loan.get('is_bankruptcy', False):
            return True
        
        if loan.get('is_legal_action', False):
            return True
        
        return False
    
    def _is_stage_2(self, loan: Dict) -> bool:
        """
        Stage 2 criteria (SICR - Significant Increase in Credit Risk):
        - DPD 30-89 days
        - PD has doubled since origination
        - Credit rating downgrade >= 3 notches
        - Forbearance/restructuring
        - Watchlist
        
        IFRS 9.5.5.3: If reasonable and supportable information indicating
        a significant increase in credit risk is available without undue
        cost or effort, the 30 days past due presumption can be rebutted.
        
        Args:
            loan: Loan details
            
        Returns:
            True if loan is Stage 2
        """
        
        # DPD-based SICR
        dpd = loan.get('days_past_due', 0)
        if self.dpd_stage_2_threshold <= dpd < self.dpd_stage_3_threshold:
            return True
        
        # PD increase (relative change)
        # If a macro-adjusted PD is provided, prefer it for SICR assessment.
        current_pd = loan.get('macro_adjusted_pd', loan.get('current_pd', 0))
        origination_pd = loan.get('origination_pd', 0)
        if origination_pd > 0 and current_pd >= (origination_pd * self.pd_increase_threshold):
            return True
        
        # Rating downgrade
        rating_change = self._calculate_rating_change(
            loan.get('origination_rating'), 
            loan.get('current_rating')
        )
        if rating_change >= self.rating_downgrade_threshold:
            return True
        
        # Forbearance/restructuring
        if loan.get('is_forbearance', False):
            return True
        
        # Watchlist
        if loan.get('is_watchlist', False):
            return True
        
        return False
    
    def _calculate_rating_change(self, orig_rating: str, current_rating: str) -> int:
        """
        Calculate notches of rating downgrade
        
        Rating scale: AAA, AA+, AA, AA-, A+, A, A-, BBB+, BBB, BBB-, BB+, BB, BB-, B+, B, B-, CCC, D
        
        Args:
            orig_rating: Original rating at origination
            current_rating: Current rating
            
        Returns:
            Number of notches downgraded (0 if upgraded or no change)
        """
        
        rating_scale = {
            'AAA': 1, 'AA+': 2, 'AA': 3, 'AA-': 4,
            'A+': 5, 'A': 6, 'A-': 7,
            'BBB+': 8, 'BBB': 9, 'BBB-': 10,
            'BB+': 11, 'BB': 12, 'BB-': 13,
            'B+': 14, 'B': 15, 'B-': 16,
            'CCC': 17, 'D': 18
        }
        
        if not orig_rating or not current_rating:
            return 0
        
        orig_score = rating_scale.get(orig_rating, 0)
        current_score = rating_scale.get(current_rating, 0)
        
        # Higher score = lower rating (downgrade)
        return max(0, current_score - orig_score)
    
    def classify_portfolio(self, portfolio_df: pd.DataFrame) -> pd.DataFrame:
        """
        Classify entire loan portfolio
        
        Args:
            portfolio_df: DataFrame with loan portfolio data
            
        Returns:
            DataFrame with added 'stage' and 'stage_number' columns
        """
        
        portfolio_df['stage'] = portfolio_df.apply(
            lambda row: self.classify_loan(row.to_dict()).value,
            axis=1
        )
        
        # Add numeric stage for easy filtering
        stage_map = {
            'Stage 1': 1,
            'Stage 2': 2,
            'Stage 3': 3
        }
        portfolio_df['stage_number'] = portfolio_df['stage'].map(stage_map)
        
        return portfolio_df
    
    def generate_staging_report(self, portfolio_df: pd.DataFrame) -> Dict:
        """
        Generate staging summary report
        
        Args:
            portfolio_df: Classified portfolio DataFrame
            
        Returns:
            Dictionary with staging statistics
        """
        
        if 'stage' not in portfolio_df.columns:
            portfolio_df = self.classify_portfolio(portfolio_df)
        
        stage_summary = portfolio_df.groupby('stage').agg({
            'loan_id': 'count',
            'outstanding_balance': 'sum'
        }).rename(columns={'loan_id': 'loan_count', 'outstanding_balance': 'total_exposure'})
        
        total_exposure = portfolio_df['outstanding_balance'].sum()
        total_loans = len(portfolio_df)
        
        report = {
            'total_loans': int(total_loans),
            'total_exposure': float(total_exposure),
            'by_stage': {}
        }
        
        for stage in ['Stage 1', 'Stage 2', 'Stage 3']:
            if stage in stage_summary.index:
                count = int(stage_summary.loc[stage, 'loan_count'])
                exposure = float(stage_summary.loc[stage, 'total_exposure'])
                report['by_stage'][stage] = {
                    'loan_count': count,
                    'total_exposure': exposure,
                    'pct_of_loans': round(count / total_loans * 100, 2),
                    'pct_of_exposure': round(exposure / total_exposure * 100, 2)
                }
            else:
                report['by_stage'][stage] = {
                    'loan_count': 0,
                    'total_exposure': 0.0,
                    'pct_of_loans': 0.0,
                    'pct_of_exposure': 0.0
                }
        
        return report


# Example usage
if __name__ == "__main__":
    # Sample loan portfolio
    portfolio = pd.DataFrame([
        {
            'loan_id': 'L001',
            'borrower_name': 'Company A',
            'outstanding_balance': 1000000,
            'days_past_due': 0,
            'current_pd': 0.02,
            'origination_pd': 0.01,
            'current_rating': 'A',
            'origination_rating': 'A',
            'is_forbearance': False,
            'is_default': False,
            'is_watchlist': False
        },
        {
            'loan_id': 'L002',
            'borrower_name': 'Company B',
            'outstanding_balance': 500000,
            'days_past_due': 45,
            'current_pd': 0.05,
            'origination_pd': 0.02,
            'current_rating': 'BBB',
            'origination_rating': 'A',
            'is_forbearance': False,
            'is_default': False,
            'is_watchlist': False
        },
        {
            'loan_id': 'L003',
            'borrower_name': 'Company C',
            'outstanding_balance': 750000,
            'days_past_due': 120,
            'current_pd': 0.80,
            'origination_pd': 0.03,
            'current_rating': 'D',
            'origination_rating': 'BBB',
            'is_forbearance': False,
            'is_default': True,
            'is_watchlist': False
        },
        {
            'loan_id': 'L004',
            'borrower_name': 'Company D',
            'outstanding_balance': 2000000,
            'days_past_due': 15,
            'current_pd': 0.01,
            'origination_pd': 0.01,
            'current_rating': 'AA',
            'origination_rating': 'AA',
            'is_forbearance': False,
            'is_default': False,
            'is_watchlist': False
        },
        {
            'loan_id': 'L005',
            'borrower_name': 'Company E',
            'outstanding_balance': 300000,
            'days_past_due': 35,
            'current_pd': 0.06,
            'origination_pd': 0.02,
            'current_rating': 'BB',
            'origination_rating': 'A',
            'is_forbearance': True,
            'is_default': False,
            'is_watchlist': True
        }
    ])
    
    staging_engine = IFRS9StagingEngine()
    classified_portfolio = staging_engine.classify_portfolio(portfolio)
    
    print("="*80)
    print("IFRS 9 LOAN STAGING CLASSIFICATION")
    print("="*80)
    print("\nLOAN PORTFOLIO")
    print(classified_portfolio[['loan_id', 'borrower_name', 'outstanding_balance', 'days_past_due', 'stage']].to_string(index=False))
    
    print("\n" + "="*80)
    print("STAGING SUMMARY")
    print("="*80)
    report = staging_engine.generate_staging_report(classified_portfolio)
    
    print(f"\nTotal Loans: {report['total_loans']}")
    print(f"Total Exposure: ${report['total_exposure']:,.2f}\n")
    
    for stage, data in report['by_stage'].items():
        print(f"{stage}:")
        print(f"  Loans: {data['loan_count']} ({data['pct_of_loans']:.1f}%)")
        print(f"  Exposure: ${data['total_exposure']:,.2f} ({data['pct_of_exposure']:.1f}%)")

