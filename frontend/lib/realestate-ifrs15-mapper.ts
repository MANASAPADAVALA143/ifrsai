/** Map UAE real estate module outputs → main IFRS 15 /calculate payload */

import type { RealEstateExcelImport } from './ifrs15-realestate-parse';

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

/** Map Emaar real-estate Excel import → /calculate payload (main IFRS 15 flow). */
export function mapRealEstateExcelImportToCalculatePayload(
  parsed: RealEstateExcelImport
): Record<string, unknown> {
  const f = parsed.form;
  const unit = parsed.unitRows[0] || {};
  const contractValue = parseFloat(f.contractValue) || 0;
  const totalCosts = parseFloat(f.totalCosts) || contractValue;
  const costsIncurred = parseFloat(f.costsIncurred) || 0;
  const revenuePrior = parseFloat(f.revenuePrior) || 0;
  const deposit = parseFloat(f.depositReceived) || 0;
  const completionPct = parseFloat(unit.completion_pct || '0') || 0;

  return mapRealEstateToCalculatePayload({
    contractValue,
    constructionStart: f.constructionStart,
    spaExecutionDate: f.spaExecutionDate,
    expectedHandover: f.expectedHandover,
    costsIncurred,
    totalCosts,
    revenuePrior,
    escrowTotal: deposit,
    offPlan: {
      completion_percentage: completionPct,
      revenue_recognised_to_date: revenuePrior,
      billings_to_date: deposit,
    },
    spaExtracted: {
      property_unit_number: unit.unit_number || parsed.primaryContractId,
      buyer_name: unit.buyer_name,
      project_name: f.projectName,
    },
    reraRegistrationNumber: f.reraNumber,
    projectName: f.projectName,
    currency: 'AED',
  });
}

/** Build extraction-shaped data for IFRS 15 UI after Excel import. */
export function realEstateExcelToExtractedData(parsed: RealEstateExcelImport): Record<string, unknown> {
  const f = parsed.form;
  const unit = parsed.unitRows[0] || {};
  const contractValue = parseFloat(f.contractValue) || 0;
  const effectiveDate = f.spaExecutionDate || f.constructionStart || '2024-01-01';
  const term = monthsBetween(effectiveDate, f.expectedHandover);

  return {
    step1_identify_contract: {
      contract_details: {
        contract_id: parsed.primaryContractId,
        customer_name: unit.buyer_name || 'Buyer',
        vendor_name: 'Developer',
        effective_date: effectiveDate,
        contract_term_months: term,
        total_contract_value: contractValue,
        currency: 'AED',
      },
    },
    step2_performance_obligations: {
      identified_obligations: [
        {
          obligation_id: 'PO-RE-1',
          description:
            unit.performance_obligation ||
            `Off-plan unit ${unit.unit_number || parsed.primaryContractId}`,
          standalone_selling_price_estimate: contractValue,
        },
      ],
    },
    step3_transaction_price: {
      fixed_consideration: contractValue,
      total_transaction_price: contractValue,
    },
    _realestate_overlay: {
      completion_pct: parseFloat(unit.completion_pct || '0') || 0,
      currency: 'AED',
      project_name: f.projectName,
      rera_registration_number: f.reraNumber,
    },
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
