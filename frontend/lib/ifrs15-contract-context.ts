/**
 * Session-scoped shared contract record for IFRS 15 compliance tabs.
 * One calculated contract → many compliance assessments without re-typing core fields.
 */

import { sanitizeCurrencyCode } from '@/lib/utils';

export type Ifrs15ContractAssessments = {
  variable_consideration?: Record<string, unknown> | null;
  principal_agent?: Record<string, unknown> | null;
  financing_component?: Record<string, unknown> | null;
  contract_costs?: Record<string, unknown> | null;
  bill_and_hold?: Record<string, unknown> | null;
  warranties?: Record<string, unknown> | null;
  licenses?: Record<string, unknown> | null;
  modifications?: Record<string, unknown> | null;
  tp_adjustments?: Record<string, unknown> | null;
  rpo?: Record<string, unknown> | null;
};

export type Ifrs15ContractContext = {
  contract_id: string;
  customer_name: string;
  vendor_name?: string;
  effective_date: string;
  contract_end_date?: string;
  contract_term_months?: number;
  contract_value: number;
  currency: string;
  payment_terms?: string;
  revenue_recognised_to_date?: number;
  deferred_balance?: number;
  performance_obligations?: Array<Record<string, unknown>>;
  core_results?: Record<string, unknown> | null;
  extraction_raw?: Record<string, unknown> | null;
  saved_at: string;
  source: 'calculate' | 'portfolio' | 'manual';
  assessments?: Ifrs15ContractAssessments;
};

export const IFRS15_CONTRACT_REGISTRY_KEY = 'ifrs15_contract_registry';
export const IFRS15_ACTIVE_CONTRACT_ID_KEY = 'ifrs15_active_contract_id';

function addMonthsIso(isoDate: string, months: number): string {
  const base = isoDate?.slice(0, 10);
  if (!base) return '';
  const d = new Date(`${base}T12:00:00`);
  if (Number.isNaN(d.getTime())) return base;
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function readRegistry(): Record<string, Ifrs15ContractContext> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(IFRS15_CONTRACT_REGISTRY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Ifrs15ContractContext>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeRegistry(registry: Record<string, Ifrs15ContractContext>): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(IFRS15_CONTRACT_REGISTRY_KEY, JSON.stringify(registry));
}

export function listIfrs15Contracts(): Ifrs15ContractContext[] {
  const registry = readRegistry();
  return Object.values(registry).sort(
    (a, b) => new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime(),
  );
}

export function getIfrs15Contract(contractId: string): Ifrs15ContractContext | null {
  if (!contractId) return null;
  return readRegistry()[contractId] ?? null;
}

export function getActiveIfrs15ContractId(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(IFRS15_ACTIVE_CONTRACT_ID_KEY);
}

export function getActiveIfrs15Contract(): Ifrs15ContractContext | null {
  const id = getActiveIfrs15ContractId();
  if (!id) return null;
  return getIfrs15Contract(id);
}

export function setActiveIfrs15ContractId(contractId: string): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(IFRS15_ACTIVE_CONTRACT_ID_KEY, contractId);
}

/** Upsert contract in session registry and mark it active. */
export function registerIfrs15Contract(ctx: Ifrs15ContractContext): Ifrs15ContractContext {
  const registry = readRegistry();
  const existing = registry[ctx.contract_id];
  const merged: Ifrs15ContractContext = {
    ...existing,
    ...ctx,
    assessments: { ...existing?.assessments, ...ctx.assessments },
    saved_at: new Date().toISOString(),
  };
  registry[ctx.contract_id] = merged;
  writeRegistry(registry);
  setActiveIfrs15ContractId(ctx.contract_id);
  return merged;
}

export function patchIfrs15Assessments(
  contractId: string,
  patch: Partial<Ifrs15ContractAssessments>,
): Ifrs15ContractContext | null {
  const registry = readRegistry();
  const existing = registry[contractId];
  if (!existing) return null;
  const updated: Ifrs15ContractContext = {
    ...existing,
    assessments: { ...existing.assessments, ...patch },
    saved_at: new Date().toISOString(),
  };
  registry[contractId] = updated;
  writeRegistry(registry);
  return updated;
}

