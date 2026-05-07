"""
IFRS 9 Expected Credit Loss (ECL) Calculator
Calculate ECL provisions for Stage 1, 2, and 3 loans
"""

import pandas as pd
import numpy as np
import uuid
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional, Tuple
import json
import os

from ifrs9_staging import IFRS9StagingEngine, LoanStage
from macro_sensitivity_config import get_sensitivity


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

    def apply_macro_overlay(
        self,
        base_pd: Decimal,
        gdp_growth: float = 0.0,
        unemployment: float = 0.0,
        interest_rate: float = 0.0,
    ) -> Decimal:
        """
        Apply a simple forward-looking macro overlay to PD.
        - Each 1% GDP drop increases PD by ~15%
        - Each 1% unemployment adds ~8%
        - Each 1% interest-rate adds ~3%
        """
        # Keep multipliers bounded to avoid unstable outputs.
        gdp_s = Decimal(str(get_sensitivity("gdp_sensitivity")))
        unemp_s = Decimal(str(get_sensitivity("unemployment_sensitivity")))
        rate_s = Decimal(str(get_sensitivity("interest_rate_sensitivity")))
        gdp_adjustment = max(Decimal('0.20'), Decimal('1') + (Decimal(str(-gdp_growth)) * gdp_s))
        unemployment_adjustment = max(Decimal('0.20'), Decimal('1') + (Decimal(str(unemployment)) * unemp_s))
        interest_adjustment = max(Decimal('0.20'), Decimal('1') + (Decimal(str(interest_rate)) * rate_s))
        adjusted = base_pd * gdp_adjustment * unemployment_adjustment * interest_adjustment
        return min(Decimal('1'), max(Decimal('0'), adjusted))
    
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
        discount_rate: Decimal = Decimal('0.08'),
        macro: Dict = None
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
        if macro:
            pd_12m = self.apply_macro_overlay(
                pd_12m,
                float(macro.get('gdp_growth', 0) or 0),
                float(macro.get('unemployment', 0) or 0),
                float(macro.get('interest_rate', 0) or 0),
            )
        lgd = Decimal(str(loan.get('lgd', 0.45)))  # Default 45%
        
        return self.calculate_ecl_single_loan(
            exposure, pd_12m, lgd, discount_rate, time_horizon_years=1
        )
    
    def calculate_stage2_ecl(
        self,
        loan: Dict,
        discount_rate: Decimal = Decimal('0.08'),
        macro: Dict = None
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
        if macro:
            pd_lifetime = self.apply_macro_overlay(
                pd_lifetime,
                float(macro.get('gdp_growth', 0) or 0),
                float(macro.get('unemployment', 0) or 0),
                float(macro.get('interest_rate', 0) or 0),
            )
        lgd = Decimal(str(loan.get('lgd', 0.45)))
        
        # Approximate lifetime as remaining term (or use weighted average life)
        remaining_term_years = loan.get('remaining_term_years', 5)
        
        return self.calculate_ecl_single_loan(
            exposure, pd_lifetime, lgd, discount_rate, time_horizon_years=remaining_term_years
        )
    
    def calculate_stage3_ecl(
        self,
        loan: Dict,
        discount_rate: Decimal = Decimal('0.08'),
        macro: Dict = None
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
        if macro:
            pd_lifetime = self.apply_macro_overlay(
                pd_lifetime,
                float(macro.get('gdp_growth', 0) or 0),
                float(macro.get('unemployment', 0) or 0),
                float(macro.get('interest_rate', 0) or 0),
            )
        lgd = Decimal(str(loan.get('lgd', 0.45)))
        
        remaining_term_years = loan.get('remaining_term_years', 3)
        
        return self.calculate_ecl_single_loan(
            exposure, pd_lifetime, lgd, discount_rate, time_horizon_years=remaining_term_years
        )
    
    def calculate_portfolio_ecl(
        self,
        portfolio_df: pd.DataFrame,
        discount_rate: float = 0.08,
        macro: Dict = None
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
                return float(self.calculate_stage1_ecl(loan_dict, discount_decimal, macro))
            elif stage == 'Stage 2':
                return float(self.calculate_stage2_ecl(loan_dict, discount_decimal, macro))
            elif stage == 'Stage 3':
                return float(self.calculate_stage3_ecl(loan_dict, discount_decimal, macro))
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


class IFRS9ClassificationEngine:
    """IFRS 9 classification & measurement (business model + SPPI + EIR)."""

    _HOLD_TO_COLLECT_INDICATORS = frozenset(
        {
            "hold_to_maturity",
            "contractual_cash_flows_only",
            "infrequent_sales",
            "no_trading_intent",
        }
    )
    _HOLD_COLLECT_SELL_INDICATORS = frozenset(
        {
            "liquidity_management",
            "frequent_sales",
            "available_for_sale_intent",
            "benchmark_performance",
        }
    )

    @staticmethod
    def _normalize_annual_rate(rate: Optional[float]) -> Optional[float]:
        if rate is None:
            return None
        r = float(rate)
        if r > 1.0:
            r = r / 100.0
        return r

    @staticmethod
    def _assess_business_model(
        indicators: List[str],
    ) -> Tuple[str, int, int]:
        ind = set(indicators or [])
        htc = len(ind & IFRS9ClassificationEngine._HOLD_TO_COLLECT_INDICATORS)
        htcs = len(ind & IFRS9ClassificationEngine._HOLD_COLLECT_SELL_INDICATORS)
        htc_ok = htc >= 2
        htcs_ok = htcs >= 2
        if htc_ok and not htcs_ok:
            return "HOLD_TO_COLLECT", htc, htcs
        if htcs_ok and not htc_ok:
            return "HOLD_TO_COLLECT_AND_SELL", htc, htcs
        if htc_ok and htcs_ok:
            return "HOLD_TO_COLLECT_AND_SELL", htc, htcs
        return "OTHER", htc, htcs

    @staticmethod
    def _business_model_label(bm: str) -> str:
        return {
            "HOLD_TO_COLLECT": "Hold to collect contractual cash flows",
            "HOLD_TO_COLLECT_AND_SELL": "Hold to collect and sell",
            "OTHER": "Other (trading / residual)",
        }.get(bm, bm)

    def _run_sppi(
        self, inp: Dict[str, Any]
    ) -> Tuple[bool, List[str]]:
        sppi_pass = True
        reasons: List[str] = []
        features = list(inp.get("sppi_features") or [])
        prep_ok = bool(inp.get("prepayment_penalty_reasonable", True))

        for feat in features:
            if feat == "leverage":
                sppi_pass = False
                reasons.append("Leveraged returns not SPPI")
            elif feat == "convertible":
                sppi_pass = False
                reasons.append("Equity conversion not SPPI")
            elif feat == "equity_linked":
                sppi_pass = False
                reasons.append("Equity-linked returns not SPPI")
            elif feat == "inverse_floating":
                sppi_pass = False
                reasons.append("Inverse floater not SPPI")
            elif feat == "non_recourse":
                pass
            elif feat == "contractual_linkage":
                sppi_pass = False
                reasons.append(
                    "Contractual linkage to non-SPPI instrument fails test"
                )
            elif feat == "prepayment_option":
                if not prep_ok:
                    sppi_pass = False
                    reasons.append(
                        "Prepayment penalty not reasonable compensation"
                    )
        return sppi_pass, reasons

    @staticmethod
    def _eir_newton(
        issue_price: float,
        face_value: float,
        nominal_annual: float,
        term_months: int,
    ) -> float:
        coupon = face_value * (nominal_annual / 12.0)
        cash_flows: List[float] = []
        for m in range(1, term_months + 1):
            if m < term_months:
                cash_flows.append(coupon)
            else:
                cash_flows.append(coupon + face_value)

        def npv(r: float) -> float:
            s = -issue_price
            for m, cf in enumerate(cash_flows, start=1):
                s += cf / ((1.0 + r) ** m)
            return s

        def dnpv(r: float) -> float:
            s = 0.0
            for m, cf in enumerate(cash_flows, start=1):
                s += -m * cf / ((1.0 + r) ** (m + 1))
            return s

        r = max(nominal_annual / 12.0, 1e-8)
        for _ in range(100):
            f = npv(r)
            if abs(f) < 1e-9:
                break
            df = dnpv(r)
            if abs(df) < 1e-14:
                break
            step = f / df
            r = r - step
            if r <= 0:
                r = 1e-8
        return r

    @staticmethod
    def _amortised_schedule(
        opening: float,
        eir_monthly: float,
        face_value: float,
        nominal_annual: float,
        term_months: int,
        max_periods: int = 12,
    ) -> List[Dict[str, Any]]:
        coupon = face_value * (nominal_annual / 12.0)
        rows: List[Dict[str, Any]] = []
        bal = opening
        n = min(max_periods, term_months)
        for period in range(1, n + 1):
            interest = bal * eir_monthly
            if period < term_months:
                cash = coupon
            else:
                cash = coupon + face_value
            closing = bal + interest - cash
            rows.append(
                {
                    "period": period,
                    "opening_balance": round(bal, 2),
                    "interest_income": round(interest, 2),
                    "cash_received": round(cash, 2),
                    "closing_balance": round(closing, 2),
                }
            )
            bal = closing
        return rows

    def _confidence(
        self,
        inp: Dict[str, Any],
        business_model: str,
        htc: int,
        htcs: int,
        sppi_pass: bool,
        sppi_failure_reasons: List[str],
    ) -> str:
        features = set(inp.get("sppi_features") or [])
        if "non_recourse" in features and sppi_pass:
            return "LOW"
        if "prepayment_option" in features and sppi_pass:
            return "MEDIUM"
        if htc >= 2 and htcs >= 2:
            return "MEDIUM"
        if (htc == 2 and htcs <= 1) or (htcs == 2 and htc <= 1):
            if htc >= 3 or htcs >= 3:
                return "HIGH"
            return "MEDIUM"
        if htc >= 3 or htcs >= 3:
            return "HIGH"
        if business_model != "OTHER" and sppi_pass:
            return "HIGH"
        return "MEDIUM"

    def _audit_risk(
        self,
        measurement: str,
        sppi_pass: bool,
        fair_value_option: bool,
    ) -> str:
        if fair_value_option:
            return "HIGH"
        if measurement == "FVTPL" and not sppi_pass:
            return "HIGH"
        if measurement == "FVTPL":
            return "MEDIUM"
        if measurement == "FVOCI":
            return "MEDIUM"
        return "LOW"

    def _claude_explanation(self, prompt: str) -> str:
        key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not key:
            return ""
        try:
            import anthropic

            client = anthropic.Anthropic(api_key=key)
            res = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=600,
                temperature=0.2,
                messages=[{"role": "user", "content": prompt}],
            )
            return (res.content[0].text if res.content else "").strip()
        except Exception:
            return ""

    def _fallback_explanation(
        self,
        inp: Dict[str, Any],
        business_model: str,
        sppi_pass: bool,
        sppi_failure_reasons: List[str],
        measurement_label: str,
        ecl_applies: bool,
    ) -> str:
        name = inp.get("instrument_name") or "Instrument"
        p1 = (
            f"Under IFRS 9.4.1.2, the business model for {name} is assessed as "
            f"{self._business_model_label(business_model)}. This reflects how the "
            f"portfolio is managed and whether cash flows arise from collecting "
            f"contractual amounts, sales, or a combination thereof."
        )
        p2 = (
            f"The SPPI test (IFRS 9.4.1.2(b)) is {'passed' if sppi_pass else 'failed'}. "
        )
        if sppi_failure_reasons:
            p2 += f"Features giving rise to failure include: {', '.join(sppi_failure_reasons)}. "
        else:
            p2 += "Contractual cash flows are solely payments of principal and interest on principal outstanding. "
        p3 = (
            f"Accordingly, the instrument is measured at {measurement_label}. "
            f"Expected credit loss {'applies' if ecl_applies else 'does not apply'} under IFRS 9.5 "
            f"for this measurement category, with corresponding P&L and balance sheet impacts."
        )
        return f"{p1}\n\n{p2}\n\n{p3}"

    def classify(self, inp: Dict[str, Any]) -> Dict[str, Any]:
        business_model, htc, htcs = self._assess_business_model(
            list(inp.get("business_model_indicators") or [])
        )
        bm_label = self._business_model_label(business_model)
        sppi_pass, sppi_failure_reasons = self._run_sppi(inp)

        measurement = "FVTPL"
        measurement_label = "Fair Value through Profit or Loss"
        ecl_applies = False
        p_and_l_impact = (
            "All fair value changes through P&L. No ECL applies."
        )
        balance_sheet = "Fair value on balance sheet"

        if (
            business_model == "HOLD_TO_COLLECT"
            and sppi_pass
        ):
            measurement = "AMORTISED_COST"
            measurement_label = "Amortised Cost"
            ecl_applies = True
            p_and_l_impact = (
                "Interest income (EIR) + ECL charge"
            )
            balance_sheet = "Gross loans minus ECL allowance"

        elif (
            business_model == "HOLD_TO_COLLECT_AND_SELL"
            and sppi_pass
        ):
            measurement = "FVOCI"
            measurement_label = (
                "Fair Value through Other Comprehensive Income"
            )
            ecl_applies = True
            p_and_l_impact = (
                "Interest income (EIR) + ECL charge in P&L. Fair value changes "
                "in OCI (recycled on derecognition)"
            )
            balance_sheet = "Fair value on balance sheet"

        elif business_model == "OTHER" or not sppi_pass:
            measurement = "FVTPL"
            measurement_label = "Fair Value through Profit or Loss"
            ecl_applies = False
            p_and_l_impact = (
                "All fair value changes through P&L. No ECL applies."
            )
            balance_sheet = "Fair value on balance sheet"

        fair_value_option = bool(inp.get("fair_value_option_elected"))
        if fair_value_option:
            measurement = "FVTPL"
            measurement_label = (
                "Fair Value through Profit or Loss (Fair Value Option)"
            )
            ecl_applies = False
            p_and_l_impact = (
                "All changes through P&L. ECL does not apply (FVO elected)."
            )
            balance_sheet = "Fair value on balance sheet"

        if inp.get("business_model_changed"):
            reclassification_permitted = True
            reclassification_note = (
                "Reclassification required when business model changes. "
                "Apply prospectively from reclassification date. Prior periods "
                "not restated (IFRS 9.4.4.1)."
            )
        else:
            reclassification_permitted = False
            reclassification_note = (
                "Reclassification not permitted except on business model change. "
                "Instrument-level election not allowed."
            )

        eir_monthly: Optional[float] = None
        eir_annual: Optional[float] = None
        amortised_cost_schedule: List[Dict[str, Any]] = []
        eir_note = ""

        if measurement in ("AMORTISED_COST", "FVOCI"):
            nr = inp.get("nominal_rate")
            ip = inp.get("issue_price")
            fv = inp.get("face_value")
            tm = inp.get("term_months")
            if (
                nr is not None
                and ip is not None
                and fv is not None
                and tm is not None
            ):
                nominal = self._normalize_annual_rate(float(nr))
                issue_price = float(ip)
                face_value = float(fv)
                term_months = int(tm)
                if (
                    nominal is not None
                    and issue_price > 0
                    and face_value > 0
                    and term_months > 0
                ):
                    eir_monthly = self._eir_newton(
                        issue_price, face_value, nominal, term_months
                    )
                    eir_annual = (1.0 + eir_monthly) ** 12 - 1.0
                    amortised_cost_schedule = self._amortised_schedule(
                        issue_price,
                        eir_monthly,
                        face_value,
                        nominal,
                        term_months,
                        12,
                    )
            if not amortised_cost_schedule:
                eir_note = (
                    "Provide issue price, face value, and term to calculate EIR schedule"
                )
                if eir_annual is None and nr is not None:
                    na = self._normalize_annual_rate(float(nr))
                    eir_annual = float(na) if na is not None else None
        else:
            eir_annual = None
            amortised_cost_schedule = []

        classification_confidence = self._confidence(
            inp, business_model, htc, htcs, sppi_pass, sppi_failure_reasons
        )
        audit_risk = self._audit_risk(
            measurement, sppi_pass, fair_value_option
        )

        expl_prompt = f"""You are an IFRS 9 Classification expert.
Write a technical classification memo for this financial instrument.

Instrument: {inp.get('instrument_name')}
Business Model: {business_model}
SPPI Result: {'Pass' if sppi_pass else 'Fail'}
SPPI Failures: {sppi_failure_reasons}
Classification: {measurement_label}
ECL Applies: {ecl_applies}

Write 3 paragraphs:
Para 1: Business model assessment and why
Para 2: SPPI test result and key features
Para 3: Classification conclusion and accounting implications

Big 4 technical memo style.
Reference IFRS 9 paragraph numbers.
Max 200 words.
"""
        explanation = self._claude_explanation(expl_prompt)
        if not explanation:
            explanation = self._fallback_explanation(
                inp,
                business_model,
                sppi_pass,
                sppi_failure_reasons,
                measurement_label,
                ecl_applies,
            )

        return {
            "instrument_name": str(inp.get("instrument_name") or ""),
            "business_model": business_model,
            "business_model_label": bm_label,
            "sppi_pass": sppi_pass,
            "sppi_failure_reasons": sppi_failure_reasons,
            "measurement": measurement,
            "measurement_label": measurement_label,
            "ecl_applies": ecl_applies,
            "p_and_l_impact": p_and_l_impact,
            "balance_sheet": balance_sheet,
            "fair_value_option_elected": fair_value_option,
            "reclassification_permitted": reclassification_permitted,
            "reclassification_note": reclassification_note,
            "eir_annual": round(eir_annual, 6) if eir_annual is not None else None,
            "eir_monthly": round(eir_monthly, 10) if eir_monthly is not None else None,
            "amortised_cost_schedule": amortised_cost_schedule,
            "eir_note": eir_note,
            "explanation": explanation,
            "classification_confidence": classification_confidence,
            "audit_risk": audit_risk,
        }


class IFRS9MacroOverlayEngine:
    """Forward-looking macro scenario overlay for IFRS 9 ECL (IFRS 9.5.5.17)."""

    @staticmethod
    def _scenario_dict(sc: Any) -> Dict[str, float]:
        if hasattr(sc, "model_dump"):
            d = sc.model_dump()
        elif isinstance(sc, dict):
            d = sc
        else:
            d = dict(sc)
        return {
            "gdp_growth": float(d.get("gdp_growth", 0) or 0),
            "unemployment_rate": float(d.get("unemployment_rate", 0) or 0),
            "interest_rate": float(d.get("interest_rate", 0) or 0),
            "property_price_change": float(d.get("property_price_change", 0) or 0),
            "credit_spread": float(d.get("credit_spread", 0) or 0),
            "probability": float(d.get("probability", 0) or 0),
        }

    @staticmethod
    def _adjustment_pp(scenario: Dict[str, float], base_ref: Dict[str, float]) -> float:
        adjustment = 0.0
        gdp_delta = scenario["gdp_growth"] - base_ref["gdp_growth"]
        adjustment -= gdp_delta * 0.15
        unemp_delta = scenario["unemployment_rate"] - base_ref["unemployment_rate"]
        adjustment += unemp_delta * 0.20
        rate_delta = scenario["interest_rate"] - base_ref["interest_rate"]
        adjustment += rate_delta * 0.10
        prop_delta = scenario["property_price_change"] - base_ref["property_price_change"]
        adjustment -= prop_delta * 0.05
        spread_delta = scenario["credit_spread"] - base_ref["credit_spread"]
        adjustment += spread_delta * 0.08
        return adjustment

    def _scenario_pd_decimal(
        self, base_pd_decimal: float, scenario: Dict[str, float], base_ref: Dict[str, float]
    ) -> float:
        adj_pp = self._adjustment_pp(scenario, base_ref)
        d = base_pd_decimal + adj_pp / 100.0
        return max(0.001, min(0.99, d))

    def _claude_narrative(self, prompt: str) -> str:
        key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not key:
            return ""
        try:
            import anthropic

            client = anthropic.Anthropic(api_key=key)
            res = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=900,
                temperature=0.2,
                messages=[{"role": "user", "content": prompt}],
            )
            return (res.content[0].text if res.content else "").strip()
        except Exception:
            return ""

    def _fallback_narrative(
        self,
        portfolio_name: str,
        base_pd_pct: float,
        base_pd_adj_pct: float,
        pit: float,
        pwe: float,
        impact: float,
        overlay_pct: float,
        direction: str,
        bs: Dict[str, float],
        os_: Dict[str, float],
        ps: Dict[str, float],
    ) -> str:
        p1 = (
            f"This memo summarises the forward-looking macroeconomic overlay for {portfolio_name} "
            f"under IFRS 9.5.5.17. Three scenarios (optimistic, base, pessimistic) incorporate GDP, "
            f"unemployment, interest rates, property prices, and credit spreads, anchored to the base case."
        )
        p2 = (
            f"Base PD is {base_pd_pct:.2f}% ({base_pd_adj_pct:.2f}% macro-adjusted in the base scenario). "
            f"Point-in-time ECL is ${pit:,.0f} versus probability-weighted ECL of ${pwe:,.0f}, "
            f"an impact of ${impact:,.0f} ({overlay_pct:.1f}% {direction}). "
            f"Scenario weightings are {os_['probability']*100:.0f}% / {bs['probability']*100:.0f}% / {ps['probability']*100:.0f}%."
        )
        p3 = (
            "Key risks include correlation of macro factors and model uncertainty. "
            "IFRS 9.5.5.17 compliance: multiple forward-looking scenarios with probability-weighted ECL are applied; "
            "gaps may remain where historical data are thin or overlays are not calibrated to internal stress tests."
        )
        return f"{p1}\n\n{p2}\n\n{p3}"

    def _overlay_adequacy(
        self,
        opt: Dict[str, float],
        bs: Dict[str, float],
        ps: Dict[str, float],
        pd_opt: float,
        pd_base: float,
        pd_pess: float,
        prob_weighted_ecl: float,
        base_pd_pct: float,
        lgd_pct: float,
        ead: float,
    ) -> str:
        if base_pd_pct <= 0 or lgd_pct <= 0 or ead <= 0:
            return "INSUFFICIENT"
        gdps = [opt["gdp_growth"], bs["gdp_growth"], ps["gdp_growth"]]
        unemps = [opt["unemployment_rate"], bs["unemployment_rate"], ps["unemployment_rate"]]
        if max(gdps) - min(gdps) < 0.75 and max(unemps) - min(unemps) < 0.75:
            return "REVIEW_REQUIRED"
        if (max(pd_opt, pd_base, pd_pess) - min(pd_opt, pd_base, pd_pess)) * 100 < 0.05:
            return "REVIEW_REQUIRED"
        if prob_weighted_ecl <= 0:
            return "INSUFFICIENT"
        return "ADEQUATE"

    def calculate(self, inp: Dict[str, Any]) -> Dict[str, Any]:
        portfolio_name = str(inp.get("portfolio_name") or "Portfolio")
        base_pd_pct = float(inp.get("base_pd") or 0)
        lgd_pct = float(inp.get("lgd") or 0)
        ead = float(inp.get("ead") or 0)

        base_pd_decimal = base_pd_pct / 100.0
        lgd_decimal = lgd_pct / 100.0

        bs = self._scenario_dict(inp.get("base_scenario"))
        os_ = self._scenario_dict(inp.get("optimistic_scenario"))
        ps = self._scenario_dict(inp.get("pessimistic_scenario"))

        psum = os_["probability"] + bs["probability"] + ps["probability"]
        if abs(psum - 1.0) > 0.01:
            raise ValueError("Probabilities must sum to 100%")

        base_ref = bs

        pd_opt_d = self._scenario_pd_decimal(base_pd_decimal, os_, base_ref)
        pd_base_d = self._scenario_pd_decimal(base_pd_decimal, bs, base_ref)
        pd_pess_d = self._scenario_pd_decimal(base_pd_decimal, ps, base_ref)

        ecl_opt = pd_opt_d * lgd_decimal * ead
        ecl_base = pd_base_d * lgd_decimal * ead
        ecl_pess = pd_pess_d * lgd_decimal * ead

        prob_weighted_ecl = (
            ecl_opt * os_["probability"]
            + ecl_base * bs["probability"]
            + ecl_pess * ps["probability"]
        )

        point_in_time_ecl = base_pd_decimal * lgd_decimal * ead
        macro_overlay_impact = prob_weighted_ecl - point_in_time_ecl
        if point_in_time_ecl > 0:
            overlay_pct = macro_overlay_impact / point_in_time_ecl * 100.0
        else:
            overlay_pct = 0.0

        if macro_overlay_impact > 1e-9:
            overlay_direction = "INCREASE"
        elif macro_overlay_impact < -1e-9:
            overlay_direction = "DECREASE"
        else:
            overlay_direction = "NEUTRAL"

        def scen_block(
            scen: Dict[str, float], pd_d: float, ecl: float
        ) -> Dict[str, Any]:
            pd_pct = pd_d * 100.0
            pd_chg_pp = (pd_d - base_pd_decimal) * 100.0
            macro_vars = {
                "gdp_growth": scen["gdp_growth"],
                "unemployment_rate": scen["unemployment_rate"],
                "interest_rate": scen["interest_rate"],
                "property_price_change": scen["property_price_change"],
                "credit_spread": scen["credit_spread"],
            }
            return {
                "pd_adjusted": round(pd_pct, 6),
                "pd_adjustment": round(pd_chg_pp, 6),
                "ecl": round(ecl, 2),
                "probability": scen["probability"],
                "macro_variables": macro_vars,
            }

        scenarios_out = {
            "base": scen_block(bs, pd_base_d, ecl_base),
            "optimistic": scen_block(os_, pd_opt_d, ecl_opt),
            "pessimistic": scen_block(ps, pd_pess_d, ecl_pess),
        }

        pd_range = {
            "optimistic": scenarios_out["optimistic"]["pd_adjusted"],
            "base": scenarios_out["base"]["pd_adjusted"],
            "pessimistic": scenarios_out["pessimistic"]["pd_adjusted"],
        }
        ecl_range = {
            "optimistic": scenarios_out["optimistic"]["ecl"],
            "base": scenarios_out["base"]["ecl"],
            "pessimistic": scenarios_out["pessimistic"]["ecl"],
        }

        # Hold other macro inputs at base; vary GDP from (base − 3%) to (base + 3%) in 1% steps (7 points).
        gdp_sens: List[Dict[str, Any]] = []
        base_gdp = bs["gdp_growth"]
        for step in range(-3, 4):
            tmp = dict(bs)
            tmp["gdp_growth"] = base_gdp + float(step)
            pd_g = self._scenario_pd_decimal(base_pd_decimal, tmp, base_ref)
            ecl_g = pd_g * lgd_decimal * ead
            gdp_sens.append(
                {"gdp": round(tmp["gdp_growth"], 4), "pd": round(pd_g * 100, 6), "ecl": round(ecl_g, 2)}
            )

        unemp_sens: List[Dict[str, Any]] = []
        for u in range(2, 13, 2):
            tmp = dict(bs)
            tmp["unemployment_rate"] = float(u)
            pd_u = self._scenario_pd_decimal(base_pd_decimal, tmp, base_ref)
            ecl_u = pd_u * lgd_decimal * ead
            unemp_sens.append(
                {"unemployment": float(u), "pd": round(pd_u * 100, 6), "ecl": round(ecl_u, 2)}
            )

        sensitivity_analysis = {"gdp": gdp_sens, "unemployment": unemp_sens}

        loans = inp.get("loans") or []
        staging_migrations = 0
        migration_ead = 0.0
        delta_pess = pd_pess_d - base_pd_decimal

        for loan in loans:
            if isinstance(loan, dict):
                st = int(loan.get("stage") or loan.get("Stage") or 1)
                le = float(
                    loan.get("ead")
                    or loan.get("EAD")
                    or loan.get("outstanding_balance")
                    or 0
                )
                lp = loan.get("base_pd")
                if lp is None:
                    lp = loan.get("pd")
                if lp is None:
                    lp = loan.get("pd_12m") if st == 1 else loan.get("pd_lifetime")
                if lp is None:
                    lp = base_pd_pct
                loan_pd_d = float(lp) / 100.0
            else:
                continue
            adj = loan_pd_d + delta_pess
            at_risk = False
            if st == 1 and adj > 0.20:
                at_risk = True
            if st == 2 and adj > 0.50:
                at_risk = True
            if at_risk:
                staging_migrations += 1
                migration_ead += le

        macro_variables_used = [
            "GDP growth",
            "Unemployment",
            "Interest rates",
            "Property prices",
            "Credit spreads",
        ]

        overlay_adequacy = self._overlay_adequacy(
            os_, bs, ps, pd_opt_d, pd_base_d, pd_pess_d, prob_weighted_ecl, base_pd_pct, lgd_pct, ead
        )

        narr_prompt = f"""You are an IFRS 9 macro overlay expert at a Big 4 bank audit practice.

Write a forward-looking macro overlay memo.

Portfolio: {portfolio_name}
Base PD: {base_pd_pct:.2f}%
Macro-adjusted PD (base): {pd_base_d*100:.2f}%
Point-in-time ECL: ${point_in_time_ecl:,.0f}
Probability-weighted ECL: ${prob_weighted_ecl:,.0f}
Overlay impact: ${macro_overlay_impact:,.0f} ({overlay_pct:.1f}% {overlay_direction})

Scenarios:
Base ({bs['probability']*100:.0f}%):
  GDP {bs['gdp_growth']}%, Unemployment {bs['unemployment_rate']}%
Optimistic ({os_['probability']*100:.0f}%):
  GDP {os_['gdp_growth']}%, Unemployment {os_['unemployment_rate']}%
Pessimistic ({ps['probability']*100:.0f}%):
  GDP {ps['gdp_growth']}%, Unemployment {ps['unemployment_rate']}%

Write 3 paragraphs:
Para 1: Macro environment and scenario summary
Para 2: Impact on PD and ECL by scenario
Para 3: Key risks and overlay adequacy assessment

IFRS 9.5.5.17 compliance assessment:
Does this approach meet forward-looking requirements? Note any gaps.

Style: Big 4 bank audit memo. Max 250 words.
"""
        narrative = self._claude_narrative(narr_prompt)
        if not narrative:
            narrative = self._fallback_narrative(
                portfolio_name,
                base_pd_pct,
                pd_base_d * 100.0,
                point_in_time_ecl,
                prob_weighted_ecl,
                macro_overlay_impact,
                overlay_pct,
                overlay_direction,
                bs,
                os_,
                ps,
            )

        return {
            "portfolio_name": portfolio_name,
            "base_pd_original": base_pd_pct,
            "lgd": lgd_pct,
            "ead": ead,
            "scenarios": scenarios_out,
            "point_in_time_ecl": round(point_in_time_ecl, 2),
            "probability_weighted_ecl": round(prob_weighted_ecl, 2),
            "macro_overlay_impact": round(macro_overlay_impact, 2),
            "overlay_pct": round(overlay_pct, 4),
            "overlay_direction": overlay_direction,
            "pd_range": pd_range,
            "ecl_range": ecl_range,
            "sensitivity_analysis": sensitivity_analysis,
            "staging_migrations": staging_migrations,
            "migration_ead": round(migration_ead, 2),
            "ifrs9_compliance": {
                "forward_looking": True,
                "multiple_scenarios": True,
                "probability_weighted": True,
                "macro_variables_used": macro_variables_used,
            },
            "narrative": narrative,
            "overlay_adequacy": overlay_adequacy,
        }


class IFRS9ProvisionMatrixEngine:
    """IFRS 9.5.5.15 simplified provision matrix (ageing buckets × loss rates)."""

    _INDUSTRY_DEFAULTS: Dict[str, float] = {
        "Current": 0.005,
        "1-30 DPD": 0.02,
        "31-60 DPD": 0.05,
        "61-90 DPD": 0.10,
        "91-180 DPD": 0.20,
        ">180 DPD": 0.50,
    }

    _DEFAULT_BUCKETS: List[Dict[str, Any]] = [
        {"label": "Current", "days_from": 0, "days_to": 0},
        {"label": "1-30 DPD", "days_from": 1, "days_to": 30},
        {"label": "31-60 DPD", "days_from": 31, "days_to": 60},
        {"label": "61-90 DPD", "days_from": 61, "days_to": 90},
        {"label": "91-180 DPD", "days_from": 91, "days_to": 180},
        {"label": ">180 DPD", "days_from": 181, "days_to": 9999},
    ]

    @staticmethod
    def _norm_label(s: str) -> str:
        return str(s or "").strip()

    @staticmethod
    def _find_bucket_for_dpd(
        buckets: List[Dict[str, Any]], dpd: int
    ) -> Dict[str, Any]:
        for b in buckets:
            if int(b["days_from"]) <= int(dpd) <= int(b["days_to"]):
                return b
        return buckets[-1]

    @staticmethod
    def _match_bucket_label(
        buckets: List[Dict[str, Any]], label: str
    ) -> Optional[Dict[str, Any]]:
        n = IFRS9ProvisionMatrixEngine._norm_label(label).lower()
        for b in buckets:
            if IFRS9ProvisionMatrixEngine._norm_label(b["label"]).lower() == n:
                return b
        for b in buckets:
            if n in IFRS9ProvisionMatrixEngine._norm_label(b["label"]).lower():
                return b
        return None

    def _claude_memo(self, system: str, user: str) -> str:
        key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not key:
            return ""
        try:
            import anthropic

            client = anthropic.Anthropic(api_key=key)
            res = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=500,
                temperature=0.2,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
            return (res.content[0].text if res.content else "").strip()
        except Exception:
            return ""

    def calculate(self, inp: Dict[str, Any]) -> Dict[str, Any]:
        portfolio_name = str(inp.get("portfolio_name") or "Provision Matrix")
        reporting_date = str(
            inp.get("reporting_date") or datetime.now().strftime("%Y-%m-%d")
        )
        receivable_type = str(inp.get("receivable_type") or "trade_receivables")

        custom = inp.get("custom_buckets")
        if custom and isinstance(custom, list) and len(custom) > 0:
            buckets_def = [
                {
                    "label": self._norm_label(c.get("label", "")),
                    "days_from": int(c.get("days_from", 0)),
                    "days_to": int(c.get("days_to", 0)),
                }
                for c in custom
                if c.get("label")
            ]
        else:
            buckets_def = [dict(b) for b in self._DEFAULT_BUCKETS]

        label_order = [b["label"] for b in buckets_def]
        bucket_state: Dict[str, Dict[str, Any]] = {
            bl: {
                "label": bl,
                "days_from": next(
                    x["days_from"] for x in buckets_def if x["label"] == bl
                ),
                "days_to": next(x["days_to"] for x in buckets_def if x["label"] == bl),
                "gross_amount": 0.0,
                "count": 0,
                "receivables": [],
            }
            for bl in label_order
        }

        receivables = inp.get("receivables") or []
        bucket_totals = inp.get("bucket_totals") or []

        if isinstance(receivables, list) and len(receivables) > 0:
            for raw in receivables:
                if not isinstance(raw, dict):
                    continue
                dpd = int(raw.get("days_past_due", 0) or 0)
                bdef = self._find_bucket_for_dpd(buckets_def, dpd)
                bl = bdef["label"]
                st = bucket_state[bl]
                amt = float(raw.get("gross_amount", 0) or 0)
                st["gross_amount"] += amt
                st["count"] += 1
                st["receivables"].append(
                    {
                        "invoice_id": str(raw.get("invoice_id", "")),
                        "customer": str(raw.get("customer", "")),
                        "gross_amount": amt,
                        "days_past_due": dpd,
                        "currency": str(raw.get("currency", "USD") or "USD"),
                    }
                )
        elif isinstance(bucket_totals, list) and len(bucket_totals) > 0:
            for row in bucket_totals:
                if not isinstance(row, dict):
                    continue
                lbl = self._norm_label(str(row.get("label", "")))
                matched = self._match_bucket_label(buckets_def, lbl)
                if not matched:
                    continue
                bl = matched["label"]
                st = bucket_state[bl]
                st["gross_amount"] += float(row.get("gross_amount", 0) or 0)
        else:
            raise ValueError("Provide receivables or bucket_totals with amounts")

        loss_rates_in: Dict[str, float] = {}
        lr_raw = inp.get("loss_rates")
        if isinstance(lr_raw, dict):
            for k, v in lr_raw.items():
                try:
                    m = self._match_bucket_label(buckets_def, str(k))
                    if m:
                        loss_rates_in[m["label"]] = float(v)
                except (TypeError, ValueError):
                    continue

        hist_rows = inp.get("historical_data") or []
        hist_by_label: Dict[str, float] = {}
        if isinstance(hist_rows, list):
            for h in hist_rows:
                if not isinstance(h, dict):
                    continue
                lbl = self._norm_label(str(h.get("bucket_label", "")))
                bal = float(h.get("historical_balance", 0) or 0)
                wo = float(h.get("historical_writeoffs", 0) or 0)
                mt = self._match_bucket_label(buckets_def, lbl)
                if mt and bal > 0:
                    hist_by_label[mt["label"].lower()] = wo / bal

        bucket_total_hlr: Dict[str, float] = {}
        if isinstance(bucket_totals, list):
            for row in bucket_totals:
                if not isinstance(row, dict):
                    continue
                lbl = self._norm_label(str(row.get("label", "")))
                matched = self._match_bucket_label(buckets_def, lbl)
                if not matched:
                    continue
                hlr = row.get("historical_loss_rate")
                if hlr is not None:
                    try:
                        bucket_total_hlr[matched["label"]] = float(hlr)
                    except (TypeError, ValueError):
                        pass

        def base_rate_for(label: str) -> Tuple[float, str]:
            """Returns (rate, source_key: loss_rates|bucket_hlr|historical|industry)."""
            lk = label.lower()
            if label in loss_rates_in:
                return loss_rates_in[label], "loss_rates"
            if label in bucket_total_hlr:
                return bucket_total_hlr[label], "bucket_hlr"
            if lk in hist_by_label:
                return hist_by_label[lk], "historical"
            d = self._INDUSTRY_DEFAULTS.get(label)
            if d is not None:
                return d, "industry"
            for k, v in self._INDUSTRY_DEFAULTS.items():
                if k.lower() == lk:
                    return v, "industry"
            return 0.0, "industry"

        fla = float(inp.get("macro_adjustment_factor", 0.0) or 0.0)
        if fla != 0.0:
            fla_note = (
                f"Forward-looking adjustment of {fla * 100:+.1f}% applied per IFRS 9.5.5.17"
            )
        else:
            fla_note = (
                "No forward-looking adjustment applied. Consider macro overlay for full "
                "IFRS 9 compliance."
            )

        default_note = (
            "Industry default rates applied. Replace with entity-specific historical "
            "loss rates for IFRS 9 compliance."
        )

        bucket_results: List[Dict[str, Any]] = []
        for bl in label_order:
            st = bucket_state[bl]
            gross = float(st["gross_amount"])
            br, src = base_rate_for(bl)
            adj_lr = br * (1.0 + fla)
            adj_lr = max(0.0, min(1.0, adj_lr))
            prov = gross * adj_lr
            net_amt = gross - prov
            cov = (prov / gross * 100.0) if gross > 0 else 0.0
            rec_list = st["receivables"] if st["receivables"] else []
            bucket_results.append(
                {
                    "label": bl,
                    "days_from": int(st["days_from"]),
                    "days_to": int(st["days_to"]),
                    "count": int(st["count"]),
                    "gross_amount": round(gross, 2),
                    "base_loss_rate": round(br, 6),
                    "fla_applied": fla,
                    "adjusted_loss_rate": round(adj_lr, 6),
                    "provision": round(prov, 2),
                    "net_amount": round(net_amt, 2),
                    "coverage_pct": round(cov, 4),
                    "receivables": rec_list,
                }
            )

        total_gross = sum(b["gross_amount"] for b in bucket_results)
        total_provision = sum(b["provision"] for b in bucket_results)
        total_net = total_gross - total_provision
        overall_coverage = (
            (total_provision / total_gross * 100.0) if total_gross > 0 else 0.0
        )
        weighted_lr = (
            (total_provision / total_gross) if total_gross > 0 else 0.0
        )
        total_count = sum(b["count"] for b in bucket_results)

        using_defaults = True
        if loss_rates_in or hist_rows or bucket_total_hlr:
            using_defaults = False
        else:
            for bl in label_order:
                br, src = base_rate_for(bl)
                if bucket_state[bl]["gross_amount"] > 0 and src != "industry":
                    using_defaults = False
                    break

        total_gross_pos = total_gross > 0
        concentration_risk = "LOW"
        concentration_note = ""
        for b in bucket_results:
            if b["label"] == "Current":
                continue
            if total_gross_pos:
                pct = b["gross_amount"] / total_gross * 100.0
                if pct > 30.0:
                    concentration_risk = "HIGH"
                    concentration_note = (
                        f"{b['label']} represents {pct:.1f}% of total receivables."
                    )
                    break
        if concentration_risk != "HIGH":
            for b in bucket_results:
                if b["label"] == "Current" or not total_gross_pos:
                    continue
                pct = b["gross_amount"] / total_gross * 100.0
                if pct > 15.0:
                    concentration_risk = "MEDIUM"
                    concentration_note = (
                        f"Aged receivables in {b['label']} are {pct:.1f}% of gross portfolio."
                    )
                    break

        if overall_coverage > 10.0:
            bad_debt_risk = "HIGH"
        elif overall_coverage > 5.0:
            bad_debt_risk = "MEDIUM"
        else:
            bad_debt_risk = "LOW"

        hr = None
        for b in bucket_results:
            if b["gross_amount"] <= 0:
                continue
            if hr is None or b["adjusted_loss_rate"] > hr["adjusted_loss_rate"]:
                hr = b
        if hr is None:
            hr = bucket_results[0] if bucket_results else {}
        highest_risk_bucket = {
            "label": str(hr.get("label", "")),
            "gross_amount": float(hr.get("gross_amount", 0) or 0),
            "provision": float(hr.get("provision", 0) or 0),
            "adjusted_loss_rate": float(hr.get("adjusted_loss_rate", 0) or 0),
        }

        journal_entries: List[Dict[str, Any]] = [
            {
                "description": "ECL provision — provision matrix approach per IFRS 9.5.5.15",
                "dr_account": "Bad Debt Expense (P&L)",
                "cr_account": "Allowance for Doubtful Debts",
                "amount": round(total_provision, 2),
            }
        ]
        wo = float(inp.get("writeoffs_this_period", 0) or 0)
        if wo > 0:
            journal_entries.append(
                {
                    "description": "Write-off of irrecoverable receivables per IFRS 9.5.4.4",
                    "dr_account": "Allowance for Doubtful Debts",
                    "cr_account": "Trade Receivables",
                    "amount": round(wo, 2),
                }
            )

        system = "You are an IFRS 9 provision matrix expert at a Big 4 firm."
        user_prompt = f"""
IFRS 9 Provision Matrix memo.
Portfolio: {portfolio_name}
Total receivables: ${total_gross:,.0f}
Total provision: ${total_provision:,.0f}
Coverage ratio: {overall_coverage:.1f}%
Bad debt risk: {bad_debt_risk}
Concentration risk: {concentration_risk}
{concentration_note}
Forward-looking: {fla_note}
Default rates used: {using_defaults}
Highest risk bucket: {highest_risk_bucket['label']}
  Gross: ${highest_risk_bucket['gross_amount']:,.0f}
  Rate: {highest_risk_bucket['adjusted_loss_rate'] * 100:.1f}%

Write 2 paragraphs:
Para 1: Portfolio quality and provision adequacy.
Para 2: Key risks, concentration, recommendations.
Note IFRS 9.5.5.15 compliance.
Big 4 memo style. Max 150 words.
"""
        narrative = self._claude_memo(system, user_prompt)
        if not narrative:
            narrative = (
                f"The {portfolio_name} portfolio has total gross receivables of "
                f"${total_gross:,.0f} with an ECL provision of ${total_provision:,.0f} "
                f"representing a coverage ratio of {overall_coverage:.1f}%. "
                f"Bad debt risk is assessed as {bad_debt_risk}. {fla_note}"
            )

        return {
            "portfolio_name": portfolio_name,
            "reporting_date": reporting_date,
            "receivable_type": receivable_type,
            "buckets": bucket_results,
            "totals": {
                "gross_amount": round(total_gross, 2),
                "total_provision": round(total_provision, 2),
                "net_amount": round(total_net, 2),
                "overall_coverage_pct": round(overall_coverage, 4),
                "weighted_loss_rate": round(weighted_lr, 6),
                "count": int(total_count),
            },
            "concentration_risk": concentration_risk,
            "concentration_note": concentration_note,
            "bad_debt_risk": bad_debt_risk,
            "using_defaults": using_defaults,
            "default_rates_note": default_note if using_defaults else "",
            "fla_applied": fla,
            "fla_note": fla_note,
            "journal_entries": journal_entries,
            "ifrs9_simplified_approach": True,
            "ifrs9_reference": "IFRS 9.5.5.15",
            "narrative": narrative,
            "highest_risk_bucket": highest_risk_bucket,
        }


class IFRS9MasterSummaryEngine:
    """Aggregates IFRS 9 core ECL and optional module outputs into one master report."""

    _SEVERITY_ORDER = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}

    @staticmethod
    def _loan_rows_core(core: Dict[str, Any]) -> List[Dict[str, Any]]:
        raw = core.get("loans") or []
        out: List[Dict[str, Any]] = []
        for i, l in enumerate(raw):
            if not isinstance(l, dict):
                continue
            st = l.get("stage", l.get("Stage", 1))
            try:
                st_i = int(st)
            except (TypeError, ValueError):
                st_i = 1
            ead = float(l.get("ead", l.get("EAD", 0)) or 0)
            out.append({"stage": st_i, "ead": ead, "ecl": float(l.get("ecl", 0) or 0)})
        return out

    def _normalize_stage_summary(self, core: Dict[str, Any]) -> Dict[str, Dict[str, float]]:
        loans = self._loan_rows_core(core)
        ss = core.get("stage_summary")
        if isinstance(ss, dict) and "stage1" in ss:

            def one(k: str) -> Dict[str, float]:
                b = ss.get(k) or {}
                return {
                    "count": float(b.get("count", 0) or 0),
                    "ead": float(b.get("ead", 0) or 0),
                    "ecl": float(b.get("ecl", 0) or 0),
                }

            return {"stage1": one("stage1"), "stage2": one("stage2"), "stage3": one("stage3")}

        if isinstance(ss, list) and len(ss) >= 1:
            out: Dict[str, Dict[str, float]] = {}
            for idx, stn in enumerate([1, 2, 3]):
                block = ss[idx] if idx < len(ss) else {}
                out[f"stage{stn}"] = {
                    "count": float(block.get("loan_count", block.get("count", 0)) or 0),
                    "ead": float(block.get("ead", 0) or 0),
                    "ecl": float(block.get("ecl", 0) or 0),
                }
            return out

        out = {
            "stage1": {"count": 0.0, "ead": 0.0, "ecl": 0.0},
            "stage2": {"count": 0.0, "ead": 0.0, "ecl": 0.0},
            "stage3": {"count": 0.0, "ead": 0.0, "ecl": 0.0},
        }
        for st in (1, 2, 3):
            sl = [x for x in loans if int(x.get("stage", 1) or 1) == st]
            key = f"stage{st}"
            out[key]["count"] = float(len(sl))
            out[key]["ead"] = sum(float(x.get("ead", 0) or 0) for x in sl)
            out[key]["ecl"] = sum(float(x.get("ecl", 0) or 0) for x in sl)
        return out

    def _total_ead(self, core: Dict[str, Any]) -> float:
        v = core.get("ead_used")
        if v is not None:
            try:
                return float(v)
            except (TypeError, ValueError):
                pass
        v2 = core.get("total_ead")
        if v2 is not None:
            try:
                return float(v2)
            except (TypeError, ValueError):
                pass
        loans = self._loan_rows_core(core)
        return sum(float(x.get("ead", 0) or 0) for x in loans)

    def _total_ecl(self, core: Dict[str, Any]) -> float:
        for k in ("applicable_ecl", "total_ecl"):
            v = core.get(k)
            if v is not None:
                try:
                    return float(v)
                except (TypeError, ValueError):
                    pass
        st = self._normalize_stage_summary(core)
        return sum(float(st[f"stage{i}"]["ecl"]) for i in (1, 2, 3))

    @staticmethod
    def _disclosure_notes_present(core: Dict[str, Any]) -> bool:
        dn = core.get("disclosure_notes")
        if isinstance(dn, str):
            return bool(dn.strip())
        if isinstance(dn, dict):
            return any(str(v or "").strip() for v in dn.values())
        return False

    def _claude_master_narrative(self, prompt: str) -> str:
        key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not key:
            return ""
        try:
            import anthropic

            client = anthropic.Anthropic(api_key=key)
            res = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=900,
                temperature=0.2,
                messages=[{"role": "user", "content": prompt}],
            )
            return (res.content[0].text if res.content else "").strip()
        except Exception:
            return ""

    def _fallback_ai_narrative(
        self,
        portfolio_name: str,
        entity_name: str,
        reporting_date: str,
        total_ead: float,
        total_ecl: float,
        coverage_ratio: float,
        ecl_12m: float,
        ecl_lifetime: float,
        classification: str,
        macro_ecl: Optional[float],
        n_flags: int,
        n_high: int,
        dominant_stage: str,
    ) -> str:
        p1 = (
            f"This memorandum summarises the IFRS 9 expected credit loss position for {portfolio_name}"
            + (f" ({entity_name})" if entity_name else "")
            + f" as at {reporting_date}. Total exposure at default is ${total_ead:,.0f} with a "
            f"recognised ECL allowance of ${total_ecl:,.0f}, implying a portfolio coverage ratio of "
            f"{coverage_ratio:.1f}%. Stage 1 (12-month) ECL is ${ecl_12m:,.0f} and Stage 2/3 lifetime "
            f"ECL is ${ecl_lifetime:,.0f}; the dominant concentration by stage is {dominant_stage}."
        )
        p2 = (
            f"Classification is recorded as {classification}. "
        )
        if macro_ecl is not None:
            p2 += (
                f"Macro scenario weighting indicates a probability-weighted ECL of ${macro_ecl:,.0f}. "
            )
        p2 += (
            "Judgements cover staging, PD/LGD calibration, forward-looking information, and "
            "whether simplified or general approaches apply across the portfolio."
        )
        p3 = (
            f"Risk monitoring identified {n_flags} flag(s) ({n_high} HIGH). "
            "We recommend resolving HIGH items before financial statement sign-off, validating "
            "Stage 3 positions against IFRS 9.5.4, and documenting forward-looking macro assumptions "
            "per IFRS 9.5.5.17."
        )
        return f"{p1}\n\n{p2}\n\n{p3}"

    def generate(self, data: Dict[str, Any]) -> Dict[str, Any]:
        portfolio_name = str(data.get("portfolio_name") or "IFRS 9 Portfolio")
        entity_name = str(data.get("entity_name") or "")
        reporting_date = str(
            data.get("reporting_date") or datetime.now().strftime("%Y-%m-%d")
        )
        core = data.get("core_results") or {}
        if not isinstance(core, dict):
            core = {}
        cls_r = data.get("classification_result")
        if not isinstance(cls_r, dict):
            cls_r = None
        macro_r = data.get("macro_overlay_result")
        if not isinstance(macro_r, dict):
            macro_r = None
        prov_r = data.get("provision_matrix_result")
        if not isinstance(prov_r, dict):
            prov_r = None

        core_ok = bool(core)
        loans = self._loan_rows_core(core)
        st_sum = self._normalize_stage_summary(core)
        total_ead = self._total_ead(core)
        total_ecl = self._total_ecl(core)
        coverage_ratio = (total_ecl / total_ead * 100.0) if total_ead > 1e-12 else 0.0

        w_pd = float(core.get("weighted_avg_pd", 0) or 0)
        w_lgd = float(core.get("weighted_avg_lgd", core.get("lgd_used", 0)) or 0)

        ecl_12m = float(core.get("ecl_12m", st_sum["stage1"]["ecl"]) or 0)
        ecl_lifetime = float(
            core.get("ecl_lifetime", st_sum["stage2"]["ecl"] + st_sum["stage3"]["ecl"]) or 0
        )

        dom_stage = max(
            ((1, st_sum["stage1"]["ecl"]), (2, st_sum["stage2"]["ecl"]), (3, st_sum["stage3"]["ecl"])),
            key=lambda x: x[1],
        )[0]
        dominant_stage = f"Stage {dom_stage}"

        currency = str(core.get("currency") or "USD")

        portfolio_overview = {
            "portfolio_name": portfolio_name,
            "entity_name": entity_name,
            "reporting_date": reporting_date,
            "total_exposure_ead": round(total_ead, 2),
            "total_ecl_provision": round(total_ecl, 2),
            "coverage_ratio": round(coverage_ratio, 4),
            "weighted_avg_pd": round(w_pd, 6),
            "loan_count": int(len(loans)) if loans else int(core.get("loan_count", 0) or 0),
            "currency": currency,
        }

        ecl_summary = {
            "stage1": {
                "count": int(st_sum["stage1"]["count"]),
                "ead": round(float(st_sum["stage1"]["ead"]), 2),
                "ecl": round(float(st_sum["stage1"]["ecl"]), 2),
                "ecl_type": "12-month",
                "assessed": core_ok,
            },
            "stage2": {
                "count": int(st_sum["stage2"]["count"]),
                "ead": round(float(st_sum["stage2"]["ead"]), 2),
                "ecl": round(float(st_sum["stage2"]["ecl"]), 2),
                "ecl_type": "Lifetime",
                "assessed": core_ok,
            },
            "stage3": {
                "count": int(st_sum["stage3"]["count"]),
                "ead": round(float(st_sum["stage3"]["ead"]), 2),
                "ecl": round(float(st_sum["stage3"]["ecl"]), 2),
                "ecl_type": "Lifetime",
                "assessed": core_ok,
            },
            "total_ecl": round(total_ecl, 2),
            "all_steps_complete": core_ok,
        }

        macro_pwe = None
        macro_impact = None
        if macro_r:
            macro_pwe = float(macro_r.get("probability_weighted_ecl", 0) or 0)
            macro_impact = float(macro_r.get("macro_overlay_impact", 0) or 0)

        prov_total = None
        if prov_r:
            totals = prov_r.get("totals") or {}
            if isinstance(totals, dict):
                prov_total = float(totals.get("total_provision", 0) or 0)

        classification_label = None
        ecl_applies_fin = None
        if cls_r:
            classification_label = str(
                cls_r.get("measurement_label") or cls_r.get("measurement") or ""
            ).strip() or None
            if cls_r.get("ecl_applies") is not None:
                ecl_applies_fin = bool(cls_r.get("ecl_applies"))

        financial_summary = {
            "total_ead": round(total_ead, 2),
            "total_ecl": round(total_ecl, 2),
            "ecl_12m": round(ecl_12m, 2),
            "ecl_lifetime": round(ecl_lifetime, 2),
            "coverage_ratio": round(coverage_ratio, 4),
            "pd_used": round(w_pd, 6),
            "lgd_used": round(w_lgd, 6),
            "macro_adjusted_ecl": round(macro_pwe, 2) if macro_r else None,
            "macro_overlay_impact": round(macro_impact, 2) if macro_r else None,
            "provision_matrix_ecl": round(prov_total, 2) if prov_total is not None else None,
            "classification": classification_label,
            "ecl_applies": ecl_applies_fin,
        }

        cls_measurement = str(cls_r.get("measurement", "")).strip().upper() if cls_r else ""
        cls_audit = str(cls_r.get("audit_risk", "")).strip().upper() if cls_r else ""
        cls_sppi = cls_r.get("sppi_pass") if cls_r else None
        cls_bm = cls_r.get("business_model") if cls_r else None

        macro_pit = float(macro_r.get("point_in_time_ecl", 0) or 0) if macro_r else None
        staging_mig = int(macro_r.get("staging_migrations", 0) or 0) if macro_r else 0

        prov_gross = None
        prov_cov = None
        prov_bad = str(prov_r.get("bad_debt_risk", "")).strip().upper() if prov_r else None
        prov_conc = str(prov_r.get("concentration_risk", "")).strip().upper() if prov_r else None
        prov_defaults = prov_r.get("using_defaults") if prov_r is not None else None
        if prov_r:
            totals = prov_r.get("totals") or {}
            if isinstance(totals, dict):
                prov_gross = float(totals.get("gross_amount", 0) or 0)
                prov_cov = float(totals.get("overall_coverage_pct", 0) or 0)

        assessments = {
            "ecl_staging": {
                "assessed": core_ok,
                "stage1_count": int(st_sum["stage1"]["count"]),
                "stage2_count": int(st_sum["stage2"]["count"]),
                "stage3_count": int(st_sum["stage3"]["count"]),
                "total_ecl": round(total_ecl, 2),
                "method": "PD × LGD × EAD",
            },
            "classification": {
                "assessed": bool(cls_r),
                "measurement": classification_label or "Not assessed",
                "ecl_applies": (bool(cls_r.get("ecl_applies")) if cls_r and cls_r.get("ecl_applies") is not None else None),
                "audit_risk": str(cls_r.get("audit_risk", "Not assessed") or "Not assessed") if cls_r else "Not assessed",
                "sppi_pass": cls_sppi,
            },
            "macro_overlay": {
                "assessed": bool(macro_r),
                "point_in_time_ecl": round(macro_pit, 2) if macro_pit is not None else None,
                "probability_weighted_ecl": round(macro_pwe, 2) if macro_r else None,
                "overlay_impact": round(float(macro_r.get("macro_overlay_impact", 0) or 0), 2) if macro_r else None,
                "overlay_direction": str(macro_r.get("overlay_direction", "") or "") if macro_r else None,
                "scenarios_used": 3 if macro_r else 0,
            },
            "provision_matrix": {
                "assessed": bool(prov_r),
                "total_gross": round(prov_gross, 2) if prov_gross is not None else None,
                "total_provision": round(prov_total, 2) if prov_total is not None else None,
                "coverage_pct": round(prov_cov, 4) if prov_cov is not None else None,
                "bad_debt_risk": prov_bad,
                "concentration_risk": prov_conc,
                "using_defaults": prov_defaults,
            },
        }

        risk_flags: List[Dict[str, str]] = []

        if core_ok and any(int(x.get("stage", 1) or 1) == 3 for x in loans):
            risk_flags.append(
                {
                    "severity": "HIGH",
                    "module": "ECL Staging",
                    "message": (
                        "Portfolio contains Stage 3 credit-impaired loans. Lifetime ECL applies. "
                        "Impairment disclosure required."
                    ),
                    "action_required": (
                        "Review Stage 3 loans for write-off assessment per IFRS 9.5.4"
                    ),
                }
            )

        if coverage_ratio > 5 and total_ead > 1e-9:
            risk_flags.append(
                {
                    "severity": "HIGH",
                    "module": "ECL Staging",
                    "message": (
                        f"Coverage ratio {coverage_ratio:.1f}% indicates elevated credit risk."
                    ),
                    "action_required": "Stress test ECL under pessimistic scenario",
                }
            )

        if cls_r and cls_measurement == "FVTPL" and cls_r.get("ecl_applies") is False:
            risk_flags.append(
                {
                    "severity": "MEDIUM",
                    "module": "Classification",
                    "message": (
                        "Instrument classified at FVTPL. ECL does not apply — fair value movements "
                        "captured in P&L instead."
                    ),
                    "action_required": (
                        "Confirm FVTPL treatment with auditors and document rationale"
                    ),
                }
            )

        if cls_r and cls_audit == "HIGH":
            risk_flags.append(
                {
                    "severity": "HIGH",
                    "module": "Classification",
                    "message": (
                        f"High audit risk classification: {classification_label or cls_measurement}. "
                        "Expect auditor challenge."
                    ),
                    "action_required": "Prepare detailed classification documentation",
                }
            )

        if cls_r and cls_sppi is False:
            risk_flags.append(
                {
                    "severity": "HIGH",
                    "module": "Classification",
                    "message": (
                        "SPPI test failed — instrument has non-standard cash flow features."
                    ),
                    "action_required": (
                        "Document SPPI failure reasons and confirm FVTPL treatment"
                    ),
                }
            )

        if macro_r:
            od = str(macro_r.get("overlay_direction", "") or "").upper()
            opct = float(macro_r.get("overlay_pct", 0) or 0)
            if od == "INCREASE" and abs(opct) > 15:
                risk_flags.append(
                    {
                        "severity": "HIGH",
                        "module": "Macro Overlay",
                        "message": (
                            f"Macro overlay increases ECL by {abs(opct):.1f}%. Adverse economic "
                            "conditions materially impact portfolio."
                        ),
                        "action_required": (
                            "Review pessimistic scenario assumptions with management"
                        ),
                    }
                )
            if staging_mig > 0:
                risk_flags.append(
                    {
                        "severity": "MEDIUM",
                        "module": "Macro Overlay",
                        "message": (
                            f"{staging_mig} loans may migrate to higher stage under pessimistic scenario."
                        ),
                        "action_required": (
                            "Monitor SICR triggers monthly during adverse conditions"
                        ),
                    }
                )

        if prov_r and prov_bad == "HIGH":
            risk_flags.append(
                {
                    "severity": "HIGH",
                    "module": "Provision Matrix",
                    "message": (
                        "High bad debt risk — coverage ratio exceeds 10% of gross receivables."
                    ),
                    "action_required": (
                        "Accelerate collections and review credit terms for aged debtors"
                    ),
                }
            )

        if prov_r and prov_conc == "HIGH":
            risk_flags.append(
                {
                    "severity": "MEDIUM",
                    "module": "Provision Matrix",
                    "message": "High concentration in aged receivables buckets.",
                    "action_required": (
                        "Review collection procedures for concentrated aged balances"
                    ),
                }
            )

        if prov_r and prov_defaults is True:
            risk_flags.append(
                {
                    "severity": "LOW",
                    "module": "Provision Matrix",
                    "message": (
                        "Industry default loss rates used. Entity-specific rates not applied."
                    ),
                    "action_required": (
                        "Update with historical write-off data for IFRS 9 compliance"
                    ),
                }
            )

        risk_flags.sort(
            key=lambda f: self._SEVERITY_ORDER.get(str(f.get("severity", "LOW")), 9)
        )

        def _item(note: str, ok: bool) -> Dict[str, str]:
            return {"item": note, "status": "complete" if ok else "incomplete"}

        comp_multi = bool(
            macro_r
            and (macro_r.get("ifrs9_compliance") or {}).get("multiple_scenarios")
        )
        comp_pwe = bool(macro_r and macro_r.get("probability_weighted_ecl") is not None)

        checklist = [
            _item("Portfolio data uploaded", core_ok),
            _item("ECL staging completed (Stage 1/2/3)", core_ok),
            _item("PD × LGD × EAD calculation verified", core_ok),
            _item("SICR indicators assessed", core_ok),
            _item("Classification & Measurement assessed", bool(cls_r)),
            _item(
                "SPPI test performed",
                bool(cls_r and cls_r.get("sppi_pass") is not None),
            ),
            _item(
                "Business model assessment documented",
                bool(cls_r and cls_bm),
            ),
            _item("Forward-looking macro overlay applied", bool(macro_r)),
            _item("Multiple economic scenarios assessed", comp_multi),
            _item("Probability-weighted ECL calculated", comp_pwe),
            _item("Provision matrix calculated", bool(prov_r)),
            _item(
                "Entity-specific loss rates applied",
                bool(prov_r and not prov_r.get("using_defaults", True)),
            ),
            _item("Journal entries generated", core_ok),
            _item(
                "IFRS 9 disclosure notes drafted",
                bool(core_ok and self._disclosure_notes_present(core)),
            ),
        ]

        total_items = len(checklist)
        complete_ct = sum(1 for c in checklist if c["status"] == "complete")
        score = round(100.0 * complete_ct / total_items, 2) if total_items else 0.0
        if score >= 85:
            level = "Ready"
        elif score >= 60:
            level = "Needs Review"
        else:
            level = "Incomplete"

        n_high = sum(1 for f in risk_flags if f.get("severity") == "HIGH")
        cl_str = classification_label or "Not assessed"
        macro_line = macro_pwe if macro_pwe is not None else 0.0

        narr_prompt = f"""You are an IFRS 9 senior audit partner at a Big 4 firm. Write an executive summary memo.

Portfolio: {portfolio_name}
Entity: {entity_name or 'N/A'}
Reporting Date: {reporting_date}
Total EAD: ${total_ead:,.0f}
Total ECL: ${total_ecl:,.0f}
Coverage Ratio: {coverage_ratio:.1f}%
Stage 1 ECL: ${ecl_12m:,.0f}
Stage 2/3 ECL: ${ecl_lifetime:,.0f}
Classification: {cl_str}
Macro-Adjusted ECL: ${macro_line:,.0f}
Risk Flags: {len(risk_flags)} flags ({n_high} HIGH)

Write exactly 3 paragraphs:
Para 1: Portfolio overview and ECL summary. Use actual numbers. State coverage ratio and dominant stage concentration.
Para 2: Key judgements and their impact. Classification assessment, macro overlay effect, and provision matrix findings.
Para 3: Outstanding risks and recommended actions before sign-off. Prioritise by severity. Reference IFRS 9 paragraphs.

Style: Big 4 senior partner memo. Professional, direct, specific. Max 300 words."""

        ai_narrative = self._claude_master_narrative(narr_prompt)
        if not ai_narrative:
            ai_narrative = self._fallback_ai_narrative(
                portfolio_name,
                entity_name,
                reporting_date,
                total_ead,
                total_ecl,
                coverage_ratio,
                ecl_12m,
                ecl_lifetime,
                cl_str,
                macro_pwe,
                len(risk_flags),
                n_high,
                dominant_stage,
            )

        return {
            "report_id": str(uuid.uuid4())[:8],
            "generated_at": datetime.now().isoformat(),
            "portfolio_name": portfolio_name,
            "entity_name": entity_name,
            "reporting_date": reporting_date,
            "portfolio_overview": portfolio_overview,
            "ecl_summary": ecl_summary,
            "financial_summary": financial_summary,
            "assessments": assessments,
            "risk_flags": risk_flags,
            "audit_readiness": {
                "score": score,
                "level": level,
                "checklist": checklist,
            },
            "ai_narrative": ai_narrative,
        }


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

