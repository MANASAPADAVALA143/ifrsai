/** Map UAE real estate module outputs → main IFRS 15 /calculate payload */

function monthsBetween(start: string, end: string, fallback = 24): number {
  const s = start?.slice(0, 10);
  const e = end?.slice(0, 10);
  if (!s || !e) return fallback;
  const sd = new Date(`${s}T12:00:00`);
  const ed = new Date(`${e}T12:00:00`);
  if (Number.isNaN(sd.getTime()) || Number.isNaN(ed.getTime()) || ed <= sd) return fallback;
  return Math.max(1, (ed.getFullYear() - sd.getFullYear()) * 12 + (ed.getMonth() - sd.getMonth()));
}

function resolveEffectiveDate(input: RealEstateSyncInput): string {
  const spa = input.spaExecutionDate?.slice(0, 10);
  if (spa) return spa;
  return input.constructionStart.slice(0, 10) || '2024-01-01';
}

export type RealEstateSyncInput = {
  contractValue: number;
  constructionStart: string;
  spaExecutionDate?: string;
  expectedHandover: string;
  costsIncurred: number;
  totalCosts: number;
  revenuePrior: number;
  escrowTotal: number;
  offPlan: Record<string, unknown>;
  periodSchedule?: Record<string, unknown>[];
  spaExtracted?: Record<string, unknown> | null;
  spaInputs?: Record<string, unknown> | null;
  reraRegistrationNumber?: string;
  projectName?: string;
  currency?: string;
  exchangeRate?: number;
  revenueRecognitionTrigger?: string;
  recognitionTriggerSummary?: string;
};

export const IFRS15_REALESTATE_SYNC_KEY = 'ifrs15_realestate_sync';
export const IFRS15_REALESTATE_SYNC_PENDING = 'ifrs15_realestate_sync_pending';

export function mapRealEstateToCalculatePayload(input: RealEstateSyncInput): Record<string, unknown> {
  const spa = input.spaExtracted || {};
  const mapped = input.spaInputs || {};
  const unit = String(spa.property_unit_number || mapped.unit_id || 'UNIT');
  const effectiveDate = resolveEffectiveDate(input);
  const term = monthsBetween(effectiveDate, input.expectedHandover);
  const billings = Number(input.offPlan.billings_to_date) || input.escrowTotal;
  const revToDate = Number(input.offPlan.revenue_recognised_to_date) || 0;
  const poSsp = revToDate > 0 ? revToDate : input.contractValue;
  const cur = (input.currency || 'AED').toUpperCase();

  return {
    contract_id: `RE-${unit}`,
    customer_name: String(spa.buyer_name || mapped.customer_name || 'Buyer'),
    vendor_name: String(spa.developer_name || mapped.vendor_name || 'Developer'),
    effective_date: effectiveDate,
    contract_term_months: term,
    fixed_consideration: input.contractValue,
    variable_consideration: 0,
    currency: cur,
    cash_received: billings,
    contract_type: 'fixed_price',
    total_estimated_cost: input.totalCosts,
    actual_cost_to_date: input.costsIncurred,
    prior_revenue_recognised: input.revenuePrior,
    cumulative_billed: billings,
    performance_obligations: [
      {
        obligation_id: 'PO-RE-1',
        description: `Off-plan unit ${unit} — IFRS 15.35(c) over time, cost-to-cost method`,
        standalone_selling_price: poSsp,
        recognition_method: 'over_time',
        duration_months: term,
        transfer_date: input.expectedHandover.slice(0, 10) || null,
      },
    ],
    realestate_overlay: {
      ...input.offPlan,
      project_name: input.projectName || spa.project_name || mapped.project_name,
      rera_registration_number: input.reraRegistrationNumber,
      currency: cur,
      exchange_rate: input.exchangeRate ?? 3.6725,
      revenue_recognition_trigger: input.revenueRecognitionTrigger,
      recognition_trigger_summary: input.recognitionTriggerSummary,
      spa_execution_date: effectiveDate,
    },
    realestate_period_schedule: input.periodSchedule || [],
    rera_registration_number: input.reraRegistrationNumber,
    project_name: input.projectName || spa.project_name || mapped.project_name,
  };
}

export function saveRealEstateSyncPayload(payload: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(IFRS15_REALESTATE_SYNC_KEY, JSON.stringify(payload));
  sessionStorage.setItem(IFRS15_REALESTATE_SYNC_PENDING, '1');
}

export function consumeRealEstateSyncPending(): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null;
  if (sessionStorage.getItem(IFRS15_REALESTATE_SYNC_PENDING) !== '1') return null;
  sessionStorage.removeItem(IFRS15_REALESTATE_SYNC_PENDING);
  const raw = sessionStorage.getItem(IFRS15_REALESTATE_SYNC_KEY);
  sessionStorage.removeItem(IFRS15_REALESTATE_SYNC_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