export function buildIfrs15ContractFromCalculate(input: {
  payload: Record<string, unknown>;
  results: Record<string, unknown>;
  extractedData?: Record<string, unknown> | null;
}): Ifrs15ContractContext {
  const { payload, results, extractedData } = input;
  const effective = String(payload.effective_date || '').slice(0, 10);
  const term = Number(payload.contract_term_months) || 12;
  const tp = Number(
    results.total_transaction_price ??
      results.total_contract_value ??
      payload.fixed_consideration ??
      0,
  );
  const cur = sanitizeCurrencyCode(String(payload.currency || 'USD'), 'USD');

  return {
    contract_id: String(payload.contract_id || `C-${Date.now().toString(36).slice(-6)}`),
    customer_name: String(payload.customer_name || ''),
    vendor_name: String(payload.vendor_name || ''),
    effective_date: effective,
    contract_end_date: addMonthsIso(effective, term),
    contract_term_months: term,
    contract_value: tp,
    currency: cur,
    payment_terms: String(payload.payment_terms || ''),
    revenue_recognised_to_date: Number(results.total_recognised ?? 0),
    deferred_balance: Number(
      results.total_deferred ??
        (results.contract_balances as Record<string, unknown> | undefined)?.contract_liability_amount ??
        0,
    ),
    performance_obligations: Array.isArray(results?.performance_obligations)
      ? (results.performance_obligations as Array<Record<string, unknown>>)
      : Array.isArray(payload.performance_obligations)
        ? (payload.performance_obligations as Array<Record<string, unknown>>)
        : [],
    core_results: results,
    extraction_raw: extractedData ?? null,
    saved_at: new Date().toISOString(),
    source: 'calculate',
    assessments: {},
  };
}

function buildRemainingScheduleLines(
  schedule: Array<Record<string, unknown>>,
  po: { obligation_id?: string; name?: string },
): { expected_recognition_date: string; amount: number }[] {
  const poId = String(po.obligation_id || '').trim();
  const poName = String(po.name || '').trim().toLowerCase();
  const lines: { expected_recognition_date: string; amount: number }[] = [];

  for (const row of schedule) {
    const rowObId = String(row.Obligation_ID || row.obligation_id || '').trim();
    const rowOb = String(row.Obligation || row.obligation || '').trim().toLowerCase();
    const matches =
      (poId && rowObId === poId) ||
      (!poId && poName && rowOb && (rowOb.includes(poName) || poName.includes(rowOb)));
    if (!matches) continue;

    const scheduled = Number(row.Scheduled_Revenue ?? row.scheduled_revenue ?? 0) || 0;
    const recognised = Number(row.Revenue ?? row.revenue ?? 0) || 0;
    const remaining = scheduled - recognised;
    if (remaining <= 0.01) continue;

    const dateStr = String(row.Date || row.date || row.expected_recognition_date || '').slice(0, 10);
    if (!dateStr) continue;

    lines.push({
      expected_recognition_date: dateStr,
      amount: Math.round(remaining * 100) / 100,
    });
  }
  return lines;
}

/** Build RPO 120 performance-obligation rows from Step 5 calculate results (multi-POB safe). */
export function buildRpo120PerformanceObligationsFromResults(
  results?: Record<string, unknown> | null,
  schedule: Array<Record<string, unknown>> = [],
): Array<Record<string, unknown>> {
  const perfObs = Array.isArray(results?.performance_obligations)
    ? (results.performance_obligations as Array<Record<string, unknown>>)
    : [];
  if (!perfObs.length) return [];

  return perfObs.map((p, i) => {
    const poId = String(p.obligation_id || `PO-${i + 1}`);
    const poName = String(p.obligation || p.description || poId);
    const recMethod = String(p.recognition_method || '').toLowerCase();
    return {
      name: poName,
      obligation_id: poId,
      allocated_amount: Number(p.allocated_amount ?? 0),
      recognised_to_date: Number(
        p.revenue_recognized ?? p.revenue_recognised ?? p.recognised_to_date ?? 0,
      ),
      expected_recognition_pattern: 'within_1_year',
      recognition_type: recMethod.includes('point') ? 'point_in_time' : 'over_time',
      remaining_schedule: buildRemainingScheduleLines(schedule, { obligation_id: poId, name: poName }),
    };
  });
}

