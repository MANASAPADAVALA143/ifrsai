import { normalizeAnnualRate } from './ifrs16-rates';

/** Fingerprint of financial inputs that affect IFRS 16 measurement. */
export function financialInputsFingerprint(form: Record<string, unknown>): string {
  return JSON.stringify({
    discountRate: String(form.discountRate ?? ''),
    baseRentAmount: String(form.baseRentAmount ?? ''),
    startDate: String(form.startDate ?? form.effectiveDate ?? ''),
    endDate: String(form.endDate ?? ''),
    lease_term_months: String(form.lease_term_months ?? ''),
    rentFreeMonths: String(form.rentFreeMonths ?? '0'),
    nonLeaseComponent: String(form.nonLeaseComponent ?? '0'),
    paymentType: String(form.paymentType ?? 'Arrears'),
    legalFees: String(form.legalFees ?? '0'),
    brokerageFees: String(form.brokerageFees ?? '0'),
    otherInitialDirectCosts: String(form.otherInitialDirectCosts ?? '0'),
    cashIncentive: String(form.cashIncentive ?? form.leaseIncentives ?? '0'),
    escalationValue: String(form.escalationValue ?? '0'),
    escalationType: String(form.escalationType ?? ''),
    nonLeaseComponent: String(form.nonLeaseComponent ?? '0'),
    cpiAdjustments: String(form.cpiAdjustments ?? false),
    baseIndexValue: String(form.baseIndexValue ?? ''),
    currentIndexValue: String(form.currentIndexValue ?? ''),
  });
}

export function resultsMatchFinancialInputs(
  form: Record<string, unknown>,
  results: Record<string, unknown> | null | undefined,
  lastFingerprint?: string | null
): boolean {
  if (!results || !Object.keys(results).length) return false;
  const fp = financialInputsFingerprint(form);
  if (lastFingerprint && lastFingerprint === fp) return true;

  const disc = (results.disclosure_data as { discount_rate_pct?: number } | undefined)?.discount_rate_pct;
  const formPct = parseFloat(String(form.discountRate ?? ''));
  if (Number.isFinite(disc) && Number.isFinite(formPct)) {
    return Math.abs(disc - formPct) <= 0.05;
  }

  const rateDec = normalizeAnnualRate(form.discountRate);
  const storedDec = normalizeAnnualRate(disc != null ? disc : NaN);
  if (Number.isFinite(rateDec) && Number.isFinite(storedDec)) {
    return Math.abs(rateDec - storedDec) <= 0.0005;
  }

  return false;
}
