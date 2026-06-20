import { normalizeAnnualRate } from '@/lib/ifrs16-rates';

export type Ifrs16FormLike = Record<string, unknown>;

/** Map form escalation fields to annual decimal rate for the API (0 when none). */
export function resolveEscalationRateDecimal(form: Ifrs16FormLike): number {
  const type = String(form.escalationType ?? 'None').trim();
  const raw = parseFloat(String(form.escalationValue ?? '0')) || 0;
  if (raw <= 0) return 0;
  const asDecimal = raw > 1 ? raw / 100 : raw;
  if (type === 'Percentage') return asDecimal;
  // Fixed % step-up (e.g. "5% at month 12") without CPI index values
  if (type === 'CPI Linked' && !form.cpiAdjustments) return asDecimal;
  return 0;
}

export function escalationAppliedInForm(form: Ifrs16FormLike): boolean {
  const type = String(form.escalationType ?? 'None').trim();
  if (type === 'Percentage') return resolveEscalationRateDecimal(form) > 0;
  if (type === 'CPI Linked') return Boolean(form.cpiAdjustments);
  return false;
}

export function buildIfrs16CalculatePayload(
  form: Ifrs16FormLike,
  extras?: { reportingDate?: string; termMonths?: number; companyId?: string }
): Record<string, unknown> {
  const start = String(form.startDate || form.effectiveDate || '');
  let termMonths = extras?.termMonths ?? 12;
  if (!extras?.termMonths) {
    if (form.lease_term_months) {
      termMonths = Math.max(1, parseInt(String(form.lease_term_months), 10) || 12);
    } else if (form.endDate) {
      const end = new Date(String(form.endDate));
      termMonths = Math.max(
        1,
        Math.ceil((end.getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24 * 30))
      );
    }
  }

  const cpiAdjustments = Boolean(form.cpiAdjustments);
  const legal = parseFloat(String(form.legalFees ?? '0')) || 0;
  const brokerage = parseFloat(String(form.brokerageFees ?? '0')) || 0;
  const otherIdc = parseFloat(String(form.otherInitialDirectCosts ?? '0')) || 0;
  const idcTotal =
    legal + brokerage + otherIdc || parseFloat(String(form.initialDirectCosts ?? '0')) || 0;

  return {
    lease_id: form.leaseId,
    company_id: extras?.companyId ?? '',
    asset_description: form.assetDescription,
    lessee_name: form.lessee,
    lessor_name: form.lessor,
    commencement_date: start,
    lease_term_months: termMonths,
    monthly_payment: parseFloat(String(form.baseRentAmount)) || 0,
    non_lease_component: parseFloat(String(form.nonLeaseComponent ?? '0')) || 0,
    non_lease_description: String(form.nonLeaseDescription ?? '').trim(),
    non_lease_additive: Boolean(form.nonLeaseAdditive),
    practical_expedient_elected: Boolean(form.practicalExpedientElected),
    annual_discount_rate: normalizeAnnualRate(form.discountRate) || 0.085,
    reporting_date: extras?.reportingDate,
    initial_direct_costs: idcTotal,
    legal_fees: legal,
    brokerage_fees: brokerage,
    other_initial_direct_costs: otherIdc,
    initial_direct_costs_description: String(form.initialDirectCostsDescription ?? '').trim(),
    currency: form.currency,
    payment_type: form.paymentType || 'Arrears',
    rent_free_months: Number(form.rentFreeMonths ?? 0) || 0,
    cash_incentive: parseFloat(String(form.cashIncentive ?? form.leaseIncentives ?? '0')) || 0,
    lease_incentive_description: String(form.leaseIncentiveDescription ?? '').trim(),
    rvg_amount: parseFloat(String(form.rvgAmount ?? '0')) || 0,
    rvg_guaranteed_by: String(form.rvgGuaranteedBy ?? 'None').trim(),
    rvg_expected_payment: parseFloat(String(form.rvgExpectedPayment ?? '0')) || 0,
    escalation_rate: resolveEscalationRateDecimal(form),
    cpi_index_base: cpiAdjustments ? parseFloat(String(form.baseIndexValue ?? '0')) || 0 : 0,
    cpi_index_current: cpiAdjustments ? parseFloat(String(form.currentIndexValue ?? '0')) || 0 : 0,
    cpi_adjustment_frequency_months: cpiAdjustments
      ? parseInt(String(form.cpiAdjustmentFrequencyMonths ?? '12'), 10) || 12
      : 12,
  };
}

/** Sync form escalation/CPI fields from calculation metadata returned by the API. */
export function syncFormEscalationFromResults(
  form: Ifrs16FormLike,
  meta: Record<string, unknown> | undefined
): Partial<Ifrs16FormLike> {
  if (!meta) return {};
  const patch: Partial<Ifrs16FormLike> = {};
  if (meta.cpi_applied === true) {
    patch.cpiAdjustments = true;
    if (meta.cpi_index_base != null) patch.baseIndexValue = String(meta.cpi_index_base);
    if (meta.cpi_index_current != null) patch.currentIndexValue = String(meta.cpi_index_current);
    if (meta.cpi_adjustment_frequency_months != null) {
      patch.cpiAdjustmentFrequencyMonths = String(meta.cpi_adjustment_frequency_months);
    }
  } else if (meta.cpi_applied === false) {
    patch.cpiAdjustments = false;
  }
  if (meta.escalation_applied === true && meta.escalation_rate_pct != null) {
    const pct = Number(meta.escalation_rate_pct);
    if (pct > 0) {
      patch.escalationType = 'Percentage';
      patch.escalationValue = String(Math.round(pct * 100) / 100);
    }
  } else if (meta.escalation_applied === false) {
    const type = String(form.escalationType ?? 'None');
    if (type === 'Percentage' && !form.cpiAdjustments) {
      patch.escalationType = 'None';
      patch.escalationValue = '';
    }
  }
  return patch;
}

export function formatIdcReviewLine(form: Ifrs16FormLike, fmt: (n: number) => string): string {
  const legal = parseFloat(String(form.legalFees ?? '0')) || 0;
  const brokerage = parseFloat(String(form.brokerageFees ?? '0')) || 0;
  const other = parseFloat(String(form.otherInitialDirectCosts ?? '0')) || 0;
  const total =
    legal + brokerage + other || parseFloat(String(form.initialDirectCosts ?? '0')) || 0;
  if (total <= 0) return 'Nil';
  const parts: string[] = [];
  if (legal > 0) parts.push(`Legal fees ${fmt(legal)}`);
  if (brokerage > 0) parts.push(`Brokerage ${fmt(brokerage)}`);
  if (other > 0) parts.push(`Other ${fmt(other)}`);
  return `${fmt(total)}${parts.length ? ` (${parts.join(' + ')})` : ''}`;
}