const MOD_TYPE_NAMES: Record<string, string> = {
  TYPE_1: 'New Separate Contract',
  TYPE_2: 'Prospective Modification',
  TYPE_3: 'Cumulative Catch-Up',
};

/** Sync modification module from extraction when main calc already reflects a modification. */
export function buildModificationAssessmentFromExtraction(
  extractedData?: Record<string, unknown> | null,
  results?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const mods = (extractedData as { contract_modifications?: Record<string, unknown> } | null)
    ?.contract_modifications;
  if (!mods?.modifications_present) return null;

  const details = mods.modification_details;
  if (!Array.isArray(details) || details.length === 0) return null;

  const perfCount = Array.isArray(results?.performance_obligations)
    ? results.performance_obligations.length
    : 0;
  const primary =
    details.find(
      (d: Record<string, unknown>) => d.accounting_treatment === 'separate_contract',
    ) || details[0];

  const treatmentMap: Record<string, string> = {
    separate_contract: 'TYPE_1',
    prospective: 'TYPE_2',
    cumulative_catch_up: 'TYPE_3',
  };
  const modType =
    treatmentMap[String((primary as Record<string, unknown>).accounting_treatment || '')] || 'TYPE_1';

  return {
    modification_type: modType,
    modification_type_name: MOD_TYPE_NAMES[modType] || 'Contract Modification',
    auto_computed: true,
    source: 'main_calculation',
    explanation: String((primary as Record<string, unknown>).description || ''),
    price_change: Number((primary as Record<string, unknown>).price_change ?? 0),
    scope_change: String((primary as Record<string, unknown>).scope_change || ''),
    modification_date: String((primary as Record<string, unknown>).modification_date || ''),
    modifications_in_contract: details.length,
    applied_in_schedule: perfCount > 1,
  };
}

/** Bill-and-hold applies to goods pending physical transfer — not pure services contracts. */
export function contractInvolvesBillAndHoldGoods(
  extractedData?: Record<string, unknown> | null,
): boolean {
  const obligations =
    (extractedData as { step2_performance_obligations?: { identified_obligations?: Array<Record<string, unknown>> } })
      ?.step2_performance_obligations?.identified_obligations || [];
  if (!obligations.length) return false;

  const goodsPattern =
    /\b(goods?|equipment|inventory|materials?|machinery|vehicles?|appliances?|physical\s+product|deliverable\s+units?)\b/i;
  return obligations.some((ob) => goodsPattern.test(String(ob?.description || '')));
}

export function contractCostsBatchNotAssessed(batch: Record<string, unknown> | null | undefined): boolean {
  if (!batch) return true;
  if (batch.assessed === false) return true;
  const costs = batch.costs;
  if (!Array.isArray(costs) || costs.length === 0) return true;
  return costs.every(
    (c) =>
      c &&
      typeof c === 'object' &&
      ((c as Record<string, unknown>).assessed === false ||
        (c as Record<string, unknown>).treatment === 'NOT_ASSESSED'),
  );
}

export function buildIfrs15ContractFromPortfolio(row: Record<string, unknown>): Ifrs15ContractContext {
  const contractData = (row.contract_data as Record<string, unknown>) || {};
  const results = (contractData.results as Record<string, unknown>) || null;
  const start = String(row.start_date || row.effective_date || '').slice(0, 10);
  const end = String(row.end_date || '').slice(0, 10);

  return {
    contract_id: String(row.contract_id || row.id || ''),
    customer_name: String(row.customer_name || ''),
    effective_date: start,
    contract_end_date: end || undefined,
    contract_value: Number(row.total_tp ?? row.total_transaction_price ?? 0),
    currency: sanitizeCurrencyCode(String(row.currency || 'USD'), 'USD'),
    revenue_recognised_to_date: Number(row.recognised_to_date ?? results?.total_recognised ?? 0),
    deferred_balance: Number(row.deferred_balance ?? results?.total_deferred ?? 0),
    core_results: results,
    extraction_raw: (contractData.extraction_raw as Record<string, unknown>) || null,
    saved_at: new Date().toISOString(),
    source: 'portfolio',
    assessments: (contractData.assessments as Ifrs15ContractAssessments) || {},
  };
}
